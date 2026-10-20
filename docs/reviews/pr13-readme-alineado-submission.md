# Review — README raíz y docs alineados con la submission SCF #45 (Tranche 1)

**Motivo:** el README raíz seguía describiendo el build de PULSO y contradecía
la submission: solo Freighter, el par viejo de contratos (`CDEJOQBQ…` /
`CDIHUCP6…`) y "XLM nativo haciendo de USDC". Un reviewer que entra al repo
desde el form veía otra cosa que lo que dice el form.

## Cambios

| Archivo | Cambio | Verificado contra |
|---|---|---|
| `README.md` | Onboarding por email (Privy) o Freighter; activación automática en testnet; KYC gate; CCTP | `PrivyStellarProvider.tsx`, `stellar-account-activation.ts`, `backend/src/kyc`, `backend/src/cctp` |
| `README.md` | Tabla "Live on testnet" → `CCXUEBC3…` / `CB4QQU2J…` / USDC `CBIELTK6…` | Interfaces desplegadas (recheck on-chain 20/10) |
| `README.md` | Sección SCF #45 Tranche 1 con evidencia + PRs #5, #6, #7, #8, #12 | `gh pr view` de cada uno |
| `README.md` | Diagrama, estructura del repo, stack y status actualizados | Rutas existentes (`ls`) |
| `docs/ARCHITECTURE.md` | Nota con el par nuevo sin borrar el registrado al award | — |
| `d1.2-privy-evidencia.md` | Fecha de la corrida grabada 2026-10-15/16 (antes decía solo 10-12) | Horizon: `60af46d0` 2026-10-15T23:05:57Z, `59c3587e` 2026-10-16T16:05:37Z |
| `scf-tranche1/README.md` | El "hilo" CCTP → Privy cita la cadena de txs y aclara que la corrida grabada usó USDC de testnet | Hashes ya documentados en d1.1/d1.2 |

## Riesgos / pendientes

- Sin PII: no hay emails ni teléfonos en los archivos tocados.
- **El link "Live app" depende del deploy pendiente** (runbook de Tranche 1):
  hasta que se redeploye frontend + backend, `stellar.lendoor.xyz` muestra el
  modo EVM y `/kyc/status` da 404. Es la única contradicción viva que queda
  entre la submission y lo público, y no se arregla desde el repo.
- Solo docs: no cambia código ni tests.
