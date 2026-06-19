import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { SortHead, useSortable, sortRows } from "@/components/SortHead";
import {
  ACTIONS,
  addTransaction,
  deleteAllTransactions,
  deleteTransaction,
  listTransactions,
} from "@/lib/transactions.functions";
import { useAccountFilter } from "@/lib/account-filter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({ meta: [{ title: "Transactions — Portfolio Tracker" }] }),
  component: TransactionsPage,
});

function actionBadge(action: string): string {
  switch (action) {
    case "BUY":          return "bg-sky-500/15 text-sky-500 dark:text-sky-400";
    case "SELL":         return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    case "DIVIDEND":     return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "INTEREST":     return "bg-teal-500/15 text-teal-600 dark:text-teal-400";
    case "CONTRIBUTION": return "bg-violet-500/15 text-violet-600 dark:text-violet-400";
    case "DISTRIBUTION": return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    case "FEE":          return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    default:             return "bg-muted text-muted-foreground";
  }
}

function TransactionsPage() {
  const qc = useQueryClient();
  const { account } = useAccountFilter();
  const q = useQuery({ queryKey: ["transactions", account ?? "all"], queryFn: () => listTransactions({ data: { account } }) });

  const [form, setForm] = useState({
    trade_date: new Date().toISOString().slice(0, 10),
    symbol: "",
    description: "",
    action: "BUY" as (typeof ACTIONS)[number],
    quantity: "0",
    price: "0",
    amount: "0",
    fees: "0",
  });

  const add = useMutation({
    mutationFn: (data: any) => addTransaction({ data }),
    onSuccess: () => {
      toast.success("Transaction added");
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteTransaction({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transactions"] }),
  });

  const wipe = useMutation({
    mutationFn: () => deleteAllTransactions(),
    onSuccess: () => {
      toast.success("All transactions deleted");
      qc.clear();
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    add.mutate({
      trade_date: form.trade_date,
      symbol: form.symbol.toUpperCase() || null,
      description: form.description || null,
      action: form.action,
      quantity: Number(form.quantity),
      price: Number(form.price),
      amount: Number(form.amount),
      fees: Number(form.fees),
    });
  }

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [sort, handleSort] = useSortable("trade_date");

  const filtered = useMemo(() => {
    let rows: any[] = q.data ?? [];
    if (actionFilter !== "ALL") rows = rows.filter((t) => t.action === actionFilter);
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      rows = rows.filter(
        (t) =>
          (t.symbol ?? "").toLowerCase().includes(term) ||
          (t.description ?? "").toLowerCase().includes(term),
      );
    }
    return rows;
  }, [q.data, actionFilter, search]);

  const txns = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  return (
    <div className="p-6 lg:p-8 space-y-6 text-muted-foreground">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Transactions</h1>
          <p className="text-sm">{q.data?.length ?? 0} entries</p>
        </div>
        {(q.data?.length ?? 0) > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 mr-1" /> Delete all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all transactions?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => wipe.mutate()}>Delete all</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Card className="p-5">
        <form onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 items-start">
          <Field label="Date">
            <Input type="date" value={form.trade_date} onChange={(e) => setForm({ ...form, trade_date: e.target.value })} required className="min-w-0 [&::-webkit-calendar-picker-indicator]:hidden" />
          </Field>
          <Field label="Action">
            <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v as any })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Symbol">
            <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="AAPL" />
          </Field>
          <Field label="Quantity">
            <Input type="number" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </Field>
          <Field label="Price">
            <Input type="number" step="any" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label="Amount">
            <Input type="number" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="Fees">
            <Input type="number" step="any" value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} />
          </Field>
          <div className="space-y-1">
            <Label className="text-xs opacity-0 select-none">x</Label>
            <Button type="submit" disabled={add.isPending} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
        </form>
      </Card>

      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol or description…"
            className="pl-8 pr-8 h-8 text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["ALL", ...ACTIONS] as const).map((a) => (
            <button
              key={a}
              onClick={() => setActionFilter(a)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors border",
                actionFilter === a
                  ? "bg-foreground text-background border-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent hover:border-border",
              )}
            >
              {a === "ALL" ? "All" : a}
            </button>
          ))}
        </div>
        {(search || actionFilter !== "ALL") && (
          <span className="text-xs text-muted-foreground">{txns.length} of {q.data?.length ?? 0}</span>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Date"        sortKey="trade_date" sort={sort} onSort={handleSort} />
              <SortHead label="Action"      sortKey="action"     sort={sort} onSort={handleSort} />
              <SortHead label="Symbol"      sortKey="symbol"     sort={sort} onSort={handleSort} />
              <TableHead>Description</TableHead>
              <SortHead label="Qty"         sortKey="quantity"   sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Price"       sortKey="price"      sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Amount"      sortKey="amount"     sort={sort} onSort={handleSort} className="text-right" />
              <SortHead label="Fees"        sortKey="fees"       sort={sort} onSort={handleSort} className="text-right" />
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {txns.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap tabular-nums">{t.trade_date}</TableCell>
                <TableCell>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${actionBadge(t.action)}`}>{t.action}</span>
                </TableCell>
                <TableCell className="font-medium text-foreground">{t.symbol ?? "—"}</TableCell>
                <TableCell className="max-w-[260px] truncate">{t.description ?? ""}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(t.quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(Number(t.price ?? 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(Number(t.amount ?? 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(Number(t.fees ?? 0))}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => del.mutate(t.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {txns.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No transactions yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
