# SCF #45 — Tranche 1 ($17.000): evidencia completa

Los tres entregables del Tranche 1, cada uno con su corrida real en testnet,
su PR reviewado y su evidencia:

| Entregable | Medida de completitud | Evidencia | Código |
|---|---|---|---|
| **D1.1 — CCTP** ($7k) | tx de testnet puenteando USDC vía CCTP al vault + PR | [`d1.1-cctp-evidencia.md`](./d1.1-cctp-evidencia.md) — burn en Base Sepolia → attestation de Iris → `mint_and_forward` → `deposit_from`, shares verificadas on-chain | [PR #5](https://github.com/LuchoLeonel/lendoor-stellar/pull/5) · review en `docs/reviews/pr5-cctp-executor.md` |
| **D1.2 — Privy** ($6k) | corrida grabada en testnet: onboarding vía Privy + firma de una tx Soroban | [`d1.2-privy-evidencia.md`](./d1.2-privy-evidencia.md) — login por email, wallet embebida, `changeTrust` + `vault.deposit` firmados por el usuario (GIFs en `media/`) | [PR #7](https://github.com/LuchoLeonel/lendoor-stellar/pull/7) · review en `docs/reviews/pr7-privy-auth-message.md` |
| **D1.3 — KYC gate** ($4k) | una wallet debe pasar verificación de identidad (vendor off-chain abstraído) antes de que `borrow` se habilite | [`d1.3-kyc-evidencia.md`](./d1.3-kyc-evidencia.md) — borrow 403 → aprobación sandbox → el gate deja pasar; estado persistido verificado | [PR #6](https://github.com/LuchoLeonel/lendoor-stellar/pull/6) · review en `docs/reviews/pr6-kyc-gate.md` |

**El hilo que une los tres:** el USDC que entró por CCTP en D1.1 es el mismo
que el usuario de Privy deposita en D1.2, en el mismo vault; y D1.3 es el gate
que hace no-sybileable la métrica final del award (préstamos a borrowers
KYC-verificados).

🔴 Testnet de Stellar se resetea el **2026-12-16**: los contratos y txs de
Stellar mueren con el reset (los links de Basescan sobreviven).
