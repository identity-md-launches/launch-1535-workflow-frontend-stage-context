# Frontend revision validation — 2026-10-13

Complete for the five reported revision findings within the assigned write scope. This is worker-produced evidence, not independent certification or publication validation. The existing Vite/React/TypeScript app, deployment configuration, contract sources and transaction implementation were retained.

## Reproduction and fixes

All five reports reproduced against the original committed `dist/`, before application edits. The production export was served at `/preview/` in Chromium 156.0.8078.4 through Playwright 1.64.0. Controlled JSON-RPC and injected-wallet fixtures supplied the review's collection/account identities. No test transaction reached a live RPC. Exact before/after observations are saved in `evidence/revision-before.json` and `evidence/revision-after.json`; the executable harness is `web/tests/revision.mjs`.

| Finding | Original observation | Final fix and result |
| --- | --- | --- |
| `a907f944…61a3` — high, stale export / first screen | At 390 × 844 the create button occupied y=879–923 and the heading computed to 40px. Longer exported copy differed from source. | `web/src/styles.css:211`: 24px mobile main top padding, retaining 40px at 48rem. Rebuilt the existing compact source and regenerated the manifest. Final button y=725.6875–769.6875, heading 28px; whole control, product and wallet button visible. |
| `e8f3e387…c434` — medium, missing wallet | Connect returned to idle with zero alerts. | `web/src/components/WalletButton.tsx:79`: check the connector provider, show installation guidance, and open the menu on failure. Missing provider and wallet rejection both produce visible alerts and permit another attempt. |
| `15ba8951…ea6` — medium, skip navigation | Enter on the skip link changed `#/c/invalid` to `#main` and rendered home. | `web/src/App.tsx:47`: prevent fragment navigation and focus the main element with `tabIndex={-1}`. Both invalid and valid collection routes stay intact; an entered mint quantity of 2 survives. |
| `e05b67a8…ccd` — medium, invented details | Failed collection reads displayed `0 / 0 minted · 0 ETH + fee` and Mint. | `web/src/pages/Home.tsx:261`: explicit loading/error/ready rows. Failed or incomplete detail reads show “Collection details unavailable” and Retry, without price/supply or Mint. Retrying a recovered RPC displays `7 / 10,000 minted · 0.01 ETH + fee`. |
| `4469b047…762` — medium, incomplete holdings | With a verified balance of 2 and failed logs/owner lookups, the token panel showed only “2 held”, with no error. | `web/src/pages/Collection.tsx:300`: propagate owner lookup errors and require the final token count to equal the verified balance. Error text and Retry now appear. Retrying shows token IDs 1 and 2. All-owner failure, one-owner failure, a one-token mismatch and a zero-token mismatch are covered. |

The responsive stress check also reproduced a 385px scroll width at a 320px viewport when long numeric supply values expanded a collection row. The single `overflow-wrap: anywhere` addition to `.num` in `web/src/styles.css` keeps complete numbers readable and restores 320px scroll width. No amount, label or action was removed. The same fixture now passes at 320, 390, 768 and 1440px on home and collection routes, including the open full-address wallet menu.

## Executed checks

All paths below are relative to repository root. The worker used the available Playwright module at `/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs`; `web/README.md` documents installation outside the checkout for another machine.

| Command | Result |
| --- | --- |
| `npm ci --prefix web --cache /tmp/loom-npm-cache --no-audit --no-fund` | Passed, using the existing lockfile; 50 packages installed. No package/lockfile changes. |
| `npm run typecheck --prefix web` | Passed after final application changes. |
| `npm run build --prefix web` | Passed after final application changes; Vite exported relative assets and the manifest generator verified all three ABI hashes. The existing approximately 526kB main JS chunk triggers Vite's advisory 500kB warning. |
| `IMD_PLAYWRIGHT=<module> node web/tests/revision.mjs --baseline` | Passed the original-defect assertions before rebuilding. |
| `IMD_PLAYWRIGHT=<module> node web/tests/revision.mjs` | Passed all 11 final scenarios. Zero browser script errors or local HTTP resource failures. |
| `IMD_PLAYWRIGHT=<module> node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Ran on the final production export. 14/16 raw checks passed; two findings evaluated below. |
| `node web/scripts/verify-export.mjs` | Passed. Nine assets, 623,566 bytes excluding the manifest; exact handoff fields, contract set, poolKey and network/wallet blocks; all asset SHA-256 hashes and canonical ABI Keccak hashes match. ABI bytes equal `docs/abi/<Contract>.json` at pinned source commit `b87c2f6836c814e57de644b42381787a6773e181`. |
| `git diff --check` | Passed. |

Interaction coverage includes a disabled create button while disconnected; connecting an injected fixture; wrong-chain switch failure 4902 followed by add-chain and switch with the exact manifest parameters; wallet rejection; loading details; complete and partial RPC failures; successful retries; both collection routes' keyboard skip behavior; and narrow/desktop layout stress. The create fixture simulated and requested exactly 2,000,000,000,000,000 wei. The two-token mint fixture simulated and requested exactly 21,000,000,000,000,000 wei, representing `(0.01 + 0.0005) ETH × 2`. Both requests were rejected by the mock wallet, with visible rejection feedback. No private key, test account, fixture RPC or dependency archive is included in the production app.

A separate read-only call to the configured PublicNode RPC returned chain ID `0x1` and nonempty code for all three attested addresses: LaunchToken 1,722 bytes, LoomCollection 11,114 bytes, LoomFactory 2,618 bytes. See `evidence/live-read.json`. This establishes chain/code presence at that time, not an on-chain transaction outcome or a bytecode audit.

## Better Interface review

Read and applied the pinned workflow and all six domains' core principles. Review stayed on the changed home, wallet, collection and token-list surfaces, preserving the accepted palette, components and layout. Screenshots were actually opened for visual inspection, including the final 390px first screen, 1440px home, error states and 320px stress state.

| Domain | Coverage and result | Limits |
| --- | --- | --- |
| Accessibility | Checked native controls/labels in source, error alerts, keyboard skip activation, focus target, route/form retention, and Escape dismissal of the existing wallet menu. Probe target-spacing check passed. | No screen-reader session, complete keyboard audit of all owner controls, or forced-colors audit. |
| Layout | Checked first-screen create/mint controls, grouping, static subpath routing, error panels and horizontal reflow. Long data / full wallet address tested at 320, 390, 768 and 1440px. | No physical-device or browser-native 200% zoom session; viewport tests are not native zoom. |
| Writing | Checked new errors for a clear problem and recovery action. Unknown data stays unknown, with units retained on verified data. Probe counted 47 prose words on the first 390px screen. | Creator-provided names and metadata are not editorially verified. |
| Typography | Checked 28px mobile / 40px desktop home heading, 16px inputs, long-value wrapping, tabular figures and existing three-weight hierarchy. Probe size/family checks passed. | OS fallback font availability varies; computed family names do not establish a downloaded font. |
| Colors | Existing semantic token roles retained. Probe passed all measured home text contrast pairs against its 4.5:1 / 3:1 thresholds. Errors are identified by text as well as color. | Every owner-panel, disabled and focus contrast pair was not independently measured. |
| UI | Checked loading, unavailable, retry and recovered details/tokens; connection errors; rejection feedback; normal and open wallet states. No new motion or surface system. Reduced-motion probe passed. | No animation-panel slow-motion review; receipt-confirmation and owner-management flows were not re-exercised in this bounded revision. |

The raw visual probe result is preserved in `evidence/taste-checks.json`, without changing its flags:

- **Eyebrows:** it labels the header's “Connect wallet” control as a kicker because the shorter mobile top spacing places it within 40px above the heading. Inspection of `evidence/home-390.png` confirms this is the required header action, in normal sentence case, without tracked capitals. It is not a decorative label; no change was justified.
- **Chrome:** it counts an existing bordered collection list row inside the Collections section as a nested card. `evidence/home-1440.png` shows that the row groups one collection's details and Mint link. This styling predated the revision, caused no observed overlap or clipping, and is outside the reported functional fixes. It was retained rather than restyling the accepted interface. The probe passes overlap, clipping, contrast and target checks.

## Evidence and remaining limitations

`docs/evidence/` keeps compact before/after JSON, the final probe result, the manifest check, read-only RPC results and selected screenshots. Complete transient screenshots remain under `test/scratch/` until the worker removes it. `docs/DESIGN.md` documents the implemented design in an allowed directory; the overriding path budget excludes a root `DESIGN.md`. The specifically requested root `.imd-responses.json` answers each review finding.

The supplied browser MCP could not initialize because `/opt/google/chrome/chrome` is absent. The standalone Playwright Chromium run above served and inspected the actual export instead. WebKit 26.5 was downloaded outside the checkout but could not launch because the worker lacks GTK4 and related system libraries. This revision does not claim a WebKit pass. No live wallet connection, funded create/mint, gas estimation outcome, real receipt-confirmation flow, IPFS pin, hosted URL or named-site publication was tested or performed. Publication checks remain the control plane's subsequent responsibility. Those limits do not substitute for the completed local browser and interaction checks.

The existing `web/.gitignore` was not changed. Frontend dependencies are ignored at every nesting depth; no caches, package archives or submodules are submitted. The final byte/scope audit is saved in `evidence/submission-size.json`.
