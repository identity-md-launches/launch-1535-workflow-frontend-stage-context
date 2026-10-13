import { cloneElement, isValidElement, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { decodeEventLog, isAddress, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { useApp } from "../context";
import { CONTRACT_NAMES, POLL_MS, explorerAddress } from "../config";
import { SwitchChainButton, useWalletState } from "../components/WalletButton";
import { TxStatus, idleTx, type TxState } from "../components/TxStatus";
import { describeError } from "../lib/errors";
import { count, eth, parseEthInput, parseIntegerInput, shortAddress } from "../lib/format";

interface FormValues {
  name: string;
  symbol: string;
  maxSupply: string;
  mintPrice: string;
  maxPerWallet: string;
  royaltyBps: string;
  creator: string;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

function validate(v: FormValues, connected?: Address): { args?: readonly [string, string, bigint, bigint, bigint, Address, bigint]; errors: FormErrors } {
  const errors: FormErrors = {};
  const supply = parseIntegerInput(v.maxSupply, 1n, "Supply");
  if ("error" in supply) errors.maxSupply = supply.error;
  const price = parseEthInput(v.mintPrice);
  if ("error" in price) errors.mintPrice = price.error;
  const cap = parseIntegerInput(v.maxPerWallet, 1n, "Max per wallet");
  if ("error" in cap) errors.maxPerWallet = cap.error;
  else if ("value" in supply && cap.value > supply.value) errors.maxPerWallet = "Max per wallet cannot exceed the supply";
  const royalty = parseIntegerInput(v.royaltyBps, 0n, "Royalty");
  if ("error" in royalty) errors.royaltyBps = royalty.error;
  else if (royalty.value > 10000n) errors.royaltyBps = "Royalty is in basis points: at most 10000 (100%)";
  const creator = v.creator.trim() === "" ? connected : v.creator.trim();
  if (!creator || !isAddress(creator)) errors.creator = "Enter a valid address, or leave empty to use the connected wallet";
  if (Object.keys(errors).length > 0 || !("value" in supply) || !("wei" in price) || !("value" in cap) || !("value" in royalty)) {
    return { errors };
  }
  return { errors, args: [v.name.trim(), v.symbol.trim(), supply.value, price.wei, cap.value, creator as Address, royalty.value] };
}

export function CreateCollection({ onCreated }: { onCreated: () => void }) {
  const app = useApp();
  const abi = app.abis[CONTRACT_NAMES.factory];
  const { address } = useAccount();
  const { isConnected, wrongChain, ready } = useWalletState();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const fee = useReadContract({ address: app.factory, abi, functionName: "CREATE_FEE" });
  const paused = useReadContract({ address: app.factory, abi, functionName: "paused", query: { refetchInterval: POLL_MS } });
  const createFee = fee.data as bigint | undefined;
  const isPaused = paused.data === true;

  const [values, setValues] = useState<FormValues>({
    name: "",
    symbol: "",
    maxSupply: "",
    mintPrice: "",
    maxPerWallet: "",
    royaltyBps: "500",
    creator: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [tx, setTx] = useState<TxState>(idleTx);
  const [created, setCreated] = useState<Address | null>(null);
  const submitting = tx.phase === "signing" || tx.phase === "pending";

  function set<K extends keyof FormValues>(key: K) {
    return (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { args, errors: next } = validate(values, address);
    setErrors(next);
    if (!args) {
      const first = Object.keys(next)[0];
      document.getElementById(`create-${first}`)?.focus();
      return;
    }
    if (!ready || createFee === undefined || !publicClient) return;
    setCreated(null);
    setTx({ phase: "signing" });
    try {
      // Simulate first so a revert reason shows before the wallet opens.
      await publicClient.simulateContract({ address: app.factory, abi, functionName: "createCollection", args, value: createFee, account: address });
      const hash = await writeContractAsync({ address: app.factory, abi, functionName: "createCollection", args, value: createFee });
      setTx({ phase: "pending", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setTx({ phase: "error", hash, error: "The transaction reverted on chain. Nothing was created." });
        return;
      }
      let collection: Address | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
          if (decoded.eventName === "CollectionCreated") {
            collection = (decoded.args as unknown as { collection: Address }).collection;
          }
        } catch {
          /* not a factory event */
        }
      }
      setCreated(collection);
      setTx({ phase: "confirmed", hash });
      onCreated();
    } catch (err) {
      setTx({ phase: "error", error: describeError(err) });
    }
  }

  const disabledReason = !isConnected
    ? "Connect a wallet to create a collection."
    : wrongChain
      ? `Switch to ${app.chain.name} to create a collection.`
      : isPaused
        ? "Collection creation is paused by the factory pauser."
        : null;

  const total = createFee !== undefined ? eth(createFee, app.network.nativeCurrency.symbol) : "…";

  return (
    <section className="card" aria-labelledby="create-heading">
      <div className="stack-sm">
        <h2 id="create-heading">Create a collection</h2>
        <p className="small muted">One transaction. Your wallet becomes the owner.</p>
      </div>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <Field id="create-name" label="Name" error={errors.name}>
            <input id="create-name" name="name" autoComplete="off" value={values.name} onChange={set("name")} placeholder="Woven Dreams" />
          </Field>
          <Field id="create-symbol" label="Symbol" error={errors.symbol}>
            <input id="create-symbol" name="symbol" autoComplete="off" value={values.symbol} onChange={set("symbol")} placeholder="WOVEN" />
          </Field>
          <Field id="create-maxSupply" label="Supply" hint="Hard cap, at least 1" error={errors.maxSupply}>
            <input id="create-maxSupply" name="maxSupply" inputMode="numeric" value={values.maxSupply} onChange={set("maxSupply")} placeholder="1000" />
          </Field>
          <Field id="create-mintPrice" label="Mint price (ETH)" hint="Plus 0.0005 ETH fee per token" error={errors.mintPrice}>
            <input id="create-mintPrice" name="mintPrice" inputMode="decimal" value={values.mintPrice} onChange={set("mintPrice")} placeholder="0.01" />
          </Field>
          <Field id="create-maxPerWallet" label="Max per wallet" hint="Lifetime mints, 1 to supply" error={errors.maxPerWallet}>
            <input id="create-maxPerWallet" name="maxPerWallet" inputMode="numeric" value={values.maxPerWallet} onChange={set("maxPerWallet")} placeholder="5" />
          </Field>
          <Field id="create-royaltyBps" label="Royalty (bps)" hint="500 = 5%, at most 10000" error={errors.royaltyBps}>
            <input id="create-royaltyBps" name="royaltyBps" inputMode="numeric" value={values.royaltyBps} onChange={set("royaltyBps")} />
          </Field>
          <Field id="create-creator" label="Creator address" hint="Gets mint proceeds and royalties. Empty uses the connected wallet." error={errors.creator} wide>
            <input id="create-creator" name="creator" autoComplete="off" spellCheck={false} className="mono" value={values.creator} onChange={set("creator")} placeholder={address ?? "0x…"} />
          </Field>
        </div>
        <div className="stack-sm">
          {wrongChain ? (
            <SwitchChainButton />
          ) : (
            <button type="submit" className="btn primary block" disabled={submitting || !ready || isPaused || createFee === undefined}>
              {submitting ? "Creating…" : `Create collection for ${total}`}
            </button>
          )}
          {disabledReason && !wrongChain && (
            <p className="small muted" role="status">
              {disabledReason}
            </p>
          )}
        </div>
        <TxStatus state={tx} successText="Collection created." />
        {created && tx.phase === "confirmed" && (
          <div className="row">
            <a className="btn" href={`#/c/${created}`}>
              Open collection page
            </a>
            <a className="small" href={explorerAddress(app.network, created)} target="_blank" rel="noreferrer">
              View contract on explorer
            </a>
          </div>
        )}
      </form>
    </section>
  );
}

function Field({ id, label, hint, error, wide, children }: { id: string; label: string; hint?: string; error?: string; wide?: boolean; children: ReactNode }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${wide ? " wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {withA11y(children, describedBy, !!error)}
      {hint && (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="error-text">
          {error}
        </span>
      )}
    </div>
  );
}

function withA11y(children: ReactNode, describedBy: string | undefined, invalid: boolean) {
  if (!isValidElement(children)) return children;
  return cloneElement(children as ReactElement<Record<string, unknown>>, {
    "aria-describedby": describedBy,
    "aria-invalid": invalid ? "true" : undefined,
  });
}

interface CollectionSummary {
  address: Address;
  name: string;
  totalSupply: bigint;
  maxSupply: bigint;
  mintPrice: bigint;
  paused: boolean;
}

export function CollectionList({ refreshKey }: { refreshKey: number }) {
  const app = useApp();
  const factoryAbi = app.abis[CONTRACT_NAMES.factory];
  const collectionAbi = app.abis[CONTRACT_NAMES.collection];

  const countRead = useReadContract({
    address: app.factory,
    abi: factoryAbi,
    functionName: "collectionCount",
    query: { refetchInterval: POLL_MS },
    scopeKey: `count-${refreshKey}`,
  });
  const total = countRead.data as bigint | undefined;
  const limit = 50n;
  const indexes = useMemo(() => {
    if (total === undefined) return [];
    const from = total > limit ? total - limit : 0n;
    const out: bigint[] = [];
    for (let i = total - 1n; i >= from && i >= 0n; i--) out.push(i);
    return out;
  }, [total]);

  const addresses = useReadContracts({
    contracts: indexes.map((i) => ({ address: app.factory, abi: factoryAbi, functionName: "collections", args: [i] })),
    query: { enabled: indexes.length > 0 },
  });
  const addrList = (addresses.data ?? []).map((r) => (r.status === "success" ? (r.result as Address) : null)).filter((a): a is Address => !!a);

  const details = useReadContracts({
    contracts: addrList.flatMap((address) => [
      { address, abi: collectionAbi, functionName: "name" },
      { address, abi: collectionAbi, functionName: "totalSupply" },
      { address, abi: collectionAbi, functionName: "maxSupply" },
      { address, abi: collectionAbi, functionName: "mintPrice" },
      { address, abi: collectionAbi, functionName: "paused" },
    ]),
    query: { enabled: addrList.length > 0, refetchInterval: POLL_MS },
  });

  const items: CollectionSummary[] = addrList.map((address, i) => {
    const r = details.data?.slice(i * 5, i * 5 + 5);
    const get = <T,>(k: number, fallback: T): T => (r && r[k]?.status === "success" ? (r[k].result as T) : fallback);
    return {
      address,
      name: get<string>(0, ""),
      totalSupply: get<bigint>(1, 0n),
      maxSupply: get<bigint>(2, 0n),
      mintPrice: get<bigint>(3, 0n),
      paused: get<boolean>(4, false),
    };
  });

  return (
    <section className="card" aria-labelledby="list-heading">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="list-heading">Collections</h2>
        <span className="small muted num" role="status">
          {total === undefined ? (countRead.isError ? "Unable to read the factory" : "Loading…") : `${count(total)} created`}
        </span>
      </div>
      {countRead.isError && (
        <p className="error-text" role="alert">
          Unable to reach {app.chain.name} through the configured public RPCs. Reload to try again.
        </p>
      )}
      {total === 0n && (
        <div className="stack-sm">
          <p>
            <strong>No collections yet</strong>
          </p>
          <p className="small muted">The first collection created through the factory appears here with its mint page.</p>
        </div>
      )}
      {items.length > 0 && (
        <ul className="list">
          {items.map((c) => (
            <li key={c.address} className="item">
              <div className="stack-sm" style={{ gap: 2 }}>
                <span className="title">{c.name || shortAddress(c.address)}</span>
                <span className="caption num">
                  {count(c.totalSupply)} / {count(c.maxSupply)} minted · {eth(c.mintPrice, app.network.nativeCurrency.symbol)} + fee
                  {c.paused ? " · paused" : ""}
                </span>
                <span className="caption mono">{shortAddress(c.address)}</span>
              </div>
              <a className="btn small" href={`#/c/${c.address}`} aria-label={`Open ${c.name || shortAddress(c.address)}`}>
                Mint
              </a>
            </li>
          ))}
        </ul>
      )}
      {total !== undefined && total > limit && (
        <p className="caption">Showing the newest {limit.toString()} of {count(total)} collections.</p>
      )}
    </section>
  );
}

export function FactoryPauserPanel() {
  const app = useApp();
  const abi = app.abis[CONTRACT_NAMES.factory];
  const { address } = useAccount();
  const { ready } = useWalletState();
  const pauser = useReadContract({ address: app.factory, abi, functionName: "pauser" });
  const paused = useReadContract({ address: app.factory, abi, functionName: "paused", query: { refetchInterval: POLL_MS } });
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [tx, setTx] = useState<TxState>(idleTx);
  const isPauser = !!address && typeof pauser.data === "string" && (pauser.data as string).toLowerCase() === address.toLowerCase();
  if (!isPauser || !ready) return null;
  const isPaused = paused.data === true;
  const busy = tx.phase === "signing" || tx.phase === "pending";

  async function toggle() {
    if (!publicClient) return;
    setTx({ phase: "signing" });
    try {
      const fn = isPaused ? "unpause" : "pause";
      const hash = await writeContractAsync({ address: app.factory, abi, functionName: fn });
      setTx({ phase: "pending", hash });
      await publicClient.waitForTransactionReceipt({ hash });
      setTx({ phase: "confirmed", hash });
      void paused.refetch();
    } catch (e) {
      setTx({ phase: "error", error: describeError(e) });
    }
  }

  return (
    <section className="card" aria-labelledby="pauser-heading">
      <h2 id="pauser-heading">Factory pauser</h2>
      <p className="small muted">The connected wallet is the factory pauser. Pausing stops new collections; existing mints continue.</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void toggle()}>
        {busy ? "Sending…" : isPaused ? "Unpause creation" : "Pause creation"}
      </button>
      <TxStatus state={tx} />
    </section>
  );
}
