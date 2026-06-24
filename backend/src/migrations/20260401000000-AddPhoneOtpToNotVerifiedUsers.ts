import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhoneOtpToNotVerifiedUsers20260401000000 implements MigrationInterface {
  name = 'AddPhoneOtpToNotVerifiedUsers20260401000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "not_verified_users"
        ADD COLUMN IF NOT EXISTS "phone" varchar(20),
        ADD COLUMN IF NOT EXISTS "phoneOtpCode" varchar(64),
        ADD COLUMN IF NOT EXISTS "phoneOtpExpiresAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "phoneOtpAttemptCount" integer DEFAULT 0 NOT NULL,
        ADD COLUMN IF NOT EXISTS "lastPhoneOtpSentAt" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "not_verified_users"
        DROP COLUMN IF EXISTS "lastPhoneOtpSentAt",
        DROP COLUMN IF EXISTS "phoneOtpAttemptCount",
        DROP COLUMN IF EXISTS "phoneOtpExpiresAt",
        DROP COLUMN IF EXISTS "phoneOtpCode",
        DROP COLUMN IF EXISTS "phone";
    `);
  }
}
