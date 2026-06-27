'use client'

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


export const DECIMALS = 6

/** Add thousands separators to an unsigned integer string. */
export function withThousands(s: string) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Parse a decimal string into minor units (bigint) with rounding to `decimals`. */
function decimalToUnits(v: string, decimals = DECIMALS): bigint | null {
  if (!v) return null
  const raw = v.replace(/\s|,/g, '')
  if (!/^[-+]?\d*(\.\d*)?$/.test(raw)) return null

  const neg = raw.startsWith('-')
  const x = neg || raw.startsWith('+') ? raw.slice(1) : raw
  const [iPart = '0', fPartRaw = ''] = x.split('.')

  const i = iPart === '' ? '0' : iPart
  const f = fPartRaw.replace(/\D/g, '')
  const base = 10n ** BigInt(decimals)

  // Build fractional with one extra digit for rounding
  const padded = (f + '0'.repeat(decimals + 1)).slice(0, decimals + 1)
  const head = padded.slice(0, decimals) || '0'
  const next = Number(padded.charAt(decimals) || '0')

  let frac = BigInt(head)
  let whole = BigInt(i)

  if (next >= 5) {
    frac += 1n
    const limit = 10n ** BigInt(decimals)
    if (frac >= limit) { frac -= limit; whole += 1n }
  }

  let units = whole * base + frac
  if (neg) units = -units
  return units
}

/**
 * Format a bigint in minor units into a human string,
 * with rounding and min/max fractional digits.
 */
export function formatAmount(
  amount: bigint,
  decimals = DECIMALS,
  minFrac = 0,
  maxFrac = 6
): string {
  const neg = amount < 0n
  const a = neg ? -amount : amount
  const base = 10n ** BigInt(decimals)

  let whole = a / base
  const rem = a % base

  // Fractional string padded to `decimals`, then rounded to `maxFrac`
  let fracFull = rem.toString().padStart(Number(decimals), '0')

  if (decimals > maxFrac) {
    const head = fracFull.slice(0, maxFrac) || '0'
    const nextDigit = Number(fracFull.charAt(maxFrac) || '0')
    let headInt = BigInt(head)
    if (nextDigit >= 5) {
      headInt += 1n
      const limit = 10n ** BigInt(maxFrac)
      if (headInt >= limit) { headInt -= limit; whole += 1n }
    }
    fracFull = headInt.toString().padStart(maxFrac, '0')
  } else {
    fracFull = fracFull.padEnd(maxFrac, '0')
  }

  // Trim trailing zeros but keep at least `minFrac`
  let fracTrimmed = fracFull.replace(/0+$/, '')
  if (fracTrimmed.length < minFrac) {
    fracTrimmed = fracFull.slice(0, Math.max(minFrac, Math.min(maxFrac, fracFull.length)))
  } else if (fracTrimmed.length > maxFrac) {
    fracTrimmed = fracTrimmed.slice(0, maxFrac)
  }

  const sign = neg ? '-' : ''
  const wholeStr = withThousands(whole.toString())
  return fracTrimmed.length ? `${sign}${wholeStr}.${fracTrimmed}` : `${sign}${wholeStr}`
}

/** Public API — flexible (0–6 decimales, sin ceros sobrantes). */
export function formatUSDCAmount(value: bigint | string): string {
  const units =
    typeof value === 'bigint'
      ? value
      : decimalToUnits(value, DECIMALS)

  if (units == null) return typeof value === 'string' ? value : '—'
  return formatAmount(units, DECIMALS, 0, 6)
}

/** Public API — exactamente 2 decimales, con redondeo correcto. */
export function formatUSDCAmount2dp(value: bigint | string): string {
  const units =
    typeof value === 'bigint'
      ? value
      : decimalToUnits(value, DECIMALS)

  if (units == null) return typeof value === 'string' ? value : '—'
  return formatAmount(units, DECIMALS, 2, 2)
}

/**
 * Spec 031 — exactamente 2 decimales, TRUNCADO (no redondea).
 *
 * Para deudas activas: mostrar el "piso" del valor real para que la
 * home y el pay screen coincidan en sus primeros caracteres
 * (ejemplo: deuda real 24.8765708 → home "24.87", pay "24.8765708").
 * Redondear hacia arriba (24.88) inflaba lo que el usuario cree que
 * debe vs lo que el contrato realmente le va a pull.
 */
export function formatUSDCAmount2dpTruncated(value: bigint | string): string {
  const units =
    typeof value === 'bigint'
      ? value
      : decimalToUnits(value, DECIMALS)

  if (units == null) return typeof value === 'string' ? value : '—'
  // Truncate: drop the last (DECIMALS - 2) digits without rounding.
  const truncFactor = 10n ** BigInt(Number(DECIMALS) - 2)
  const truncated = units / truncFactor * truncFactor
  return formatAmount(truncated, DECIMALS, 2, 2)
}

export const softWait = (ms = 4_000) => new Promise(r => setTimeout(r, ms))

export function formatEvmError(e: unknown, fallback = 'Transaction failed') {
  const err = e as Record<string, unknown> | null | undefined;
  return (err?.shortMessage as string) || (err?.reason as string) || (err?.message as string) || fallback;
}

// Normaliza distintos formatos de error a un string amigable
export function normalizeErrorMessage(err: unknown): string | null {
  if (!err) return null;

  // Caso: objeto con .message (Error, o JSON ya parseado)
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as Record<string, unknown>).message;
    return typeof msg === "string" ? msg : String(msg);
  }

  // Caso: string -> intento parsear como JSON y usar .message
  if (typeof err === "string") {
    try {
      const parsed = JSON.parse(err);
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        (parsed as Record<string, unknown>).message
      ) {
        const msg = (parsed as Record<string, unknown>).message;
        return typeof msg === "string" ? msg : String(msg);
      }
    } catch {
      // No era JSON, seguimos con el string original
    }
    return err;
  }

  // Fallback: cualquier cosa rara → string
  return String(err);
}


// Config: XP necesaria para subir un nivel
export const XP_PER_LEVEL = 10;

// Máximo nivel visible (podés cambiarlo cuando quieras)
export const MAX_LEVEL = 1000;

// Parseamos el string que viene del backend (score display) a número
export function getScoreNumber(display: string | null | undefined): number {
  if (!display) return 0;

  const str = String(display).replace(",", "."); // por si viene "1,5"
  const match = str.match(/(\d+(\.\d+)?)/); // primer número del string

  if (!match) return 0;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : 0;
}

type LevelInfo = {
  level: number; // nivel mostrado (1..MAX_LEVEL)
  totalXp: number; // XP total acumulada
  xpInLevel: number; // XP dentro del nivel actual
  xpToNextLevel: number; // XP que falta para el próximo nivel (0 si max)
  progressInLevel: number; // 0–1
};

export function getLevelInfoFromXp(rawXp: number): LevelInfo {
  const totalXp = Math.max(0, Math.floor(rawXp)); // XP total, sin máximo
  const rawLevel = Math.floor(totalXp / XP_PER_LEVEL) + 1; // podría pasar MAX_LEVEL
  const level = Math.min(rawLevel, MAX_LEVEL);

  // Si ya superó el nivel máximo, lo mostramos como lleno
  if (rawLevel > MAX_LEVEL) {
    return {
      level,
      totalXp,
      xpInLevel: XP_PER_LEVEL,
      xpToNextLevel: 0,
      progressInLevel: 1,
    };
  }

  const xpFromPrevLevels = (level - 1) * XP_PER_LEVEL;
  const xpInLevel = totalXp - xpFromPrevLevels;
  const xpToNextLevel = XP_PER_LEVEL - xpInLevel;
  const progressInLevel =
    XP_PER_LEVEL > 0 ? xpInLevel / XP_PER_LEVEL : 0;

  return {
    level,
    totalXp,
    xpInLevel,
    xpToNextLevel,
    progressInLevel,
  };
}

const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const baseImageUrl = isLocal ? 'http://localhost:3000' : 'https://lendoor.xyz';


export const evmNetworks = [
  {
    blockExplorerUrls: [
      'https://celoscan.io',
      'https://explorer.celo.org/mainnet',
    ],
    chainId: 42220,
    chainName: 'Celo Mainnet',
    iconUrls: [`${baseImageUrl}/celo_logo.png`], // ajustá el asset si usás otro nombre
    name: 'Celo',
    nativeCurrency: {
      decimals: 18,
      name: 'Celo',
      symbol: 'CELO',
      iconUrl: `${baseImageUrl}/celo_logo.png`,
    },
    networkId: 42220,
    rpcUrls: [
      "https://celo-mainnet.g.alchemy.com/v2/Llu-xslYjx24aeg7GnT2v",
      'https://forno.celo.org',
      'https://rpc.ankr.com/celo',
      'https://1rpc.io/celo',
    ],
    vanityName: 'Celo',
  },
];

export function stellarTxExplorerUrl(
  txHash: string,
  network: 'testnet' | 'public' = 'testnet',
): string {
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

export function transactionExplorerUrl(
  txHash?: string | null,
  mode?: 'stellar' | string | null,
): string | null {
  if (!txHash) return null;
  if (mode === 'stellar' || /^[0-9a-fA-F]{64}$/.test(txHash)) {
    return stellarTxExplorerUrl(txHash);
  }

  const base = evmNetworks[0]?.blockExplorerUrls[0] ?? 'https://celoscan.io';
  return `${base}/tx/${txHash}`;
}



export const tokensToCheckTeleporter = [
  /*
  {
    addr: "0xE69711C55f6E87F4c39321D3aDeCc4C2CAddc471",
    chainId: 11155111,
    blockNumber: 8442172,
    balance: 0,
  },
  {
    addr: "0x92A08a34488Fcc8772Af2269186e015Eca494Baa",
    chainId: 11155420,
    blockNumber: 28421349,
    balance: 0,
  },
  {
    addr: "0x7B4707070b8851F82B5339aaC7F6759d8e737E88",
    chainId: 84532,
    blockNumber: 26438476,
    balance: 0,
  },*/
];


