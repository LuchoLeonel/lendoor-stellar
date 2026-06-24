import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 011 — one-shot historical backfill of `userId` on analytics tables.
 *
 * Every existing row in `device_sessions` and `borrow_attempts` has userId
 * NULL because controllers never passed it to AnalyticsService. Forward-only
 * fix lives in analytics.service.ts (resolveUserIdByWallet); this migration
 * backfills what's already on disk.
 *
 * Safety:
 * - `users.walletAddress` is 1:1 unique (verified pre-spec: zero duplicates
 *   under LOWER(...)). The JOIN cannot assign the wrong user.
 * - `WHERE "userId" IS NULL` makes this idempotent — re-running is a no-op.
 * - Rows whose wallet has no matching user stay NULL (anonymous / pre-onboarding).
 *
 * Expected on first run (production, 2026-04-19 sample):
 *   device_sessions:  ~5,529 rows updated
 *   borrow_attempts:  ~1,786 rows updated
 */
export class BackfillAnalyticsUserId20260419000000
  implements MigrationInterface
{
  name = 'BackfillAnalyticsUserId20260419000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE device_sessions s
      SET "userId" = u.id
      FROM users u
      WHERE s."userId" IS NULL
        AND s."walletAddress" IS NOT NULL
        AND LOWER(s."walletAddress") = LOWER(u."walletAddress");
    `);

    await queryRunner.query(`
      UPDATE borrow_attempts b
      SET "userId" = u.id
      FROM users u
      WHERE b."userId" IS NULL
        AND b."walletAddress" IS NOT NULL
        AND LOWER(b."walletAddress") = LOWER(u."walletAddress");
    `);
  }

  public async down(): Promise<void> {
    // Intentional no-op. Reverting would destroy the linkage we just built;
    // the "rollback" for this change is reverting the commit that added the
    // forward-only code in analytics.service.ts, not touching this data.
  }
}
