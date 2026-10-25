# Review — chequeo de cooldown antes de armar la oferta de préstamo

**Problema (visto en la corrida e2e pública del 2026-10-24):** después de
repagar, `POST /loan/borrow` devolvía 200 y escribía una oferta on-chain, pero
el contrato rechazaba el `borrow_with_term` al firmar con `Error(Contract, #6)`
(Cooldown, `min_hold`). El usuario veía un error opaco y el operador gastaba una
tx en una oferta inútil.

**Cambio:**
- Port: `readNextBorrowTime?` opcional (el gateway EVM y los mocks no cambian).
- Gateway Soroban: simula `next_borrow_time(account)` del LoanManager.
- `LoanService.borrow`: después del gate de KYC, si `now < next_borrow_time`
  responde 400 `BORROW_COOLDOWN` con la fecha en hora de Argentina y
  `nextBorrowAt` ISO. Usa el timestamp de la cadena, con fallback al reloj.
- Si la lectura falla, NO bloquea: el contrato sigue siendo la garantía.
- Regla pura en `loan/borrow-cooldown.ts` con spec (3 casos: sin cooldown,
  borde vencido, dentro del cooldown).

**Verificado:** `tsc` 0 errores; jest 193/193 (190 + 3 nuevos). Ejecutado contra
testnet con la wallet de la corrida e2e: `next_borrow_time = 1793188422`
(2026-10-28 11:53:42 UTC) → mensaje "Podés pedir uno nuevo desde el 28/10,
08:53 a. m. (hora de Argentina)".

**Deploy:** requiere rebuild del backend de stellar; no incluido en este PR.
