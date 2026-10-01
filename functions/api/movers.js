/* Market movers digest.
   GET  /api/movers[?post=1]  -> server-computed volume movers from live news;
                                 ?post=1 also posts them to DIGEST_WEBHOOK (for cron).
   POST /api/movers  {text}   -> relay the dashboard's on-screen movers to the webhook,
                                 so a "Push movers" click delivers exactly what's shown.

   Reuses KB_STORE (knowledge base) + DIGEST_WEBHOOK; no new binding. */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid JSON" }, 400); }
    const text = String(body.text || "").slice(0, 3500);
    if (!text) return json({ error: "no text" }, 400);
    if (!env.DIGEST_WEBHOOK) return json({ posted: false, error: "DIGEST_WEBHOOK not set on the server" }, 200);
    try {
      await fetch(env.DIGEST_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }) });
      return json({ posted: true }, 200);
    } catch (e) { return json({ posted: false, error: String(e) }, 200); }
  }

  if (request.method === "GET") {
    const post = new URL(request.url).searchParams.get("post") === "1";
    const kb = await loadKB(request, env);
    let arts = [];
    try { arts = (await (await fetch(new URL("/api/news?days=14", request.url))).json()).articles || []; } catch (e) {}
    const movers = computeMovers(kb, arts);
    let posted = false;
    if (post && env.DIGEST_WEBHOOK && movers.length) {
      const text = "📈 Market movers (last 3 days):\n" + movers.slice(0, 10).map(m =>
        `• ${m.name}: ${m.recent} signal(s) vs ~${m.expected} baseline${m.swing ? `, sentiment ${m.swing >= 0 ? "+" : ""}${m.swing}` : ""}`).join("\n");
      try {
        await fetch(env.DIGEST_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }) });
        posted = true;
      } catch (e) {}
    }
    return json({ movers, posted, articles: arts.length }, 200);
  }

  return json({ error: "method not allowed" }, 405);
}

async function loadKB(request, env) {
  if (env.KB_STORE) { const v = await env.KB_STORE.get("knowledge-base"); if (v) { try { return JSON.parse(v); } catch (e) {} } }
  try { return await (await fetch(new URL("/data/knowledge-base.json", request.url))).json(); }
  catch (e) { return { entities: [], relationships: [] }; }
}

const POS = ["surge", "record", "growth", "win", "launch", "partner", "expand", "best", "strong", "boost", "success", "profit"];
const NEG = ["loss", "cut", "decline", "ban", "fine", "probe", "lawsuit", "fraud", "weak", "drop", "scam", "fail", "boycott"];
function senti(t) { t = (t || "").toLowerCase(); let s = 0; POS.forEach(w => { if (t.includes(w)) s++; }); NEG.forEach(w => { if (t.includes(w)) s--; }); return Math.max(-100, Math.min(100, s * 15)); }

function computeMovers(kb, arts) {
  const now = Date.now(), DAY = 864e5;
  const idx = (kb.entities || []).map(e => ({ id: e.id, name: e.name,
    needles: [e.name].concat(e.aliases || []).map(s => (s || "").toLowerCase()).filter(s => s.length > 3) }));
  const tally = {};
  arts.forEach(a => {
    const t = ((a.title || "") + " " + (a.summary || "")).toLowerCase();
    const age = a.date ? now - Date.parse(a.date) : null;
    const sv = senti(t);
    idx.forEach(({ id, name, needles }) => {
      if (!needles.some(n => t.includes(n))) return;
      const o = tally[id] || (tally[id] = { id, name, recent: 0, prior: 0, sRecent: 0, cRecent: 0, sPrior: 0, cPrior: 0 });
      if (age != null && age <= 3 * DAY) { o.recent++; o.sRecent += sv; o.cRecent++; }
      else { o.prior++; o.sPrior += sv; o.cPrior++; }
    });
  });
  const out = [];
  Object.keys(tally).forEach(id => {
    const o = tally[id];
    const expected = o.prior / 11 * 3; // baseline window ≈ days 4–14
    if (o.recent >= 3 && o.recent >= expected * 1.5) {
      const sNow = o.cRecent ? Math.round(o.sRecent / o.cRecent) : 0;
      const sPrev = o.cPrior ? Math.round(o.sPrior / o.cPrior) : 0;
      out.push({ id, name: o.name, recent: o.recent, expected: Math.round(expected * 10) / 10, swing: sNow - sPrev, score: o.recent - expected });
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
