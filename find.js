// POST /api/find   body: { q, lang }
// Resolves a free-text query (Chinese, English, Singlish, partial, or spoken/phonetic)
// into the best-matching SGX-listed counters. Uses YOUR Anthropic key (hidden here).

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json([]); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const q = ((body && body.q) || "").toString().slice(0, 80).trim();
  if (!q) { res.status(200).json([]); return; }

  const model = process.env.BRIEF_MODEL || "claude-haiku-4-5-20251001";

  const prompt =
`A user is searching for a stock listed on the Singapore Exchange (SGX). Their query may be in Chinese, English, Singlish, a partial name, a ticker code, or a phonetic/spoken approximation.
Query: "${q}"

Return ONLY a JSON array (no markdown, no commentary) of up to 6 real SGX-listed counters that best match, most likely first. Each item:
{"code":"<SGX trading code, e.g. D05>","en":"<English name>","zh":"<Simplified Chinese name>"}

Rules: only genuine SGX-listed counters; if the query clearly names one company, still include 1-3 close alternatives the user might have meant; if you are unsure of a code or names, use web search to confirm; if nothing plausibly matches, return [].`;

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
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]
      })
    });

    if (!r.ok) { res.status(200).json([]); return; }
    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("\n");

    const o = text.indexOf("["), c = text.lastIndexOf("]");
    let arr = [];
    if (o >= 0 && c >= 0) { try { arr = JSON.parse(text.slice(o, c + 1)); } catch (e) {} }
    if (!Array.isArray(arr)) arr = [];

    // sanitize
    const strip = (s) => typeof s === "string" ? s.replace(/<\/?cite[^>]*>/gi, "").trim() : s;
    const out = arr
      .filter((x) => x && x.code)
      .slice(0, 6)
      .map((x) => ({ code: strip(String(x.code)).toUpperCase(), en: strip(x.en || x.code), zh: strip(x.zh || x.en || x.code) }));

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json([]);
  }
};
