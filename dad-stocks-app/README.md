# Dad's Stocks — setup guide

A bilingual (中文 / English), tap-first SGX watchlist for your dad: live-ish prices, AI company briefings, and a one-tap "make a note to send" for WhatsApp. Built to run as a real website he adds to his iPad/iPhone home screen.

---

## What's in this folder

```
dad-stocks-app/
├── index.html        the app (what your dad sees)
├── api/
│   ├── quotes.js      fetches SGX prices (Yahoo feed, server-side, no key)
│   ├── brief.js       writes the company briefings (uses YOUR Anthropic key)
│   ├── find.js        searches the whole SGX universe by name/code/voice (uses your key)
│   ├── photo.js       reads stock names from a photo / CDP statement (uses your key)
│   ├── news.js        pulls the latest dated news per counter, with source links (uses your key)
│   └── watchlist.js   the shared list, so you and your dad see the same stocks (uses a Vercel database)
└── README.md          this guide
```

## Shared watchlist (so you both see the same list)

By default each device keeps its own list. To make your additions appear on your dad's iPad, add a free Redis database:

1. In Vercel, top nav → **Storage** → **Create Database** → choose **Redis** (Upstash) from the Marketplace → pick the **free** plan → create.
2. **Connect** it to your **dad-stock** project (Storage → the database → Projects/Settings → Connect). This auto-adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to the project.
3. **Redeploy** (Deployments → latest → ⋯ → Redeploy).

Now the list lives on the server. Add a counter on your phone, and it shows up on your dad's iPad when he opens the app or taps **Refresh**. Until you add the database, the app still works — each device just keeps its own list.

Three ways to add a counter: type it, tap **🎤** and say the name (English or Chinese), or tap **📷 Add by photo** to snap a CDP statement / handwritten list and add the holdings it finds (with an "Add all"). On your dad's home-screen app, the most reliable mic is the **iPad keyboard's own 🎤** (tap the box first, then the keyboard mic).

Each briefing shows the **last 3 years' earnings** and any **analyst/professional views** publicly reported. The **Recent news** section is always pulled live, shows the date and source, and you can tap a headline to open the article — tap **↻** to re-check the very latest. So when he hears something, he can open the counter and verify it himself.

You don't need to edit any code to get it running. Editing is only for customizing later (see the end).

---

## Step 1 — Get an Anthropic API key (≈3 min)

This powers the AI briefings. Prices work without it; briefings need it.

1. Go to **console.anthropic.com** and sign in (this is the developer platform — separate from your normal Claude chat).
2. Add a small amount of credit under **Billing** (a few dollars is plenty — see Cost below).
3. Open **API keys → Create key**, name it `dad-stocks`, and copy the key. It starts with `sk-ant-...`.
4. Keep it somewhere safe for Step 3. **Treat it like a password — never paste it into the app or share it.**

---

## Step 2 — Put it on Vercel (≈10 min)

Vercel hosts the site and runs the two small functions, for free.

**Easiest route (Vercel CLI):**

1. Install Node.js if you don't have it, then in a terminal:
   ```
   npm install -g vercel
   ```
2. `cd` into this `dad-stocks-app` folder.
3. Run:
   ```
   vercel
   ```
   Log in when prompted, accept the defaults (it auto-detects the static site + `/api` functions). It gives you a URL like `https://dad-stocks-xxxx.vercel.app`.

**Or via GitHub:** push this folder to a GitHub repo → on vercel.com click **Add New → Project → Import** that repo → **Deploy**. Same result.

At this point **prices already work**, but briefings will say "needs your API key" until Step 3.

---

## Step 3 — Add your key to Vercel (≈2 min)

This is what keeps the key hidden on the server.

1. In your Vercel dashboard: **your project → Settings → Environment Variables**.
2. Add one:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** the `sk-ant-...` key from Step 1
3. Save, then **Deployments → ⋯ → Redeploy** (env vars only take effect after a redeploy).

Now open your URL, tap any stock — the briefing should fill in.

> Optional: for richer briefing writing, add another env var `BRIEF_MODEL` = `claude-sonnet-4-6` (a bit more per briefing). Default is Haiku, which is cheaper and fine.

---

## Step 4 — Put it on your dad's home screen (≈1 min)

On his iPad/iPhone, open the Vercel URL in **Safari**, then **Share → Add to Home Screen**. It now opens full-screen like a real app, with no browser bar. Do the same on your own phone so you can manage his list.

Tip: bookmark/save the URL for yourself too.

---

## Cost

Pay-as-you-go, billed to your Anthropic account. Prices (Yahoo) are free. A briefing is a few thousand tokens plus one web search — roughly **a couple of cents each**. For one dad checking a handful of counters daily, expect **about $1–2/month, often less**, and new accounts usually start with free credit. Briefings are cached per stock, so re-opening a stock doesn't re-charge.

---

## Customizing (optional)

All in `index.html`, near the top of the `<script>`:

- **Starter list:** edit `const SEED = [...]` (SGX codes).
- **The pick-list your dad/you choose from:** edit `const LIBRARY = [...]` — add any counter with its code + English + Chinese name.
- **Red/green direction:** `const MOVE_RED_IS_UP = true;` → `false` for the Western convention.

---

## Troubleshooting

- **A stock shows "—" for price:** its Yahoo ticker may differ from `CODE.SI`. Test `https://query1.finance.yahoo.com/v8/finance/chart/<CODE>.SI` in a browser; if empty, that counter needs a manual ticker mapping (tell me the code and I'll fix it).
- **Briefings say "needs your API key":** the env var isn't set or you didn't redeploy after adding it. Recheck Step 3.
- **All prices blank right after deploy:** wait a minute and tap **Refresh** — the edge cache warms up.
- **Want data straight from SGX** instead of Yahoo: see the `SGX_DIRECT` note at the bottom of `api/quotes.js`.

---

## Phase 2 — add stocks to his list *remotely* (later)

Right now the watchlist lives on each device. To let you add a stock on your phone and have it appear on his iPad, add a shared store:

1. In Vercel: **Storage → Create → KV** (free tier), connect it to the project. It auto-adds the connection env vars.
2. Add a tiny `api/watchlist.js` (GET to read, POST to write the shared list) backed by KV.
3. In `index.html`, swap the `watchlist` load/save from `localStorage` to calls to `/api/watchlist`.

That's a 20-minute follow-up — say the word and I'll write those two pieces so it drops straight in.
