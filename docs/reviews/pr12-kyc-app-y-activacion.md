# Review — KYC en la app, activación de wallet Privy, historial real (SCF #45 T1)

**Fecha:** 2026-10-20 · Review hecha ANTES del push (workflow de 5 agentes en modo
lectura + correcciones aplicadas y re-verificadas).

## Qué entra

**Frontend**
- `KycVerificationModal.tsx` (nuevo): verificación de identidad **de demo** (cámara
  real → documento + selfie → `POST /kyc/start` → decisión del sandbox →
  confirma el estado persistido con `GET /kyc/status`). Rotulado "Demo testnet":
  las fotos no salen del navegador; en testnet el proveedor es el fake del port.
- `PrestarTab.tsx`: el gate de KYC envuelve `confirmTermAndBorrow` (el único
  camino real al `POST /loan/borrow`). Pregunta siempre al backend; si
  `required: false` (flag apagado) no pide nada.
- `stellar-account-activation.ts` (nuevo) + `PrivyStellarProvider.tsx`: al loguear
  una wallet Privy en **testnet**, la activa sola: friendbot si la cuenta no
  existe, y `change_trust(USDC)` firmado por la wallet si falta. No-op en mainnet
  y si ya está lista. Sin esto, una wallet nueva no puede recibir el préstamo.
- `BorrowMarket.tsx` / `RecentActivity.tsx`: la actividad sale de
  `GET /loan/history`; el relleno de diseño queda apagado por default.
- `Dockerfile.stellar`: apunta al par de la submission (vault `CCXUEBC3…`, loan
  manager `CB4QQU2J…`, USDC de Circle `CBIELTK6…`) y recibe `VITE_PRIVY_APP_ID`.

**Backend**
- El gate de KYC corre **solo** en `LoanService.borrow` (la acción). Se quitó de
  `/loan/verify`, que prepara la línea de crédito: gatearlo dejaba la UI sin
  límite ni CTA de borrow. Test nuevo que fija que verify no bloquea por KYC.
- `GET /kyc/status` agrega `required` (= `KYC_GATE_ENABLED`).
- `GET /loan/history`: préstamos de la wallet del token, más nuevo primero.
- `cctp-demo.ts`: imprime el link del explorer debajo de cada hash.

**Docs**: `d1.3-kyc-evidencia.md` avisa del cambio del gate a borrow (entra acá y
no antes porque describe este código).

## Hallazgos de la review y qué se hizo

| Hallazgo | Severidad | Resolución |
|---|---|---|
| El frontend pedía KYC aunque el gate estuviera apagado | blocker | `required` en `/kyc/status`; el gate lo respeta |
| El modal decía "comparando documento y rostro" pero se auto-aprueba | blocker | rotulado "Demo testnet" / "proveedor de prueba (sandbox)" |
| 11 tests de `PullPanel` rotos por un gate en código muerto | blocker | revertido: `PullPanel` no se renderiza en la app |
| El modal mostraba "aprobado" sin confirmar el estado guardado | should-fix | exige `status === 'approved'` persistido, si no error + reintento |
| `approveKycSandbox(undefined)` si el usuario ya estaba aprobado | should-fix | no llama al sandbox cuando `/kyc/start` ya devuelve approved |
| "Aprobado" pegado en memoria → 403 en loop | should-fix | el gate consulta al backend en cada intento |
| Sin `getUserMedia` (contexto no seguro) quedaba visor negro | nit | cae al modo "sin cámara" |
| Comentario falso: "/loan/verify solo lee" | should-fix | corregido: prepara (y escribe on-chain la 1ra vez) |
| Wallet Privy nueva sin XLM ni trustline: no puede pedir | blocker (descubierto en el runbook) | activación automática en testnet |
| `Dockerfile.stellar` con el par viejo y sin Privy App ID | blocker de deploy | corregido |

## Verificación

- Frontend: `vitest` **446/446** (env neutralizado), 0 errores de tipos en los
  archivos tocados. Activación: 4 tests (no-op fuera de testnet, cuenta lista,
  cuenta nueva → friendbot + changeTrust firmado, rechazo de Horizon).
- Backend: `jest` **190/190**, `tsc --noEmit` 0 errores.
- En vivo (backend local, `KYC_GATE_ENABLED=true`): borrow → modal → aprobación
  → borrow y repago on-chain (wallet `GCKBTP6U…`, ver `d1.3-kyc-app-evidencia.md`).

## Riesgos aceptados (testnet)

- `POST /kyc/sandbox/decision` es invocable por cualquier usuario logueado
  mientras el proveedor sea el fake: alcanza para el gate de testnet; en mainnet
  entra el vendor real por el mismo port y el endpoint deja de existir (403).
- La activación usa friendbot: solo con la passphrase de testnet.
