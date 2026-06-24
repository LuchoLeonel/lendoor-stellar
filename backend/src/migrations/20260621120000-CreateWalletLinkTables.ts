import { MigrationInterface, QueryRunner } from 'typeorm';

// Spec 084 — companion wallet link: linked_wallets + wallet_link_sessions +
// wallet_link_nonces. IF NOT EXISTS por migrationsTransactionMode:'each'.
export class CreateWalletLinkTables20260621120000
  implements MigrationInterface
{
  name = 'CreateWalletLinkTables20260621120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- linked_wallets ---
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "linked_wallets" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        "address" VARCHAR(42) NOT NULL,
        "chainId" INTEGER NOT NULL DEFAULT 1,
        "verifiedAt" TIMESTAMPTZ NOT NULL,
        "source" TEXT NOT NULL DEFAULT 'companion_web',
        "verificationMethod" TEXT NOT NULL DEFAULT 'ecdsa_companion',
        "message" TEXT,
        "signature" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_linked_wallet_user_addr"
        ON "linked_wallets" ("userId", "address");
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_linked_wallet_addr"
        ON "linked_wallets" ("address");
    `);

    // --- wallet_link_sessions (OTP challenge + token opaco) ---
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wallet_link_sessions" (
        "id" SERIAL PRIMARY KEY,
        "email" TEXT NOT NULL,
        "userId" INTEGER,
        "otpCodeHash" TEXT,
        "otpExpiresAt" TIMESTAMPTZ,
        "otpAttemptCount" INTEGER NOT NULL DEFAULT 0,
        "lastOtpSentAt" TIMESTAMPTZ,
        "token" TEXT,
        "tokenExpiresAt" TIMESTAMPTZ,
        "verifiedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_wls_email"
        ON "wallet_link_sessions" ("email");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wls_token"
        ON "wallet_link_sessions" ("token");
    `);

    // --- wallet_link_nonces (single-use, scoped userId+address) ---
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wallet_link_nonces" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        "address" VARCHAR(42) NOT NULL,
        "nonce" VARCHAR(128) NOT NULL,
        "message" TEXT NOT NULL,
        "used" BOOLEAN NOT NULL DEFAULT FALSE,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_wln_nonce"
        ON "wallet_link_nonces" ("nonce");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_link_nonces";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_link_sessions";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "linked_wallets";`);
  }
}
