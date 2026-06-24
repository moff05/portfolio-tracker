import { Database } from "bun:sqlite";
const db = new Database("./data/portfolio.db");

console.log("Symbol mappings for SLND:");
const mappings = db.prepare("SELECT * FROM symbol_mappings WHERE ticker = 'SLND' OR cusip LIKE '%SLND%'").all() as any[];
for (const m of mappings) console.log(` cusip=${m.cusip} ticker=${m.ticker} name=${m.name}`);

console.log("\nAll SLND transactions:");
const txns = db.prepare("SELECT * FROM transactions WHERE symbol = 'SLND' ORDER BY trade_date").all() as any[];
for (const t of txns) console.log(`  ${t.trade_date} ${t.action} qty=${t.quantity} price=${t.price} amt=${t.amount} desc=${t.description}`);

// Also check what description/CUSIP the SLND BUY came from
console.log("\nAll transactions with 'SLND' in description or symbol:");
const all = db.prepare("SELECT trade_date, action, symbol, quantity, price, amount, description FROM transactions WHERE symbol LIKE '%SLND%' OR description LIKE '%SLND%' OR description LIKE '%SL %' ORDER BY trade_date").all() as any[];
for (const t of all) console.log(`  ${t.trade_date} ${t.action} sym=${t.symbol} qty=${t.quantity} amt=${t.amount} desc=${t.description}`);
