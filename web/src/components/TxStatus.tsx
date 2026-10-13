import type { Hex } from "viem";
import { useApp } from "../context";
import { explorerTx } from "../config";

export interface TxState {
  phase: "idle" | "signing" | "pending" | "confirmed" | "error";
  hash?: Hex;
  error?: string;
  note?: string;
}

export const idleTx: TxState = { phase: "idle" };

/** One status line per action; errors stay until the next attempt. */
export function TxStatus({ state, successText }: { state: TxState; successText?: string }) {
  const app = useApp();
  if (state.phase === "idle") return <div role="status" aria-live="polite" />;
  const link = state.hash ? (
    <a href={explorerTx(app.network, state.hash)} target="_blank" rel="noreferrer">
      View transaction on explorer
    </a>
  ) : null;
  if (state.phase === "error") {
    return (
      <div className="status error" role="alert">
        <span>{state.error}</span>
        {link}
      </div>
    );
  }
  if (state.phase === "confirmed") {
    return (
      <div className="status ok" role="status" aria-live="polite">
        <span>{successText ?? "Confirmed on chain."}</span>
        {state.note && <span>{state.note}</span>}
        {link}
      </div>
    );
  }
  return (
    <div className="status info" role="status" aria-live="polite">
      <span>{state.phase === "signing" ? "Confirm the transaction in the wallet…" : "Waiting for the network to confirm…"}</span>
      {link}
    </div>
  );
}
