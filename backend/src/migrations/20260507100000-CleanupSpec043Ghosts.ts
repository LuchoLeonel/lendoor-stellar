import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 048 — Cleanup of 10 phantom rows produced by spec 043 reset.
 *
 * Background (verified on-chain 2026-05-07): spec 043's reset of 16
 * duplicate-`closeTxHash` rows successfully recovered 6 via chain-sync,
 * but left 10 rows stuck in `status=defaulted/defaulted_in_grace` with
 * `closeTxHash=NULL, amountPaid=0` because those rows never had a real
 * on-chain `LoanClosed` event (they were artifacts of the historic
 * orphan-auto-close path in `loan.service.ts:557-569`).
 *
 * Audit findings (full universe, 866 loans defaulted/in_grace open):
 *   - Real debt (DB matches chain):  856
 *   - Ghost stuck (this spec):        10  ← all in `audit_logs.action='PHANTOM_LOAN_RESET_SPEC_043'`
 *   - Ghost outside spec 043:          0  ← bug fully contained
 *
 * The 10 stuck rows triggered `loan_defaulted` weekly emails on
 * 2026-05-05 to 9 wallets (one wallet had 2 phantom rows). This
 * migration restores their pre-spec-043 state so the cron stops
 * matching them.
 *
 * Restoration uses the `audit_logs` snapshot saved by spec 043
 * (`metadata.status_before`, `metadata.amountPaid_before`,
 * `metadata.closedAt_before`). The original `closeTxHash` is NOT
 * restored because spec 043 added a UNIQUE partial index — the
 * original was a duplicate. Instead, a synthetic unique-per-id value
 * `SPEC_048_GHOST_RESTORED_<id>` is written to keep the row out of
 * the cron filter while remaining audit-traceable.
 *
 * No backend code changes, no frontend, no contract. Pure DB cleanup.
 */
export class CleanupSpec043Ghosts20260507100000
  implements MigrationInterface
{
  name = 'CleanupSpec043Ghosts20260507100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: restore the 10 phantom rows from audit_logs snapshot.
    // The WHERE clauses target ONLY rows that:
    //   (a) have a spec 043 audit_log entry, and
    //   (b) are still in defaulted/defaulted_in_grace with closeTxHash NULL.
    // This is the precise universe of "stuck phantom" loans.
    const result = (await queryRunner.query(`
      UPDATE loans l
         SET status = (al.metadata->>'status_before')::loans_status_enum,
             "amountPaid" = COALESCE((al.metadata->>'amountPaid_before')::decimal, 0),
             "closeTxHash" = 'SPEC_048_GHOST_RESTORED_' || l.id::text,
             "closedAt" = COALESCE(
               (al.metadata->>'closedAt_before')::timestamptz,
               l."dueAt"
             ),
             "repaidOnTime" = ((al.metadata->>'status_before') = 'repaid_on_time'),
             "syncedByChain" = false
        FROM audit_logs al
       WHERE al.action = 'PHANTOM_LOAN_RESET_SPEC_043'
         AND (al.metadata->>'loan_id')::int = l.id
         AND l.status IN ('defaulted','defaulted_in_grace')
         AND l."closeTxHash" IS NULL
      RETURNING l.id
    `)) as Array<{ id: number }>;

    const cleaned = Array.isArray(result) ? result.length : 0;
    console.log(
      `[CleanupSpec043Ghosts] restored ${cleaned} phantom loans from spec 043 audit_logs`,
    );

    // Step 2: write an audit_logs entry per restored row, for full traceability.
    if (cleaned > 0) {
      await queryRunner.query(`
        INSERT INTO audit_logs (action, "walletAddress", "userId", metadata, "createdAt")
        SELECT
          'CLEANUP_SPEC_043_GHOST_SPEC_048',
          l."borrowerAddress",
          l."userId",
          jsonb_build_object(
            'loan_id', l.id,
            'restored_status', l.status,
            'restored_amountPaid', l."amountPaid",
            'synthetic_closeTxHash', l."closeTxHash",
            'pre_cleanup_was_defaulted', true,
            'spec_043_audit_log_id', al.id
          ),
          NOW()
        FROM loans l
        JOIN audit_logs al ON al.action = 'PHANTOM_LOAN_RESET_SPEC_043'
                          AND (al.metadata->>'loan_id')::int = l.id
       WHERE l."closeTxHash" LIKE 'SPEC_048_GHOST_RESTORED_%'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert the 10 cleaned rows to their post-spec-043 state
    // (status='defaulted', amountPaid=0, closeTxHash=NULL).
    await queryRunner.query(`
      UPDATE loans l
         SET status = 'defaulted'::loans_status_enum,
             "amountPaid" = 0,
             "closeTxHash" = NULL,
             "closedAt" = l."dueAt",
             "repaidOnTime" = false,
             "syncedByChain" = false
       WHERE l."closeTxHash" LIKE 'SPEC_048_GHOST_RESTORED_%'
    `);
    await queryRunner.query(`
      DELETE FROM audit_logs WHERE action = 'CLEANUP_SPEC_043_GHOST_SPEC_048'
    `);
  }
}
