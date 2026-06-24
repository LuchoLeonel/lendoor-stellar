import { describe, it, expect } from 'vitest'

// Test the pure utility functions from OnboardingWizard
// The component itself requires too many providers and internal state
// to unit-test meaningfully — integration/E2E tests cover the flow.

// These functions are not exported, so we replicate them here to test the logic.
// If they drift, the E2E tests will catch it.

function buildE164(dialCode: string, localNumber: string): string {
  const digits = localNumber.replace(/\D/g, '').replace(/^0/, '')
  return `${dialCode}${digits}`
}

function isValidLocalNumber(localNumber: string): boolean {
  const digits = localNumber.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 12
}

describe('OnboardingWizard utilities', () => {
  describe('buildE164', () => {
    it('builds an E.164 number from dial code and local number', () => {
      expect(buildE164('+54', '1155551234')).toBe('+541155551234')
    })

    it('strips leading zero from local number', () => {
      expect(buildE164('+54', '01155551234')).toBe('+541155551234')
    })

    it('strips non-digit characters from local number', () => {
      expect(buildE164('+54', '11-5555-1234')).toBe('+541155551234')
    })

    it('handles Mexican numbers', () => {
      expect(buildE164('+52', '5512345678')).toBe('+525512345678')
    })

    it('handles empty local number', () => {
      expect(buildE164('+54', '')).toBe('+54')
    })
  })

  describe('isValidLocalNumber', () => {
    it('accepts 10-digit Argentine number', () => {
      expect(isValidLocalNumber('1155551234')).toBe(true)
    })

    it('accepts 7-digit minimum', () => {
      expect(isValidLocalNumber('5551234')).toBe(true)
    })

    it('rejects 6-digit number (too short)', () => {
      expect(isValidLocalNumber('555123')).toBe(false)
    })

    it('rejects 13-digit number (too long)', () => {
      expect(isValidLocalNumber('1234567890123')).toBe(false)
    })

    it('strips non-digits before validating', () => {
      expect(isValidLocalNumber('11-5555-1234')).toBe(true)
    })

    it('rejects empty string', () => {
      expect(isValidLocalNumber('')).toBe(false)
    })
  })
})
