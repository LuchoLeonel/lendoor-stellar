# SCF #45 — Tranche 1 ($17.000): evidencia completa

Los tres entregables del Tranche 1, cada uno con su corrida real en testnet,
su PR reviewado y su evidencia:

| Entregable | Medida de completitud | Evidencia | Código |
|---|---|---|---|
| **D1.1 — CCTP** ($7k) | tx de testnet puenteando USDC vía CCTP al vault + PR | [`d1.1-cctp-evidencia.md`](./d1.1-cctp-evidencia.md) — burn en Base Sepolia → attestation de Iris → `mint_and_forward` → `deposit_from`, shares verificadas on-chain | [PR #5](https://github.com/LuchoLeonel/lendoor-stellar/pull/5) · review en `docs/reviews/pr5-cctp-executor.md` |
| **D1.2 — Privy** ($6k) | corrida grabada en testnet: onboarding vía Privy + firma de una tx Soroban | [`d1.2-privy-evidencia.md`](./d1.2-privy-evidencia.md) — login por email, wallet embebida, `changeTrust` + `vault.deposit` firmados por el usuario (GIFs en `media/`) | [PR #7](https://github.com/LuchoLeonel/lendoor-stellar/pull/7) · review en `docs/reviews/pr7-privy-auth-message.md` |
| **D1.3 — KYC gate** ($4k) | una wallet debe pasar verificación de identidad (vendor off-chain abstraído) antes de que `borrow` se habilite | [`d1.3-kyc-evidencia.md`](./d1.3-kyc-evidencia.md) — borrow 403 → aprobación sandbox → el gate deja pasar; estado persistido verificado · [`d1.3-kyc-app-evidencia.md`](./d1.3-kyc-app-evidencia.md) — el mismo gate desde la app, con préstamo y repago on-chain · [`e2e-publico-20261024.md`](./e2e-publico-20261024.md) — ciclo completo contra el deploy público | [PR #6](https://github.com/LuchoLeonel/lendoor-stellar/pull/6) · review en `docs/reviews/pr6-kyc-gate.md` |

**Video del tranche (los tres entregables):** https://youtu.be/GK3kB8p4P30 — la corrida
CCTP que se ve es la tercera de `d1.1-cctp-evidencia.md`; la de Privy + KYC es la de la
wallet `GCKBTP6U…W4ELE` (`d1.2-privy-evidencia.md` y `d1.3-kyc-app-evidencia.md`).

**Estado de la review (2026-10-23):** Tranche 1 **aceptada como completa** por
los reviewers del SCF. Notas no bloqueantes y dónde se atienden:
D1.1 nota de alcance Base↔Celo y reintento/reconciliación por CLI →
[`d1.1-cctp-evidencia.md`](./d1.1-cctp-evidencia.md#nota-de-alcance-pedida-en-la-review-de-tranche-1);
D1.2 PRs #4 y #12 junto al #7 → [`d1.2-privy-evidencia.md`](./d1.2-privy-evidencia.md);
D1.3 qué préstamo sigue a la aprobación de KYC → [`d1.3-kyc-app-evidencia.md`](./d1.3-kyc-app-evidencia.md).

**El hilo que une los tres:** el USDC que entró por CCTP en D1.1 es el mismo
que el usuario de Privy deposita en D1.2, en el mismo vault (cadena verificable
en la corrida del 2026-10-12: `deposit_from` [`4448e378…`](https://stellar.expert/explorer/testnet/tx/4448e3789623b2501e224bb6a8faf774f6e91568ac052c61007e3681d019a7f9)
→ redeem [`fcc881f4…`](https://stellar.expert/explorer/testnet/tx/fcc881f4ffbd91c2bcb1b942116927c6d68f811647cc198d7a5547d4238113d7)
→ pago de 0,9999999 USDC [`6959b14a…`](https://stellar.expert/explorer/testnet/tx/6959b14a3d52c5dca96908610f5935dacbb72f0f5b8e825777dceb5c861f9de2)
→ `vault.deposit` firmado con Privy [`49ab280b…`](https://stellar.expert/explorer/testnet/tx/49ab280beb3db570f2bdf2a10f446f483a033d7973d234afe4d8cf414adbf5f3);
la corrida grabada con `GCKBTP6U…` se fondeó con USDC de testnet); y D1.3 es el gate
que hace no-sybileable la métrica final del award (préstamos a borrowers
KYC-verificados).

🔴 Testnet de Stellar se resetea el **2026-12-16**: los contratos y txs de
Stellar mueren con el reset (los links de Basescan sobreviven).
