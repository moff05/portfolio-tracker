import { Database } from "bun:sqlite";
import { buildSnapshot, isoAddDays } from "../src/lib/portfolio";
import type { Transaction } from "../src/lib/portfolio";

const db = new Database("./data/portfolio.db");

const rawTxns = db.prepare("SELECT * FROM transactions ORDER BY trade_date").all() as any[];
const txns: Transaction[] = rawTxns.map((t: any) => ({ ...t }));

const startDate = "2020-03-13";
const endDate = "2026-06-24";

function loadPricesForDate(date: string): Record<string, number> {
  const rows = db.prepare(
    "SELECT symbol, close FROM price_cache WHERE as_of_date <= ? AND as_of_date >= ? ORDER BY as_of_date DESC"
  ).all(date, isoAddDays(date, -7)) as { symbol: string; close: number }[];
  const prices: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    if (!seen.has(r.symbol)) { prices[r.symbol] = Number(r.close); seen.add(r.symbol); }
  }
  return prices;
}

const cfDates = Array.from(new Set(
  txns.filter(t => t.trade_date > startDate && t.trade_date < endDate &&
    (t.action === "CONTRIBUTION" || t.action === "DISTRIBUTION") && Math.abs(Number(t.amount)) >= 1)
    .map(t => t.trade_date)
)).sort();

const IN_KIND_THRESHOLD = -100_000;
let runningCash = 0;
const inKindSet = new Set<string>(cfDates);
const inKindBoundaries: string[] = [];
for (const t of txns) {
  const amt = Math.abs(Number(t.amount) || 0);
  if (t.action === "CONTRIBUTION" || t.action === "DIVIDEND" || t.action === "INTEREST") runningCash += amt;
  else if (t.action === "FEE") runningCash -= amt;
  else if (t.action === "SELL" || t.action === "DISTRIBUTION") runningCash += amt;
  else if (t.action === "BUY") {
    runningCash -= amt;
    if (runningCash < IN_KIND_THRESHOLD) {
      runningCash += amt;
      if (t.trade_date > startDate && t.trade_date < endDate && !inKindSet.has(t.trade_date)) {
        inKindSet.add(t.trade_date);
        inKindBoundaries.push(t.trade_date);
      }
    }
  }
}
const extraBoundaries = [...new Set(inKindBoundaries)].sort();
const allBoundaryDates = Array.from(new Set([...cfDates, ...extraBoundaries.filter(d => d > startDate && d < endDate)])).sort();
const boundaries = [startDate, ...allBoundaryDates, endDate];
const contributionDates = new Set(cfDates);

let cumProduct = 1;
console.log("period | sv | ev | r | cumTWR");
for (let i = 0; i < boundaries.length - 1; i++) {
  const periodStart = boundaries[i];
  const nextBoundary = boundaries[i + 1];
  const periodEnd = nextBoundary === endDate ? endDate : isoAddDays(nextBoundary, -1);

  const startPrices = loadPricesForDate(periodStart);
  const endPrices = loadPricesForDate(periodEnd);
  const startSnap = buildSnapshot(txns, periodStart, startPrices);
  const endSnap = buildSnapshot(txns, periodEnd, endPrices);

  let startValue = startSnap.totalMarketValue;
  if (contributionDates.has(periodStart)) {
    const contributed = txns.filter(t => t.trade_date === periodStart && t.action === "CONTRIBUTION").reduce((s, t) => s + Number(t.amount), 0);
    const deployed = txns.filter(t => t.trade_date === periodStart && t.action === "BUY").reduce((s, t) => s + (Math.abs(Number(t.amount)) || Number(t.quantity) * Number(t.price)), 0);
    startValue += Math.max(0, contributed - deployed);
  }
  const endValue = endSnap.totalMarketValue;
  if (startValue <= 0) { console.log(`${periodStart}->${periodEnd}: SKIP sv=${startValue.toFixed(0)}`); continue; }
  const r = (endValue - startValue) / startValue;
  cumProduct *= 1 + r;
  console.log(`${periodStart}->${periodEnd}: sv=${startValue.toFixed(0)} ev=${endValue.toFixed(0)} r=${(r*100).toFixed(2)}% cum=${((cumProduct-1)*100).toFixed(2)}%`);
}
console.log(`\nFINAL Inception TWR: ${((cumProduct - 1) * 100).toFixed(2)}%`);
