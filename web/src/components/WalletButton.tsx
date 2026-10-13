import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect } from "wagmi";
import type { EIP1193Provider } from "viem";
import { useApp } from "../context";
import { explorerAddress } from "../config";
import { switchToChain } from "../lib/chain";
import { describeError } from "../lib/errors";
import { shortAddress, checksum } from "../lib/format";

/** Wallet state as the four-state flow sees it. */
export function useWalletState() {
  const { address, chainId, isConnected, connector } = useAccount();
  const app = useApp();
  const wrongChain = isConnected && chainId !== app.chain.id;
  return { address, chainId, isConnected, wrongChain, connector, ready: isConnected && !wrongChain };
}

export function SwitchChainButton({ className = "btn primary" }: { className?: string }) {
  const app = useApp();
  const { connector } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSwitch() {
    if (!connector) return;
    setBusy(true);
    setError(null);
    try {
      const provider = (await connector.getProvider()) as EIP1193Provider;
      await switchToChain(provider, app.chain.id, app.walletAddChain);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-sm">
      <button type="button" className={className} onClick={onSwitch} disabled={busy}>
        {busy ? `Switching to ${app.chain.name}…` : `Switch to ${app.chain.name}`}
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function WalletButton() {
  const app = useApp();
  const { address, isConnected, wrongChain } = useWalletState();
  const connectors = useConnectors();
  const { connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function connectWith(id: string) {
    const connector = connectors.find((c) => c.id === id) ?? connectors[0];
    if (!connector) return;
    setError(null);
    try {
      if (!(await connector.getProvider())) {
        setError("No browser wallet found. Install a wallet, then reload.");
        setOpen(true);
        return;
      }
      await connectAsync({ connector });
      setOpen(false);
    } catch (e) {
      setError(describeError(e));
      setOpen(true);
    }
  }

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(checksum(address));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const noWallet = connectors.length === 0;

  if (!isConnected) {
    return (
      <div className="wallet-menu" ref={ref}>
        <button
          type="button"
          className="btn primary"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={isPending}
          onClick={() => {
            if (connectors.length === 1) void connectWith(connectors[0].id);
            else setOpen((v) => !v);
          }}
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {open && (
          <div className="menu" role="menu" aria-label="Wallets">
            {noWallet && (
              <p className="small muted" style={{ padding: 8 }}>
                No browser wallet found. Install a wallet, then reload.
              </p>
            )}
            {connectors.map((c) => (
              <button key={c.uid} type="button" role="menuitem" className="btn" onClick={() => void connectWith(c.id)}>
                {c.name}
              </button>
            ))}
            {error && (
              <p className="error-text" role="alert" style={{ padding: 8 }}>
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-menu" ref={ref}>
      <button
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Wallet ${checksum(address!)}${wrongChain ? ", wrong network" : ""}`}
      >
        <span className="mono num">{shortAddress(address!)}</span>
        {wrongChain && <span className="pill">Wrong network</span>}
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Wallet actions">
          <p className="mono small" style={{ padding: 8, margin: 0 }}>
            {checksum(address!)}
          </p>
          {wrongChain && <SwitchChainButton className="btn primary" />}
          <button type="button" role="menuitem" className="btn" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy address"}
          </button>
          <a role="menuitem" className="btn" href={explorerAddress(app.network, address!)} target="_blank" rel="noreferrer">
            View on explorer
          </a>
          <button
            type="button"
            role="menuitem"
            className="btn"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
