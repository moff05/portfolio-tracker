import { Database } from "bun:sqlite";
import { buildSnapshot, isoAddDays } from "../src/lib/portfolio";
import type { Transaction } from "../src/lib/portfolio";

const db = new Database("./data/portfolio.db");
const today = "2026-06-24";

const rawTxns = db.prepare("SELECT * FROM transactions ORDER BY trade_date").all() as any[];
const txns: Transaction[] = rawTxns.map((t: any) => ({ ...t }));

// Load prices the same way use-portfolio does: most recent cached close per symbol
const priceRows = db.prepare(
  "SELECT symbol, as_of_date, close FROM price_cache WHERE as_of_date <= ? AND as_of_date >= ? ORDER BY as_of_date DESC"
).all(today, isoAddDays(today, -7)) as { symbol: string; as_of_date: string; close: number }[];

const prices: Record<string, number> = {};
const seen = new Set<string>();
for (const r of priceRows) {
  if (!seen.has(r.symbol)) {
    prices[r.symbol] = Number(r.close);
    seen.add(r.symbol);
  }
}

console.log("EIBLX in prices map:", prices["EIBLX"]);
console.log("All symbols in price cache today:", Object.keys(prices).sort().join(", "));

const snapshot = buildSnapshot(txns, today, prices);
const eiblx = snapshot.holdings.find(h => h.symbol === "EIBLX");
console.log("\nEIBLX holding from buildSnapshot:");
if (eiblx) {
  console.log(JSON.stringify(eiblx, null, 2));
} else {
  console.log("  NOT FOUND in snapshot");
}
