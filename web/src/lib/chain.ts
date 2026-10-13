import { numberToHex, type EIP1193Provider } from "viem";
import type { WalletAddChain } from "../config";

function isUnknownChain(error: unknown): boolean {
  const e = error as { code?: number; data?: { originalError?: { code?: number } }; message?: string };
  const code = e?.code ?? e?.data?.originalError?.code;
  if (code === 4902) return true;
  return /unrecognized chain|unknown chain|not added|wallet_addEthereumChain/i.test(e?.message ?? "");
}

/**
 * Asks the wallet to switch to the deployment chain. If the wallet does not know the chain (code 4902 or
 * an equivalent message) it is offered `wallet_addEthereumChain` with the exact parameters from the
 * deployment manifest, then asked to switch again.
 */
export async function switchToChain(provider: EIP1193Provider, chainId: number, add?: WalletAddChain): Promise<void> {
  const hexId = numberToHex(chainId);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    return;
  } catch (error) {
    if (!add || !isUnknownChain(error)) throw error;
  }
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: add!.chainId,
        chainName: add!.chainName,
        rpcUrls: add!.rpcUrls,
        nativeCurrency: add!.nativeCurrency,
        blockExplorerUrls: add!.blockExplorerUrls,
      },
    ],
  });
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
}
