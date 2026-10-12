# Review PR #6 — D1.3: gate de KYC con vendor abstraído

**Fecha:** 2026-10-11 · **Alcance:** `backend/src/kyc/*`, puerto, controller, migración, cableado en `verify()`/`borrow()` · **Método:** sin asunciones; el requisito se leyó del propio award (`docs/ARCHITECTURE.md` + commit `21be5783`).

## Qué exige el award (verificado, no asumido)

- *"a wallet must pass identity verification through an off-chain KYC provider before `borrow` is enabled"* (`docs/ARCHITECTURE.md` §3).
- El vendor fue **genericizado a propósito** en `21be5783` ("drop vendor name for integration-track eligibility") → el puerto abstraído no es una preferencia nuestra, es lo comprometido.
- La métrica del tranche final cuenta préstamos a **borrowers KYC-verificados** (§5): el gate es lo que hace ese conteo no-sybileable.

## Hallazgos corregidos

1. **🟡 Sandbox sin DTO:** el body de `POST /kyc/sandbox/decision` entraba sin class-validator (todo el resto del backend valida con ValidationPipe global + DTOs). Un `decision` arbitrario ('pending', basura) entraba al mapa del fake por el cast. Fix: `SandboxDecisionDto` con `@IsIn(['approved','rejected'])`.
2. **🟢 Import duplicado de `@nestjs/common`** (dos statements) y un `@Query() _q` muerto en el controller. Limpiados.

## Decisiones documentadas (no son bugs)

- **El gate es una función pura** (`assertKycGate`) que lee `users.kycStatus` persistido: cero llamadas al vendor en el camino caliente de crédito y cero dependencias nuevas en los constructores de `LoanVerificationService`/`LoanService` (cuyos specs instancian a mano con `new`). El refresh contra el vendor pasa SOLO por `/kyc/status`.
- **`KYC_GATE_ENABLED` default apagado:** el flujo testnet existente de stellar.lendoor.xyz no exige KYC hoy; prenderlo es una decisión explícita (demo y mainnet). Con el flag apagado la suite existente pasa sin tocar un test — esa es la prueba de no-regresión.
- **Sandbox self-approval es aceptado en testnet:** cualquier usuario autenticado puede resolver una sesión del fake. Es el propósito del sandbox (demostrar bloquea→aprueba→pasa); con un vendor real el endpoint devuelve 403 vía `instanceof`, y el binding del vendor vive en UN solo lugar (`KycModule`).
- **`approved` es pegajoso** (no se re-consulta al vendor) y **`rejected` limpia la sesión** para permitir reintento con sesión nueva. `start` es idempotente sobre `pending` — no multiplica sesiones en el vendor.
- **Migración aditiva** con `IF NOT EXISTS` y default `'none'`: el stock existente queda `none` y el flag apagado hace que eso no cambie nada.
- **Carrera de dos `start()` concurrentes:** el último update gana y queda a lo sumo una sesión huérfana en el vendor (el fake la pierde en memoria; un vendor real la expira). Sin impacto en el estado persistido.
- **Arranque real con DB:** no hay `.env`/Postgres local en esta máquina; el boot con la migración se ejercita en el dev server del e2e de D1.2 (pendiente del login de Privy).

## Gates

- `src/kyc`: **10 tests** ✅ · backend completo: **189/189** ✅ · `tsc --noEmit`: **0** ✅

## Addendum post-merge (12/10) — hallazgo del boot real

La review dejó anotado que el arranque real con DB quedaba pendiente. Se
ejercitó en el demo de D1.3 (backend local + Postgres descartable) y encontró
el bug que la suite unitaria no puede ver: `KycModule` usaba `AccessTokenGuard`
sin importar `AuthModule` → `UnknownDependenciesException` en el boot. Fix
mínimo en `kyc.module.ts` (mismo patrón que UserModule/ContractModule),
verificado con el boot completo + la corrida entera del gate
(`docs/deliverables/scf-tranche1/d1.3-kyc-evidencia.md`). Gates re-corridos:
`tsc --noEmit` 0 · 189/189 con el flag en default.
