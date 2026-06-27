export function toUnits(v: string | number | bigint, decimals = 6): bigint {
  if (typeof v === 'bigint') return v;
  const [wholeRaw, fracRaw = ''] = String(v).split('.');
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = fracRaw.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
}
