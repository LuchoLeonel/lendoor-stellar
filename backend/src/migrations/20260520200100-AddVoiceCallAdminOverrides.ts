import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 070 Phase 1.5 — admin override columns on voice_call_log.
 *
 * Lets an admin (Fabián or trainee) correct the auto-detected outcome,
 * category, sentiment, or PTP fulfillment state of a call. The original
 * detection stays in the existing columns; the override (when set) takes
 * precedence in dashboard views.
 *
 * Audit columns track who and when made the override.
 */
export class AddVoiceCallAdminOverrides20260520200100
  implements MigrationInterface
{
  name = 'AddVoiceCallAdminOverrides20260520200100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "voice_call_log"
        ADD COLUMN IF NOT EXISTS "adminOutcomeOverride"   VARCHAR(40),
        ADD COLUMN IF NOT EXISTS "adminCategoryOverride"  SMALLINT,
        ADD COLUMN IF NOT EXISTS "adminSentimentOverride" VARCHAR(20),
        ADD COLUMN IF NOT EXISTS "adminPtpFulfilledOverride" BOOLEAN,
        ADD COLUMN IF NOT EXISTS "adminOverrideBy"        VARCHAR(42),
        ADD COLUMN IF NOT EXISTS "adminOverrideAt"        TIMESTAMPTZ
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_log_overridden"
        ON "voice_call_log" ("adminOverrideAt" DESC)
        WHERE "adminOverrideAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "voice_call_log"
        DROP COLUMN IF EXISTS "adminOutcomeOverride",
        DROP COLUMN IF EXISTS "adminCategoryOverride",
        DROP COLUMN IF EXISTS "adminSentimentOverride",
        DROP COLUMN IF EXISTS "adminPtpFulfilledOverride",
        DROP COLUMN IF EXISTS "adminOverrideBy",
        DROP COLUMN IF EXISTS "adminOverrideAt"
    `);
  }
}
