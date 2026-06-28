import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signMessage,
  signTransaction,
} from "@stellar/freighter-api";

export type StellarWalletStatus = {
  installed: boolean;
  address: string | null;
  network: string | null;
  networkPassphrase: string | null;
  sorobanRpcUrl: string | null;
};

type FreighterError = { error?: string | { message?: string } };

const FREIGHTER_REQUEST_TIMEOUT_MS = 30_000;
const FREIGHTER_DETECT_TIMEOUT_MS = 5_000;

function errorMessage(result: FreighterError): string | null {
  if (!result.error) return null;
  return typeof result.error === "string"
    ? result.error
    : result.error.message ?? "Freighter request failed";
}

function hasInjectedFreighterGlobal(): boolean {
  if (typeof window === "undefined") return false;
  const freighterWindow = window as Window & {
    freighter?: unknown;
    freighterApi?: unknown;
  };
  return !!freighterWindow.freighter || !!freighterWindow.freighterApi;
}

async function isFreighterAvailable(): Promise<boolean> {
  if (hasInjectedFreighterGlobal()) return true;

  try {
    const connection = await withTimeout(
      isConnected(),
      FREIGHTER_DETECT_TIMEOUT_MS,
      "Freighter detection",
    );
    return typeof connection === "boolean"
      ? connection
      : connection.isConnected === true;
  } catch {
    return false;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)}s. ` +
            "Check that Freighter is installed, unlocked, and allowed for this site.",
        ),
      );
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function isStellarMode(): boolean {
  return (
    (import.meta.env.VITE_CHAIN_MODE as string | undefined)?.toLowerCase() ===
    "stellar"
  );
}

export async function getFreighterStatus(): Promise<StellarWalletStatus> {
  if (!(await isFreighterAvailable())) {
    return {
      installed: false,
      address: null,
      network: null,
      networkPassphrase: null,
      sorobanRpcUrl: null,
    };
  }

  const allowedResult = await withTimeout(
    isAllowed().catch(() => ({ isAllowed: false })),
    FREIGHTER_DETECT_TIMEOUT_MS,
    "Freighter permission check",
  );
  const allowed =
    typeof allowedResult === "boolean"
      ? allowedResult
      : allowedResult.isAllowed === true;
  if (!allowed) {
    return {
      installed: true,
      address: null,
      network: null,
      networkPassphrase: null,
      sorobanRpcUrl: null,
    };
  }

  const addressResult = await withTimeout(
    getAddress().catch((error: unknown) => ({
      error:
        error instanceof Error
          ? error.message
          : "Freighter did not return an address",
    })),
    FREIGHTER_REQUEST_TIMEOUT_MS,
    "Freighter address lookup",
  );
  const addressError = errorMessage(addressResult);
  const address =
    !addressError && typeof addressResult.address === "string"
      ? addressResult.address.trim() || null
      : null;
  const details = await withTimeout(
    getNetworkDetails().catch(() => ({
      network: null,
      networkPassphrase: null,
      sorobanRpcUrl: null,
    })),
    FREIGHTER_DETECT_TIMEOUT_MS,
    "Freighter network lookup",
  );

  return {
    installed: true,
    address,
    network: details.network ?? null,
    networkPassphrase: details.networkPassphrase ?? null,
    sorobanRpcUrl: details.sorobanRpcUrl ?? null,
  };
}

export async function requestFreighterAddress(): Promise<string> {
  if (!(await isFreighterAvailable())) {
    throw new Error(
      "Freighter wallet extension not detected. Install Freighter for Firefox or Chrome, unlock it, and reload this page.",
    );
  }

  const result = await withTimeout(
    requestAccess(),
    FREIGHTER_REQUEST_TIMEOUT_MS,
    "Freighter connection",
  );
  const message = errorMessage(result);
  const address = result.address?.trim();
  if (address) return address;
  if (message) throw new Error(message);
  if (!address) {
    throw new Error(
      "Freighter did not return an address. Approve site access in the Freighter popup and try again.",
    );
  }
  return address;
}

export async function signFreighterTransaction(
  xdr: string,
  opts: {
    address: string;
    networkPassphrase?: string | null;
  },
): Promise<string> {
  const result = await signTransaction(xdr, {
    address: opts.address,
    networkPassphrase: opts.networkPassphrase ?? undefined,
  });
  const message = errorMessage(result);
  if (message) throw new Error(message);
  if (!result.signedTxXdr) {
    throw new Error("Freighter did not return a signed transaction");
  }
  return result.signedTxXdr;
}

export async function signFreighterMessage(
  message: string,
  address: string,
): Promise<string> {
  const result = await signMessage(message, { address });
  const error = errorMessage(result);
  if (error) throw new Error(error);
  if (!result.signedMessage) {
    throw new Error("Freighter did not return a signed message");
  }
  return typeof result.signedMessage === "string"
    ? result.signedMessage
    : result.signedMessage.toString("base64");
}
