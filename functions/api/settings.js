/* GET  /api/settings  -> homescreen/app settings (from KV if present, else defaults)
   PUT  /api/settings  -> overwrite settings in KV (admin only)

   Controls which dashboard modules are shown and which map tiles are used, so the
   BD team can turn panels off (e.g. hide the Signal Map) from the Admin page.

   KV binding: reuses `KB_STORE` on the Pages project (no new binding needed).
   Auth: PUT requires header  X-Admin-Token == env.ADMIN_TOKEN  (fail-closed if unset). */
const KEY = "app-settings";
const DEFAULTS = {
  modules: { map: true, graph: true, side: true, bd: true, feed: true, sov: true, pulse: true },
  mapTiles: "dark"
};
const MODULE_IDS = ["map", "graph", "side", "bd", "feed", "sov", "pulse"];
const TILE_IDS = ["dark", "light", "voyager", "osm"];

export async function onRequest(context) {
  const { request, env } = context;
  const store = env.KB_STORE;

  if (request.method === "GET") {
    if (store) {
      const v = await store.get(KEY);
      if (v) { try { return json(merge(JSON.parse(v)), 200, { "x-settings-source": "kv" }); } catch (e) {} }
    }
    try {
      const r = await fetch(new URL("/data/app-settings.json", request.url));
      if (r.ok) return json(merge(await r.json()), 200, { "x-settings-source": "static" });
    } catch (e) {}
    return json(DEFAULTS, 200, { "x-settings-source": "default" });
  }

  if (request.method === "PUT") {
    if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN not configured on the server" }, 403);
    if ((request.headers.get("X-Admin-Token") || "") !== env.ADMIN_TOKEN)
      return json({ error: "unauthorized" }, 401);
    if (!store) return json({ error: "KV not bound — create a KV namespace and bind it as KB_STORE" }, 501);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid JSON" }, 400); }
    const clean = merge(body);
    await store.put(KEY, JSON.stringify(clean));
    return json({ ok: true, settings: clean, savedAt: new Date().toISOString() }, 200);
  }

  return json({ error: "method not allowed" }, 405);
}

/* Coerce any input into a safe, fully-populated settings object. */
function merge(input) {
  input = input && typeof input === "object" ? input : {};
  const modules = {};
  MODULE_IDS.forEach(id => {
    const v = input.modules && input.modules[id];
    modules[id] = v === false ? false : true;
  });
  const mapTiles = TILE_IDS.includes(input.mapTiles) ? input.mapTiles : DEFAULTS.mapTiles;
  return { modules, mapTiles };
}

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...extra } });
}
