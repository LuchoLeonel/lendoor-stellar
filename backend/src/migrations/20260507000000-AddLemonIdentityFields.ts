import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 044 — Lemon SDK identity backfill (Phase A).
 *
 * Adds 6 columns to `users` to capture identity claims granted via
 * `lemonAuthenticate({ requirements: { claims } })` (SDK 0.1.15+):
 *   - lemonTag (unique partial index)
 *   - pep (nullable boolean: NULL = not asked, true/false = asked)
 *   - lemonCountry (separate from `nationality` which comes from Self KYC)
 *   - lemonAuthenticatedAt
 *   - identityCrossCheckedAt
 *   - identityMatchScore (0-100 confidence Lemon vs Self)
 *
 * Existing firstName/lastName/email columns are reused — backend logic
 * decides precedence (Self KYC > Lemon claims; never overwrites filled
 * fields with empty Lemon values).
 */
export class AddLemonIdentityFields20260507000000
  implements MigrationInterface
{
  name = 'AddLemonIdentityFields20260507000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "lemonTag" VARCHAR(64) NULL,
        ADD COLUMN IF NOT EXISTS "pep" BOOLEAN NULL,
        ADD COLUMN IF NOT EXISTS "lemonCountry" VARCHAR(3) NULL,
        ADD COLUMN IF NOT EXISTS "lemonAuthenticatedAt" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "identityCrossCheckedAt" TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS "identityMatchScore" SMALLINT NULL
    `);

    // Partial unique so multiple users with NULL lemonTag don't collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_lemonTag"
        ON "users" ("lemonTag")
        WHERE "lemonTag" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_user_lemonTag"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "identityMatchScore",
        DROP COLUMN IF EXISTS "identityCrossCheckedAt",
        DROP COLUMN IF EXISTS "lemonAuthenticatedAt",
        DROP COLUMN IF EXISTS "lemonCountry",
        DROP COLUMN IF EXISTS "pep",
        DROP COLUMN IF EXISTS "lemonTag"
    `);
  }
}
