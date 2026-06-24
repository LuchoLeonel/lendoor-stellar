import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDefaultedInGraceEnum20260503000000
  implements MigrationInterface
{
  name = 'AddDefaultedInGraceEnum20260503000000';
  // Postgres `ALTER TYPE ADD VALUE` cannot run inside a transaction.
  // Idempotent via the IF NOT EXISTS / DO $$ guard.
  // The down() is intentionally empty — Postgres has no clean way to drop
  // an enum value, and the value is harmless if unused.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loans_status_enum') THEN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'loans_status_enum'
              AND e.enumlabel = 'defaulted_in_grace'
          ) THEN
            ALTER TYPE "loans_status_enum"
              ADD VALUE 'defaulted_in_grace';
          END IF;
        END IF;
      END
      $$;
    `);
  }

  public async down(): Promise<void> {
    // No-op: Postgres does not support removing enum values cleanly.
  }
}
