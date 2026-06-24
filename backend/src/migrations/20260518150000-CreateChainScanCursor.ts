import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 065 Layer 2 — persistent cursor for the chain-event scanners.
 *
 * Keyed by a string discriminator (`id`) so the same table backs every
 * scanner. The first scanner is `loan_opened` (Layer 2 of spec 065); a
 * future `loan_defaulted` scanner can share the table.
 *
 * Bootstrap: the cursor for `loan_opened` is initialized to 0. On first
 * scanner run, the scanner caps the walk at MAX_BLOCK_RANGE blocks per
 * invocation, so initial catch-up is self-paced across multiple cron
 * cycles instead of one massive query.
 *
 * To skip historical scanning entirely on first deploy (faster catch-up),
 * an operator can manually SET cursor.block to a recent block:
 *   UPDATE chain_scan_cursor SET block = <recent_block> WHERE id = 'loan_opened';
 */
export class CreateChainScanCursor20260518150000 implements MigrationInterface {
  name = 'CreateChainScanCursor20260518150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chain_scan_cursor" (
        "id"         TEXT PRIMARY KEY,
        "block"      BIGINT NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO "chain_scan_cursor" ("id", "block")
      VALUES ('loan_opened', 0)
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chain_scan_cursor"`);
  }
}
