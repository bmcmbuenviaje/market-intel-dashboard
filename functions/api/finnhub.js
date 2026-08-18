/* GET /api/finnhub?symbol=JFC.PS
   Company news via Finnhub. API key stays server-side in the FINNHUB_KEY env var
   (set in Cloudflare Pages > Settings > Environment variables). Never exposed to browser. */
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const symbol = (u.searchParams.get("symbol") || "").trim();
  const key = env.FINNHUB_KEY;
  if (!key) return json({ articles: [], error: "FINNHUB_KEY not configured" }, 200);
  if (!symbol) return json({ articles: [], error: "symbol required" }, 400);

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const api = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`;

  try {
    const r = await fetch(api);
    if (!r.ok) return json({ articles: [], error: "finnhub " + r.status }, 200);
    const data = await r.json();
    const articles = (data || []).slice(0, 40).map(a => ({
      title: a.headline, url: a.url, domain: a.source,
      date: new Date(a.datetime * 1000).toISOString().slice(0, 10), image: a.image
    }));
    return json({ articles }, 200, 900);
  } catch (e) {
    return json({ articles: [], error: String(e) }, 200);
  }
}

function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
