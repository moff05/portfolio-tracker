import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useRef, useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/use-portfolio";
import { AsOfDatePicker } from "@/components/AsOfDatePicker";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/portfolio";
import { getSector, getAssetClass } from "@/lib/sector";
import { getNavHistory } from "@/lib/performance.functions";
import { useAccountFilter } from "@/lib/account-filter";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  Treemap, AreaChart, Area, type TooltipProps,
} from "recharts";
import { PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Portfolio Tracker" }] }),
  component: Dashboard,
});

// ─── Single ranked palette ───────────────────────────────────────────────────
// Priority order: RED → GREEN → BLUE → then supporting colors.
// Same hex everywhere — never substitute.
const PALETTE = [
  "#E41C38", // 1. crimson  — brand red
  "#10b981", // 2. emerald  — gain / positive
  "#0ea5e9", // 3. sky      — your data / blue
  "#f59e0b", // 4. amber
  "#8b5cf6", // 5. violet
  "#06b6d4", // 6. cyan
  "#ec4899", // 7. pink
  "#f97316", // 8. orange
];

const TICK = { fontSize: 11, fill: "currentColor" };
const RADIAN = Math.PI / 180;

const TOOLTIP_STYLE = {
  background: "#fff",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(999);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setWidth(ref.current.offsetWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return width;
}

// Treemap color scale — 8 vivid levels, no near-black extremes
function plBgFg(pct: number): { bg: string; fg: string } {
  if (pct >= 10) return { bg: "#047857", fg: "#d1fae5" }; // emerald-700
  if (pct >= 5)  return { bg: "#10b981", fg: "#ecfdf5" }; // emerald-500
  if (pct >= 2)  return { bg: "#6ee7b7", fg: "#064e3b" }; // emerald-300
  if (pct >= 0)  return { bg: "#d1fae5", fg: "#065f46" }; // emerald-100
  if (pct >= -2) return { bg: "#fee2e2", fg: "#991b1b" }; // red-100
  if (pct >= -5) return { bg: "#fca5a5", fg: "#7f1d1d" }; // red-300
  if (pct >= -10)return { bg: "#ef4444", fg: "#fff"    }; // red-500
  return           { bg: "#b91c1c",      fg: "#fff"    }; // red-700
}

function TreemapContent(props: any) {
  const { x, y, width, height, name, pct, depth } = props;
  if (depth !== 1 || !name || width < 4 || height < 4) return null;
  const { bg, fg } = plBgFg(pct ?? 0);
  const isTiny  = width < 32 || height < 26;
  const isSmall = width < 52 || height < 40;
  if (isTiny) {
    return <rect x={x+1} y={y+1} width={Math.max(0,width-2)} height={Math.max(0,height-2)} fill={bg} rx={4} />;
  }
  const fontSize = Math.min(13, Math.max(9, (width / Math.max(name.length, 2)) * 1.5));
  return (
    <g>
      <rect x={x+1} y={y+1} width={Math.max(0,width-2)} height={Math.max(0,height-2)} fill={bg} rx={6} />
      <text x={x+width/2} y={y+height/2+(isSmall?1:-9)} textAnchor="middle" dominantBaseline="middle"
        fill={fg} fontSize={fontSize} fontWeight="600" fontFamily="system-ui,-apple-system,sans-serif">
        {name}
      </text>
      {!isSmall && (
        <text x={x+width/2} y={y+height/2+9} textAnchor="middle" dominantBaseline="middle"
          fill={fg} fontSize={10} opacity={0.85} fontFamily="system-ui,-apple-system,sans-serif">
          {pct >= 0 ? "+" : ""}{(pct ?? 0).toFixed(1)}%
        </text>
      )}
    </g>
  );
}

function TreemapTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload as { name: string; pct: number; pl: number; value: number };
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-lg pointer-events-none">
      <div className="font-semibold text-foreground mb-1">{d.name}</div>
      <div className={cn("tabular-nums font-medium", d.pct >= 0 ? "text-gain" : "text-loss")}>
        {d.pct >= 0 ? "+" : ""}{d.pct?.toFixed(2)}% unrealized
      </div>
      <div className="tabular-nums text-foreground">{formatMoney(d.pl ?? 0)}</div>
      <div className="text-muted-foreground mt-0.5">{formatMoney(d.value)} mkt val</div>
    </div>
  );
}

// Pie slice label — draws its own connector line so Recharts never renders a dangling
// line for sub-threshold slices (which happens when labelLine is a prop but label returns null).
function PieSliceLabel({ cx, cy, midAngle, outerRadius, name, portfolioPct }: any) {
  if ((portfolioPct ?? 0) < 2.0) return null;
  const labelR = outerRadius + 22;
  const lineR  = outerRadius + 5;
  const lx = cx + labelR * Math.cos(-midAngle * RADIAN);
  const ly = cy + labelR * Math.sin(-midAngle * RADIAN);
  const sx = cx + lineR  * Math.cos(-midAngle * RADIAN);
  const sy = cy + lineR  * Math.sin(-midAngle * RADIAN);
  const anchor = lx > cx ? "start" : "end";
  return (
    <g>
      <line x1={sx} y1={sy} x2={lx} y2={ly} stroke="var(--color-muted-foreground)" strokeWidth={1} />
      <text x={lx} y={ly-5} textAnchor={anchor} fontSize={10} fontWeight={600} fill="var(--color-foreground)">{name}</text>
      <text x={lx} y={ly+7} textAnchor={anchor} fontSize={9} fill="var(--color-muted-foreground)">{(portfolioPct ?? 0).toFixed(1)}%</text>
    </g>
  );
}

function fmtNavDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function NavTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      <div className="text-muted-foreground text-xs mb-1">{fmtNavDate(label)}</div>
      <div className="font-semibold text-foreground tabular-nums">{formatMoney(payload[0].value)}</div>
    </div>
  );
}

type NavPeriod = "1D" | "1W" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "10Y" | "All";

function filterNavSeries(series: { date: string; value: number }[], period: NavPeriod) {
  if (period === "All" || series.length === 0) return series;
  const today = new Date().toISOString().slice(0, 10);
  const cutoff =
    period === "1D"  ? new Date(Date.now() -          86400_000).toISOString().slice(0, 10) :
    period === "1W"  ? new Date(Date.now() -      7 * 86400_000).toISOString().slice(0, 10) :
    period === "6M"  ? new Date(Date.now() -    180 * 86400_000).toISOString().slice(0, 10) :
    period === "YTD" ? `${today.slice(0, 4)}-01-01` :
    period === "1Y"  ? new Date(Date.now() -    365 * 86400_000).toISOString().slice(0, 10) :
    period === "3Y"  ? new Date(Date.now() -  3*365 * 86400_000).toISOString().slice(0, 10) :
    period === "5Y"  ? new Date(Date.now() -  5*365 * 86400_000).toISOString().slice(0, 10) :
                       new Date(Date.now() - 10*365 * 86400_000).toISOString().slice(0, 10);
  return series.filter((p) => p.date >= cutoff);
}

function NavChart({ series }: { series: { date: string; value: number }[] }) {
  const [period, setPeriod] = useState<NavPeriod>("1Y");
  const periods: NavPeriod[] = ["1D", "1W", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "All"];
  const data = useMemo(() => filterNavSeries(series, period), [series, period]);
  if (data.length < 2) return null;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Portfolio Value Over Time</h2>
        <div className="flex gap-1 rounded-lg border p-0.5 bg-muted/40">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                period === p
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={fmtNavDate} tick={TICK} tickLine={false} axisLine={false} minTickGap={48} />
          <YAxis
            tickFormatter={(v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}K`}
            tick={TICK} tickLine={false} axisLine={false} width={56}
          />
          <Tooltip content={<NavTooltip />} />
          <Area type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} fill="url(#navGrad)" dot={false} activeDot={{ r: 4, fill: "#0ea5e9" }} />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);
  const { snapshot, txns, isLoading, portfolioBeta, annualIncomeProjection } = usePortfolio(asOf);
  const { account } = useAccountFilter();

  const navQ = useQuery({
    queryKey: ["nav-history", account ?? "all"],
    queryFn: () => getNavHistory({ data: { account } }),
    staleTime: 10 * 60_000,
  });
  const navSeries = navQ.data ?? [];

  const pieRef     = useRef<HTMLDivElement>(null);
  const sectorRef  = useRef<HTMLDivElement>(null);
  const pieWidth    = useContainerWidth(pieRef);
  const sectorWidth = useContainerWidth(sectorRef);
  const showPieLabels    = pieWidth > 290;
  const showSectorLabels = sectorWidth > 290;

  // ── Treemap ──────────────────────────────────────────────────────────────
  const treemapData = snapshot.holdings
    .filter(h => h.marketValue > 0)
    .map(h => ({ name: h.symbol, value: h.marketValue, pct: h.unrealizedPLPct, pl: h.unrealizedPL }));

  // ── Allocation donut (top 12) ─────────────────────────────────────────────
  const allocationData = snapshot.holdings.slice(0, 12).map(h => ({
    name: h.symbol,
    value: h.marketValue,
    portfolioPct: h.weightPct, // actual % of full portfolio
  }));
  const smallAllocSlices = allocationData.filter(d => (d.portfolioPct ?? 0) < 2.0);

  // ── Sector allocation ─────────────────────────────────────────────────────
  const sectorData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of snapshot.holdings) {
      const s = getSector(h.symbol);
      map[s] = (map[s] ?? 0) + h.marketValue;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({
        name,
        value,
        portfolioPct: snapshot.totalMarketValue > 0 ? (value / snapshot.totalMarketValue) * 100 : 0,
      }));
  }, [snapshot.holdings, snapshot.totalMarketValue]);

  const smallSectorSlices = sectorData.filter(d => d.portfolioPct < 2.0);

  // ── Asset class ───────────────────────────────────────────────────────────
  const assetClassData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of snapshot.holdings) {
      const cls = getAssetClass(h.symbol);
      map[cls] = (map[cls] ?? 0) + h.marketValue;
    }
    if (snapshot.cash > 0) map["Cash"] = (map["Cash"] ?? 0) + snapshot.cash;
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({
        name,
        value,
        portfolioPct: total > 0 ? (value / total) * 100 : 0,
      }));
  }, [snapshot.holdings, snapshot.cash]);

  // ── Monthly income ────────────────────────────────────────────────────────
  const incomeByMonth = useMemo(() => {
    const months: { month: string; label: string; Dividends: number; Interest: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      months.push({ month: key, label: d.toLocaleDateString("en-US", { month: "short" }), Dividends: 0, Interest: 0 });
    }
    for (const t of txns) {
      if (t.action !== "DIVIDEND" && t.action !== "INTEREST") continue;
      const entry = months.find(m => m.month === t.trade_date.slice(0, 7));
      if (!entry) continue;
      const amt = Number(t.amount ?? 0);
      if (t.action === "DIVIDEND") entry.Dividends += amt;
      else entry.Interest += amt;
    }
    return months.map(m => ({ ...m, Dividends: +m.Dividends.toFixed(2), Interest: +m.Interest.toFixed(2) }));
  }, [txns]);

  const totalIncome = incomeByMonth.reduce((s, m) => s + m.Dividends + m.Interest, 0);
  const isGain = snapshot.unrealizedGain >= 0;

  return (
    <div className="p-6 lg:p-8 space-y-5 text-muted-foreground">

      {/* ── Header stats ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">Portfolio Value</p>
          <p className="text-4xl font-bold tracking-tight tabular-nums text-foreground">
            {isLoading ? "—" : formatMoney(snapshot.totalMarketValue)}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-[15px]">
            <span>
              <span className={cn("font-semibold tabular-nums", isGain ? "text-gain" : "text-loss")}>
                {isGain ? "+" : ""}{formatMoney(snapshot.unrealizedGain)}
              </span>
              <span className="ml-1 text-muted-foreground">unrealized</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span>
              <span className="font-semibold tabular-nums text-foreground">{formatMoney(totalIncome)}</span>
              <span className="ml-1 text-muted-foreground">income</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span className="text-muted-foreground">{snapshot.holdings.length} positions</span>
          </div>
        </div>
        <AsOfDatePicker value={asOf} onChange={setAsOf} />
      </div>

      {/* ── NAV history chart ── */}
      {navSeries.length >= 2 && (
        <NavChart series={navSeries} />
      )}

      {/* ── Treemap hero ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground">Unrealized P/L by Position</h2>
          <span className="text-xs">sized by market value · hover for details</span>
        </div>
        <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ height: 480 }}>
          {treemapData.length === 0 ? <EmptyState height={480} /> : (
            <ResponsiveContainer width="100%" height={480}>
              <Treemap data={treemapData} dataKey="value" nameKey="name" content={<TreemapContent />}>
                <Tooltip content={<TreemapTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          )}
        </div>
        {/* Gradient key */}
        <div className="flex items-center gap-2 mt-2 px-0.5">
          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">≤ −10%</span>
          <div className="flex-1 h-1.5 rounded-l-full"
            style={{ background: "linear-gradient(to right, #b91c1c, #ef4444, #fca5a5, #fee2e2)" }} />
          <span className="text-[10px] text-muted-foreground/50 shrink-0 px-0.5">0</span>
          <div className="flex-1 h-1.5 rounded-r-full"
            style={{ background: "linear-gradient(to right, #d1fae5, #6ee7b7, #10b981, #047857)" }} />
          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">≥ +10%</span>
        </div>
      </div>

      {/* ── Row 1: Allocation + Monthly Income ── */}
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-foreground">Allocation</h2>
            <span className="text-xs">Top 12 by position</span>
          </div>
          {allocationData.length === 0 ? <EmptyState height={240} /> : (
            <div ref={pieRef}>
              <ResponsiveContainer width="100%" height={showPieLabels ? 260 : 200}>
                <PieChart>
                  <Pie data={allocationData} dataKey="value" nameKey="name"
                    outerRadius={showPieLabels ? 82 : 88} innerRadius={showPieLabels ? 48 : 52}
                    paddingAngle={2} strokeWidth={0}
                    label={showPieLabels ? PieSliceLabel : undefined}
                    labelLine={false}
                  >
                    {allocationData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, name: string) => [formatMoney(v), name]} contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              {(!showPieLabels || smallAllocSlices.length > 0) && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  {(showPieLabels ? smallAllocSlices : allocationData).map((d) => {
                    const i = allocationData.findIndex(a => a.name === d.name);
                    return (
                      <div key={d.name} className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="text-xs truncate text-muted-foreground">{d.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Monthly Income</h2>
            <p className="text-xs mt-0.5">
              <span className="text-foreground tabular-nums font-semibold">{formatMoney(totalIncome)}</span>
              {" "}last 12 months
            </p>
          </div>
          {incomeByMonth.every(m => m.Dividends === 0 && m.Interest === 0) ? <EmptyState height={200} /> : (
            <div className="text-muted-foreground">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={incomeByMonth} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ ...TICK, fontSize: 10 } as any} interval={1} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={TICK} width={40} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number, n: string) => [formatMoney(v), n]} contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {/* PALETTE[0]=crimson, PALETTE[1]=orange — warm, income-themed */}
                  <Bar dataKey="Dividends" stackId="i" fill={PALETTE[1]} maxBarSize={28} />
                  <Bar dataKey="Interest"  stackId="i" fill={PALETTE[2]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 2: Sector + Asset Class ── */}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-foreground">Sector Allocation</h2>
            <span className="text-xs">{sectorData.length} sectors</span>
          </div>
          {sectorData.length === 0 ? <EmptyState height={240} /> : (
            <div ref={sectorRef}>
              <ResponsiveContainer width="100%" height={showSectorLabels ? 260 : 200}>
                <PieChart>
                  <Pie data={sectorData} dataKey="value" nameKey="name"
                    outerRadius={showSectorLabels ? 82 : 88} innerRadius={showSectorLabels ? 48 : 52}
                    paddingAngle={2} strokeWidth={0}
                    label={showSectorLabels ? PieSliceLabel : undefined}
                    labelLine={false}
                  >
                    {sectorData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, name: string) => [formatMoney(v), name]}
                    contentStyle={TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
              {(!showSectorLabels || smallSectorSlices.length > 0) && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                  {(showSectorLabels ? smallSectorSlices : sectorData).map((d) => {
                    const i = sectorData.findIndex(s => s.name === d.name);
                    return (
                      <div key={d.name} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="text-xs text-muted-foreground">{d.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{d.portfolioPct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Asset Class</h2>
          {assetClassData.length === 0 ? <EmptyState height={180} /> : (
            <div className="space-y-3">
              {assetClassData.map((d, i) => (
                <div key={d.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                      <span className="text-foreground font-medium">{d.name}</span>
                    </div>
                    <div className="flex items-center gap-2 tabular-nums">
                      <span className="text-muted-foreground">{formatMoney(d.value)}</span>
                      <span className="font-semibold text-foreground w-10 text-right">{d.portfolioPct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${d.portfolioPct}%`, background: PALETTE[i % PALETTE.length] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Stat strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatChip label="Realized Gain"      value={formatMoney(snapshot.realizedGain)}  positive={snapshot.realizedGain >= 0} />
        <StatChip label="Dividend Income"    value={formatMoney(snapshot.dividendIncome)} positive />
        <StatChip label="Interest Income"    value={formatMoney(snapshot.interestIncome)} positive />
        <StatChip label="Cash"               value={formatMoney(snapshot.cash)} />
        <StatChip label="Exp. Annual Income" value={annualIncomeProjection > 0 ? formatMoney(annualIncomeProjection) : "—"} positive={annualIncomeProjection > 0} />
        <StatChip label="Portfolio Beta"     value={portfolioBeta != null ? portfolioBeta.toFixed(2) : "—"} />
      </div>
    </div>
  );
}

function StatChip({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums",
        positive == null ? "text-foreground" : positive ? "text-gain" : "text-loss")}>
        {value}
      </p>
    </Card>
  );
}

function EmptyState({ height = 240 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
      <div className="text-center">
        <PiggyBank className="w-8 h-8 mx-auto mb-2 opacity-20" />
        No positions yet — upload a file to get started.
      </div>
    </div>
  );
}
