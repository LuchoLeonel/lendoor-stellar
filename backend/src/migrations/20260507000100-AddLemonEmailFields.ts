import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 045 PR-9 — Lemon email storage for collections + anti-fraud feature.
 *
 * The previous Lemon claims flow (spec 044) discarded the Lemon email when
 * `users.email` was already populated, losing two valuable signals:
 *   1. Anti-fraud: a mismatch between the email the user gave Lendoor at
 *      onboarding and the one they have on Lemon Cash is a strong sybil /
 *      account-takeover signal.
 *   2. Collections reach: when a user defaults, their Lemon email is the
 *      one tied to their financial account — far more likely to be checked
 *      than a possibly-stale email used at signup.
 *
 * This migration adds:
 *   - `lemonEmail` (TEXT, lowercase via entity transformer): always
 *     populated when Lemon returns one, regardless of `users.email`.
 *   - `emailMatchesLemon` (BOOLEAN): null when either side is missing,
 *     true/false comparing normalized values. Used as a model feature.
 *
 * Consent: covered by the Lemon SDK consent popup which explicitly tells
 * the user data will be shared with Lendoor. Confirmed with Lemon team.
 */
export class AddLemonEmailFields20260507000100
  implements MigrationInterface
{
  name = 'AddLemonEmailFields20260507000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "lemonEmail" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "emailMatchesLemon" BOOLEAN NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "emailMatchesLemon",
        DROP COLUMN IF EXISTS "lemonEmail"
    `);
  }
}
