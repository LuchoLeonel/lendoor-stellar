import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGeoToBorrowAttempts1713312000000 implements MigrationInterface {
  name = 'AddGeoToBorrowAttempts1713312000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add country and region to borrow_attempts (parity with device_sessions)
    await queryRunner.query(
      `ALTER TABLE borrow_attempts ADD COLUMN IF NOT EXISTS country VARCHAR(3)`,
    );
    await queryRunner.query(
      `ALTER TABLE borrow_attempts ADD COLUMN IF NOT EXISTS region VARCHAR(128)`,
    );

    // Index for country-based segmentation
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_borrow_attempts_country ON borrow_attempts(country)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_borrow_attempts_country`,
    );
    await queryRunner.query(
      `ALTER TABLE borrow_attempts DROP COLUMN IF EXISTS region`,
    );
    await queryRunner.query(
      `ALTER TABLE borrow_attempts DROP COLUMN IF EXISTS country`,
    );
  }
}
