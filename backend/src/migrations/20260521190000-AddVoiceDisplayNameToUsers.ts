import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 072 day-2 — display name override para voice cobranza.
 *
 * Para users sin firstName/lastName (huérfanos por email-only), Fabián quiere
 * poder ingresar manualmente desde `/admin/voice` un nombre con el cual Sofía
 * los saludará al llamarlos.
 *
 * Decisión clave: NO modificar firstName/lastName reales (ésos son la verdad
 * canónica de la cuenta del usuario, ej. ID verification con Self). Esta
 * columna es exclusivamente para uso del voice-agent.
 *
 * Comportamiento (en backend collections.service.ts getDebtorCase):
 *   - voiceDisplayName=NULL → flow existente (firstName/lastName real → username → neutral)
 *   - voiceDisplayName="Florencia" (1 palabra) → flow GREETINGS_NAME_ONLY
 *   - voiceDisplayName="Florencia García" (2+) → flow GREETINGS_FULL formal
 *
 * Sin index. Cardinality baja y el campo no se usa en WHERE clauses de queries
 * hot-path; solo se lee en getDebtorCase via primary key del user.
 */
export class AddVoiceDisplayNameToUsers20260521190000
  implements MigrationInterface
{
  name = 'AddVoiceDisplayNameToUsers20260521190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "voiceDisplayName" TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "voiceDisplayName"`,
    );
  }
}
