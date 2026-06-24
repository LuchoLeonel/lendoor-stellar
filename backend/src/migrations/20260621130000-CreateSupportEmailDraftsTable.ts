import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 082 — Email Operator Dashboard (Phase 3 — AI draft layer).
 *
 * Creates the `support_email_drafts` table. One row per Claude-generated
 * draft, used for token/cost audit (mirrors the voice AI call pattern).
 *
 * Additive / idempotent: uses CREATE TABLE IF NOT EXISTS and
 * CREATE INDEX IF NOT EXISTS so it is safe to re-run.
 *
 * Indexes:
 *   - (emailId): look up all drafts for a given support email.
 */
export class CreateSupportEmailDraftsTable20260621130000
  implements MigrationInterface
{
  name = 'CreateSupportEmailDraftsTable20260621130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_email_drafts" (
        "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Reference to the inbound email that was drafted for
        "emailId"        UUID         NOT NULL,

        -- AI-generated draft text (post-linted)
        "draftText"      TEXT         NOT NULL,

        -- Operator instruction for regeneration requests (NULL on first generation)
        "operatorPrompt" TEXT,

        -- Anthropic model used
        "model"          VARCHAR(64)  NOT NULL,

        -- Token usage for cost auditing
        "inputTokens"    INTEGER      NOT NULL,
        "outputTokens"   INTEGER      NOT NULL,

        "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_email_drafts_email_id"
        ON "support_email_drafts" ("emailId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_email_drafts_email_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_email_drafts"`);
  }
}
