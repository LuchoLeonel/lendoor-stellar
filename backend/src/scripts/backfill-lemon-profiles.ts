/* eslint-disable no-console */
// src/scripts/backfill-lemon-profiles.ts
//
// Spec 044 Phase A — passive/active Lemon identity backfill CLI.
//
// Modes:
//   --dry         (default) print stats; no DB writes
//   --apply       perform the backfill (requires LEMON_API_KEY env)
//
// Behavior depends on whether Lemon exposes a server-to-server profile
// endpoint:
//   - If `LEMON_API_KEY` is set AND `LEMON_PROFILE_API_URL` resolves to
//     a working endpoint, fetch profiles and upsert via UserService.
//   - Otherwise, the script reports the universe of users that would be
//     backfilled and exits — those users will be populated PASSIVELY when
//     they re-open the mini-app and `authenticate({ requirements:
//     { claims }})` fires (spec 044 §6).
//
// Idempotent: skips users that already have lemonTag populated.
//
// Rate limit: 5 req/sec when --apply is used.
//
// Usage:
//   ts-node backend/src/scripts/backfill-lemon-profiles.ts --dry
//   LEMON_API_KEY=xxx ts-node backend/src/scripts/backfill-lemon-profiles.ts --apply

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UserService } from '../user/user.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../domain/entities/user.entity';

interface LemonProfilePayload {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  lemonTag?: string | null;
  pep?: boolean | null;
  lemonCountry?: string | null;
}

async function fetchLemonProfile(
  walletAddress: string,
  apiKey: string,
  baseUrl: string,
): Promise<LemonProfilePayload | null> {
  // Hypothetical Lemon server-to-server endpoint shape. Adjust when
  // Lemon publishes the real spec.
  const url = `${baseUrl}/profiles/by-wallet/${walletAddress}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    return {
      firstName: (json.firstName as string) ?? null,
      lastName: (json.lastName as string) ?? null,
      email: (json.email as string) ?? null,
      lemonTag: (json.lemonTag as string) ?? null,
      pep: typeof json.pep === 'boolean' ? json.pep : null,
      lemonCountry: (json.country as string) ?? null,
    };
  } catch (err) {
    console.warn(`fetchLemonProfile error for ${walletAddress}:`, err);
    return null;
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dry = !apply;

  const apiKey = process.env.LEMON_API_KEY;
  const baseUrl = process.env.LEMON_PROFILE_API_URL ?? '';

  console.log(`[spec-044-backfill] mode=${apply ? 'APPLY' : 'DRY'}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const userRepo: Repository<User> = app.get(getRepositoryToken(User));
  const userService: UserService = app.get(UserService);

  const target = await userRepo
    .createQueryBuilder('u')
    .where("u.platform = :p", { p: 'lemon' })
    .andWhere('u.lemonTag IS NULL')
    .getMany();

  console.log(
    `[spec-044-backfill] universe = ${target.length} users with platform='lemon' AND lemonTag IS NULL`,
  );

  if (dry) {
    console.log(
      '[spec-044-backfill] DRY mode — no writes. Re-run with --apply to perform backfill.',
    );
    console.log(
      '[spec-044-backfill] NOTE: passive backfill happens automatically as users re-open the mini-app',
    );
    console.log(
      '[spec-044-backfill] (frontend ContractsProvider sends LEMON_IDENTITY_CLAIMS on every authenticate()).',
    );
    await app.close();
    return;
  }

  if (!apiKey || !baseUrl) {
    console.error(
      '[spec-044-backfill] APPLY requested but LEMON_API_KEY or LEMON_PROFILE_API_URL is missing.',
    );
    console.error(
      '[spec-044-backfill] Server-to-server Lemon endpoint is not yet documented as of spec 044 (2026-05-05).',
    );
    console.error(
      '[spec-044-backfill] Either request access from Lemon (dipa channel) or rely on passive backfill.',
    );
    await app.close();
    process.exit(2);
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  for (const user of target) {
    if (!user.walletAddress) {
      skipped++;
      continue;
    }
    const profile = await fetchLemonProfile(
      user.walletAddress,
      apiKey,
      baseUrl,
    );
    if (!profile) {
      skipped++;
    } else {
      try {
        const result = await userService.upsertLemonProfile({
          walletAddress: user.walletAddress,
          ...profile,
        });
        if (result.updated) updated++;
      } catch (err) {
        console.warn(`upsert error for ${user.walletAddress}:`, err);
        skipped++;
      }
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(
        `[spec-044-backfill] progress: ${processed}/${target.length} (updated=${updated} skipped=${skipped})`,
      );
    }
    // 5 req/s rate limit
    await sleep(200);
  }

  console.log(
    `[spec-044-backfill] DONE — processed=${processed} updated=${updated} skipped=${skipped}`,
  );

  await app.close();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
