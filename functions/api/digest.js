/* GET /api/digest?ids=jfc,mlbb,gcash
   Builds a watchlist digest: latest signal per entity. If DIGEST_WEBHOOK env is
   set (Slack/Discord incoming webhook), also posts the digest there.
   Used both on-demand from the UI and by the scheduled worker (see worker-cron/). */
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const ids = (u.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 12);
  if (!ids.length) return json({ items: [], error: "no ids" });

  let kb;
  try { kb = await (await fetch(new URL("/data/knowledge-base.json", request.url))).json(); }
  catch (e) { return json({ items: [], error: "kb load failed" }); }
  const byId = Object.fromEntries(kb.entities.map(e => [e.id, e]));

  const items = [];
  for (const id of ids) {
    const e = byId[id];
    if (!e) continue;
    const art = await topArticle(e.name);
    items.push({ id, name: e.name, headline: art && art.title, url: art && art.url, domain: art && art.domain });
  }

  const generatedAt = new Date().toISOString();
  let posted = false;
  const hook = env.DIGEST_WEBHOOK;
  if (hook) {
    const text = `🗞️ *Watchlist digest* — ${generatedAt.slice(0, 10)}\n` +
      items.map(it => `• ${it.name}: ${it.headline ? it.headline + " " + it.url : "no new signals"}`).join("\n");
    try {
      await fetch(hook, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, text }) }); // content=Discord, text=Slack
      posted = true;
    } catch (e) { posted = false; }
  }
  return json({ generatedAt, items, posted });
}

async function topArticle(name) {
  const api = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  api.searchParams.set("query", `"${name}"`);
  api.searchParams.set("mode", "ArtList");
  api.searchParams.set("format", "json");
  api.searchParams.set("maxrecords", "3");
  api.searchParams.set("sort", "DateDesc");
  api.searchParams.set("timespan", "14d");
  try {
    const r = await fetch(api.toString(), { headers: { "User-Agent": "market-intel/1.0" } });
    if (!r.ok) return null;
    const a = (await r.json()).articles || [];
    return a[0] ? { title: a[0].title, url: a[0].url, domain: a[0].domain } : null;
  } catch (e) { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
