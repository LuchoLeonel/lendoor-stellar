// src/migrations/1712700000004-AddBlockedWallets.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlockedWallets1712700000004 implements MigrationInterface {
  name = 'AddBlockedWallets1712700000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================
    // 1) Tabla blocked_wallets
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "blocked_wallets" (
        "id" SERIAL PRIMARY KEY,

        -- wallet bloqueada (lowercase en app)
        "walletAddress" TEXT NOT NULL,

        -- motivo opcional
        "reason" TEXT,

        -- NULL = bloqueo permanente, si no: bloqueo vigente hasta esa fecha
        "blockedUntil" TIMESTAMPTZ,

        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Índice único por walletAddress (equivalente al @Index unique)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_blocked_wallet_wallet"
        ON "blocked_wallets" ("walletAddress");
    `);

    // (Opcional) Índice para consultas por vigencia temporal
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_blocked_wallet_until"
        ON "blocked_wallets" ("blockedUntil");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Bajamos en orden inverso: índices → tabla
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_blocked_wallet_until";
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_blocked_wallet_wallet";
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "blocked_wallets";
    `);
  }
}
