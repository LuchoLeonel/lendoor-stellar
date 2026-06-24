/**
 * LemonShell — MemoryRouter wrapper for Lemon Cash WebView.
 *
 * Replaces BrowserRouter so React Router never touches window.history,
 * giving useHistoryBackGuard exclusive ownership of the browser history
 * stack. This prevents the back button from closing the mini-app.
 */
import { type PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router-dom'

export function LemonShell({ children }: PropsWithChildren) {
  return (
    <MemoryRouter initialEntries={['/borrow']} initialIndex={0}>
      {children}
    </MemoryRouter>
  )
}
