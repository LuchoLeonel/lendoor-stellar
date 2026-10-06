import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checklist 003 §4 ítem 1.4 (hard-fail #2 de specs/005) — espejo de
 * 20260506000100-AddCloseTxHashUniqueIndex: UNIQUE parcial sobre
 * loans.openTxHash para que la DB misma rechace duplicados (PG 23505)
 * sin importar bugs de capa de aplicación. `insertMissingLoan` era
 * read-then-write y un comentario afirmaba que este índice ya existía;
 * no existía (verificado contra la entity, initCoreSchema y las 54
 * migraciones previas el 2026-10-05).
 *
 * Índice parcial (`WHERE "openTxHash" IS NOT NULL`) para que los loans
 * sin hash (NULL) no conflictúen entre sí.
 *
 * Paso previo de higiene en la MISMA migración (corre en una sola tx,
 * migrationsTransactionMode:'each'): si algún openTxHash quedó duplicado
 * por la carrera histórica, se snapshotea a audit_logs y se NULLea en
 * todas las filas menos la primera (id más bajo), para que el CREATE
 * UNIQUE INDEX no reviente el boot. No se tocan status ni montos: a
 * diferencia de los closeTxHash fantasma (spec 043), acá solo se
 * desambigua la columna del hash y las filas quedan para triage.
 */
export class AddOpenTxHashUniqueIndex20261005120000
  implements MigrationInterface
{
  name = 'AddOpenTxHashUniqueIndex20261005120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Snapshot de duplicados (recuperable desde audit_logs)
    await queryRunner.query(`
      WITH dups AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY "openTxHash" ORDER BY id ASC) AS rn
        FROM loans
        WHERE "openTxHash" IS NOT NULL
          AND "openTxHash" IN (
            SELECT "openTxHash" FROM loans
            WHERE "openTxHash" IS NOT NULL
            GROUP BY "openTxHash" HAVING COUNT(*) > 1
          )
      )
      INSERT INTO audit_logs (action, "walletAddress", "userId", metadata, "createdAt")
      SELECT
        'DUP_OPEN_TXHASH_NULLED_CHECKLIST_003',
        l."borrowerAddress",
        l."userId",
        jsonb_build_object(
          'loan_id', l.id,
          'rn', d.rn,
          'openTxHash_before', l."openTxHash",
          'status', l.status,
          'principal', l.principal,
          'startAt', l."startAt"
        ),
        NOW()
      FROM loans l
      JOIN dups d ON d.id = l.id
      WHERE d.rn > 1
    `);

    // 2. NULLear el hash duplicado en rn>1 (la primera fila lo conserva)
    await queryRunner.query(`
      WITH dups AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY "openTxHash" ORDER BY id ASC) AS rn
        FROM loans
        WHERE "openTxHash" IS NOT NULL
          AND "openTxHash" IN (
            SELECT "openTxHash" FROM loans
            WHERE "openTxHash" IS NOT NULL
            GROUP BY "openTxHash" HAVING COUNT(*) > 1
          )
      )
      UPDATE loans
         SET "openTxHash" = NULL
       WHERE id IN (SELECT id FROM dups WHERE rn > 1)
    `);

    // 3. El índice — espejo exacto de uq_loans_closeTxHash
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_loans_openTxHash"
      ON loans ("openTxHash")
      WHERE "openTxHash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_loans_openTxHash"
    `);
    // Restaurar los hashes NULLeados desde el snapshot
    await queryRunner.query(`
      UPDATE loans l
         SET "openTxHash" = (al.metadata->>'openTxHash_before')
       FROM audit_logs al
      WHERE al.action = 'DUP_OPEN_TXHASH_NULLED_CHECKLIST_003'
        AND (al.metadata->>'loan_id')::int = l.id
    `);
    await queryRunner.query(`
      DELETE FROM audit_logs WHERE action = 'DUP_OPEN_TXHASH_NULLED_CHECKLIST_003'
    `);
  }
}
