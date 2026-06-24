// src/common/derive-name-from-email.util.ts
//
// Spec 067 — provisional fallback to derive {firstName, lastName} from email
// local-part for the ~5-15 "huérfano" users who never completed Lemon OAuth
// but have a phone + an email. The "real" source of names is Lemon claims;
// this util only fills the gap so we can call them too.
//
// Rules (conservative — false negatives over false positives):
//
//   1. email with no `@` or empty local part           → null
//   2. local-part contains digits (juan99, flopa84)    → null   (too noisy)
//   3. local-part < 3 chars                            → null
//   4. local-part has "." or "_" separator             → split + capitalize
//                                                        (only first two parts;
//                                                         extras concatenate
//                                                         into lastName)
//   5. local-part is pure alpha (≥ 3 chars)            → see manual override
//      table; if present, use that mapping. Otherwise
//      return null so the agent uses the neutral greeting.
//
// We intentionally do NOT try to split concatenated strings like
// "vazquezgonzalezjonathanalexis" automatically — without an NER model or a
// curated AR-names dictionary, every heuristic will mis-split ~80% of cases
// and Sofía saying a wrong name is worse than no name at all.

export interface DerivedName {
  firstName: string;
  lastName: string | null;
  source: 'email_separator' | 'manual_override';
}

/**
 * Manually-validated overrides for pure-alpha local-parts where the human
 * eye can split the string but no algorithm can do it reliably. Keys are the
 * lowercased local-part; values are the {firstName, lastName} split.
 *
 * Maintain this map in this file (it's tiny — single-digit entries today).
 * Add entries here after a manual review of `audit-debtor-data`'s Tier 3
 * sample output.
 */
const MANUAL_OVERRIDES: Record<
  string,
  { firstName: string; lastName: string | null }
> = {
  // T3-claros del audit del 2026-05-19 (validados a ojo por Fabián):
  alexanderabantot: { firstName: 'Alexander', lastName: 'Abanto' },
  dylanurielrey: { firstName: 'Dylan Uriel', lastName: 'Rey' },
  maximilianochuliver: { firstName: 'Maximiliano', lastName: 'Chuliver' },
  fernandobarral: { firstName: 'Fernando', lastName: 'Barral' },
  vazquezgonzalezjonathanalexis: {
    firstName: 'Jonathan Alexis',
    lastName: 'Vázquez González',
  },
  ceciliavaldiviezo: { firstName: 'Cecilia', lastName: 'Valdiviezo' },
  lucasgastonaros: { firstName: 'Lucas Gastón', lastName: 'Aros' },
  luisvelardealarcon: { firstName: 'Luis', lastName: 'Velarde Alarcón' },
  artazaestebanjose: { firstName: 'Esteban José', lastName: 'Artaza' },
  diazpalisajulioemilio: { firstName: 'Julio Emilio', lastName: 'Díaz Palisa' },
  // T3-probables (validar antes de promover; comentar si Fabián no los confirma):
  // cisneemanu: { firstName: 'Manuel', lastName: 'Cisne' },
  // franbrunobauti: { firstName: 'Fran Bruno', lastName: 'Bauti' },
  // guscollantes: { firstName: 'Gustavo', lastName: 'Collantes' },
};

const capitalize = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();

const capitalizeWords = (s: string): string =>
  s.split(/\s+/).filter(Boolean).map(capitalize).join(' ');

export function deriveNameFromEmail(
  email: string | null | undefined,
): DerivedName | null {
  if (!email) return null;
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return null;
  const local = email.slice(0, atIdx).toLowerCase().trim();
  if (local.length < 3) return null;
  if (/\d/.test(local)) return null;

  // Rule 4: separator-based split
  if (/[._]/.test(local)) {
    const parts = local.split(/[._]+/).filter(Boolean);
    if (parts.length === 0) return null;
    const firstName = capitalize(parts[0]);
    const lastName =
      parts.length >= 2 ? capitalizeWords(parts.slice(1).join(' ')) : null;
    return { firstName, lastName, source: 'email_separator' };
  }

  // Rule 5: pure-alpha → manual override only
  const override = MANUAL_OVERRIDES[local];
  if (override) {
    return {
      firstName: override.firstName,
      lastName: override.lastName,
      source: 'manual_override',
    };
  }

  return null;
}

/**
 * Convenience: returns the email local-part as a "username" fallback, useful
 * for the agent's neutral greeting ("a nombre de usuario X"). Returns null if
 * the email is invalid.
 */
export function extractUsername(email: string | null | undefined): string | null {
  if (!email) return null;
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return null;
  const local = email.slice(0, atIdx).trim();
  return local.length > 0 ? local : null;
}
