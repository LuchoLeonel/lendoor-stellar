import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds phone verification fields to the users table.
 * Phone OTP state is managed by Twilio Verify — we only store
 * the verified phone number and verification timestamp here.
 */
export class AddPhoneToUsers20260316000000 implements MigrationInterface {
  name = 'AddPhoneToUsers20260316000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "phone" VARCHAR(20) NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMPTZ NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "whatsappOptOut" BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "lastPhoneOtpSentAt" TIMESTAMPTZ NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_phone"
        ON "users" ("phone")
        WHERE "phone" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_phone";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "whatsappOptOut";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "phoneVerifiedAt";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "lastPhoneOtpSentAt";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "phone";
    `);
  }
}
