import { toUnits } from './amount-units';

// (review PR #2) el bug real: '-0.5' parseaba whole='-0' → 0n y la fraccion
// POSITIVA se sumaba — devolvia +500000 de un monto negativo, saltando los
// guards de monto <= 0 rio abajo. Decimales explicitos en cada caso para que
// la suite no dependa del BLOCKCHAIN_GATEWAY del entorno de test.
describe('toUnits', () => {
  it('convierte enteros y fracciones positivas', () => {
    expect(toUnits('1', 6)).toBe(1_000_000n);
    expect(toUnits('1.5', 6)).toBe(1_500_000n);
    expect(toUnits(0.25, 6)).toBe(250_000n);
    expect(toUnits('3', 7)).toBe(30_000_000n);
  });

  it('negativos fraccionales conservan el signo (el bug del review)', () => {
    expect(toUnits('-0.5', 6)).toBe(-500_000n);
    expect(toUnits('-1.5', 6)).toBe(-1_500_000n);
    expect(toUnits(-0.5, 7)).toBe(-5_000_000n);
  });

  it('trunca la fraccion excedente sin redondear', () => {
    expect(toUnits('0.1234567', 6)).toBe(123_456n);
    expect(toUnits('-0.1234567', 6)).toBe(-123_456n);
  });

  it('bigint pasa tal cual', () => {
    expect(toUnits(42n, 6)).toBe(42n);
  });
});
