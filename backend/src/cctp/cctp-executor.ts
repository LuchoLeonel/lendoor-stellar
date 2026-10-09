/**
 * Executor CCTP — D1.1: la orquestación burn → attestation → mint → vault.
 *
 * Interfaces de los contratos de Circle verificadas VERBATIM contra testnet
 * el 2026-10-08 con `stellar contract info interface`:
 *   CctpForwarder.mint_and_forward(message: Bytes, attestation: Bytes)
 *   MessageTransmitter.is_nonce_used(nonce: BytesN<32>) -> bool
 *
 * Diseño: todo lo que toca red entra por PUERTOS (SorobanSubmitter,
 * NonceOracle, IrisClient) y la lógica queda pura y unit-testeable — la misma
 * regla que salvó a la máquina de estados en los reviews de PR #3/#4. El
 * executor NUNCA escribe `state` directo: solo vía transition()/reconcile().
 *
 * Dos modos de entrega, decididos por el hookData (nunca por input aparte):
 *  - DIRECTO: forwardRecipient == beneficiary → el forwarder ya dejó el USDC
 *    en la wallet del usuario; delivered al confirmar el mint.
 *  - VAULT: forwardRecipient == relayer → tras el mint, el relayer llama
 *    vault.deposit_from(relayer, beneficiary, amount7) y las shares quedan a
 *    nombre del usuario. Cualquier otro recipient es un error de armado y se
 *    marca failed ANTES de gastar el fee del mint.
 */
import { xdr, nativeToScVal } from '@stellar/stellar-sdk';

import { StellarCctpConfig } from './cctp-chains';
import { hexToBytes } from './cctp-message';
import { CctpTransfer, IrisClient, reconcile, transition } from './cctp-transfer';
import { DeliveryPlan, depositFromScVals, planDelivery } from './stellar-mint';

/** Envía UNA invocación Soroban firmada por el relayer y espera confirmación. */
export interface SorobanSubmitter {
  submit(contractId: string, method: string, args: xdr.ScVal[]): Promise<{ txHash: string }>;
}

/** is_nonce_used en el MessageTransmitter — la verdad on-chain de reconcile. */
export interface NonceOracle {
  isNonceUsed(nonce: `0x${string}`): Promise<boolean>;
}

export function nonceScVal(nonce: `0x${string}`): xdr.ScVal {
  const bytes = hexToBytes(nonce);
  if (bytes.length !== 32) {
    throw new RangeError(`nonce must be 32 bytes, got ${bytes.length}`);
  }
  return nativeToScVal(Buffer.from(bytes), { type: 'bytes' });
}

export interface CctpExecutorDeps {
  readonly iris: IrisClient;
  readonly soroban: SorobanSubmitter;
  readonly nonces: NonceOracle;
  readonly config: StellarCctpConfig;
  /** G del relayer que firma mint_and_forward y deposit_from. */
  readonly relayerAddress: string;
  /** C del vault Instaward (deposit_from vive ahí). */
  readonly vaultContractId: string;
}

export class CctpExecutor {
  constructor(private readonly deps: CctpExecutorDeps) {}

  /**
   * Un paso de polling: pregunta a Iris y a la cadena, y devuelve la fila
   * reconciliada (pura: el caller persiste). Si volvió 'attested', el caller
   * sigue con deliver().
   */
  async poll(t: CctpTransfer): Promise<CctpTransfer> {
    const iris = await this.deps.iris.getAttestation(t.sourceDomain, t.burnTxHash);
    const used = await this.deps.nonces.isNonceUsed(t.nonce as `0x${string}`);
    return reconcile(t, iris, used);
  }

  /**
   * Entrega una fila 'attested': valida el plan, submitea mint_and_forward y
   * (en modo VAULT) deposit_from. Devuelve la fila final; los errores de
   * armado van a 'failed' con motivo, los de red re-tiran para que el worker
   * reintente SIN perder el estado (el nonce sigue sin consumir).
   */
  async deliver(t: CctpTransfer): Promise<CctpTransfer> {
    if (t.state !== 'attested' || !t.attestation) {
      throw new Error(`deliver() wants an attested row with attestation, got '${t.state}'`);
    }
    if (!t.message) {
      throw new Error(`transfer ${t.nonce}: no CCTP message stored; cannot build the mint`);
    }

    let plan: DeliveryPlan;
    try {
      plan = planDelivery(t.message, t.attestation, this.deps.config);
    } catch (e) {
      // armado inválido (dominio, forwarder, hook, monto): fee jamás gastado
      return transition(t, 'failed', { lastError: (e as Error).message });
    }

    // Integridad fila↔mensaje: el nonce del mensaje ES la clave de la fila.
    if (plan.nonce !== t.nonce) {
      return transition(t, 'failed', {
        lastError: `message nonce ${plan.nonce} does not match transfer nonce ${t.nonce}`,
      });
    }

    const direct = plan.forwardRecipient === t.beneficiary;
    if (!direct && plan.forwardRecipient !== this.deps.relayerAddress) {
      // ni el usuario ni nuestro relayer: ese mint le daría la plata a OTRO
      return transition(t, 'failed', {
        lastError: `forwardRecipient ${plan.forwardRecipient} is neither the beneficiary nor the relayer`,
      });
    }

    // Idempotencia dura antes de gastar: ¿alguien ya consumió el nonce?
    if (await this.deps.nonces.isNonceUsed(plan.nonce)) {
      const iris = { kind: 'complete', attestation: t.attestation } as const;
      return reconcile(t, iris, true);
    }

    let cur = transition(t, 'submitting');
    const mint = await this.deps.soroban.submit(
      this.deps.config.cctpForwarder,
      'mint_and_forward',
      plan.mintArgs,
    );
    cur = transition(cur, 'submitting', { mintTxHash: mint.txHash });

    if (!direct) {
      // modo VAULT: el USDC quedó en el relayer; va al vault a nombre del user
      await this.deps.soroban.submit(
        this.deps.vaultContractId,
        'deposit_from',
        depositFromScVals(this.deps.relayerAddress, t.beneficiary, plan.amount7),
      );
    }
    return transition(cur, 'delivered');
  }
}
