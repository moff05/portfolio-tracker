import { Database } from "bun:sqlite";
const db = new Database("./data/portfolio.db");

console.log("SLND prices (all cached):");
const slnd = db.prepare("SELECT as_of_date, close FROM price_cache WHERE symbol = 'SLND' ORDER BY as_of_date").all() as any[];
if (slnd.length === 0) console.log("  (none cached)");
for (const r of slnd) console.log(`  ${r.as_of_date}: $${r.close}`);

console.log("\nAll BUY transactions:");
const buys = db.prepare("SELECT trade_date, symbol, quantity, amount, price FROM transactions WHERE action = 'BUY' ORDER BY trade_date").all() as any[];
for (const b of buys) console.log(`  ${b.trade_date} ${b.symbol} qty=${b.quantity} amt=${b.amount} price=${b.price}`);
