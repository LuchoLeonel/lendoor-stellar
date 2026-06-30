// Modo mock para previsualizar/testear flujos SIN tx real. El valor del query
// param queda en sessionStorage para sobrevivir la navegación.
//   ?mockTx=1 → flujo de demo (sin tx real)

export function mockTxParam(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const u = new URLSearchParams(window.location.search).get('mockTx');
    if (u) sessionStorage.setItem('lendoor.mockTx', u);
    return sessionStorage.getItem('lendoor.mockTx');
  } catch {
    return new URLSearchParams(window.location.search).get('mockTx');
  }
}

export function isMockTx(): boolean {
  return !!mockTxParam();
}
