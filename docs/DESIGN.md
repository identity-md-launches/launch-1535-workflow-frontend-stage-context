# Loom implemented design

This records the final frontend source and export for the revision dated 2026-10-13. It lives under `docs/` because the assignment's overriding write budget permits `web/**`, `dist/**` and `docs/**`, and does not permit a root `DESIGN.md`.

## Overview

Loom is a collection creation and minting interface. Its existing identity uses warm paper surfaces, dark text, indigo actions and a woven-grid logo. The home page leads with its creation form; the collection page leads with price, supply and mint quantity. Connection remains in the header. This revision retains the existing identity and components.

## Colors

The canonical definitions are the hex primitives and semantic aliases at the top of `web/src/styles.css`. Components use semantic tokens; no extra palette or dark theme is introduced.

| Semantic role | Implemented value |
| --- | --- |
| Page / surface / muted background | `#f6f3ec` / `#fbfaf7` / `#ebe6da` |
| Border | `#d9d2c2` |
| Text / secondary / tertiary | `#1d1b17` / `#4a463f` / `#6f6a60` |
| Solid action / hover | `#2b3a67` / `#233057` |
| Accent soft / accent text / on-accent | `#e3e7f3` / `#233057` / `#fbfaf7` |
| Focus | `#b98a2c` |
| Success text / background | `#1f6b3a` / `#e2f2e7` |
| Error text / background | `#a12f2a` / `#f9e4e2` |

The visual probe measured the rendered home text against resolved solid backgrounds and passed its 4.5:1 text / 3:1 large-text thresholds. This is not a claim that every focus, disabled, owner-panel or browser state has been measured. Error states also carry explicit text and live-region semantics.

## Typography

The body requests `Inter`, `Segoe UI`, `system-ui`, `-apple-system`, `Roboto`, `Helvetica Neue`, `Arial`, then `sans-serif`. No web font is downloaded or bundled, so the actual face depends on installed fonts. Addresses use the `ui-monospace`, `SF Mono`, `Menlo`, `Consolas`, `Liberation Mono`, `monospace` stack.

Six declared steps are 13, 14, 16, 20, 28 and 40px at the default root size (`--text-xs` through `--text-2xl`). Captions are 13px, labels/buttons 14px, body/inputs 16px, h2 20px, and h1 28px. Only the home headline grows to 40px at 48rem. Weights are 400, 600 and 700; h1 uses the heaviest. Body line-height is 1.5 and headings 1.15. H1 tracking is −0.015em, or −0.02em for the home headline.

Headings use balanced wrapping; prose uses pretty wrapping and a 62ch measure. Numeric data uses tabular figures and can wrap long values without dropping digits. Address text wraps anywhere. Mobile inputs stay at 16px. The browser probe observed five sizes at each home viewport and the three declared weights; its family list describes CSS requests, not confirmed installed font files.

## Layout

Spacing tokens are 4, 8, 12, 16, 24, 32 and 48px. `.shell` centers a maximum 1040px region with 16px inline padding, increasing to 24px at 48rem. The sticky header has a 56px minimum height. Main top padding is 24px on phones and 40px at 48rem, with 48px bottom padding.

`.grid-2` stacks below 60rem and uses equal `minmax(0, 1fr)` columns above it. `.form-grid` retains two flexible columns; `.field.wide` spans both. Cards use 16px padding, increasing to 24px at 48rem. `.stack`, `.stack-sm` and wrapping `.row` preserve grouping. `.facts` pairs max-content labels with a flexible wrapping value column. The wallet menu is aligned to the header's trailing edge and bounded by viewport width.

At 390 × 844, the complete home create control was observed at y=725.6875–769.6875, with fee and wallet guidance retained. Stress fixtures with long names, large numbers and the open full-address wallet menu had no horizontal overflow at 320, 390, 768 or 1440px. Desktop keeps the collections list alongside the form.

## Elevation and depth

The interface uses flat, bordered surfaces without shadows or gradients. Page, card and status backgrounds establish grouping. The header uses z-index 5, its absolute wallet menu 6, and the focused skip link 10. Bordered list rows remain inside the collections region, as in the accepted design. They identify separate collections and their actions; this revision does not restyle that hierarchy.

## Shapes

`--radius-sm` is 6px for fields and the skip link, `--radius-md` 10px for buttons, menus, rows and statuses, and `--radius-lg` 16px for section cards. Pills use 999px. Borders are 1px. The woven mark is the existing local SVG in `App.tsx` and `web/public/favicon.svg`; the local share image is `web/public/og.png`.

## Components

- `WalletButton.tsx`: disconnected, connecting, connected and wrong-chain states. Its existing menu provides copy, explorer and disconnect controls. Missing-provider and rejected-connection errors open the menu so they are visible. Escape and outside clicks dismiss it. `SwitchChainButton` reports progress and switch errors.
- `App.tsx`: brand/header, home and hash-based collection routes, footer deployment links. The first keyboard link focuses `main[tabindex="-1"]` without changing the route or resetting the collection form.
- `Home.tsx`: `CreateCollection` and its local `Field` pattern bind labels, hints and validation errors. `CollectionList` distinguishes pending details, unavailable details with Retry, and successfully read price/supply data. Only complete rows offer Mint navigation.
- `Collection.tsx`: `MintPanel` shows exact ETH cost, quantity and eligibility. `WalletTokens` shows balances, token rows, read progress and a recoverable lookup error. The owner scan must complete and reconcile its count with the wallet balance before being accepted. Existing owner controls and metadata details remain.
- `TxStatus.tsx`: signing, pending, confirmed and error feedback with explorer links when a hash exists. `.status.info`, `.status.ok` and `.status.error` supply corresponding surface roles.
- `.btn`: 44px minimum height, `.primary` indigo emphasis, `.block` full width, and `.small` 36px minimum height for row actions. Disabled states use native disabling and 0.55 opacity. Color and scale transitions last 120ms with `cubic-bezier(0.2, 0, 0, 1)`; active scale is 0.96. Reduced motion disables the transition duration and scale feedback.

## Reuse rules

Start a new section with `.card` inside the existing shell/grid, use the semantic tokens, and retain the existing type scale. Bind every input label and place financial units and guidance beside its control. Use loading/error text for unknown reads; only format successfully read numbers as amounts. Keep deployment data in the runtime manifest. Hash navigation changes pages; focus-only navigation must preserve the hash.

Design review used the pinned Better Interface guidance by Jakub Krehel (MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`) and its Impeccable documentation method by Paul Bakaus (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). Coverage and limitations are in `FRONTEND_VALIDATION.md`.
