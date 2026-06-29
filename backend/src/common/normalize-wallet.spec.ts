import { BadRequestException } from '@nestjs/common';
import { normalizeWallet } from './normalize-wallet';

describe('normalizeWallet', () => {
  it('lowercases legacy EVM addresses', () => {
    expect(normalizeWallet('0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD')).toBe(
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    );
  });

  it('preserves valid Stellar account IDs', () => {
    const account =
      'GAIRISXKPLOWZBMFRPU5XRGUUX3VMA3ZEWKBM5MSNRU3CHV6P4PYZ74D';

    expect(normalizeWallet(` ${account} `)).toBe(account);
  });

  it('rejects invalid wallets', () => {
    expect(() => normalizeWallet('GABC')).toThrow(BadRequestException);
  });
});
