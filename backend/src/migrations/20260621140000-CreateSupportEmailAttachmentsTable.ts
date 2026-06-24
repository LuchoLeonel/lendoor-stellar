import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 082 — Email Operator Dashboard (attachments).
 *
 * Creates `support_email_attachments`: one row per attachment parsed from an
 * inbound support email. Bytes live in S3 (bucket `lendoor-emails`); this table
 * stores only metadata + the S3 location (s3Bucket/s3Key).
 */
export class CreateSupportEmailAttachmentsTable20260621140000
  implements MigrationInterface
{
  name = 'CreateSupportEmailAttachmentsTable20260621140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_email_attachments" (
        "id"          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "emailId"     UUID        NOT NULL,
        "filename"    TEXT        NOT NULL,
        "contentType" TEXT        NOT NULL,
        "sizeBytes"   INTEGER     NOT NULL,
        "contentId"   TEXT,
        "isInline"    BOOLEAN     NOT NULL DEFAULT FALSE,
        "s3Bucket"    TEXT        NOT NULL,
        "s3Key"       TEXT        NOT NULL,
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_email_attachments_email"
        ON "support_email_attachments" ("emailId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_email_attachments_email"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_email_attachments"`);
  }
}
