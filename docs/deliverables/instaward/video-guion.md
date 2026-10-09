# Video demo Instaward (1-2 min) — guión con timestamps

> Para grabar DESPUÉS de la ceremonia post-faucet (los hashes de
> `README.md` §D3 tienen que existir). No hace falta cámara: pantalla + voz.
> ES para grabar; EN por si narrás en inglés. Los tiempos son objetivos, no
> corsé — si un paso respira mejor 5 segundos más tarde, dejalo respirar.

## Pestañas abiertas ANTES de grabar (en este orden)

1. **Vault en stellar.expert:**
   https://stellar.expert/explorer/testnet/contract/CDY27BWE7HYC26JRVU7NE7IC6GMKEUWMOTCB3B3MEPOZHXSWWLBQSBKA
2. **Loan Manager en stellar.expert:**
   https://stellar.expert/explorer/testnet/contract/CA2H4UFGUADAL3GFU6DM7TBJ4DY6WIZXZ67A42K4RKVUWEY7YZXRGV4R
3. Las tx de la ceremonia, UNA pestaña por hash (de `README.md` §D3):
   borrow · repago parcial · repago con descuento · repay final · score update.
   En la del **repago parcial**, dejá expandido el evento `partpay` ANTES de
   grabar (que no te agarre buscándolo en vivo).
4. Opcional de cierre: el repo en GitHub (`LuchoLeonel/lendoor-stellar`),
   pestaña del PR o la rama `instaward/usdc-testnet`.

Chequeo previo: zoom del navegador 125-150% (que los hashes se lean), modo
oscuro o claro consistente en todas las pestañas, notificaciones silenciadas.

---

## 0:00 — Qué es Lendoor (una frase, sobre la pestaña 1 sin scrollear)

**ES:** «Lendoor presta USDC sin colateral: el límite de crédito vive
on-chain y crece con cada repago. Esto es el ciclo completo, en la testnet de
Stellar, con USDC nativo.»

**EN:** "Lendoor lends USDC with no collateral: the credit limit lives
on-chain and grows with every repayment. This is the full cycle, on Stellar
testnet, with native USDC."

## 0:15 — El par en el explorer (pestañas 1 y 2)

Mostrá el Vault, señalá el contract ID y el asset USDC; cambiá a la pestaña
del Loan Manager medio segundo.

**ES:** «Dos contratos Soroban propios, en Rust: el vault que custodia la
liquidez y el loan manager que lleva límite, score y el préstamo de cada
wallet. El settlement es el USDC real de testnet — siete decimales, no un
stand-in.»

**EN:** "Two of our own Soroban contracts, in Rust: the vault holds the
liquidity; the loan manager tracks each wallet's limit, score and loan.
Settlement is real testnet USDC — seven decimals, not a stand-in."

## 0:30 — Borrow on-chain (pestaña del hash de borrow)

**ES:** «Acá un borrower con límite de 50 USDC pide prestado, sin colateral:
`borrow_with_term`, siete días al cinco por ciento. Una transacción, el USDC
sale del vault a su cuenta.»

**EN:** "Here a borrower with a 50 USDC limit borrows, uncollateralized:
`borrow_with_term`, seven days at five percent. One transaction, USDC moves
from the vault to their account."

## 0:50 — Pago parcial (pestaña del hash de partial; evento `partpay` expandido)

Señalá con el mouse los tres campos del evento.

**ES:** «Crédito revolvente: puede pagar una parte. El evento `partpay` lo
muestra — el pago se imputa primero al interés devengado y recién después al
principal, y el interés sigue corriendo solo sobre el principal que queda.»

**EN:** "Revolving credit: partial payments. The `partpay` event shows the
split — payment goes to accrued interest first, then principal, and interest
keeps accruing only on the remaining principal."

## 1:10 — Repago con descuento por pago anticipado (pestaña de ese hash)

**ES:** «Y el interés es pro-rata al tiempo real: si paga antes del
vencimiento, paga menos. Acá salda todo a mitad de plazo y el total es menor
que el cinco por ciento pactado — con piso de un día, así un flash-repay no
licúa el interés.»

**EN:** "Interest is pro-rata to actual time: repay early, pay less. Here the
loan is settled mid-term and the total comes in under the agreed five percent
— with a one-day floor, so a flash-repay can't dilute interest."

## 1:30 — Score update (pestaña del hash de score)

**ES:** «Cada repago alimenta el score on-chain: el loan manager registra el
comportamiento y el límite puede subir. Ese historial es la garantía.»

**EN:** "Every repayment feeds the on-chain score: the loan manager records
behavior and the limit can grow. That track record is the collateral."

## 1:45 — Cierre (volvé a la pestaña 1; opcional: pestaña del repo)

**ES:** «USDC nativo, ciclo completo — depósito, préstamo, pago parcial,
repago y score — todo on-chain, en la testnet de Stellar. Ciento sesenta tests
de contratos en verde. Esto es Lendoor.»

**EN:** "Native USDC, the full cycle — deposit, borrow, partial payment,
repayment and score — all on-chain, on Stellar testnet. A hundred and sixty
contract tests passing. This is Lendoor."
