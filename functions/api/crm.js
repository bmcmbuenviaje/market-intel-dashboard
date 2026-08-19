/* Lightweight CRM overlay on entities.
   GET /api/crm            -> { crm: { entityId: {status,owner,notes,updatedAt} } }
   PUT /api/crm {id,...}    -> upsert one entity's BD record.
   Stored in KB_STORE under key "crm". */
const KEY = "crm";

export async function onRequest({ request, env }) {
  const store = env.KB_STORE;
  if (request.method === "GET") {
    if (!store) return json({ crm: {} });
    const v = await store.get(KEY);
    return json({ crm: v ? JSON.parse(v) : {} });
  }
  if (request.method === "PUT") {
    if (!store) return json({ error: "KV not bound" }, 501);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid JSON" }, 400); }
    const id = (body.id || "").trim();
    if (!id) return json({ error: "id required" }, 400);
    let map = {};
    try { const v = await store.get(KEY); map = v ? JSON.parse(v) : {}; } catch (e) {}
    const cur = map[id] || {};
    const rec = {
      status: body.status !== undefined ? String(body.status || "") : (cur.status || ""),
      owner: body.owner !== undefined ? String(body.owner || "").slice(0, 60) : (cur.owner || ""),
      notes: body.notes !== undefined ? String(body.notes || "").slice(0, 2000) : (cur.notes || ""),
      updatedAt: new Date().toISOString()
    };
    if (!rec.status && !rec.owner && !rec.notes) delete map[id]; else map[id] = rec;
    await store.put(KEY, JSON.stringify(map));
    return json({ ok: true, crm: map[id] || null });
  }
  return json({ error: "method not allowed" }, 405);
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } }); }
