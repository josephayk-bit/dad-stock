// GET  /api/watchlist  -> { configured:true, watchlist:[...], custom:{...} }  (or {configured:false})
// POST /api/watchlist  body { watchlist:[...], custom:{...} }  -> saves the shared list
// Works with either a REDIS_URL connection string (uses ioredis) OR a KV/Upstash REST pair.

let _client = undefined; // undefined = not tried yet, null = none, object = ioredis client

function getRedisClient() {
  if (_client !== undefined) return _client;
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.REDIS_URI;
  if (!url) { _client = null; return null; }
  try {
    const Redis = require("ioredis");
    const c = new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: true });
    c.on("error", () => {});
    _client = c;
    return c;
  } catch (e) { _client = null; return null; }
}

async function restCmd(arr) {
  const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(arr)
  });
  if (!r.ok) throw new Error("redis-rest " + r.status);
  return r.json();
}

module.exports = async function handler(req, res) {
  const KEY = "dadstocks:list";
  const useRest = !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
                     (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  const client = useRest ? null : getRedisClient();

  if (!useRest && !client) { res.status(200).json({ configured: false }); return; }

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const data = {
        watchlist: Array.isArray(body && body.watchlist) ? body.watchlist : [],
        custom: (body && body.custom) || {},
        manual: (body && body.manual) || {}
      };
      const val = JSON.stringify(data);
      if (useRest) await restCmd(["SET", KEY, val]); else await client.set(KEY, val);
      res.status(200).json({ ok: true, configured: true });
      return;
    }

    let raw = null;
    if (useRest) { const o = await restCmd(["GET", KEY]); raw = o && o.result; }
    else { raw = await client.get(KEY); }

    let data = { watchlist: [], custom: {}, manual: {} };
    if (raw) { try { data = JSON.parse(raw); } catch (e) {} }
    res.status(200).json({
      configured: true,
      watchlist: Array.isArray(data.watchlist) ? data.watchlist : [],
      custom: data.custom || {},
      manual: data.manual || {}
    });
  } catch (e) {
    res.status(200).json({ configured: false, error: String(e).slice(0, 200) });
  }
};
