/* Global config. Values here are safe to expose (no secrets).
   Real API keys live server-side in Cloudflare Functions env vars — never here. */
window.CONFIG = {
  // SHA-256 of the access code. Client-side gate = "keep casual visitors out".
  // For real protection, put the site behind Cloudflare Access or encrypt with PageCrypt.
  ACCESS_HASH: "f914887f0e2575467d79c35b16bb595e7bdb8f5b9bf16e6e4f0b0c9b1a0697e0",

  // Base path for the serverless proxy. Cloudflare Pages Functions serve these.
  API_BASE: "/api",

  // Data source toggles (admin.html writes these to localStorage).
  DEFAULT_SOURCES: {
    gdelt: true,       // global news (via proxy)
    knowledge: true,   // curated relationship graph (always on)
    yahoo: true,       // commodity / ticker prices (via proxy)
    wikidata: true,    // ownership enrichment (via proxy or direct CORS)
    finnhub: false     // company news (needs key set in admin)
  },

  DEFAULT_SCOPE: { mode: "country", country: "PH", region: "sea" }
};

window.getSources = function () {
  try {
    const s = JSON.parse(localStorage.getItem("mi_sources"));
    return Object.assign({}, window.CONFIG.DEFAULT_SOURCES, s || {});
  } catch (e) { return window.CONFIG.DEFAULT_SOURCES; }
};

/* ---- Homescreen settings (which modules show + which map tiles) ----
   Loaded once from /api/settings (KV in prod, app-settings.json in dev). Both
   app.js and layout.js await the same cached promise so widget pruning and the
   GridStack init stay in sync. Falls back to "everything on" if the API is down. */
window.APP_SETTINGS = null;
window.DEFAULT_SETTINGS = {
  modules: { map: true, graph: true, side: true, bd: true, feed: true, sov: true },
  mapTiles: "dark"
};
window.loadAppSettings = function () {
  if (window.__settingsPromise) return window.__settingsPromise;
  window.__settingsPromise = fetch(window.CONFIG.API_BASE + "/settings")
    .then(r => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then(s => {
      const def = window.DEFAULT_SETTINGS;
      const merged = { modules: Object.assign({}, def.modules, (s && s.modules) || {}),
        mapTiles: (s && s.mapTiles) || def.mapTiles };
      window.APP_SETTINGS = merged;
      return merged;
    });
  return window.__settingsPromise;
};
window.moduleOn = function (id) {
  const m = window.APP_SETTINGS && window.APP_SETTINGS.modules;
  return !m || m[id] !== false;
};
