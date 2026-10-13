import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, formatEther } from "viem";

const MESSAGES: Record<string, string> = {
  IncorrectPayment: "The payment does not match the exact mint total. Reload and try again.",
  IncorrectCreationFee: "The payment does not match the exact creation fee. Reload and try again.",
  MaxSupplyExceeded: "Not enough tokens left for that quantity.",
  WalletCapExceeded: "That quantity goes over this wallet's mint limit.",
  ReserveCapExceeded: "That quantity goes over the 1% owner reserve.",
  ZeroQuantity: "Enter a quantity of at least 1.",
  InvalidAddress: "Enter a valid, nonzero address.",
  InvalidSupply: "Enter a supply of at least 1.",
  InvalidWalletCap: "Max per wallet must be between 1 and the supply.",
  InvalidMintPrice: "The mint price is too large for this supply.",
  InvalidRoyalty: "Royalty must be between 0 and 10000 basis points.",
  MetadataIsFrozen: "Metadata is frozen and can no longer change.",
  ProvenanceAlreadySet: "Provenance is already recorded for this collection.",
  MintingAlreadyStarted: "Provenance can only be set before the first mint.",
  RevealSeedAlreadySet: "The reveal seed is already recorded.",
  PaymentFailed: "A payment recipient refused the transfer, so nothing was minted.",
  EnforcedPause: "This collection is paused. Minting resumes when the owner unpauses it.",
  OwnableUnauthorizedAccount: "Only the collection owner can do this.",
  UnauthorizedPauser: "Only the factory pauser can do this.",
  InvalidImplementation: "The factory's implementation check failed.",
  PlatformMismatch: "The factory's platform check failed.",
  ReentrancyGuardReentrantCall: "The contract rejected a reentrant call.",
};

/** Turns a wallet or contract error into one plain sentence a visitor can act on. */
export function describeError(error: unknown): string {
  if (!error) return "Something failed. Try again.";
  if (error instanceof BaseError) {
    const rejected = error.walk((e) => e instanceof UserRejectedRequestError);
    if (rejected) return "Transaction rejected in the wallet.";
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? reverted.reason;
      if (name && MESSAGES[name]) {
        const args = reverted.data?.args as readonly unknown[] | undefined;
        if ((name === "IncorrectPayment" || name === "IncorrectCreationFee") && args && args.length === 2) {
          return `${MESSAGES[name]} Expected ${formatEther(args[0] as bigint)} ETH, sent ${formatEther(args[1] as bigint)} ETH.`;
        }
        return MESSAGES[name];
      }
      if (name) return `The contract rejected this call (${name}).`;
    }
    if (/insufficient funds/i.test(error.shortMessage)) return "Not enough ETH in the wallet for this payment plus gas.";
    return error.shortMessage || "The request failed.";
  }
  const code = (error as { code?: number }).code;
  if (code === 4001) return "Transaction rejected in the wallet.";
  const message = (error as { message?: string }).message;
  return message ? message.split("\n")[0].slice(0, 200) : "Something failed. Try again.";
}
