// POST /api/brief   body: { code, name, lang }
// Generates a factual, bilingual-ready company briefing using YOUR Anthropic API key.
// The key lives ONLY here, as a Vercel environment variable (ANTHROPIC_API_KEY).
// It is never sent to the browser / your dad's phone.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ error: true, reason: "no_key" }); return; }

  // Vercel parses JSON bodies automatically; fall back just in case.
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const code = (body && body.code) || "";
  const name = (body && body.name) || code;
  const lang = (body && body.lang) === "zh" ? "zh" : "en";
  const langName = lang === "zh" ? "Simplified Chinese" : "English";

  // Haiku is cheap and good for this. For richer writing set BRIEF_MODEL=claude-sonnet-4-6 in Vercel.
  const model = process.env.BRIEF_MODEL || "claude-haiku-4-5-20251001";

  const prompt =
`Use web search to research the SGX-listed company ${name} (SGX code ${code}). Write ALL text values in ${langName}.
Return ONLY a JSON object, no markdown, with keys:
"business" (1-3 sentences: what it does / main business segments),
"people" (array of up to 4 {"role":"Chairman / CEO / Major shareholder / etc","name":"name, with stake % if a shareholder"}; the key appointment holders AND the controlling or substantial shareholders — important for a small-cap investor),
"results" (latest reported revenue and net profit with year-on-year change, 1-2 sentences),
"financials" (array of up to 5 fiscal years, newest first, each {"year":"FY2025","revenue":"S$13.9B","profit":"S$7.3B","navps":"S$1.85","dividend":"S$0.99","roe":"12%"}; use null for any unknown field — NAV/share (navps) per year is the most important so include it whenever possible),
"dividend" (latest dividend per share and approximate yield in 1 sentence; null if none),
"divtrack" (one short phrase on dividend track record if notable, e.g. "Paid dividends 12 years running"; null),
"keydates" (next ex-dividend date and/or AGM date if known; short; null),
"outlook" (management guidance or sector outlook, 1-2 sentences),
"analyst" (a brief factual summary of recent analyst/broker ratings or target prices that have been publicly reported, e.g. "Several brokers rate it Buy, average target ~S$X"; report what analysts say, do NOT give your own recommendation; null if none found),
"insider" (any recent director or substantial-shareholder buying or selling that has been publicly disclosed, 1 sentence; null if none),
"navps" (net asset value / book value per share, short string like "S$1.85". If the company directly reports NAV / book value per share, use that figure. If it does NOT, CALCULATE it as net assets (shareholders' equity) divided by shares outstanding, and set "navpscalc" to true. Only use null if neither a reported figure nor the inputs to calculate it exist),
"navpscalc" (boolean — true ONLY when you calculated navps yourself from net assets ÷ shares rather than using a directly reported NAV/share; otherwise false),
"pb" (price-to-book ratio as a number-like string, e.g. "0.8"; null),
"totalassets" (total assets on the balance sheet, short e.g. "S$2.1B"; null),
"totalliab" (total liabilities on the balance sheet, short e.g. "S$0.7B"; null),
"netassets" (net assets / shareholders' equity / total book value, short e.g. "S$1.4B"; null),
"shares" (shares outstanding, short e.g. "1.21B"; null),
"netcash" (net cash or net debt position in one short phrase, e.g. "Net cash S$45m" or "Net debt S$120m"; null),
"pros" (array of 2-4 short factual positives),
"risks" (array of 2-4 short factual risks),
"mktcap","pe","yield","range52" (short strings, e.g. "S$130B" / "11.2" / "5.8%" / "38.10 - 48.90"; null if unknown).
Stay factual. Do NOT give buy, sell, or hold recommendations of your own.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 2200,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
      })
    });

    if (!r.ok) {
      const t = await r.text();
      res.status(200).json({ error: true, reason: "api", detail: t.slice(0, 300) });
      return;
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("\n");

    const o = text.indexOf("{"), c = text.lastIndexOf("}");
    let obj = null;
    if (o >= 0 && c >= 0) { try { obj = JSON.parse(text.slice(o, c + 1)); } catch (e) {} }

    if (!obj) { res.status(200).json({ error: true, reason: "parse" }); return; }

    // Strip citation tags the web-search step adds, so the app shows clean text.
    const strip = (s) => typeof s === "string"
      ? s.replace(/<\/?cite[^>]*>/gi, "").replace(/[ \t]+([,.;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim()
      : s;
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

    res.status(200).json(clean(obj));
  } catch (e) {
    res.status(200).json({ error: true, reason: "exception", detail: String(e).slice(0, 300) });
  }
};
