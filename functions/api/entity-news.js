/* GET /api/entity-news?q=Jollibee
   Per-entity recent news via Google News RSS search (no key, PH-localized).
   Returns articles with the real outlet name and a link. */
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "").trim();
  if (!q) return json({ articles: [] });
  const query = /\s/.test(q) ? `"${q}"` : q; // quote multi-word names to reduce noise
  const api = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-PH&gl=PH&ceid=PH:en`;
  try {
    const r = await fetch(api, { headers: { "User-Agent": "Mozilla/5.0 market-intel/1.0" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return json({ articles: [], error: "news " + r.status });
    const xml = await r.text();
    return json({ articles: parseGN(xml).slice(0, 15) }, 200, 600);
  } catch (e) { return json({ articles: [], error: String(e) }); }
}

function parseGN(xml) {
  const out = [];
  for (const b of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    let title = clean(tag(b, "title"));
    const link = strip(tag(b, "link")).trim();
    const rawDate = tag(b, "pubDate");
    const ts = rawDate ? Date.parse(rawDate) : 0;
    const sm = b.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sm ? clean(sm[1]) : "Google News";
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    if (title && link) out.push({ title, url: link, source, date: ts ? new Date(ts).toISOString().slice(0, 10) : "", ts: isNaN(ts) ? 0 : ts });
  }
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(({ ts, ...r }) => r);
}
function tag(b, n) { const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? m[1] : ""; }
function strip(s) { return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&"); }
function clean(s) {
  return strip(s).replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}
function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
