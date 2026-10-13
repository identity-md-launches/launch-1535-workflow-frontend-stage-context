#!/usr/bin/env node
// Writes dist/imd-deployment.json after `vite build`.
//
// Sources: the deployment handoff (.imd/reads/deployment.json), the chain table (.imd/reads/network.json)
// and the implementation-derived ABIs in docs/abi/<Contract>.json at the pinned source commit. ABIs are
// copied byte for byte into dist/abi/ and their canonical Keccak hash (sorted keys, no whitespace) is
// checked against the handoff before anything is written. Every exported file except the manifest itself
// is listed with its lowercase SHA-256. Run from web/ or the repository root; paths are resolved from
// this file. Set IMD_HANDOFF / IMD_NETWORK to override the input paths.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = resolve(root, "dist");
const handoffPath = process.env.IMD_HANDOFF ?? resolve(root, ".imd", "reads", "deployment.json");
const networkPath = process.env.IMD_NETWORK ?? resolve(root, ".imd", "reads", "network.json");

const canon = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canon).join(",") + "]"
    : v && typeof v === "object"
      ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
      : JSON.stringify(v);

function fail(msg) {
  console.error(`manifest: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(dist, "index.html"))) fail("dist/index.html is missing; run vite build first");
if (!existsSync(handoffPath)) fail(`deployment handoff not found at ${handoffPath}`);
const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
for (const key of ["launchId", "chainId", "sourceCommit", "attestationHash", "contracts"]) {
  if (handoff[key] === undefined) fail(`handoff is missing ${key}`);
}

// ABIs: copy the pinned export and verify its canonical hash.
mkdirSync(join(dist, "abi"), { recursive: true });
const contracts = handoff.contracts.map((c) => {
  const src = resolve(root, "docs", "abi", `${c.name}.json`);
  if (!existsSync(src)) fail(`docs/abi/${c.name}.json is missing`);
  const abi = JSON.parse(readFileSync(src, "utf8"));
  if (!Array.isArray(abi)) fail(`${c.name} ABI is not an array`);
  const hash = keccak256(toHex(canon(abi))).slice(2);
  if (hash !== c.abiHash) fail(`${c.name} ABI hash ${hash} does not match handoff ${c.abiHash}`);
  const abiPath = `abi/${c.name}.json`;
  copyFileSync(src, join(dist, abiPath));
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

// Asset inventory: every file under dist/ except the manifest.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(dist)
  .map((f) => relative(dist, f).split(sep).join("/"))
  .filter((p) => p !== "imd-deployment.json")
  .sort();
const assets = files.map((path) => {
  const bytes = readFileSync(join(dist, path));
  if (bytes.length > 8 * 1024 * 1024) fail(`${path} exceeds 8 MiB`);
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
});
if (assets.length > 128) fail(`${assets.length} assets exceed the limit of 128`);
const totalBytes = files.reduce((n, p) => n + statSync(join(dist, p)).size, 0);

const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
};
if (handoff.poolKey) {
  const { currency0, currency1, fee, tickSpacing, hooks } = handoff.poolKey;
  manifest.poolKey = { currency0, currency1, fee, tickSpacing, hooks };
}
if (existsSync(networkPath)) {
  const net = JSON.parse(readFileSync(networkPath, "utf8"));
  if (!net.network) fail("network.json has no network block");
  if (net.network.chainId !== handoff.chainId) fail("network.json chainId differs from the handoff");
  manifest.network = net.network;
  if (net.walletAddChain) manifest.walletAddChain = net.walletAddChain;
}

writeFileSync(join(dist, "imd-deployment.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${assets.length} assets, ${(totalBytes / 1024).toFixed(1)} KiB, ${contracts.length} contracts, chain ${handoff.chainId}`);
