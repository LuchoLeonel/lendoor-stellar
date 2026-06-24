import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnalyticsTables20260409000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS device_sessions (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER REFERENCES users(id) ON DELETE SET NULL,
        "walletAddress" TEXT,
        "sessionId" VARCHAR(64) UNIQUE NOT NULL,
        "userAgent" TEXT,
        "deviceBrand" VARCHAR(64),
        "deviceModel" VARCHAR(128),
        "deviceTier" VARCHAR(10),
        "osName" VARCHAR(32),
        "osVersion" VARCHAR(32),
        ip VARCHAR(50),
        country VARCHAR(3),
        region VARCHAR(128),
        platform VARCHAR(16),
        "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_device_sessions_wallet ON device_sessions ("walletAddress");
      CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions ("userId");
      CREATE INDEX IF NOT EXISTS idx_device_sessions_created ON device_sessions ("createdAt");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS borrow_attempts (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER REFERENCES users(id) ON DELETE SET NULL,
        "walletAddress" TEXT NOT NULL,
        "sessionId" VARCHAR(64),
        "amountHuman" VARCHAR(32),
        "tenorDays" INTEGER,
        "feeBps" INTEGER,
        outcome VARCHAR(20) NOT NULL,
        "errorType" VARCHAR(64),
        "errorMessage" TEXT,
        "deviceBrand" VARCHAR(64),
        "deviceModel" VARCHAR(128),
        "deviceTier" VARCHAR(10),
        "osName" VARCHAR(32),
        ip VARCHAR(50),
        "durationMs" INTEGER,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_borrow_attempts_wallet ON borrow_attempts ("walletAddress");
      CREATE INDEX IF NOT EXISTS idx_borrow_attempts_user ON borrow_attempts ("userId");
      CREATE INDEX IF NOT EXISTS idx_borrow_attempts_outcome ON borrow_attempts (outcome);
      CREATE INDEX IF NOT EXISTS idx_borrow_attempts_created ON borrow_attempts ("createdAt");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS page_events (
        id SERIAL PRIMARY KEY,
        "sessionId" VARCHAR(64),
        "walletAddress" TEXT,
        "eventType" VARCHAR(32) NOT NULL,
        path TEXT,
        metadata JSONB,
        "clientTimestamp" BIGINT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_page_events_session ON page_events ("sessionId");
      CREATE INDEX IF NOT EXISTS idx_page_events_wallet ON page_events ("walletAddress");
      CREATE INDEX IF NOT EXISTS idx_page_events_type ON page_events ("eventType");
      CREATE INDEX IF NOT EXISTS idx_page_events_created ON page_events ("createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS page_events');
    await queryRunner.query('DROP TABLE IF EXISTS borrow_attempts');
    await queryRunner.query('DROP TABLE IF EXISTS device_sessions');
  }
}
