import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhoneOtpFieldsToUsers20260402000000 implements MigrationInterface {
  name = 'AddPhoneOtpFieldsToUsers20260402000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "phoneOtpCode" varchar(64),
        ADD COLUMN IF NOT EXISTS "phoneOtpExpiresAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "phoneOtpAttemptCount" integer DEFAULT 0 NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "phoneOtpAttemptCount",
        DROP COLUMN IF EXISTS "phoneOtpExpiresAt",
        DROP COLUMN IF EXISTS "phoneOtpCode";
    `);
  }
}
