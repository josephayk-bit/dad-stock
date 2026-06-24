// POST /api/photo   body: { image: "<base64>", mediaType: "image/jpeg", lang }
// Reads a photo (CDP statement, handwritten list, a name on paper) and returns the
// SGX counters it can recognize. Uses YOUR Anthropic key (hidden here).

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json([]); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const image = body && body.image;
  const mediaType = (body && body.mediaType) || "image/jpeg";
  if (!image) { res.status(200).json([]); return; }

  const model = process.env.BRIEF_MODEL || "claude-haiku-4-5-20251001";

  const prompt =
`This image may be a CDP (Central Depository) statement of Singapore shareholdings, a handwritten list, a screenshot, or a stock name written on paper.
Identify every counter listed on the Singapore Exchange (SGX) that you can recognize in the image.
Return ONLY a JSON array (no markdown, no commentary). Each item:
{"code":"<SGX trading code, e.g. D05>","en":"<English name>","zh":"<Simplified Chinese name>"}
Map each name to its correct current SGX code; use web search to confirm codes or names you are unsure about.
Ignore cash balances and anything not an SGX-listed counter. If you recognize nothing, return [].`;

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
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: prompt }
          ]
        }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
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
    const seen = {};
    const out = arr
      .filter((x) => x && x.code)
      .map((x) => ({ code: strip(String(x.code)).toUpperCase(), en: strip(x.en || x.code), zh: strip(x.zh || x.en || x.code) }))
      .filter((x) => (seen[x.code] ? false : (seen[x.code] = true)));

    res.status(200).json(out);
  } catch (e) {
    res.status(200).json([]);
  }
};
