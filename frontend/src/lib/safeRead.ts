// src/lib/safeRead.ts
'use client'

import { toast } from 'sonner'

type Opts = {
  /** mostrar toast en error (default: false) */
  toastOnError?: boolean
  /** timeout en ms (default: 3500) */
  timeoutMs?: number
  /** mapear error -> string legible */
  mapError?: (e: unknown) => string
}

/**
 * safeRead: envuelve lecturas on-chain para que NUNCA rompan el render.
 * - Aplica timeout
 * - Devuelve fallback en error
 * - Loguea el último error visible en window.__LENDOOR_LAST_ERROR
 * - Opcionalmente muestra toast (sólo si la pestaña está visible)
 */
export async function safeRead<T>(
  fn: () => Promise<T>,
  fallback: T,
  tag: string,
  opts: Opts = {},
): Promise<T> {
  const {
    toastOnError = false,          // 👈 ahora por default NO muestra toast
    timeoutMs = 3500,
    mapError = (e) =>
      e?.shortMessage ||
      e?.reason ||
      e?.message ||
      String(e) ||
      'read failed',
  } = opts

  const run = (async () => fn())()
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`timeout after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })

  try {
    const result = (await Promise.race([run, timeout])) as T
    clearTimeout(timer!)
    return result
  } catch (e: unknown) {
    clearTimeout(timer!)
    const msg = mapError(e)

    // guardamos algo de debug global (para vos dev)
    try {
      ;(window as unknown as Record<string, unknown>).__LENDOOR_LAST_ERROR = {
        tag,
        msg,
        at: Date.now(),
        raw: String(e),
      }
    } catch {
      // ignore
    }

    // Sólo mostramos toast si:
    // - decidiste mostrar toasts
    // - y la pestaña está visible (mini app en foreground)
    const isVisible =
      typeof document !== 'undefined'
        ? document.visibilityState === 'visible'
        : true

    if (toastOnError && isVisible) {
      toast.error('Algo salió mal. Intentá de nuevo.')
    }

    return fallback
  }
}
