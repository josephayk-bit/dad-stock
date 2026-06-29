// POST /api/brief   body: { code, name, lang }   -> bilingual company briefing (uses YOUR Anthropic key)
// GET  /api/brief?debug=CODE&lang=en              -> raw diagnostics (what the AI actually returned)
// Cached in the shared DB (Redis) 30 days; refreshes after 30 days, on BRIEF_VERSION bump, or ?fresh=1.

const BRIEF_VERSION = "v13";
const BRIEF_TTL = 60 * 60 * 24 * 30;

let _redis = undefined;
function getRedis() {
  if (_redis !== undefined) return _redis;
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.REDIS_URI;
  if (!url) { _redis = null; return null; }
  try {
    const Redis = require("ioredis");
    const c = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false, connectTimeout: 4000 });
    c.on("error", () => {});
    _redis = c; return c;
  } catch (e) { _redis = null; return null; }
}

function buildPrompt(name, code, langName) {
  return `Use web search to research the SGX-listed company ${name} (SGX code ${code}). Write ALL text values in ${langName}.
Return ONLY a JSON object, no markdown, with keys:
"business" (1-3 sentences: what it does / main business segments),
"people" (array of up to 4 {"role":"Chairman / CEO / Major shareholder / etc","name":"name, with stake % if a shareholder"}),
"results" (latest reported revenue and net profit with year-on-year change, 1-2 sentences),
"financials" (array of the last 5 fiscal years, newest first. You MUST return all 5 years with figures from the company's audited financial statements / annual reports (check SGX filings and annual reports directly). For EACH year include: "year"; "revenue"; "profit" (net profit); "navps" (NAV / book value per share that year); "netassets" (total shareholders' equity that year — the figure from the balance sheet); "dividend" (per share); "roe" (percent). navps is the MOST IMPORTANT field: navps = that year's total shareholders' equity divided by the total number of shares. Always provide netassets for every year. Example row: {"year":"FY2024","revenue":"S$140.7m","profit":"S$1.53m","navps":"S$0.42","netassets":"S$95m","dividend":"S$0.01","roe":"1.6%"}. Do the arithmetic; do not leave navps blank if you have equity and shares. Never fabricate — leave a field null only if the underlying figure is truly not in any filing),
"dividend" (latest dividend per share and approx yield, 1 sentence; null if none),
"divtrack" (short phrase on dividend track record if notable; null),
"divschedule" (array of EVERY dividend paid in the last 12 months, newest first — NOT only the latest; a quarterly payer has ~4, half-yearly ~2, plus any special. Each {"label","exdate":"YYYY-MM-DD","paydate":"YYYY-MM-DD","amount":"S$0.54"}. Real announced dates only; [] if non-payer),
"keydates" (next ex-dividend and/or AGM date if known; short; null),
"outlook" (management guidance or sector outlook, 1-2 sentences),
"analyst" (factual summary of publicly reported analyst ratings/targets; no recommendation of your own; null if none),
"insider" (recent disclosed director/substantial-shareholder buying or selling, 1 sentence; null),
"navps" (current NAV / book value per share, e.g. "S$1.85" — if not reported, calculate net assets / shares and set "navpscalc" true; null only if impossible),
"navpscalc" (boolean — true only if you calculated navps yourself),
"pb" (price-to-book ratio like "0.8"; null),
"totalassets","totalliab","netassets" (total assets / total liabilities / net assets i.e. shareholders' equity, short e.g. "S$2.1B"; null),
"shares" (shares outstanding, e.g. "234.06m" — REQUIRED, find this; it is needed to compute NAV/share),
"netcash" (net cash or net debt in one phrase; null),
"pros" (array of 2-4 short positives),
"risks" (array of 2-4 short risks),
"mktcap","pe","yield","range52" (short strings; null if unknown).
Stay factual. No buy/sell/hold recommendations of your own.`;
}

async function callModel(key, model, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }]
    })
  });
  const status = r.status;
  if (!r.ok) { return { status, text: await r.text(), obj: null }; }
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const o = text.indexOf("{"), c = text.lastIndexOf("}");
  let obj = null;
  if (o >= 0 && c >= 0) { try { obj = JSON.parse(text.slice(o, c + 1)); } catch (e) {} }
  return { status, text, obj };
}

module.exports = async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ error: true, reason: "no_key" }); return; }
  const model = process.env.BRIEF_MODEL || "claude-sonnet-4-6";

  const isDebug = req.method === "GET" && req.query && req.query.debug;

  // ---- DEBUG: show exactly what the AI returns for one stock ----
  if (isDebug) {
    const code = String(req.query.debug);
    const name = req.query.name || code;
    const lang = req.query.lang === "zh" ? "zh" : "en";
    const langName = lang === "zh" ? "Simplified Chinese" : "English";
    try {
      const { status, text, obj } = await callModel(key, model, buildPrompt(name, code, langName));
      const fin = (obj && Array.isArray(obj.financials)) ? obj.financials : [];
      res.status(200).json({
        code, httpStatus: status, parsedOK: !!obj,
        shares: obj && obj.shares, mktcap: obj && obj.mktcap, navps: obj && obj.navps,
        fin_years: fin.length,
        fin_navps: fin.map((f) => f && f.navps),
        fin_netassets: fin.map((f) => f && f.netassets),
        divschedule_count: (obj && Array.isArray(obj.divschedule)) ? obj.divschedule.length : 0,
        rawHead: (text || "").slice(0, 1500)
      });
    } catch (e) { res.status(200).json({ error: String(e) }); }
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const code = (body && body.code) || "";
  const name = (body && body.name) || code;
  const lang = (body && body.lang) === "zh" ? "zh" : "en";
  const langName = lang === "zh" ? "Simplified Chinese" : "English";
  const fresh = (req.query && req.query.fresh) || (body && body.fresh);

  const redis = getRedis();
  const cacheKey = "dadstocks:brief:" + BRIEF_VERSION + ":" + code + ":" + lang;
  if (redis && !fresh) {
    try { const hit = await redis.get(cacheKey); if (hit) { const obj = JSON.parse(hit); obj.cached = true; res.status(200).json(obj); return; } } catch (e) {}
  }

  try {
    const { status, text, obj } = await callModel(key, model, buildPrompt(name, code, langName));
    if (status !== 200) { res.status(200).json({ error: true, reason: "api", detail: (text || "").slice(0, 300) }); return; }
    if (!obj) { res.status(200).json({ error: true, reason: "parse" }); return; }

    const strip = (s) => typeof s === "string"
      ? s.replace(/<\/?cite[^>]*>/gi, "").replace(/[ \t]+([,.;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim() : s;
    const clean = (o) => {
      if (!o || typeof o !== "object") return o;
      const out = {};
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") out[k] = strip(v);
        else if (Array.isArray(v)) out[k] = v.map((x) => typeof x === "string" ? strip(x) : (x && typeof x === "object" ? clean(x) : x));
        else out[k] = v;
      }
      return out;
    };

    const result = clean(obj);

    // ---- guaranteed NAV calculation: fill any blank navps from equity / shares ----
    const parseAmt = (s) => { if (s == null) return null; let str = String(s); let m = 1;
      if (/亿/.test(str)) m = 1e8; else if (/万/.test(str)) m = 1e4;
      else if (/b/i.test(str)) m = 1e9; else if (/m/i.test(str)) m = 1e6; else if (/k/i.test(str)) m = 1e3;
      const n = parseFloat(str.replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n * m; };
    let shares = parseAmt(result.shares);
    if (!shares && result.netassets && result.navps) { const e = parseAmt(result.netassets), v = parseAmt(result.navps); if (e && v) shares = e / v; }
    if (Array.isArray(result.financials)) {
      result.financials.forEach((f) => {
        if (f && !f.navps && f.netassets && shares) { const e = parseAmt(f.netassets); if (e && shares > 0) { const per = e / shares; if (per > 0.001 && per < 100000) f.navps = "S$" + per.toFixed(2); } }
      });
    }
    if (!result.navps && result.netassets && shares) { const e = parseAmt(result.netassets); if (e && shares > 0) { result.navps = "S$" + (e / shares).toFixed(2); result.navpscalc = true; } }

    if (redis) { try { await redis.set(cacheKey, JSON.stringify(result), "EX", BRIEF_TTL); } catch (e) {} }
    res.status(200).json(result);
  } catch (e) {
    res.status(200).json({ error: true, reason: "exception", detail: String(e).slice(0, 300) });
  }
};
