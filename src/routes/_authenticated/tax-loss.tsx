import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { buildLots } from "@/lib/tax-lots";
import { SortHead, useSortable, sortRows } from "@/components/SortHead";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tax-loss")({
  head: () => ({ meta: [{ title: "Tax-Loss Harvesting — Portfolio Tracker" }] }),
  component: TaxLossPage,
});

const LT_RATE = 0.20;
const ST_RATE = 0.37;

type LotMethod = "FIFO" | "HIFO";

function TaxLossPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [method, setMethod] = useState<LotMethod>("FIFO");
  const { snapshot, txns, isLoading } = usePortfolio(today);

  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const recentBuySymbols = useMemo(() => {
    const set = new Set<string>();
    for (const t of txns) {
      if (t.action === "BUY" && t.trade_date >= thirtyDaysAgo) {
        set.add((t.symbol ?? "").toUpperCase());
      }
    }
    return set;
  }, [txns, thirtyDaysAgo]);

  const { holdingsBySymbol } = useMemo(
    () => buildLots(txns, method, today),
    [txns, method, today],
  );

  // Per-position loss breakdown by holding period
  const candidates = useMemo(() => {
    return snapshot.holdings
      .filter((h) => h.unrealizedPL < 0)
      .map((h) => {
        const lots = holdingsBySymbol[h.symbol] ?? [];
        let ltLoss = 0;
        let stLoss = 0;
        for (const lot of lots) {
          const lotGain = (h.marketPrice - lot.costPerShare) * lot.qtyRemaining;
          if (lotGain < 0) {
            if (lot.holdingPeriod === "long") ltLoss += lotGain;
            else stLoss += lotGain;
          }
        }
        // If no lot data, fall back to aggregate unrealized P/L
        const hasLots = lots.length > 0;
        return {
          ...h,
          ltLoss: hasLots ? ltLoss : h.unrealizedPL,
          stLoss: hasLots ? stLoss : 0,
        };
      })
      .map((h) => ({ ...h, savings: Math.abs(h.ltLoss) * LT_RATE + Math.abs(h.stLoss) * ST_RATE }))
      .sort((a, b) => a.unrealizedPL - b.unrealizedPL);
  }, [snapshot.holdings, holdingsBySymbol]);

  const [sort, handleSort] = useSortable("unrealizedPL", "asc");
  const displayed = useMemo(() => sortRows(candidates as any[], sort), [candidates, sort]);

  const totalLoss = candidates.reduce((s, h) => s + h.unrealizedPL, 0);
  const totalLtLoss = candidates.reduce((s, h) => s + h.ltLoss, 0);
  const totalStLoss = candidates.reduce((s, h) => s + h.stLoss, 0);
  const ltSavings = Math.abs(totalLtLoss) * LT_RATE;
  const stSavings = Math.abs(totalStLoss) * ST_RATE;
  const totalSavings = ltSavings + stSavings;

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tax-Loss Harvesting</h1>
          <p className="text-sm mt-0.5">
            Positions with unrealized losses that could be sold to realize a tax deduction, then replaced with a similar (not substantially identical) security.
            Wash sale risk flags positions where you bought within the last 30 days.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5 bg-muted/40 text-xs">
          {(["FIFO", "HIFO"] as LotMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-colors",
                method === m
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
            Total Harvestable Loss
          </p>
          <p className="text-2xl font-bold tabular-nums text-loss">
            {isLoading ? "—" : formatMoney(totalLoss)}
          </p>
          <p className="text-xs mt-1">{candidates.length} positions</p>
        </Card>
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
            Long-Term Loss
          </p>
          <p className="text-2xl font-bold tabular-nums text-loss">
            {isLoading ? "—" : formatMoney(totalLtLoss)}
          </p>
          <p className="text-xs mt-1 text-gain">Est. saving: {isLoading ? "—" : formatMoney(ltSavings)} @ 20%</p>
        </Card>
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
            Short-Term Loss
          </p>
          <p className="text-2xl font-bold tabular-nums text-loss">
            {isLoading ? "—" : formatMoney(totalStLoss)}
          </p>
          <p className="text-xs mt-1 text-gain">Est. saving: {isLoading ? "—" : formatMoney(stSavings)} @ 37%</p>
        </Card>
        <Card className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
            Total Est. Tax Savings
          </p>
          <p className="text-2xl font-bold tabular-nums text-gain">
            {isLoading ? "—" : formatMoney(totalSavings)}
          </p>
          <p className="text-xs mt-1">blended LT/ST rate</p>
        </Card>
      </div>

      {candidates.length === 0 && !isLoading && (
        <Card className="p-10 text-center text-sm">
          No positions with unrealized losses as of today.
        </Card>
      )}

      {candidates.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Symbol"           sortKey="symbol"         sort={sort} onSort={handleSort} />
                <SortHead label="Market Value"     sortKey="marketValue"    sort={sort} onSort={handleSort} className="text-right" />
                <SortHead label="Unrealized Loss"  sortKey="unrealizedPL"   sort={sort} onSort={handleSort} className="text-right" />
                <SortHead label="LT Loss"          sortKey="ltLoss"         sort={sort} onSort={handleSort} className="text-right" />
                <SortHead label="ST Loss"          sortKey="stLoss"         sort={sort} onSort={handleSort} className="text-right" />
                <SortHead label="Loss %"           sortKey="unrealizedPLPct" sort={sort} onSort={handleSort} className="text-right" />
                <SortHead label="Est. Savings"     sortKey="savings"        sort={sort} onSort={handleSort} className="text-right" />
                <TableHead>Wash Sale Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((h) => {
                const washSale = recentBuySymbols.has(h.symbol);
                const savings = h.savings;
                return (
                  <TableRow key={h.symbol}>
                    <TableCell className="font-medium text-foreground">{h.symbol}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(h.marketValue)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-loss">
                      {formatMoney(h.unrealizedPL)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-loss">
                      {h.ltLoss < 0 ? formatMoney(h.ltLoss) : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-loss">
                      {h.stLoss < 0 ? formatMoney(h.stLoss) : <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-loss">
                      {h.unrealizedPLPct.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gain">
                      {formatMoney(savings)}
                    </TableCell>
                    <TableCell>
                      {washSale ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                          <AlertTriangle className="w-3 h-3" />
                          Recent buy
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">Clear</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="text-xs space-y-1 text-muted-foreground/70">
        <p>* {method} lot matching used to classify losses as long-term (&gt;1 year) or short-term (≤1 year). Toggle FIFO/HIFO above to see how lot selection method affects the breakdown.</p>
        <p>* Wash sale window: buys on or after {thirtyDaysAgo}. Selling and repurchasing within 31 days would disallow the loss.</p>
        <p>* Estimated savings: LT losses × 20% rate, ST losses × 37% rate. Actual rates depend on your total income and gain/loss picture for the year.</p>
        <p>* Not tax advice. Consult a tax advisor before executing any harvesting strategy.</p>
      </div>
    </div>
  );
}
