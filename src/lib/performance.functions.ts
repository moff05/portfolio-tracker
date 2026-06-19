import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isoAddDays } from "./portfolio";
import { computeTWR, computeIRR } from "./twr";
import { annualizedVolatility, maxDrawdown, sharpeRatio } from "./risk";
import { getRiskFreeRate } from "./prices.functions";
import { buildResolver } from "./symbol-resolver";
import { yahooChart } from "./prices.functions";
import type { Transaction } from "./portfolio";

export const getInceptionDate = createServerFn({ method: "GET" })
  .inputValidator((d: { account?: string | null }) =>
    z.object({ account: z.string().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    const row = data?.account
      ? (db.prepare("SELECT MIN(trade_date) as d FROM transactions WHERE account = ?").get(data.account) as { d: string | null })
      : (db.prepare("SELECT MIN(trade_date) as d FROM transactions").get() as { d: string | null });
    return row?.d ?? null;
  });

export const getPerformance = createServerFn({ method: "POST" })
  .inputValidator((d: { startDate: string; endDate: string; account?: string | null }) =>
    z
      .object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        account: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getDb } = await import("@/lib/db.server");
    const db = getDb();
    const { startDate, endDate, account } = data;

    // Load + resolve transactions
    const rawTxns = (account
      ? db.prepare("SELECT * FROM transactions WHERE account = ? ORDER BY trade_date").all(account)
      : db.prepare("SELECT * FROM transactions ORDER BY trade_date").all()) as any[];
    const rawMappings = db.prepare("SELECT * FROM symbol_mappings").all() as any[];
    const resolve = buildResolver(rawMappings as any);
    const txns: Transaction[] = rawTxns.map((t: any) => ({
      ...t,
      symbol: t.symbol ? (resolve(t.symbol).ticker ?? t.symbol) : null,
    }));

    // Sub-period CF dates — ignore noise contributions below $1
    const cfDates = Array.from(
      new Set(
        txns
          .filter(
            (t) =>
              t.trade_date > startDate &&
              t.trade_date < endDate &&
              (t.action === "CONTRIBUTION" || t.action === "DISTRIBUTION") &&
              Math.abs(Number(t.amount)) >= 1,
          )
          .map((t) => t.trade_date),
      ),
    ).sort();

    // Unique price dates needed: startDate, endDate, each CF date + day before each CF
    const priceDateSet = new Set<string>([startDate, endDate]);
    for (const d of cfDates) {
      priceDateSet.add(d);
      priceDateSet.add(isoAddDays(d, -1));
    }
    const priceDates = Array.from(priceDateSet).sort();

    // All symbols held at any point in the period + benchmarks
    const allSymbols = new Set<string>(["SPY", "QQQ"]);
    for (const t of txns) {
      if (t.symbol && t.trade_date <= endDate && (t.action === "BUY" || t.action === "SELL")) {
        allSymbols.add(t.symbol.toUpperCase());
      }
    }

    const pricesByDate: Record<string, Record<string, number>> = {};
    for (const d of priceDates) pricesByDate[d] = {};

    const upsert = db.prepare(
      "INSERT OR REPLACE INTO price_cache (symbol, as_of_date, close) VALUES (?, ?, ?)",
    );

    // For each symbol: fetch the full range in one Yahoo call, cache, then distribute to price dates
    const p1Unix = Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000);
    const p2Unix = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000) + 86400;

    await Promise.all(
      Array.from(allSymbols).map(async (sym) => {
        // Yahoo Finance uses hyphens for class-share tickers (BRK.B → BRK-B)
        const yhSym = sym.replace(".", "-");

        // Load cached closes for this symbol over the range
        const cached = db
          .prepare(
            "SELECT as_of_date, close FROM price_cache WHERE symbol = ? AND as_of_date >= ? AND as_of_date <= ?",
          )
          .all(yhSym, startDate, endDate) as { as_of_date: string; close: number }[];

        const closeMap = new Map<string, number>(cached.map((r) => [r.as_of_date, Number(r.close)]));

        // Fetch from Yahoo to fill any gaps
        try {
          const result = await yahooChart(yhSym, p1Unix, p2Unix);
          const timestamps: number[] = result.timestamp ?? [];
          const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
          for (let i = 0; i < timestamps.length; i++) {
            const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
            const close = closes[i];
            if (close != null && close > 0 && !closeMap.has(date)) {
              closeMap.set(date, Number(close));
              try {
                upsert.run(yhSym, date, Number(close));
              } catch { /* non-fatal cache write */ }
            }
          }
        } catch { /* symbol may not trade on Yahoo — skip */ }

        // For each price date, use the most recent close on or before that date
        const sortedDays = Array.from(closeMap.keys()).sort();
        for (const priceDate of priceDates) {
          let best: number | undefined;
          for (const d of sortedDays) {
            if (d <= priceDate) best = closeMap.get(d);
            else break;
          }
          // Store under yhSym; buildSnapshot falls back to yhSym via dot→hyphen lookup
          if (best != null && best > 0) pricesByDate[priceDate][yhSym] = best;
        }
      }),
    );

    // Extract SPY + QQQ prices for benchmark comparison
    const benchmarkPrices: Record<string, number> = {};
    const benchmarkPricesQQQ: Record<string, number> = {};
    for (const [date, prices] of Object.entries(pricesByDate)) {
      if (prices["SPY"]) benchmarkPrices[date] = prices["SPY"];
      if (prices["QQQ"]) benchmarkPricesQQQ[date] = prices["QQQ"];
    }

    const result = computeTWR(txns, startDate, endDate, pricesByDate, benchmarkPrices, benchmarkPricesQQQ);

    // IRR (dollar-weighted return): start value as outflow, end value as inflow,
    // with contributions/distributions as intermediate flows.
    if (result.startValue > 0) {
      const irrFlows: { date: string; amount: number }[] = [
        { date: startDate, amount: -result.startValue },
      ];
      for (const t of txns) {
        if (t.trade_date <= startDate || t.trade_date > endDate) continue;
        if (t.action === "CONTRIBUTION") {
          irrFlows.push({ date: t.trade_date, amount: -Math.abs(Number(t.amount)) });
        } else if (t.action === "DISTRIBUTION") {
          irrFlows.push({ date: t.trade_date, amount: Math.abs(Number(t.amount)) });
        }
      }
      irrFlows.push({ date: endDate, amount: result.endValue });
      result.irr = computeIRR(irrFlows);
    }

    // Risk metrics — computed from the sub-period series already in hand
    const rfr = await getRiskFreeRate();
    result.riskFreeRate = rfr;
    result.volatility = annualizedVolatility(result.subPeriods);
    result.maxDrawdown = maxDrawdown(result.chartPoints);
    if (result.twrAnnualized != null && result.volatility != null) {
      result.sharpe = sharpeRatio(result.twrAnnualized, result.volatility, rfr);
    }

    return result;
  });

/**
 * Compute monthly portfolio NAV from inception to today.
 * Returns one data point per month-end, computed from transaction history × cached prices.
 */
export const getNavHistory = createServerFn({ method: "GET" })
  .inputValidator((d: { account?: string | null }) =>
    z.object({ account: z.string().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
  const { getDb } = await import("@/lib/db.server");
  const db = getDb();

  const rawTxns = (data?.account
    ? db.prepare("SELECT * FROM transactions WHERE account = ? ORDER BY trade_date").all(data.account)
    : db.prepare("SELECT * FROM transactions ORDER BY trade_date").all()) as any[];
  if (rawTxns.length === 0) return [] as { date: string; value: number }[];

  const rawMappings = db.prepare("SELECT * FROM symbol_mappings").all() as any[];
  const resolve = buildResolver(rawMappings as any);
  const txns = rawTxns.map((t: any) => ({
    ...t,
    symbol: t.symbol ? (resolve(t.symbol).ticker ?? t.symbol) : null,
  }));

  const inceptionDate: string = txns[0].trade_date;
  const today = new Date().toISOString().slice(0, 10);

  // Hybrid date spine: monthly from inception to 1 year ago, daily for the last year
  const oneYearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const dates: string[] = [];

  // Monthly dates for older history
  let year = Number(inceptionDate.slice(0, 4));
  let month = Number(inceptionDate.slice(5, 7));
  while (true) {
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (lastDay >= oneYearAgo) break;
    dates.push(lastDay);
    month++;
    if (month > 12) { month = 1; year++; }
  }

  // Daily dates for the last year
  for (
    let d = new Date(oneYearAgo + "T00:00:00Z");
    d.toISOString().slice(0, 10) <= today;
    d.setDate(d.getDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }

  // Unique symbols ever traded
  const symbols = new Set<string>();
  for (const t of txns) {
    if (t.symbol && (t.action === "BUY" || t.action === "SELL")) symbols.add(t.symbol.toUpperCase());
  }
  if (symbols.size === 0) return [] as { date: string; value: number }[];

  const p1Unix = Math.floor(new Date(inceptionDate + "T00:00:00Z").getTime() / 1000);
  const p2Unix = Math.floor(new Date(today + "T23:59:59Z").getTime() / 1000) + 86400;

  const upsert = db.prepare("INSERT OR REPLACE INTO price_cache (symbol, as_of_date, close) VALUES (?, ?, ?)");

  // closeMap per symbol: date → close
  const closeMaps = new Map<string, Map<string, number>>();

  await Promise.all(Array.from(symbols).map(async (sym) => {
    const yhSym = sym.replace(".", "-");
    const cached = db
      .prepare("SELECT as_of_date, close FROM price_cache WHERE symbol = ? AND as_of_date >= ? AND as_of_date <= ?")
      .all(yhSym, inceptionDate, today) as { as_of_date: string; close: number }[];

    const closeMap = new Map<string, number>(cached.map((r) => [r.as_of_date, Number(r.close)]));

    try {
      const result = await yahooChart(yhSym, p1Unix, p2Unix);
      const timestamps: number[] = result.timestamp ?? [];
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
      for (let i = 0; i < timestamps.length; i++) {
        const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        const close = closes[i];
        if (close != null && close > 0 && !closeMap.has(date)) {
          closeMap.set(date, Number(close));
          try { upsert.run(yhSym, date, Number(close)); } catch { /* non-fatal */ }
        }
      }
    } catch { /* symbol may not trade on Yahoo */ }

    closeMaps.set(sym, closeMap);
  }));

  // Pre-sort each symbol's date list for fast "most recent price on or before date" lookups
  const sortedDays = new Map<string, string[]>();
  for (const [sym, map] of closeMaps) sortedDays.set(sym, Array.from(map.keys()).sort());

  function priceAt(sym: string, date: string): number {
    const map = closeMaps.get(sym);
    if (!map) return 0;
    const days = sortedDays.get(sym) ?? [];
    let p = 0;
    for (const d of days) {
      if (d > date) break;
      const v = map.get(d);
      if (v && v > 0) p = v;
    }
    return p;
  }

  // For each month-end: accumulate holdings from transactions and compute value
  const series: { date: string; value: number }[] = [];
  for (const date of dates) {
    const qty = new Map<string, number>();
    for (const t of txns) {
      if (t.trade_date > date) break;
      if (!t.symbol) continue;
      const sym = t.symbol.toUpperCase();
      const q = Math.abs(Number(t.quantity ?? 0));
      if (t.action === "BUY") qty.set(sym, (qty.get(sym) ?? 0) + q);
      else if (t.action === "SELL") qty.set(sym, (qty.get(sym) ?? 0) - q);
    }
    let value = 0;
    for (const [sym, q] of qty) {
      if (q <= 0.001) continue;
      const p = priceAt(sym, date);
      if (p > 0) value += q * p;
    }
    if (value > 0) series.push({ date, value });
  }

  return series;
});
