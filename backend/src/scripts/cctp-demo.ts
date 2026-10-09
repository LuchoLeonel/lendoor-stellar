/**
 * Demo vivo D1.1 — USDC de Base Sepolia al vault en Stellar testnet vía CCTP.
 *
 *   yarn cctp:demo burn                 # approve + depositForBurnWithHook en Base Sepolia
 *   yarn cctp:demo deliver <burnTxHash> # Iris → mint_and_forward → (vault) deposit_from
 *   yarn cctp:demo trustline            # changeTrust USDC para la cuenta firmante
 *
 * Env (TODAS claves de TESTNET creadas para esto — JAMÁS una clave que haya
 * tocado prod; crear una wallet nueva y fondearla en faucet.circle.com +
 * el faucet de Base Sepolia):
 *   EVM_PRIVATE_KEY          clave que quema en Base Sepolia
 *   STELLAR_RELAYER_SECRET   S… del relayer que firma en Stellar
 *   CCTP_BENEFICIARY         G… que recibe (directo) o dueño de las shares (vault)
 *   CCTP_MODE                direct | vault   (default: direct)
 *   CCTP_AMOUNT_USDC         default "1"
 *   CCTP_VAULT_ID            C… del vault Instaward (solo modo vault)
 *   BASE_SEPOLIA_RPC         default https://sepolia.base.org
 */
import { JsonRpcProvider, Wallet, formatUnits } from 'ethers';
import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

import { BASE_SEPOLIA, STELLAR_TESTNET } from '../cctp/cctp-chains';
import { CctpExecutor, nonceScVal, NonceOracle, SorobanSubmitter } from '../cctp/cctp-executor';
import { parseCctpMessage, parseForwarderHookData } from '../cctp/cctp-message';
import { CctpTransfer } from '../cctp/cctp-transfer';
import { buildBurnToStellar, ERC20_IFACE } from '../cctp/evm-burn';
import { HttpIrisClient } from '../cctp/iris-client';
import { toUnits } from '../common/amount-units';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`[cctp-demo] ${m}`);

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`falta la env ${name}`);
  return v;
}

/** Puerto real: una invocación Soroban firmada por el relayer, confirmada. */
class LiveSoroban implements SorobanSubmitter {
  constructor(
    private readonly server: rpc.Server,
    private readonly signer: Keypair,
  ) {}

  async submit(contractId: string, method: string, args: xdr.ScVal[]) {
    const account = await this.server.getAccount(this.signer.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_TESTNET.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(120)
      .build();
    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(this.signer);
    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      throw new Error(`${method}: send ERROR ${sent.errorResult?.toXDR('base64')}`);
    }
    for (let i = 0; i < 60; i += 1) {
      const r = await this.server.getTransaction(sent.hash);
      if (r.status === 'SUCCESS') {
        log(`${method} OK — tx ${sent.hash}`);
        return { txHash: sent.hash };
      }
      if (r.status === 'FAILED') {
        throw new Error(`${method}: tx ${sent.hash} FAILED on-chain: ${r.resultXdr?.toXDR('base64')}`);
      }
      await sleep(2_000);
    }
    throw new Error(`${method}: tx ${sent.hash} sin confirmar tras 120 s`);
  }
}

/** Puerto real: is_nonce_used por SIMULACIÓN (lectura, cero fee). */
class LiveNonces implements NonceOracle {
  constructor(
    private readonly server: rpc.Server,
    private readonly viewer: string,
  ) {}

  async isNonceUsed(nonce: `0x${string}`): Promise<boolean> {
    const account = await this.server.getAccount(this.viewer);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_TESTNET.networkPassphrase,
    })
      .addOperation(
        new Contract(STELLAR_TESTNET.messageTransmitter).call('is_nonce_used', nonceScVal(nonce)),
      )
      .setTimeout(60)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Error(`is_nonce_used: simulación falló para ${nonce}`);
    }
    return scValToNative(sim.result.retval) as boolean;
  }
}

async function cmdBurn(): Promise<void> {
  const mode = env('CCTP_MODE', 'direct');
  const beneficiary = env('CCTP_BENEFICIARY');
  const relayer = Keypair.fromSecret(env('STELLAR_RELAYER_SECRET')).publicKey();
  // el hook decide el modo: directo → el user; vault → el relayer y después deposit_from
  const forwardRecipient = mode === 'vault' ? relayer : beneficiary;
  const amountUsdc6 = toUnits(env('CCTP_AMOUNT_USDC', '1'), 6);

  const provider = new JsonRpcProvider(env('BASE_SEPOLIA_RPC', 'https://sepolia.base.org'), BASE_SEPOLIA.chainId);
  const wallet = new Wallet(env('EVM_PRIVATE_KEY'), provider);
  log(`quemando ${formatUnits(amountUsdc6, 6)} USDC desde ${wallet.address} (modo ${mode})`);
  log(`forwardRecipient en el hook: ${forwardRecipient}`);

  const balData = ERC20_IFACE.encodeFunctionData('balanceOf', [wallet.address]);
  const bal = BigInt(await provider.call({ to: BASE_SEPOLIA.usdc, data: balData }));
  if (bal < amountUsdc6) {
    throw new Error(
      `saldo USDC insuficiente en Base Sepolia: ${formatUnits(bal, 6)} < ${formatUnits(amountUsdc6, 6)} — fondear en faucet.circle.com`,
    );
  }

  const plan = buildBurnToStellar({
    config: BASE_SEPOLIA,
    stellarDomain: STELLAR_TESTNET.domain,
    forwarderContractId: STELLAR_TESTNET.cctpForwarder,
    forwardRecipient,
    amountUsdc6,
  });

  const approve = await wallet.sendTransaction({ to: plan.usdc, data: plan.approveData });
  await approve.wait();
  log(`approve OK — ${approve.hash}`);
  const burn = await wallet.sendTransaction({ to: plan.tokenMessengerV2, data: plan.burnData });
  const receipt = await burn.wait();
  log(`burn OK — ${burn.hash} (block ${receipt?.blockNumber})`);
  log(`siguiente paso: yarn cctp:demo deliver ${burn.hash}`);
}

async function cmdDeliver(burnTxHash: string): Promise<void> {
  const beneficiary = env('CCTP_BENEFICIARY');
  const relayerKp = Keypair.fromSecret(env('STELLAR_RELAYER_SECRET'));
  const server = new rpc.Server(STELLAR_TESTNET.sorobanRpcUrl);
  const iris = new HttpIrisClient(STELLAR_TESTNET.irisBaseUrl);

  log(`esperando attestation de Iris para ${burnTxHash} (Standard Transfer: minutos)…`);
  let message: string | undefined;
  let attestation: string | undefined;
  for (;;) {
    const st = await iris.getAttestation(BASE_SEPOLIA.domain, burnTxHash);
    if (st.kind === 'complete') {
      if (!st.message) throw new Error('Iris devolvió complete sin message — no se puede mintear');
      message = st.message;
      attestation = st.attestation;
      break;
    }
    if (st.kind === 'error') throw new Error(`Iris: ${st.message}`);
    const wait = st.kind === 'backoff' ? st.retryAfterMs : 10_000;
    log(`iris: ${st.kind}; reintento en ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }

  const { header, body } = parseCctpMessage(message);
  const hook = parseForwarderHookData(body.hookData);
  log(`attestation lista — nonce ${header.nonce}`);
  log(`monto ${formatUnits(body.amount, 6)} USDC → ${hook.forwardRecipient}`);

  const row: CctpTransfer = {
    nonce: header.nonce,
    sourceDomain: BASE_SEPOLIA.domain,
    destinationDomain: STELLAR_TESTNET.domain,
    burnTxHash,
    amountUsdc6: body.amount,
    beneficiary,
    state: 'attested',
    attestation,
    message,
    attempts: 0,
  };

  // modo vault (hook → relayer): el vault es obligatorio; directo: no se usa
  const vaultMode = hook.forwardRecipient === relayerKp.publicKey();
  const vaultContractId = vaultMode ? env('CCTP_VAULT_ID') : (process.env.CCTP_VAULT_ID ?? '');

  const executor = new CctpExecutor({
    iris,
    soroban: new LiveSoroban(server, relayerKp),
    nonces: new LiveNonces(server, relayerKp.publicKey()),
    config: STELLAR_TESTNET,
    relayerAddress: relayerKp.publicKey(),
    vaultContractId,
  });

  const out = await executor.deliver(row);
  log(`estado final: ${out.state}${out.mintTxHash ? ` — mint ${out.mintTxHash}` : ''}`);
  if (out.state === 'failed') throw new Error(out.lastError);
}

async function cmdTrustline(): Promise<void> {
  const kp = Keypair.fromSecret(env('STELLAR_RELAYER_SECRET'));
  const server = new rpc.Server(STELLAR_TESTNET.sorobanRpcUrl);
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_TESTNET.networkPassphrase,
  })
    .addOperation(
      Operation.changeTrust({ asset: new Asset('USDC', STELLAR_TESTNET.usdcIssuer) }),
    )
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  for (let i = 0; i < 15; i += 1) {
    const r = await server.getTransaction(sent.hash);
    if (r.status === 'SUCCESS') {
      log(`changeTrust USDC OK — ${sent.hash}`);
      return;
    }
    if (r.status === 'FAILED') throw new Error(`changeTrust FAILED — ${sent.hash}`);
    await sleep(2_000);
  }
  throw new Error(`changeTrust sin confirmar — ${sent.hash}`);
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'burn') return cmdBurn();
  if (cmd === 'deliver' && arg) return cmdDeliver(arg);
  if (cmd === 'trustline') return cmdTrustline();
  console.error('uso: cctp-demo burn | deliver <burnTxHash> | trustline');
  process.exit(1);
}

main().catch((e) => {
  console.error(`[cctp-demo] ERROR: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
