# 🛰️ Market & Sales Intelligence Platform

A zero-cost intelligence dashboard for **business development**. It fuses:

- **Brand partnerships & deals** (e.g. MLBB × Jollibee) — with source links
- **Corporate ownership** — parent companies, subsidiaries, sister brands
- **Consumer / news sentiment** (live news layer)
- **Geopolitics + macro + commodities** (extensible)

…onto an interactive **map** (Leaflet) and **relationship graph** (Cytoscape), with
filters for **Global / Region / Country** and **Category** (Food, Gaming, iGaming,
Beauty, Fintech, …). A **fusion engine** ranks BD targets and explains *why*.

The Intelligence panel has three tabs:
- **Targets** — brands ranked by buzz + sentiment + partnership-receptiveness.
- **Whitespace** — the inverse: brands with *no* deal yet whose rival already has one ("open, gettable" leads).
- **Watchlist** — star any brand (☆) to track it; **Generate digest** pulls each one's latest signal (and can auto-post to Slack/Discord).

The knowledge base ships with **~730 Philippine entities** across 12 categories
(food, FMCG, gaming, iGaming, beauty, retail, fintech, telco, media, hospitality,
conglomerates, regulators) and **~1,260 relationships**: ownership trees, sourced
partnerships, and a **direct / indirect / adjacent competitor web**. iGaming coverage
is deep (DigiPlus group + BingoPlus/ArenaPlus/GameZone/PeryaGame, PlayTime, OKBet,
every major casino/integrated resort) and hotels are covered as their own hospitality
category (Shangri-La, Seda, Go Hotels, Discovery, Peninsula, Megaworld, etc.). At this
scale the graph is a hairball at "Global/PH" scope — **filter by category or region**
to get a readable view; the map shows everything. Expand it via `admin.html` or by
editing `public/data/knowledge-base.json`.

> **Architecture note:** This is a static frontend (`public/`) + a tiny serverless
> proxy (`functions/api/*`) on **Cloudflare Pages**. The proxy exists because most
> free data APIs (GDELT, Yahoo Finance, Wikidata) **do not send CORS headers**, so a
> pure browser page cannot call them directly. The proxy also keeps API keys off the
> client. It's still 100% free (Cloudflare free tier = 100k req/day).

---

## What's live vs curated

| Layer | Source | Live? |
|---|---|---|
| Relationship graph (ownership, partnerships) | `public/data/knowledge-base.json` (curated, **sourced**) | Maintained by your team |
| News / signal feed | GDELT 2.0 via `/api/gdelt` | ✅ live |
| Commodities / tickers | Yahoo Finance via `/api/yahoo` | ✅ live |
| Ownership enrichment | Wikidata SPARQL via `/api/wikidata` | ✅ live |
| Company news | Finnhub via `/api/finnhub` (needs key) | ✅ live (optional) |
| Sentiment | keyword model on headlines (fallback) | ✅ derived |

The partnership/ownership graph is **curated on purpose** — no free API reliably knows
"Jollibee owns Chowking" or "MLBB partnered with Jollibee". Each edge can carry a
`url` + `verified` flag, so it's *real sourced data*, not mock data.

---

## Project layout

```
public/                 # static site (Cloudflare Pages output dir)
  index.html            # dashboard (password-gated)
  admin.html            # source toggles, connection tests, KB editor
  css/style.css
  js/
    config.js           # non-secret config + access hash
    gate.js             # client-side password gate
    data-fetcher.js     # local JSON + proxy calls
    filters.js          # scope/category filter state
    map.js  graph.js    # Leaflet + Cytoscape views
    fusion.js           # BD target scoring
    app.js              # orchestrator
  data/
    taxonomy.json       # categories, regions, relationship types
    knowledge-base.json # curated entities + relationships (PH seed)
functions/api/          # Cloudflare Pages Functions (the proxy)
  gdelt.js yahoo.js wikidata.js finnhub.js
  digest.js             # watchlist digest (+ optional webhook post)
  me.js                 # Cloudflare Access identity
worker-cron/            # optional scheduled-digest Worker (Cloudflare Cron)
  digest-worker.js  wrangler.toml
devserver.py            # local dev server (Python) — serves site + /api/* proxy, NO Node needed
wrangler.toml
```

---

## Run locally

**Option A — Python (no Node required).** You already have Python 3.
`devserver.py` serves `public/` *and* runs the same `/api/*` proxy locally:

```bash
python devserver.py
```

Opens `http://localhost:8788` with live GDELT / Yahoo / Wikidata working.
To enable Finnhub, set the key first:

```bash
set FINNHUB_KEY=your_key_here && python devserver.py     # Windows (cmd)
$env:FINNHUB_KEY="your_key_here"; python devserver.py     # Windows (PowerShell)
```

**Option B — Wrangler (needs Node.js).** Only if you want to test the actual
Cloudflare Functions runtime:

```bash
npm install
npx wrangler pages dev
```

Access code: **`conrad91`** (change it — see below).

> Notes: the curated relationship layer + live commodities render instantly; the
> news feed loads in the background and degrades gracefully if a source is
> rate-limited (GDELT and Wikidata rate-limit by IP). Philippine stock tickers
> (`*.PS`) are unreliable on Yahoo, so those stay as reference labels — commodity
> symbols (`GC=F`, `CL=F`, …) work fine.

---

## Deploy (free)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings: **Framework = None**, **Build command = (empty)**, **Output dir = `public`**.
   (`wrangler.toml` already sets `pages_build_output_dir = "public"`.)
4. Deploy. Your site is live at `https://<project>.pages.dev`.
5. (Optional) Add `FINNHUB_KEY` under **Settings → Environment variables** to enable Finnhub.

### Change the access code
The gate compares a SHA-256 hash. Generate a new one and paste into `ACCESS_HASH` in
`public/js/config.js`:

```bash
printf 'YOUR_NEW_CODE' | sha256sum
```

> ⚠️ The JS gate only hides the UI — anyone can read the source.

### Real security: Cloudflare Access (server-enforced, free ≤50 users)
The app already checks `/api/me` on load — if the site is behind Access, Cloudflare
injects the signed-in user's email and the app unlocks with **no prompt** (the JS code
gate becomes a local-dev fallback). To enable:

1. Cloudflare dashboard → **Zero Trust → Access → Applications → Add application → Self-hosted**.
2. Set the domain to your Pages URL (e.g. `market-intel-dashboard.pages.dev`).
3. Add a policy: Action **Allow**, include **Emails** (your team) or **Emails ending in** `@yourcompany.com`, or **One-time PIN**.
4. Save. Now every visitor authenticates with Cloudflare before the site loads; `/api/me` returns their email; the Logout button also clears the Access session (`/cdn-cgi/access/logout`).

### Watchlist digest (optional, free)
Set a Slack/Discord **incoming webhook** URL as `DIGEST_WEBHOOK` on the Pages project
(Settings → Environment variables). The **Generate digest** button then posts the
watchlist digest to that channel. For a **scheduled** daily digest, deploy the cron
worker in [`worker-cron/`](worker-cron/):

```bash
cd worker-cron
# edit wrangler.toml: DIGEST_TARGET (your pages URL) + WATCHLIST_IDS
npx wrangler deploy      # (needs Node for this optional piece)
```
The worker fires on its cron schedule and pings `/api/digest`, which posts to the webhook.

---

## Maintaining the knowledge base (live admin)

**`/admin.html`** is a full CRUD console backed by Cloudflare KV — edits save live for
everyone, no redeploy:

- **Companies & Brands** — search all entities; add / edit / delete any company or brand
- **Connections** — add / edit / delete relationships (owns / partner / competitor / regulates); deleting an entity cascades its edges
- **Import / Export** — paste or upload JSON (merge or replace); export the whole dataset
- **Settings & APIs** — data-source toggles, live connection tests, env-var checklist

The dashboard reads the KB from `/api/kb` (KV if present, else the bundled
`public/data/knowledge-base.json`). Saving from the admin `PUT`s to KV.

### One-time setup to enable live editing (free)
1. **Create a KV namespace:** Cloudflare dashboard → Storage & Databases → KV → Create → name it e.g. `market-intel-kb`.
2. **Bind it to the Pages project:** Pages project → Settings → Functions → KV namespace bindings → Add → **Variable name `KB_STORE`** → select the namespace.
3. **Set the admin token:** Pages project → Settings → Environment variables → add **`ADMIN_TOKEN`** = a strong secret. You'll type this into the admin's "Admin token" box to authorize a save.
4. Redeploy (or it applies on next deploy). Until KV is bound, the dashboard still works read-only from the bundled dataset; saves return a clear "KV not bound" message.

> Locally, `python devserver.py` uses `public/data/knowledge-base.json` as the KV stand-in, so admin edits persist straight to that file (no token needed unless you set `ADMIN_TOKEN`).

---

## Recommended next builds

- [x] **Whitespace finder** — Intelligence panel → Whitespace tab (`fusion.js`).
- [x] **Watchlist + digest** — star brands, Generate digest, optional Cloudflare Cron worker (`worker-cron/`).
- [x] **Commodities strip** — live via `/api/yahoo` (Gold, WTI, Brent, Copper, USD/PHP).
- [x] **Cloudflare Access wiring** — `/api/me` + gate auto-unlock.
- [x] **Category expansion (PH-first)** — ~170 entities across all 10 categories.
- [ ] **Entity alias resolution** — fuzzy news→entity matching (aliases exist; matching is still substring).
- [ ] **Real sentiment model** — swap the keyword fallback for a free sentiment endpoint via a new `/api/sentiment` proxy.
- [ ] **Weather / chokepoints** — add `/api/noaa` alerts + shipping-lane overlays.
- [ ] **CSV / CRM export** of BD targets and watchlist.
- [ ] **Source-verification pass** — flip remaining `verified:false` edges to true as citations are confirmed.

---

## Free data sources actually used

- **GDELT 2.0 DOC API** — global news, no key. https://api.gdeltproject.org
- **Yahoo Finance chart API** — quotes/commodities, no key (unofficial).
- **Wikidata SPARQL** — ownership graph, no key. https://query.wikidata.org
- **Finnhub** — company news, free key. https://finnhub.io
