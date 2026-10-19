# Instaward — Ciclo de vida on-chain desde la app (wallet Privy, USDC nativo)

**Red:** Stellar **testnet** · **Fecha de la corrida:** 2026-10-14
**Asset de settlement:** USDC real de Circle en testnet (7 decimales, no un stand-in).

Corrida end-to-end **desde la app**, con una wallet embebida de **Privy**
(onboarding por email, sin extensión y sin custodia: el usuario puede exportar
su clave). Cada interacción abajo es una transacción Soroban verificable en
stellar.expert. Este documento complementa a `README.md` (la ceremonia por CLI
con pago parcial y crédito revolvente); acá el foco es el **flujo de usuario
real**: depósito, retiro, préstamo a término y repago, repetido.

## Contratos (los mismos de D1.1/D1.2 del award)

| Pieza | Contract ID | Explorer |
|---|---|---|
| **Vault** (`lendoor-vault`) | `CCXUEBC3VOOB57NVDFMQVAJRN52FUQN37EAPLVMAU7MLSPUBMZNBVT2Q` | [ver](https://stellar.expert/explorer/testnet/contract/CCXUEBC3VOOB57NVDFMQVAJRN52FUQN37EAPLVMAU7MLSPUBMZNBVT2Q) |
| **Loan Manager** (`lendoor-loan-manager`) | `CB4QQU2JWC6264NQCUPE6WSVYQHJTJNJ5ZBVU7ZAOE7TYNJPYE26YVTD` | [ver](https://stellar.expert/explorer/testnet/contract/CB4QQU2JWC6264NQCUPE6WSVYQHJTJNJ5ZBVU7ZAOE7TYNJPYE26YVTD) |
| **USDC** (SAC de Circle, testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| **Wallet del usuario** (embebida Privy) | `GD54HESGKHPNYHHC2EA6VROCQMZYZWMY6HAQ3TSKRVZVP4RQSVW6WHVD` | [ver](https://stellar.expert/explorer/testnet/account/GD54HESGKHPNYHHC2EA6VROCQMZYZWMY6HAQ3TSKRVZVP4RQSVW6WHVD) |

## Setup de la wallet (una sola vez)

| # | Acción | Función | Tx |
|---|---|---|---|
| 1 | Alta de la cuenta (fondeo XLM para fees/reserva) | `create_account` | [`f5d91504…`](https://stellar.expert/explorer/testnet/tx/f5d91504dd320a14c46655022466ea60194e38044c0c561212bd15eaf319e434) |
| 2 | Trustline de USDC (firmada por la wallet Privy del usuario) | `change_trust(USDC)` | [`46f33fd7…`](https://stellar.expert/explorer/testnet/tx/46f33fd78ad756ab2d05c5ca9dc9ad4497b4724e4bd037aa2e1b4c622de22e8f) |
| 3 | Fondeo de USDC de prueba a la wallet | `transfer(3 USDC)` | [`87cc2080…`](https://stellar.expert/explorer/testnet/tx/87cc208031999ea3042f0eed0a6e55626294570a3d76a2c83830de482fdd13e3) |

> El USDC es de prueba (testnet). La trustline la firmó la propia wallet Privy
> del usuario — la app no custodia la clave.

## Ciclo de vida (cada fila es una transacción distinta, en orden)

| Hora UTC | Función del contrato | Monto | Tx |
|---|---|---|---|
| 19:36:12 | `vault.deposit` | 1.0000000 USDC | [`41417f50…`](https://stellar.expert/explorer/testnet/tx/41417f5043f4b2ea6386c6174a84ab5680872e52a7812effdbf1b79007b33af8) |
| 19:37:02 | `vault.deposit` | 1.2000000 USDC | [`79ef65ef…`](https://stellar.expert/explorer/testnet/tx/79ef65ef353ec1c429a7fe540ae550cb4eed42379da9ff74d603043b9de19319) |
| 19:37:22 | `vault.withdraw` | 2.0000000 USDC | [`883ecbb5…`](https://stellar.expert/explorer/testnet/tx/883ecbb504a7d7622bc580a01945e82960c0dd4d43ea770583e148ae9b3f2332) |
| 19:38:02 | `vault.borrow_with_term` (7 días, 5.23%) | 1.0000000 USDC | [`1d45827e…`](https://stellar.expert/explorer/testnet/tx/1d45827e500f12237c8112ca4612cfd25989593242a8fbbcfd76496f475038e9) |
| 19:38:32 | `vault.repay_partial` → cierra (deuda 0) | 1.0174714 USDC | [`e67dc91d…`](https://stellar.expert/explorer/testnet/tx/e67dc91d9c4ffb33f390d8f3f0c0868c21337e6ea1c1c0a2b92e6347adb9d8dd) |
| 19:41:32 | `vault.borrow_with_term` (7 días, 5.23%) | 1.0000000 USDC | [`ee141ad1…`](https://stellar.expert/explorer/testnet/tx/ee141ad1f008b44aaca0e851f6303dd7ed511d004478eba327665ac60e749eff) |
| 19:41:52 | `vault.repay_partial` → cierra (deuda 0) | 1.0174714 USDC | [`70dd7cfb…`](https://stellar.expert/explorer/testnet/tx/70dd7cfbe2efee444b0cef8659c4499417f6ccff1d6f7375adfa34e39abfb2eb) |
| 19:42:52 | `vault.deposit` | 1.5000000 USDC | [`d66e0806…`](https://stellar.expert/explorer/testnet/tx/d66e0806e998a32e071ab0860d7dcd008eba471b62f6458bb4cd66aad39e1bc1) |
| 19:43:12 | `vault.withdraw` | 1.2000000 USDC | [`f1260ecc…`](https://stellar.expert/explorer/testnet/tx/f1260ecc05ff11ce5a0927ee3866641f481fccf522260f126bb6afaf4257b90c) |
| 19:43:42 | `vault.borrow_with_term` (21 días, 23.52%) | 3.0000000 USDC | [`f5776644…`](https://stellar.expert/explorer/testnet/tx/f57766447f688fd215493e91760ecdfda72f434686f359b00b56fdca8cd0fb5a) |
| 19:44:12 | `vault.repay_partial` → cierra (deuda 0) | 3.0436000 USDC | [`e17ae792…`](https://stellar.expert/explorer/testnet/tx/e17ae792be586dea315c0ddae669b195fad5183714b11b204b23be5755a07122) |

**Resumen:** 3 depósitos · 2 retiros · **3 préstamos a término** (dos a 7 días,
uno a 21 días) · **3 repagos que cerraron el préstamo** (deuda 0). Todo firmado
por la wallet Privy del usuario.

## Notas técnicas para el reviewer

- **`repay_partial` también salda el total.** La app repaga siempre con
  `repay_partial(payer, borrower, amount)`: envía el monto exacto firmado + un
  colchón; cuando el monto cubre la deuda, el contrato **cierra el préstamo y
  devuelve el vuelto en la misma transacción** (el retorno `→ 0` = deuda cero).
  Es a propósito: la deuda crece por segundo, así que `repay` (que recalcula
  cuánto cobrar al ejecutar) rompería la autorización de Soroban firmada en la
  simulación (`auth invalid_action`). Lección de la ceremonia previa.
- **Interés pro-rata al tiempo.** Los repagos fueron casi inmediatos, por eso
  el interés es chico (p. ej. 0.0074714 sobre 1 USDC: el `repay_partial` tiró
  1.0174714, que incluye un colchón de 0.01 devuelto en la misma tx). A plazo completo el
  7 días / 5% pagaría ~1.05. "Repagás antes, pagás menos", con piso de 1 día.
- **Cooldown anti-churn (min-hold).** Al cerrar un préstamo, el loan manager
  fija un `next_borrow_time = inicio + min_hold(plazo)`. Para 21 días el
  min-hold es 7 días: por eso tras el último préstamo la wallet queda en
  cooldown. Es una defensa intencional contra el churn, no un error. Nota: durante
  algunas tomas del video el `min_hold` del loan manager estuvo en 0 (para repetir
  borrow→repay sin esperar); se restaura a los valores del constructor antes de la
  revisión.
- **Decimales:** 7 (USDC clásico de Stellar), verificado on-chain
  (`decimals() = 7`).

## Repo

Código (contratos Soroban en Rust, app, backend):
`https://github.com/LuchoLeonel/lendoor-stellar` · evidencia de la ceremonia
con pago parcial y crédito revolvente en `docs/deliverables/instaward/README.md`.

> Testnet de Stellar se resetea el **2026-12-16**: estas direcciones y txs
> mueren con el reset; esta evidencia queda como registro.
