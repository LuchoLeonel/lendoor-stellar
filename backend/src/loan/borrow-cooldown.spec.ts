import { BadRequestException } from '@nestjs/common';

import { borrowCooldownError } from './borrow-cooldown';

describe('borrowCooldownError', () => {
  const nextAt = 1_792_842_847 + 4 * 86_400; // 4 días de min_hold

  it('sin cooldown (next_borrow_time = 0) deja pedir', () => {
    expect(borrowCooldownError(0, 1_792_842_847)).toBeNull();
  });

  it('cooldown vencido deja pedir (borde incluido)', () => {
    expect(borrowCooldownError(nextAt, nextAt)).toBeNull();
    expect(borrowCooldownError(nextAt, nextAt + 1)).toBeNull();
  });

  it('dentro del cooldown devuelve 400 BORROW_COOLDOWN con la fecha', () => {
    const err = borrowCooldownError(nextAt, nextAt - 60);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err!.getResponse() as Record<string, string>;
    expect(body.code).toBe('BORROW_COOLDOWN');
    expect(body.nextBorrowAt).toBe(new Date(nextAt * 1000).toISOString());
    expect(body.message).toMatch(/Podés pedir uno nuevo desde el /);
  });
});
