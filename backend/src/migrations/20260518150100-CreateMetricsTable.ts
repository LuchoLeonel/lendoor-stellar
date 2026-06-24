import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 065 Layer 5 — small key/value metrics table.
 *
 * Backs `/health/db-chain-parity` and the alert in chain-sync. We don't
 * have Prometheus or a metrics gateway today; the cron writes one row
 * per gauge per run and the health endpoint reads it.
 *
 * First key: `db_chain_loan_diff` (subgraph loan count − DB loan count).
 * Healthy: 0. Alert threshold (in service code): |diff| ≥ 3 (3 absorbs
 * the transient race where a fresh inform-open lands between the diff
 * computation and the next subgraph query).
 */
export class CreateMetricsTable20260518150100 implements MigrationInterface {
  name = 'CreateMetricsTable20260518150100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "metrics" (
        "key"        TEXT PRIMARY KEY,
        "value"      DOUBLE PRECISION NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "metrics"`);
  }
}
