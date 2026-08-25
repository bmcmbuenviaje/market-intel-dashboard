/* Leaflet Signal Map: clustered entities (sized by news activity, ringed by
   sentiment, pulsing when hot), relationship connection lines, a news heatmap,
   commodity chokepoints, live weather (Open-Meteo, no key), clickable country
   pins that filter the whole dashboard, and a layer toggle. */
window.MAPVIEW = (function () {
  let map, entityLayer, newsLayer, connLayer, chokeLayer, wxLayer, countryLayer, heatLayer;
  let catColor = {}, relStyle = {}, taxo = null;

  const CHOKEPOINTS = [
    { n: "Port of Manila", lat: 14.60, lng: 120.96 }, { n: "Batangas Port", lat: 13.75, lng: 121.05 },
    { n: "Subic Bay Freeport", lat: 14.79, lng: 120.28 }, { n: "Cebu Port", lat: 10.30, lng: 123.90 },
    { n: "Davao Port", lat: 7.07, lng: 125.63 }, { n: "Clark Freeport", lat: 15.18, lng: 120.55 },
    { n: "Luzon Strait (shipping lane)", lat: 20.4, lng: 121.5 }, { n: "South China Sea lane", lat: 15.5, lng: 116.5 },
    { n: "Strait of Malacca", lat: 2.5, lng: 101.3 }
  ];
  const WX = [
    { n: "Manila", lat: 14.60, lng: 120.98 }, { n: "Cebu", lat: 10.32, lng: 123.90 },
    { n: "Davao", lat: 7.19, lng: 125.46 }, { n: "Clark", lat: 15.17, lng: 120.59 }
  ];
  const WCODE = { 0: "☀️ Clear", 1: "🌤️ Mainly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast", 45: "🌫️ Fog", 48: "🌫️ Fog",
    51: "🌦️ Drizzle", 53: "🌦️ Drizzle", 55: "🌦️ Drizzle", 61: "🌧️ Rain", 63: "🌧️ Rain", 65: "🌧️ Heavy rain",
    80: "🌦️ Showers", 81: "🌦️ Showers", 82: "⛈️ Heavy showers", 95: "⛈️ Thunderstorm", 96: "⛈️ Thunderstorm", 99: "⛈️ Thunderstorm" };

  function init() {
    map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([12.88, 121.77], 5);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19 }).addTo(map);
    entityLayer = (L.markerClusterGroup
      ? L.markerClusterGroup({ maxClusterRadius: 45, spiderfyOnMaxZoom: true, chunkedLoading: true, showCoverageOnHover: false })
      : L.layerGroup()).addTo(map);
    newsLayer = L.layerGroup().addTo(map);
    connLayer = L.layerGroup();
    chokeLayer = L.layerGroup();
    wxLayer = L.layerGroup();
    countryLayer = L.layerGroup();
    heatLayer = L.heatLayer ? L.heatLayer([], { radius: 26, blur: 18, maxZoom: 9, gradient: { 0.4: "#38bdf8", 0.7: "#f59e0b", 1: "#ef4444" } }) : null;
  }

  function setTaxonomy(t) {
    taxo = t;
    (t.categories || []).forEach(c => { catColor[c.id] = c.color; });
    (t.relationshipTypes || []).forEach(r => { relStyle[r.id] = r; });
    addLegend(t.categories || []);
    buildCountries(t.countries || []);
    buildChokepoints();
    loadWeather();
    const overlays = { "🏢 Entities": entityLayer, "🔗 Connections": connLayer, "⚓ Chokepoints": chokeLayer, "🌦️ Weather": wxLayer, "🌏 Countries": countryLayer };
    if (heatLayer) overlays["🔥 News heat"] = heatLayer;
    L.control.layers(null, overlays, { collapsed: true, position: "topright" }).addTo(map);
  }
  // back-compat shim
  function setCategoryColors(categories) { (categories || []).forEach(c => { catColor[c.id] = c.color; }); }

  function addLegend(categories) {
    if (map._legendAdded) return; map._legendAdded = true;
    const lc = L.control({ position: "bottomright" });
    lc.onAdd = () => { const d = L.DomUtil.create("div", "map-legend"); d.innerHTML = categories.map(c => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join(""); return d; };
    lc.addTo(map);
  }

  function dot(color, r, opt) {
    opt = opt || {};
    const ring = opt.ring || "rgba(255,255,255,.28)";
    const pulse = opt.pulse ? `<span class="mk-pulse" style="border-color:${ring}"></span>` : "";
    return L.divIcon({
      className: "",
      html: `<span class="mk" style="position:relative;display:block;width:${r * 2}px;height:${r * 2}px">${pulse}
             <span style="position:absolute;inset:0;border-radius:50%;background:${color};box-shadow:0 0 0 2px ${ring},0 0 10px ${color}"></span></span>`,
      iconSize: [r * 2, r * 2], iconAnchor: [r, r]
    });
  }

  function render(entities, news, relationships) {
    entityLayer.clearLayers(); newsLayer.clearLayers(); connLayer.clearLayers();
    const byId = {}; entities.forEach(e => { byId[e.id] = e; });

    // per-entity activity + sentiment from tagged news
    const act = {}, sen = {}, cnt = {};
    (news || []).forEach(n => (n.entityIds || []).forEach(id => {
      act[id] = (act[id] || 0) + 1;
      if (typeof n.sentiment === "number") { sen[id] = (sen[id] || 0) + n.sentiment; cnt[id] = (cnt[id] || 0) + 1; }
    }));

    const heatPts = [];
    entities.forEach(e => {
      if (e.lat == null || e.lng == null) return;
      const color = catColor[e.category] || "#94a3b8";
      const n = act[e.id] || 0;
      const s = cnt[e.id] ? Math.round(sen[e.id] / cnt[e.id]) : 0;
      const ring = s > 6 ? "rgba(34,197,94,.9)" : s < -6 ? "rgba(248,113,113,.9)" : "rgba(255,255,255,.28)";
      const r = 6 + Math.min(n * 1.6, 12);
      const m = L.marker([e.lat, e.lng], { icon: dot(color, r, { ring, pulse: n > 0 }) });
      m.bindPopup(`<b>${e.name}</b><br><span style="color:#8598b6">${e.category} · ${e.country}</span>
        ${n ? `<br><span style="color:#38bdf8">${n} recent signal${n > 1 ? "s" : ""}${cnt[e.id] ? ` · sentiment ${s >= 0 ? "+" : ""}${s}` : ""}</span>` : ""}
        <br>${e.description || ""}<br><a href="#" onclick="event.preventDefault();document.dispatchEvent(new CustomEvent('mi:focusEntity',{detail:'${e.id}'}))">Focus →</a>`);
      m.on("click", () => document.dispatchEvent(new CustomEvent("mi:focusEntity", { detail: e.id })));
      entityLayer.addLayer(m);
      if (n > 0) heatPts.push([e.lat, e.lng, Math.min(n / 4, 1)]);
    });
    if (heatLayer) heatLayer.setLatLngs(heatPts);

    // connection lines between entities that both have coords
    let drawn = 0;
    (relationships || []).forEach(rel => {
      if (drawn > 500) return;
      const a = byId[rel.source], b = byId[rel.target];
      if (!a || !b || a.lat == null || b.lat == null || (a.lat === b.lat && a.lng === b.lng)) return;
      const st = relStyle[rel.type] || { color: "#94a3b8", style: "solid" };
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
        color: st.color, weight: 1, opacity: .5,
        dashArray: st.style === "dashed" ? "5,5" : st.style === "dotted" ? "2,5" : null
      }).bindPopup(`${a.name} <b>${rel.type}</b> ${b.name}`).addTo(connLayer);
      drawn++;
    });

    (news || []).forEach(nw => {
      if (nw.lat == null || nw.lng == null) return;
      L.circleMarker([nw.lat, nw.lng], { radius: 5, color: "#38bdf8", fillOpacity: .5, weight: 1 })
        .bindPopup(`<b>${nw.title}</b><br><a href="${nw.url}" target="_blank" rel="noopener">Read →</a>`).addTo(newsLayer);
    });
  }

  function buildCountries(countries) {
    countryLayer.clearLayers();
    countries.forEach(c => {
      if (c.lat == null) return;
      const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: "", html: `<span class="country-pin">${c.label}</span>`, iconSize: [80, 18], iconAnchor: [40, 9] }) });
      m.on("click", () => document.dispatchEvent(new CustomEvent("mi:filterCountry", { detail: c.code })));
      m.bindTooltip(`Filter dashboard to ${c.label}`, { direction: "top" });
      countryLayer.addLayer(m);
    });
  }
  function buildChokepoints() {
    CHOKEPOINTS.forEach(c => {
      L.marker([c.lat, c.lng], { icon: L.divIcon({ className: "", html: `<span class="choke">⚓</span>`, iconSize: [18, 18], iconAnchor: [9, 9] }) })
        .bindPopup(`<b>⚓ ${c.n}</b><br><span style="color:#8598b6">key logistics / trade chokepoint</span>`).addTo(chokeLayer);
    });
  }
  async function loadWeather() {
    for (const c of WX) {
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&current=temperature_2m,weather_code,wind_speed_10m`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const d = (await r.json()).current || {};
        const desc = WCODE[d.weather_code] || "—";
        L.marker([c.lat, c.lng], { icon: L.divIcon({ className: "", html: `<span class="wx">${(desc.split(" ")[0]) || "🌡️"}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindPopup(`<b>${c.n}</b><br>${desc} · ${Math.round(d.temperature_2m)}°C<br><span style="color:#8598b6">wind ${Math.round(d.wind_speed_10m)} km/h</span>`).addTo(wxLayer);
      } catch (e) { /* skip */ }
    }
  }

  function focus(country) { if (!country) { map.setView([15, 40], 2); return; } const c = (taxo.countries || []).find(x => x.code === country); if (c) map.setView([c.lat, c.lng], 6); }
  function centerOn(lat, lng, zoom) { if (map && lat != null && lng != null) map.setView([lat, lng], zoom || 7); }

  return { init, setTaxonomy, setCategoryColors, render, focus, centerOn, invalidate: () => map && map.invalidateSize() };
})();
