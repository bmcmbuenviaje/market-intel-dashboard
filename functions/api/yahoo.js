/* GET /api/yahoo?symbol=GC=F  (commodities, tickers)
   Proxies Yahoo Finance chart API server-side. */
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const symbol = (u.searchParams.get("symbol") || "").trim();
  if (!symbol) return json({ error: "symbol required" }, 400);

  const api = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
  try {
    const r = await fetch(api, { headers: { "User-Agent": "Mozilla/5.0 market-intel" } });
    if (!r.ok) return json({ error: "yahoo " + r.status }, 200);
    const data = await r.json();
    const res = data?.chart?.result?.[0];
    if (!res) return json({ error: "no data" }, 200);
    const meta = res.meta || {};
    const closes = (res.indicators?.quote?.[0]?.close || []).filter(x => x != null);
    return json({
      symbol,
      price: meta.regularMarketPrice ?? null,
      currency: meta.currency ?? "",
      changePct: closes.length > 1 ? +(((closes.at(-1) - closes[0]) / closes[0]) * 100).toFixed(2) : null,
      series: closes
    }, 200, 900);
  } catch (e) {
    return json({ error: String(e) }, 200);
  }
}

function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
