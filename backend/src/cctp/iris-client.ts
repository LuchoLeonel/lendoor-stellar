/**
 * Cliente HTTP real de Iris (CCTP v2) — D1.1.
 *
 * API: GET {base}/v2/messages/{sourceDomain}?transactionHash={burnTxHash}
 * Sandbox (testnet): https://iris-api-sandbox.circle.com
 * Prod:              https://iris-api.circle.com
 *
 * Toda la SEMANTICA de mapeo vive en `irisStatusFromHttp` (cctp-transfer.ts),
 * que el review del PR #3 endurecio: 200 no significa listo (manda
 * body.status y el sentinel "PENDING"), los 4xx de infra son backoff y jamas
 * terminales, y el Retry-After real de Circle se respeta. Este cliente SOLO
 * transporta: HTTP → (status, body, retryAfter) → irisStatusFromHttp.
 *
 * `fetchImpl` es inyectable para que la suite pruebe el transporte sin red.
 */
import {
  CctpDomain,
  IrisAttestationStatus,
  IrisClient,
  irisStatusFromHttp,
} from './cctp-transfer';

export const IRIS_SANDBOX_URL = 'https://iris-api-sandbox.circle.com';
export const IRIS_PROD_URL = 'https://iris-api.circle.com';

type IrisV2Message = {
  status?: string;
  attestation?: string | null;
  message?: string;
  eventNonce?: string;
};

export class HttpIrisClient implements IrisClient {
  constructor(
    private readonly baseUrl: string = IRIS_SANDBOX_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAttestation(
    sourceDomain: CctpDomain,
    burnTxHash: string,
  ): Promise<IrisAttestationStatus> {
    const url = `${this.baseUrl}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
      });
    } catch {
      // Red caida / DNS: transitorio NUESTRO, jamas terminal para el transfer.
      return { kind: 'backoff', retryAfterMs: 15_000 };
    }

    const retryAfterHeader = res.headers?.get?.('retry-after');
    const retryAfterSeconds = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10) || undefined
      : undefined;

    let body: { messages?: IrisV2Message[]; error?: string } | undefined;
    try {
      body = (await res.json()) as typeof body;
    } catch {
      body = undefined; // un body no-JSON no convierte nada en terminal
    }

    // La API v2 envuelve en messages[]; el mapeo semantico espera el mensaje
    // puntual. Varios mensajes por tx: con que UNO este listo alcanza para
    // este burn (el nonce especifico se valida on-chain igual).
    const messages = body?.messages ?? [];
    const ready = messages.find(
      (m) =>
        m.status === 'complete' &&
        typeof m.attestation === 'string' &&
        m.attestation.length > 0 &&
        m.attestation.toUpperCase() !== 'PENDING',
    );
    const flat = ready ?? messages[0];

    return irisStatusFromHttp(
      res.status,
      flat
        ? { attestation: flat.attestation, status: flat.status, error: body?.error }
        : { error: body?.error },
      retryAfterSeconds,
    );
  }
}
