/**
 * Direcciones CCTP V2 verificadas — D1.1.
 *
 * Proveniencia (NO inventadas): adaptadas de lumenline-labs/lumenline
 * (Apache-2.0), packages/sdk/src/rails/usdc-cctp/chains.ts, que a su vez las
 * toma de developers.circle.com/cctp/references/stellar-contracts y
 * developers.circle.com/cctp/references/contract-addresses (verificadas por
 * ellos el 2026-09-11 contra bytecode on-chain, VERIFIED.md §1.6/§3b-c).
 *
 * Cruce con NUESTRO deploy (contratos/DEPLOYMENTS.md, par Instaward): el
 * `usdcSac` de testnet de Circle — CBIELTK6…DAMA — es EXACTAMENTE el asset de
 * settlement del vault Instaward. El CctpForwarder mintea el mismo token que
 * el vault acepta: el puente Base Sepolia → vault cierra sin ningún swap.
 */
import { CCTP_DOMAINS, CctpDomain } from './cctp-transfer';

export interface StellarCctpConfig {
  readonly domain: CctpDomain;
  /** TokenMessengerMinter (Soroban) — quema/mintea USDC. */
  readonly tokenMessengerMinter: string;
  /** MessageTransmitter (Soroban) — verifica attestations, consume nonces. */
  readonly messageTransmitter: string;
  /**
   * CctpForwarder (Soroban) — el ÚNICO mintRecipient/destinationCaller legal
   * para burns hacia Stellar (Circle: cualquier otro valor deja los fondos
   * "permanently stuck"). El recipient real viaja en el hookData.
   */
  readonly cctpForwarder: string;
  /** SAC del USDC de Circle en Stellar (C…). */
  readonly usdcSac: string;
  readonly usdcIssuer: string;
  readonly irisBaseUrl: string;
  readonly networkPassphrase: string;
  readonly sorobanRpcUrl: string;
}

export interface EvmCctpConfig {
  readonly chainId: number;
  readonly domain: CctpDomain;
  readonly tokenMessengerV2: `0x${string}`;
  readonly messageTransmitterV2: `0x${string}`;
  readonly usdc: `0x${string}`;
  /** USDC EVM: siempre 6 decimales (los 7 de Stellar se rescalan en UN lugar). */
  readonly decimals: 6;
}

/** Stellar testnet — muere con el reset del 2026-12-16, igual que el vault. */
export const STELLAR_TESTNET: StellarCctpConfig = {
  domain: CCTP_DOMAINS.STELLAR,
  tokenMessengerMinter: 'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
  messageTransmitter: 'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
  cctpForwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
  usdcSac: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  irisBaseUrl: 'https://iris-api-sandbox.circle.com',
  networkPassphrase: 'Test SDF Network ; September 2015',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
};

/** Base Sepolia — el origen EVM del demo D1.1. */
export const BASE_SEPOLIA: EvmCctpConfig = {
  chainId: 84532,
  domain: CCTP_DOMAINS.BASE_SEPOLIA,
  tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  messageTransmitterV2: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  decimals: 6,
};

/** Umbrales de finalidad de Circle: 1000 = Fast Transfer, 2000 = Standard. */
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;
