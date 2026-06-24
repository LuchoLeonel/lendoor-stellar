import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 043 — Defense in depth: a UNIQUE index on loans.closeTxHash so the
 * DB itself rejects any future duplicate (PG error 23505) regardless of
 * application-layer bugs.
 *
 * Partial index (`WHERE "closeTxHash" IS NOT NULL`) so loans not yet
 * reconciled (NULL closeTxHash) don't conflict with each other.
 *
 * Must run AFTER 20260506000000-ResetDuplicateCloseTxHash so existing
 * duplicates are gone before the index is created.
 */
export class AddCloseTxHashUniqueIndex20260506000100
  implements MigrationInterface
{
  name = 'AddCloseTxHashUniqueIndex20260506000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_loans_closeTxHash"
      ON loans ("closeTxHash")
      WHERE "closeTxHash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_loans_closeTxHash"
    `);
  }
}
