import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { LineChart, Briefcase, Receipt, FileText, BarChart3, Upload, TrendingUp, Scissors, DollarSign, SlidersHorizontal, ChevronDown, BookOpen, BookMarked, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/ChatPanel";
import { AccountFilterProvider, useAccountFilter } from "@/lib/account-filter";
import { listAccounts } from "@/lib/transactions.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";

export const Route = createFileRoute("/_authenticated")({
  component: AppLayout,
});

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  search?: Record<string, string>;
};

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard",   label: "Dashboard",   icon: LineChart },
      { to: "/performance", label: "Performance", icon: TrendingUp },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { to: "/holdings",    label: "Holdings",    icon: Briefcase },
      { to: "/income",      label: "Income",      icon: DollarSign },
      { to: "/sp500",       label: "Indices",     icon: BarChart3 },
      { to: "/rebalancing", label: "Rebalancing", icon: SlidersHorizontal },
      { to: "/tax-loss",    label: "Tax Loss",    icon: Scissors },
    ],
  },
  {
    label: "Financials",
    items: [
      { to: "/financials", search: { tab: "capital" }, label: "Capital Statement",  icon: FileText },
      { to: "/financials", search: { tab: "income"  }, label: "Income Statement",   icon: TrendingUp },
      { to: "/financials", search: { tab: "balance" }, label: "Balance Sheet",      icon: Scale },
      { to: "/financials", search: { tab: "ledger"  }, label: "General Ledger",     icon: BookOpen },
      { to: "/financials", search: { tab: "coa"     }, label: "Chart of Accounts",  icon: BookMarked },
    ],
  },
  {
    label: "Data",
    items: [
      { to: "/transactions", label: "Transactions", icon: Receipt },
      { to: "/upload",       label: "Upload",       icon: Upload },
    ],
  },
];

function AccountSelector() {
  const { account, setAccount } = useAccountFilter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    staleTime: 30_000,
  });
  const accounts = accountsQ.data ?? [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function select(a: string | null) {
    setAccount(a);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["nav-history"] });
    qc.invalidateQueries({ queryKey: ["performance"] });
    qc.invalidateQueries({ queryKey: ["inception-date"] });
  }

  if (accounts.length === 0) return null;

  const label = account ?? "All accounts";

  return (
    <div ref={ref} className="relative px-3 pb-4">
      <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        Account
      </p>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/60"
      >
        <span className="flex-1 truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-3 right-3 z-50 mt-1 rounded-md border border-border bg-popover shadow-md overflow-hidden">
          <button
            onClick={() => select(null)}
            className={cn(
              "w-full text-left px-3 py-2 text-sm transition-colors",
              account === null
                ? "bg-primary/8 text-primary font-medium"
                : "text-foreground hover:bg-muted/60",
            )}
          >
            All accounts
          </button>
          {accounts.map((a) => (
            <button
              key={a}
              onClick={() => select(a)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors",
                account === a
                  ? "bg-primary/8 text-primary font-medium"
                  : "text-foreground hover:bg-muted/60",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AppLayout() {
  const location = useLocation();

  return (
    <AccountFilterProvider>
      <div className="h-screen flex overflow-hidden bg-background">
        <aside className="w-56 border-r border-sidebar-border bg-sidebar flex flex-col shrink-0">
          {/* Logo */}
          <div className="px-5 py-5 border-b border-sidebar-border">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <LineChart className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sm tracking-tight">Portfolio</span>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
            {navSections.map((section) => (
              <div key={section.label}>
                <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const searchParams = new URLSearchParams(location.search);
                    const active = item.search
                      ? location.pathname === item.to &&
                        Object.entries(item.search).every(([k, v]) => searchParams.get(k) === v)
                      : location.pathname.startsWith(item.to);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to + (item.search?.tab ?? "")}
                        to={item.to as any}
                        search={item.search as any}
                        className={cn(
                          "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
                          active
                            ? "text-primary font-medium bg-primary/6"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        )}
                      >
                        <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "")} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <AccountSelector />
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>

        <ChatPanel />
      </div>
    </AccountFilterProvider>
  );
}

