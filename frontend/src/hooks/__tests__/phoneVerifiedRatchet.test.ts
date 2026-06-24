/**
 * Pure logic test for the one-way phoneVerified ratchet in useOnBoardingFlow.ts.
 *
 * The relevant code from updateJourneyFromResponse (line ~173):
 *
 *   // Phone — only set to true, never reset to false from a journey response
 *   if (data.phoneVerified === true) setPhoneVerified(true);
 *
 * The ratchet guarantees: once phoneVerified becomes true it can never go back to
 * false just because a later journey response omits or explicitly sends false.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helper that mirrors the ratchet logic in updateJourneyFromResponse
// ---------------------------------------------------------------------------

function applyPhoneVerifiedRatchet(
  current: boolean,
  fromResponse: boolean | undefined,
): boolean {
  if (fromResponse === true) return true;
  return current; // never reset to false
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyPhoneVerifiedRatchet — one-way phoneVerified ratchet', () => {
  describe('setting to true', () => {
    it('sets true when response has phoneVerified=true (current is false)', () => {
      expect(applyPhoneVerifiedRatchet(false, true)).toBe(true);
    });

    it('sets true from false when response has phoneVerified=true', () => {
      expect(applyPhoneVerifiedRatchet(false, true)).toBe(true);
    });

    it('keeps true when response also has phoneVerified=true (idempotent)', () => {
      expect(applyPhoneVerifiedRatchet(true, true)).toBe(true);
    });
  });

  describe('never resetting from true', () => {
    it('keeps true when response has phoneVerified=false (never resets)', () => {
      expect(applyPhoneVerifiedRatchet(true, false)).toBe(true);
    });

    it('keeps true when response has phoneVerified=undefined', () => {
      expect(applyPhoneVerifiedRatchet(true, undefined)).toBe(true);
    });
  });

  describe('staying false', () => {
    it('keeps false when response has phoneVerified=false', () => {
      expect(applyPhoneVerifiedRatchet(false, false)).toBe(false);
    });

    it('keeps false when response has phoneVerified=undefined', () => {
      expect(applyPhoneVerifiedRatchet(false, undefined)).toBe(false);
    });
  });

  describe('ratchet property', () => {
    it('true is an absorbing state — no sequence of non-true responses can undo it', () => {
      let state = false;

      // Becomes true
      state = applyPhoneVerifiedRatchet(state, true);
      expect(state).toBe(true);

      // Subsequent false / undefined responses cannot revert it
      state = applyPhoneVerifiedRatchet(state, false);
      expect(state).toBe(true);

      state = applyPhoneVerifiedRatchet(state, undefined);
      expect(state).toBe(true);

      state = applyPhoneVerifiedRatchet(state, false);
      expect(state).toBe(true);
    });

    it('false stays false through any number of non-true responses', () => {
      let state = false;

      state = applyPhoneVerifiedRatchet(state, undefined);
      state = applyPhoneVerifiedRatchet(state, false);
      state = applyPhoneVerifiedRatchet(state, undefined);

      expect(state).toBe(false);
    });
  });
});
