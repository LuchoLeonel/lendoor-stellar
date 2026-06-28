// ================== AUTH FETCH HELPERS ==================

export type AuthFetchOptions = Omit<RequestInit, "headers"> & {
  headers?: HeadersInit;
  /** Función que ya viene de useUser() y renueva el token si hace falta */
  refreshAccessToken: () => Promise<string | null>;
};

export type AuthFetchResult = {
  res: Response | null;
  /** true si no pudimos validar sesión (no token / token vencido incluso tras refresh) */
  authFailed: boolean;
};

// Deduplicates concurrent refreshAccessToken calls so only one refresh
// runs at a time. Subsequent callers reuse the in-flight promise.
let inflightRefresh: Promise<string | null> | null = null;
const DEBUG_AUTH = import.meta.env.VITE_DEBUG_AUTH === "true";

function debugAuth(...args: unknown[]) {
  if (DEBUG_AUTH) console.log(...args);
}

function deduplicatedRefresh(
  refreshFn: () => Promise<string | null>,
): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = refreshFn().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("lendoor:accessToken");
  } catch {
    return null;
  }
}

/**
 * Hace fetch agregando Authorization Bearer <token> leyendo el token de localStorage.
 *
 * Comportamiento:
 *  - Si NO hay token, intenta primero refreshAccessToken() ANTES del primer fetch.
 *    - Si refreshAccessToken() devuelve null, hace un fetch SIN token y NO marca authFailed.
 *  - SOLO para 401 intenta refresh y marca authFailed si, luego de refrescar token, sigue siendo 401.
 *  - 403 se trata como error de negocio, NO como error de sesión.
 *
 * No tira toasts, sólo te devuelve:
 *  - res: Response | null
 *  - authFailed: true si no se pudo arreglar el tema de auth (token realmente inválido tras retry)
 */
export async function fetchWithAuthRetry(
  input: string | URL,
  options: AuthFetchOptions,
): Promise<AuthFetchResult> {
  const { refreshAccessToken, headers, ...rest } = options;

  const urlStr = typeof input === "string" ? input : (input as URL).toString();
  debugAuth("[fetchWithAuthRetry] start", urlStr);

  const baseHeaders: Record<string, string> = {};

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      baseHeaders[key] = value;
    });
  } else if (headers && typeof headers === "object") {
    Object.assign(baseHeaders, headers as Record<string, string>);
  }

  const buildHeaders = (token: string | null) => {
    const h: Record<string, string> = { ...baseHeaders };
    if (token) {
      h.Authorization = `Bearer ${token}`;
    }
    return h;
  };

  const doFetch = async (token: string | null): Promise<Response | null> => {
    try {
      return await fetch(input, {
        ...rest,
        headers: buildHeaders(token),
      });
    } catch (e) {
      console.error("[fetchWithAuthRetry] network error", e);
      return null;
    }
  };

  let token = getStoredAccessToken();
  let didInitialRefresh = false;

  // 1) Si no hay token, intentamos refresh ANTES de pegarle al back
  if (!token) {
    debugAuth("[fetchWithAuthRetry] no token in storage, refreshing...");
    token = await deduplicatedRefresh(refreshAccessToken);
    didInitialRefresh = true;

    if (!token) {
      debugAuth(
        "[fetchWithAuthRetry] refreshAccessToken returned null → doing unauthenticated request",
      );
      // Intento sin Authorization; el caller verá el 401/403 como error de negocio
      const res = await doFetch(null);
      return { res, authFailed: false };
    }
  } else {
    debugAuth("[fetchWithAuthRetry] using token from storage");
  }

  // 2) Primer intento
  const res = await doFetch(token);

  if (!res) {
    // error de red → no es authFailed, el caller decide qué hacer
    return { res: null, authFailed: false };
  }

  debugAuth(
    "[fetchWithAuthRetry] first response",
    res.status,
    res.statusText,
  );

  // ✅ Si NO es 401, lo devolvemos tal cual.
  //    MUY IMPORTANTE: 403 YA NO SE TRATA COMO ERROR DE SESIÓN.
  if (res.status !== 401) {
    return { res, authFailed: false };
  }

  // 3) 401 → problema de sesión/token.
  // Si ya habíamos hecho refresh antes del primer fetch, no reintentamos (evitar loops).
  if (didInitialRefresh) {
    console.warn(
      "[fetchWithAuthRetry] 401 even after initial refresh → authFailed true",
    );
    return { res, authFailed: true };
  }

  debugAuth("[fetchWithAuthRetry] 401, trying refreshAccessToken...");
  const fresh = await deduplicatedRefresh(refreshAccessToken);

  if (!fresh) {
    debugAuth(
      "[fetchWithAuthRetry] refreshAccessToken returned null after 401 → caller sees business error",
    );
    // Dejamos que el caller trate el 401 como error de negocio, no como authFailed duro.
    return { res, authFailed: false };
  }

  token = fresh;

  // 4) Segundo intento con token renovado
  const res2 = await doFetch(token);

  if (!res2) {
    // de nuevo, error de red → que lo maneje el caller
    return { res: null, authFailed: false };
  }

  debugAuth(
    "[fetchWithAuthRetry] second response",
    res2.status,
    res2.statusText,
  );

  if (res2.status === 401) {
    // Seguimos sin poder validar sesión incluso después de un refresh exitoso del token
    return { res: res2, authFailed: true };
  }

  // Aunque sea 403 u otro código, en este punto YA NO lo consideramos authFailed
  return { res: res2, authFailed: false };
}
