# Instaward — paquete de evidencia (testnet, USDC nativo)

> Estado al **2026-10-08**. Formato por deliverable: *Brief Description / How to
> Measure Completion / Result*. Los hashes de la ceremonia on-chain se agregan
> después del faucet (ver Deliverable 3). Rama de trabajo:
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
| Vault | [`CDY27BWE7HYC26JRVU7NE7IC6GMKEUWMOTCB3B3MEPOZHXSWWLBQSBKA`](https://stellar.expert/explorer/testnet/contract/CDY27BWE7HYC26JRVU7NE7IC6GMKEUWMOTCB3B3MEPOZHXSWWLBQSBKA) |
| Loan Manager | [`CA2H4UFGUADAL3GFU6DM7TBJ4DY6WIZXZ67A42K4RKVUWEY7YZXRGV4R`](https://stellar.expert/explorer/testnet/contract/CA2H4UFGUADAL3GFU6DM7TBJ4DY6WIZXZ67A42K4RKVUWEY7YZXRGV4R) |
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
| Borrow 5 USDC (`borrow_with_term`; `loanopen` muestra el piso de 1 día: due 50.357142) | [`26a4db4e…`](https://stellar.expert/explorer/testnet/tx/26a4db4eb4b4f8e0d9c9477e92f07af85dc92e3e09a322474b7c31d4cc871e06) | ✅ 2026-10-08 |
| Repago parcial 1 USDC — `partpay` = (principal 0.9642858, interés 0.0357142, resto 4.0357142): imputación interés-primero, fee 5% al sink | [`519af5bf…`](https://stellar.expert/explorer/testnet/tx/519af5bfb6dfdaaffe153363e24d3c2a3ad8c49dcea29d003d6d4ae69de6b281) | ✅ 2026-10-08 |
| Repago con descuento por pago anticipado: el cierre total costó **4.0357376** en el día 1 de 7 (el fee completo habría sido 0.25; se pagó el pro-rata con piso) | [`6c33bd98…`](https://stellar.expert/explorer/testnet/tx/6c33bd983cb18a11d48eceee0d117c73a07158e42903408e3ca3742f67316a60) | ✅ 2026-10-08 |
| Repay final — pull exacto de lo firmado (41 USDC) **+ vuelto de 0.0642624 en la misma tx** (auth-determinista), `loanclos`, préstamo inactivo | [`6c33bd98…`](https://stellar.expert/explorer/testnet/tx/6c33bd983cb18a11d48eceee0d117c73a07158e42903408e3ca3742f67316a60) | ✅ 2026-10-08 |
| Score update post-repago: 700→720, límite 50→60 USDC (`riskset`) | [`28e6de5f…`](https://stellar.expert/explorer/testnet/tx/28e6de5fcb21169ee4b154665d30d5cb34a0ea72acf0bb01d1847b4645e1515f) | ✅ 2026-10-08 |
| Repago tardío: préstamo de tenor 1 día ABIERTO el 2026-10-08 ([`df3bf78c…`](https://stellar.expert/explorer/testnet/tx/df3bf78c07572ec522a0ce58f71b3358da03c1182161d630cc9cd3f80bcfd391), borrower `GAXU6PIN…`, mora 36.5%/yr configurada) — vence 2026-10-09 17:32 UTC-3; el repago con mora se ejecuta y documenta el 2026-10-10 | `EN CURSO` |

## Checklist 6.2 del SOW — estado de la evidencia (honesto, al 2026-10-08)

| Ítem de evidencia | Estado | Nota |
|---|---|---|
| Código del revolvente + pago parcial en el repo público | **Present** | commit `9238e876` en `instaward/usdc-testnet` |
| Fix de decimales mergeable | **Present** | PR #2 abierto y mergeable |
| Suite de contratos verde | **Present** | 160/160 (corrida 2026-10-08, arriba) |
| Bindings TS al día para el frontend | **Present** | regenerados del wasm en esta entrega |
| Par testnet con USDC nativo + procedimiento | **Present** | tabla D2 + `deploy-testnet-usdc.sh` |
| Config de riesgo aplicada | **Partial** | aplicada por el operador; verificable on-chain recién con la wallet de la ceremonia |
| Seed deposit del protocolo | **Missing** | bloqueado por el faucet de USDC |
| Hashes del ciclo de vida (borrow → parcial → descuento → final → score → tardío) | **Missing** | tabla D3, post-faucet |
| Video demo (1-2 min) | **Missing** | guión listo en `video-guion.md`; graba Fabián post-ceremonia |


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
