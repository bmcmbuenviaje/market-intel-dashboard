/* Full CRUD admin backed by /api/kb (Cloudflare KV, or the local file in dev). */
document.addEventListener("mi:authed", init, { once: true });

const S = { kb: null, taxonomy: null, dirty: false, source: "?", editingE: null, editingR: null };
const $ = (id) => document.getElementById(id);

const SOURCES = [
  { id: "gdelt", label: "GDELT live news", test: "/api/gdelt?query=partnership&days=7" },
  { id: "yahoo", label: "Yahoo Finance (commodities)", test: "/api/yahoo?symbol=GC=F" },
  { id: "wikidata", label: "Wikidata ownership", test: "/api/wikidata?id=Q1706083" },
  { id: "finnhub", label: "Finnhub company news (key)", test: "/api/finnhub?symbol=JFC.PS" },
  { id: "knowledge", label: "Knowledge base store (/api/kb)", test: "/api/kb" },
  { id: "news", label: "Live news feed (/api/news)", test: "/api/news?days=3" },
  { id: "social", label: "Social listening (/api/social)", test: "/api/social?q=Jollibee" }
];
const KEYS = [
  { id: "ADMIN_TOKEN", label: "Admin save token" },
  { id: "KB_STORE", label: "KV namespace binding" },
  { id: "FINNHUB_KEY", label: "Finnhub" },
  { id: "DIGEST_WEBHOOK", label: "Digest webhook" },
  { id: "YOUTUBE_API_KEY", label: "YouTube Data API (social)" },
  { id: "REDDIT_CLIENT_ID", label: "Reddit client id (social)" },
  { id: "REDDIT_CLIENT_SECRET", label: "Reddit client secret (social)" }
];

async function init() {
  try {
    S.taxonomy = await (await fetch("data/taxonomy.json")).json();
    const res = await fetch("/api/kb");
    S.source = res.headers.get("x-kb-source") || (res.ok ? "kv/file" : "?");
    if (!res.ok) throw new Error("kb " + res.status);
    S.kb = await res.json();
  } catch (e) {
    try { S.kb = await (await fetch("data/knowledge-base.json")).json(); S.source = "static (offline)"; }
    catch (e2) { alert("Failed to load knowledge base: " + e2.message); return; }
  }
  S.kb.entities = S.kb.entities || [];
  S.kb.relationships = S.kb.relationships || [];
  $("adminToken").value = sessionStorage.getItem("mi_admin_token") || "";
  populateSelectors();
  wire();
  refreshAll();
}

/* ---------- helpers ---------- */
const byId = (id) => S.kb.entities.find(e => e.id === id);
const nameOf = (id) => { const e = byId(id); return e ? e.name : id; };
const catLabel = (id) => { const c = (S.taxonomy.categories || []).find(x => x.id === id); return c ? c.label : id; };
function markDirty() { S.dirty = true; $("dirty").classList.remove("hidden"); }
function updateCounts() {
  $("counts").textContent = `${S.kb.entities.length} entities · ${S.kb.relationships.length} connections`;
  $("srcPill").textContent = "source: " + S.source;
  $("srcPill").className = "pill " + (S.source.startsWith("kv") ? "ok" : "warn");
}
function buildDatalist() {
  $("entIds").innerHTML = S.kb.entities.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function populateSelectors() {
  const cats = S.taxonomy.categories || [];
  $("eCatFilter").innerHTML = `<option value="">All categories</option>` + cats.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  $("f_category").innerHTML = cats.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
}

function refreshAll() { updateCounts(); buildDatalist(); renderEntities(); renderConnections(); }

/* ---------- tabs ---------- */
function wire() {
  document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
    document.querySelectorAll(".section").forEach(s => s.classList.toggle("active", s.id === "sec-" + t.dataset.sec));
    if (t.dataset.sec === "settings") renderSettings();
  });
  $("eSearch").oninput = renderEntities;
  $("eCatFilter").onchange = renderEntities;
  $("eAdd").onclick = () => openEntity(null);
  $("rSearch").oninput = renderConnections;
  $("rTypeFilter").onchange = renderConnections;
  $("rAdd").onclick = () => openConn(null);
  $("btnSave").onclick = save;
  $("eSaveBtn").onclick = saveEntity;
  $("rSaveBtn").onclick = saveConn;
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeModals);
  document.querySelectorAll(".modal").forEach(m => m.onclick = (e) => { if (e.target === m) closeModals(); });
  $("ioApply").onclick = applyImport;
  $("ioExport").onclick = exportJSON;
  $("ioFile").onchange = loadFile;
  $("adminToken").onchange = () => sessionStorage.setItem("mi_admin_token", $("adminToken").value.trim());
}

/* ---------- entities table ---------- */
function renderEntities() {
  const q = $("eSearch").value.trim().toLowerCase();
  const cat = $("eCatFilter").value;
  let list = S.kb.entities.filter(e => {
    if (cat && e.category !== cat) return false;
    if (!q) return true;
    return (e.name + " " + e.id + " " + (e.aliases || []).join(" ")).toLowerCase().includes(q);
  });
  const total = list.length; const shown = list.slice(0, 300);
  $("eCount").textContent = `${total} match${total === 1 ? "" : "es"}${total > 300 ? " (showing 300)" : ""}`;
  $("eRows").innerHTML = shown.map(e => `<tr>
    <td><strong>${esc(e.name)}</strong><br><span class="count">${esc(e.id)}</span></td>
    <td>${esc(catLabel(e.category))}</td><td>${esc(e.type || "")}${e.role ? " · " + esc(e.role) : ""}</td>
    <td>${e.parent ? esc(nameOf(e.parent)) : "—"}</td><td>${esc(e.country || "")}</td>
    <td style="white-space:nowrap">
      <button class="rowbtn" data-edit="${esc(e.id)}">Edit</button>
      <button class="rowbtn del" data-del="${esc(e.id)}">Delete</button></td></tr>`).join("");
  $("eRows").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openEntity(b.dataset.edit));
  $("eRows").querySelectorAll("[data-del]").forEach(b => b.onclick = () => deleteEntity(b.dataset.del));
}

function openEntity(id) {
  const e = id ? byId(id) : null;
  S.editingE = id;
  $("eModalTitle").textContent = e ? "Edit entity" : "Add entity";
  const g = (f, v) => { $(f).value = v == null ? "" : v; };
  g("f_id", e ? e.id : ""); $("f_id").disabled = !!e;
  g("f_name", e && e.name); g("f_category", e ? e.category : (S.taxonomy.categories[0] || {}).id);
  $("f_type").value = e ? (e.type || "company") : "company";
  g("f_role", e && e.role); g("f_country", e ? e.country : "PH"); g("f_parent", e && e.parent);
  g("f_ticker", e && e.ticker); g("f_website", e && e.website);
  g("f_lat", e && e.lat); g("f_lng", e && e.lng);
  g("f_aliases", e && (e.aliases || []).join(", ")); g("f_desc", e && e.description);
  $("eModal").classList.add("open");
}
function saveEntity() {
  const id = $("f_id").value.trim();
  const name = $("f_name").value.trim();
  if (!id || !name) return alert("ID and Name are required.");
  if (!S.editingE && byId(id)) return alert("That ID already exists.");
  const obj = { id, name, category: $("f_category").value, type: $("f_type").value, country: $("f_country").value.trim() || "PH" };
  const opt = (k, f, num) => { const v = $(f).value.trim(); if (v) obj[k] = num ? parseFloat(v) : v; };
  opt("role", "f_role"); opt("parent", "f_parent"); opt("ticker", "f_ticker"); opt("website", "f_website");
  opt("lat", "f_lat", true); opt("lng", "f_lng", true); opt("description", "f_desc");
  const al = $("f_aliases").value.split(",").map(s => s.trim()).filter(Boolean);
  if (al.length) obj.aliases = al;
  if (S.editingE) { const i = S.kb.entities.findIndex(x => x.id === S.editingE); S.kb.entities[i] = obj; }
  else S.kb.entities.push(obj);
  markDirty(); closeModals(); refreshAll();
}
function deleteEntity(id) {
  const edges = S.kb.relationships.filter(r => r.source === id || r.target === id).length;
  if (!confirm(`Delete "${nameOf(id)}"?` + (edges ? `\nThis also removes ${edges} connection(s) referencing it.` : ""))) return;
  S.kb.entities = S.kb.entities.filter(e => e.id !== id);
  S.kb.relationships = S.kb.relationships.filter(r => r.source !== id && r.target !== id);
  markDirty(); refreshAll();
}

/* ---------- connections table ---------- */
function renderConnections() {
  const q = $("rSearch").value.trim().toLowerCase();
  const ty = $("rTypeFilter").value;
  let list = S.kb.relationships.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (ty && r.type !== ty) return false;
    if (!q) return true;
    return (nameOf(r.source) + " " + nameOf(r.target) + " " + (r.label || "")).toLowerCase().includes(q);
  });
  const total = list.length; const shown = list.slice(0, 300);
  $("rCount").textContent = `${total} match${total === 1 ? "" : "es"}${total > 300 ? " (showing 300)" : ""}`;
  $("rRows").innerHTML = shown.map(({ r, i }) => `<tr>
    <td>${esc(nameOf(r.source))}</td><td>${esc(r.type)}</td><td>${esc(nameOf(r.target))}</td>
    <td>${esc(r.label || "")}</td><td>${r.verified === true ? "✓" : r.verified === false ? "unverified" : "—"}</td>
    <td style="white-space:nowrap">
      <button class="rowbtn" data-edit="${i}">Edit</button>
      <button class="rowbtn del" data-del="${i}">Delete</button></td></tr>`).join("");
  $("rRows").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openConn(+b.dataset.edit));
  $("rRows").querySelectorAll("[data-del]").forEach(b => b.onclick = () => deleteConn(+b.dataset.del));
}
function openConn(i) {
  const r = i == null ? null : S.kb.relationships[i];
  S.editingR = i;
  $("rModalTitle").textContent = r ? "Edit connection" : "Add connection";
  $("r_source").value = r ? r.source : "";
  $("r_type").value = r ? r.type : "owns";
  $("r_target").value = r ? r.target : "";
  $("r_label").value = r && r.label || "";
  $("r_url").value = r && r.url || "";
  $("r_date").value = r && r.date || "";
  $("r_verified").checked = r ? r.verified === true : false;
  $("rModal").classList.add("open");
}
function saveConn() {
  const source = $("r_source").value.trim(), target = $("r_target").value.trim();
  if (!source || !target) return alert("Source and Target are required.");
  if (!byId(source)) return alert("Source id not found: " + source);
  if (!byId(target)) return alert("Target id not found: " + target);
  if (source === target) return alert("Source and target must differ.");
  const obj = { source, target, type: $("r_type").value };
  const l = $("r_label").value.trim(); if (l) obj.label = l;
  const u = $("r_url").value.trim(); if (u) obj.url = u;
  const d = $("r_date").value.trim(); if (d) obj.date = d;
  if (u || $("r_verified").checked) obj.verified = $("r_verified").checked;
  if (S.editingR != null) S.kb.relationships[S.editingR] = obj; else S.kb.relationships.push(obj);
  markDirty(); closeModals(); refreshAll();
}
function deleteConn(i) {
  const r = S.kb.relationships[i];
  if (!confirm(`Delete connection ${nameOf(r.source)} —${r.type}→ ${nameOf(r.target)}?`)) return;
  S.kb.relationships.splice(i, 1); markDirty(); refreshAll();
}
function closeModals() { document.querySelectorAll(".modal").forEach(m => m.classList.remove("open")); }

/* ---------- import / export ---------- */
function loadFile(e) {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader(); rd.onload = () => { $("ioText").value = rd.result; }; rd.readAsText(f);
}
function applyImport() {
  const mode = document.querySelector('input[name=ioMode]:checked').value;
  let data;
  try { data = JSON.parse($("ioText").value); } catch (e) { return log("Invalid JSON: " + e.message); }
  let ents = [], rels = [];
  if (Array.isArray(data)) { // guess by shape
    if (data[0] && data[0].source && data[0].target) rels = data; else ents = data;
  } else { ents = data.entities || []; rels = data.relationships || []; }
  if (mode === "replace") { S.kb.entities = []; S.kb.relationships = []; }
  const idx = Object.fromEntries(S.kb.entities.map((e, i) => [e.id, i]));
  let addedE = 0, updE = 0;
  ents.forEach(e => { if (!e.id) return; if (idx[e.id] != null) { S.kb.entities[idx[e.id]] = e; updE++; } else { idx[e.id] = S.kb.entities.length; S.kb.entities.push(e); addedE++; } });
  const seen = new Set(S.kb.relationships.map(r => r.source + "|" + r.target + "|" + r.type));
  let addedR = 0;
  rels.forEach(r => { const k = r.source + "|" + r.target + "|" + r.type; if (!seen.has(k)) { seen.add(k); S.kb.relationships.push(r); addedR++; } });
  // drop dangling
  const ids = new Set(S.kb.entities.map(e => e.id));
  const before = S.kb.relationships.length;
  S.kb.relationships = S.kb.relationships.filter(r => ids.has(r.source) && ids.has(r.target));
  markDirty(); refreshAll();
  log(`Imported (${mode}): +${addedE} entities, ${updE} updated, +${addedR} connections. Dropped ${before - S.kb.relationships.length} dangling. Remember to Save.`);
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(S.kb, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "knowledge-base.json"; a.click(); URL.revokeObjectURL(a.href);
}
function log(m) { $("ioLog").textContent = m + "\n" + $("ioLog").textContent; }

/* ---------- save to server ---------- */
async function save() {
  const token = $("adminToken").value.trim();
  sessionStorage.setItem("mi_admin_token", token);
  $("btnSave").textContent = "Saving…"; $("btnSave").disabled = true;
  try {
    const res = await fetch("/api/kb", { method: "PUT",
      headers: { "content-type": "application/json", "X-Admin-Token": token },
      body: JSON.stringify(S.kb) });
    const j = await res.json();
    if (res.ok && j.ok) {
      S.dirty = false; $("dirty").classList.add("hidden");
      S.source = "kv"; updateCounts();
      $("btnSave").textContent = `✓ Saved ${j.entities}/${j.relationships}`;
    } else {
      $("btnSave").textContent = "💾 Save to server";
      alert("Save failed: " + (j.error || res.status) +
        (res.status === 403 ? "\n\nSet ADMIN_TOKEN in Cloudflare env vars." :
         res.status === 401 ? "\n\nThe admin token doesn't match ADMIN_TOKEN." :
         res.status === 501 ? "\n\nBind a KV namespace as KB_STORE." : ""));
    }
  } catch (e) { alert("Save error: " + e.message); $("btnSave").textContent = "💾 Save to server"; }
  finally { $("btnSave").disabled = false; setTimeout(() => { $("btnSave").textContent = "💾 Save to server"; }, 4000); }
}

/* ---------- settings ---------- */
let settingsRendered = false;
function renderSettings() {
  if (settingsRendered) return; settingsRendered = true;
  const cur = window.getSources();
  const sr = $("sourceRows"); sr.innerHTML = "";
  SOURCES.forEach(s => {
    const on = s.id === "knowledge" ? true : !!cur[s.id];
    const row = document.createElement("div"); row.className = "row"; row.innerHTML = `<span>${s.label}</span>`;
    const t = document.createElement("div"); t.className = "toggle" + (on ? " on" : ""); t.innerHTML = "<span></span>";
    if (s.id === "knowledge") t.style.opacity = ".5";
    t.onclick = () => { if (s.id === "knowledge") return; const c = window.getSources(); c[s.id] = !c[s.id]; localStorage.setItem("mi_sources", JSON.stringify(c)); renderSettingsReset(); };
    row.appendChild(t); sr.appendChild(row);
  });
  const tr = $("testRows"); tr.innerHTML = "";
  SOURCES.forEach(s => {
    const row = document.createElement("div"); row.className = "row"; row.innerHTML = `<span>${s.label}</span>`;
    const w = document.createElement("div");
    const pill = document.createElement("span"); pill.className = "pill"; pill.id = "pill-" + s.id; pill.textContent = "untested";
    const b = document.createElement("button"); b.className = "rowbtn"; b.textContent = "Test"; b.style.marginLeft = "8px"; b.onclick = () => runTest(s);
    w.appendChild(pill); w.appendChild(b); row.appendChild(w); tr.appendChild(row);
  });
  $("btnTestAll").onclick = () => SOURCES.forEach(runTest);
  const saved = JSON.parse(localStorage.getItem("mi_keys_set") || "{}");
  const kc = $("keyChecklist"); kc.innerHTML = "";
  KEYS.forEach(k => {
    const row = document.createElement("div"); row.className = "row";
    row.innerHTML = `<span>${k.label} <code>${k.id}</code></span>`;
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!saved[k.id];
    cb.onchange = () => { saved[k.id] = cb.checked; localStorage.setItem("mi_keys_set", JSON.stringify(saved)); };
    row.appendChild(cb); kc.appendChild(row);
  });
}
function renderSettingsReset() { settingsRendered = false; renderSettings(); }
async function runTest(s) {
  const pill = $("pill-" + s.id); if (!pill) return;
  pill.className = "pill"; pill.textContent = "…";
  try { const r = await fetch(s.test); const j = await r.json().catch(() => ({}));
    if (r.ok && !j.error) { pill.className = "pill ok"; pill.textContent = "ok"; }
    else { pill.className = "pill err"; pill.textContent = j.error ? String(j.error).slice(0, 22) : "err " + r.status; }
  } catch (e) { pill.className = "pill err"; pill.textContent = "unreachable"; }
}
