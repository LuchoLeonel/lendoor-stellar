import {
  getAddress,
  getNetworkDetails,
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

function errorMessage(result: FreighterError): string | null {
  if (!result.error) return null;
  return typeof result.error === "string"
    ? result.error
    : result.error.message ?? "Freighter request failed";
}

export function isStellarMode(): boolean {
  return (
    (import.meta.env.VITE_CHAIN_MODE as string | undefined)?.toLowerCase() ===
    "stellar"
  );
}

export async function getFreighterStatus(): Promise<StellarWalletStatus> {
  const connected = await isConnected();
  const installed =
    typeof connected === "boolean" ? connected : connected.isConnected === true;

  if (!installed) {
    return {
      installed: false,
      address: null,
      network: null,
      networkPassphrase: null,
      sorobanRpcUrl: null,
    };
  }

  const addressResult = await getAddress();
  const addressError = errorMessage(addressResult);
  const details = await getNetworkDetails();

  return {
    installed,
    address: addressError ? null : addressResult.address || null,
    network: details.network ?? null,
    networkPassphrase: details.networkPassphrase ?? null,
    sorobanRpcUrl: details.sorobanRpcUrl ?? null,
  };
}

export async function requestFreighterAddress(): Promise<string> {
  const result = await requestAccess();
  const message = errorMessage(result);
  if (message) throw new Error(message);
  if (!result.address) throw new Error("Freighter did not return an address");
  return result.address;
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
