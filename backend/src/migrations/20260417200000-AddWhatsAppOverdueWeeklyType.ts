import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsAppOverdueWeeklyType20260417200000
  implements MigrationInterface
{
  name = 'AddWhatsAppOverdueWeeklyType20260417200000';
  // Non-transactional: ALTER TYPE ADD VALUE cannot run inside a transaction.
  // The IF NOT EXISTS guard keeps the migration idempotent across re-runs.
  // The down() method is intentionally empty because Postgres cannot remove enum values.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') THEN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'notifications_type_enum'
              AND e.enumlabel = 'wa_loan_overdue_weekly'
          ) THEN
            ALTER TYPE "notifications_type_enum"
              ADD VALUE 'wa_loan_overdue_weekly';
          END IF;
        END IF;
      END
      $$;
    `);
  }

  public async down(): Promise<void> {
    // Postgres does not support removing ENUM values easily.
  }
}
