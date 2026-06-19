import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AsOfDatePicker } from "@/components/AsOfDatePicker";
import { UnmappedBanner } from "@/components/UnmappedBanner";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lookupSP500Weight } from "@/lib/sp500-weights";
import { lookupQQQWeight } from "@/lib/qqq-weights";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer, ReferenceLine,
} from "recharts";

export const Route = createFileRoute("/_authenticated/sp500")({
  head: () => ({ meta: [{ title: "S&P 500 Compare — Portfolio Tracker" }] }),
  component: SP500Compare,
});

type SP500SortKey = "symbol" | "weightPct" | "benchmark" | "diff" | "status";
type SortConfig = { key: SP500SortKey; dir: "asc" | "desc" } | null;

type BenchmarkKey = "SPY" | "QQQ";
const BENCHMARKS: Record<BenchmarkKey, { label: string; shortLabel: string; lookup: (s: string) => number }> = {
  SPY: { label: "S&P 500",     shortLabel: "S&P 500",    lookup: lookupSP500Weight },
  QQQ: { label: "NASDAQ 100",  shortLabel: "NASDAQ 100", lookup: lookupQQQWeight  },
};

const TICK = { fontSize: 11, fill: "currentColor" };
const TOOLTIP_STYLE = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

const PORTFOLIO_COLOR = "#0ea5e9"; // sky-500   — PALETTE[2], same everywhere
const BENCH_COLOR     = "#94a3b8"; // slate-400 — muted benchmark
const CHART_GAIN      = "#10b981"; // emerald   — PALETTE[1], same everywhere
const CHART_LOSS      = "#E41C38"; // crimson   — PALETTE[0], same everywhere

function statusOrder(benchmark: number, diff: number): number {
  if (benchmark === 0) return 0; // sorts to end
  return diff > 0 ? 2 : 1;
}

function buildRows(holdings: any[], lookup: (s: string) => number) {
  return holdings.map((h) => {
    const benchmark = lookup(h.symbol);
    const diff = h.weightPct - benchmark;
    return { ...h, benchmark, diff } as typeof h & { benchmark: number; diff: number };
  });
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="w-3 h-3 opacity-30 shrink-0" />;
  return dir === "desc"
    ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
    : <ChevronUp className="w-3.5 h-3.5 shrink-0" />;
}

function SortHead({
  label, sortKey, sort, onSort, className,
}: {
  label: string; sortKey: SP500SortKey; sort: SortConfig;
  onSort: (k: SP500SortKey) => void; className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <TableHead
      className={cn("cursor-pointer select-none hover:text-foreground", className)}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <SortIcon active={active} dir={sort?.dir ?? "desc"} />
      </span>
    </TableHead>
  );
}

const Y_AXIS_W = 52;
const CHART_TOP = 12;
const CHART_BOTTOM = 12; // outer margin only; XAxis height is additional below this
const X_AXIS_H = 72;    // XAxis height={X_AXIS_H} consumes space inside the inner chart area
const SCROLLBAR_CLS =
  "[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

/**
 * Round-number tick values that cover [min, max] with 3–7 ticks.
 * The returned array always satisfies ticks[0] <= min and ticks[last] >= max,
 * so using [ticks[0], ticks[last]] as the chart domain guarantees that the
 * Recharts bar scale and the SVG tick positions are driven by the same endpoints.
 */
function computeNiceTicks(min: number, max: number): number[] {
  const range = max - min;
  if (range === 0) return [min];
  const rawStep = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step =
    [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => range / s >= 3 && range / s <= 6) ??
    5 * mag;
  // For negative min, floor to the tick boundary below min (preserves symmetry for diff chart)
  const start = min >= 0
    ? Math.ceil((min + 1e-9) / step) * step
    : Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step * 0.001; t = Math.round((t + step) * 10000) / 10000) {
    ticks.push(t);
    if (ticks.length > 10) break;
  }
  // Include 0 when the domain spans it
  if (min <= 0 && max >= 0 && !ticks.some((t) => Math.abs(t) < 1e-6)) {
    const idx = ticks.findIndex((t) => t > 1e-6);
    if (idx >= 0) ticks.splice(idx, 0, 0);
    else ticks.push(0);
  }
  // Extend by one step if last tick still falls below max (e.g. 8 < 8.86 → add 10)
  if (ticks.length > 0 && ticks[ticks.length - 1] < max - 1e-6) {
    ticks.push(Math.round((ticks[ticks.length - 1] + step) * 10000) / 10000);
  }
  return ticks;
}

/**
 * Pure-SVG Y-axis — uses the identical linear formula Recharts uses for bar heights:
 *   y = topMargin + chartH * (1 - (value - domainMin) / domainRange)
 * This guarantees pixel-perfect alignment with bars regardless of any Recharts
 * internal padding or scale-rounding behavior.
 */
function CustomYAxis({
  height, topMargin, bottomMargin, domain, tickFormatter, width,
}: {
  height: number; topMargin: number; bottomMargin: number;
  domain: [number, number]; tickFormatter: (v: number) => string; width: number;
}) {
  const [min, max] = domain;
  const chartH = height - topMargin - bottomMargin;
  const ticks = computeNiceTicks(min, max);

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {ticks.map((tick, i) => {
        const label = tickFormatter(tick);
        if (!label) return null;
        const y = topMargin + chartH * (1 - (tick - min) / (max - min));
        const baseline = y >= topMargin + chartH - 7 ? "auto" : y <= topMargin + 7 ? "hanging" : "middle";
        return (
          <g key={i}>
            <line x1={width - 4} x2={width} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
            <text x={width - 7} y={y} textAnchor="end" dominantBaseline={baseline} fontSize={11} fill="currentColor">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Bar chart with a frozen left Y-axis.
 * Left panel = pure SVG. Right panel = scrollable Recharts BarChart.
 * Grid lines use explicit horizontalPoints (same SVG formula as CustomYAxis) so
 * they land at identical pixel positions as the tick labels — no Recharts tick
 * inference involved.
 */
function FrozenYAxisScrollChart({
  data, height, itemWidth, yDomain, yTickFormatter, children,
}: {
  data: any[];
  height: number;
  itemWidth: number;
  yDomain: [number, number];
  yTickFormatter: (v: number) => string;
  children: React.ReactNode;
}) {
  const minW = Math.max(data.length * itemWidth, 420);
  // domain is already snapped to tick boundaries, so tick range = domain.
  // Passing ticks to the hidden YAxis is safe: the scale Recharts computes
  // from ticks=[0,2,4,6,8,10] over domain=[0,10] is identical to the scale
  // my SVG uses, so bars and tick labels land on the same pixels.
  const ticks = computeNiceTicks(yDomain[0], yDomain[1]);

  return (
    <div className="flex" style={{ height }}>
      <div className="shrink-0 border-r border-border/30 text-muted-foreground" style={{ width: Y_AXIS_W }}>
        <CustomYAxis
          height={height}
          topMargin={CHART_TOP}
          bottomMargin={CHART_BOTTOM + X_AXIS_H}
          domain={yDomain}
          tickFormatter={yTickFormatter}
          width={Y_AXIS_W}
        />
      </div>

      <div className={`flex-1 min-w-0 overflow-x-auto overflow-y-hidden ${SCROLLBAR_CLS}`} style={{ height }}>
        <div style={{ minWidth: minW, height }}>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={{ top: CHART_TOP, right: 12, bottom: CHART_BOTTOM, left: 0 }}>
              <YAxis domain={yDomain} ticks={ticks} width={0} tick={false} tickLine={false} axisLine={false} />
              <XAxis
                dataKey="symbol"
                tick={{ ...TICK, angle: -45, textAnchor: "end" } as any}
                interval={0}
                height={72}
                tickLine={false}
                axisLine={false}
              />
              <CartesianGrid
                vertical={false}
                stroke="var(--color-border)"
                strokeDasharray="3 3"
              />
              {children}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function SP500Compare() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);
  const [sort, setSort] = useState<SortConfig>(null);
  const [benchmarkKey, setBenchmarkKey] = useState<BenchmarkKey>("SPY");
  const bench = BENCHMARKS[benchmarkKey];
  const { snapshot, unmapped } = usePortfolio(asOf);

  function handleSort(key: SP500SortKey) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }

  const baseRows = useMemo(
    () => buildRows(snapshot.holdings, bench.lookup),
    [snapshot.holdings, bench.lookup],
  );

  const rows = useMemo(() => {
    if (!sort) return [...baseRows].sort((a, b) => b.weightPct - a.weightPct);
    return [...baseRows].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sort.key === "status") {
        av = statusOrder(a.benchmark, a.diff);
        bv = statusOrder(b.benchmark, b.diff);
      } else {
        av = a[sort.key];
        bv = b[sort.key];
      }
      const cmp =
        typeof av === "string"
          ? av.localeCompare(bv as string)
          : (Number(av) > Number(bv) ? 1 : Number(av) < Number(bv) ? -1 : 0);
      return sort.dir === "desc" ? -cmp : cmp;
    });
  }, [baseRows, sort]);

  const totalInIndex = rows.filter((r) => r.benchmark > 0).reduce((s, r) => s + r.weightPct, 0);
  const totalOther   = rows.filter((r) => r.benchmark === 0).reduce((s, r) => s + r.weightPct, 0);

  // Index members first, non-members at end — within each group sorted by portfolio weight
  const groupedChartData = useMemo(() => {
    const inIndex  = rows.filter((r) => r.benchmark > 0).sort((a, b) => b.weightPct - a.weightPct);
    const outIndex = rows.filter((r) => r.benchmark === 0).sort((a, b) => b.weightPct - a.weightPct);
    return [...inIndex, ...outIndex].map((r) => ({
      symbol:      r.symbol,
      Portfolio:   parseFloat(r.weightPct.toFixed(2)),
      Benchmark:   parseFloat(r.benchmark.toFixed(2)),
      inIndex:     r.benchmark > 0,
    }));
  }, [rows]);

  const diffChartData = useMemo(() =>
    rows
      .filter((r) => r.benchmark > 0)
      .sort((a, b) => b.diff - a.diff)
      .map((r) => ({
        symbol: r.symbol,
        diff: parseFloat(r.diff.toFixed(2)),
      })),
    [rows],
  );

  // Portfolio chart: snap domain to nice tick boundaries so tick range = domain.
  // This eliminates any possible mismatch between the SVG axis scale and Recharts bar scale.
  const allGroupedVals = groupedChartData.flatMap((d) => [d.Portfolio, d.Benchmark]);
  const gMax = allGroupedVals.length ? Math.max(...allGroupedVals) : 10;
  const groupedTicks = computeNiceTicks(0, gMax * 1.15);
  const groupedDomain: [number, number] = [groupedTicks[0], groupedTicks[groupedTicks.length - 1]];

  // Diff chart: symmetric around 0 when mixed +/−; domain also snapped to tick range
  const allDiffs = diffChartData.map((d) => d.diff);
  const dMin = allDiffs.length ? Math.min(...allDiffs) : -1;
  const dMax = allDiffs.length ? Math.max(...allDiffs) : 1;
  let diffDomain: [number, number];
  if (dMin < -0.01) {
    const absMax = Math.max(Math.abs(dMin), Math.abs(dMax));
    const dt = computeNiceTicks(-absMax, absMax);
    diffDomain = [dt[0], dt[dt.length - 1]];
  } else {
    const dt = computeNiceTicks(0, dMax * 1.15);
    diffDomain = [dt[0], dt[dt.length - 1]];
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Index Comparison</h1>
          <p className="text-sm">
            Your allocation vs. approximate {bench.label} weights. Positive diff = overweight.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-lg border p-1 bg-muted/40">
            {(Object.keys(BENCHMARKS) as BenchmarkKey[]).map((k) => (
              <button
                key={k}
                onClick={() => { setBenchmarkKey(k); setSort(null); }}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  benchmarkKey === k
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k}
              </button>
            ))}
          </div>
          <AsOfDatePicker value={asOf} onChange={setAsOf} />
        </div>
      </div>

      <UnmappedBanner unmapped={unmapped} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider">In {bench.shortLabel}</div>
          <div className="text-xl font-semibold tabular-nums text-foreground mt-1.5">{totalInIndex.toFixed(1)}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider">Outside {bench.shortLabel}</div>
          <div className="text-xl font-semibold tabular-nums text-foreground mt-1.5">{totalOther.toFixed(1)}%</div>
        </Card>
      </div>

      {groupedChartData.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold mb-1 text-foreground">Portfolio vs. {bench.shortLabel}</h2>
          <p className="text-xs mb-4">{bench.shortLabel} members first, then outside-index holdings. Scroll to see all.</p>
          <div className="text-muted-foreground">
            <FrozenYAxisScrollChart
              data={groupedChartData}
              itemWidth={52}
              height={380}
              yDomain={groupedDomain}
              yTickFormatter={(v) => `${v}%`}
            >
              <Tooltip formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, name]} contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="Portfolio" fill={PORTFOLIO_COLOR} maxBarSize={22} />
              <Bar dataKey="Benchmark" name={bench.shortLabel} fill={BENCH_COLOR} maxBarSize={22} />
            </FrozenYAxisScrollChart>
          </div>
          <div className="flex items-center gap-4 mt-2" style={{ paddingLeft: Y_AXIS_W }}>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PORTFOLIO_COLOR }} />
              <span className="text-xs text-muted-foreground">Portfolio</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: BENCH_COLOR }} />
              <span className="text-xs text-muted-foreground">{bench.shortLabel}</span>
            </div>
          </div>
        </Card>
      )}

      {diffChartData.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold mb-1 text-foreground">Over / Underweight vs. {bench.shortLabel}</h2>
          <p className="text-xs mb-4">{bench.shortLabel} members only. Scroll to see all.</p>
          <div className="text-muted-foreground">
            <FrozenYAxisScrollChart
              data={diffChartData}
              itemWidth={46}
              height={300}
              yDomain={diffDomain}
              yTickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
            >
              <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1.5} />
              <Tooltip
                formatter={(v: number) => [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, "vs. S&P 500"]}
                contentStyle={TOOLTIP_STYLE}
              />
              <Bar dataKey="diff" maxBarSize={28}>
                {diffChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.diff >= 0 ? CHART_GAIN : CHART_LOSS} />
                ))}
              </Bar>
            </FrozenYAxisScrollChart>
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Symbol"         sortKey="symbol"    sort={sort} onSort={handleSort} />
              <SortHead label="Your Weight"    sortKey="weightPct" sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label={`${bench.shortLabel} Weight`} sortKey="benchmark" sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Difference"     sortKey="diff"      sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Status"         sortKey="status"    sort={sort} onSort={handleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  No holdings.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.symbol}>
                <TableCell className="font-medium text-foreground">{r.symbol}</TableCell>
                <TableCell className="text-right tabular-nums">{r.weightPct.toFixed(2)}%</TableCell>
                <TableCell className="text-right tabular-nums">{r.benchmark > 0 ? `${r.benchmark.toFixed(2)}%` : "—"}</TableCell>
                <TableCell className={cn("text-right tabular-nums font-medium", r.diff >= 0 ? "text-gain" : "text-loss")}>
                  {r.diff >= 0 ? "+" : ""}{r.diff.toFixed(2)}%
                </TableCell>
                <TableCell>
                  {r.benchmark === 0
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Not in index</span>
                    : r.diff > 0
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-gain/10 text-gain">Overweight</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-loss/10 text-loss">Underweight</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs">
        Benchmark weights are a static snapshot of the top holdings for the selected index (SPY / QQQ). Securities outside that tier show 0%.
      </p>
    </div>
  );
}
