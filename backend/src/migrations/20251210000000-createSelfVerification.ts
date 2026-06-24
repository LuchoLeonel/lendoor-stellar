// src/migrations/1712700000003-AddSelfVerification.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSelfVerification1712700000003 implements MigrationInterface {
  name = 'AddSelfVerification1712700000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================
    // 0) Ajustar nationality a VARCHAR(3)
    // ============================================
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "nationality" TYPE varchar(3);
    `);

    // ============================================
    // 1) Tabla self_verifications
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "self_verifications" (
        "id" SERIAL PRIMARY KEY,

        -- FK al user
        "userId" INTEGER NOT NULL,

        -- Redundancia útil para debug / joins rápidos por wallet
        "walletAddress" VARCHAR(42) NOT NULL,

        -- Flag de verificación
        "verified" BOOLEAN NOT NULL DEFAULT FALSE,

        -- Payload crudo de Self (credentialSubject / discloseOutput / etc.)
        "payload" JSONB,

        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT "fk_self_verification_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id")
          ON DELETE CASCADE
      );
    `);

    // Índice único por userId
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_self_verification_user_id"
        ON "self_verifications" ("userId");
    `);

    // Índice único por walletAddress
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_self_verification_wallet"
        ON "self_verifications" ("walletAddress");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Bajamos en orden inverso: índices → tabla

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_self_verification_wallet";
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_self_verification_user_id";
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "self_verifications";
    `);

    // Volver nationality a VARCHAR(2) de manera segura (trunca si hubiera algo de 3 chars)
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "nationality" TYPE varchar(2)
      USING SUBSTRING("nationality" FROM 1 FOR 2);
    `);
  }
}
