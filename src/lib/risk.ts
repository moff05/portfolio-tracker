import type { SubPeriod, ChartPoint } from "./twr";

/**
 * Annualized volatility from sub-period returns.
 * Converts each sub-period's calendar days to trading-day equivalents (×252/365),
 * then scales the period std-dev to an annual basis.
 *
 * Returns null when:
 * - Fewer than 4 sub-periods (too few data points)
 * - Average sub-period length > 90 calendar days — annualizing multi-month returns
 *   produces meaningless volatility figures for portfolios with infrequent cash flows.
 */
export function annualizedVolatility(subPeriods: SubPeriod[]): number | null {
  if (subPeriods.length < 4) return null;

  const calDaysPerPeriod = subPeriods.map((sp) =>
    (new Date(sp.end + "T00:00:00Z").getTime() -
      new Date(sp.start + "T00:00:00Z").getTime()) /
    86400_000,
  );
  const avgCalDays = calDaysPerPeriod.reduce((s, d) => s + d, 0) / subPeriods.length;

  const returns = subPeriods.map((sp) => sp.periodReturn);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const periodStd = Math.sqrt(variance);

  const avgTradingDays = avgCalDays * (252 / 365);
  if (avgTradingDays <= 0) return null;

  return periodStd * Math.sqrt(252 / avgTradingDays);
}

/**
 * Maximum peak-to-trough drawdown from the cumulative return series.
 * Returns a positive decimal (0.15 = 15% drawdown), or null if no data.
 */
export function maxDrawdown(chartPoints: ChartPoint[]): number | null {
  if (chartPoints.length < 2) return null;
  let peak = -Infinity;
  let maxDD = 0;
  for (const pt of chartPoints) {
    const val = 1 + pt.portfolioReturn;
    if (val > peak) peak = val;
    const dd = (peak - val) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Sharpe ratio: (annualizedReturn − riskFreeRate) / annualizedVolatility.
 * riskFreeRate defaults to 4.5% (approximate short-term rate, 2024–2025).
 */
export function sharpeRatio(
  annualizedReturn: number,
  volatility: number,
  riskFreeRate = 0.045,
): number {
  if (volatility <= 0) return 0;
  return (annualizedReturn - riskFreeRate) / volatility;
}
