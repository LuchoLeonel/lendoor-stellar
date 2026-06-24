import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mora cobrada persistida per-loan.
 *
 * Hasta ahora la "mora cobrada" del dashboard se computaba inline en cada
 * request del admin overview (admin.service.ts:104) y en el cohort view
 * propuesto. Persistir el valor en la fila del loan permite:
 *   - sumas O(N) en lugar de filter-and-compute O(N) por request
 *   - cohort views (byClosedMonth + byOriginationMonth) sin lógica condicional
 *   - histórico inmutable: el valor queda fijado al cierre del loan
 *
 * Definición (mirrors admin overview formula):
 *   lateFeesCollectedUsd = amountPaid - amountDueAtOpen
 *     IF status='repaid_late' AND closedAt - dueAt > 24h AND amountPaid > amountDueAtOpen
 *   ELSE NULL (open/in_grace/defaulted) or 0 (repaid_on_time, repaid_late inside grace)
 *
 * NULL = "loan no cerrado todavía". 0 = "cerrado sin mora cobrada".
 *
 * Backfill histórico va en una migración separada para mantener separadas
 * las DDL de las DML. Re-runs idempotentes en ambas.
 */
export class AddLateFeesCollectedUsdToLoans20260519000000
  implements MigrationInterface
{
  name = 'AddLateFeesCollectedUsdToLoans20260519000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loans"
        ADD COLUMN IF NOT EXISTS "lateFeesCollectedUsd" NUMERIC(18,2)
    `);

    // Helpful for the cohort SUM queries that filter on closedAt month.
    // Partial index — only repaid loans contribute to mora cobrada.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_late_fees_collected"
        ON "loans" ("closedAt")
        WHERE "lateFeesCollectedUsd" IS NOT NULL
          AND "lateFeesCollectedUsd" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_loans_late_fees_collected"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN IF EXISTS "lateFeesCollectedUsd"`,
    );
  }
}
