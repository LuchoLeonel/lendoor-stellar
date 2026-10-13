# Review — PR #8: exportar la clave de la wallet embebida (autocustodia D1.2)

**Fecha:** 2026-10-12 · **Review hecha ANTES del push** (regla del equipo desde el 12/10).
**Alcance:** 3 archivos de frontend, 75 inserciones / 14 borrados. Sin cambios de backend,
sin cambios de contratos, sin media nueva.

## Qué agrega y por qué

El onboarding de D1.2 crea una wallet Stellar embebida de Privy. Para que eso
sea autocustodia de verdad (y no custodia cautiva), el usuario tiene que poder
llevarse su clave. Privy expone eso vía `useExportWallet` de
`@privy-io/react-auth/extended-chains` (3.48.0, ya instalada): abre el modal
seguro de Privy y el usuario copia la **clave privada** de su wallet. Nota
honesta: para wallets embebidas Privy exporta la clave privada, no un mnemonic
de 12 palabras — la garantía de autocustodia es la misma (con la clave se
importa la cuenta en cualquier wallet Stellar).

## Archivo por archivo

### `frontend/src/providers/PrivyStellarProvider.tsx` (+19/−2)
- Importa `useExportWallet` junto a los hooks extended-chains ya usados.
- El contexto expone `exportPrivyWallet(): Promise<void>`: tira error claro si
  no hay sesión Privy; si hay, `await exportWallet({ address: privyAddress })`.
- El default del contexto (provider no montado) solo loguea un warning — mismo
  patrón que `loginWithPrivy`.
- `exportWallet` entra a las deps del `useMemo`.

**Seguridad:** la clave vive en el iframe cross-origin de Privy; la app (y
cualquier cosa que corra en ella) nunca la ve. Este cambio solo dispara la
apertura del modal.

### `frontend/src/components/common/WebAuthArea.tsx` (+39 netos con refactor)
- Rama `mode === 'stellar'`: calcula `isPrivyWallet = address === privyAddress`.
- El chip ahora etiqueta bien el firmante: `Privy G…` / `Freighter G…`
  (antes decía "Freighter" para todos — bug de etiqueta).
- Si la wallet activa es la de Privy, aparece el botón **"Exportar clave"**
  que llama `exportPrivyWallet()`. Para Freighter no aparece (la extensión ya
  tiene su propio export).

### `frontend/src/components/common/Header.tsx` (+31/−1)
- Antes: `if (isMiniApp || mode === 'stellar') return null;` — en modo Stellar
  no había header, así que el export no tenía dónde vivir.
- Ahora: miniapp sigue sin header; en Stellar se renderiza una variante slim
  (marca + `WebAuthArea` en Suspense), sin la nav ni el área USDC que son
  EVM-céntricas. Celo/Lemon/Farcaster: sin cambios.

## Verificación

- **Suite:** `VITE_CHAIN_MODE= VITE_FREIGHTER_DISABLED= yarn vitest run` →
  **442/442 verde** (env neutralizado por el gotcha de `.env` local).
- **TypeScript:** `tsc -b` da exactamente los mismos 150 errores pre-existentes
  de `packages/vault-client` (bindings generados vs stellar-sdk instalado) con
  y sin este diff → el diff agrega 0 errores.
- **En vivo (sesión real contra el backend de staging):** el header slim
  muestra `Privy GBV3Q...32V4Q` + "Exportar clave"; el click abre el modal
  "Export wallet" de Privy. Se cerró con Escape sin exportar. **No se
  screenshoteó el modal** a propósito: la clave no debe entrar a ningún
  contexto de herramientas.

## Riesgos considerados

- ¿Puede la app leer la clave? No — iframe de Privy, otro origen.
- ¿Afecta Celo/Lemon/Farcaster? No — el provider no se monta fuera de modo
  Stellar y el header de miniapp sigue devolviendo null.
- ¿Rompe el flujo Freighter? No — sin sesión Privy, `privyAddress` es null,
  el chip dice Freighter y el botón de export no se renderiza.
