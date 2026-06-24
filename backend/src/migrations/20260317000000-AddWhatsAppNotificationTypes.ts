import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsAppNotificationTypes20260317000000 implements MigrationInterface {
  name = 'AddWhatsAppNotificationTypes20260317000000';
  // Non-transactional: ALTER TYPE ADD VALUE cannot run inside a transaction.
  // This means a partial failure (e.g., crash after adding wa_loan_due_3d but
  // before wa_loan_overdue) cannot be rolled back automatically.
  // Recovery: re-run the migration — the IF NOT EXISTS guards make it idempotent.
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
              AND e.enumlabel = 'wa_loan_due_3d'
          ) THEN
            ALTER TYPE "notifications_type_enum"
              ADD VALUE 'wa_loan_due_3d';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'notifications_type_enum'
              AND e.enumlabel = 'wa_loan_due_tomorrow'
          ) THEN
            ALTER TYPE "notifications_type_enum"
              ADD VALUE 'wa_loan_due_tomorrow';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'notifications_type_enum'
              AND e.enumlabel = 'wa_loan_due_today'
          ) THEN
            ALTER TYPE "notifications_type_enum"
              ADD VALUE 'wa_loan_due_today';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'notifications_type_enum'
              AND e.enumlabel = 'wa_loan_overdue'
          ) THEN
            ALTER TYPE "notifications_type_enum"
              ADD VALUE 'wa_loan_overdue';
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
