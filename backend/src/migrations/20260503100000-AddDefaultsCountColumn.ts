import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 038 — adds `users.defaultsCount` integer column.
 *
 * The counter mirrors the criterion used by spec 035's audit:
 *   N = number of loans of this user where status='defaulted' OR
 *       (status='repaid_late' AND closedAt - dueAt >= 16 days).
 *
 * `hadDefaultEver` (spec 034, binary) stays untouched. The counter is
 * additive metadata so the dashboard can distinguish single-defaulters
 * from multi-defaulters without changing existing semantics.
 *
 * Backfill is included so the deploy is atomic — the column is
 * populated when the backend boots with the new code.
 */
export class AddDefaultsCountColumn20260503100000
  implements MigrationInterface
{
  name = 'AddDefaultsCountColumn20260503100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: schema change.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "defaultsCount" INT NOT NULL DEFAULT 0;
    `);

    // Step 2: backfill from loans using the spec 035 criterion.
    const result = await queryRunner.query(`
      UPDATE "users" u
         SET "defaultsCount" = (
           SELECT COUNT(*) FROM "loans" l
            WHERE l."userId" = u.id
              AND (
                l.status = 'defaulted'
                OR (l.status = 'repaid_late' AND l."closedAt" - l."dueAt" >= INTERVAL '16 days')
              )
         )
       WHERE EXISTS (
         SELECT 1 FROM "loans" l
          WHERE l."userId" = u.id
            AND (
              l.status = 'defaulted'
              OR (l.status = 'repaid_late' AND l."closedAt" - l."dueAt" >= INTERVAL '16 days')
            )
       )
       RETURNING id
    `);

    const affected = Array.isArray(result) ? result[0]?.length ?? 0 : 0;
    console.log(
      `[AddDefaultsCountColumn] backfilled defaultsCount for ${affected} users`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "defaultsCount";
    `);
  }
}
