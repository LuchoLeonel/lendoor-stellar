const ACCOUNT_ID_VERSION_BYTE = 6 << 3;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of input) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('Invalid base32 character');
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function crc16Xmodem(bytes: Buffer): number {
  let crc = 0x0000;

  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc;
}

export function decodeStellarPublicKey(accountId: string): Buffer {
  const decoded = decodeBase32(accountId);
  if (decoded.length !== 35) {
    throw new Error('Invalid Stellar account length');
  }
  if (decoded[0] !== ACCOUNT_ID_VERSION_BYTE) {
    throw new Error('Invalid Stellar account version byte');
  }

  const payload = decoded.subarray(0, 33);
  const expected = crc16Xmodem(payload);
  const actual = decoded[33] | (decoded[34] << 8);
  if (actual !== expected) {
    throw new Error('Invalid Stellar account checksum');
  }

  return decoded.subarray(1, 33);
}

export function isValidStellarPublicKey(accountId: string): boolean {
  try {
    decodeStellarPublicKey(accountId);
    return true;
  } catch {
    return false;
  }
}
