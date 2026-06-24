import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixOtpCodeColumnSize20260402100000 implements MigrationInterface {
  name = 'FixOtpCodeColumnSize20260402100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // otpCode was varchar(6) but now stores a SHA-256 hash (64 chars)
    await queryRunner.query(`
      ALTER TABLE "not_verified_users"
        ALTER COLUMN "otpCode" TYPE varchar(64);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "not_verified_users"
        ALTER COLUMN "otpCode" TYPE varchar(6);
    `);
  }
}
