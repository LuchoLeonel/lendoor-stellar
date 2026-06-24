import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotifications1712600000002 implements MigrationInterface {
  name = 'AddNotifications1712600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================
    // 1) Enum notifications_type_enum
    // ============================================
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') THEN
          CREATE TYPE "notifications_type_enum" AS ENUM (
            'loan_due_tomorrow',
            'loan_defaulted'
          );
        END IF;
      END
      $$;
    `);

    // ============================================
    // 2) Enum notifications_status_enum
    // ============================================
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_status_enum') THEN
          CREATE TYPE "notifications_status_enum" AS ENUM (
            'pending',
            'sent',
            'failed'
          );
        END IF;
      END
      $$;
    `);

    // ============================================
    // 3) Tabla notifications
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" SERIAL PRIMARY KEY,

        -- FK al user
        "userId" INTEGER NOT NULL,

        -- FK opcional al loan (puede haber notificaciones que no dependan de un préstamo)
        "loanId" INTEGER,

        -- Tipo de notificación (loan_due_tomorrow, loan_defaulted, etc.)
        "type" "notifications_type_enum" NOT NULL,

        -- Estado de la notificación (pending, sent, failed)
        "status" "notifications_status_enum" NOT NULL DEFAULT 'pending',

        -- Canal: email / push / in_app, etc. Por ahora usamos 'email'
        "channel" VARCHAR(16) NOT NULL DEFAULT 'email',

        -- Metadata extra en JSON
        "metadata" JSONB,

        -- Momento en que se envió (si aplica)
        "sentAt" TIMESTAMPTZ,

        -- Último error (si falló el envío)
        "lastError" TEXT,

        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT "fk_notifications_user"
          FOREIGN KEY ("userId") REFERENCES "users" ("id"),

        CONSTRAINT "fk_notifications_loan"
          FOREIGN KEY ("loanId") REFERENCES "loans" ("id"),

        -- Evita duplicar notificaciones del mismo tipo para el mismo user + loan
        CONSTRAINT "uq_notification_type_user_loan"
          UNIQUE ("type", "userId", "loanId")
      );
    `);

    // ============================================
    // 4) Índices notifications
    // ============================================
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_user"
        ON "notifications" ("userId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_loan"
        ON "notifications" ("loanId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_type_status"
        ON "notifications" ("type", "status");
    `);

    // ============================================
    // 5) Tabla waitlist (singleton con el límite dinámico)
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "waitlist" (
        "id" SERIAL PRIMARY KEY,
        "value" INTEGER NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Índices que pueden ayudar en lecturas/escrituras frecuentes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_waitlist_updated_at"
        ON "waitlist" ("updatedAt" DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_waitlist_value"
        ON "waitlist" ("value");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1) waitlist
    await queryRunner.query(`DROP TABLE IF EXISTS "waitlist";`);

    // 2) notifications
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications";`);

    // 3) enums
    await queryRunner.query(`DROP TYPE IF EXISTS "notifications_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notifications_type_enum";`);
  }
}
