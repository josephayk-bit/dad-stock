// POST /api/quotes  body { codes:[...], names:{...} }   (also GET ?codes=D05,O39)
// Primary source: SGX's own public securities feed. Fallback: Yahoo Finance.
// Debug: GET /api/quotes?debug=1  -> shows SGX response shape + a sample record.

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

  // Recursively locate the array of security records (objects that have a code field)
  function findRecords(obj, depth) {
    if (depth > 6 || obj == null) return null;
    if (Array.isArray(obj)) {
      if (obj.length && obj[0] && typeof obj[0] === "object" &&
          ("nc" in obj[0] || "n" in obj[0] || "code" in obj[0])) return obj;
      return null;
    }
    if (typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        const f = findRecords(obj[k], depth + 1);
        if (f && f.length) return f;
      }
    }
    return null;
  }

  async function fetchSgxOnce(paramStr) {
    const url = "https://api.sgx.com/securities/v1.1?excludetypes=bonds" + (paramStr ? "&params=" + encodeURIComponent(paramStr) : "");
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://www.sgx.com/" } });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    return { status: r.status, txt, j };
  }
  async function fetchSgxJson() {
    // canonical field list used by the SGX website itself
    const canonical = "nc,adjusted-vwap,b,bv,p,c,change_vs_pc,change_vs_pc_percentage,cx,cn,dp,dpc,du,ed,generic,iv,iv_protection,l,lt,ll,ltt,ltq,lo,o,pv,pts,s,sv,trading_time,v,vl,vwap,vwap-currency";
    let resp = await fetchSgxOnce(canonical);
    if (findRecords(resp.j, 0)) return resp;
    let resp2 = await fetchSgxOnce("nc,cn,lt,l,c,change_vs_pc,change_vs_pc_percentage,p,pv");
    if (findRecords(resp2.j, 0)) return resp2;
    return resp;
  }

  async function getSgxList() {
    if (SGX_CACHE.list && Date.now() - SGX_CACHE.at < 60000) return SGX_CACHE.list;
    const { j } = await fetchSgxJson();
    const list = findRecords(j, 0) || [];
    SGX_CACHE = { at: Date.now(), list };
    return list;
  }

  function sgxQuote(list, code) {
    const it = list.find((x) => x && String(x.nc || x.code || "").toUpperCase() === code.toUpperCase());
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
      const { status, txt, j } = await fetchSgxJson();
      const recs = findRecords(j, 0);
      res.status(200).json({
        ok: true,
        httpStatus: status,
        topKeys: (j && typeof j === "object") ? Object.keys(j) : null,
        foundRecords: recs ? recs.length : 0,
        sample: recs ? recs.slice(0, 2) : null,
        rawHead: recs ? null : txt.slice(0, 1200)
      });
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

  let list = null;
  try { list = await getSgxList(); } catch (e) { list = null; }

  async function one(code) {
    if (list && list.length) { try { const q = sgxQuote(list, code); if (q) return q; } catch (e) {} }
    try {
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
