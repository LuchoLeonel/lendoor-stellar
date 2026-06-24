import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill histórico de `lateFeesCollectedUsd` para loans ya cerrados.
 *
 * Aplica la misma fórmula que `reconcileLoan` y que el admin overview
 * (admin.service.ts:104). Idempotente: solo escribe filas donde el
 * valor todavía es NULL.
 *
 * - repaid_late con closedAt − dueAt > 24h y amountPaid > amountDueAtOpen
 *   → lateFeesCollectedUsd = amountPaid − amountDueAtOpen
 * - resto de loans cerrados (repaid_on_time, repaid_late dentro de gracia,
 *   amountPaid ≤ amountDueAtOpen) → 0
 * - loans aún abiertos (open / in_grace / defaulted con paid=0) → NULL
 *   (no se tocan)
 *
 * Esperado en prod (snapshot 2026-05-19):
 *   ~2,500 filas seteadas a 0 (repaid sin mora)
 *   ~57 filas seteadas a (amountPaid − amountDueAtOpen) ≈ $15.54 total
 */
export class BackfillLateFeesCollectedUsd20260519000100
  implements MigrationInterface
{
  name = 'BackfillLateFeesCollectedUsd20260519000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: loans que califican como "mora cobrada" — paid extra past 24h grace.
    const moraResult = await queryRunner.query(`
      UPDATE loans
         SET "lateFeesCollectedUsd" = "amountPaid" - "amountDueAtOpen"
       WHERE "lateFeesCollectedUsd" IS NULL
         AND status = 'repaid_late'
         AND "closedAt" IS NOT NULL
         AND "closedAt" - "dueAt" > INTERVAL '24 hours'
         AND "amountPaid" > "amountDueAtOpen"
      RETURNING id
    `);
    const moraCount = Array.isArray(moraResult)
      ? Array.isArray(moraResult[0])
        ? moraResult[0].length
        : 0
      : 0;

    // Step 2: resto de cerrados sin mora → 0 (queryable como "cero" vs "sin cerrar todavía").
    const zeroResult = await queryRunner.query(`
      UPDATE loans
         SET "lateFeesCollectedUsd" = 0
       WHERE "lateFeesCollectedUsd" IS NULL
         AND status IN ('repaid_on_time','repaid_late')
         AND "closedAt" IS NOT NULL
    `);
    const zeroCount = Array.isArray(zeroResult) && zeroResult[1] ? zeroResult[1] : 0;

    // eslint-disable-next-line no-console
    console.log(
      `[BackfillLateFeesCollectedUsd] mora set on ${moraCount} loans, zero set on ${zeroCount} loans`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE loans SET "lateFeesCollectedUsd" = NULL WHERE "lateFeesCollectedUsd" IS NOT NULL`,
    );
  }
}
