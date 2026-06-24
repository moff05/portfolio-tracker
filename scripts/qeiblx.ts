import { Database } from "bun:sqlite";
const db = new Database("./data/portfolio.db");

console.log("=== EIBLX transactions ===");
const txns = db.prepare("SELECT trade_date, action, quantity, price, amount, description FROM transactions WHERE symbol = 'EIBLX' ORDER BY trade_date").all() as any[];
if (!txns.length) console.log("  (none)");
for (const t of txns) console.log(`  ${t.trade_date} ${t.action} qty=${t.quantity} price=${t.price} amt=${t.amount}  desc=${t.description}`);

console.log("\n=== EIBLX price cache (most recent 10) ===");
const prices = db.prepare("SELECT as_of_date, close FROM price_cache WHERE symbol = 'EIBLX' ORDER BY as_of_date DESC LIMIT 10").all() as any[];
if (!prices.length) console.log("  (none cached)");
for (const p of prices) console.log(`  ${p.as_of_date}: $${p.close}`);

console.log("\n=== Symbol mappings for EIBLX ===");
const maps = db.prepare("SELECT * FROM symbol_mappings WHERE ticker = 'EIBLX'").all() as any[];
if (!maps.length) console.log("  (none)");
for (const m of maps) console.log(`  cusip=${m.cusip} ticker=${m.ticker} name=${m.name}`);

// Net quantity still held (BUY - SELL)
const net = txns.reduce((s, t) => {
  const q = Number(t.quantity) || 0;
  if (t.action === "BUY") return s + q;
  if (t.action === "SELL") return s - q;
  return s;
}, 0);
console.log(`\nNet quantity held: ${net}`);

const latestPrice = prices[0];
if (latestPrice && net > 0) {
  console.log(`Latest price: $${latestPrice.close} on ${latestPrice.as_of_date}`);
  console.log(`Implied market value: $${(net * latestPrice.close).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
}

// Total cost basis (sum of BUY amounts)
const totalCost = txns.filter(t => t.action === "BUY").reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
console.log(`Total cost basis (BUY amounts): $${totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
