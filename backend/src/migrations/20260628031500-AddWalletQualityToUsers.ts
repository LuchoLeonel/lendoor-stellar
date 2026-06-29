import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletQualityToUsers20260628031500
  implements MigrationInterface
{
  name = 'AddWalletQualityToUsers20260628031500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "walletQuality" varchar(5) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "walletQuality"
    `);
  }
}
