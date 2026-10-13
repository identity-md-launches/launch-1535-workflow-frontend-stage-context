import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddress, isHex, parseAbiItem, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { useApp } from "../context";
import { CONTRACT_NAMES, POLL_MS, explorerAddress, explorerToken } from "../config";
import { SwitchChainButton, useWalletState } from "../components/WalletButton";
import { TxStatus, idleTx, type TxState } from "../components/TxStatus";
import { describeError } from "../lib/errors";
import { bps, checksum, count, eth, shortAddress } from "../lib/format";

interface CollectionState {
  name: string;
  symbol: string;
  maxSupply: bigint;
  totalSupply: bigint;
  mintPrice: bigint;
  platformFee: bigint;
  maxPerWallet: bigint;
  paused: boolean;
  creator: Address;
  owner: Address;
  royaltyBps: bigint;
  baseURI: string;
  metadataFrozen: boolean;
}

const KEYS = ["name", "symbol", "maxSupply", "totalSupply", "mintPrice", "PLATFORM_FEE", "maxPerWallet", "paused", "creator", "owner", "royaltyBps", "baseURI", "metadataFrozen"] as const;

export function CollectionPage({ address }: { address: string }) {
  const app = useApp();
  if (!isAddress(address)) {
    return (
      <section className="card">
        <h1>Collection not found</h1>
        <p className="muted">The address in the link is not valid. <a href="#/">Back to all collections</a></p>
      </section>
    );
  }
  return <CollectionView address={address} key={address} factory={app.factory} />;
}

function CollectionView({ address, factory }: { address: Address; factory: Address }) {
  const app = useApp();
  const abi = app.abis[CONTRACT_NAMES.collection];
  const factoryAbi = app.abis[CONTRACT_NAMES.factory];
  const { address: wallet } = useAccount();

  const membership = useReadContract({ address: factory, abi: factoryAbi, functionName: "isCollection", args: [address] });
  const reads = useReadContracts({
    contracts: KEYS.map((functionName) => ({ address, abi, functionName })),
    query: { refetchInterval: POLL_MS },
  });

  const state: CollectionState | null = useMemo(() => {
    const d = reads.data;
    if (!d || d.some((r) => r.status !== "success")) return null;
    const v = d.map((r) => r.result);
    return {
      name: v[0] as string,
      symbol: v[1] as string,
      maxSupply: v[2] as bigint,
      totalSupply: v[3] as bigint,
      mintPrice: v[4] as bigint,
      platformFee: v[5] as bigint,
      maxPerWallet: v[6] as bigint,
      paused: v[7] as boolean,
      creator: v[8] as Address,
      owner: v[9] as Address,
      royaltyBps: v[10] as bigint,
      baseURI: v[11] as string,
      metadataFrozen: v[12] as boolean,
    };
  }, [reads.data]);

  useEffect(() => {
    document.title = state?.name ? `${state.name} · Loom` : "Loom · NFT collections, woven on Ethereum";
    return () => {
      document.title = "Loom · NFT collections, woven on Ethereum";
    };
  }, [state?.name]);

  if (reads.isError || (reads.data && !state)) {
    return (
      <section className="card">
        <h1>Unable to read this collection</h1>
        <p className="muted">
          {membership.data === false
            ? "This address was not created by the Loom factory."
            : `The configured ${app.chain.name} RPCs did not return collection data. Reload to try again.`}
        </p>
        <a href="#/">Back to all collections</a>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="card" aria-busy="true">
        <p className="muted" role="status">
          Loading collection…
        </p>
      </section>
    );
  }

  const remaining = state.maxSupply - state.totalSupply;
  const isOwner = !!wallet && wallet.toLowerCase() === state.owner.toLowerCase();

  return (
    <>
      <div className="hero">
        <a className="small" href="#/">
          ← All collections
        </a>
        <h1>{state.name || shortAddress(address)}</h1>
        <p className="muted">
          {state.symbol ? `${state.symbol} · ` : ""}
          <span className="num">
            {count(state.totalSupply)} of {count(state.maxSupply)} minted
          </span>
          {state.paused ? " · paused" : ""}
          {membership.data === false ? " · not created by this factory" : ""}
        </p>
      </div>
      <div className="grid-2">
        <MintPanel address={address} state={state} remaining={remaining} onMinted={() => void reads.refetch()} />
        <div className="stack">
          <WalletTokens address={address} state={state} />
          <Details address={address} state={state} />
        </div>
      </div>
      {isOwner && <OwnerPanel address={address} state={state} onChanged={() => void reads.refetch()} />}
    </>
  );
}

function MintPanel({ address, state, remaining, onMinted }: { address: Address; state: CollectionState; remaining: bigint; onMinted: () => void }) {
  const app = useApp();
  const abi = app.abis[CONTRACT_NAMES.collection];
  const { address: wallet } = useAccount();
  const { isConnected, wrongChain, ready } = useWalletState();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const symbol = app.network.nativeCurrency.symbol;

  const minted = useReadContract({
    address,
    abi,
    functionName: "mintedPerWallet",
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!wallet, refetchInterval: POLL_MS },
  });
  const mintedByWallet = (minted.data as bigint | undefined) ?? 0n;
  const walletLeft = state.maxPerWallet > mintedByWallet ? state.maxPerWallet - mintedByWallet : 0n;
  const maxQty = wallet ? (walletLeft < remaining ? walletLeft : remaining) : remaining;

  const [qtyText, setQtyText] = useState("1");
  const [tx, setTx] = useState<TxState>(idleTx);
  const qtyValid = /^\d+$/.test(qtyText) && BigInt(qtyText) >= 1n;
  const qty = qtyValid ? BigInt(qtyText) : 0n;
  const perToken = state.mintPrice + state.platformFee;
  const totalCost = perToken * qty;
  const busy = tx.phase === "signing" || tx.phase === "pending";

  let blocker: string | null = null;
  if (!isConnected) blocker = "Connect a wallet to mint.";
  else if (wrongChain) blocker = `Switch to ${app.chain.name} to mint.`;
  else if (state.paused) blocker = "Minting is paused by the collection owner.";
  else if (remaining === 0n) blocker = "Sold out.";
  else if (walletLeft === 0n) blocker = `This wallet has used all ${count(state.maxPerWallet)} of its mints.`;
  else if (!qtyValid) blocker = "Enter a quantity of at least 1.";
  else if (qty > maxQty) blocker = `This wallet can mint at most ${count(maxQty)} more.`;

  async function onMint(e: FormEvent) {
    e.preventDefault();
    if (blocker || !ready || !publicClient) return;
    setTx({ phase: "signing" });
    try {
      await publicClient.simulateContract({ address, abi, functionName: "mint", args: [qty], value: totalCost, account: wallet });
      const hash = await writeContractAsync({ address, abi, functionName: "mint", args: [qty], value: totalCost });
      setTx({ phase: "pending", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setTx({ phase: "error", hash, error: "The transaction reverted on chain. Nothing was minted." });
        return;
      }
      setTx({ phase: "confirmed", hash, note: `${count(qty)} ${state.symbol || "token"}${qty === 1n ? "" : "s"} minted to ${shortAddress(wallet!)}.` });
      void minted.refetch();
      onMinted();
    } catch (err) {
      setTx({ phase: "error", error: describeError(err) });
    }
  }

  return (
    <section className="card" aria-labelledby="mint-heading">
      <h2 id="mint-heading">Mint</h2>
      <dl className="facts">
        <dt>Price per token</dt>
        <dd className="num">
          {eth(state.mintPrice, symbol)} + {eth(state.platformFee, symbol)} fee = {eth(perToken, symbol)}
        </dd>
        <dt>Remaining</dt>
        <dd className="num">{count(remaining)}</dd>
        <dt>Per wallet</dt>
        <dd className="num">{wallet ? `${count(mintedByWallet)} of ${count(state.maxPerWallet)} used` : `${count(state.maxPerWallet)} lifetime`}</dd>
      </dl>
      <form className="stack" onSubmit={onMint} noValidate>
        <div className="field">
          <label htmlFor="mint-qty">Quantity</label>
          <input
            id="mint-qty"
            name="quantity"
            inputMode="numeric"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            aria-describedby="mint-qty-hint"
            aria-invalid={!qtyValid ? "true" : undefined}
            className="num"
          />
          <span id="mint-qty-hint" className="hint">
            {wallet ? `Up to ${count(maxQty)} more for this wallet` : `Up to ${count(state.maxPerWallet)} per wallet`}
          </span>
        </div>
        <p className="num">
          <strong>Total {eth(qtyValid ? totalCost : 0n, symbol)}</strong>
          <span className="muted small"> · exact amount sent with the transaction</span>
        </p>
        {wrongChain ? (
          <SwitchChainButton />
        ) : (
          <button type="submit" className="btn primary block" disabled={busy || !!blocker}>
            {busy ? "Minting…" : `Mint ${qtyValid ? count(qty) : ""} for ${eth(qtyValid ? totalCost : 0n, symbol)}`}
          </button>
        )}
        {blocker && !wrongChain && (
          <p className="small muted" role="status">
            {blocker}
          </p>
        )}
        <TxStatus state={tx} successText="Minted." />
      </form>
    </section>
  );
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

function WalletTokens({ address, state }: { address: Address; state: CollectionState }) {
  const app = useApp();
  const abi = app.abis[CONTRACT_NAMES.collection];
  const { address: wallet } = useAccount();
  const { isConnected, wrongChain } = useWalletState();
  const publicClient = usePublicClient();

  const balance = useReadContract({
    address,
    abi,
    functionName: "balanceOf",
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!wallet, refetchInterval: POLL_MS },
  });
  const held = balance.data as bigint | undefined;

  const tokens = useQuery({
    queryKey: ["tokens", app.chain.id, address, wallet, held?.toString(), state.totalSupply.toString()],
    enabled: !!wallet && !!publicClient && held !== undefined,
    queryFn: async (): Promise<bigint[]> => {
      if (!wallet || !publicClient) return [];
      if (held === 0n) return [];
      // Clones have no known creation block in the manifest; filter by address from genesis and fall back to a scan.
      const fromBlock = 0n;
      try {
        // Transfer logs to and from the wallet settle current ownership.
        const [inLogs, outLogs] = await Promise.all([
          publicClient.getLogs({ address, event: TRANSFER, args: { to: wallet }, fromBlock, toBlock: "latest" }),
          publicClient.getLogs({ address, event: TRANSFER, args: { from: wallet }, fromBlock, toBlock: "latest" }),
        ]);
        const events = [...inLogs, ...outLogs].sort((a, b) =>
          a.blockNumber === b.blockNumber ? Number(a.logIndex - b.logIndex) : a.blockNumber < b.blockNumber ? -1 : 1,
        );
        const owned = new Set<string>();
        for (const ev of events) {
          const id = ev.args.tokenId!.toString();
          if (ev.args.to?.toLowerCase() === wallet.toLowerCase()) owned.add(id);
          else owned.delete(id);
        }
        const ids = [...owned].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        if (BigInt(ids.length) === held) return ids;
      } catch {
        /* fall through to the ownerOf scan */
      }
      // Fallback: scan consecutive ids (they start at 1) when the collection is small enough.
      if (state.totalSupply > 2000n) throw new Error("scan too large");
      const ids: bigint[] = [];
      for (let start = 1n; start <= state.totalSupply; start += 200n) {
        const end = start + 200n > state.totalSupply + 1n ? state.totalSupply + 1n : start + 200n;
        const batch: bigint[] = [];
        for (let i = start; i < end; i++) batch.push(i);
        const owners = await Promise.all(
          batch.map((id) => publicClient.readContract({ address, abi, functionName: "ownerOf", args: [id] })),
        );
        owners.forEach((o, i) => {
          if (typeof o === "string" && o.toLowerCase() === wallet.toLowerCase()) ids.push(batch[i]);
        });
      }
      if (BigInt(ids.length) !== held) throw new Error("Token ownership could not be reconciled with the wallet balance");
      return ids;
    },
  });

  const shown = (tokens.data ?? []).slice(0, 48);
  const uris = useReadContracts({
    contracts: shown.map((id) => ({ address, abi, functionName: "tokenURI", args: [id] })),
    query: { enabled: shown.length > 0 },
  });

  return (
    <section className="card" aria-labelledby="tokens-heading">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="tokens-heading">Your tokens</h2>
        {held !== undefined && (
          <span className="small muted num" role="status">
            {count(held)} held
          </span>
        )}
      </div>
      {!isConnected && <p className="small muted">Connect a wallet to see the tokens it holds from this collection.</p>}
      {isConnected && wrongChain && <p className="small muted">Switch to {app.chain.name} to read this wallet's tokens.</p>}
      {isConnected && !wrongChain && held === 0n && <p className="small muted">This wallet holds none yet. Mint one to see it here.</p>}
      {isConnected && !wrongChain && held !== undefined && held > 0n && tokens.isPending && (
        <p className="small muted" role="status">
          Reading token ids…
        </p>
      )}
      {tokens.isError && (
        <div className="stack-sm">
          <p className="small muted" role="alert">
            Token ids could not be listed from the public RPC. The balance above is live;{" "}
            <a href={explorerAddress(app.network, address)} target="_blank" rel="noreferrer">
              view holdings on the explorer
            </a>
            .
          </p>
          <button type="button" className="btn" disabled={tokens.isFetching} onClick={() => void tokens.refetch()}>
            {tokens.isFetching ? "Retrying token list…" : "Retry token list"}
          </button>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="tokens">
          {shown.map((id, i) => {
            const uri = uris.data?.[i]?.status === "success" ? (uris.data[i].result as string) : "";
            const link = uri.startsWith("http") ? uri : uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : "";
            return (
              <li key={id.toString()} className="token">
                <strong className="num">
                  {state.symbol || "Token"} #{id.toString()}
                </strong>
                <a className="caption" href={explorerToken(app.network, address, id)} target="_blank" rel="noreferrer">
                  Explorer
                </a>
                {link ? (
                  <a className="caption" href={link} target="_blank" rel="noreferrer">
                    Metadata
                  </a>
                ) : (
                  <span className="caption">{uri ? "Metadata set" : "Not revealed"}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {tokens.data && tokens.data.length > shown.length && <p className="caption">Showing the first {shown.length} of {tokens.data.length} tokens.</p>}
    </section>
  );
}

function Details({ address, state }: { address: Address; state: CollectionState }) {
  const app = useApp();
  return (
    <section className="card" aria-labelledby="details-heading">
      <h2 id="details-heading">Details</h2>
      <dl className="facts">
        <dt>Contract</dt>
        <dd>
          <a className="mono" href={explorerAddress(app.network, address)} target="_blank" rel="noreferrer">
            {checksum(address)}
          </a>
        </dd>
        <dt>Creator</dt>
        <dd>
          <a className="mono" href={explorerAddress(app.network, state.creator)} target="_blank" rel="noreferrer">
            {checksum(state.creator)}
          </a>
        </dd>
        <dt>Owner</dt>
        <dd>
          <a className="mono" href={explorerAddress(app.network, state.owner)} target="_blank" rel="noreferrer">
            {checksum(state.owner)}
          </a>
        </dd>
        <dt>Royalty</dt>
        <dd className="num">{bps(state.royaltyBps)} to the creator (ERC-2981)</dd>
        <dt>Metadata</dt>
        <dd>{state.metadataFrozen ? "Frozen" : state.baseURI ? "Revealed" : "Not revealed yet"}</dd>
        <dt>Network</dt>
        <dd>{app.chain.name}</dd>
      </dl>
    </section>
  );
}

type OwnerFn = "pause" | "unpause" | "reserveMint" | "setBaseURI" | "setUnrevealedURI" | "setProvenanceHash" | "setRevealSeed" | "freezeMetadata";

function OwnerPanel({ address, state, onChanged }: { address: Address; state: CollectionState; onChanged: () => void }) {
  const app = useApp();
  const abi = app.abis[CONTRACT_NAMES.collection];
  const { ready, wrongChain } = useWalletState();
  const { address: wallet } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>(idleTx);
  const [active, setActive] = useState<OwnerFn | null>(null);
  const [reserveQty, setReserveQty] = useState("1");
  const [baseURI, setBaseURI] = useState("");
  const [unrevealedURI, setUnrevealedURI] = useState("");
  const [provenance, setProvenance] = useState("");
  const [seed, setSeed] = useState("");
  const [confirmFreeze, setConfirmFreeze] = useState(false);

  const flags = useReadContracts({
    contracts: [
      { address, abi, functionName: "reserveMinted" },
      { address, abi, functionName: "provenanceSet" },
      { address, abi, functionName: "revealSeedSet" },
      { address, abi, functionName: "unrevealedURI" },
    ],
    query: { refetchInterval: POLL_MS },
  });
  const reserveMinted = flags.data?.[0]?.status === "success" ? (flags.data[0].result as bigint) : undefined;
  const provenanceSet = flags.data?.[1]?.status === "success" ? (flags.data[1].result as boolean) : undefined;
  const seedSet = flags.data?.[2]?.status === "success" ? (flags.data[2].result as boolean) : undefined;
  const currentUnrevealed = flags.data?.[3]?.status === "success" ? (flags.data[3].result as string) : "";
  const reserveCap = state.maxSupply / 100n;
  const reserveLeft = reserveMinted !== undefined && reserveCap > reserveMinted ? reserveCap - reserveMinted : 0n;

  async function run(fn: OwnerFn, args: readonly unknown[] = []) {
    if (!ready || !publicClient) return;
    setActive(fn);
    setTx({ phase: "signing" });
    try {
      await publicClient.simulateContract({ address, abi, functionName: fn, args, account: wallet });
      const hash = await writeContractAsync({ address, abi, functionName: fn, args });
      setTx({ phase: "pending", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setTx(receipt.status === "success" ? { phase: "confirmed", hash } : { phase: "error", hash, error: "The transaction reverted on chain." });
      void flags.refetch();
      onChanged();
    } catch (e) {
      setTx({ phase: "error", error: describeError(e) });
    } finally {
      setActive(null);
    }
  }
  const busy = active !== null;
  const label = (fn: OwnerFn, text: string) => (active === fn ? "Sending…" : text);
  const frozen = state.metadataFrozen;
  const hex32 = (v: string) => isHex(v) && v.length === 66;

  return (
    <section className="card" aria-labelledby="owner-heading">
      <div className="stack-sm">
        <h2 id="owner-heading">Owner tools</h2>
        <p className="small muted">You own this collection. Each control sends one transaction from the connected wallet.</p>
      </div>
      {wrongChain && <SwitchChainButton />}
      <div className="grid-2">
        <div className="stack">
          <h3>Sale</h3>
          <button type="button" className="btn" disabled={busy || !ready} onClick={() => void run(state.paused ? "unpause" : "pause")}>
            {label(state.paused ? "unpause" : "pause", state.paused ? "Unpause minting" : "Pause minting")}
          </button>
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d+$/.test(reserveQty) && BigInt(reserveQty) >= 1n) void run("reserveMint", [BigInt(reserveQty)]);
            }}
          >
            <label htmlFor="reserve-qty">Reserve mint quantity</label>
            <input id="reserve-qty" inputMode="numeric" value={reserveQty} onChange={(e) => setReserveQty(e.target.value)} aria-describedby="reserve-hint" className="num" />
            <span id="reserve-hint" className="hint">
              Free owner mint. {count(reserveLeft)} of {count(reserveCap)} reserve left (1% of supply).
            </span>
            <button type="submit" className="btn" disabled={busy || !ready || reserveLeft === 0n || state.paused}>
              {label("reserveMint", "Reserve mint")}
            </button>
          </form>
        </div>
        <div className="stack">
          <h3>Metadata {frozen ? "(frozen)" : ""}</h3>
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void run("setUnrevealedURI", [unrevealedURI.trim()]);
            }}
          >
            <label htmlFor="unrevealed-uri">Unrevealed URI</label>
            <input id="unrevealed-uri" value={unrevealedURI} onChange={(e) => setUnrevealedURI(e.target.value)} placeholder={currentUnrevealed || "ipfs://…/placeholder.json"} disabled={frozen} aria-describedby="unrevealed-hint" />
            <span id="unrevealed-hint" className="hint">
              Shown for every token while the base URI is empty.
            </span>
            <button type="submit" className="btn" disabled={busy || !ready || frozen}>
              {label("setUnrevealedURI", "Set unrevealed URI")}
            </button>
          </form>
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void run("setBaseURI", [baseURI.trim()]);
            }}
          >
            <label htmlFor="base-uri">Base URI</label>
            <input id="base-uri" value={baseURI} onChange={(e) => setBaseURI(e.target.value)} placeholder={state.baseURI || "ipfs://…/"} disabled={frozen} aria-describedby="base-hint" />
            <span id="base-hint" className="hint">
              Token URI becomes base URI + id + .json. Include the trailing slash.
            </span>
            <button type="submit" className="btn" disabled={busy || !ready || frozen}>
              {label("setBaseURI", "Set base URI")}
            </button>
          </form>
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (hex32(provenance)) void run("setProvenanceHash", [provenance as Hex]);
            }}
          >
            <label htmlFor="provenance">Provenance hash</label>
            <input id="provenance" className="mono" value={provenance} onChange={(e) => setProvenance(e.target.value)} placeholder="0x… (32 bytes)" disabled={frozen || provenanceSet || state.totalSupply > 0n} aria-describedby="provenance-hint" spellCheck={false} />
            <span id="provenance-hint" className="hint">
              {provenanceSet ? "Already recorded." : state.totalSupply > 0n ? "Only possible before the first mint." : "One 32-byte commitment, before any mint."}
            </span>
            <button type="submit" className="btn" disabled={busy || !ready || frozen || provenanceSet || state.totalSupply > 0n || !hex32(provenance)}>
              {label("setProvenanceHash", "Set provenance")}
            </button>
          </form>
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (hex32(seed)) void run("setRevealSeed", [seed as Hex]);
            }}
          >
            <label htmlFor="seed">Reveal seed</label>
            <input id="seed" className="mono" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="0x… (32 bytes)" disabled={frozen || seedSet} aria-describedby="seed-hint" spellCheck={false} />
            <span id="seed-hint" className="hint">
              {seedSet ? "Already recorded." : "Recorded once as the collection's off-chain seed."}
            </span>
            <button type="submit" className="btn" disabled={busy || !ready || frozen || seedSet || !hex32(seed)}>
              {label("setRevealSeed", "Set reveal seed")}
            </button>
          </form>
          {!frozen && (
            <div className="stack-sm">
              <label htmlFor="freeze-confirm">Freeze metadata</label>
              <span className="hint">Permanently locks both URIs, provenance and seed, including unset values. This cannot be undone.</span>
              <div className="row">
                <input id="freeze-confirm" type="checkbox" style={{ width: 24, minHeight: 24 }} checked={confirmFreeze} onChange={(e) => setConfirmFreeze(e.target.checked)} />
                <label htmlFor="freeze-confirm" className="small">
                  I checked the metadata and want to freeze it
                </label>
              </div>
              <button type="button" className="btn" disabled={busy || !ready || !confirmFreeze} onClick={() => void run("freezeMetadata")}>
                {label("freezeMetadata", "Freeze metadata")}
              </button>
            </div>
          )}
        </div>
      </div>
      <TxStatus state={tx} />
    </section>
  );
}
