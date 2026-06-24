import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 082 — Email Operator Dashboard (Phase 1).
 *
 * Creates the `support_emails` table. One row per inbound email received at
 * admin@lendoor.xyz via Zoho Mail (IMAP). Synced by EmailSyncService every 3 min.
 *
 * Indexes chosen for the hot reads:
 *   - (status, receivedAt DESC): default dashboard view (unanswered queue, newest first).
 *   - (matchedUserId): look up all emails from a given user.
 *   - (fromAddress): dedupe + user match at sync time.
 *   - (zohoThreadId): threading the reply (Phase 2).
 *   - UNIQUE (zohoMessageId): idempotent upsert / dedupe.
 */
export class CreateSupportEmailsTable20260620120000
  implements MigrationInterface
{
  name = 'CreateSupportEmailsTable20260620120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_emails" (
        "id"              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Zoho identifiers
        "zohoMessageId"   TEXT        NOT NULL,
        "zohoThreadId"    TEXT        NOT NULL,

        -- Addressing
        "fromAddress"     TEXT        NOT NULL,
        "toAddress"       TEXT        NOT NULL,
        "subject"         TEXT        NOT NULL,

        -- Body
        "bodyText"        TEXT        NOT NULL,
        "bodyHtml"        TEXT,

        -- Timing
        "receivedAt"      TIMESTAMPTZ NOT NULL,

        -- State
        "isRead"          BOOLEAN     NOT NULL DEFAULT FALSE,
        "status"          VARCHAR(20) NOT NULL DEFAULT 'unanswered',

        -- User match
        "matchedUserId"   INT,

        -- Answer tracking (Phase 2)
        "answeredAt"      TIMESTAMPTZ,
        "answeredByWallet" TEXT,

        "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Unique constraint for idempotent upsert / dedupe
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_support_emails_zoho_message_id"
        ON "support_emails" ("zohoMessageId")
    `);

    // Default dashboard view: unanswered queue ordered newest-first
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_emails_status_received"
        ON "support_emails" ("status", "receivedAt" DESC)
    `);

    // User context lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_emails_matched_user"
        ON "support_emails" ("matchedUserId")
    `);

    // Sender address lookup at sync time
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_emails_from_address"
        ON "support_emails" ("fromAddress")
    `);

    // Thread lookup for reply (Phase 2)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_emails_zoho_thread"
        ON "support_emails" ("zohoThreadId")
    `);

    // receivedAt standalone for date-range queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_emails_received_at"
        ON "support_emails" ("receivedAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_emails_received_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_emails_zoho_thread"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_emails_from_address"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_emails_matched_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_emails_status_received"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_support_emails_zoho_message_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_emails"`);
  }
}
