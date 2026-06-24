import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRiskScoringFields20260405000000 implements MigrationInterface {
  name = 'AddRiskScoringFields20260405000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "riskDecision"       varchar(20),
        ADD COLUMN IF NOT EXISTS "riskPDefault"       decimal(6,4),
        ADD COLUMN IF NOT EXISTS "riskClass"          varchar(20),
        ADD COLUMN IF NOT EXISTS "riskScoredAt"       timestamptz,
        ADD COLUMN IF NOT EXISTS "riskDecisionId"     varchar(64),
        ADD COLUMN IF NOT EXISTS "riskCreditLimitUsd" decimal(10,2);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_risk_decision"
        ON "users" ("riskDecision");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_user_risk_decision";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "riskCreditLimitUsd",
        DROP COLUMN IF EXISTS "riskDecisionId",
        DROP COLUMN IF EXISTS "riskScoredAt",
        DROP COLUMN IF EXISTS "riskClass",
        DROP COLUMN IF EXISTS "riskPDefault",
        DROP COLUMN IF EXISTS "riskDecision";
    `);
  }
}
