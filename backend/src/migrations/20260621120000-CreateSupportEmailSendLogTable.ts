import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 082 — Email Operator Dashboard (Phase 2).
 *
 * Creates the `support_email_send_log` table. One row per outbound reply
 * attempt, whether it succeeded (status='sent') or failed (status='failed').
 *
 * This table is append-only: it is never updated after insert. It exists
 * purely as an audit trail for every real email sent to a user.
 *
 * Indexes:
 *   - (emailId): look up all send attempts for a given support email.
 */
export class CreateSupportEmailSendLogTable20260621120000
  implements MigrationInterface
{
  name = 'CreateSupportEmailSendLogTable20260621120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_email_send_log" (
        "id"            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Reference to the inbound email that was replied to
        "emailId"       UUID        NOT NULL,

        -- Outbound message fields
        "toAddress"     TEXT        NOT NULL,
        "subject"       TEXT        NOT NULL,
        "bodySent"      TEXT        NOT NULL,

        -- Operator who sent
        "sentByWallet"  TEXT,

        -- Timing
        "sentAt"        TIMESTAMPTZ NOT NULL,

        -- SMTP result
        "smtpMessageId" VARCHAR(500),
        "status"        VARCHAR(20) NOT NULL,
        "failureReason" TEXT,

        "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_send_log_email_id"
        ON "support_email_send_log" ("emailId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_send_log_email_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_email_send_log"`);
  }
}
