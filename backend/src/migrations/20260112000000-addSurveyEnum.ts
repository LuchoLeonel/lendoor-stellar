import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirstSurveyNotificationType20260112000000 implements MigrationInterface {
  name = 'AddFirstSurveyNotificationType20260112000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') THEN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'notifications_type_enum'
              AND e.enumlabel = 'first_survey'
          ) THEN
            ALTER TYPE "notifications_type_enum"
              ADD VALUE 'first_survey';
          END IF;
        END IF;
      END
      $$;
    `);
  }

  public async down(): Promise<void> {
    // Postgres no soporta remover valores de ENUM fácilmente.
  }
}
