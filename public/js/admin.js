/* Admin: source toggles, connection tests, and a knowledge-base editor that
   exports a merged JSON to commit (static hosting can't write files). */
document.addEventListener("mi:authed", init, { once: true });

const SOURCES = [
  { id: "gdelt", label: "GDELT live news", test: "/api/gdelt?query=partnership&days=7" },
  { id: "yahoo", label: "Yahoo Finance (commodities)", test: "/api/yahoo?symbol=GC=F" },
  { id: "wikidata", label: "Wikidata ownership", test: "/api/wikidata?id=Q1706083" },
  { id: "finnhub", label: "Finnhub company news (key)", test: "/api/finnhub?symbol=JFC.PS" },
  { id: "knowledge", label: "Curated knowledge base", test: "data/knowledge-base.json" }
];
const KEYS = [
  { id: "FINNHUB_KEY", label: "Finnhub" },
  { id: "OPENCORP_KEY", label: "OpenCorporates (future)" },
  { id: "SENTIMENT_KEY", label: "Sentiment API (future)" }
];

let kb = null, pending = { entities: [], relationships: [] };

async function init() {
  renderSources();
  renderTests();
  renderKeyChecklist();
  try {
    kb = await (await fetch("data/knowledge-base.json")).json();
    populateKB();
  } catch (e) { log("Could not load knowledge base: " + e.message); }
}

/* ---- sources ---- */
function renderSources() {
  const cur = window.getSources();
  const el = document.getElementById("sourceRows");
  el.innerHTML = "";
  SOURCES.forEach(s => {
    const on = s.id === "knowledge" ? true : !!cur[s.id];
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${s.label}</span>`;
    const t = document.createElement("div");
    t.className = "toggle" + (on ? " on" : "");
    if (s.id === "knowledge") t.style.opacity = ".5";
    t.innerHTML = "<span></span>";
    t.onclick = () => {
      if (s.id === "knowledge") return;
      const c = window.getSources(); c[s.id] = !c[s.id];
      localStorage.setItem("mi_sources", JSON.stringify(c));
      renderSources();
    };
    row.appendChild(t);
    el.appendChild(row);
  });
}

/* ---- tests ---- */
function renderTests() {
  const el = document.getElementById("testRows");
  el.innerHTML = "";
  SOURCES.forEach(s => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${s.label}</span>`;
    const wrap = document.createElement("div");
    const pill = document.createElement("span"); pill.className = "pill"; pill.textContent = "untested"; pill.id = "pill-" + s.id;
    const btn = document.createElement("button"); btn.className = "mini"; btn.textContent = "Test";
    btn.style.marginLeft = "8px";
    btn.onclick = () => runTest(s);
    wrap.appendChild(pill); wrap.appendChild(btn);
    row.appendChild(wrap); el.appendChild(row);
  });
  document.getElementById("btnTestAll").onclick = () => SOURCES.forEach(runTest);
}
async function runTest(s) {
  const pill = document.getElementById("pill-" + s.id);
  pill.className = "pill"; pill.textContent = "…";
  try {
    const r = await fetch(s.test);
    const j = await r.json().catch(() => ({}));
    if (r.ok && !j.error) { pill.className = "pill ok"; pill.textContent = "ok"; }
    else { pill.className = "pill err"; pill.textContent = j.error ? String(j.error).slice(0, 24) : "err " + r.status; }
  } catch (e) { pill.className = "pill err"; pill.textContent = "unreachable"; }
}

/* ---- key checklist ---- */
function renderKeyChecklist() {
  const saved = JSON.parse(localStorage.getItem("mi_keys_set") || "{}");
  const el = document.getElementById("keyChecklist");
  el.innerHTML = "";
  KEYS.forEach(k => {
    const row = document.createElement("div"); row.className = "row";
    row.innerHTML = `<span>${k.label} <code>(${k.id})</code></span>`;
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!saved[k.id];
    cb.onchange = () => { saved[k.id] = cb.checked; localStorage.setItem("mi_keys_set", JSON.stringify(saved)); };
    row.appendChild(cb); el.appendChild(row);
  });
}

/* ---- KB editor ---- */
function populateKB() {
  const cat = document.getElementById("eCat");
  fetch("data/taxonomy.json").then(r => r.json()).then(t => {
    t.categories.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.label; cat.appendChild(o); });
  });
  statsKB();
  document.getElementById("btnAddEntity").onclick = addEntity;
  document.getElementById("btnAddRel").onclick = addRel;
  document.getElementById("btnDownloadKB").onclick = downloadKB;
  document.getElementById("btnResetKB").onclick = () => { pending = { entities: [], relationships: [] }; statsKB(); log("Pending edits cleared."); };
}
function statsKB() {
  document.getElementById("kbStats").textContent =
    `${kb.entities.length} entities · ${kb.relationships.length} relationships · ${pending.entities.length + pending.relationships.length} pending edit(s)`;
}
function val(id) { return document.getElementById(id).value.trim(); }
function addEntity() {
  const e = { id: val("eId"), name: val("eName"), category: val("eCat"), country: val("eCountry"),
    type: val("eType"), description: val("eDesc") };
  const parent = val("eParent"); if (parent) e.parent = parent;
  if (!e.id || !e.name) return log("Entity needs id + name.");
  pending.entities.push(e); statsKB(); log("Queued entity: " + e.name);
}
function addRel() {
  const r = { source: val("rSrc"), target: val("rTgt"), type: document.getElementById("rType").value };
  const label = val("rLabel"); if (label) r.label = label;
  const url = val("rUrl"); if (url) { r.url = url; r.verified = false; }
  if (!r.source || !r.target) return log("Relationship needs source + target IDs.");
  pending.relationships.push(r); statsKB(); log(`Queued relationship: ${r.source} —${r.type}→ ${r.target}`);
}
function downloadKB() {
  const merged = JSON.parse(JSON.stringify(kb));
  merged.entities.push(...pending.entities);
  merged.relationships.push(...pending.relationships);
  merged._meta = merged._meta || {};
  merged._meta.lastUpdated = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(merged, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "knowledge-base.json"; a.click();
  URL.revokeObjectURL(a.href);
  log("Downloaded merged knowledge-base.json — replace public/data/ and commit.");
}
function log(m) { const el = document.getElementById("kbLog"); el.textContent = m + "\n" + el.textContent; }
