import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 064 — DNCL temporal automático tras 4 no-answers consecutivos.
 *
 * Cuando un user no atiende 4 veces seguidas en la misma ventana semanal
 * (intentos #1-#4), se marca como DNCL temporal por 30 días. Después de
 * esa ventana puede volver a entrar al batch.
 *
 * Distinto de `hostile_dnc` (permanente, set manualmente vía tool
 * `do_not_call` durante la llamada): este es automático, soft, y vence.
 */
export class AddVoiceDncTemporaryToUsers20260518110000
  implements MigrationInterface
{
  name = 'AddVoiceDncTemporaryToUsers20260518110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "voiceDncTemporaryUntil" TIMESTAMPTZ
    `);

    // Partial index — only useful while value is "in the future".
    // Used by CollectionsService.getEligibleForCall to filter cheaply.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_voice_dnc_temporary"
        ON "users" ("voiceDncTemporaryUntil")
        WHERE "voiceDncTemporaryUntil" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_voice_dnc_temporary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "voiceDncTemporaryUntil"`,
    );
  }
}
