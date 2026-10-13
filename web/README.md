# Loom frontend

Vite, React and TypeScript frontend for creating Loom collections, browsing factory collections, minting with the exact contract fee, and listing the connected wallet's tokens. The existing collection-owner and factory-pauser controls remain available to their authorized wallets.

## Install, build and preview

Use Node 22.12+ (this revision used Node 24.21.0). From the repository root:

```sh
npm ci --prefix web
npm run typecheck --prefix web
npm run build --prefix web
npm run preview --prefix web -- --host 127.0.0.1
```

The build writes `dist/` at repository root and then generates `dist/imd-deployment.json`. Vite uses `base: "./"`; collection URLs use `#/c/<address>`. Serve the directory through HTTP, including from a gateway subpath. No server rewrites or backend are required. `npm run dev --prefix web` starts Vite development mode, but its server also needs the generated manifest and ABI files at its document root; use production preview for the complete deployment configuration.

## Configuration and rebuild inputs

`dist/imd-deployment.json` is the runtime authority for the chain, contract addresses, public RPCs, ABI paths and network metadata. `src/config.ts` fetches that file and the referenced JSON ABI arrays; it does not duplicate addresses or RPC URLs. The launch token and pool metadata are preserved in the manifest. This application frontend does not trade LOOM.

`scripts/manifest.mjs` consumes `.imd/reads/deployment.json`, `.imd/reads/network.json` and the implementation-derived `docs/abi/*.json`. It verifies each ABI's canonical Keccak hash and inventories every other exported file using SHA-256. `IMD_HANDOFF` and `IMD_NETWORK` can point to supplied input files outside the checkout. Do not edit generated assets after manifest generation.

The worker's `.imd/reads/` directory is ephemeral. After publication, save the validated exported manifest before rebuilding; it contains both the handoff fields and network inputs required by the existing generator:

```sh
cp dist/imd-deployment.json /tmp/loom-rebuild-input.json
IMD_HANDOFF=/tmp/loom-rebuild-input.json IMD_NETWORK=/tmp/loom-rebuild-input.json npm run build --prefix web
IMD_HANDOFF=/tmp/loom-rebuild-input.json IMD_NETWORK=/tmp/loom-rebuild-input.json node web/scripts/verify-export.mjs
```

Keep `docs/abi/` and the deployed source commit available. `verify-export.mjs` additionally compares the ABI bytes with that Git commit, verifies the exact contract set and network/pool metadata, and independently checks the full asset inventory.

Browser wallets use the existing injected connector and EIP-6963 discovery. A missing provider produces visible installation guidance. A missing chain follows switch → add using `walletAddChain` → switch. No WalletConnect project ID or private credentials are required; WalletConnect is not configured. Public RPC reads use the manifest's fallback endpoints, with signing confined to the visitor's wallet. ETH values exclude gas; no USD price source is configured.

## Revision validation

The regression harness serves the actual export at `/preview/` and intercepts every external request. Its test identities and RPC results never enter the app bundle. It checks the five review findings, recovery, partial RPC failure, wrong-chain handling, exact simulated/requested amounts and responsive layouts. Its wallet rejects transaction requests; it never broadcasts them.

Install browser tooling outside the repository:

```sh
npm install --prefix /tmp/loom-browser-tools playwright@1.64.0
/tmp/loom-browser-tools/node_modules/.bin/playwright install chromium
IMD_PLAYWRIGHT=/tmp/loom-browser-tools/node_modules/playwright/index.mjs node web/tests/revision.mjs
node web/scripts/verify-export.mjs
```

`--baseline` asserts the original reported defects and is only for the old export. `--webkit` also runs in WebKit when its browser and system libraries are available. Optional `LOOM_TEST_FILTER` selects a scenario by name. Raw transient results and screenshots go to `test/scratch/`, which is not submitted.

The pinned visual probe, while its input is available:

```sh
IMD_PLAYWRIGHT=/tmp/loom-browser-tools/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

See [frontend validation](../docs/FRONTEND_VALIDATION.md), [design](../docs/DESIGN.md), and [saved evidence](../docs/evidence/). Browser dependencies, caches and screenshots outside the selected evidence are not part of the export. The existing `web/.gitignore` excludes dependency directories at every nesting depth; no ignore-file change was needed.
