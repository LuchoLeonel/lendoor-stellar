import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 045 PR-12 — Normalize `users.lemonCountry` to ISO 3166-1 alpha-2.
 *
 * Lemon SDK returns OPERATION_COUNTRY as alpha-3 (ARG, PER, COL, ...).
 * IP geo lookups (device_sessions.country, borrow_attempts.country)
 * return alpha-2 (AR, PE, CO, ...). Without normalization, a country
 * mismatch feature would always return "different" — useless.
 *
 * This migration converts existing alpha-3 values to alpha-2 in place.
 * Going forward, `upsertLemonProfile` normalizes via `toIso2()` before
 * write, so the column stays consistent.
 *
 * Rollback restores alpha-3 only for the LatAm subset we support.
 */
export class NormalizeLemonCountryToIso220260507000300
  implements MigrationInterface
{
  name = 'NormalizeLemonCountryToIso220260507000300';

  // Mirrors backend/src/common/iso-country.util.ts.
  private readonly ALPHA3_TO_2: Record<string, string> = {
    ARG: 'AR', BOL: 'BO', BRA: 'BR', CHL: 'CL', COL: 'CO',
    CRI: 'CR', CUB: 'CU', DOM: 'DO', ECU: 'EC', SLV: 'SV',
    GTM: 'GT', HND: 'HN', MEX: 'MX', NIC: 'NI', PAN: 'PA',
    PRY: 'PY', PER: 'PE', PRI: 'PR', URY: 'UY', VEN: 'VE',
    USA: 'US', CAN: 'CA', ESP: 'ES', ITA: 'IT', DEU: 'DE',
    FRA: 'FR', GBR: 'GB', PRT: 'PT',
  };

  private readonly ALPHA2_TO_3: Record<string, string> = Object.fromEntries(
    Object.entries(this.ALPHA3_TO_2).map(([k, v]) => [v, k]),
  );

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Widen column to varchar(2). Was varchar(3).
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "lemonCountry" TYPE VARCHAR(3)
    `);

    // 2. In-place rewrite of alpha-3 values to alpha-2.
    for (const [a3, a2] of Object.entries(this.ALPHA3_TO_2)) {
      await queryRunner.query(
        `UPDATE "users" SET "lemonCountry" = $1 WHERE "lemonCountry" = $2`,
        [a2, a3],
      );
    }

    // 3. Now safely shrink to varchar(2). Any stragglers (unknown
    // alpha-3) we leave as-is in the wider column for inspection.
    const stragglers = (await queryRunner.query(
      `SELECT COUNT(*) AS n FROM "users" WHERE LENGTH("lemonCountry") = 3`,
    )) as Array<{ n: string }>;
    if (Number(stragglers[0]?.n ?? 0) === 0) {
      await queryRunner.query(`
        ALTER TABLE "users"
          ALTER COLUMN "lemonCountry" TYPE VARCHAR(2)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Widen first to fit alpha-3 again.
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "lemonCountry" TYPE VARCHAR(3)
    `);
    for (const [a2, a3] of Object.entries(this.ALPHA2_TO_3)) {
      await queryRunner.query(
        `UPDATE "users" SET "lemonCountry" = $1 WHERE "lemonCountry" = $2`,
        [a3, a2],
      );
    }
  }
}
