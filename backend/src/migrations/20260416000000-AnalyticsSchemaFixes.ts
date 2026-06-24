import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalyticsSchemaFixes1713225600000 implements MigrationInterface {
  name = 'AnalyticsSchemaFixes1713225600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add ip and userAgent to page_events
    await queryRunner.query(
      `ALTER TABLE page_events ADD COLUMN IF NOT EXISTS ip VARCHAR(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE page_events ADD COLUMN IF NOT EXISTS "userAgent" TEXT`,
    );

    // Add missing indexes for analytics queries
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_device_sessions_tier ON device_sessions("deviceTier")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_device_sessions_country ON device_sessions(country)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_device_sessions_platform ON device_sessions(platform)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_borrow_attempts_fees ON borrow_attempts("feeBps")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_page_events_ip ON page_events(ip)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_page_events_ip`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_borrow_attempts_fees`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_device_sessions_platform`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_device_sessions_country`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_device_sessions_tier`);
    await queryRunner.query(
      `ALTER TABLE page_events DROP COLUMN IF EXISTS "userAgent"`,
    );
    await queryRunner.query(
      `ALTER TABLE page_events DROP COLUMN IF EXISTS ip`,
    );
  }
}
