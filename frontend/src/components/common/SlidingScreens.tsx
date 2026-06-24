'use client'

import * as React from 'react'

type SlidingScreensProps = {
  viewKey: string
  children: React.ReactNode
}

/**
 * Slider genérico entre pantallas del flujo.
 *
 * Cada vez que cambia `viewKey`:
 * - guarda la vista anterior en `prev`
 * - pone la nueva en `current`
 * - hace slide de prev -> current con translate-x
 */
export default function SlidingScreens({ viewKey, children }: SlidingScreensProps) {
  type State = {
    currentKey: string
    current: React.ReactNode
    prev: React.ReactNode | null
    sliding: boolean
  }

  const [state, setState] = React.useState<State>({
    currentKey: viewKey,
    current: children,
    prev: null,
    sliding: false,
  })

  React.useEffect(() => {
    // 1) Actualizamos el estado según el nuevo viewKey
    setState(prevState => {
      // Misma pantalla, solo refrescamos contenido
      if (viewKey === prevState.currentKey) {
        return { ...prevState, current: children }
      }

      // Nueva pantalla → prev = lo que había, current = children, sliding arranca en false
      return {
        currentKey: viewKey,
        current: children,
        prev: prevState.current,
        sliding: false,
      }
    })

    // 2) En el próximo frame activamos la animación
    const frameId: number = window.requestAnimationFrame(() => {
      setState(prevState =>
        prevState.prev
          ? { ...prevState, sliding: true }
          : prevState
      )
    })

    // 3) Al terminar la animación limpiamos prev y apagamos sliding
    const timerId: number = window.setTimeout(() => {
      setState(prevState => ({
        currentKey: prevState.currentKey,
        current: prevState.current,
        prev: null,
        sliding: false,
      }))
    }, 500) // mismo duration que la clase de Tailwind

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timerId)
    }
  }, [viewKey, children])

  const { prev, current, sliding } = state

  // Primera carga o sin transición: solo mostramos la vista actual
  if (!prev) {
    return (
      <div className="relative overflow-x-hidden">
        <div className="w-full">{current}</div>
      </div>
    )
  }

  // Con transición: prev + current uno al lado del otro y hacemos slide
  return (
    <div className="relative overflow-x-hidden">
      <div
        className={`flex w-[200%] ${
          sliding ? 'transition-transform duration-500 ease-in-out -translate-x-1/2' : ''
        }`}
      >
        <div className="w-1/2 shrink-0">{prev}</div>
        <div className="w-1/2 shrink-0">{current}</div>
      </div>
    </div>
  )
}
