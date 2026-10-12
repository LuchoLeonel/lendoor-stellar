# Retro-review del push del Tranche 1 (12/10)

**Alcance:** commits `381c968a` (D1.3), `646b400e`/`6290e898` (PR #7), `46436b3a`
(evidencia D1.2 + README). Pedido explícito: documentar todo y revisar.
Esta review llegó DESPUÉS del push — el proceso correcto era al revés y queda
anotado como regla para adelante: ningún push de material nuevo sin pasar la
review antes.

## Hallazgo 🔴 (corregido): PII en el GIF publicado

`media/d1.2-privy-onboarding-parte1.gif` (44 frames) incluía frames del wizard
con el **email y el teléfono del tester visibles** — los screenshots del
debugging quedaron como frames del grabador. Corregido en este commit: el GIF
se reemplazó por un corte redactado (6 frames; email/teléfono cubiertos con
barra negra, verificado frame por frame). ⚠️ El blob original sigue en la
HISTORIA de git (`46436b3a`): borrarlo de verdad exige reescribir la historia
de main + force push (+ pedido a GitHub por las cachés) — decisión del equipo,
no se hace unilateralmente.

## Qué se re-verificó del resto (sin hallazgos)

- `d1.2-privy-deposito-soroban-parte2.gif`: 4 frames de /lend, sin datos
  personales (la UI no muestra email/teléfono/address).
- Los tres docs de evidencia y las reviews: sin emails, teléfonos ni secretos;
  solo addresses públicas de testnet y hashes verificables.
- Hashes contra la chain: `921a72c4` (changeTrust) y `49ab280b` (deposit) son
  `invoke_host_function`/`change_trust` con source la wallet del usuario.
- Gates re-corridos en ambos lados con el `.env` local neutralizado:
  frontend 442/442, backend 189/189.
