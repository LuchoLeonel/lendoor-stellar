/**
 * Encoder del burn EVM → Stellar (CCTP V2) — D1.1.
 *
 * Adaptado de lumenline-labs/lumenline (Apache-2.0),
 * packages/sdk/src/rails/usdc-cctp/evm.ts, reescrito sobre ethers v6 (viem no
 * está en nuestras deps y no lo vamos a sumar por dos encodeFunctionData).
 * Los selectores de TokenMessengerV2 los verificó lumenline contra el
 * bytecode del proxy en Base mainnet (VERIFIED.md §3c); testnet comparte ABI.
 *
 * El flujo del demo: approve(USDC → TokenMessengerV2) +
 * depositForBurnWithHook(...) con mintRecipient = destinationCaller =
 * CctpForwarder y el recipient real en el hookData. La guarda
 * assertForwarderFields corre ANTES de encodear: un burn mal armado hacia
 * Stellar no se puede deshacer.
 */
import { Interface } from 'ethers';

import { EvmCctpConfig, FINALITY_STANDARD } from './cctp-chains';
import {
  assertForwarderFields,
  buildForwarderHookData,
  bytesToHex,
  contractAddressToBytes32,
} from './cctp-message';

export const TOKEN_MESSENGER_V2_IFACE = new Interface([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
]);

export const MESSAGE_TRANSMITTER_V2_IFACE = new Interface([
  'function usedNonces(bytes32 nonce) view returns (uint256)',
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
  'function localDomain() view returns (uint32)',
]);

export const ERC20_IFACE = new Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export interface BurnToStellarPlan {
  /** calldata del approve, target = config.usdc */
  readonly approveData: `0x${string}`;
  /** calldata del depositForBurnWithHook, target = config.tokenMessengerV2 */
  readonly burnData: `0x${string}`;
  readonly tokenMessengerV2: `0x${string}`;
  readonly usdc: `0x${string}`;
  /** lo que se quema, en unidades de 6 decimales */
  readonly amountUsdc6: bigint;
}

/**
 * Arma el par approve + depositForBurnWithHook para mover `amountUsdc6` de
 * una EVM chain CCTP al `forwardRecipient` (G/C/M) en Stellar.
 *
 * - maxFee = 0 y finality Standard (2000): el Standard Transfer no cobra
 *   on-chain fee; Fast (1000) sí y necesitaría maxFee > 0. Para el demo del
 *   award la espera de finality de Base Sepolia (~minutos) es aceptable.
 * - mintRecipient y destinationCaller NO son parámetros: siempre el
 *   forwarder, verificado por assertForwarderFields. El recipient real viaja
 *   en el hook.
 */
export function buildBurnToStellar(args: {
  config: EvmCctpConfig;
  stellarDomain: number;
  forwarderContractId: string;
  forwardRecipient: string;
  amountUsdc6: bigint;
  maxFee?: bigint;
  minFinalityThreshold?: number;
}): BurnToStellarPlan {
  if (args.amountUsdc6 <= 0n) {
    throw new RangeError(`burn amount must be positive, got ${args.amountUsdc6}`);
  }
  const forwarder32 = contractAddressToBytes32(args.forwarderContractId);
  // la guarda corre sobre los MISMOS bytes que se encodean — no sobre copias
  assertForwarderFields(
    { mintRecipient: forwarder32, destinationCaller: forwarder32 },
    args.forwarderContractId,
  );
  const hookData = buildForwarderHookData(args.forwardRecipient);

  const approveData = ERC20_IFACE.encodeFunctionData('approve', [
    args.config.tokenMessengerV2,
    args.amountUsdc6,
  ]) as `0x${string}`;

  const burnData = TOKEN_MESSENGER_V2_IFACE.encodeFunctionData('depositForBurnWithHook', [
    args.amountUsdc6,
    args.stellarDomain,
    bytesToHex(forwarder32),
    args.config.usdc,
    bytesToHex(forwarder32),
    args.maxFee ?? 0n,
    args.minFinalityThreshold ?? FINALITY_STANDARD,
    bytesToHex(hookData),
  ]) as `0x${string}`;

  return {
    approveData,
    burnData,
    tokenMessengerV2: args.config.tokenMessengerV2,
    usdc: args.config.usdc,
    amountUsdc6: args.amountUsdc6,
  };
}
