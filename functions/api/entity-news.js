/* GET /api/entity-news?q=Jollibee
   Per-entity recent news. Primary: Google News RSS search (PH-localized).
   Fallback: GDELT DOC search — because Google News 503s/times out for unique
   queries from datacenter IPs. Client also shows feed-matched articles instantly. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "").trim();
  if (!q) return json({ articles: [] });
  let arts = await googleNews(q);
  let src = "google";
  if (!arts.length) { arts = await gdelt(q); src = "gdelt"; }
  return json({ articles: arts.slice(0, 15), source: src }, 200, arts.length ? 600 : 60);
}

async function googleNews(q) {
  const query = /\s/.test(q) ? `"${q}"` : q;
  const api = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-PH&gl=PH&ceid=PH:en`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(api, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, */*" }, signal: AbortSignal.timeout(7000) });
      if (r.ok) { const a = parseGN(await r.text()); if (a.length) return a; }
    } catch (e) { /* retry */ }
  }
  return [];
}

async function gdelt(q) {
  const api = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${q}"`)}&mode=ArtList&format=json&maxrecords=15&sort=DateDesc&timespan=21d`;
  try {
    const r = await fetch(api, { headers: { "User-Agent": "market-intel/1.0" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.articles || []).map(a => ({
      title: a.title, url: a.url, source: a.domain || "",
      date: (a.seendate || "").slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")
    })).filter(a => a.title && a.url);
  } catch (e) { return []; }
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
