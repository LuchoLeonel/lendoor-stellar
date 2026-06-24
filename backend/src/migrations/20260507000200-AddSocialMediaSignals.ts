import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 045 PR-10 — Social media presence cache.
 *
 * Stores per-email digital footprint signals from RapidAPI
 * social-media-scanner1 (~$15/mo). Used as features in v3 risk model:
 *   - `social_total_count` (0-6 continuous)
 *   - `social_zero_presence` (boolean: total=0 → strong anti-fraud signal)
 *   - per-platform booleans (has_facebook, has_instagram, ...)
 *
 * Cached per email with a 90-day refresh window so a returning user
 * gets re-scanned (digital footprints accrete over time, never decay).
 *
 * The API is async (~7s per single, latency unfit for inline scoring),
 * so a daily cron pre-fills the cache; risk-features.util.ts joins.
 */
export class AddSocialMediaSignals20260507000200
  implements MigrationInterface
{
  name = 'AddSocialMediaSignals20260507000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_media_signals" (
        "email" TEXT PRIMARY KEY,
        "facebook" BOOLEAN,
        "instagram" BOOLEAN,
        "snapchat" BOOLEAN,
        "x" BOOLEAN,
        "google" BOOLEAN,
        "microsoft" BOOLEAN,
        "totalCount" SMALLINT NOT NULL DEFAULT 0,
        "scannedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "reScanEligibleAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days')
      )
    `);

    // Index for the cron that finds rows due for re-scan.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_social_signals_rescan"
        ON "social_media_signals" ("reScanEligibleAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_social_signals_rescan"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_media_signals"`);
  }
}
