# Portfolio Tracker

A self-hosted investment portfolio tracking app built for a single user. Reads broker export files (Excel or CSV), resolves holdings, fetches live prices from Yahoo Finance, and delivers analytics across performance, income, risk, and taxes — all from a local Electron desktop app with no cloud accounts or API keys required for core functionality.

> **Note:** Single-user, no auth. Whoever runs it has full access to the data. Designed to run locally on one machine.

---

## Features

### Dashboard
- Portfolio value over time (hybrid monthly/daily NAV chart)
- Holdings treemap with unrealized P&L coloring
- Allocation donut and sector breakdown
- Asset class bar chart
- Stat strip: total value, day change, portfolio beta, expected annual income

### Holdings
- Position table with avg cost, market value, unrealized P&L, beta, yield, and annual income
- Expandable tax lot rows (FIFO / HIFO toggle)

### Performance
- Time-weighted return (TWR) — removes distortion from contributions/withdrawals
- IRR (dollar-weighted, annualized)
- Benchmark overlay: S&P 500 or NASDAQ 100
- Sub-period breakdown table (one row per cash flow event)
- Performance attribution: $ gain/loss and contribution per position
- Risk metrics: annualized volatility, max drawdown, Sharpe ratio

### Income
- Dividend history per position pulled from Yahoo Finance
- TTM income, ex-dates, per-share amounts, shares held at record date

### Tax Loss Harvesting
- Full table sorted by largest unrealized loss
- Estimated tax savings at LT (20%) and ST (37%) rates
- Wash sale risk flag (buys within 30 days)

### Index Comparison
- Portfolio weight vs. S&P 500 or NASDAQ 100 weight, side by side

### Partner's Capital Statement
- Quarterly statement view with period selector
- One-click PDF export

### AI Chat
- Ask questions about the portfolio in plain English
- Answers grounded in live holdings, prices, and transaction history

### Upload
- Drag-and-drop Excel or CSV import
- Supports Fifth Third Securities Excel template and Fidelity CSV exports
- Auto-seeds CUSIP → ticker mappings; manual override via `/mappings`

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Bun v1.3.14 |
| Framework | TanStack Start v1.167 (Vite-native) + React 19 |
| Router | TanStack Router (file-based) |
| Database | `bun:sqlite` → `data/portfolio.db` (local, auto-created) |
| Styling | Tailwind v4 + shadcn/ui |
| Charts | Recharts |
| Excel parsing | SheetJS (client-side) |
| PDF export | jsPDF + jspdf-autotable |
| Prices | Yahoo Finance (no API key required) |
| AI | Anthropic Claude (Haiku) |
| Desktop | Electron 42 + electron-builder |

---

## Running locally (dev)

Requires [Bun](https://bun.sh) v1.3+.

```bash
git clone https://github.com/moff05/portfolio-tracker.git
cd portfolio-tracker
bun install
bun dev
```

Opens at `http://localhost:5173`. The SQLite database is created automatically at `data/portfolio.db` on first run.

**AI chat (dev mode):** Create a `.env` file in the project root:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Bun loads this automatically. Get a key at [console.anthropic.com](https://console.anthropic.com).

---

## AI chat (installed Electron app)

The installed app doesn't load `.env` files — set the key as a Windows environment variable instead:

1. Open **Start → search "environment variables" → Edit the system environment variables**
2. Click **Environment Variables…** → under **User variables**, click **New**
3. Variable name: `ANTHROPIC_API_KEY`
4. Variable value: your key (`sk-ant-...`)
5. Click OK → **fully close and reopen Portfolio Tracker**

The AI chat panel will work immediately after restart. Without the key set, the chat button is still visible but returns an error message.

To get an API key: [console.anthropic.com](https://console.anthropic.com) → sign up → API Keys → Create key. Usage is pay-as-you-go; the chat uses Claude Haiku which costs roughly $0.001 per conversation.

---

## Building the Electron installer

Run this command on the target platform — Electron apps must be built on the same OS they'll run on.

**Windows** — outputs `release/Portfolio Tracker Setup 1.0.0.exe`:
```bash
bun run electron:build
```

**macOS** — outputs `release/Portfolio Tracker-1.0.0.dmg`:
```bash
bun run electron:build
```

Drag the `.dmg` to Applications and open. macOS will warn "unidentified developer" since the app isn't Apple-signed — right-click → Open → Open anyway to bypass it.

No Bun or Node required on the target machine after installation.

---

## Data & privacy

- All data stays local. The SQLite database (`data/portfolio.db`) is gitignored and never leaves your machine.
- Prices are fetched from Yahoo Finance on demand and cached locally in the database.
- No telemetry, no accounts, no cloud sync.
- The `.env` file (API key) is gitignored.

---

## Architecture

```
src/
├── routes/_authenticated/
│   ├── dashboard.tsx       # NAV chart, treemap, allocation
│   ├── holdings.tsx        # Position table + tax lot rows
│   ├── performance.tsx     # TWR, IRR, attribution, risk
│   ├── income.tsx          # Dividend history
│   ├── tax-loss.tsx        # Harvesting list
│   ├── sp500.tsx           # Index comparison
│   ├── statement.tsx       # Partner's Capital Statement + PDF
│   ├── transactions.tsx    # Raw transaction list
│   ├── mappings.tsx        # CUSIP → ticker editor
│   └── upload.tsx          # File import
│
├── lib/
│   ├── portfolio.ts        # buildSnapshot() — average-cost holdings
│   ├── twr.ts              # TWR + IRR computation
│   ├── risk.ts             # Volatility, drawdown, Sharpe
│   ├── tax-lots.ts         # FIFO / HIFO lot tracking
│   ├── excel-import.ts     # Fifth Third Excel parser
│   ├── csv-import.ts       # Generic broker CSV parser
│   ├── prices.functions.ts # Yahoo Finance quotes + history
│   ├── performance.functions.ts # TWR server fn + NAV history
│   ├── db.server.ts        # SQLite schema + WAL setup
│   └── cusip-seed.ts       # Built-in CUSIP → ticker seed
│
electron/
│   ├── main.mjs            # Electron main process
│   └── server.mjs          # Embedded Bun server
```

---

## Accounting notes

- **Average-cost basis** across all lots (not lot-by-lot)
- BUY cost uses the statement's total cost figure, not `qty × price` (price can be $0 for funds)
- Capital statement formula: Ending Capital = Beginning Capital + Contributions − Distributions + Net Income
