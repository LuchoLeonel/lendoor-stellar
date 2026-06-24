import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the audit_logs table for tracking critical business operations.
 * Records WHO did WHAT and WHEN for compliance and debugging.
 */
export class CreateAuditLog20260331000000 implements MigrationInterface {
  name = 'CreateAuditLog20260331000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id"            SERIAL PRIMARY KEY,
        "action"        VARCHAR(50)  NOT NULL,
        "walletAddress" TEXT         NULL,
        "userId"        INTEGER      NULL,
        "metadata"      JSONB        NULL,
        "ip"            VARCHAR(50)  NULL,
        "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_action"
        ON "audit_logs" ("action");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_wallet"
        ON "audit_logs" ("walletAddress");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_created_at"
        ON "audit_logs" ("createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_created_at";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_wallet";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_action";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs";`);
  }
}
