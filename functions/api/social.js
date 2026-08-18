/* GET /api/social?q=Jollibee
   Free, ToS-compliant social listening. Sources:
   - YouTube Data API  (needs YOUTUBE_API_KEY)
   - Bluesky public search  (NO key — public AppView)
   - Hacker News (Algolia)  (NO key)
   - Reddit  (OAuth if REDDIT_CLIENT_ID/SECRET set, else best-effort public JSON)
   LinkedIn/Facebook are intentionally absent — no free/compliant API for their posts. */
const RUA = "web:market-intel-dashboard:v1.0 (PH market intelligence tool)";
const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export async function onRequestGet({ request, env }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return json({ mentions: 0 });
  const [yt, bs, hn, rd] = await Promise.all([
    youtube(q, env.YOUTUBE_API_KEY),
    bluesky(q, env.BLUESKY_IDENTIFIER, env.BLUESKY_APP_PASSWORD),
    hackernews(q),
    reddit(q, env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET)
  ]);
  const all = [...yt.items, ...bs.items, ...hn.items, ...rd.items];
  return json({
    youtube: yt.items, bluesky: bs.items, hackernews: hn.items, reddit: rd.items,
    mentions: all.length,
    sentiment: sentimentOf(all.map(x => x.title).join(" ")),
    configured: { youtube: yt.configured, reddit: rd.configured, bluesky: bs.configured, hackernews: true },
    errors: { youtube: yt.error || null, bluesky: bs.error || null, hackernews: hn.error || null, reddit: rd.error || null }
  }, 200, all.length ? 1800 : 120);
}

async function youtube(q, key) {
  if (!key) return { items: [], configured: false };
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=8&relevanceLanguage=en&q=${encodeURIComponent(q)}&key=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { items: [], configured: true, error: "yt " + r.status };
    const d = await r.json();
    const items = (d.items || []).filter(i => i.id && i.id.videoId).map(i => ({
      platform: "YouTube", title: decode(i.snippet.title), url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
      source: i.snippet.channelTitle, date: (i.snippet.publishedAt || "").slice(0, 10)
    }));
    return { items, configured: true };
  } catch (e) { return { items: [], configured: true, error: String(e) }; }
}

async function bluesky(q, ident, pass) {
  if (!ident || !pass) return { items: [], configured: false };
  try {
    const sr = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: ident, password: pass }), signal: AbortSignal.timeout(8000)
    });
    if (!sr.ok) return { items: [], configured: true, error: "bsky auth " + sr.status };
    const jwt = (await sr.json()).accessJwt;
    if (!jwt) return { items: [], configured: true, error: "bsky no token" };
    const r = await fetch(`https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=12`,
      { headers: { "Authorization": "Bearer " + jwt }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { items: [], configured: true, error: "bsky " + r.status };
    const d = await r.json();
    const items = (d.posts || []).map(p => ({
      platform: "Bluesky",
      title: decode(((p.record && p.record.text) || "").replace(/\s+/g, " ").slice(0, 160)),
      url: `https://bsky.app/profile/${p.author.handle}/post/${(p.uri || "").split("/").pop()}`,
      source: "@" + p.author.handle, date: ((p.record && p.record.createdAt) || p.indexedAt || "").slice(0, 10),
      score: p.likeCount
    })).filter(x => x.title);
    return { items, configured: true };
  } catch (e) { return { items: [], configured: true, error: String(e) }; }
}

async function hackernews(q) {
  try {
    const r = await fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=6`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { items: [], error: "hn " + r.status };
    const d = await r.json();
    const items = (d.hits || []).filter(h => h.title).map(h => ({
      platform: "HackerNews", title: decode(h.title),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "Hacker News", date: (h.created_at || "").slice(0, 10), score: h.points
    }));
    return { items };
  } catch (e) { return { items: [], error: String(e) }; }
}

async function reddit(q, id, secret) {
  // Preferred: OAuth client-credentials (if app keys provided)
  if (id && secret) {
    try {
      const tr = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa(`${id}:${secret}`), "content-type": "application/x-www-form-urlencoded", "User-Agent": RUA },
        body: "grant_type=client_credentials", signal: AbortSignal.timeout(8000)
      });
      if (tr.ok) {
        const token = (await tr.json()).access_token;
        if (token) {
          const r = await fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=new&limit=10&type=link`,
            { headers: { "Authorization": "Bearer " + token, "User-Agent": RUA }, signal: AbortSignal.timeout(8000) });
          if (r.ok) return { items: mapReddit(await r.json()), configured: true };
        }
      }
    } catch (e) { /* fall through to public */ }
  }
  // Workaround: keyless public JSON (best-effort; datacenter IPs are often blocked)
  try {
    const r = await fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=10`,
      { headers: { "User-Agent": BUA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { items: [], configured: false, error: "public " + r.status };
    return { items: mapReddit(await r.json()), configured: false };
  } catch (e) { return { items: [], configured: false, error: String(e) }; }
}
function mapReddit(d) {
  return ((d.data && d.data.children) || []).map(c => c.data).map(p => ({
    platform: "Reddit", title: decode(p.title), url: "https://www.reddit.com" + p.permalink,
    source: "r/" + p.subreddit, date: new Date((p.created_utc || 0) * 1000).toISOString().slice(0, 10), score: p.score
  }));
}

function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
const POS = ["surge", "record", "growth", "win", "launch", "partner", "expand", "best", "love", "great", "strong", "boost", "success"];
const NEG = ["loss", "cut", "decline", "ban", "fine", "probe", "lawsuit", "fraud", "weak", "drop", "scam", "fail", "boycott", "angry", "complaint"];
function sentimentOf(t) {
  t = (t || "").toLowerCase(); let s = 0;
  POS.forEach(w => { if (t.includes(w)) s++; }); NEG.forEach(w => { if (t.includes(w)) s--; });
  return Math.max(-100, Math.min(100, s * 15));
}
function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
