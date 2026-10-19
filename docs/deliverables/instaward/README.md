# Instaward — paquete de evidencia (testnet, USDC nativo)

> Estado al **2026-10-19**. Formato por deliverable: *Brief Description / How to
> Measure Completion / Result*. Ceremonia on-chain ejecutada el 2026-10-08
> (hashes en Deliverable 3); repago tardío ejecutado el 2026-10-19. Rama de trabajo:
> `instaward/usdc-testnet` sobre `github.com/LuchoLeonel/lendoor-stellar`.

## Deliverable 1 — Crédito revolvente + pago parcial (código + suite)

**Qué es.** Los contratos Soroban pasan de "préstamo a término con repago
único" a **crédito revolvente**: interés pro-rata al tiempo transcurrido (piso
de 1 día), `repay_partial` en el vault con **imputación interés-primero** vía
`apply_payment` (loan-manager, vault-only), y `accrue_late` materializando
interés pre-vencimiento + mora. Decimales del modo Stellar corregidos de 6 a
**7** en todas las capas (los classic assets de Stellar, USDC incluido, usan 7).

**Evidencia.**
- Decimales + fundaciones: **PR #2** — https://github.com/LuchoLeonel/lendoor-stellar/pull/2
  (commits `26392504` decimales, `c6d7c71d` idempotencia/normalización,
  `1dc23cfc` suites verdes).
- Revolvente + pago parcial: rama `instaward/usdc-testnet`, commit
  `9238e876` ("credito revolvente + pago parcial"); deploy reproducible en
  `2c85e0e4`. Bindings TypeScript regenerados del wasm (esta entrega) para que
  el frontend vea `repay_partial`, `deposit_from` y `apply_payment`.
- Suite de contratos, corrida real (`cargo test`, 2026-10-08):

  | Crate | Resultado |
  |---|---|
  | `lendoor-loan-manager` | **73 passed; 0 failed** |
  | `lendoor-vault` | **87 passed; 0 failed** |
  | **Total** | **160 passed; 0 failed** |

- Gates del frontend con los bindings nuevos (corridos 2026-10-08):
  vitest **440/440**, `vite build` ✓, `privy-signer.test.ts` **5/5**.

## Deliverable 2 — Par deployado en testnet con USDC nativo

**Qué es.** Vault + loan-manager vivos en Stellar testnet con el **SAC real de
USDC** como settlement asset (no el stand-in de XLM del prototipo).

| Pieza | Valor |
|---|---|
| Vault | [`CCXUEBC3VOOB57NVDFMQVAJRN52FUQN37EAPLVMAU7MLSPUBMZNBVT2Q`](https://stellar.expert/explorer/testnet/contract/CCXUEBC3VOOB57NVDFMQVAJRN52FUQN37EAPLVMAU7MLSPUBMZNBVT2Q) |
| Loan Manager | [`CB4QQU2JWC6264NQCUPE6WSVYQHJTJNJ5ZBVU7ZAOE7TYNJPYE26YVTD`](https://stellar.expert/explorer/testnet/contract/CB4QQU2JWC6264NQCUPE6WSVYQHJTJNJ5ZBVU7ZAOE7TYNJPYE26YVTD) |
| USDC (SAC testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` — verificado on-chain: `symbol()="USDC"`, `decimals()=7` |
| Operador (owner) | `GA6DMHI54NH3IEA7CLO43SVQMAFEG7BASELZL3NOLVOJ4OML2MKJYAGR` (identidad local descartable `instaward-op`) |
| Fee recipient | `GABED6S3K5L2U5F2FTSLWYYCUGKUMQGPW3JX7WLU4KB5B4K3TC3PJ3T4` |
| Procedimiento | `contratos/deploy-testnet-usdc.sh` (reproducible; friendbot + stellar-cli ≥ 27) |
| Config de riesgo | límite **50 USDC**, oferta **7d / 5%** |

Verificado leyendo el instance storage el 2026-10-08: cross-wiring LM↔Vault
correcto; `TotalShares = 0`, `TotalBorrows = 0` (pre-seed — el seed deposit del
protocolo es el primer paso de la ceremonia, regla anti-donación en
`contratos/DEPLOYMENTS.md`).

## Deliverable 3 — Ciclo de vida on-chain (hashes de la ceremonia)

CEREMONIA EJECUTADA el 2026-10-08 (faucet acreditado). Corrió contra el
par de arriba y esta tabla se completa con un hash + link a stellar.expert por
fila:

| Paso | Tx hash | Explorer |
|---|---|---|
| Seed deposit del protocolo (1 USDC, anti-donación) + depósito de liquidez (10 USDC) | [`8a5395b4…`](https://stellar.expert/explorer/testnet/tx/8a5395b4d0fe04808d9e921fa986b864e32e9d0fdc99441d3f7e61968abdb1e5) · [`26dd6b79…`](https://stellar.expert/explorer/testnet/tx/26dd6b79bf870e5687f4f3b627dac8ae312fbc4c693c4e2bfb8897adc2b8dfcc) | ✅ 2026-10-08 |
| `set_user_risk` + `set_loan_offer` (50 USDC, 7d/5%) | [`0efcdf02…`](https://stellar.expert/explorer/testnet/tx/0efcdf023b00e9de71dab98137fb54ede69c977194196f964328da947fcabcaf) · [`661488ff…`](https://stellar.expert/explorer/testnet/tx/661488ff1785c29c6c1e778c62bf56482a2c7d5dbfd20ed6829ce369b8fbbe1e) | ✅ 2026-10-08 |
| Borrow 5 USDC (`borrow_with_term`, 7 días, 500 bps; con el piso de 1 día la deuda arranca en 5.0357142) | [`26a4db4e…`](https://stellar.expert/explorer/testnet/tx/26a4db4eb4b4f8e0d9c9477e92f07af85dc92e3e09a322474b7c31d4cc871e06) | ✅ 2026-10-08 |
| Repago parcial 1 USDC — `partpay` = (principal 0.9642858, interés 0.0357142, resto 4.0357142): imputación interés-primero, fee 5% al sink | [`519af5bf…`](https://stellar.expert/explorer/testnet/tx/519af5bfb6dfdaaffe153363e24d3c2a3ad8c49dcea29d003d6d4ae69de6b281) | ✅ 2026-10-08 |
| Repago con descuento por pago anticipado (misma tx que la fila siguiente): el cierre total costó **4.0357376** en el día 1 de 7 (el fee completo habría sido 0.25; se pagó el pro-rata con piso) | [`6c33bd98…`](https://stellar.expert/explorer/testnet/tx/6c33bd983cb18a11d48eceee0d117c73a07158e42903408e3ca3742f67316a60) | ✅ 2026-10-08 |
| Repay final — pull exacto de lo firmado (**4.1 USDC**) **+ vuelto de 0.0642624 en la misma tx** (auth-determinista), `loanclos`, préstamo inactivo | [`6c33bd98…`](https://stellar.expert/explorer/testnet/tx/6c33bd983cb18a11d48eceee0d117c73a07158e42903408e3ca3742f67316a60) | ✅ 2026-10-08 |
| Score update del operador: 700→720, límite 50→60 USDC (`set_user_risk`, 20:30:17 UTC: después del pago parcial, antes de que entrara el cierre) | [`28e6de5f…`](https://stellar.expert/explorer/testnet/tx/28e6de5fcb21169ee4b154665d30d5cb34a0ea72acf0bb01d1847b4645e1515f) | ✅ 2026-10-08 |
| Repago tardío: préstamo de tenor 1 día ABIERTO el 2026-10-08 ([`df3bf78c…`](https://stellar.expert/explorer/testnet/tx/df3bf78c07572ec522a0ce58f71b3358da03c1182161d630cc9cd3f80bcfd391), borrower `GAXU6PIN…`, mora 36.5%/yr configurada) — vence 2026-10-09 17:32 UTC-3; repagado el 2026-10-19 tras 9 días de mora: `repay_partial` tiró 1.07, el préstamo cerró por **1.0594283 USDC** (1.05 a término + **0.0094283 de mora**), vuelto 0.0105717 en la misma tx, fee 0.0029714 al `fee_recipient` | [`04483924…`](https://stellar.expert/explorer/testnet/tx/04483924119c051371853b3bf407d95adf9197b5743235fce45173e72c96cc0a) ✅ 2026-10-19 |

> Corrida del mismo ciclo **desde la app** (wallet Privy, depósito/retiro/préstamo/repago): [`ciclo-app-evidencia.md`](./ciclo-app-evidencia.md).

## Reconciliación con el PDF de evidencia enviado (generado 2026-10-14)

Cada fila del PDF verificada contra Horizon testnet el 2026-10-19
(función, argumentos y resultado decodificados de la transacción):

| Fila del PDF | Tx | On-chain | Dónde está acá |
|---|---|---|---|
| D1 — PR público | PR #2 | **mergeado** (el PDF dice "open": quedó desactualizado) | D1 |
| D1 — commit revolvente | `9238e876` | presente en `main` y en `instaward/usdc-testnet` | D1 |
| D2 — vault / loan manager / USDC | `CCXUEBC3…` · `CB4QQU2J…` · `CBIELTK6…` | cableados entre sí; USDC con 7 decimales | D2 |
| Video | https://youtu.be/CpJIZ4KliDI | publicado ("Lendoor Stellar Instaward") | checklist |
| Onboarding Privy + ciclo desde la app (14 filas, 2026-10-14) | `f5d91504…` → `e17ae792…` | las 14 exitosas | [`ciclo-app-evidencia.md`](./ciclo-app-evidencia.md) |
| Seed deposit | `8a5395b4…` | ✅ `deposit` 1 USDC del operador | D3 |
| Deposit liquidity | `26dd6b79…` | ✅ `deposit` 10 USDC | D3 |
| Redeem (2026-10-12) | [`fcc881f4…`](https://stellar.expert/explorer/testnet/tx/fcc881f4ffbd91c2bcb1b942116927c6d68f811647cc198d7a5547d4238113d7) | ✅ `redeem` de 0.9969230 shares por el beneficiary del puente CCTP (`GCRINMW4…`) en este mismo vault | esta tabla |
| Set user risk | `0efcdf02…` | ✅ score 700, límite 50 USDC | D3 |
| Set loan offer | `661488ff…` | ✅ 7 días, 500 bps, máx 50 USDC | D3 |
| Borrow | `26a4db4e…` | ✅ 5 USDC, 7 días | D3 |
| Partial repayment | `519af5bf…` | ✅ `repay_partial` 1 USDC | D3 |
| **"Partial repayment — Second partial payment"** | [`df1a8937…`](https://stellar.expert/explorer/testnet/tx/df1a893774f0879bc0d0d834ae072abd3a901d2ab54eb383815cf42fcaa0ffb2) | ❌ **falló.** No fue un segundo pago parcial: fue el **primer intento del cierre** (`repay_partial` de 4.1 USDC, 20:30:12 UTC), que cayó por el caso de la nota operativa 3 (fee condicional fuera del footprint). El reintento idéntico entró a las 20:31:12 como `6c33bd98…`. **El PDF etiqueta mal esta fila;** el ciclo no tiene ningún paso faltante | nota operativa 3 |
| Final repayment (close) | `6c33bd98…` | ✅ `repay_partial` 4.1 USDC, vuelto 0.0642624, préstamo cerrado | D3 |
| Score / limit update | `28e6de5f…` | ✅ score 720, límite 60 USDC | D3 |
| *(posterior al PDF)* Repago tardío con mora | [`04483924…`](https://stellar.expert/explorer/testnet/tx/04483924119c051371853b3bf407d95adf9197b5743235fce45173e72c96cc0a) | ✅ 2026-10-19: préstamo de 1 día cerrado tras 9 días de mora | D3 |

## Checklist 6.2 del SOW — estado de la evidencia (honesto, al 2026-10-19)

| Ítem de evidencia | Estado | Nota |
|---|---|---|
| Código del revolvente + pago parcial en el repo público | **Present** | commit `9238e876` en `instaward/usdc-testnet` |
| Fix de decimales mergeado | **Present** | PR #2 mergeado a `main` |
| Suite de contratos verde | **Present** | 160/160 (corrida 2026-10-08, arriba) |
| Bindings TS al día para el frontend | **Present** | regenerados del wasm en esta entrega |
| Par testnet con USDC nativo + procedimiento | **Present** | tabla D2 + `deploy-testnet-usdc.sh` |
| Config de riesgo aplicada | **Present** | on-chain: `0efcdf02…` + `661488ff…` (tabla D3) |
| Seed deposit del protocolo | **Present** | hash `8a5395b4…` (tabla D3, 2026-10-08) |
| Hashes del ciclo de vida (borrow → parcial → descuento → final → score → tardío) | **Present** | todos en tabla D3, incluido el repago tardío con mora (`04483924…`, 2026-10-19) |
| Video demo (1-2 min) | **Present** | https://youtu.be/CpJIZ4KliDI — ciclo desde la app con la wallet Privy `GD54HESG…W6WHVD` ([`ciclo-app-evidencia.md`](./ciclo-app-evidencia.md)) |


## Notas operativas que salieron de la ceremonia real (valen oro para mainnet)

1. **El fee sink necesita su trustline de USDC antes del primer repago** — sin
   ella, el skim del 5% revienta el repay entero. Agregada al procedimiento.
2. **Saldo revolvente vs autorización de Soroban:** el saldo crece por segundo,
   así que un contrato que recalcula cuánto tirar rompe la auth firmada en la
   simulación (`auth invalid_action`). Fix implementado: `repay_partial` tira
   el monto EXACTO firmado y **devuelve el vuelto** en la misma transacción —
   el camino correcto para saldar es `preview + colchón`.
3. **Footprint y fees condicionales:** si el fee simula 0 y ejecuta >0 (cierre
   en el mismo segundo que un parcial), el transfer condicional al sink queda
   fuera del footprint. Mitigación hoy: reintentar (fee>0 en ambas puntas).
   Fix de fondo anotado para el próximo deploy: transfers incondicionales.
