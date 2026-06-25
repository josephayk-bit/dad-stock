// GET  /api/watchlist  -> { configured:true, watchlist:[...], custom:{...} }   (or {configured:false})
// POST /api/watchlist  body { watchlist:[...], custom:{...} }  -> saves the shared list
// Stores ONE shared list so every device (you + your dad) sees the same thing.
// Backed by Upstash Redis (Vercel "Redis" storage). No SDK needed — uses the REST API.

module.exports = async function handler(req, res) {
  const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const KEY = "dadstocks:list";

  if (!URL || !TOKEN) { res.status(200).json({ configured: false }); return; }

  async function cmd(arr) {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(arr)
    });
    if (!r.ok) throw new Error("redis " + r.status);
    return r.json(); // { result: ... }
  }

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const data = {
        watchlist: Array.isArray(body && body.watchlist) ? body.watchlist : [],
        custom: (body && body.custom) || {}
      };
      await cmd(["SET", KEY, JSON.stringify(data)]);
      res.status(200).json({ ok: true, configured: true });
      return;
    }

    const out = await cmd(["GET", KEY]);
    let data = { watchlist: [], custom: {} };
    if (out && out.result) { try { data = JSON.parse(out.result); } catch (e) {} }
    res.status(200).json({
      configured: true,
      watchlist: Array.isArray(data.watchlist) ? data.watchlist : [],
      custom: data.custom || {}
    });
  } catch (e) {
    res.status(200).json({ configured: false, error: String(e).slice(0, 200) });
  }
};
