import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { SortHead, useSortable, sortRows } from "@/components/SortHead";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { getPerformance, getInceptionDate } from "@/lib/performance.functions";
import { useAccountFilter } from "@/lib/account-filter";
import { isoAddDays, formatMoney } from "@/lib/portfolio";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import type { ChartPoint, AttributionRow, SubPeriod } from "@/lib/twr";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({ meta: [{ title: "Performance — Portfolio Tracker" }] }),
  component: PerformancePage,
});

const today = new Date().toISOString().slice(0, 10);
const thisYear = today.slice(0, 4);
const TICK = { fontSize: 11, fill: "currentColor" };

type Period = "YTD" | "1Y" | "3Y" | "Inception";

function getPeriodDates(period: Period, inceptionDate: string | null): { start: string; end: string } {
  switch (period) {
    case "YTD":       return { start: `${thisYear}-01-01`, end: today };
    case "1Y":        return { start: isoAddDays(today, -365), end: today };
    case "3Y":        return { start: isoAddDays(today, -3 * 365), end: today };
    case "Inception": return { start: inceptionDate ?? `${thisYear}-01-01`, end: today };
  }
}

function fmt(n: number, decimals = 2) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(decimals)}%`;
}

/** Abbreviate a dollar value: $16.2M, $842K, or exact for < $10K. */
function fmtBig(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `$${(n / 1_000).toFixed(0)}K`;
  return formatMoney(n);
}

/** Pick a font-size class that keeps numbers inside their card. */
function numCls(s: string, colorCls = "") {
  const n = s.replace(/[^0-9.,%-+$]/g, "").length;
  const size = n > 13 ? "text-base" : n > 10 ? "text-lg" : n > 7 ? "text-xl" : "text-2xl";
  return cn(size, "font-bold tracking-tight tabular-nums leading-tight", colorCls);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function fmtChartDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", year: "2-digit", timeZone: "UTC",
  });
}

function ReturnBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", positive ? "text-gain" : "text-loss")}>
      {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {fmt(value)}
    </span>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      <div className="font-medium mb-1 text-foreground">{fmtDate(label)}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span style={{ color: p.color }}>●</span>
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold tabular-nums" style={{ color: p.color }}>
            {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

type BenchSym = "SPY" | "QQQ";
const BENCH_LABELS: Record<BenchSym, string> = { SPY: "S&P 500", QQQ: "NASDAQ 100" };

function PerformanceChart({ points, benchSym }: { points: ChartPoint[]; benchSym: BenchSym }) {
  if (points.length < 2) return null;
  const dataKey = benchSym === "QQQ" ? "qqqReturn" : "benchmarkReturn";
  const hasBenchmark = points.some((p) => p[dataKey as keyof ChartPoint] !== null);
  const benchLabel = BENCH_LABELS[benchSym];

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-foreground">Cumulative Return</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Portfolio vs. {benchLabel} at each sub-period boundary</p>
      </div>
      <div className="text-muted-foreground">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={points} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <XAxis
              dataKey="date"
              tickFormatter={fmtChartDate}
              tick={TICK}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <ReferenceLine y={0} stroke="var(--color-border)" strokeDasharray="3 3" />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              formatter={(value) => <span className="text-foreground">{value}</span>}
            />
            <Line
              type="monotone"
              dataKey="portfolioReturn"
              name="Portfolio"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={{ r: 3, fill: "#0ea5e9" }}
              activeDot={{ r: 5 }}
            />
            {hasBenchmark && (
              <Line
                type="monotone"
                dataKey={dataKey}
                name={benchLabel}
                stroke="var(--color-muted-foreground)"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 3, fill: "var(--color-muted-foreground)" }}
                activeDot={{ r: 5 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function AttributionTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as AttributionRow;
  const pos = row.dollarsGained >= 0;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-sm space-y-1 min-w-[200px]">
      <div className="font-semibold text-foreground">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">$ Gain/Loss</span>
        <span className={cn("font-semibold tabular-nums", pos ? "text-gain" : "text-loss")}>
          {pos ? "+" : ""}{formatMoney(row.dollarsGained)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Contribution</span>
        <span className={cn("font-semibold tabular-nums", pos ? "text-gain" : "text-loss")}>
          {fmt(row.contribution)}
        </span>
      </div>
      {row.startValue > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Position return</span>
          <span className={cn("tabular-nums", row.positionReturn >= 0 ? "text-gain" : "text-loss")}>
            {fmt(row.positionReturn)}
          </span>
        </div>
      )}
    </div>
  );
}

function SubPeriodsSection({ subPeriods }: { subPeriods: SubPeriod[] }) {
  const [sort, handleSort] = useSortable("start", "asc");
  const rows = useMemo(() => sortRows(subPeriods as any[], sort), [subPeriods, sort]);
  return (
    <Card>
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-foreground">Sub-Period Breakdown</h2>
        <p className="text-xs mt-0.5">
          Each row is a period between external cash flows. Returns chain-link to the cumulative TWR above.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label="Period"      sortKey="start"          sort={sort} onSort={handleSort} />
            <SortHead label="Start Value" sortKey="startValue"     sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="End Value"   sortKey="endValue"       sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="Cash Flow"   sortKey="externalFlow"   sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="Return"      sortKey="periodReturn"   sort={sort} onSort={handleSort} className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((sp, i) => (
            <TableRow key={i}>
              <TableCell className="text-sm">
                <span className="font-medium text-foreground">{fmtDate(sp.start)}</span>
                <span className="text-muted-foreground"> → </span>
                <span className="font-medium text-foreground">{fmtDate(sp.end)}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(sp.startValue)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(sp.endValue)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {Math.abs(sp.externalFlow) >= 1 ? (
                  <span className={sp.externalFlow > 0 ? "text-primary" : "text-loss"}>
                    {sp.externalFlow > 0 ? "+" : ""}{formatMoney(sp.externalFlow)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <ReturnBadge value={sp.periodReturn} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AttributionSection({ rows, startTotal }: { rows: AttributionRow[]; startTotal: number }) {
  if (rows.length === 0) return null;

  const [sort, handleSort] = useSortable("dollarsGained");
  const sortedRows = useMemo(() => sortRows(rows as any[], sort), [rows, sort]);

  return (
    <Card>
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-foreground">Performance Attribution</h2>
        <p className="text-xs mt-0.5">
          Dollar gain/loss per position, net of any capital added or removed mid-period.
        </p>
      </div>

      <div className="p-5">
        <div className="text-muted-foreground h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <XAxis
                dataKey="symbol"
                tick={TICK}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => {
                  const abs = Math.abs(v);
                  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
                  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
                  return `$${v.toFixed(0)}`;
                }}
                tick={TICK}
                tickLine={false}
                axisLine={false}
                width={60}
              />
              <ReferenceLine y={0} stroke="var(--color-border)" />
              <Tooltip content={<AttributionTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} />
              <Bar dataKey="dollarsGained" radius={[3, 3, 0, 0]}>
                {rows.map((row, i) => (
                  <Cell key={i} fill={row.dollarsGained >= 0 ? "#16a34a" : "#dc2626"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label="Symbol"           sortKey="symbol"          sort={sort} onSort={handleSort} />
            <SortHead label="Start Value"      sortKey="startValue"      sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="End Value"        sortKey="endValue"        sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="$ Gain / Loss"    sortKey="dollarsGained"   sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="Position Return"  sortKey="positionReturn"  sort={sort} onSort={handleSort} className="text-right" />
            <SortHead label="Contribution"     sortKey="contribution"    sort={sort} onSort={handleSort} className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row) => {
            const pos = row.dollarsGained >= 0;
            return (
              <TableRow key={row.symbol}>
                <TableCell className="font-medium text-foreground">{row.symbol}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.startValue > 0 ? formatMoney(row.startValue) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.endValue > 0 ? formatMoney(row.endValue) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", pos ? "text-gain" : "text-loss")}>
                  {pos ? "+" : ""}{formatMoney(row.dollarsGained)}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", row.startValue > 0 ? (row.positionReturn >= 0 ? "text-gain" : "text-loss") : "text-muted-foreground")}>
                  {row.startValue > 0 ? fmt(row.positionReturn) : "—"}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums font-semibold", pos ? "text-gain" : "text-loss")}>
                  {fmt(row.contribution)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {startTotal > 0 && (
        <div className="px-5 py-3 border-t text-xs text-muted-foreground">
          Contribution = (position $ gain − mid-period capital added) ÷ starting portfolio value of {formatMoney(startTotal)}.
          Columns sum to approximately the period's cumulative return.
        </div>
      )}
    </Card>
  );
}

function PerformancePage() {
  const [period, setPeriod] = useState<Period>("YTD");
  const [benchSym, setBenchSym] = useState<BenchSym>("SPY");
  const { account } = useAccountFilter();

  const inceptionQ = useQuery({
    queryKey: ["inception-date", account ?? "all"],
    queryFn: () => getInceptionDate({ data: { account } }),
    staleTime: Infinity,
  });
  const inceptionDate = inceptionQ.data ?? null;

  const { start: startDate, end: endDate } = getPeriodDates(period, inceptionDate);

  const perfQ = useQuery({
    queryKey: ["performance", startDate, endDate, account ?? "all"],
    queryFn: () => getPerformance({ data: { startDate, endDate, account } }),
    staleTime: 2 * 60_000,
    enabled: !!startDate && startDate < endDate,
  });

  const result = perfQ.data;
  const loading = perfQ.isFetching;

  const periods: Period[] = ["YTD", "1Y", "3Y", "Inception"];

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Performance Returns</h1>
          <p className="text-sm mt-0.5">
            Time-weighted return removes the effect of contributions and withdrawals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border p-1 bg-muted/40">
            {(["SPY", "QQQ"] as BenchSym[]).map((b) => (
              <button
                key={b}
                onClick={() => setBenchSym(b)}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  benchSym === b
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                vs. {BENCH_LABELS[b]}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg border p-1 bg-muted/40">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                disabled={p === "Inception" && !inceptionDate}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  period === p
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Fetching historical prices — this may take a moment on first load.
        </div>
      )}

      {result && !loading && (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <Card className="p-5 min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Cumulative Return</div>
              <div className={numCls(fmt(result.twr), result.twr >= 0 ? "text-gain" : "text-loss")}>
                {fmt(result.twr)}
              </div>
              <div className="text-xs mt-1 truncate">
                {fmtDate(result.startDate)} → {fmtDate(result.endDate)}
              </div>
            </Card>

            <Card className="p-5 min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Annualized Return</div>
              {result.twrAnnualized != null ? (
                <>
                  <div className={numCls(fmt(result.twrAnnualized), result.twrAnnualized >= 0 ? "text-gain" : "text-loss")}>
                    {fmt(result.twrAnnualized)}
                  </div>
                  <div className="text-xs mt-1">per year</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">period under 1 year</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              {(() => {
                const benchReturn = benchSym === "QQQ" ? result.qqqReturn : result.benchmarkReturn;
                const benchLabel = BENCH_LABELS[benchSym];
                if (benchReturn != null) {
                  const delta = result.twr - benchReturn;
                  const out = delta >= 0;
                  return (
                    <>
                      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">vs. {benchLabel}</div>
                      <div className={numCls(fmt(delta), out ? "text-gain" : "text-loss")}>{fmt(delta)}</div>
                      <div className="text-xs mt-1">
                        {benchLabel}: {fmt(benchReturn)} · {out ? "outperforming" : "underperforming"}
                      </div>
                    </>
                  );
                }
                return (
                  <>
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">vs. {benchLabel}</div>
                    <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                    <div className="text-xs mt-1">benchmark unavailable</div>
                  </>
                );
              })()}
            </Card>

            <Card className="p-5 min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">IRR</div>
              {result.irr != null ? (
                <>
                  <div className={numCls(fmt(result.irr), result.irr >= 0 ? "text-gain" : "text-loss")}>
                    {fmt(result.irr)}
                  </div>
                  <div className="text-xs mt-1">dollar-weighted, annualized</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">insufficient cash flows</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Market Value</div>
              <div className="text-2xl font-bold tabular-nums leading-tight text-foreground">{fmtBig(result.endValue)}</div>
              <div className="text-xs mt-1 tabular-nums">{formatMoney(result.endValue)}</div>
            </Card>
          </div>

          {/* Risk metrics row */}
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="p-5 min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Annualized Volatility</div>
              {result.volatility != null ? (
                <>
                  <div className={numCls(fmt(result.volatility), "text-foreground")}>
                    {fmt(result.volatility)}
                  </div>
                  <div className="text-xs mt-1">std dev of sub-period returns, annualized</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">needs ≥ 4 sub-periods each &lt; 90 days</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Sharpe Ratio</div>
              {result.sharpe != null ? (
                <>
                  <div className={cn("text-2xl font-bold tracking-tight tabular-nums", result.sharpe >= 1 ? "text-gain" : result.sharpe >= 0 ? "text-foreground" : "text-loss")}>
                    {result.sharpe.toFixed(2)}
                  </div>
                  <div className="text-xs mt-1">
                    risk-free {(result.riskFreeRate * 100).toFixed(2)}% (^IRX) · ≥1.0 = good
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">requires volatility estimate</div>
                </>
              )}
            </Card>

            <Card className="p-5 min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Max Drawdown</div>
              {result.maxDrawdown != null ? (
                <>
                  <div className={numCls(result.maxDrawdown > 0 ? `-${fmt(result.maxDrawdown)}` : "0.00%", result.maxDrawdown > 0 ? "text-loss" : "text-gain")}>
                    {result.maxDrawdown > 0 ? `-${fmt(result.maxDrawdown)}` : "0.00%"}
                  </div>
                  <div className="text-xs mt-1">
                    {result.maxDrawdown === 0 ? "no drawdown in this period" : "peak-to-trough within selected period"}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold tracking-tight text-muted-foreground">—</div>
                  <div className="text-xs mt-1">insufficient data</div>
                </>
              )}
            </Card>
          </div>

          <PerformanceChart points={result.chartPoints} benchSym={benchSym} />

          <AttributionSection rows={result.attribution} startTotal={result.startValue} />

          {result.subPeriods.length > 0 && (
            <SubPeriodsSection subPeriods={result.subPeriods} />
          )}

          {result.subPeriods.length === 0 && (
            <Card className="p-10 text-center text-sm">
              No sub-periods found for this date range.
            </Card>
          )}
        </>
      )}

      {!result && !loading && (
        <Card className="p-10 text-center text-sm">
          No transaction data found for this period.
        </Card>
      )}

      <p className="text-xs">
        TWR divides the period at each external cash flow, computes returns for each sub-period independently, then chain-links.
        Prices sourced from Yahoo Finance and cached locally. Benchmark is SPY.
      </p>
    </div>
  );
}
