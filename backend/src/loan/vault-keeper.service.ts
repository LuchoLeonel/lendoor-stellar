// src/loan/vault-keeper.service.ts
//
// SCF #45 Tranche 2 — D2.2 keeper + D2.4 on-chain invariants.
//
// Two jobs scheduled by ChainSyncScheduler (soroban gateway only):
//   * `strategy-keeper` (VAULT_KEEPER_ENABLED=true): refreshes the cached
//     DeFindex position (`sync_strategy`) and moves one tranche per call
//     (`rebalance`) while the vault's buffer policy asks for it. Every write is
//     simulated first; a no-op is never sent.
//   * `vault-invariants`: simulation-only reads that evaluate the invariants of
//     docs/security/monitoring-plan.md (I2 price drop, I3 cache drift, I4 share
//     mismatch, I5 idle below target, I8 paused, I9 pending governance) and
//     raise warnings (logger + Sentry when configured). Nothing is written.
//
// Pure decision functions (`evaluateInvariants`, `decideKeeperActions`) are
// exported so they can be unit-tested without RPC.

import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  SOROBAN_USDC_SAC,
  SOROBAN_VAULT,
  scAddress,
  scI128,
  sendVaultCall,
  simulateContractCall,
  simulateVaultCall,
} from 'src/config/sorobanConfig';

export type StrategyPos = { shares: bigint; assets: bigint; last_sync: bigint };
export type BufferCfg = { idle_target: bigint; tranche: bigint; min_out_bps: number };

export type VaultSnapshot = {
  at: number; // unix seconds (local clock)
  totalAssets: bigint;
  totalSupply: bigint;
  cash: bigint;
  /** Protocol fees accrued inside the vault balance (review A3): not LP assets, not idle. */
  feesAccrued: bigint;
  paused: boolean;
  pendingUpgrade: { eta: bigint; wasm_hash: unknown } | null;
  pendingStrategy: { eta: bigint; strategy: string | null } | null;
  strategy: string | null;
  position: StrategyPos;
  buffer: BufferCfg;
  /** DeFindex-side truth, when a strategy with a position exists. */
  defindexShares: bigint | null;
  defindexAssets: bigint | null;
};

export type InvariantFinding = {
  id: 'I2' | 'I3' | 'I4' | 'I5' | 'I8' | 'I9';
  severity: 'critical' | 'high' | 'medium';
  message: string;
};

const DRIFT_ALERT_BPS = 20n;
const STALE_SYNC_SECS = 3600n;

/** Pure: evaluate the invariants of a snapshot against the previous share price. */
export function evaluateInvariants(
  s: VaultSnapshot,
  previousPrice: number | null,
): InvariantFinding[] {
  const out: InvariantFinding[] = [];
  const price = s.totalSupply > 0n ? Number(s.totalAssets) / Number(s.totalSupply) : null;

  // I2 — share price dropped since the last sample (a write-off or a short
  // strategy delivery explain it; anything else is a bug).
  if (price != null && previousPrice != null && price < previousPrice) {
    const dropBps = Math.round(((previousPrice - price) / previousPrice) * 10_000);
    out.push({
      id: 'I2',
      severity: 'critical',
      message: `share price dropped ${dropBps} bps (${previousPrice} -> ${price})`,
    });
  }

  if (s.strategy && s.position.shares > 0n) {
    // I4 — cached shares must equal what DeFindex says we hold.
    if (s.defindexShares != null && s.defindexShares !== s.position.shares) {
      out.push({
        id: 'I4',
        severity: 'critical',
        message: `cached strategy shares ${s.position.shares} != DeFindex balance ${s.defindexShares}`,
      });
    }
    // I3 — cached assets drift vs a fresh DeFindex valuation, or a stale sync.
    if (s.defindexAssets != null && s.position.assets > 0n) {
      const diff = s.defindexAssets > s.position.assets
        ? s.defindexAssets - s.position.assets
        : s.position.assets - s.defindexAssets;
      const driftBps = (diff * 10_000n) / s.position.assets;
      if (driftBps > DRIFT_ALERT_BPS) {
        out.push({
          id: 'I3',
          severity: 'high',
          message: `strategy cache drift ${driftBps} bps (cached ${s.position.assets}, fresh ${s.defindexAssets})`,
        });
      }
    }
    const age = BigInt(s.at) - s.position.last_sync;
    if (s.position.last_sync > 0n && age > STALE_SYNC_SECS) {
      out.push({ id: 'I3', severity: 'high', message: `last strategy sync ${age}s ago` });
    }
    // I5 — idle (net of accrued protocol fees, which the contract never lends
    // nor counts) below the target the admin configured.
    const available = s.cash - s.feesAccrued;
    if (s.buffer.tranche > 0n && available < s.buffer.idle_target) {
      out.push({
        id: 'I5',
        severity: 'medium',
        message: `idle cash ${available} (balance ${s.cash} - fees ${s.feesAccrued}) below target ${s.buffer.idle_target}`,
      });
    }
  }

  if (s.paused) {
    out.push({ id: 'I8', severity: 'high', message: 'vault is PAUSED' });
  }
  if (s.pendingUpgrade) {
    out.push({
      id: 'I9',
      severity: 'high',
      message: `upgrade proposed, executable at ${s.pendingUpgrade.eta}`,
    });
  }
  if (s.pendingStrategy) {
    out.push({
      id: 'I9',
      severity: 'high',
      message: `strategy change proposed (${s.pendingStrategy.strategy ?? 'remove'}), executable at ${s.pendingStrategy.eta}`,
    });
  }
  return out;
}

export type KeeperAction = 'sync' | 'rebalance';

/**
 * Pure: which keeper writes are worth sending. `simulatedMove` is the result
 * of simulating `rebalance` (0 = nothing to do). A sync is sent when there is
 * a position (it is cheap and keeps the share price honest); a rebalance only
 * when the simulation says it would move funds.
 */
export function decideKeeperActions(
  s: Pick<VaultSnapshot, 'strategy' | 'position' | 'buffer' | 'paused'>,
  simulatedMove: bigint,
): KeeperAction[] {
  if (!s.strategy || s.buffer.tranche <= 0n) return [];
  const actions: KeeperAction[] = [];
  if (s.position.shares > 0n) actions.push('sync');
  // Investing is blocked while paused; pulling back is not (the contract decides),
  // the simulation already reflects that: a 0 means skip.
  if (simulatedMove !== 0n) actions.push('rebalance');
  return actions;
}

@Injectable()
export class VaultKeeperService {
  private readonly logger = new Logger(VaultKeeperService.name);
  private previousPrice: number | null = null;

  async snapshot(): Promise<VaultSnapshot> {
    const [totalAssets, totalSupply, paused, pendingUpgrade, pendingStrategy, strategy, position, buffer, cash, feesAccrued] =
      await Promise.all([
        simulateVaultCall<bigint>('total_assets'),
        simulateVaultCall<bigint>('total_supply'),
        simulateVaultCall<boolean>('is_paused'),
        simulateVaultCall<VaultSnapshot['pendingUpgrade']>('pending_upgrade'),
        simulateVaultCall<VaultSnapshot['pendingStrategy']>('pending_strategy'),
        simulateVaultCall<string | null>('strategy'),
        simulateVaultCall<StrategyPos>('strategy_position'),
        simulateVaultCall<BufferCfg>('buffer'),
        simulateContractCall<bigint>(SOROBAN_USDC_SAC, 'balance', [scAddress(SOROBAN_VAULT)]),
        simulateVaultCall<bigint>('fees_accrued'),
      ]);
    let defindexShares: bigint | null = null;
    let defindexAssets: bigint | null = null;
    if (strategy && position.shares > 0n) {
      try {
        defindexShares = await simulateContractCall<bigint>(strategy, 'balance', [scAddress(SOROBAN_VAULT)]);
        const amounts = await simulateContractCall<bigint[]>(strategy, 'get_asset_amounts_per_shares', [
          scI128(position.shares),
        ]);
        defindexAssets = amounts?.[0] ?? null;
      } catch (e) {
        this.logger.warn(`[VaultInvariants] DeFindex read failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      }
    }
    return {
      at: Math.floor(Date.now() / 1000),
      totalAssets,
      totalSupply,
      cash,
      feesAccrued,
      paused,
      pendingUpgrade: pendingUpgrade ?? null,
      pendingStrategy: pendingStrategy ?? null,
      strategy: strategy ?? null,
      position,
      buffer,
      defindexShares,
      defindexAssets,
    };
  }

  /** `vault-invariants` job: read, evaluate, warn. Never writes. */
  async checkInvariants(): Promise<InvariantFinding[]> {
    const s = await this.snapshot();
    const findings = evaluateInvariants(s, this.previousPrice);
    this.previousPrice = s.totalSupply > 0n ? Number(s.totalAssets) / Number(s.totalSupply) : this.previousPrice;
    for (const f of findings) {
      const line = `[VaultInvariant:${f.id}][${f.severity}] ${f.message}`;
      if (f.severity === 'critical') this.logger.error(line);
      else this.logger.warn(line);
      try {
        Sentry.captureMessage(line, f.severity === 'critical' ? 'error' : 'warning');
      } catch {
        /* Sentry not configured */
      }
    }
    if (findings.length === 0) {
      this.logger.log(
        `[VaultInvariants] ok: ta=${s.totalAssets} ts=${s.totalSupply} cash=${s.cash} fees=${s.feesAccrued} strat=${s.position.assets}`,
      );
    }
    return findings;
  }

  /** `strategy-keeper` job: sync the position and move one tranche if the policy asks. */
  async runStrategyKeeper(): Promise<void> {
    if (process.env.VAULT_KEEPER_ENABLED !== 'true') return;
    const s = await this.snapshot();
    let simulatedMove = 0n;
    if (s.strategy && s.buffer.tranche > 0n) {
      try {
        simulatedMove = (await simulateVaultCall<bigint>('rebalance')) ?? 0n;
      } catch (e) {
        // A paused vault (push branch) or a DeFindex outage surfaces here; log, skip.
        this.logger.warn(`[StrategyKeeper] rebalance simulation: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      }
    }
    const actions = decideKeeperActions(s, simulatedMove);
    for (const a of actions) {
      if (a === 'sync') {
        await sendVaultCall('sync_strategy', [], 'strategy-keeper:sync');
      } else {
        await sendVaultCall('rebalance', [], 'strategy-keeper:rebalance');
        this.logger.log(`[StrategyKeeper] rebalance moved ${simulatedMove} (positive = into DeFindex)`);
      }
    }
    if (actions.length === 0) {
      this.logger.debug?.('[StrategyKeeper] nothing to do');
    }
  }
}
