// POST /api/quotes  body: { codes:["D05",...], names:{ "D05":"DBS Group", ... } }
// (also accepts GET /api/quotes?codes=D05,O39)
// Fetches delayed SGX prices server-side. Strategy per counter:
//   1) try Yahoo CODE.SI on two hosts (with a retry)
//   2) if that fails, resolve the right Yahoo symbol by company name, then fetch
// Requests are throttled (3 at a time) so Yahoo doesn't rate-limit a burst.

module.exports = async function handler(req, res) {
  const round = (n) => (n == null || isNaN(n)) ? null : Math.round(n * 1000) / 1000;

  let codes = [], names = {};
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    codes = Array.isArray(body && body.codes) ? body.codes : [];
    names = (body && body.names) || {};
  } else {
    codes = String(req.query.codes || "").split(",");
  }
  codes = codes.map((s) => String(s).trim()).filter(Boolean);
  if (!codes.length) { res.status(400).json({ error: "no codes" }); return; }

  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
             "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

  async function fetchMeta(sym) {
    for (const host of ["query1", "query2", "query1"]) {   // 3 attempts across hosts
      try {
        const url = "https://" + host + ".finance.yahoo.com/v8/finance/chart/" +
                    encodeURIComponent(sym) + "?interval=1d&range=1d";
        const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
        if (!r.ok) continue;
        const j = await r.json();
        const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
        if (m && m.regularMarketPrice != null) return m;
      } catch (e) { /* next host */ }
    }
    return null;
  }

  async function resolveByName(name) {
    if (!name) return null;
    for (const host of ["query2", "query1"]) {
      try {
        const url = "https://" + host + ".finance.yahoo.com/v1/finance/search?q=" +
                    encodeURIComponent(name) + "&quotesCount=8&newsCount=0";
        const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
        if (!r.ok) continue;
        const j = await r.json();
        const qs = (j && j.quotes) || [];
        const hit = qs.find((x) => x && typeof x.symbol === "string" && x.symbol.toUpperCase().endsWith(".SI"));
        if (hit) return hit.symbol;
      } catch (e) { /* next host */ }
    }
    return null;
  }

  async function one(code) {
    const empty = { code, price: null, change: null, changePct: null, ccy: "SGD" };
    try {
      const sym = /\./.test(code) ? code : code + ".SI";
      let m = await fetchMeta(sym);
      if (!m) { const alt = await resolveByName(names[code]); if (alt) m = await fetchMeta(alt); }
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

  // limited concurrency so we don't trigger Yahoo's rate limit
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length); let i = 0;
    async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  try {
    const out = await mapLimit(codes, 3, one);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

/*
SGX_DIRECT (optional): to pull from SGX's own delayed feed instead of Yahoo,
replace fetchMeta with a call to SGX's securities endpoint and map its fields.
It is undocumented and can change without notice, which is why Yahoo is the default.
*/
