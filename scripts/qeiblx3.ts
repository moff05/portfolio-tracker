// Hit Yahoo Finance directly to inspect raw dividend yield fields for mutual funds vs stocks
const symbols = ["EIBLX", "AAPL", "V", "APHFX", "SIGIX"];
const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}&fields=trailingAnnualDividendYield,dividendYield,dividendRate,trailingAnnualDividendRate,regularMarketPrice,quoteType`;

const res = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

console.log("HTTP status:", res.status);
const text = await res.text();
console.log("Raw response (first 2000 chars):", text.slice(0, 2000));
