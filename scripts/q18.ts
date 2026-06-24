import { Database } from "bun:sqlite";
import { buildSnapshot, isoAddDays } from "../src/lib/portfolio";
import type { Transaction } from "../src/lib/portfolio";

const db = new Database("./data/portfolio.db");
const rawTxns = db.prepare("SELECT * FROM transactions ORDER BY trade_date").all() as any[];
const txns: Transaction[] = rawTxns.map((t: any) => ({ ...t }));

// Check Feb18 2025 snapshot in detail
const date = "2025-02-18";
const lookback = isoAddDays(date, -7);
const rows = db.prepare(
  "SELECT symbol, as_of_date, close FROM price_cache WHERE as_of_date <= ? AND as_of_date >= ? ORDER BY symbol, as_of_date DESC"
).all(date, lookback) as { symbol: string; as_of_date: string; close: number }[];

// Most recent per symbol
const prices: Record<string, { date: string; price: number }> = {};
for (const r of rows) {
  if (!prices[r.symbol]) prices[r.symbol] = { date: r.as_of_date, price: Number(r.close) };
}

// Build snapshot
const pricesFlat: Record<string, number> = Object.fromEntries(Object.entries(prices).map(([s, v]) => [s, v.price]));
const snap = buildSnapshot(txns, date, pricesFlat);

console.log(`\nPortfolio at ${date}:`);
console.log(`Total Market Value: $${snap.totalMarketValue.toFixed(0)}`);
console.log(`Holdings: ${snap.holdings.length}`);
for (const h of snap.holdings.sort((a,b) => b.marketValue - a.marketValue)) {
  const priceInfo = prices[h.symbol] ?? prices[h.symbol.replace(".", "-")];
  console.log(`  ${h.symbol}: ${h.quantity.toFixed(3)} shares @ $${(h.marketValue/Math.max(h.quantity,0.001)).toFixed(2)} = $${h.marketValue.toFixed(0)} [price from: ${priceInfo?.date ?? "MISSING"}]`);
}

// Check which symbols have NO cached prices around Feb18 2025
console.log("\n--- symbols with NO prices near Feb18 2025 ---");
const allSymbols = new Set<string>();
for (const t of txns) { if (t.symbol && (t.action === "BUY" || t.action === "SELL")) allSymbols.add(t.symbol); }
for (const sym of allSymbols) {
  const yhSym = sym.replace(".", "-");
  if (!prices[sym] && !prices[yhSym]) {
    console.log(`  ${sym} (yhSym=${yhSym}): NO prices near ${date}`);
  }
}
