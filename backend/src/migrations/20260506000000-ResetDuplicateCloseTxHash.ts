import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 043 — Reset DB rows with duplicate closeTxHash so chain-sync can
 * re-reconcile them under the new logic that prevents duplicate event
 * assignment.
 *
 * Audit 2026-05-05 (prod): 15 closeTxHash values appear in 2-3 DB rows
 * each (16 phantom rows total), inflating Repaid USD by $205 and Interest
 * USD by $12.47 in the admin dashboard.
 *
 * Strategy: instead of DELETE, we NULL the closeTxHash + closedAt and
 * reset status='open' on all rows except the FIRST id in each duplicate
 * group. The chain-sync next cycle re-processes these rows under the new
 * Layer-1/2/3 validations from spec 043. Rows that genuinely closed
 * on-chain get their correct closeTxHash; rows that were orphan-auto-closed
 * (no on-chain event) stay 'open' and chain-sync leaves them untouched.
 *
 * Snapshot to audit_logs first so the prior state is recoverable.
 *
 * Must run BEFORE the AddCloseTxHashUniqueIndex migration (20260506000100).
 */
export class ResetDuplicateCloseTxHash20260506000000
  implements MigrationInterface
{
  name = 'ResetDuplicateCloseTxHash20260506000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Snapshot all duplicate rows to audit_logs (recoverable)
    await queryRunner.query(`
      WITH dups AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY "closeTxHash" ORDER BY id ASC) AS rn
        FROM loans
        WHERE "closeTxHash" IS NOT NULL
          AND "closeTxHash" IN (
            SELECT "closeTxHash" FROM loans
            WHERE "closeTxHash" IS NOT NULL
            GROUP BY "closeTxHash" HAVING COUNT(*) > 1
          )
      )
      INSERT INTO audit_logs (action, "walletAddress", "userId", metadata, "createdAt")
      SELECT
        'PHANTOM_LOAN_RESET_SPEC_043',
        l."borrowerAddress",
        l."userId",
        jsonb_build_object(
          'loan_id', l.id,
          'rn', d.rn,
          'closeTxHash_before', l."closeTxHash",
          'closedAt_before', l."closedAt",
          'amountPaid_before', l."amountPaid",
          'status_before', l.status,
          'principal', l.principal,
          'startAt', l."startAt",
          'dueAt', l."dueAt",
          'openTxHash', l."openTxHash"
        ),
        NOW()
      FROM loans l
      JOIN dups d ON d.id = l.id
      WHERE d.rn > 1
    `);

    // 2. Reset all rn>1 rows back to 'open' so chain-sync re-reconciles
    //    them with the new logic. amountPaid=0, closeTxHash=NULL,
    //    closedAt=NULL, syncedByChain=false → identical state to a row
    //    that hasn't been touched by chain-sync yet.
    const result = (await queryRunner.query(`
      WITH dups AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY "closeTxHash" ORDER BY id ASC) AS rn
        FROM loans
        WHERE "closeTxHash" IS NOT NULL
          AND "closeTxHash" IN (
            SELECT "closeTxHash" FROM loans
            WHERE "closeTxHash" IS NOT NULL
            GROUP BY "closeTxHash" HAVING COUNT(*) > 1
          )
      )
      UPDATE loans
         SET "closeTxHash" = NULL,
             "closedAt"    = NULL,
             "amountPaid"  = 0,
             status        = 'open',
             "repaidOnTime"= false,
             "syncedByChain" = false
       WHERE id IN (SELECT id FROM dups WHERE rn > 1)
      RETURNING id
    `)) as Array<{ id: number }>;

    const reset = Array.isArray(result) ? result.length : 0;
    console.log(
      `[ResetDuplicateCloseTxHash] reset ${reset} loans (snapshot in audit_logs).`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore from audit_logs snapshot. Idempotent: re-applies the
    // pre-spec-043 state to whichever rows still exist.
    await queryRunner.query(`
      UPDATE loans l
         SET "closeTxHash" = (al.metadata->>'closeTxHash_before'),
             "closedAt"    = (al.metadata->>'closedAt_before')::timestamptz,
             "amountPaid"  = (al.metadata->>'amountPaid_before')::decimal,
             status        = (al.metadata->>'status_before')::loans_status_enum,
             "syncedByChain" = true
       FROM audit_logs al
      WHERE al.action = 'PHANTOM_LOAN_RESET_SPEC_043'
        AND (al.metadata->>'loan_id')::int = l.id
    `);

    await queryRunner.query(`
      DELETE FROM audit_logs WHERE action = 'PHANTOM_LOAN_RESET_SPEC_043'
    `);
  }
}
