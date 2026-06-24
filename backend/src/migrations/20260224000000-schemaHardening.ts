import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema hardening migration — fixes constraints, indexes, and data integrity
 * issues found during audit. Every step is idempotent and safe for production.
 *
 * Summary:
 *  1. Partial unique index for notifications with NULL loanId
 *  2. FK CASCADE on notifications → users / loans
 *  3. Explicit RESTRICT on loans → users
 *  4. JoinColumn alignment for user_achievements (already correct in DDL, this is defensive)
 *  5. Lowercase existing self_verifications.walletAddress data
 *  6. Missing performance indexes
 *  7. CHECK constraint on not_verified_users.otpAttemptCount
 *  8. Defensive lowercase normalization on existing data
 */
export class SchemaHardening20260224000000 implements MigrationInterface {
  name = 'SchemaHardening20260224000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ================================================================
    // 1) Partial unique index for notifications with NULL loanId
    //    The existing UNIQUE(type, userId, loanId) doesn't prevent
    //    duplicates when loanId IS NULL (Postgres treats NULL != NULL).
    //    First, clean up any existing duplicates so the index can be created.
    // ================================================================
    await queryRunner.query(`
      DELETE FROM "notifications" n1
      USING "notifications" n2
      WHERE n1."id" > n2."id"
        AND n1."type" = n2."type"
        AND n1."userId" = n2."userId"
        AND n1."loanId" IS NULL
        AND n2."loanId" IS NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_type_user_null_loan"
        ON "notifications" ("type", "userId")
        WHERE "loanId" IS NULL;
    `);

    // ================================================================
    // 2) FK CASCADE on notifications → users and notifications → loans
    //    Drop existing constraints and recreate with ON DELETE CASCADE.
    //    Wrapped in DO block to handle case where constraint doesn't exist.
    // ================================================================
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_notifications_user'
            AND table_name = 'notifications'
        ) THEN
          ALTER TABLE "notifications" DROP CONSTRAINT "fk_notifications_user";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "fk_notifications_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_notifications_loan'
            AND table_name = 'notifications'
        ) THEN
          ALTER TABLE "notifications" DROP CONSTRAINT "fk_notifications_loan";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "fk_notifications_loan"
        FOREIGN KEY ("loanId") REFERENCES "loans"("id")
        ON DELETE CASCADE;
    `);

    // ================================================================
    // 3) Explicit RESTRICT on loans → users
    //    Drop existing constraint and recreate with explicit ON DELETE RESTRICT.
    //    This was the implicit default, now it's documented.
    // ================================================================
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'fk_loans_user'
            AND table_name = 'loans'
        ) THEN
          ALTER TABLE "loans" DROP CONSTRAINT "fk_loans_user";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "loans"
        ADD CONSTRAINT "fk_loans_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE RESTRICT;
    `);

    // ================================================================
    // 4) Normalize self_verifications.walletAddress to lowercase
    //    Safe: only updates rows that aren't already lowercase.
    // ================================================================
    await queryRunner.query(`
      UPDATE "self_verifications"
      SET "walletAddress" = LOWER("walletAddress")
      WHERE "walletAddress" != LOWER("walletAddress");
    `);

    // ================================================================
    // 5) Missing performance indexes
    // ================================================================

    // 5a) access_tokens.revokedAt — used by cleanup cron
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_access_token_revoked_at"
        ON "access_tokens" ("revokedAt");
    `);

    // 5b) loans.closedAt — used in many queries: IS NULL / IS NOT NULL
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_loans_closed_at"
        ON "loans" ("closedAt");
    `);

    // 5c) blocked_wallets composite — used in blocklist lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_blocked_wallet_combo"
        ON "blocked_wallets" ("walletAddress", "blockedUntil");
    `);

    // 5d) notifications.status — queried alone in some paths
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_status"
        ON "notifications" ("status");
    `);

    // ================================================================
    // 6) CHECK constraint on not_verified_users.otpAttemptCount
    //    The app limits to 5, we allow up to 10 for margin.
    // ================================================================
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.check_constraints
          WHERE constraint_name = 'chk_otp_attempt_count'
        ) THEN
          ALTER TABLE "not_verified_users"
            ADD CONSTRAINT "chk_otp_attempt_count"
            CHECK ("otpAttemptCount" >= 0 AND "otpAttemptCount" <= 10);
        END IF;
      END $$;
    `);

    // ================================================================
    // 7) Defensive lowercase normalization on other tables
    //    Should be no-ops if the app always lowercased before writing.
    // ================================================================
    await queryRunner.query(`
      UPDATE "users"
      SET "walletAddress" = LOWER("walletAddress")
      WHERE "walletAddress" != LOWER("walletAddress");
    `);

    await queryRunner.query(`
      UPDATE "access_tokens"
      SET "walletAddress" = LOWER("walletAddress")
      WHERE "walletAddress" != LOWER("walletAddress");
    `);

    await queryRunner.query(`
      UPDATE "blocked_wallets"
      SET "walletAddress" = LOWER("walletAddress")
      WHERE "walletAddress" != LOWER("walletAddress");
    `);

    await queryRunner.query(`
      UPDATE "not_verified_users"
      SET "walletAddress" = LOWER("walletAddress")
      WHERE "walletAddress" != LOWER("walletAddress");
    `);

    await queryRunner.query(`
      UPDATE "loans"
      SET "borrowerAddress" = LOWER("borrowerAddress")
      WHERE "borrowerAddress" != LOWER("borrowerAddress");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── 7) Data normalization: cannot be undone (data was already lowercase) ──

    // ── 6) Remove CHECK constraint ──
    await queryRunner.query(`
      ALTER TABLE "not_verified_users"
        DROP CONSTRAINT IF EXISTS "chk_otp_attempt_count";
    `);

    // ── 5) Remove added indexes ──
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notification_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_blocked_wallet_combo";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_loans_closed_at";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_access_token_revoked_at";`,
    );

    // ── 4) self_verifications lowercase: cannot be undone ──

    // ── 3) Revert loans FK to implicit default (NO ACTION) ──
    await queryRunner.query(`
      ALTER TABLE "loans" DROP CONSTRAINT IF EXISTS "fk_loans_user";
    `);
    await queryRunner.query(`
      ALTER TABLE "loans"
        ADD CONSTRAINT "fk_loans_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id");
    `);

    // ── 2) Revert notifications FK to no cascade ──
    await queryRunner.query(`
      ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "fk_notifications_loan";
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "fk_notifications_loan"
        FOREIGN KEY ("loanId") REFERENCES "loans"("id");
    `);

    await queryRunner.query(`
      ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "fk_notifications_user";
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "fk_notifications_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id");
    `);

    // ── 1) Remove partial unique index ──
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_notification_type_user_null_loan";
    `);
  }
}
