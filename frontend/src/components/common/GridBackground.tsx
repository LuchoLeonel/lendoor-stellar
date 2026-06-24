"use client";

// UX redesign (rama ux-ui-redesign): la grilla de fondo se removió de todas
// las pantallas. Este componente queda como no-op para no tener que tocar
// todos los call-sites (SplashLoader, BorrowMarket, PrestarTab, etc.).
// Si se quiere restaurar, revertir este archivo.
export function GridBackground() {
  return null;
}
