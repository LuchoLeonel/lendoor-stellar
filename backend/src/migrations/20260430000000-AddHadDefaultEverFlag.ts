import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 034 — adds `users.hadDefaultEver` boolean flag.
 *
 * The flag is the post-default penalty gating signal. Once a user's loan
 * passed the 16-day default window AND was eventually repaid, this flag
 * becomes `true` permanently. The risk policy uses it to decide whether
 * to apply the comeback-loan penalty (vs the count of REPAID_LATE
 * loans, which mixed pre- and post-default repays into the same bucket).
 *
 * Backfill of historical data is done in step 2: any user who has at
 * least one loan with `closedAt > dueAt + 16 days` gets `hadDefaultEver
 * = true`. This is run as part of the migration so the deploy is
 * atomic — code expects the column populated.
 */
export class AddHadDefaultEverFlag20260430000000
  implements MigrationInterface
{
  name = 'AddHadDefaultEverFlag20260430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: schema change.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "hadDefaultEver" BOOLEAN NOT NULL DEFAULT false;
    `);

    // Step 2: backfill — users with at least one post-default repay in
    // their history get the flag set. Done inside the migration so the
    // deploy doesn't expose a window where the flag is wrong.
    await queryRunner.query(`
      UPDATE "users"
      SET "hadDefaultEver" = true
      WHERE id IN (
        SELECT DISTINCT "userId"
        FROM "loans"
        WHERE "closedAt" IS NOT NULL
          AND "closedAt" > "dueAt" + INTERVAL '16 days'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "hadDefaultEver";
    `);
  }
}
