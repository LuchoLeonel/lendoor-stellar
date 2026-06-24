/**
 * Tests for the getBrowserLanguage helper from useTranslation.ts.
 *
 * The function is not exported, so we re-implement the exact logic here and
 * test it in isolation — the same approach used for the onboardingFlow screen
 * key logic in hooks/__tests__/onboardingFlow.test.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mirror of the private helper in useTranslation.ts
function getBrowserLanguage(): 'es' | 'en' {
  const lang =
    navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || 'en';
  return lang.startsWith('es') ? 'es' : 'en';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getBrowserLanguage', () => {
  describe('Spanish detection', () => {
    it('returns "es" for navigator.language = "es"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('es');
      expect(getBrowserLanguage()).toBe('es');
    });

    it('returns "es" for navigator.language = "es-AR"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-AR');
      expect(getBrowserLanguage()).toBe('es');
    });

    it('returns "es" for navigator.language = "es-MX"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-MX');
      expect(getBrowserLanguage()).toBe('es');
    });

    it('returns "es" for navigator.language = "es-ES"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES');
      expect(getBrowserLanguage()).toBe('es');
    });
  });

  describe('English (fallback) detection', () => {
    it('returns "en" for navigator.language = "en"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en');
      expect(getBrowserLanguage()).toBe('en');
    });

    it('returns "en" for navigator.language = "en-US"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      expect(getBrowserLanguage()).toBe('en');
    });

    it('returns "en" for navigator.language = "pt-BR"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-BR');
      expect(getBrowserLanguage()).toBe('en');
    });

    it('returns "en" for navigator.language = "fr"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr');
      expect(getBrowserLanguage()).toBe('en');
    });

    it('returns "en" for navigator.language = "zh-CN"', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
      expect(getBrowserLanguage()).toBe('en');
    });
  });

  describe('edge cases', () => {
    it('returns "en" when navigator.language is an empty string', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('');
      expect(getBrowserLanguage()).toBe('en');
    });

    it('does not accidentally match "en-ES" as Spanish', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-ES');
      expect(getBrowserLanguage()).toBe('en');
    });
  });
});
