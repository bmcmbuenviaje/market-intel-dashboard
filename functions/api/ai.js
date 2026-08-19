/* POST /api/ai
   { action:"summary", name, texts:[headlines] } -> { summary, sentiment }
   { action:"sentiment", text }                  -> { score }
   Uses Cloudflare Workers AI (free tier). Needs the [ai] binding (env.AI) in
   wrangler.toml. Returns configured:false if the binding is absent (e.g. local dev). */
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!env.AI) return json({ configured: false });
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "invalid JSON" }, 400); }

  if (body.action === "sentiment") {
    const text = String(body.text || "").slice(0, 2000);
    if (!text) return json({ score: 0 });
    return json({ score: await sentiment(env, text) });
  }

  if (body.action === "summary") {
    const name = String(body.name || "").slice(0, 120);
    const texts = (body.texts || []).slice(0, 12).map(t => String(t).replace(/\s+/g, " ").slice(0, 160)).filter(Boolean);
    if (!texts.length) return json({ summary: "", sentiment: 0 });
    const prompt = `You are a market-intelligence analyst for a business-development team. Based ONLY on these recent headlines about "${name}", write ONE concise sentence (max 32 words) on what is happening with them right now and why a BD team should care. Do not add preamble.\n\nHeadlines:\n- ${texts.join("\n- ")}`;
    let summary = "", dbg = "";
    try {
      const r = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { max_tokens: 160, messages: [{ role: "user", content: prompt }] });
      summary = String((r && (r.response ?? (r.result && r.result.response) ?? r.text ?? (typeof r === "string" ? r : ""))) || "").trim().replace(/^"(.*)"$/, "$1");
      if (!summary) dbg = "shape:" + JSON.stringify(r).slice(0, 220);
    } catch (e) { dbg = "err:" + String(e).slice(0, 220); }
    const senti = await sentiment(env, texts.join(". ")).catch(() => 0);
    return json({ summary, sentiment: senti, _debug: dbg });
  }
  return json({ error: "unknown action" }, 400);
}

async function sentiment(env, text) {
  try {
    const r = await env.AI.run("@cf/huggingface/distilbert-sst-2-int8", { text });
    const arr = Array.isArray(r) ? r : (r && r.response) || [];
    const pos = arr.find(x => /pos/i.test(x.label || ""));
    const neg = arr.find(x => /neg/i.test(x.label || ""));
    if (pos && neg) return Math.round((pos.score - neg.score) * 100);
    if (pos) return Math.round(pos.score * 100);
    if (neg) return -Math.round(neg.score * 100);
    return 0;
  } catch (e) { return 0; }
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } }); }
