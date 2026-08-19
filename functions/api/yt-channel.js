/* GET /api/yt-channel?channelId=UC...
   Returns whether a YouTube channel is live and its latest upload, in ONE search
   call (snippet.liveBroadcastContent tells us live vs none). Needs YOUTUBE_API_KEY.
   Used by streams.html to embed the live stream, or the latest upload if not live. */
export async function onRequestGet({ request, env }) {
  const id = (new URL(request.url).searchParams.get("channelId") || "").trim();
  const key = env.YOUTUBE_API_KEY;
  if (!id) return json({ error: "channelId required" }, 400);
  if (!key) return json({ configured: false });
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=5` +
    `&channelId=${encodeURIComponent(id)}&key=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return json({ configured: true, error: "yt " + r.status });
    const d = await r.json();
    const vids = (d.items || []).filter(i => i.id && i.id.videoId).map(i => ({
      videoId: i.id.videoId, title: decode(i.snippet.title),
      live: i.snippet.liveBroadcastContent === "live", publishedAt: i.snippet.publishedAt
    }));
    const live = vids.find(v => v.live) || null;
    const latest = vids.find(v => !v.live) || vids[0] || null;
    return json({
      configured: true,
      channelTitle: (d.items[0] && d.items[0].snippet.channelTitle) || "",
      live: live ? { videoId: live.videoId, title: live.title } : null,
      latest: latest ? { videoId: latest.videoId, title: latest.title, publishedAt: latest.publishedAt } : null
    }, 200, 1800);
  } catch (e) { return json({ configured: true, error: String(e) }); }
}
function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
