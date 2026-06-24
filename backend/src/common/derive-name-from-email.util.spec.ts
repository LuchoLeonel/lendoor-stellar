// src/common/derive-name-from-email.util.spec.ts
import {
  deriveNameFromEmail,
  extractUsername,
} from './derive-name-from-email.util';

describe('deriveNameFromEmail', () => {
  describe('null cases (reject)', () => {
    test.each([
      ['null', null],
      ['undefined', undefined],
      ['empty', ''],
      ['no @', 'fabiandiaz'],
      ['@ at start', '@gmail.com'],
      ['too short local', 'ab@gmail.com'],
      ['local with digits', 'juan99@gmail.com'],
      ['local with digits anywhere', 'a1b@gmail.com'],
      ['local with digits and separator', 'juan.perez99@gmail.com'],
      ['pure alpha not in override', 'tonchozaidan@gmail.com'],
    ])('rejects %s', (_label, input) => {
      expect(deriveNameFromEmail(input)).toBeNull();
    });
  });

  describe('separator-based derivation', () => {
    test('dot separator → firstName + lastName', () => {
      expect(deriveNameFromEmail('fabian.diaz@gmail.com')).toEqual({
        firstName: 'Fabian',
        lastName: 'Diaz',
        source: 'email_separator',
      });
    });

    test('underscore separator → firstName + lastName', () => {
      expect(deriveNameFromEmail('juan_perez@hotmail.com')).toEqual({
        firstName: 'Juan',
        lastName: 'Perez',
        source: 'email_separator',
      });
    });

    test('multi-part dot → firstName + concatenated lastName', () => {
      expect(deriveNameFromEmail('juan.carlos.perez@gmail.com')).toEqual({
        firstName: 'Juan',
        lastName: 'Carlos Perez',
        source: 'email_separator',
      });
    });

    test('mixed dot+underscore separators', () => {
      expect(deriveNameFromEmail('maria_jose.lopez@gmail.com')).toEqual({
        firstName: 'Maria',
        lastName: 'Jose Lopez',
        source: 'email_separator',
      });
    });

    test('only firstName (no second part)', () => {
      expect(deriveNameFromEmail('fabian.@gmail.com')).toEqual({
        firstName: 'Fabian',
        lastName: null,
        source: 'email_separator',
      });
    });

    test('uppercase normalized', () => {
      expect(deriveNameFromEmail('JUAN.PEREZ@GMAIL.COM')).toEqual({
        firstName: 'Juan',
        lastName: 'Perez',
        source: 'email_separator',
      });
    });
  });

  describe('manual override (pure alpha)', () => {
    test('known override returns mapped name', () => {
      expect(deriveNameFromEmail('alexanderabantot@gmail.com')).toEqual({
        firstName: 'Alexander',
        lastName: 'Abanto',
        source: 'manual_override',
      });
    });

    test('override case-insensitive', () => {
      expect(deriveNameFromEmail('DylanUrielRey@gmail.com')).toEqual({
        firstName: 'Dylan Uriel',
        lastName: 'Rey',
        source: 'manual_override',
      });
    });

    test('unknown pure-alpha returns null (no false positive)', () => {
      expect(deriveNameFromEmail('tonchozaidan@gmail.com')).toBeNull();
    });
  });
});

describe('extractUsername', () => {
  test('returns local part', () => {
    expect(extractUsername('juan.perez@gmail.com')).toBe('juan.perez');
  });

  test('preserves case', () => {
    expect(extractUsername('Juan.Perez@gmail.com')).toBe('Juan.Perez');
  });

  test('null/empty', () => {
    expect(extractUsername(null)).toBeNull();
    expect(extractUsername(undefined)).toBeNull();
    expect(extractUsername('')).toBeNull();
    expect(extractUsername('@gmail.com')).toBeNull();
  });
});
