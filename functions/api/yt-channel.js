/* GET /api/yt-channel?channelId=UC...
   Returns whether a YouTube channel is live and its latest upload, in ONE search
   call (snippet.liveBroadcastContent tells us live vs none). Needs YOUTUBE_API_KEY.
   Used by streams.html to embed the live stream, or the latest upload if not live. */
export async function onRequestGet({ request, env }) {
  const id = (new URL(request.url).searchParams.get("channelId") || "").trim();
  const key = env.YOUTUBE_API_KEY;
  if (!id) return json({ error: "channelId required" }, 400);
  if (!key) return json({ configured: false });
  const base = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&channelId=${encodeURIComponent(id)}&key=${key}`;
  try {
    // eventType=live finds an ONGOING broadcast even if it started days ago;
    // order=date gives the most recent regular upload for the not-live case.
    const [liveR, latestR] = await Promise.all([
      fetch(`${base}&eventType=live&maxResults=1`, { signal: AbortSignal.timeout(8000) }),
      fetch(`${base}&order=date&maxResults=3`, { signal: AbortSignal.timeout(8000) })
    ]);
    const liveD = liveR.ok ? await liveR.json() : { items: [] };
    const latestD = latestR.ok ? await latestR.json() : { items: [] };
    const liveItem = (liveD.items || []).find(i => i.id && i.id.videoId);
    const uploads = (latestD.items || []).filter(i => i.id && i.id.videoId);
    const latestItem = uploads.find(i => i.snippet.liveBroadcastContent === "none") || uploads[0];
    const ct = (liveItem || latestItem || {}).snippet ? (liveItem || latestItem).snippet.channelTitle : "";
    return json({
      configured: true, channelTitle: ct || "",
      live: liveItem ? { videoId: liveItem.id.videoId, title: decode(liveItem.snippet.title) } : null,
      latest: latestItem ? { videoId: latestItem.id.videoId, title: decode(latestItem.snippet.title), publishedAt: latestItem.snippet.publishedAt } : null
    }, 200, 900);
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
