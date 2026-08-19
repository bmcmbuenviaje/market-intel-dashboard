/* Orchestrator: loads data, wires filters, renders map/graph/BD/feed. */
(function () {
  const S = {
    taxonomy: null, kb: null, news: [], sparkChart: null, reqToken: 0,
    tab: "hotlist", view: null, entNewsToken: 0, socialToken: 0,
    focus: null, nameIndex: {}, submitted: [], crm: {}
  };
  const CRM_STATUS = [["", "—"], ["prospect", "Prospect"], ["contacted", "Contacted"], ["pitched", "Pitched"], ["won", "Won"], ["lost", "Lost"]];
  const crmLabel = (v) => (CRM_STATUS.find(s => s[0] === v) || ["", ""])[1];

  /* ---- watchlist (localStorage) ---- */
  function getWatch() { try { return JSON.parse(localStorage.getItem("mi_watchlist")) || []; } catch (e) { return []; } }
  function isWatched(id) { return getWatch().includes(id); }
  function toggleWatch(id) {
    const w = getWatch(); const i = w.indexOf(id);
    if (i >= 0) w.splice(i, 1); else w.push(id);
    localStorage.setItem("mi_watchlist", JSON.stringify(w));
    return i < 0;
  }
  const $ = (id) => document.getElementById(id);
  const byId = (id) => S.kb && S.kb.entities.find(e => e.id === id);
  const catLabel = (id) => { const c = S.taxonomy && (S.taxonomy.categories || []).find(x => x.id === id); return c ? c.label : id; };
  const status = (msg, ok = true) => { $("statusBar").innerHTML =
    `<span style="color:${ok ? "#8598b6" : "#f87171"}">${msg}</span>`; };

  document.addEventListener("mi:authed", boot, { once: true });

  async function boot() {
    MAPVIEW.init(); GRAPHVIEW.init();
    try {
      S.taxonomy = await DATA.loadTaxonomy();
      S.kb = await DATA.loadKnowledge();
    } catch (e) { status("Failed to load local data: " + e.message, false); return; }

    FILTERS.setTaxonomy(S.taxonomy);
    MAPVIEW.setCategoryColors(S.taxonomy.categories);
    GRAPHVIEW.setColors(S.taxonomy.categories, S.taxonomy.relationshipTypes);
    populateFilterOptions();
    buildSearchIndex();
    wireEvents();
    DATA.fetchSignals().then(s => { S.submitted = s || []; if (S.view) renderAll(S.view); }).catch(() => {});
    DATA.fetchCRM().then(c => { S.crm = c || {}; if (S.view) renderIntel(); }).catch(() => {});

    // default scope
    Object.assign(FILTERS.state, {
      scope: window.CONFIG.DEFAULT_SCOPE.mode,
      country: window.CONFIG.DEFAULT_SCOPE.country,
      region: window.CONFIG.DEFAULT_SCOPE.region
    });
    syncFilterUI();
    setTimeout(() => MAPVIEW.invalidate(), 100);
    await refresh();
  }

  /* Live commodities strip (Yahoo via proxy). Serves the macro/commodities pillar
     and gives the board live data even when the news feed is rate-limited. */
  async function loadCommodities() {
    if (!window.getSources().yahoo) return;
    const strip = $("commodityStrip");
    const syms = [
      { s: "GC=F", label: "Gold" }, { s: "CL=F", label: "WTI Oil" },
      { s: "BZ=F", label: "Brent" }, { s: "HG=F", label: "Copper" },
      { s: "PHP=X", label: "USD/PHP" }
    ];
    strip.innerHTML = `<span class="muted">loading commodities…</span>`;
    const results = await Promise.all(syms.map(async x => {
      try { return { ...x, q: await DATA.fetchQuote(x.s) }; }
      catch (e) { return { ...x, q: null }; }
    }));
    const ok = results.filter(r => r.q && r.q.price != null);
    if (!ok.length) { strip.innerHTML = `<span class="muted">commodities unavailable</span>`; return; }
    strip.innerHTML = ok.map(r => {
      const c = r.q.changePct;
      const cls = c > 0 ? "up" : c < 0 ? "down" : "";
      const arrow = c > 0 ? "▲" : c < 0 ? "▼" : "·";
      return `<span class="tk"><b>${r.label}</b>
        <span class="px">${r.q.price.toLocaleString()} ${r.q.currency || ""}</span>
        <span class="${cls}">${arrow} ${c == null ? "" : c + "%"}</span></span>`;
    }).join("");
  }

  function populateFilterOptions() {
    const cat = $("fCategory");
    S.taxonomy.categories.forEach(c => {
      const o = document.createElement("option"); o.value = c.id; o.textContent = `${c.icon} ${c.label}`;
      cat.appendChild(o);
    });
    const aiCat = $("aiCat");
    if (aiCat) S.taxonomy.categories.forEach(c => {
      const o = document.createElement("option"); o.value = c.id; o.textContent = c.label; aiCat.appendChild(o);
    });
    const reg = $("fRegion");
    S.taxonomy.regions.filter(r => r.id !== "global").forEach(r => {
      const o = document.createElement("option"); o.value = r.id; o.textContent = r.label; reg.appendChild(o);
    });
    const cty = $("fCountry");
    S.taxonomy.countries.forEach(c => {
      const o = document.createElement("option"); o.value = c.code; o.textContent = c.label; cty.appendChild(o);
    });
  }

  function syncFilterUI() {
    $("fScope").value = FILTERS.state.scope;
    $("fRegion").value = FILTERS.state.region;
    $("fCountry").value = FILTERS.state.country;
    $("fCategory").value = FILTERS.state.category;
    $("fWindow").value = String(FILTERS.state.windowDays);
    $("fRegionWrap").classList.toggle("hidden", FILTERS.state.scope !== "region");
    $("fCountryWrap").classList.toggle("hidden", FILTERS.state.scope !== "country");
  }

  function wireEvents() {
    $("fScope").onchange = (e) => { FILTERS.state.scope = e.target.value; syncFilterUI(); refresh(); };
    $("fRegion").onchange = (e) => { FILTERS.state.region = e.target.value; refresh(); };
    $("fCountry").onchange = (e) => { FILTERS.state.country = e.target.value; refresh(); };
    $("fCategory").onchange = (e) => { FILTERS.state.category = e.target.value; refresh(); };
    $("fWindow").onchange = (e) => { FILTERS.state.windowDays = +e.target.value; refresh(); };
    $("btnAddInsight").onclick = () => { $("addInsight").classList.toggle("hidden"); $("aiUrl").focus(); };
    $("aiSubmit").onclick = submitInsight;
    $("aiUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitInsight(); } });
    $("fSearch").addEventListener("change", () => doSearch($("fSearch").value));
    $("fSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch($("fSearch").value); } });
    $("btnRefresh").onclick = refresh;
    $("btnFit").onclick = GRAPHVIEW.fit;
    $("btnLogout").onclick = () => window.miLogout();
    $("bdTabs").querySelectorAll(".seg-btn").forEach(b => b.onclick = () => {
      S.tab = b.dataset.tab;
      $("bdTabs").querySelectorAll(".seg-btn").forEach(x => x.classList.toggle("active", x === b));
      renderIntel();
    });
    document.addEventListener("mi:selectEntity", (e) => selectEntity(e.detail));
  }

  function currentView() {
    const entities = S.kb.entities.filter(e => FILTERS.entityVisible(e));
    const visibleIds = new Set(entities.map(e => e.id));
    const relationships = S.kb.relationships.filter(r => visibleIds.has(r.source) && visibleIds.has(r.target));
    return { entities, visibleIds, relationships };
  }

  function seedSignals(visibleIds) {
    const out = [];
    (S.kb.signals || []).forEach(sg => {
      if (!visibleIds.has(sg.entity)) return;
      const ent = S.kb.entities.find(x => x.id === sg.entity);
      out.push({ title: sg.headline, url: sg.url, domain: "curated", date: sg.date,
        sentiment: sg.sentiment, category: sg.category, entitySeed: sg.entity,
        lat: ent && ent.lat, lng: ent && ent.lng, verified: sg.verified });
    });
    return out;
  }
  function submittedItems() {
    return (S.submitted || []).map(s => ({
      id: s.id, title: s.title, url: s.url, source: s.source, date: s.date, note: s.note,
      category: s.category || guessCategory(s.title || ""), manualIds: s.entityIds || [],
      sentiment: DATA.keywordSentiment((s.title || "") + " " + (s.note || "")), submitted: true
    }));
  }
  function baseNews(view) { return seedSignals(view.visibleIds).concat(submittedItems()); }

  function renderAll(view) {
    S.view = view;
    FUSION.tagNewsToEntities(S.news, S.kb.entities);
    S.news.forEach(n => { if (n.manualIds && n.manualIds.length) n.entityIds = [...new Set([...(n.entityIds || []), ...n.manualIds])]; });
    MAPVIEW.render(view.entities, S.news);
    MAPVIEW.focus(FILTERS.state.scope === "country" ? FILTERS.state.country : null, S.taxonomy);
    GRAPHVIEW.build(view.entities, view.relationships);
    renderIntel();
    renderFeed(S.news);
  }

  async function refresh() {
    S.focus = null; // any full refresh (filter change / refresh button) exits focus mode
    const sources = window.getSources();
    const view = currentView();
    const token = ++S.reqToken; // guards against stale async renders after a filter change

    // 1) Curated layer paints instantly — never blocked by a slow/failing live feed.
    S.news = baseNews(view);
    renderAll(view);
    status(`${view.entities.length} entities in view · curated layer loaded`);
    loadCommodities();

    // 2) Live news: RSS aggregator (primary) + GDELT (best-effort), merged in async.
    if (sources.gdelt) {
      status(`${view.entities.length} entities · fetching live news…`);
      const country = FILTERS.state.scope === "country" ? FILTERS.state.country : "";
      const [feedR, gdeltR] = await Promise.allSettled([
        DATA.fetchNewsFeed({ days: FILTERS.state.windowDays }),
        DATA.fetchNews({ query: buildQuery(), country, windowDays: FILTERS.state.windowDays })
      ]);
      if (token !== S.reqToken) return; // a newer refresh superseded this one
      const mk = (a) => ({ ...a, sentiment: DATA.keywordSentiment((a.title || "") + " " + (a.summary || "")),
        category: a.category || guessCategory((a.title || "") + " " + (a.summary || "")) });
      let live = [];
      if (feedR.status === "fulfilled") live = live.concat(feedR.value.map(mk));
      if (gdeltR.status === "fulfilled") live = live.concat(gdeltR.value.map(mk));
      const seenU = new Set(); live = live.filter(a => a.url && !seenU.has(a.url) && (seenU.add(a.url), true));
      S.news = baseNews(view).concat(live);
      renderAll(view);
      const ok = feedR.status === "fulfilled" || gdeltR.status === "fulfilled";
      status(ok ? `${live.length} live articles · ${view.entities.length} entities in view`
        : "Live news unavailable — showing curated + seed signals.", ok);
    }
  }

  function buildQuery() {
    // Bias the news query toward the active category + partnership language.
    const c = FILTERS.state.category;
    const map = {
      food: "(restaurant OR QSR OR food brand)", gaming: "(esports OR mobile game OR gaming)",
      igaming: "(casino OR igaming OR integrated resort)", beauty: "(beauty OR cosmetics OR skincare)",
      fintech: "(fintech OR e-wallet OR digital bank)", telco: "telecom", retail: "(retail OR ecommerce)",
      fmcg: "(beverage OR fmcg OR snacks)"
    };
    const base = "(partnership OR collaboration OR sponsorship OR deal OR launch)";
    return c === "all" ? base : `${base} ${map[c] || ""}`.trim();
  }

  function guessCategory(title) {
    const t = (title || "").toLowerCase();
    if (/casino|igaming|gambling|resort/.test(t)) return "igaming";
    if (/esports|gaming|mobile game|mlbb|free fire/.test(t)) return "gaming";
    if (/restaurant|food|burger|qsr|snack/.test(t)) return "food";
    if (/beauty|cosmetic|skincare|makeup/.test(t)) return "beauty";
    if (/fintech|wallet|payment|bank/.test(t)) return "fintech";
    if (/telecom|telco|5g/.test(t)) return "telco";
    return "conglomerate";
  }

  /* ---------- Intelligence panel (Targets / Whitespace / Watchlist) ---------- */
  function card(t, cls) {
    const watched = isWatched(t.id);
    const scoreHtml = t.score != null ? `<span class="score">${t.score}</span>` : "";
    const st = (S.crm[t.id] || {}).status || "";
    const stChip = st ? `<span class="chip crm-${st}">${crmLabel(st)}</span>` : "";
    return `<div class="bd-card ${cls}" data-id="${t.id}">
        <div class="top">
          <span><strong>${t.name}</strong> <span class="muted">· ${t.category} · ${t.country}</span> ${stChip}</span>
          <span>${scoreHtml}
            <button class="star ${watched ? "" : "off"}" data-star="${t.id}" title="Watchlist">${watched ? "★" : "☆"}</button>
          </span>
        </div>
        ${t.why && t.why.length ? `<div class="why">${t.why.slice(0, 3).join(" · ")}</div>` : ""}
        ${t.sub ? `<div class="why">${t.sub}</div>` : ""}
      </div>`;
  }

  function wireCards(el) {
    el.querySelectorAll(".bd-card").forEach(c =>
      c.onclick = (e) => { if (e.target.closest("[data-star]")) return; selectEntity(c.dataset.id); });
    el.querySelectorAll("[data-star]").forEach(b =>
      b.onclick = (e) => { e.stopPropagation(); toggleWatch(b.dataset.star); renderIntel(); });
  }

  function renderIntel() {
    const el = $("bdList");
    if (!S.view) return;
    if (S.tab === "hotlist") {
      const list = FUSION.hotlist(S.kb.entities, S.news, S.kb.relationships, FILTERS,
        { watch: getWatch(), today: new Date().toISOString().slice(0, 10) });
      el.innerHTML = list.length ? list.map(t => card(t, "hot")).join("")
        : `<p class="muted" style="padding:8px">No hot signals yet — live news may still be loading, or widen the scope/category.</p>`;
      wireCards(el);
    } else if (S.tab === "targets") {
      const list = FUSION.rank(S.kb.entities, S.news, S.kb.relationships, FILTERS);
      el.innerHTML = list.length ? list.map(t => card(t, "")).join("")
        : `<p class="muted" style="padding:8px">No strong targets for this filter. Widen scope or category.</p>`;
      wireCards(el);
    } else if (S.tab === "whitespace") {
      const list = FUSION.whitespace(S.kb.entities, S.kb.relationships, FILTERS);
      el.innerHTML = list.length ? list.map(t => card(t, "ws")).join("")
        : `<p class="muted" style="padding:8px">No whitespace gaps for this filter — every visible brand already has a deal, or none of their rivals do.</p>`;
      wireCards(el);
    } else {
      renderWatchlist(el);
    }
  }

  function renderWatchlist(el) {
    const ids = getWatch();
    const watched = S.kb.entities.filter(e => ids.includes(e.id));
    const bar = `<div class="digest-bar">
      <button class="btn" id="btnDigest">📤 Generate digest</button>
      <span class="muted" style="font-size:12px">${watched.length} brand(s) watched</span></div>`;
    if (!watched.length) {
      el.innerHTML = bar + `<p class="muted" style="padding:8px">Star brands (☆) in any tab or the profile to build a watchlist. The digest pulls their latest signals.</p>`;
      $("btnDigest").onclick = () => {};
      return;
    }
    const items = watched.map(e => {
      const news = S.news.filter(n => (n.entityIds || []).includes(e.id) || n.entitySeed === e.id);
      const senti = news.length ? Math.round(news.reduce((a, n) => a + (n.sentiment || 0), 0) / news.length) : null;
      return { id: e.id, name: e.name, category: e.category, country: e.country,
        sub: `${news.length} signal(s)${senti != null ? ` · avg sentiment ${senti >= 0 ? "+" : ""}${senti}` : ""}` };
    });
    el.innerHTML = bar + items.map(t => card(t, "wl")).join("");
    wireCards(el);
    $("btnDigest").onclick = () => generateDigest(ids);
  }

  async function generateDigest(ids) {
    const el = $("bdList");
    const box = document.createElement("div"); box.style.padding = "8px";
    box.innerHTML = `<p class="muted">Generating digest…</p>`;
    el.prepend(box);
    try {
      const r = await fetch(`${window.CONFIG.API_BASE}/digest?ids=${encodeURIComponent(ids.join(","))}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const lines = (j.items || []).map(it =>
        `• <strong>${it.name}</strong>: ${it.headline ? `<a href="${it.url}" target="_blank" rel="noopener">${it.headline}</a>` : "no new signals"}`
      ).join("<br>");
      box.innerHTML = `<div class="bd-card wl"><div class="top"><strong>🗞️ Watchlist digest</strong>
        <span class="muted">${(j.generatedAt || "").slice(0, 10)}</span></div>
        <div class="why" style="line-height:1.6">${lines || "no signals"}</div>
        ${j.posted ? `<div class="why senti-pos">✓ posted to webhook</div>` : ""}</div>`;
    } catch (e) {
      box.innerHTML = `<p class="senti-neg" style="padding:8px">Digest needs the proxy running (python devserver.py or Cloudflare). ${e.message}</p>`;
    }
  }

  /* ---------- Feed ---------- */
  function renderFeed(news) {
    const el = $("feed");
    const items = [...news].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 80);
    if (!items.length) { el.innerHTML = `<p class="muted" style="padding:8px">No signals yet — fetching live news…</p>`; return; }
    el.innerHTML = items.map(n => {
      const sc = n.sentiment > 5 ? "senti-pos" : n.sentiment < -5 ? "senti-neg" : "senti-neu";
      const v = n.verified === false ? `<span class="chip badge-unverified">unverified</span>` :
                n.verified === true ? `<span class="chip badge-verified">sourced</span>` : "";
      const addedChip = n.submitted ? `<span class="chip" style="border-color:var(--accent-2);color:var(--accent-2)">＋ added</span>` : "";
      return `<div class="feed-item${n.submitted ? " submitted" : ""}">
        ${n.submitted && n.id ? `<button class="feed-del" data-del="${esc(n.id)}" title="Remove submitted link">✕</button>` : ""}
        <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        ${n.note ? `<div class="feed-sum">${esc(n.note)}</div>` : (n.summary ? `<div class="feed-sum">${esc(n.summary)}</div>` : "")}
        <div class="meta">
          <span class="chip">${esc(n.source || n.domain || "—")}</span>
          <span>${esc(n.date || "")}</span>
          <span class="${sc}">${n.sentiment >= 0 ? "+" : ""}${n.sentiment}</span>
          <span class="chip">${esc(n.category || "—")}</span>${addedChip}${v}
        </div></div>`;
    }).join("");
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = (e) => { e.stopPropagation(); removeSignal(b.dataset.del); });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ---------- Add insight (submit a link → enrich + auto-connect) ---------- */
  async function submitInsight() {
    const url = $("aiUrl").value.trim();
    const cat = $("aiCat").value;
    const msg = $("aiMsg");
    if (!/^https?:\/\/.+/i.test(url)) { msg.innerHTML = `<span class="bad">Enter a valid http(s) URL.</span>`; return; }
    // resolve the optional manual entity picker
    const entRaw = $("aiEntity").value.trim();
    let entId = "";
    if (entRaw) {
      entId = S.nameIndex[entRaw.toLowerCase()] ||
        (S.kb.entities.find(e => e.name.toLowerCase() === entRaw.toLowerCase() || (e.aliases || []).some(a => a.toLowerCase() === entRaw.toLowerCase())) || {}).id || "";
      if (!entId) { msg.innerHTML = `<span class="bad">"${esc(entRaw)}" isn't a known entity — pick from the list or leave blank.</span>`; return; }
    }
    msg.innerHTML = "fetching page &amp; connecting…";
    $("aiSubmit").disabled = true;
    try {
      const sig = await DATA.submitSignal(url, cat, entId || undefined);
      S.submitted = [sig, ...(S.submitted || []).filter(s => s.url !== sig.url)];
      const manual = sig.entityIds && sig.entityIds.length ? sig.entityIds : (entId ? [entId] : []);
      const item = {
        id: sig.id, title: sig.title, url: sig.url, source: sig.source, date: sig.date, note: sig.note,
        category: sig.category || guessCategory(sig.title || ""), submitted: true, manualIds: manual,
        sentiment: DATA.keywordSentiment((sig.title || "") + " " + (sig.note || ""))
      };
      FUSION.tagNewsToEntities([item], S.kb.entities);   // auto-connect by name/alias
      item.entityIds = [...new Set([...(item.entityIds || []), ...manual])];
      const names = item.entityIds.map(nameOf);
      S.news = [item, ...(S.news || []).filter(n => n.url !== item.url)];
      renderFeed(S.news);
      if (S.focus && item.entityIds.includes(S.focus)) renderFeedFocused(byId(S.focus));
      msg.innerHTML = names.length
        ? `<span class="ok">✓ Added — connected to: ${names.slice(0, 8).map(esc).join(", ")}</span>`
        : `<span class="ok">✓ Added to the feed. No entity matched — use the "Connect to" box to link one.</span>`;
      $("aiUrl").value = ""; $("aiEntity").value = "";
    } catch (e) {
      msg.innerHTML = `<span class="bad">Failed: ${esc(e.message)}</span>`;
    } finally { $("aiSubmit").disabled = false; }
  }
  async function removeSignal(id) {
    if (!id || !confirm("Remove this submitted link?")) return;
    try {
      await DATA.deleteSignal(id);
      S.submitted = (S.submitted || []).filter(s => s.id !== id);
      S.news = (S.news || []).filter(n => n.id !== id);
      renderFeed(S.news);
    } catch (e) { alert("Delete failed: " + e.message); }
  }

  /* ---------- Search + focus mode ---------- */
  function buildSearchIndex() {
    $("allEntities").innerHTML = S.kb.entities.map(e => `<option value="${esc(e.name)}"></option>`).join("");
    S.nameIndex = {};
    S.kb.entities.forEach(e => {
      S.nameIndex[e.name.toLowerCase()] = e.id;
      (e.aliases || []).forEach(a => { if (a) S.nameIndex[a.toLowerCase()] = e.id; });
    });
  }
  function doSearch(q) {
    q = (q || "").trim(); if (!q) return;
    let id = S.nameIndex[q.toLowerCase()];
    if (!id) {
      const lq = q.toLowerCase();
      const hit = S.kb.entities.find(e => e.name.toLowerCase().includes(lq) || (e.aliases || []).some(a => a.toLowerCase().includes(lq)));
      id = hit && hit.id;
    }
    if (id) focusEntity(id);
    else status(`No match for "${q}" — try another name.`, false);
  }
  function egoSubgraph(id) {
    const rels = S.kb.relationships;
    const keep = new Set([id]);
    rels.forEach(r => { if (r.source === id) keep.add(r.target); if (r.target === id) keep.add(r.source); });
    let cur = id; // walk the ownership chain up to the ultimate parent
    for (let i = 0; i < 8; i++) { const e = byId(cur); if (e && e.parent && byId(e.parent)) { keep.add(e.parent); cur = e.parent; } else break; }
    const self = byId(id); // include siblings under the same parent
    if (self && self.parent) rels.forEach(r => { if (r.type === "owns" && r.source === self.parent) keep.add(r.target); });
    return { entities: S.kb.entities.filter(e => keep.has(e.id)), relationships: rels.filter(r => keep.has(r.source) && keep.has(r.target)) };
  }
  function focusEntity(id) {
    const e = byId(id); if (!e) return;
    S.focus = id;
    ++S.reqToken; // supersede any in-flight refresh so it won't overwrite the focus view
    $("fSearch").value = e.name;
    const ego = egoSubgraph(id);
    $("statusBar").innerHTML = `<span class="focus-tag">🔎 Focused on ${esc(e.name)} · ${esc(catLabel(e.category))} · ${ego.entities.length - 1} connection(s)<a id="clearFocus">show full view ✕</a></span>`;
    const cf = document.getElementById("clearFocus"); if (cf) cf.onclick = clearFocus;
    selectEntity(id);                                   // entity profile (+ recent news + social)
    GRAPHVIEW.build(ego.entities, ego.relationships);   // relationship graph → its network
    setTimeout(() => GRAPHVIEW.highlight(id), 350);
    MAPVIEW.render(ego.entities, []);                   // map → just its network
    if (e.lat != null && e.lng != null) MAPVIEW.centerOn(e.lat, e.lng, 7);
    renderIntelFocused(e);                              // intelligence → focused BD view
    renderFeedFocused(e);                               // live signal feed → its news
  }
  function clearFocus() { S.focus = null; $("fSearch").value = ""; $("statusBar").textContent = ""; refresh(); }

  function renderIntelFocused(e) {
    const rels = S.kb.relationships;
    const partners = rels.filter(r => r.type === "partner" && (r.source === e.id || r.target === e.id));
    const comps = rels.filter(r => r.type === "competitor" && (r.source === e.id || r.target === e.id)).map(r => r.source === e.id ? r.target : r.source);
    const owns = rels.filter(r => r.type === "owns" && r.source === e.id).map(r => r.target);
    const rivalDeals = comps.filter(c => rels.some(r => r.type === "partner" && (r.source === c || r.target === c)));
    const grp = (t, arr) => arr.length ? `<div class="bd-card"><div class="top"><strong>${t}</strong><span class="muted">${arr.length}</span></div><div class="why">${arr.slice(0, 12).map(esc).join(" · ")}</div></div>` : "";
    const cards = [
      `<div class="bd-card" data-id="${e.id}"><div class="top"><span><strong>🔎 ${esc(e.name)}</strong></span>
        <button class="star ${isWatched(e.id) ? "" : "off"}" data-star="${e.id}">${isWatched(e.id) ? "★" : "☆"}</button></div>
        <div class="why">${esc(catLabel(e.category))} · ${esc(e.country)}${e.parent ? " · under " + esc(nameOf(e.parent)) : ""}</div></div>`
    ];
    if (!partners.length && rivalDeals.length)
      cards.push(`<div class="bd-card ws"><div class="top"><strong>⚑ Whitespace opening</strong></div><div class="why">No partnership on record — but rival(s) ${rivalDeals.map(nameOf).map(esc).join(", ")} already have deals. Prime target.</div></div>`);
    cards.push(grp("Partnerships", partners.map(p => (p.label ? p.label + " → " : "") + nameOf(p.source === e.id ? p.target : p.source))));
    cards.push(grp("Competitors", comps.map(nameOf)));
    cards.push(grp("Owns / brands", owns.map(nameOf)));
    $("bdList").innerHTML = cards.join("");
    $("bdList").querySelectorAll("[data-star]").forEach(b => b.onclick = (ev) => { ev.stopPropagation(); toggleWatch(b.dataset.star); focusEntity(e.id); });
  }
  async function renderFeedFocused(e) {
    const tagged = S.news.filter(n => (n.entityIds || []).includes(e.id) || n.entitySeed === e.id);
    renderFeed(tagged);
    try {
      const live = await DATA.fetchEntityNews(e.name);
      if (S.focus !== e.id) return;
      const mk = a => ({ ...a, sentiment: DATA.keywordSentiment(a.title), category: e.category });
      const seen = new Set();
      const all = [...live.map(mk), ...tagged].filter(n => n.url && !seen.has(n.url) && (seen.add(n.url), true));
      all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      renderFeed(all);
    } catch (err) { /* keep tagged */ }
  }

  /* ---------- Entity profile ---------- */
  function selectEntity(id) {
    const e = S.kb.entities.find(x => x.id === id);
    if (!e) return;
    GRAPHVIEW.highlight(id);

    const rels = S.kb.relationships;
    const parent = e.parent && S.kb.entities.find(x => x.id === e.parent);
    const owns = rels.filter(r => r.type === "owns" && r.source === id).map(r => nameOf(r.target));
    const siblings = e.parent ? rels.filter(r => r.type === "owns" && r.source === e.parent && r.target !== id).map(r => nameOf(r.target)) : [];
    const partners = rels.filter(r => r.type === "partner" && (r.source === id || r.target === id));
    const competes = rels.filter(r => r.type === "competitor" && (r.source === id || r.target === id))
      .map(r => nameOf(r.source === id ? r.target : r.source));
    const regs = rels.filter(r => r.type === "regulates" && r.target === id).map(r => nameOf(r.source));

    const news = S.news.filter(n => (n.entityIds || []).includes(id) || n.entitySeed === id);
    const cat = S.taxonomy.categories.find(c => c.id === e.category);

    const watched = isWatched(e.id);
    $("entityProfile").innerHTML = `
      <h3>${e.name}
        <button class="star ${watched ? "" : "off"}" id="profStar" title="Add to watchlist">${watched ? "★" : "☆"}</button>
      </h3>
      <div>
        <span class="tag">${cat ? cat.icon + " " + cat.label : e.category}</span>
        <span class="tag">${e.country}</span>
        <span class="tag">${e.type}${e.role ? " · " + e.role : ""}</span>
      </div>
      <p class="muted" style="margin:8px 0">${e.description || ""}</p>
      ${e.ticker ? kv("Ticker", e.ticker) : ""}
      ${e.website ? kv("Website", `<a href="${e.website}" target="_blank" rel="noopener">${e.website}</a>`) : ""}
      ${parent ? kv("Parent", `<a data-nav="${parent.id}">${parent.name}</a>`) : ""}
      ${linksRow(e)}
      <div class="rel-group"><h4>✨ AI take</h4><div id="aiTake"><span class="muted" style="font-size:12px">—</span></div></div>
      ${crmEditor(e)}
      ${relGroup("Owns / subsidiaries", owns)}
      ${relGroup("Sister brands", siblings)}
      ${relGroup("Competitors", competes)}
      ${relGroup("Regulated by", regs)}
      ${partners.length ? `<div class="rel-group"><h4>Partnerships</h4>${
        partners.map(p => {
          const other = nameOf(p.source === id ? p.target : p.source);
          const badge = p.verified === false ? `<span class="chip badge-unverified">verify</span>`
                       : p.url ? `<span class="chip badge-verified">sourced</span>` : "";
          return `<div class="rel-item">${p.label || "Partner"} → <strong>${other}</strong> ${badge}
            ${p.url ? `<br><a href="${p.url}" target="_blank" rel="noopener">source →</a>` : ""}</div>`;
        }).join("")}</div>` : ""}
      <div class="rel-group"><h4>Recent news</h4>
        <div id="entNews"><span class="muted" style="font-size:12px">loading recent articles…</span></div>
      </div>
      <div class="rel-group"><h4>Social buzz <span class="muted" id="socialMeta" style="font-weight:400"></span></h4>
        <div id="entSocial"><span class="muted" style="font-size:12px">checking YouTube &amp; Reddit…</span></div>
      </div>
      <div class="spark"><h4 style="font-size:12px;color:#8598b6">Sentiment trend (from signals)</h4>
        <canvas id="sparkCanvas" height="90"></canvas>
        <p class="muted" style="font-size:11px">${news.length} matched signal(s) in window.</p>
      </div>`;

    $("entityProfile").querySelectorAll("[data-nav]").forEach(a =>
      a.onclick = () => selectEntity(a.getAttribute("data-nav")));
    const ps = document.getElementById("profStar");
    if (ps) ps.onclick = () => { toggleWatch(e.id); selectEntity(e.id); renderIntel(); };
    const cs = document.getElementById("crmSave");
    if (cs) cs.onclick = async () => {
      const rec = { id: e.id, status: $("crmStatus").value, owner: $("crmOwner").value.trim(), notes: $("crmNotes").value.trim() };
      $("crmMsg").textContent = "saving…";
      try {
        const saved = await DATA.saveCRM(rec);
        if (saved) S.crm[e.id] = saved; else delete S.crm[e.id];
        $("crmMsg").innerHTML = `<span class="senti-pos">✓ saved</span>`;
        renderIntel();
      } catch (err) { $("crmMsg").innerHTML = `<span class="senti-neg">${esc(err.message)}</span>`; }
    };
    drawSpark(news);
    loadEntityNews(e, news);
    loadEntitySocial(e);
  }

  function drawSpark(news) {
    const ctx = document.getElementById("sparkCanvas");
    if (!ctx) return;
    if (S.sparkChart) S.sparkChart.destroy();
    const pts = [...news].filter(n => n.date).sort((a, b) => (a.date).localeCompare(b.date));
    const labels = pts.map(p => p.date);
    const data = pts.map(p => p.sentiment);
    S.sparkChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,.15)",
        fill: true, tension: .35, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { suggestedMin: -100, suggestedMax: 100,
          grid: { color: "rgba(255,255,255,.06)" }, ticks: { color: "#8598b6", font: { size: 9 } } } } }
    });
  }

  const nameOf = (id) => { const e = S.kb.entities.find(x => x.id === id); return e ? e.name : id; };
  const kv = (k, v) => `<div class="kv"><b>${k}</b><span>${v}</span></div>`;
  function relGroup(title, arr) {
    if (!arr || !arr.length) return "";
    return `<div class="rel-group"><h4>${title}</h4>${arr.map(x => `<div class="rel-item">${x}</div>`).join("")}</div>`;
  }
  function linksRow(e) {
    const news = `https://news.google.com/search?q=${encodeURIComponent(e.name)}&hl=en-PH&gl=PH`;
    const li = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(e.name)}`;
    const parts = [];
    if (e.website) parts.push(`<a href="${esc(e.website)}" target="_blank" rel="noopener">Website ↗</a>`);
    parts.push(`<a href="${news}" target="_blank" rel="noopener">News ↗</a>`);
    parts.push(`<a href="${li}" target="_blank" rel="noopener">LinkedIn ↗</a>`);
    return `<div class="kv"><b>Links</b><span>${parts.join(" · ")}</span></div>`;
  }
  function crmEditor(e) {
    const c = S.crm[e.id] || {};
    return `<div class="rel-group"><h4>BD status ${c.updatedAt ? `<span class="muted" style="font-weight:400">· updated ${esc((c.updatedAt || "").slice(0, 10))}</span>` : ""}</h4>
      <div class="crm">
        <select id="crmStatus">${CRM_STATUS.map(([v, l]) => `<option value="${v}"${c.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <input id="crmOwner" type="text" placeholder="Owner / account exec" value="${esc(c.owner || "")}" />
        <textarea id="crmNotes" rows="2" placeholder="BD notes…">${esc(c.notes || "")}</textarea>
        <div class="crm-row"><button class="btn" id="crmSave">Save</button><span id="crmMsg" class="muted"></span></div>
      </div></div>`;
  }
  /* Per-entity recent news: paint feed-matched articles instantly, then augment
     with a live Google News search for that entity. */
  async function loadEntityNews(e, seedNews) {
    const box = document.getElementById("entNews");
    if (!box) return;
    const token = ++S.entNewsToken;
    const tagged = (seedNews || []).map(n => ({ title: n.title, url: n.url, source: n.source || n.domain || "curated", date: n.date }));
    const render = (list) => {
      box.innerHTML = list.length
        ? list.slice(0, 12).map(n => `<div class="rel-item"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
            <br><span class="muted" style="font-size:11px">${esc(n.source || "")}${n.date ? " · " + esc(n.date) : ""}</span></div>`).join("")
        : `<span class="muted" style="font-size:12px">No recent articles found for ${esc(e.name)}.</span>`;
    };
    render(tagged);
    try {
      const live = await DATA.fetchEntityNews(e.name);
      if (token !== S.entNewsToken) return;
      const seen = new Set();
      const all = [...live, ...tagged].filter(n => n.url && !seen.has(n.url) && (seen.add(n.url), true));
      all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      render(all);
      loadAITake(e, all.map(a => a.title).filter(Boolean), token);
    } catch (err) { loadAITake(e, tagged.map(a => a.title).filter(Boolean), token); }
  }
  async function loadAITake(e, titles, token) {
    const box = document.getElementById("aiTake");
    if (!box) return;
    if (!titles || !titles.length) { box.innerHTML = `<span class="muted" style="font-size:12px">No recent news to summarize.</span>`; return; }
    box.innerHTML = `<span class="muted" style="font-size:12px">generating summary…</span>`;
    try {
      const r = await DATA.aiSummary(e.name, titles.slice(0, 12));
      if (token !== S.entNewsToken) return;
      if (r.configured === false) { box.innerHTML = `<span class="muted" style="font-size:12px">Add the Workers AI <code>[ai]</code> binding to enable AI summaries.</span>`; return; }
      const senti = typeof r.sentiment === "number" ? r.sentiment : null;
      box.innerHTML = r.summary
        ? `<div style="font-size:13px;line-height:1.5">${esc(r.summary)}</div>${senti != null ? `<div class="muted" style="font-size:11px;margin-top:3px">AI sentiment: <span class="${senti > 5 ? "senti-pos" : senti < -5 ? "senti-neg" : ""}">${senti >= 0 ? "+" : ""}${senti}</span></div>` : ""}`
        : `<span class="muted" style="font-size:12px">—</span>`;
    } catch (err) { box.innerHTML = `<span class="muted" style="font-size:12px">AI unavailable.</span>`; }
  }
  /* Per-entity social listening (YouTube + Reddit). */
  async function loadEntitySocial(e) {
    const box = document.getElementById("entSocial");
    if (!box) return;
    const token = ++S.socialToken;
    try {
      const s = await DATA.fetchSocial(e.name);
      if (token !== S.socialToken) return;
      const groups = [["YouTube", s.youtube], ["Bluesky", s.bluesky], ["Reddit", s.reddit], ["HackerNews", s.hackernews]];
      const items = groups.flatMap(([tag, arr]) => (arr || []).map(x => ({ ...x, tag })));
      const meta = document.getElementById("socialMeta");
      if (meta) meta.textContent = items.length ? `· ${items.length} mention(s) · sentiment ${s.sentiment >= 0 ? "+" : ""}${s.sentiment}` : "";
      if (!items.length) {
        const ytOff = s.configured && !s.configured.youtube;
        box.innerHTML = `<span class="muted" style="font-size:12px">No recent social mentions found${ytOff ? " — add <code>YOUTUBE_API_KEY</code> in Cloudflare for video coverage" : ""}.</span>`;
        return;
      }
      items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      box.innerHTML = items.slice(0, 14).map(n => `<div class="rel-item">
        <span class="chip">${n.tag}</span> <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <br><span class="muted" style="font-size:11px">${esc(n.source || "")}${n.date ? " · " + esc(n.date) : ""}${n.score != null ? " · ▲" + n.score : ""}</span></div>`).join("");
    } catch (err) {
      if (token === S.socialToken) box.innerHTML = `<span class="muted" style="font-size:12px">Social lookup unavailable.</span>`;
    }
  }
})();
