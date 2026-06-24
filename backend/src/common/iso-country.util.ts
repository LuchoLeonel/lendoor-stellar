/**
 * Spec 045 PR-12 — ISO 3166-1 country code normalization.
 *
 * Lendoor receives country codes from two formats:
 *  - 3-letter ISO (alpha-3): from Self KYC (`nationality`) and Lemon
 *    SDK (`OPERATION_COUNTRY` claim → `lemonCountry`).
 *  - 2-letter ISO (alpha-2): from IP geo lookup
 *    (`device_sessions.country`, `borrow_attempts.country`).
 *
 * To enable feature engineering like `country_session_matches_lemon`,
 * we standardize on alpha-2 in the model layer. Storage keeps the
 * original format (Self/Lemon → alpha-3); comparison normalizes via
 * `toIso2()`.
 *
 * Only LatAm + a few common origin countries mapped (the populated
 * universe in our DB). Falls back to identity if unknown.
 */

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  ARG: 'AR',
  BOL: 'BO',
  BRA: 'BR',
  CHL: 'CL',
  COL: 'CO',
  CRI: 'CR',
  CUB: 'CU',
  DOM: 'DO',
  ECU: 'EC',
  SLV: 'SV',
  GTM: 'GT',
  HND: 'HN',
  MEX: 'MX',
  NIC: 'NI',
  PAN: 'PA',
  PRY: 'PY',
  PER: 'PE',
  PRI: 'PR',
  URY: 'UY',
  VEN: 'VE',
  USA: 'US',
  CAN: 'CA',
  ESP: 'ES',
  ITA: 'IT',
  DEU: 'DE',
  FRA: 'FR',
  GBR: 'GB',
  PRT: 'PT',
};

/**
 * Normalize a country code to ISO 3166-1 alpha-2 format. Accepts both
 * alpha-2 (returned as-is, uppercased) and alpha-3 (mapped). Returns
 * null for empty/unknown input.
 */
export function toIso2(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return null;
  if (trimmed.length === 2) return trimmed;
  if (trimmed.length === 3) {
    return ALPHA3_TO_ALPHA2[trimmed] ?? null;
  }
  return null;
}

/**
 * Normalized equality check for two country codes regardless of input
 * format. Returns null if either side cannot be normalized.
 */
export function countriesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean | null {
  const aIso = toIso2(a);
  const bIso = toIso2(b);
  if (!aIso || !bIso) return null;
  return aIso === bIso;
}
