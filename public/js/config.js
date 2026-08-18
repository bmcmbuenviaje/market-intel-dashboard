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
