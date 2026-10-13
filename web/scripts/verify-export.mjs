// Validate the delivered bytes independently of the build's manifest writer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { keccak256, toHex } from "viem";

const root = resolve(import.meta.dirname, "../..");
const dist = join(root, "dist");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const manifest = read(join(dist, "imd-deployment.json"));
const handoff = read(process.env.IMD_HANDOFF ?? join(root, ".imd/reads/deployment.json"));
const network = read(process.env.IMD_NETWORK ?? join(root, ".imd/reads/network.json"));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
    : JSON.stringify(value);

assert.equal(manifest.version, 1);
for (const key of ["launchId", "chainId", "sourceCommit", "attestationHash"]) assert.deepEqual(manifest[key], handoff[key], key);
assert.deepEqual(manifest.poolKey, handoff.poolKey);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.deepEqual(Object.keys(manifest).sort(), ["version", "launchId", "chainId", "sourceCommit", "attestationHash", "contracts", "assets", "network", ...(handoff.poolKey ? ["poolKey"] : []), ...(network.walletAddChain ? ["walletAddChain"] : [])].sort());
assert.deepEqual(manifest.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })), handoff.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })));

const safePath = path => assert.ok(typeof path === "string" && !path.startsWith("/") && !path.includes(":") && !path.includes("\\") && path.split("/").every(part => part && part !== "." && part !== ".."), `unsafe path: ${path}`);
for (const c of manifest.contracts) {
  safePath(c.abiPath);
  const bytes = readFileSync(join(dist, c.abiPath));
  const pinned = execFileSync("git", ["show", `${handoff.sourceCommit}:docs/abi/${c.name}.json`], { cwd: root });
  assert.deepEqual(bytes, pinned, `${c.name} differs from the pinned implementation-derived export`);
  const abi = JSON.parse(bytes);
  assert.ok(Array.isArray(abi));
  assert.equal(keccak256(toHex(canonical(abi))).slice(2), c.abiHash, c.name);
}
function files(dir, prefix = "") {
  return readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? files(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`]);
}
const exported = files(dist).filter(path => path !== "imd-deployment.json").sort();
assert.deepEqual(manifest.assets.map(a => a.path).sort(), exported);
assert.ok(exported.includes("index.html"));
assert.ok(exported.length <= 128);
let totalBytes = 0;
for (const asset of manifest.assets) {
  safePath(asset.path);
  const bytes = readFileSync(join(dist, asset.path));
  totalBytes += bytes.length;
  assert.ok(bytes.length <= 8388608);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.path);
}
assert.ok(totalBytes < 32 * 1024 * 1024);
console.log(JSON.stringify({ assets: exported.length, assetBytes: totalBytes, contracts: manifest.contracts.length, pinnedAbiBytes: "identical", canonicalAbiHashes: "match", assetHashes: "match", handoffAndNetwork: "match" }, null, 2));
