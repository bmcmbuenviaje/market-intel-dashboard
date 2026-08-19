/* GET /api/detect[?post=1]
   Server-side partnership/M&A detector for the scheduled cron. Scans recent news
   for deal language naming two known entities, excludes edges already in the KB,
   and (with ?post=1 + DIGEST_WEBHOOK) posts NEW suggestions to Slack/Discord,
   tracking what's been posted in KV ("detect-posted") so it won't repeat daily. */
const PARTNER_RX = /\b(partner|partners|partnership|teams up|team up|collaborat|tie-?up|joins forces|join forces|sponsor|signs? deal|inks? deal|deal with|jv|joint venture)\b/i;
const OWNS_RX = /\b(acquire|acquires|acquisition|acquired|buys|bought|to buy|takeover|take over|majority stake|controlling stake|stake in|merger|merges with)\b/i;

export async function onRequest({ request, env }) {
  const store = env.KB_STORE;
  const post = new URL(request.url).searchParams.get("post") === "1";

  let kb;
  try {
    if (store) { const v = await store.get("knowledge-base"); if (v) kb = JSON.parse(v); }
    if (!kb) kb = await (await fetch(new URL("/data/knowledge-base.json", request.url))).json();
  } catch (e) { return json({ error: "kb load failed" }, 500); }

  let articles = [];
  try { articles = (await (await fetch(new URL("/api/news?days=10", request.url))).json()).articles || []; } catch (e) {}

  const nameOf = (() => { const m = {}; kb.entities.forEach(e => m[e.id] = e.name); return (id) => m[id] || id; })();
  const idx = kb.entities.map(e => ({ id: e.id, needles: [e.name, ...(e.aliases || [])].map(s => s.toLowerCase()).filter(s => s.length > 3) }));
  const have = new Set(kb.relationships.map(r => [r.source, r.target].sort().join("|") + "|" + r.type));

  const found = []; const seen = new Set();
  for (const a of articles) {
    const t = ((a.title || "") + " " + (a.summary || "")).toLowerCase();
    const type = OWNS_RX.test(t) ? "owns" : (PARTNER_RX.test(t) ? "partner" : null);
    if (!type) continue;
    const hits = []; idx.forEach(({ id, needles }) => { if (needles.some(n => t.includes(n))) hits.push(id); });
    const uniq = [...new Set(hits)];
    if (uniq.length < 2) continue;
    const [s, tg] = uniq;
    const key = [s, tg].sort().join("|") + "|" + type;
    if (have.has(key) || seen.has(key)) continue;
    seen.add(key);
    found.push({ source: s, target: tg, type, label: (a.title || "").slice(0, 100), url: a.url, src: a.source || "", key, names: [nameOf(s), nameOf(tg)] });
  }

  let postedSet = new Set();
  if (store) { try { const v = await store.get("detect-posted"); postedSet = new Set(v ? JSON.parse(v) : []); } catch (e) {} }
  const fresh = found.filter(f => !postedSet.has(f.key));

  let posted = 0;
  if (post && env.DIGEST_WEBHOOK && fresh.length) {
    const text = "🔗 *New partnership signals detected:*\n" + fresh.slice(0, 15).map(f =>
      `• ${f.names[0]} ${f.type === "owns" ? "⇒ acquires ⇒" : "↔ partners ↔"} ${f.names[1]}\n  ${f.label} — ${f.url}`).join("\n");
    try {
      await fetch(env.DIGEST_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }) });
      posted = fresh.length;
      if (store) { fresh.forEach(f => postedSet.add(f.key)); await store.put("detect-posted", JSON.stringify([...postedSet].slice(-500))); }
    } catch (e) { posted = 0; }
  }
  return json({ suggestions: found.map(({ key, ...f }) => f), fresh: fresh.length, posted, articles: articles.length });
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } }); }
