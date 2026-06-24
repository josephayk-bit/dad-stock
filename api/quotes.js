// GET /api/quotes?codes=D05,O39,U11
// Fetches delayed SGX prices server-side (no CORS, no key needed).
// Source: Yahoo Finance chart feed. SGX code -> Yahoo ticker = CODE + ".SI".
//
// Want data straight from SGX instead? See the SGX_DIRECT note at the bottom.

module.exports = async function handler(req, res) {
  const round = (n) => (n == null || isNaN(n)) ? null : Math.round(n * 1000) / 1000;

  const codes = String(req.query.codes || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (!codes.length) { res.status(400).json({ error: "no codes" }); return; }

  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
             "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

  async function one(code) {
    const empty = { code, price: null, change: null, changePct: null, ccy: "SGD" };
    try {
      const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
                  encodeURIComponent(code) + ".SI?interval=1d&range=1d";
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) return empty;
      const j = await r.json();
      const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      if (!m) return empty;
      const price = m.regularMarketPrice;
      const prev = (m.chartPreviousClose != null) ? m.chartPreviousClose : m.previousClose;
      const change = (price != null && prev != null) ? price - prev : null;
      const pct = (change != null && prev) ? (change / prev) * 100 : null;
      return { code, price: round(price), change: round(change), changePct: round(pct), ccy: m.currency || "SGD" };
    } catch (e) {
      return empty;
    }
  }

  try {
    const out = await Promise.all(codes.map(one));
    // cache at the edge for 1 min so rapid refreshes don't hammer the source
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

/*
SGX_DIRECT (optional): to pull from SGX's own delayed feed instead of Yahoo,
replace the URL in one() with SGX's securities endpoint, e.g.:
  https://api.sgx.com/securities/v1.1/<CODE>
and map the returned fields (lt = last traded, c = change, etc.).
It is undocumented and can change without notice, which is why Yahoo is the default.
*/
