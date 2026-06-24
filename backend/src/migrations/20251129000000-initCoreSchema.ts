import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitCoreSchema1712080000001 implements MigrationInterface {
  name = 'InitCoreSchema1712080000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================
    // 1) access_tokens
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "access_tokens" (
        "id" SERIAL PRIMARY KEY,
        "token" TEXT NOT NULL,
        "walletAddress" TEXT NOT NULL,
        "revokedAt" TIMESTAMPTZ,
        "expiresAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_access_token_value"
        ON "access_tokens" ("token");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_access_token_wallet"
        ON "access_tokens" ("walletAddress");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_access_token_expires_at"
        ON "access_tokens" ("expiresAt");
    `);

    // ============================================
    // 2) not_verified_users
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "not_verified_users" (
        "id" SERIAL PRIMARY KEY,
        "walletAddress" TEXT NOT NULL,

        -- origen del usuario (lemon / farcaster / webapp)
        "platform" VARCHAR(16),

        "email" TEXT,
        "otpCode" VARCHAR(6),
        "otpExpiresAt" TIMESTAMPTZ,
        "otpAttemptCount" INTEGER NOT NULL DEFAULT 0,
        "lastOtpSentAt" TIMESTAMPTZ,
        "waitlistJoinedAt" TIMESTAMPTZ,

        -- Fecha en que aceptó TyC como not-verified
        "termsAcceptedAt" TIMESTAMPTZ,

        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Por si ya existía sin la columna nueva
    await queryRunner.query(`
      ALTER TABLE "not_verified_users"
      ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMPTZ;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_not_verified_wallet"
        ON "not_verified_users" ("walletAddress");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_not_verified_email"
        ON "not_verified_users" ("email");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_not_verified_otp_expires"
        ON "not_verified_users" ("otpExpiresAt");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_not_verified_waitlist_joined"
        ON "not_verified_users" ("waitlistJoinedAt");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_not_verified_platform"
        ON "not_verified_users" ("platform");
    `);

    // ============================================
    // 3) siwe_nonces
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "siwe_nonces" (
        "id" SERIAL PRIMARY KEY,
        "nonce" VARCHAR(128) NOT NULL,
        "used" BOOLEAN NOT NULL DEFAULT FALSE,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_siwe_nonce_value"
        ON "siwe_nonces" ("nonce");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_siwe_nonce_expires_used"
        ON "siwe_nonces" ("used", "expiresAt");
    `);

    // ============================================
    // 4) users
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" SERIAL PRIMARY KEY,

        "walletAddress" TEXT NOT NULL,

        -- origen del usuario (lemon / farcaster / webapp)
        "platform" VARCHAR(16),

        "firstName" TEXT,
        "lastName" TEXT,

        -- Fecha de nacimiento como texto (ej: "1996-04-12")
        "birthdate" TEXT,

        -- ISO 3166-1 alpha-2 (AR, US, ...)
        "nationality" VARCHAR(2),

        -- Documento
        "documentType" TEXT,
        "documentNumber" TEXT,

        -- Límite de crédito: decimal(18,2)
        "creditLimit" DECIMAL(18,2),

        -- Score (0–1000) nullable
        "score" INTEGER,

        -- Email (unique, en minúsculas a nivel app)
        "email" TEXT,

        -- Waitlist
        "waitlistJoinedAt" TIMESTAMPTZ,
        "earlyAccessNotifiedAt" TIMESTAMPTZ,

        -- XP para gamificación / achievements
        "xp" INTEGER NOT NULL DEFAULT 1,

        -- Encuesta simple sobre tipo de trabajo
        "workType" VARCHAR(32),

        -- Fecha en que aceptó TyC
        "termsAcceptedAt" TIMESTAMPTZ,

        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        -- Constraint de documento único
        CONSTRAINT "uq_user_document"
          UNIQUE ("documentType", "documentNumber"),

        -- Check de score (si no es null, debe estar en [0,1000])
        CONSTRAINT "chk_user_score_range"
          CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 1000))
      );
    `);

    // Aseguramos columnas y defaults por si la tabla ya existía
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "xp" INTEGER NOT NULL DEFAULT 1;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "xp" SET DEFAULT 1;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "workType" VARCHAR(32);
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMPTZ;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_wallet"
        ON "users" ("walletAddress");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_email"
        ON "users" ("email");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_id_waitlist_joined"
        ON "users" ("id", "waitlistJoinedAt");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_early_access_notify"
        ON "users" ("earlyAccessNotifiedAt", "id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_score"
        ON "users" ("score");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_platform"
        ON "users" ("platform");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_xp"
        ON "users" ("xp");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_work_type"
        ON "users" ("workType");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_terms_accepted"
        ON "users" ("termsAcceptedAt");
    `);

    // ============================================
    // 5) loans
    // ============================================
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loans_status_enum') THEN
          CREATE TYPE "loans_status_enum" AS ENUM (
            'open',
            'repaid_on_time',
            'repaid_late',
            'defaulted'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loans" (
        "id" SERIAL PRIMARY KEY,

        -- FK al user
        "userId" INTEGER NOT NULL,

        -- Redundancia útil para debug / joins rápidos por wallet
        "borrowerAddress" TEXT NOT NULL,

        -- Monto prestado (principal)
        "principal" DECIMAL(18,2) NOT NULL,

        -- Monto total a devolver al originar el préstamo (principal + interés base, SIN mora)
        "amountDueAtOpen" DECIMAL(18,2) NOT NULL,

        -- Monto efectivamente pagado al cerrar el préstamo (>= amountDueAtOpen si hubo mora)
        "amountPaid" DECIMAL(18,2) NOT NULL,

        -- Tenor en días (3, 7, 14, 30, etc.)
        "tenorDays" INTEGER NOT NULL,

        -- Fee total en basis points (ej: 1500 = 15%)
        "feeBps" INTEGER NOT NULL,

        -- Inicio del préstamo
        "startAt" TIMESTAMPTZ NOT NULL,

        -- Due date contractual
        "dueAt" TIMESTAMPTZ NOT NULL,

        -- Momento en que se cerró el préstamo (cuando pagó todo)
        "closedAt" TIMESTAMPTZ,

        -- Estado del préstamo
        "status" "loans_status_enum" NOT NULL DEFAULT 'open',

        -- true → repaid_on_time ; false → repaid_late o defaulted
        "repaidOnTime" BOOLEAN NOT NULL DEFAULT FALSE,

        -- Tx hashes on-chain (opcionales)
        "openTxHash" TEXT,
        "closeTxHash" TEXT,

        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT "fk_loans_user"
          FOREIGN KEY ("userId") REFERENCES "users" ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_user"
        ON "loans" ("userId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_user_status"
        ON "loans" ("userId", "status");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_borrower"
        ON "loans" ("borrowerAddress");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_user_status_startAt"
        ON "loans" ("userId", "status", "startAt" DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_user_dueAt"
        ON "loans" ("userId", "dueAt");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_user_repaid_on_time"
        ON "loans" ("userId", "repaidOnTime");
    `);

    // ============================================
    // 6) achievements
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "achievements" (
        "id" SERIAL PRIMARY KEY,
        "code" VARCHAR NOT NULL,
        "title" VARCHAR NOT NULL,
        "description" TEXT,
        "xp" INTEGER NOT NULL DEFAULT 0,
        "icon" VARCHAR(64),
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_achievements_code" UNIQUE ("code")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_achievements_sort_order"
        ON "achievements" ("sortOrder");
    `);

    // ============================================
    // 7) user_achievements
    // ============================================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_achievements" (
        "id" SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        "achievementId" INTEGER NOT NULL,
        "earnedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "meta" JSONB
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_achievement"
        ON "user_achievements" ("userId", "achievementId");
    `);

    await queryRunner.query(`
      ALTER TABLE "user_achievements"
        ADD CONSTRAINT "FK_user_achievements_user"
        FOREIGN KEY ("userId") REFERENCES "users" ("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      ALTER TABLE "user_achievements"
        ADD CONSTRAINT "FK_user_achievements_achievement"
        FOREIGN KEY ("achievementId") REFERENCES "achievements" ("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_achievements_user"
        ON "user_achievements" ("userId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_achievements_achievement"
        ON "user_achievements" ("achievementId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Bajamos en orden inverso para respetar FK
    await queryRunner.query(`DROP TABLE IF EXISTS "user_achievements";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "achievements";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "loans";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "loans_status_enum";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "siwe_nonces";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "not_verified_users";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "access_tokens";`);
  }
}
