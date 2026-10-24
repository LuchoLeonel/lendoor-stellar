# Review — notas de los reviewers del SCF sobre Tranche 1 (2026-10-23)

Tranche 1 fue aceptada como completa. Este PR atiende las tres notas no
bloqueantes y corrige un error propio encontrado al hacerlo.

| Nota | Cambio | Verificado contra |
|---|---|---|
| D1.1: Base en vez de Celo como nota de alcance; reintento/reconciliación es máquina de estados por CLI, no servicio | Sección "Nota de alcance" en `d1.1-cctp-evidencia.md` | Estados y transiciones en `backend/src/cctp/cctp-transfer.ts` (L43-62), specs existentes |
| D1.2: citar PR #4 (adaptador Privy) y #12 (activación testnet) junto al #7 | Tabla de PRs en `d1.2-privy-evidencia.md` | `privy-signer.ts` entró en el commit `6d86ef04`, contenido en el PR #4 |
| D1.3: qué préstamo sigue a la aprobación de KYC | Respuesta en `d1.3-kyc-app-evidencia.md`: 3 USDC, `5885df1a…`, 26 s después de `kycApprovedAt` | Base de la demo: `kycApprovedAt = 2026-10-16 16:07:56 UTC`; único préstamo de la wallet en la base |
| (propio) Los dos préstamos de 10 USDC del 15/10 figuraban "tras la aprobación de KYC" | Retitulados: préstamos de prueba previos, firmados directo contra el contrato | No están en la base (no pasaron por el backend); el KYC se aprobó el 16/10 |
| (nuevo) Corrida e2e contra el deploy público | `e2e-publico-20261024.md` + índice | Hashes leídos de Horizon para la wallet `GCQMHRCA…` |

Sin PII (sin emails ni teléfonos). Solo docs.
