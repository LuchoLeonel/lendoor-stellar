import { create } from "zustand";

type AuthState = {
  accessToken: string | null;
  authLoading: boolean;
  setAccessToken: (token: string | null) => void;
  setAuthLoading: (loading: boolean) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: (() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("lendoor:accessToken");
    } catch {
      return null;
    }
  })(),
  authLoading: false,

  setAccessToken: (token) => {
    set({ accessToken: token });
    if (typeof window !== "undefined") {
      try {
        if (token) {
          localStorage.setItem("lendoor:accessToken", token);
        } else {
          localStorage.removeItem("lendoor:accessToken");
        }
      } catch {
        // ignore
      }
    }
  },

  setAuthLoading: (loading) => set({ authLoading: loading }),

  clearAuth: () => {
    set({ accessToken: null, authLoading: false });
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("lendoor:accessToken");
        localStorage.removeItem("lendoor:tokenWallet");
      } catch {
        // ignore
      }
    }
  },
}));
