import {
  decideKeeperActions,
  evaluateInvariants,
  type VaultSnapshot,
} from './vault-keeper.service';

const base = (over: Partial<VaultSnapshot> = {}): VaultSnapshot => ({
  at: 1_800_000_000,
  totalAssets: 110_000_000n, // 11 USDC
  totalSupply: 110_000_000_000n, // ×1000 share units (offset 3)
  cash: 20_000_000n,
  paused: false,
  pendingUpgrade: null,
  pendingStrategy: null,
  strategy: 'CDEFINDEX',
  position: { shares: 90_000_000n, assets: 90_000_000n, last_sync: 1_800_000_000n - 60n },
  buffer: { idle_target: 20_000_000n, tranche: 30_000_000n, min_out_bps: 9_900 },
  defindexShares: 90_000_000n,
  defindexAssets: 90_000_000n,
  ...over,
});

describe('evaluateInvariants', () => {
  it('is quiet on a healthy snapshot', () => {
    expect(evaluateInvariants(base(), 0.001)).toEqual([]);
  });

  it('I2: flags a share-price drop against the previous sample', () => {
    const f = evaluateInvariants(base({ totalAssets: 109_000_000n }), 0.001);
    expect(f.map((x) => x.id)).toContain('I2');
    expect(f.find((x) => x.id === 'I2')?.severity).toBe('critical');
  });

  it('I2: a higher price is not an alert', () => {
    expect(evaluateInvariants(base({ totalAssets: 111_000_000n }), 0.001)).toEqual([]);
  });

  it('I3: cache drift above 20 bps and stale syncs', () => {
    const drift = evaluateInvariants(base({ defindexAssets: 90_300_000n }), null); // +33 bps
    expect(drift.map((x) => x.id)).toEqual(['I3']);
    const fine = evaluateInvariants(base({ defindexAssets: 90_100_000n }), null); // +11 bps
    expect(fine).toEqual([]);
    const stale = evaluateInvariants(
      base({ position: { shares: 90_000_000n, assets: 90_000_000n, last_sync: 1_800_000_000n - 7200n } }),
      null,
    );
    expect(stale.map((x) => x.message)).toEqual([expect.stringContaining('last strategy sync')]);
  });

  it('I4: cached shares must match the DeFindex balance', () => {
    const f = evaluateInvariants(base({ defindexShares: 89_000_000n }), null);
    expect(f.map((x) => x.id)).toEqual(['I4']);
  });

  it('I5: idle below target only when routing is enabled', () => {
    expect(evaluateInvariants(base({ cash: 10_000_000n }), null).map((x) => x.id)).toEqual(['I5']);
    expect(
      evaluateInvariants(
        base({ cash: 10_000_000n, buffer: { idle_target: 20_000_000n, tranche: 0n, min_out_bps: 10_000 } }),
        null,
      ),
    ).toEqual([]);
  });

  it('I8/I9: paused and pending governance are surfaced', () => {
    const f = evaluateInvariants(
      base({
        paused: true,
        pendingUpgrade: { eta: 1n, wasm_hash: 'x' },
        pendingStrategy: { eta: 2n, strategy: null },
      }),
      null,
    );
    expect(f.map((x) => x.id).sort()).toEqual(['I8', 'I9', 'I9']);
  });

  it('without a strategy only governance and price checks apply', () => {
    const f = evaluateInvariants(
      base({ strategy: null, position: { shares: 0n, assets: 0n, last_sync: 0n }, cash: 1n }),
      null,
    );
    expect(f).toEqual([]);
  });
});

describe('decideKeeperActions', () => {
  it('does nothing without a strategy or with routing disabled', () => {
    expect(decideKeeperActions(base({ strategy: null }), 30_000_000n)).toEqual([]);
    expect(
      decideKeeperActions(base({ buffer: { idle_target: 1n, tranche: 0n, min_out_bps: 10_000 } }), 30_000_000n),
    ).toEqual([]);
  });

  it('syncs when there is a position and rebalances only when the simulation moves funds', () => {
    expect(decideKeeperActions(base(), 0n)).toEqual(['sync']);
    expect(decideKeeperActions(base(), 30_000_000n)).toEqual(['sync', 'rebalance']);
    expect(decideKeeperActions(base(), -10_000_000n)).toEqual(['sync', 'rebalance']);
  });

  it('with an empty position it only rebalances when there is something to push', () => {
    const empty = base({ position: { shares: 0n, assets: 0n, last_sync: 0n } });
    expect(decideKeeperActions(empty, 0n)).toEqual([]);
    expect(decideKeeperActions(empty, 30_000_000n)).toEqual(['rebalance']);
  });
});
