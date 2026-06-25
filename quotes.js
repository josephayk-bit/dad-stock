// POST /api/quotes  body { codes:[...], names:{...} }   (also GET ?codes=D05,O39)
// Primary source: SGX's own public securities feed (no key, server-friendly).
// Fallback: Yahoo Finance. Returns [{code,price,change,changePct,ccy}].
// Debug: GET /api/quotes?debug=1  -> shows one raw SGX record so field names can be verified.

let SGX_CACHE = { at: 0, list: null };

module.exports = async function handler(req, res) {
  const round = (n) => (n == null || isNaN(n)) ? null : Math.round(n * 1000) / 1000;
  const num = (v) => {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? null : n;
  };
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
             "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

  // ---- SGX full-list (cached ~60s in warm instances) ----
  async function getSgxList() {
    if (SGX_CACHE.list && Date.now() - SGX_CACHE.at < 60000) return SGX_CACHE.list;
    const params = "nc,cn,lt,l,c,change_vs_pc,change_vs_pc_percentage,pv,p,o,h,lo,v,vl,vwap,trading_time,type,trading_currency,cur";
    const url = "https://api.sgx.com/securities/v1.1?excludetypes=bonds&params=" + encodeURIComponent(params);
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://www.sgx.com/" } });
    if (!r.ok) throw new Error("sgx " + r.status);
    const j = await r.json();
    const list = Array.isArray(j) ? j : (j.data || j.securities || j.prices || []);
    SGX_CACHE = { at: Date.now(), list };
    return list;
  }
  function sgxQuote(list, code) {
    const it = list.find((x) => x && String(x.nc || "").toUpperCase() === code.toUpperCase());
    if (!it) return null;
    const price = num(it.lt != null ? it.lt : (it.l != null ? it.l : (it.p != null ? it.p : it.last)));
    if (price == null) return null;
    return {
      code,
      price: round(price),
      change: round(num(it.c != null ? it.c : it.change_vs_pc)),
      changePct: round(num(it.change_vs_pc_percentage != null ? it.change_vs_pc_percentage : it.pc)),
      ccy: it.trading_currency || it.cur || "SGD"
    };
  }

  // ---- Yahoo fallback ----
  async function fetchMeta(sym) {
    for (const host of ["query1", "query2"]) {
      try {
        const url = "https://" + host + ".finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=1d&range=1d";
        const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
        if (!r.ok) continue;
        const j = await r.json();
        const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
        if (m && m.regularMarketPrice != null) return m;
      } catch (e) {}
    }
    return null;
  }

  // ---- debug ----
  if (req.query && req.query.debug) {
    try {
      const list = await getSgxList();
      const sample = list.slice(0, 3);
      res.status(200).json({ ok: true, count: list.length, sample });
    } catch (e) {
      res.status(200).json({ ok: false, error: String(e) });
    }
    return;
  }

  // ---- inputs ----
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

  // get SGX list once
  let list = null;
  try { list = await getSgxList(); } catch (e) { list = null; }

  async function one(code) {
    if (list) { const q = sgxQuote(list, code); if (q) return q; }       // SGX first
    try {                                                                // Yahoo fallback
      const sym = /\./.test(code) ? code : code + ".SI";
      const m = await fetchMeta(sym);
      if (m) {
        const price = m.regularMarketPrice;
        const prev = (m.chartPreviousClose != null) ? m.chartPreviousClose : m.previousClose;
        const change = (price != null && prev != null) ? price - prev : null;
        const pct = (change != null && prev) ? (change / prev) * 100 : null;
        return { code, price: round(price), change: round(change), changePct: round(pct), ccy: m.currency || "SGD" };
      }
    } catch (e) {}
    return { code, price: null, change: null, changePct: null, ccy: "SGD" };
  }

  try {
    const out = await Promise.all(codes.map(one));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
