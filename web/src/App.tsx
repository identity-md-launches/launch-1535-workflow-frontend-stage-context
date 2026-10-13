import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useApp } from "./context";
import { CONTRACT_NAMES, POLL_MS, explorerAddress } from "./config";
import { WalletButton, useWalletState } from "./components/WalletButton";
import { CollectionList, CreateCollection, FactoryPauserPanel } from "./pages/Home";
import { CollectionPage } from "./pages/Collection";
import { checksum, shortAddress, units } from "./lib/format";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#2b3a67" />
      <g stroke="#f6f3ec" strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M16 14v36" />
        <path d="M32 14v36" />
        <path d="M48 14v36" />
        <path d="M10 24h44" stroke="#e0b65a" />
        <path d="M10 40h44" stroke="#e0b65a" />
      </g>
    </svg>
  );
}

export function App() {
  const hash = useHashRoute();
  const match = /^#\/c\/([^/?#]+)/.exec(hash);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Hash navigation keeps scroll position by default; a new page starts at the top.
    window.scrollTo({ top: 0 });
  }, [hash]);

  return (
    <>
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}>
        Skip to content
      </a>
      <header className="header">
        <div className="shell">
          <a className="brand" href="#/" aria-label="Loom home">
            <Logo />
            <span>Loom</span>
          </a>
          <WalletButton />
        </div>
      </header>
      <main id="main" className="shell" tabIndex={-1}>
        {match ? (
          <CollectionPage address={match[1]} />
        ) : (
          <>
            <div className="hero">
              <h1 className="display">Weave your collection.</h1>
              <p className="muted">NFT collections drawn by the IMD swarm, each a cheap clone of one audited contract on Ethereum.</p>
            </div>
            <div className="grid-2">
              <CreateCollection onCreated={() => setRefreshKey((k) => k + 1)} />
              <CollectionList refreshKey={refreshKey} />
            </div>
            <FactoryPauserPanel />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  const app = useApp();
  const { address } = useAccount();
  const { ready } = useWalletState();
  const tokenAbi = app.abis[CONTRACT_NAMES.token];
  const loom = useReadContract({
    address: app.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && ready, refetchInterval: POLL_MS },
  });
  return (
    <footer>
      <div className="shell">
        <p>
          Contracts on {app.chain.name} (chain {app.chain.id}), from the attested deployment:
        </p>
        <ul className="list" style={{ gap: 4 }}>
          {app.manifest.contracts.map((c) => (
            <li key={c.name} className="small">
              {c.name}:{" "}
              <a className="mono" href={explorerAddress(app.network, c.address)} target="_blank" rel="noreferrer">
                <span className="hide-narrow">{checksum(c.address)}</span>
              </a>
            </li>
          ))}
        </ul>
        {ready && address && (
          <p className="small num">
            LOOM balance of {shortAddress(address)}: {units(loom.data as bigint | undefined, 18, "LOOM")}. Collections and mints are paid in {app.network.nativeCurrency.symbol}; this
            site does not trade LOOM.
          </p>
        )}
        <p className="caption">Collection names, symbols and metadata are set by their creators and are not verified by Loom.</p>
      </div>
    </footer>
  );
}
