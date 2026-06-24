import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 013 — one-shot backfill of `closedAt` for defaulted loans.
 *
 * Every loan with status='defaulted' has `closedAt IS NULL` because the
 * code paths that mark DEFAULTED (loan-email-notification.service.ts)
 * only wrote `status` and `repaidOnTime = false`. Forward-only fix is in
 * that same service (now sets `closedAt = dueAt`); this migration cleans
 * up the backlog.
 *
 * Resolution timestamp = `dueAt`. This is semantically accurate: a default
 * fires AT the dueAt moment (i.e. when the grace period expires), not when
 * the cron happened to run. Using dueAt instead of NOW() preserves the
 * historical record (the loan "closed" on its due date, not today).
 *
 * Safety:
 * - `WHERE "closedAt" IS NULL` → idempotent. Re-runs do nothing.
 * - `AND status = 'defaulted'` → does not touch non-default loans.
 * - `AND "dueAt" IS NOT NULL` → defensive; every loan has dueAt but we
 *   avoid writing NULL if somehow the invariant is broken on one row.
 * - No status change; only fills in a missing timestamp.
 *
 * Expected on first run (production, 2026-04-20 sample):
 *   794 rows updated.
 *
 * Post-migration invariant:
 *   For every loan with status ∈ ('repaid_on_time','repaid_late','defaulted'),
 *   `closedAt IS NOT NULL`.
 *
 * Any query that filters `WHERE closedAt IS NOT NULL` previously missed
 * defaults. After this migration those defaults are included, which is the
 * desired behaviour for monthly-trend / default-rate reporting.
 */
export class BackfillDefaultedClosedAt20260420000000
  implements MigrationInterface
{
  name = 'BackfillDefaultedClosedAt20260420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const result = await queryRunner.query(`
      UPDATE loans
      SET "closedAt" = "dueAt"
      WHERE status = 'defaulted'
        AND "closedAt" IS NULL
        AND "dueAt" IS NOT NULL
    `);
    const affected = Array.isArray(result) && result[1] ? result[1] : result;
    // eslint-disable-next-line no-console
    console.log(
      `[BackfillDefaultedClosedAt] rows affected:`,
      affected,
    );
  }

  public async down(): Promise<void> {
    // No-op — reverting would re-introduce the data-integrity bug that this
    // migration exists to fix. If an operator genuinely needs to undo this,
    // they can run manually:
    //   UPDATE loans SET "closedAt" = NULL
    //   WHERE status = 'defaulted' AND "closedAt" = "dueAt";
  }
}
