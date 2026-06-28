// POST /api/news   body: { code, name, lang }
// Live web search for the LATEST news on a counter — dated, with source and link.
// Uses YOUR Anthropic key (hidden here). Cached in the shared database for 6 hours
// so it loads fast and is shared across devices, while staying fresh. ?fresh=1 bypasses.

const NEWS_TTL = 60 * 60 * 6; // 6 hours, in seconds

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json([]); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const code = (body && body.code) || "";
  const name = (body && body.name) || code;
  const lang = (body && body.lang) === "zh" ? "zh" : "en";
  const langName = lang === "zh" ? "Simplified Chinese" : "English";
  const fresh = (req.query && req.query.fresh) || (body && body.fresh);

  const redis = getRedis();
  const cacheKey = "dadstocks:news:" + code + ":" + lang;
  if (redis && !fresh) {
    try { const hit = await redis.get(cacheKey); if (hit) { res.status(200).json(JSON.parse(hit)); return; } } catch (e) {}
  }

  const model = process.env.BRIEF_MODEL || "claude-haiku-4-5-20251001";

  const today = new Date().toISOString().slice(0, 10);
  const prompt =
`Today's date is ${today}. Use web search to find the LATEST news about the SGX-listed company ${name} (SGX code ${code}). Prioritise items from the last 7 days, newest first.
Write each headline in ${langName}.
Return ONLY a JSON array (no markdown, no commentary) of up to 6 items, each:
{"date":"YYYY-MM-DD","headline":"<short headline in ${langName}>","source":"<publication name>","url":"<direct link to the article from your search results, or null if you don't have a real link>"}
Only include genuine, recently published items, and only include a url if it came from your search results (never invent one). If there is nothing recent, return the few most recent items you can find.`;

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
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }]
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

    const strip = (s) => typeof s === "string" ? s.replace(/<\/?cite[^>]*>/gi, "").trim() : s;
    const out = arr
      .filter((x) => x && x.headline)
      .slice(0, 6)
      .map((x) => ({
        date: strip(x.date) || "",
        headline: strip(x.headline),
        source: strip(x.source) || "",
        url: (typeof x.url === "string" && /^https?:\/\//i.test(x.url)) ? x.url : null
      }));

    if (redis) { try { await redis.set(cacheKey, JSON.stringify(out), "EX", NEWS_TTL); } catch (e) {} }
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json([]);
  }
};
