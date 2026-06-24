/* eslint-disable no-console */
// src/scripts/normalize-credit-limits.ts
//
// Spec 047 — Sync on-chain `creditLimit` to match DB `users.creditLimit`.
//
// THE BUG (verified against prod DB on 2026-05-08):
//   - DB `users.creditLimit` is 100% on the canonical ladder
//     (`[$1, $3, $4, $6, $8, $10, $12, $15, $18, $22, $25]` or `$0`).
//     Audit returned 0 off-ladder rows in the DB.
//   - On-chain LoanManager v3 `creditLimit` has ~260 wallets stuck on
//     fractional values (`$0.65, $0.85, $5.20, $11.70, $16.25, $21.25`)
//     — every value decomposes cleanly to `ladderStep × 0.65 / 0.85`.
//   - Backend uses `effectiveLimit = min(DB, onChain)`
//     (`loan.service.ts:386-393`), so the lower on-chain value silently
//     caps the user. The DB is never wrong; the chain is.
//
// THIS SCRIPT:
//   Treats DB as source of truth and pushes its `score + creditLimit`
//   to chain via `giveCreditScoreAndLimit`. No recomputation, no
//   retroactive penalty (the spec-035 `score - 2` was applied at the
//   user's post-default repay event and is already baked into the DB
//   for any user who recovered — we must NOT re-apply it).
//
// SKIP RULES:
//   - `score IS NULL` or `creditLimit IS NULL` (incomplete profile)
//   - `creditLimit = 0` (markDefault state will recover via repay flow)
//   - on-chain `isDefaulted = true` (markDefault enforces $0 — wait
//     for repay flow to recompute)
//   - on-chain `creditLimit` already equals DB (idempotent no-op)
//   - RPC error reading on-chain (re-runnable; emits warning)
//
// CLI:
//   ts-node backend/src/scripts/normalize-credit-limits.ts --dry
//   ts-node backend/src/scripts/normalize-credit-limits.ts --apply
//   ts-node backend/src/scripts/normalize-credit-limits.ts --apply --limit 50
//   ts-node backend/src/scripts/normalize-credit-limits.ts --apply --yes  # skip confirm
//   ts-node backend/src/scripts/normalize-credit-limits.ts --dry --wallet 0xabc...
//
// `--limit N` caps both inspection and apply, so `--dry --limit 5` is a
// quick preview of the first 5 normalize candidates.
//
// Idempotent: re-running after a clean pass produces 0 normalize rows.

import * as readline from 'readline';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../app.module';
import { User } from '../domain/entities/user.entity';
import { AuditLog } from '../domain/entities/audit-log.entity';
import {
  BLOCKCHAIN_GATEWAY,
  BlockchainGatewayPort,
} from '../domain/ports/outbound/blockchain-gateway.port';

export type Decision =
  | 'normalize'
  | 'skip_already_correct'
  | 'skip_defaulted'
  | 'skip_no_score'
  | 'skip_rpc_error';

export interface PlanRow {
  userId: number;
  wallet: string;
  dbScore: number | null;
  dbLimitMicro: bigint;
  currentOnChainMicro: bigint;
  isDefaulted: boolean;
  decision: Decision;
  rpcError?: string;
}

export interface CliArgs {
  apply: boolean;
  dry: boolean;
  yes: boolean;
  limit?: number;
  wallet?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const apply = argv.includes('--apply');
  const dry = !apply;
  const yes = argv.includes('--yes');

  const limitFlagIdx = argv.indexOf('--limit');
  const limit =
    limitFlagIdx >= 0 && argv[limitFlagIdx + 1]
      ? parseInt(argv[limitFlagIdx + 1], 10)
      : undefined;

  const walletFlagIdx = argv.indexOf('--wallet');
  const wallet =
    walletFlagIdx >= 0 && argv[walletFlagIdx + 1]
      ? argv[walletFlagIdx + 1].toLowerCase()
      : undefined;

  return { apply, dry, yes, limit, wallet };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Plan the action for a single user. Reads on-chain limit + isDefaulted
 * in parallel to halve wall time. Either RPC failure → skip_rpc_error
 * (re-runnable). DB is never mutated here.
 */
export async function planForUser(
  user: User,
  blockchain: BlockchainGatewayPort,
): Promise<PlanRow> {
  const wallet = user.walletAddress;
  // creditLimit is stored as numeric(18,2) in micro-units in DB (e.g.
  // `1000000.00` means $1). Round to bigint to compare exactly with
  // on-chain (also bigint micro-units).
  const dbLimitMicro = BigInt(Math.round(Number(user.creditLimit ?? 0)));

  // Parallelize the two reads. `Promise.allSettled` so one failure
  // doesn't void the other read's data.
  const [limitRes, defRes] = await Promise.allSettled([
    blockchain.readCreditLimitOnChain(wallet),
    blockchain.readIsDefaulted(wallet),
  ]);

  let currentOnChainMicro = 0n;
  let isDefaulted = false;
  let isDefaultedKnown = true;
  let rpcError: string | undefined;

  if (limitRes.status === 'fulfilled') {
    currentOnChainMicro = limitRes.value;
  } else {
    rpcError =
      (limitRes.reason as Error)?.message ?? 'readCreditLimitOnChain failed';
  }

  if (defRes.status === 'fulfilled') {
    if (defRes.value === null) {
      isDefaultedKnown = false;
    } else {
      isDefaulted = defRes.value;
    }
  } else {
    isDefaultedKnown = false;
    if (!rpcError) {
      rpcError =
        (defRes.reason as Error)?.message ?? 'readIsDefaulted failed';
    }
  }

  let decision: Decision;
  if (rpcError || !isDefaultedKnown) {
    decision = 'skip_rpc_error';
  } else if (user.score == null) {
    // Defensive — universe filter excludes these but guard anyway.
    decision = 'skip_no_score';
  } else if (isDefaulted) {
    decision = 'skip_defaulted';
  } else {
    decision =
      currentOnChainMicro === dbLimitMicro
        ? 'skip_already_correct'
        : 'normalize';
  }

  return {
    userId: user.id,
    wallet,
    dbScore: user.score ?? null,
    dbLimitMicro,
    currentOnChainMicro,
    isDefaulted,
    decision,
    rpcError,
  };
}

/**
 * Execute one normalize plan: write to chain via `giveCreditScoreAndLimit`,
 * then insert the audit_logs row. DB is intentionally NOT mutated — DB is
 * the source of truth and already correct.
 */
export async function applyPlan(
  plan: PlanRow,
  blockchain: BlockchainGatewayPort,
  auditRepo: Repository<AuditLog>,
): Promise<{ ok: boolean; error?: string }> {
  if (plan.decision !== 'normalize') return { ok: true };
  if (plan.dbScore == null) {
    return { ok: false, error: 'dbScore is null (should not reach apply)' };
  }

  try {
    const result = await blockchain.giveCreditScoreAndLimit(
      plan.wallet,
      plan.dbScore,
      plan.dbLimitMicro,
      undefined,
      undefined,
      'low',
    );
    if (result !== 200) {
      return {
        ok: false,
        error: `giveCreditScoreAndLimit returned ${result}`,
      };
    }

    const entry = auditRepo.create({
      action: 'NORMALIZE_LIMIT_SPEC_047',
      walletAddress: plan.wallet,
      userId: plan.userId,
      metadata: {
        from_onchain_micro: plan.currentOnChainMicro.toString(),
        to_onchain_micro: plan.dbLimitMicro.toString(),
        from_onchain_usdc: Number(plan.currentOnChainMicro) / 1_000_000,
        to_onchain_usdc: Number(plan.dbLimitMicro) / 1_000_000,
        score_written: plan.dbScore,
        source: 'db_to_chain_sync',
      },
    });
    await auditRepo.save(entry);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function formatRow(p: PlanRow): string {
  const flag =
    p.decision === 'normalize'
      ? '→'
      : p.decision === 'skip_defaulted'
        ? 'D'
        : p.decision === 'skip_already_correct'
          ? '='
          : p.decision === 'skip_no_score'
            ? 'N'
            : 'E';
  const onChainUsd = Number(p.currentOnChainMicro) / 1_000_000;
  const dbUsd = Number(p.dbLimitMicro) / 1_000_000;
  return (
    `[${flag}] ${p.wallet} onChain=$${onChainUsd.toFixed(2)} → DB=$${dbUsd} ` +
    `(score=${p.dbScore ?? '?'}, def=${p.isDefaulted}) ${p.decision}` +
    (p.rpcError ? ` :: ${p.rpcError}` : '')
  );
}

/**
 * Interactive y/N prompt. Resolves to true on `y` / `yes` (case-insensitive),
 * false otherwise. Bypassed by `--yes`.
 */
async function confirmInteractive(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[spec-047] mode=${args.apply ? 'APPLY' : 'DRY'}` +
      `${args.limit !== undefined ? ` limit=${args.limit}` : ''}` +
      `${args.wallet ? ` wallet=${args.wallet}` : ''}` +
      `${args.yes ? ' --yes' : ''}`,
  );

  // Pre-flight: APPLY needs the signer key. Bail early before booting
  // NestJS so the operator gets a fast, clear error.
  if (args.apply && !process.env.ETH_PRIVATE_KEY) {
    console.error(
      '[spec-047] APPLY requires ETH_PRIVATE_KEY env. Aborting.',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const userRepo: Repository<User> = app.get(getRepositoryToken(User));
  const auditRepo: Repository<AuditLog> = app.get(getRepositoryToken(AuditLog));
  const blockchain: BlockchainGatewayPort = app.get(BLOCKCHAIN_GATEWAY);

  // Universe: any user with a positive DB credit line and a non-null
  // score. Users with creditLimit=0 are either pre-credit (never
  // scored) or markDefault state (handled by repay flow, not this
  // script).
  let qb = userRepo
    .createQueryBuilder('u')
    .where(
      'u."creditLimit" IS NOT NULL AND u."creditLimit" > 0 AND u.score IS NOT NULL',
    );

  if (args.wallet) {
    qb = qb.andWhere('LOWER(u."walletAddress") = :w', {
      w: args.wallet.toLowerCase(),
    });
  }

  const users = await qb.orderBy('u.id', 'ASC').getMany();
  console.log(
    `[spec-047] universe = ${users.length} users with creditLimit > 0 AND score != NULL`,
  );

  // Inspect users; stop early once we've found `--limit N` normalize
  // candidates so a `--dry --limit 5` preview returns quickly without
  // walking 1900 RPCs.
  const plans: PlanRow[] = [];
  let inspected = 0;
  let normalizeCount = 0;
  for (const user of users) {
    const p = await planForUser(user, blockchain);
    plans.push(p);
    inspected++;
    if (p.decision === 'normalize') normalizeCount++;
    if (args.limit !== undefined && normalizeCount >= args.limit) break;
    if (inspected % 50 === 0) {
      console.log(`[spec-047] inspected ${inspected}/${users.length}...`);
    }
  }

  const counts: Record<Decision, number> = {
    normalize: 0,
    skip_already_correct: 0,
    skip_defaulted: 0,
    skip_no_score: 0,
    skip_rpc_error: 0,
  };
  for (const p of plans) counts[p.decision]++;

  console.log('\n[spec-047] PLAN SUMMARY');
  console.log(`  → normalize:            ${counts.normalize}`);
  console.log(`  = skip_already_correct: ${counts.skip_already_correct}`);
  console.log(`  D skip_defaulted:       ${counts.skip_defaulted}`);
  console.log(`  N skip_no_score:        ${counts.skip_no_score}`);
  console.log(`  E skip_rpc_error:       ${counts.skip_rpc_error}`);
  console.log(`  inspected: ${inspected}/${users.length}`);

  const toNormalize = plans.filter((p) => p.decision === 'normalize');
  console.log(`\n[spec-047] Wallets to normalize (${toNormalize.length}):`);
  for (const p of toNormalize) {
    console.log(`  ${formatRow(p)}`);
  }

  const rpcErrors = plans.filter((p) => p.decision === 'skip_rpc_error');
  if (rpcErrors.length > 0) {
    console.log(
      `\n[spec-047] RPC errors (${rpcErrors.length}) — re-run later:`,
    );
    for (const p of rpcErrors) console.log(`  ${formatRow(p)}`);
  }

  if (args.dry) {
    console.log(
      `\n[spec-047] DRY mode — no writes. Re-run with --apply to perform.`,
    );
    await app.close();
    return;
  }

  // APPLY phase. Confirm once before sending txs.
  if (!args.yes) {
    const ok = await confirmInteractive(
      `\n[spec-047] About to send ${toNormalize.length} on-chain txs ` +
        `(low priority, 250ms spacing). Continue?`,
    );
    if (!ok) {
      console.log('[spec-047] Aborted by operator.');
      await app.close();
      return;
    }
  }

  console.log(`\n[spec-047] APPLY — sending ${toNormalize.length} txs...`);
  let ok = 0;
  let fail = 0;
  for (const p of toNormalize) {
    const r = await applyPlan(p, blockchain, auditRepo);
    if (r.ok) {
      ok++;
      console.log(
        `  ✓ ${p.wallet} → $${Number(p.dbLimitMicro) / 1_000_000}`,
      );
    } else {
      fail++;
      console.error(`  ✗ ${p.wallet}: ${r.error}`);
    }
    await sleep(250);
  }

  console.log(`\n[spec-047] DONE. ok=${ok} fail=${fail}`);
  await app.close();
}

// Only run main() when invoked as a script — leave imports clean for tests.
if (require.main === module) {
  main().catch((e) => {
    console.error('[spec-047] FATAL:', e);
    process.exit(1);
  });
}
