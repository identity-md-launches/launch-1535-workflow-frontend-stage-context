/**
 * Single source of deployment configuration.
 *
 * The app does not hard-code contract addresses, chain ids, ABIs or RPC URLs. Everything comes from
 * `imd-deployment.json` next to `index.html`, written by `scripts/manifest.mjs` from the attested
 * deployment handoff. ABIs are fetched from the `abiPath` each contract entry declares. The only public
 * endpoints are the chain table's public RPC URLs inside `network`; there are no private credentials.
 *
 * Wallets: injected browser wallets (EIP-1193 / EIP-6963 discovery) only. No WalletConnect project id is
 * configured and the WalletConnect SDK is not bundled; see web/README.md for how to add one.
 */
import { createConfig, fallback, http, type Config } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, getAddress, isAddress, type Abi, type Address, type Chain, type Hex } from "viem";

export interface DeploymentContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: Record<string, string | boolean>;
  pairToken?: { address: string; symbol: string; name: string; decimals: number };
  otherPairTokens?: { id: string; address: string; symbol: string; name: string; decimals: number }[];
}

export interface WalletAddChain {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: DeploymentContract[];
  assets: { path: string; sha256: string }[];
  poolKey?: PoolKey;
  network?: NetworkBlock;
  walletAddChain?: WalletAddChain;
}

/** Everything the UI needs, resolved once at startup. */
export interface AppConfig {
  manifest: DeploymentManifest;
  chain: Chain;
  network: NetworkBlock;
  walletAddChain?: WalletAddChain;
  abis: Record<string, Abi>;
  wagmi: Config;
  factory: Address;
  implementation: Address;
  token: Address;
}

export const CONTRACT_NAMES = {
  factory: "LoomFactory",
  collection: "LoomCollection",
  token: "LaunchToken",
} as const;

/** Reads reload at this interval while a wallet is connected; wallet events trigger immediate refetches. */
export const POLL_MS = 15_000;

function siteUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(siteUrl(path), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Unable to load ${path} (${res.status})`);
  return (await res.json()) as T;
}

function assertManifest(m: unknown): asserts m is DeploymentManifest {
  const x = m as Partial<DeploymentManifest>;
  if (!x || x.version !== 1 || typeof x.chainId !== "number" || !Array.isArray(x.contracts)) {
    throw new Error("imd-deployment.json is not a version 1 deployment manifest");
  }
  for (const c of x.contracts) {
    if (!isAddress(c.address)) throw new Error(`Invalid address for ${c.name} in imd-deployment.json`);
    if (/^(https?:)?\/\//.test(c.abiPath) || c.abiPath.includes("..")) {
      throw new Error(`abiPath for ${c.name} must be relative to the site`);
    }
  }
  if (!x.network || x.network.chainId !== x.chainId) {
    throw new Error("imd-deployment.json has no network block for its chain");
  }
}

export function contractByName(manifest: DeploymentManifest, name: string): DeploymentContract {
  const c = manifest.contracts.find((entry) => entry.name === name);
  if (!c) throw new Error(`${name} is missing from imd-deployment.json`);
  return c;
}

export async function loadConfig(): Promise<AppConfig> {
  const manifest = await fetchJson<unknown>("imd-deployment.json");
  assertManifest(manifest);
  const network = manifest.network!;

  const abiEntries = await Promise.all(
    manifest.contracts.map(async (c) => {
      const abi = await fetchJson<unknown>(c.abiPath);
      if (!Array.isArray(abi)) throw new Error(`${c.abiPath} is not an ABI array`);
      return [c.name, abi as Abi] as const;
    }),
  );
  const abis = Object.fromEntries(abiEntries);

  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    testnet: network.testnet,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: network.explorer } },
  });

  const wagmi = createConfig({
    chains: [chain],
    connectors: [injected()],
    multiInjectedProviderDiscovery: true,
    pollingInterval: POLL_MS,
    transports: {
      [chain.id]: fallback(network.rpcUrls.map((url) => http(url, { batch: true }))),
    },
  });

  return {
    manifest,
    chain,
    network,
    walletAddChain: manifest.walletAddChain,
    abis,
    wagmi,
    factory: getAddress(contractByName(manifest, CONTRACT_NAMES.factory).address),
    implementation: getAddress(contractByName(manifest, CONTRACT_NAMES.collection).address),
    token: getAddress(contractByName(manifest, CONTRACT_NAMES.token).address),
  };
}

export function explorerAddress(network: NetworkBlock, address: string): string {
  return `${network.explorer.replace(/\/$/, "")}/address/${address}`;
}

export function explorerTx(network: NetworkBlock, hash: string): string {
  return `${network.explorer.replace(/\/$/, "")}/tx/${hash}`;
}

export function explorerToken(network: NetworkBlock, address: string, tokenId: bigint): string {
  return `${network.explorer.replace(/\/$/, "")}/nft/${address}/${tokenId.toString()}`;
}
