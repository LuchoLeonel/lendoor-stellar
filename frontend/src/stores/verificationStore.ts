import { create } from "zustand";

type VerificationState = {
  isVerified: boolean;
  goToWaitlist: boolean;
  hasAcceptedTerms: boolean;
  setIsVerified: (value: boolean) => void;
  setGoToWaitlist: (value: boolean) => void;
  setHasAcceptedTerms: (value: boolean) => void;
  reset: () => void;
};

export const useVerificationStore = create<VerificationState>((set) => ({
  isVerified: false,
  goToWaitlist: false,
  hasAcceptedTerms: false,

  setIsVerified: (value) => set({ isVerified: value }),
  setGoToWaitlist: (value) => set({ goToWaitlist: value }),
  setHasAcceptedTerms: (value) => set({ hasAcceptedTerms: value }),

  reset: () =>
    set({
      isVerified: false,
      goToWaitlist: false,
      hasAcceptedTerms: false,
    }),
}));
