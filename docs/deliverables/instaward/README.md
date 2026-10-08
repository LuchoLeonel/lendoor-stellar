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

PENDIENTE del faucet de USDC de testnet (Circle). La ceremonia corre contra el
par de arriba y esta tabla se completa con un hash + link a stellar.expert por
fila:

| Paso | Tx hash | Explorer |
|---|---|---|
| Seed deposit del protocolo | `PENDIENTE` | — |
| `set_user_risk` + `set_loan_offer` (50 USDC, 7d/5%) | `PENDIENTE` | — |
| Borrow (`borrow_with_term`) | `PENDIENTE` | — |
| Repago parcial (`repay_partial` — evento `partpay`, imputación interés-primero) | `PENDIENTE` | — |
| Repago con descuento por pago anticipado (pro-rata) | `PENDIENTE` | — |
| Repay final (cierra el préstamo) | `PENDIENTE` | — |
| Score update post-repago | `PENDIENTE` | — |
| Repago tardío (mora materializada con `accrue_late`) | `PENDIENTE` | — |

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
