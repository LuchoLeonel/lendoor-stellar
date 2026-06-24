/**
 * History guard for Lemon Cash WebView back button.
 *
 * El botón "atrás" nativo de Lemon dispara `popstate` sobre el WebView. Este
 * guard lo intercepta y delega en `onBack`, que devuelve:
 *   - `true`  → "lo manejé" (cerré una cortina / volví a inicio) → se re-protege
 *               (se vuelve a empujar un sentinel) y la app NO sale.
 *   - `false` → "no había nada que cerrar y ya estoy en inicio".
 *
 * Salida con DOBLE tap (en inicio, nada abierto):
 *   - 1er tap: se muestra el hint y se DESPROTEGE (no se re-empuja el sentinel),
 *     dejando el cursor en la entrada-borde. Un timeout re-protege si el user
 *     no confirma, para no salir por accidente más tarde.
 *   - 2do tap (dentro de la ventana): como ya NO hay sentinel adelante, el back
 *     nativo llega al borde del history y Lemon cierra el mini-app.
 *
 * (Antes se hacía `history.back()` en el 2do tap, pero en el borde es un no-op
 *  → salía recién en el 3er tap. Por eso ahora se desprotege en el 1ero.)
 */
import { useEffect, useRef } from 'react'

export function useHistoryBackGuard(opts: {
  /** Maneja el back. true = consumido (no salir); false = raíz sin nada que
      cerrar (habilita el doble-tap de salida). */
  onBack: () => boolean
  namespace?: string
  /** Ventana (ms) para el doble-tap de salida. Default 2000. */
  exitWindowMs?: number
  /** Se llama en el PRIMER tap en la raíz (para mostrar "tocá de nuevo para salir"). */
  onArmExit?: () => void
}) {
  const { onBack, namespace = 'app', exitWindowMs = 2000, onArmExit } = opts

  // Refs a los callbacks para que el listener de popstate se suscriba UNA vez
  // (deps estables) y no se re-suscriba en cada render — si no, un re-render
  // durante la ventana cancelaría el timer de re-protección.
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const onArmExitRef = useRef(onArmExit)
  onArmExitRef.current = onArmExit

  const armedAt = useRef(0)
  const seeded = useRef(false)
  const rearmTimer = useRef<number | null>(null)

  // Sentinel inicial: sin esto el primer back saldría del WebView. Guard con
  // ref para empujar UNA sola vez aunque StrictMode (dev) re-monte el efecto.
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    window.history.pushState({ ns: namespace }, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const protect = () => window.history.pushState({ ns: namespace }, '')
    const clearRearm = () => {
      if (rearmTimer.current) { window.clearTimeout(rearmTimer.current); rearmTimer.current = null }
    }

    const handler = (e: PopStateEvent) => {
      const s = e.state as { ns?: string } | null
      if (s?.ns && s.ns !== namespace) return

      const handled = onBackRef.current()
      if (handled) {
        armedAt.current = 0
        clearRearm()
        protect() // re-proteger: el próximo back se vuelve a interceptar
        return
      }

      // Raíz, nada que cerrar.
      const now = Date.now()
      if (armedAt.current && now - armedAt.current < exitWindowMs) {
        // 2do tap dentro de la ventana → NO re-proteger. El pop ya nos dejó en
        // la entrada-borde; este gesto nativo llega al límite y Lemon cierra.
        armedAt.current = 0
        clearRearm()
        return
      }

      // 1er tap en la raíz → armar + hint, y NO re-proteger (quedamos en el
      // borde para que el 2do back nativo salga). Re-proteger tras la ventana.
      armedAt.current = now
      onArmExitRef.current?.()
      clearRearm()
      rearmTimer.current = window.setTimeout(() => {
        armedAt.current = 0
        rearmTimer.current = null
        protect()
      }, exitWindowMs)
    }

    window.addEventListener('popstate', handler)
    return () => { window.removeEventListener('popstate', handler); clearRearm() }
  }, [namespace, exitWindowMs])
}
