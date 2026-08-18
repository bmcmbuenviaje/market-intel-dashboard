/* Orchestrator: loads data, wires filters, renders map/graph/BD/feed. */
(function () {
  const S = {
    taxonomy: null, kb: null, news: [], sparkChart: null, reqToken: 0,
    tab: "targets", view: null
  };

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
    wireEvents();

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

  function renderAll(view) {
    S.view = view;
    FUSION.tagNewsToEntities(S.news, S.kb.entities);
    MAPVIEW.render(view.entities, S.news);
    MAPVIEW.focus(FILTERS.state.scope === "country" ? FILTERS.state.country : null, S.taxonomy);
    GRAPHVIEW.build(view.entities, view.relationships);
    renderIntel();
    renderFeed(S.news);
  }

  async function refresh() {
    const sources = window.getSources();
    const view = currentView();
    const token = ++S.reqToken; // guards against stale async renders after a filter change

    // 1) Curated layer paints instantly — never blocked by a slow/failing live feed.
    S.news = seedSignals(view.visibleIds);
    renderAll(view);
    status(`${view.entities.length} entities in view · curated layer loaded`);
    loadCommodities();

    // 2) Live news fetched in the background; merged in when (if) it arrives.
    if (sources.gdelt) {
      status(`${view.entities.length} entities · fetching live news…`);
      try {
        const country = FILTERS.state.scope === "country" ? FILTERS.state.country : "";
        const arts = await DATA.fetchNews({ query: buildQuery(), country, windowDays: FILTERS.state.windowDays });
        if (token !== S.reqToken) return; // a newer refresh superseded this one
        const live = arts.map(a => ({ ...a, sentiment: DATA.keywordSentiment(a.title), category: guessCategory(a.title) }));
        S.news = seedSignals(view.visibleIds).concat(live);
        renderAll(view);
        status(`${live.length} live articles · ${view.entities.length} entities in view`);
      } catch (e) {
        if (token !== S.reqToken) return;
        status("Live news unavailable (rate-limited or offline) — showing curated + seed signals.", false);
      }
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
    return `<div class="bd-card ${cls}" data-id="${t.id}">
        <div class="top">
          <span><strong>${t.name}</strong> <span class="muted">· ${t.category} · ${t.country}</span></span>
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
    if (S.tab === "targets") {
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
    const items = [...news].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 60);
    if (!items.length) { el.innerHTML = `<p class="muted" style="padding:8px">No signals. Deploy the proxy or widen filters.</p>`; return; }
    el.innerHTML = items.map(n => {
      const sc = n.sentiment > 5 ? "senti-pos" : n.sentiment < -5 ? "senti-neg" : "senti-neu";
      const v = n.verified === false ? `<span class="chip badge-unverified">unverified</span>` :
                n.verified === true ? `<span class="chip badge-verified">verified</span>` : "";
      return `<div class="feed-item">
        <a href="${n.url}" target="_blank" rel="noopener">${n.title}</a>
        <div class="meta">
          <span class="${sc}">sentiment ${n.sentiment >= 0 ? "+" : ""}${n.sentiment}</span>
          <span class="chip">${n.category || "—"}</span>
          <span>${n.domain || ""}</span><span>${n.date || ""}</span>${v}
        </div></div>`;
    }).join("");
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
      <div class="spark"><h4 style="font-size:12px;color:#8598b6">Sentiment trend (from signals)</h4>
        <canvas id="sparkCanvas" height="90"></canvas>
        <p class="muted" style="font-size:11px">${news.length} matched signal(s) in window.</p>
      </div>`;

    $("entityProfile").querySelectorAll("[data-nav]").forEach(a =>
      a.onclick = () => selectEntity(a.getAttribute("data-nav")));
    const ps = document.getElementById("profStar");
    if (ps) ps.onclick = () => { toggleWatch(e.id); selectEntity(e.id); renderIntel(); };
    drawSpark(news);
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
})();
