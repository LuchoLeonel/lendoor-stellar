import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 064 — Voice Collections Orchestration.
 *
 * Cachear el estado on-chain de mora en cada loan abierto para que el
 * voice-agent y el orchestrator NO tengan que hacer RPC al Forno en
 * runtime. Sin esto, cada llamada outbound dispararía 2-3 RPCs por
 * deudor (premiums, gracePeriod, preflightRepayment) y saturaríamos
 * Forno gratuito al escalar a 200 deudores por batch.
 *
 * Las 3 columnas las populiza chain-sync cada 10 minutos:
 *   - lateRatePerSecWad: lectura de `premiums(addr).lateRatePerSecWad`
 *   - gracePeriodSec: lectura de `loans(addr).gracePeriod`
 *   - lateFeesCurrentUsd: calculado en TS via LoanCalculationsService
 *     usando el ratePerSecWad + dueAt + amountDueAtOpen.
 *
 * En runtime el orchestrator/voice-agent leen DIRECTAMENTE de estas
 * columnas via GET /collections/loans/:id/context. Sin RPC.
 *
 * Trade-off aceptado: las columnas pueden estar hasta 10 minutos
 * desactualizadas. Para late fees (que cambian segundo a segundo) el
 * error es <0.05% al ratePerSec actual (0.167%/día). Trivial para
 * piloto 0-15 días overdue.
 */
export class AddLateFeesSnapshotToLoans20260518100100
  implements MigrationInterface
{
  name = 'AddLateFeesSnapshotToLoans20260518100100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `lateRatePerSecWad` viene del contract como uint128 WAD (1e18).
    // Usamos NUMERIC(40,0) para almacenar el bigint sin pérdida.
    await queryRunner.query(`
      ALTER TABLE "loans"
        ADD COLUMN IF NOT EXISTS "lateRatePerSecWad" NUMERIC(40,0)
    `);

    // `gracePeriod` viene del contract como uint32 (segundos).
    // Default 86400 (24h) = LoanManagerV3.defaultGracePeriod.
    await queryRunner.query(`
      ALTER TABLE "loans"
        ADD COLUMN IF NOT EXISTS "gracePeriodSec" INT
    `);

    // Snapshot del cálculo offline al momento del último chain-sync.
    // El orchestrator lee este valor y lo refresca con LoanCalculationsService
    // antes del dispatch para tener precisión al segundo.
    await queryRunner.query(`
      ALTER TABLE "loans"
        ADD COLUMN IF NOT EXISTS "lateFeesCurrentUsd" NUMERIC(18,2)
    `);

    // Cuándo se calculó esto. Útil para detectar staleness >10min.
    await queryRunner.query(`
      ALTER TABLE "loans"
        ADD COLUMN IF NOT EXISTS "lateFeesSnapshotAt" TIMESTAMPTZ
    `);

    // Index para que eligible-for-call filtre rápido por loans con
    // overdue >0 (dueAt < now AND lateFeesCurrentUsd > 0).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_due_late_fees"
        ON "loans" ("dueAt", "lateFeesCurrentUsd")
        WHERE "status" = 'open'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_loans_due_late_fees"`);
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN IF EXISTS "lateFeesSnapshotAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN IF EXISTS "lateFeesCurrentUsd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN IF EXISTS "gracePeriodSec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN IF EXISTS "lateRatePerSecWad"`,
    );
  }
}
