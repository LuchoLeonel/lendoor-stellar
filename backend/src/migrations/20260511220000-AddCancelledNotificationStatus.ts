import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 053 — adds 'cancelled' value to notifications_status_enum.
 *
 * Used by NotificationStateService.cancelPendingForLoan to mark
 * notifications that were queued before the underlying loan closed.
 * This is distinct from FAILED (which implies a real send attempt)
 * and PENDING (which implies the cron will retry).
 *
 * Non-transactional: ALTER TYPE ADD VALUE cannot run inside a transaction.
 * IF NOT EXISTS guard keeps the migration idempotent across re-runs.
 * down() is empty because Postgres cannot easily remove enum values.
 */
export class AddCancelledNotificationStatus20260511220000
  implements MigrationInterface
{
  name = 'AddCancelledNotificationStatus20260511220000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_status_enum') THEN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'notifications_status_enum'
              AND e.enumlabel = 'cancelled'
          ) THEN
            ALTER TYPE "notifications_status_enum"
              ADD VALUE 'cancelled';
          END IF;
        END IF;
      END
      $$;
    `);
  }

  public async down(): Promise<void> {
    // Postgres does not support removing ENUM values cleanly.
    // To roll back, first UPDATE all rows with status='cancelled' to
    // status='failed' (or another valid value), then recreate the enum
    // without 'cancelled'. Operationally risky — left as no-op.
  }
}
