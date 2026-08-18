/* GET /api/social?q=Jollibee
   Free, ToS-compliant social listening over YouTube + Reddit.
   Keys via env: YOUTUBE_API_KEY, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET.
   Returns per-source recent mentions + counts + rough sentiment. Fails gracefully
   (configured:false) when a key is missing. NOTE: LinkedIn/Facebook are intentionally
   absent — no free/compliant API exists for their public posts. */
const RUA = "web:market-intel-dashboard:v1.0 (PH market intelligence tool)";

export async function onRequestGet({ request, env }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return json({ youtube: [], reddit: [], mentions: 0 });
  const [yt, rd] = await Promise.all([
    youtube(q, env.YOUTUBE_API_KEY),
    reddit(q, env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET)
  ]);
  const all = [...yt.items, ...rd.items];
  return json({
    youtube: yt.items, reddit: rd.items,
    mentions: all.length,
    sentiment: sentimentOf(all.map(x => x.title).join(" ")),
    configured: { youtube: yt.configured, reddit: rd.configured },
    errors: { youtube: yt.error || null, reddit: rd.error || null }
  }, 200, all.length ? 1800 : 120);
}

async function youtube(q, key) {
  if (!key) return { items: [], configured: false };
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=8` +
    `&relevanceLanguage=en&q=${encodeURIComponent(q)}&key=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { items: [], configured: true, error: "yt " + r.status };
    const d = await r.json();
    const items = (d.items || [])
      .filter(i => i.id && i.id.videoId)
      .map(i => ({
        title: decode(i.snippet.title), url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
        source: i.snippet.channelTitle, date: (i.snippet.publishedAt || "").slice(0, 10)
      }));
    return { items, configured: true };
  } catch (e) { return { items: [], configured: true, error: String(e) }; }
}

async function reddit(q, id, secret) {
  if (!id || !secret) return { items: [], configured: false };
  try {
    const tr = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { "Authorization": "Basic " + btoa(`${id}:${secret}`), "content-type": "application/x-www-form-urlencoded", "User-Agent": RUA },
      body: "grant_type=client_credentials", signal: AbortSignal.timeout(8000)
    });
    if (!tr.ok) return { items: [], configured: true, error: "auth " + tr.status };
    const token = (await tr.json()).access_token;
    if (!token) return { items: [], configured: true, error: "no token" };
    const r = await fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=new&limit=10&type=link`, {
      headers: { "Authorization": "Bearer " + token, "User-Agent": RUA }, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return { items: [], configured: true, error: "reddit " + r.status };
    const d = await r.json();
    const items = (d.data && d.data.children || []).map(c => c.data).map(p => ({
      title: decode(p.title), url: "https://www.reddit.com" + p.permalink,
      source: "r/" + p.subreddit, date: new Date((p.created_utc || 0) * 1000).toISOString().slice(0, 10),
      score: p.score
    }));
    return { items, configured: true };
  } catch (e) { return { items: [], configured: true, error: String(e) }; }
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
