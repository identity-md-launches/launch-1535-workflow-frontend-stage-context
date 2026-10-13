import { formatEther, formatUnits, getAddress, isAddress, parseEther } from "viem";

export function shortAddress(address: string): string {
  const a = isAddress(address) ? getAddress(address) : address;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Full checksummed address for display where the whole value matters. */
export function checksum(address: string): string {
  return isAddress(address) ? getAddress(address) : address;
}

export function eth(wei: bigint | undefined, symbol = "ETH"): string {
  if (wei === undefined) return "…";
  const s = formatEther(wei);
  return `${trimZeros(s)} ${symbol}`;
}

export function units(amount: bigint | undefined, decimals: number, symbol: string): string {
  if (amount === undefined) return "…";
  const s = formatUnits(amount, decimals);
  const [whole, frac = ""] = s.split(".");
  const shownFrac = frac.slice(0, 4).replace(/0+$/, "");
  return `${withGrouping(whole)}${shownFrac ? "." + shownFrac : ""} ${symbol}`;
}

function withGrouping(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

export function count(n: bigint | number | undefined): string {
  if (n === undefined) return "…";
  return withGrouping(n.toString());
}

/** Parses a decimal ETH string into wei, or returns an error message. */
export function parseEthInput(value: string): { wei: bigint } | { error: string } {
  const v = value.trim();
  if (v === "") return { error: "Enter a price in ETH, 0 for a free mint" };
  if (!/^\d*(\.\d{0,18})?$/.test(v)) return { error: "Use a decimal number with up to 18 decimals" };
  try {
    return { wei: parseEther(v === "." ? "0" : v) };
  } catch {
    return { error: "Use a decimal number with up to 18 decimals" };
  }
}

export function parseIntegerInput(value: string, min: bigint, label: string): { value: bigint } | { error: string } {
  const v = value.trim();
  if (!/^\d+$/.test(v)) return { error: `Enter a whole number for ${label}` };
  const n = BigInt(v);
  if (n < min) return { error: `${label} must be at least ${min.toString()}` };
  return { value: n };
}

export function bps(value: bigint | number | undefined): string {
  if (value === undefined) return "…";
  const n = Number(value);
  return `${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}%`;
}
