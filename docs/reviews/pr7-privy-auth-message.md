# Review PR #7 — D1.2: auth de backend firmable por Privy

**Fecha:** 2026-10-12 · **Alcance:** `frontend/src/lib/{privy-signer,stellar-signer-registry,stellar-wallet}.ts`, `useRefreshAccessToken.ts`, `PrivyStellarProvider.tsx` · **Método:** sin asunciones; el requisito se leyó del award y el bug se reprodujo en vivo antes de tocar código.

## El bug (reproducido, no asumido)

Con Freighter instalado, el dev server mostraba `Using Stellar Freighter auth flow` + timeout de 12s; leyendo el camino: `signFreighterMessage` hardcodeado en el hook. Un usuario Privy sin extensión (la historia de D1.2) muere ahí: nunca obtiene token y el onboarding no arranca. El puente de Privy (`makePrivySigner`) solo cubría el sobre de transacciones.

## Qué se verificó contra qué

- **La construcción exacta del verify** se leyó de `backend/src/auth/auth.service.ts`: ed25519 (base64, 64 bytes) sobre `sha256("Stellar Signed Message:\n" + mensaje utf8)`. El test de paridad replica ESA construcción literal (node:crypto) y verifica la firma que produce el puente — si una punta cambia, revienta el test.
- **Orden de efectos (carrera real observada):** el registro del firmante de Privy corre en un efecto del provider (padre), que React ejecuta DESPUÉS de los efectos de los hijos en el mismo commit. En vivo se vio el log `signer=freighter` con firma que el backend verificó como de Privy: el flush síncrono de efectos termina antes de que vuelva el fetch del nonce, así que al momento de FIRMAR el firmante ya es Privy. Mitigaciones: el kind se loguea después de firmar, y el firmante de Privy rechaza firmar para una address ajena (guardia explícita).
- **`VITE_FREIGHTER_DISABLED` default apagado:** sin la var (CI, prod) nada cambia; la suite pasa 442/442 con el env neutralizado. 🔴 Gotcha de la máquina local: el `.env` del demo se filtra a vitest (y el del backend a jest) — fallos "fantasma" si no se neutraliza la var.
- **tsc:** este frontend no tiene baseline limpio (150 errores preexistentes, 19 en vault-client generado); 0 errores nuevos en los archivos tocados. El gate real es vitest.

## Prueba e2e on-chain (la de verdad)

Login Privy → `/auth/stellar/verify` OK contra el backend vivo → `changeTrust` `921a72c4…` y `vault.deposit` `49ab280b…` firmados por la wallet embebida (`GBV3QPJM…SET32V4Q`). Detalle completo en `docs/deliverables/scf-tranche1/d1.2-privy-evidencia.md`.
