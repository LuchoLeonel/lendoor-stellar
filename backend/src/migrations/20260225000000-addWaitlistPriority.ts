import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds waitlistPriority column to users table.
 * Lower value = higher priority in the waitlist queue.
 * Default 0 for all existing users — no behavior change.
 *
 * When phone verification is added later, unverified users
 * will be set to priority 1, pushing them behind verified ones.
 */
export class AddWaitlistPriority20260225000000 implements MigrationInterface {
  name = 'AddWaitlistPriority20260225000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Add column — DEFAULT 0 is metadata-only in PG 11+, no table rewrite
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "waitlistPriority" INTEGER NOT NULL DEFAULT 0;
    `);

    // 2) Composite index for priority-aware ranking query:
    //    WHERE platform = ? AND (priority < ? OR (priority = ? AND createdAt <= ?))
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_platform_priority_created"
        ON "users" ("platform", "waitlistPriority", "createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_user_platform_priority_created";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "waitlistPriority";
    `);
  }
}
