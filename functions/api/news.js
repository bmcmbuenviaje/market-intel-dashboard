/* GET /api/news?days=7&q=&category=
   Aggregates RSS/Atom feeds from PH business-news outlets server-side (no CORS,
   no key, not rate-limited like GDELT). Returns recent articles with links.
   The feed list is overridden at runtime by public/data/news-sources.json if present. */
const DEFAULT_FEEDS = [
  ["BusinessWorld", "https://www.bworldonline.com/feed/"],
  ["Inquirer Business", "https://business.inquirer.net/feed"],
  ["BusinessMirror", "https://businessmirror.com.ph/feed/"],
  ["Philstar Business", "https://www.philstar.com/rss/business"],
  ["Manila Bulletin", "https://mb.com.ph/feed/"],
  ["Manila Times", "https://www.manilatimes.net/business/feed"],
  ["GMA Money", "https://data.gmanetwork.com/gno/rss/money/feed.xml"],
  ["Rappler Business", "https://www.rappler.com/business/feed/"]
];

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const days = Math.min(parseInt(u.searchParams.get("days") || "7", 10) || 7, 30);
  const q = (u.searchParams.get("q") || "").toLowerCase().trim();

  let feeds = DEFAULT_FEEDS;
  try {
    const r = await fetch(new URL("/data/news-sources.json", request.url));
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.feeds) && j.feeds.length) feeds = j.feeds.map(f => [f.source, f.url]); }
  } catch (e) { /* keep defaults */ }

  const results = await Promise.allSettled(feeds.map(([source, url]) => fetchFeed(source, url)));
  let items = [];
  results.forEach(r => { if (r.status === "fulfilled") items = items.concat(r.value); });

  const cutoff = Date.now() - days * 864e5;
  const seen = new Set();
  items = items
    .filter(a => a.url && a.title && !seen.has(a.url) && (seen.add(a.url), true))
    .filter(a => !a.ts || a.ts >= cutoff)
    .filter(a => !q || (a.title + " " + a.summary).toLowerCase().includes(q))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 80)
    .map(({ ts, ...rest }) => rest);

  return json({ articles: items, sources: feeds.length, count: items.length }, 200, 900);
}

async function fetchFeed(source, url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36", "Accept": "application/rss+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseFeed(xml, source);
  } catch (e) { return []; }
}

function parseFeed(xml, source) {
  const out = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of blocks) {
    let title = clean(tag(b, "title"));
    let link = stripCdata(tag(b, "link")).trim();
    if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (m) link = m[1]; }
    const rawDate = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const ts = rawDate ? Date.parse(rawDate) : NaN;
    const summary = clean(tag(b, "description") || tag(b, "summary") || "").slice(0, 220);
    // per-item <source> (Google News aggregator feeds carry the real outlet here)
    const sm = b.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const itemSource = sm ? clean(sm[1]) : source;
    if (sm && title.endsWith(" - " + itemSource)) title = title.slice(0, -(itemSource.length + 3));
    if (title && link) out.push({
      title, url: link, source: itemSource, summary,
      date: isNaN(ts) ? "" : new Date(ts).toISOString().slice(0, 10),
      ts: isNaN(ts) ? 0 : ts
    });
  }
  return out.slice(0, 12); // cap per source
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
function stripCdata(s) { return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&"); }
function clean(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}
function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
