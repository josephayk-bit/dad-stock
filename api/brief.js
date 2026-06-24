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
"results" (latest reported revenue and net profit with year-on-year change, 1-2 sentences),
"dividend" (latest dividend per share and approximate yield in 1 sentence; null if none),
"outlook" (management guidance or sector outlook, 1-2 sentences),
"news" (array of up to 4 recent news items, newest first, each {"date":"YYYY-MM","headline":"short headline"}),
"pros" (array of 2-4 short factual positives),
"risks" (array of 2-4 short factual risks),
"mktcap","pe","yield","range52" (short strings, e.g. "S$130B" / "11.2" / "5.8%" / "38.10 - 48.90"; null if unknown).
Stay factual. Do NOT give buy, sell, or hold recommendations.`;

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
        max_tokens: 1200,
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
    res.status(200).json(obj);
  } catch (e) {
    res.status(200).json({ error: true, reason: "exception", detail: String(e).slice(0, 300) });
  }
};
