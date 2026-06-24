import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 070 Phase 1.5 — admin notes per voice call.
 *
 * Lets admins (Fabián + trainee) add free-text observations on top of any
 * call's outcome. Used for handoff between operators ("PTP dudoso, escalar",
 * "deudor confundió monto, retry martes", etc).
 *
 * Notes are append-only with a soft-delete (deleted_at) so audit trail stays
 * intact even if author removes their own note.
 */
export class CreateVoiceCallNotesTable20260520200000
  implements MigrationInterface
{
  name = 'CreateVoiceCallNotesTable20260520200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "voice_call_notes" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "callId"         UUID NOT NULL,
        "authorWallet"   VARCHAR(42) NOT NULL,
        "text"           TEXT NOT NULL,
        "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deletedAt"      TIMESTAMPTZ,
        CONSTRAINT "fk_voice_call_notes_call"
          FOREIGN KEY ("callId") REFERENCES "voice_call_log"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_notes_call_created"
        ON "voice_call_notes" ("callId", "createdAt" DESC)
        WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_voice_call_notes_author"
        ON "voice_call_notes" ("authorWallet")
        WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "voice_call_notes"`);
  }
}
