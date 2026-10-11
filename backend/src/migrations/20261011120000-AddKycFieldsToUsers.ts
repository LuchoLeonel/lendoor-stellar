import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D1.3 (SCF #45) — campos del gate de KYC en users. El estado persistido es
 * la UNICA fuente que lee el gate (kyc-gate.ts); el vendor solo se consulta
 * desde los endpoints de /kyc. Default 'none' para todo el stock existente:
 * con KYC_GATE_ENABLED apagado (el default) nada cambia para nadie.
 */
export class AddKycFieldsToUsers20261011120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kycStatus" varchar(16) NOT NULL DEFAULT 'none'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kycSessionId" varchar(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kycProvider" varchar(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kycApprovedAt" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "kycApprovedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "kycProvider"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "kycSessionId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "kycStatus"`);
  }
}
