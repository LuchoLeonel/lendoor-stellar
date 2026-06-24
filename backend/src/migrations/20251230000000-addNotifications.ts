import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoanDefaultedWeeklyReminder20251230000000 implements MigrationInterface {
  name = 'AddLoanDefaultedWeeklyReminder20251230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        -- Si existe el enum, agregamos el valor si aún no está
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') THEN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'notifications_type_enum'
              AND e.enumlabel = 'loan_defaulted_weekly_reminder'
          ) THEN
            ALTER TYPE "notifications_type_enum"
              ADD VALUE 'loan_defaulted_weekly_reminder';
          END IF;
        END IF;
      END
      $$;
    `);
  }

  public async down(): Promise<void> {
    // Postgres no soporta remover valores de ENUM fácilmente.
  }
}
