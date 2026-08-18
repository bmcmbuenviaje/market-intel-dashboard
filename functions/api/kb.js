/* GET  /api/kb  -> current knowledge base (from KV if present, else the static seed)
   PUT  /api/kb  -> overwrite the knowledge base in KV (admin only)

   KV binding: bind a KV namespace as `KB_STORE` on the Pages project.
   Auth: PUT requires header  X-Admin-Token == env.ADMIN_TOKEN  (fail-closed if unset).
   Reads are open (the dataset is already public via the static file). */
const KEY = "knowledge-base";

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.KB_STORE; // may be undefined if not bound yet

  if (request.method === "GET") {
    if (store) {
      const v = await store.get(KEY);
      if (v) return json(v, 200, { "x-kb-source": "kv" }, true);
    }
    try {
      const r = await fetch(new URL("/data/knowledge-base.json", request.url));
      const text = await r.text();
      return json(text, 200, { "x-kb-source": "static" }, true);
    } catch (e) {
      return json({ error: "kb unavailable" }, 500);
    }
  }

  if (request.method === "PUT") {
    if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN not configured on the server" }, 403);
    if ((request.headers.get("X-Admin-Token") || "") !== env.ADMIN_TOKEN)
      return json({ error: "unauthorized" }, 401);
    if (!store) return json({ error: "KV not bound — create a KV namespace and bind it as KB_STORE" }, 501);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid JSON" }, 400); }
    if (!body || !Array.isArray(body.entities) || !Array.isArray(body.relationships))
      return json({ error: "body must contain entities[] and relationships[]" }, 400);

    // integrity: drop edges whose endpoints don't exist
    const ids = new Set(body.entities.map(e => e.id));
    body.relationships = body.relationships.filter(r => ids.has(r.source) && ids.has(r.target));
    body._meta = body._meta || {};
    body._meta.lastUpdated = new Date().toISOString().slice(0, 10);

    await store.put(KEY, JSON.stringify(body));
    return json({ ok: true, entities: body.entities.length, relationships: body.relationships.length,
      savedAt: new Date().toISOString() }, 200);
  }

  return json({ error: "method not allowed" }, 405);
}

function json(payload, status = 200, extra = {}, raw = false) {
  const body = raw ? payload : JSON.stringify(payload);
  return new Response(body, { status, headers: { "content-type": "application/json", ...extra } });
}
