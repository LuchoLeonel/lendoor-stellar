import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds syncedByChain boolean column to loans table.
 * Used as an audit flag to identify loans that were reconciled
 * by the chain-sync cron rather than the frontend inform-repayment call.
 */
export class AddSyncedByChainColumn20260225100000 implements MigrationInterface {
  name = 'AddSyncedByChainColumn20260225100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loans"
      ADD COLUMN IF NOT EXISTS "syncedByChain" BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loans"
      DROP COLUMN IF EXISTS "syncedByChain";
    `);
  }
}
