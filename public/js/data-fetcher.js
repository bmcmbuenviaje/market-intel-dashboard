/* All data access. Local JSON is loaded directly; live sources go through the
   Cloudflare Functions proxy (window.CONFIG.API_BASE) to avoid CORS + hide keys. */
window.DATA = (function () {
  const base = window.CONFIG.API_BASE;
  const cache = {};

  async function loadJSON(path) {
    if (cache[path]) return cache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error(path + " -> " + res.status);
    const j = await res.json();
    cache[path] = j;
    return j;
  }

  const loadTaxonomy = () => loadJSON("data/taxonomy.json");

  /* Load KB from the live store (/api/kb -> KV, or static seed). Falls back to the
     static file if the proxy isn't available (e.g. opened as a bare file). */
  async function loadKnowledge() {
    if (cache["__kb"]) return cache["__kb"];
    try {
      const res = await fetch(`${base}/kb`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("kb " + res.status);
      const j = await res.json();
      if (j && Array.isArray(j.entities)) { cache["__kb"] = j; return j; }
      throw new Error("bad kb shape");
    } catch (e) {
      const j = await loadJSON("data/knowledge-base.json");
      cache["__kb"] = j; return j;
    }
  }

  /* GDELT news via proxy. Returns [{title,url,domain,date,country,tone,category?}] */
  async function fetchNews({ query = "", country = "", windowDays = 30 } = {}) {
    const params = new URLSearchParams({ query, country, days: String(windowDays) });
    const res = await fetch(`${base}/gdelt?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error("gdelt " + res.status);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j.articles || [];
  }

  /* Aggregated RSS business news via proxy. Reliable, not rate-limited like GDELT. */
  async function fetchNewsFeed({ days = 7, q = "" } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    if (q) params.set("q", q);
    const res = await fetch(`${base}/news?${params}`, { signal: AbortSignal.timeout(13000) });
    if (!res.ok) throw new Error("news " + res.status);
    const j = await res.json();
    return j.articles || [];
  }

  /* Yahoo Finance quote via proxy. symbol e.g. "GC=F", "CL=F", "JFC.PS" */
  async function fetchQuote(symbol) {
    const res = await fetch(`${base}/yahoo?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error("yahoo " + res.status);
    return res.json();
  }

  /* Wikidata ownership enrichment via proxy (SPARQL). Returns {parents:[],subs:[]} */
  async function fetchOwnership(wikidataId) {
    if (!wikidataId) return { parents: [], subs: [] };
    const res = await fetch(`${base}/wikidata?id=${encodeURIComponent(wikidataId)}`);
    if (!res.ok) throw new Error("wikidata " + res.status);
    return res.json();
  }

  /* Very small keyword sentiment used as a fallback when no sentiment API is set.
     Not a substitute for a real model — just turns headlines into a rough signal. */
  const POS = ["surge","record","growth","profit","improve","win","launch","partner","expand","beat","rally","boost","recovery","strong"];
  const NEG = ["loss","cut","decline","fall","ban","restrict","fine","probe","lawsuit","fraud","weak","drop","crackdown","shutdown","risk"];
  function keywordSentiment(text) {
    const t = (text || "").toLowerCase();
    let s = 0;
    POS.forEach(w => { if (t.includes(w)) s += 1; });
    NEG.forEach(w => { if (t.includes(w)) s -= 1; });
    return Math.max(-100, Math.min(100, s * 20));
  }

  return { loadTaxonomy, loadKnowledge, fetchNews, fetchNewsFeed, fetchQuote, fetchOwnership, keywordSentiment };
})();
