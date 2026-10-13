// Browser regressions for the five revision findings. All RPCs and wallet requests are mocked.
// Run from the repository root with IMD_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeFunctionData, encodeFunctionResult, parseEther } from "viem";

const { chromium, webkit } = await import(pathToFileURL(process.env.IMD_PLAYWRIGHT).href);
const baseline = process.argv.includes("--baseline");
const engines = process.argv.includes("--webkit") ? { chromium, webkit } : { chromium };
const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, "test/scratch", baseline ? "revision-before" : "revision-after");
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(root, "dist/imd-deployment.json"), "utf8"));
const abis = Object.fromEntries(await Promise.all(manifest.contracts.map(async c => [c.name, JSON.parse(await readFile(resolve(root, "dist", c.abiPath), "utf8"))])));
const factory = manifest.contracts.find(c => c.name === "LoomFactory").address.toLowerCase();
const token = manifest.contracts.find(c => c.name === "LaunchToken").address.toLowerCase();
// Synthetic fixture identities, never app configuration or transaction destinations on a live RPC.
const collection = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const other = "0x3333333333333333333333333333333333333333";
const results = [];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/preview/")) throw new Error("outside preview");
    const file = resolve(root, "dist", path.slice(9) || "index.html");
    if (!file.startsWith(resolve(root, "dist") + "/")) throw new Error("outside dist");
    res.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;

async function fixture(browser, settings = {}) {
  const state = { count: 0n, detailError: false, ownerError: false, owned: [1n, 2n], detailDelay: 0, ...settings };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (settings.injected) await context.addInitScript(({ wallet, chainId, rejectConnect }) => {
    const listeners = {};
    let chain = chainId;
    window.walletRequests = [];
    window.ethereum = {
      isMetaMask: true,
      on(event, cb) { (listeners[event] ??= []).push(cb); },
      removeListener(event, cb) { listeners[event] = (listeners[event] ?? []).filter(x => x !== cb); },
      async request({ method, params }) {
        window.walletRequests.push({ method, params });
        if (method === "eth_chainId") return chain;
        if (method === "eth_accounts") return [];
        if (method === "eth_requestAccounts") {
          if (rejectConnect) throw Object.assign(new Error("User rejected request"), { code: 4001 });
          return [wallet];
        }
        if (method === "wallet_switchEthereumChain") {
          if (!window.chainAdded) throw Object.assign(new Error("Unknown chain"), { code: 4902 });
          chain = params[0].chainId;
          for (const cb of listeners.chainChanged ?? []) cb(chain);
          return null;
        }
        if (method === "wallet_addEthereumChain") { window.chainAdded = true; return null; }
        if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
        if (method === "eth_sendTransaction") throw Object.assign(new Error("User rejected request"), { code: 4001 });
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
  }, { wallet, chainId: settings.chainId ?? "0x1", rejectConnect: settings.rejectConnect ?? false });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const errors = [];
  const calls = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.url().startsWith(url) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  async function rpc(request) {
    const { method, params, id } = request;
    const success = result => ({ jsonrpc: "2.0", id, result });
    const failure = () => ({ jsonrpc: "2.0", id, error: { code: -32000, message: "Controlled fixture read failure" } });
    if (method === "eth_chainId") return success("0x1");
    if (method === "eth_blockNumber") return success("0x1900000");
    if (method === "eth_getCode") return success("0x60006000");
    if (method === "eth_getLogs") { calls.push({ method }); return failure(); }
    if (method !== "eth_call") throw new Error(`Unexpected RPC method ${method}`);
    const tx = params[0];
    const address = tx.to.toLowerCase();
    const abi = address === factory ? abis.LoomFactory : address === token ? abis.LaunchToken : abis.LoomCollection;
    const { functionName, args } = decodeFunctionData({ abi, data: tx.data });
    calls.push({ functionName, args: args?.map(String), value: tx.value });
    if (address === collection && state.detailDelay && ["name", "totalSupply", "maxSupply", "mintPrice", "paused"].includes(functionName)) {
      await new Promise(done => setTimeout(done, state.detailDelay));
    }
    if (address === collection && (state.detailError === true || state.detailError === functionName)) return failure();
    if (functionName === "ownerOf" && (state.ownerError === true || state.ownerError === Number(args[0]))) return failure();
    const values = address === factory ? {
      CREATE_FEE: parseEther("0.002"), paused: false, collectionCount: state.count, collections: collection,
      pauser: other, isCollection: true, createCollection: collection,
    } : address === token ? { balanceOf: 0n } : {
      name: state.name ?? "Fixture collection", symbol: "WOVEN", maxSupply: state.maxSupply ?? 10000n, totalSupply: state.totalSupply ?? 7n,
      mintPrice: parseEther("0.01"), PLATFORM_FEE: parseEther("0.0005"), maxPerWallet: 5n,
      paused: false, creator: other, owner: other, royaltyBps: 500n, baseURI: "", metadataFrozen: false,
      balanceOf: state.balance ?? 2n, mintedPerWallet: 2n, ownerOf: state.owned.includes(args?.[0]) ? wallet : other,
      tokenURI: "", mint: undefined,
    };
    if (!(functionName in values)) throw new Error(`Unexpected call ${functionName}`);
    return success(encodeFunctionResult({ abi, functionName, result: values[functionName] }));
  }
  await page.route("**/*", async route => {
    const request = route.request();
    if (request.url().startsWith(url)) return route.continue();
    if (!manifest.network.rpcUrls.some(u => request.url().startsWith(u))) throw new Error(`Unexpected external request ${request.url()}`);
    const payload = request.postDataJSON();
    const body = Array.isArray(payload) ? await Promise.all(payload.map(rpc)) : await rpc(payload);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { page, state, calls, errors, async close() { assert.deepEqual(errors, []); await context.close(); } };
}

async function textVisible(page, text) { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible" }); }
async function connect(page) {
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: /^Wallet / }).waitFor();
}
async function observe(name, browser, run) {
  if (process.env.LOOM_TEST_FILTER && !name.includes(process.env.LOOM_TEST_FILTER)) return;
  const f = await fixture(browser, run.settings);
  try { const evidence = await run.test(f); results.push({ name, ...evidence }); console.log(name, JSON.stringify(evidence)); }
  finally { await f.close(); }
}

try {
  for (const [engine, type] of Object.entries(engines)) {
    const browser = await type.launch({ headless: true });
    try {
      await observe(`${engine}: first-screen and missing wallet`, browser, { test: async ({ page }) => {
        await page.goto(url);
        await textVisible(page, "0 created");
        const box = await page.locator("button[type=submit]").boundingBox();
        const headingSize = await page.locator("h1").evaluate(el => getComputedStyle(el).fontSize);
        await page.screenshot({ path: `${out}/${engine}-home.png` });
        assert.equal(box.y + box.height <= 844, !baseline);
        assert.equal(headingSize, baseline ? "40px" : "28px");
        await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
        await page.waitForTimeout(500);
        const alertCount = await page.getByRole("alert").count();
        assert.equal(alertCount > 0, !baseline);
        if (!baseline) await textVisible(page, "No browser wallet found. Install a wallet, then reload.");
        await page.screenshot({ path: `${out}/${engine}-no-wallet.png` });
        return { top: box.y, bottom: box.y + box.height, headingSize, alertCount };
      } });
      await observe(`${engine}: skip link`, browser, { test: async ({ page }) => {
        await page.goto(`${url}#/c/invalid`);
        await textVisible(page, "Collection not found");
        await page.keyboard.press("Tab");
        assert.equal(await page.locator(":focus").innerText(), "Skip to content");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(100);
        const hash = await page.evaluate(() => location.hash);
        const focus = await page.evaluate(() => document.activeElement.id);
        assert.equal(hash, baseline ? "#main" : "#/c/invalid");
        if (!baseline) assert.equal(focus, "main");
        return { hash, focus, heading: await page.locator("h1").innerText() };
      } });
      await observe(`${engine}: unreadable collection`, browser, { settings: { count: 1n, detailError: true }, test: async ({ page, state }) => {
        await page.goto(url);
        await textVisible(page, "1 created");
        if (baseline) {
          await textVisible(page, "0 / 0 minted");
          // Wait for transport retries to finish, not just the initial loading fallback.
          await page.waitForTimeout(12_000);
          assert.match(await page.locator(".item").innerText(), /0 \/ 0 minted · 0 ETH \+ fee/);
          return { row: await page.locator(".item").innerText() };
        }
        await textVisible(page, "Collection details unavailable");
        const row = await page.locator(".item").innerText();
        assert.doesNotMatch(row, /minted|ETH|Mint/);
        await page.screenshot({ path: `${out}/${engine}-details-error.png`, fullPage: true });
        state.detailError = false;
        await page.getByRole("button", { name: "Retry collection details" }).click();
        await textVisible(page, "7 / 10,000 minted · 0.01 ETH + fee");
        return { unavailable: row, recovered: await page.locator(".item").innerText() };
      } });
      await observe(`${engine}: failed token lookups`, browser, { settings: { injected: true, ownerError: true }, test: async ({ page, state, calls }) => {
        await page.goto(`${url}#/c/${collection}`);
        await textVisible(page, "Fixture collection");
        await connect(page);
        const panel = page.getByRole("region", { name: "Your tokens" });
        await textVisible(page, "2 held");
        if (baseline) {
          await page.waitForFunction(() => !document.body.innerText.includes("Reading token ids…"));
          assert.equal(calls.filter(c => c.functionName === "ownerOf").length >= 7, true);
          assert.equal(await panel.locator(".token").count(), 0);
          assert.doesNotMatch(await panel.innerText(), /could not/);
          return { panel: await panel.innerText() };
        }
        await textVisible(page, "Token ids could not be listed");
        assert.equal(await panel.locator(".token").count(), 0);
        await page.screenshot({ path: `${out}/${engine}-tokens-error.png`, fullPage: true });
        const failed = await panel.innerText();
        state.ownerError = false;
        await page.getByRole("button", { name: "Retry token list" }).click();
        await textVisible(page, "WOVEN #1");
        await textVisible(page, "WOVEN #2");
        assert.equal(await panel.locator(".token").count(), 2);
        return { failed, recovered: await panel.innerText() };
      } });
      if (!baseline) {
        await observe(`${engine}: pending details and one failed read`, browser, { settings: { count: 1n, detailDelay: 500, detailError: "mintPrice" }, test: async ({ page, state }) => {
          await page.goto(url);
          await textVisible(page, "Loading collection details…");
          assert.doesNotMatch(await page.locator(".item").innerText(), /minted|ETH|Mint/);
          await textVisible(page, "Collection details unavailable");
          assert.doesNotMatch(await page.locator(".item").innerText(), /minted|ETH|Mint/);
          state.detailError = false;
          await page.getByRole("button", { name: "Retry collection details" }).click();
          await textVisible(page, "7 / 10,000 minted · 0.01 ETH + fee");
          return { loading: "unknown amounts", partialFailure: "unavailable", retry: "complete details" };
        } });
        for (const scenario of [{ label: "one owner lookup fails", ownerError: 2, owned: [1n, 2n] }, { label: "incomplete ownership count", owned: [1n] }, { label: "empty ownership count", owned: [] }]) {
          await observe(`${engine}: ${scenario.label}`, browser, { settings: { injected: true, ...scenario }, test: async ({ page }) => {
            await page.goto(`${url}#/c/${collection}`);
            await textVisible(page, "Fixture collection");
            await connect(page);
            await textVisible(page, "2 held");
            await textVisible(page, "Token ids could not be listed");
            assert.equal(await page.locator(".token").count(), 0);
            assert.equal(await page.getByRole("button", { name: "Retry token list" }).isEnabled(), true);
            return { result: "visible error; no incomplete token rows; retry enabled" };
          } });
        }
        await observe(`${engine}: wallet rejection`, browser, { settings: { injected: true, rejectConnect: true }, test: async ({ page }) => {
          await page.goto(url);
          await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
          await page.getByRole("alert").waitFor();
          assert.match(await page.getByRole("alert").innerText(), /reject|cancel/i);
          assert.equal(await page.getByRole("button", { name: "Connect wallet", exact: true }).isEnabled(), true);
          return { error: await page.getByRole("alert").innerText() };
        } });
        await observe(`${engine}: create fee, mint fee, chain switch and skip state`, browser, { settings: { injected: true, chainId: "0xa" }, test: async ({ page, calls }) => {
          await page.goto(url);
          await textVisible(page, "0 created");
          assert.equal(await page.locator("button[type=submit]").isDisabled(), true);
          await connect(page);
          await page.getByRole("button", { name: "Switch to Ethereum", exact: true }).click();
          await page.getByRole("button", { name: "Create collection for 0.002 ETH", exact: true }).waitFor();
          const requests = await page.evaluate(() => window.walletRequests);
          assert.deepEqual(requests.filter(r => /wallet_(switchEthereumChain|addEthereumChain)/.test(r.method)).map(r => r.method), ["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
          assert.deepEqual(requests.find(r => r.method === "wallet_addEthereumChain").params, [manifest.walletAddChain]);
          await page.getByLabel("Name", { exact: true }).fill("Revision collection");
          await page.getByLabel("Symbol", { exact: true }).fill("REV");
          await page.getByLabel("Supply", { exact: true }).fill("10000");
          await page.getByLabel("Mint price (ETH)", { exact: true }).fill("0.01");
          await page.getByLabel("Max per wallet", { exact: true }).fill("5");
          await page.getByRole("button", { name: "Create collection for 0.002 ETH", exact: true }).click();
          await page.getByRole("alert").waitFor();
          assert.match(await page.getByRole("alert").innerText(), /reject|cancel/i);
          const create = calls.find(c => c.functionName === "createCollection");
          assert.equal(BigInt(create.value), parseEther("0.002"));
          assert.deepEqual(create.args, ["Revision collection", "REV", "10000", parseEther("0.01").toString(), "5", wallet, "500"]);
          await page.evaluate(address => { location.hash = `#/c/${address}`; }, collection);
          await textVisible(page, "Fixture collection");
          await page.getByLabel("Quantity", { exact: true }).fill("2");
          await page.getByRole("link", { name: "Skip to content" }).focus();
          await page.keyboard.press("Enter");
          assert.equal(await page.evaluate(() => location.hash), `#/c/${collection}`);
          assert.equal(await page.evaluate(() => document.activeElement.id), "main");
          assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "2");
          await page.getByRole("button", { name: "Mint 2 for 0.021 ETH", exact: true }).click();
          await page.getByRole("alert").waitFor();
          assert.match(await page.getByRole("alert").innerText(), /reject|cancel/i);
          const mint = calls.find(c => c.functionName === "mint");
          assert.equal(BigInt(mint.value), parseEther("0.021"));
          assert.deepEqual(mint.args, ["2"]);
          const sent = await page.evaluate(() => window.walletRequests.filter(r => r.method === "eth_sendTransaction"));
          assert.equal(sent.length, 2);
          assert.equal(BigInt(sent[0].params[0].value), parseEther("0.002"));
          assert.equal(BigInt(sent[1].params[0].value), parseEther("0.021"));
          return { chainSwitch: "switch/add/switch with manifest parameters", simulatedAndRequestedCreateWei: BigInt(create.value).toString(), simulatedAndRequestedMintWei: BigInt(mint.value).toString(), skipPreservedQuantity: "2", transactions: "mock wallet rejected both; nothing broadcast" };
        } });
        await observe(`${engine}: responsive stress`, browser, { settings: { injected: true, count: 1n, name: "A collection with a very long name and a full supply count", maxSupply: 10n ** 36n, totalSupply: 10n ** 35n, balance: 10n ** 30n }, test: async ({ page }) => {
          await page.goto(url);
          await textVisible(page, "A collection with a very long name");
          await connect(page);
          const measurements = [];
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            await page.getByRole("button", { name: /^Wallet / }).click();
            const home = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
            await page.screenshot({ path: `${out}/${engine}-home-stress-${width}.png`, fullPage: true });
            assert.equal(home.scroll, width, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("main *, header *, footer *")].filter(el => el.getBoundingClientRect().right > innerWidth).map(el => ({ tag: el.tagName, className: el.className, text: el.textContent.slice(0, 100) })))));
            await page.keyboard.press("Escape");
            await page.evaluate(address => { location.hash = `#/c/${address}`; }, collection);
            await textVisible(page, "A collection with a very long name");
            const collectionSize = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
            assert.equal(collectionSize.scroll, width);
            await page.screenshot({ path: `${out}/${engine}-collection-stress-${width}.png`, fullPage: true });
            measurements.push({ width, homeScroll: home.scroll, collectionScroll: collectionSize.scroll });
            await page.evaluate(() => { location.hash = "#/"; });
            await page.getByRole("heading", { name: "Weave your collection." }).waitFor();
          }
          return { measurements };
        } });
      }
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(done => server.close(done));
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + "\n");
}
