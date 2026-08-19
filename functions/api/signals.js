/* User-submitted insight links.
   GET  /api/signals            -> stored submitted signals (from KV)
   POST /api/signals {url,...}  -> fetch the page, extract OpenGraph metadata,
                                   store it, return the enriched signal.
   Auto-connection to entities happens client-side (name/alias match) once the
   signal is merged into the live feed. Stored in KB_STORE under "submitted-signals". */
const KEY = "submitted-signals";
const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export async function onRequest({ request, env }) {
  const store = env.KB_STORE;
  if (request.method === "GET") {
    if (!store) return json({ signals: [] });
    const v = await store.get(KEY);
    return json({ signals: v ? JSON.parse(v) : [] });
  }
  if (request.method === "POST") {
    if (!store) return json({ error: "KV not bound (bind KB_STORE)" }, 501);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid JSON" }, 400); }
    const url = (body.url || "").trim();
    if (!/^https?:\/\/.+/i.test(url)) return json({ error: "a valid http(s) URL is required" }, 400);

    const meta = await enrich(url);
    const sig = {
      id: "u" + Date.now().toString(36),
      url, title: meta.title || url, source: meta.source || domainOf(url),
      date: (meta.date || new Date().toISOString().slice(0, 10)),
      image: meta.image || "", category: (body.category || "").trim(),
      note: (body.note || "").slice(0, 240), submitted: true,
      submittedAt: new Date().toISOString()
    };
    let list = [];
    try { const v = await store.get(KEY); list = v ? JSON.parse(v) : []; } catch (e) {}
    list = [sig, ...list.filter(s => s.url !== url)].slice(0, 200); // dedupe by url, cap 200
    await store.put(KEY, JSON.stringify(list));
    return json({ signal: sig });
  }
  return json({ error: "method not allowed" }, 405);
}

async function enrich(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": BUA, "Accept": "text/html,*/*" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return {};
    const html = (await r.text()).slice(0, 200000);
    const meta = (prop) => {
      const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"));
      const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
      return decode((a && a[1]) || (b && b[1]) || "");
    };
    const title = meta("og:title") || meta("twitter:title") || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
    const source = meta("og:site_name") || domainOf(url);
    const raw = meta("article:published_time") || meta("article:modified_time") || meta("datePublished") || "";
    const t = raw ? Date.parse(raw) : NaN;
    const date = isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
    const image = meta("og:image") || meta("twitter:image");
    return { title, source, date, image };
  } catch (e) { return {}; }
}
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
function decode(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } }); }
