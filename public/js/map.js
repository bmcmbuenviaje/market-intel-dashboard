/* Leaflet map: plots curated entities + live news events, colored by category. */
window.MAPVIEW = (function () {
  let map, entityLayer, newsLayer, catColor = {};

  function init() {
    map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([12.88, 121.77], 5);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19
    }).addTo(map);
    entityLayer = (L.markerClusterGroup
      ? L.markerClusterGroup({ maxClusterRadius: 45, spiderfyOnMaxZoom: true, chunkedLoading: true, showCoverageOnHover: false })
      : L.layerGroup()).addTo(map);
    newsLayer = L.layerGroup().addTo(map);
  }

  function setCategoryColors(categories) {
    categories.forEach(c => { catColor[c.id] = c.color; });
    if (map && !map._legendAdded) {
      map._legendAdded = true;
      const lc = L.control({ position: "bottomright" });
      lc.onAdd = () => {
        const d = L.DomUtil.create("div", "map-legend");
        d.innerHTML = categories.map(c => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join("");
        return d;
      };
      lc.addTo(map);
    }
  }

  function dot(color, r) {
    return L.divIcon({
      className: "",
      html: `<span style="display:block;width:${r*2}px;height:${r*2}px;border-radius:50%;
             background:${color};box-shadow:0 0 0 2px rgba(255,255,255,.25),0 0 12px ${color};"></span>`,
      iconSize: [r*2, r*2], iconAnchor: [r, r]
    });
  }

  function render(entities, news) {
    entityLayer.clearLayers();
    newsLayer.clearLayers();

    // activity = recent-news count per entity → drives marker size (where's the action)
    const act = {};
    (news || []).forEach(n => (n.entityIds || []).forEach(id => { act[id] = (act[id] || 0) + 1; }));

    entities.forEach(e => {
      if (e.lat == null || e.lng == null) return;
      const color = catColor[e.category] || "#94a3b8";
      const n = act[e.id] || 0;
      const r = 6 + Math.min(n * 1.6, 12);
      const m = L.marker([e.lat, e.lng], { icon: dot(color, r) });
      m.bindPopup(`<b>${e.name}</b><br><span style="color:#8598b6">${e.category} · ${e.country}</span>
                   ${n ? `<br><span style="color:#38bdf8">${n} recent signal${n > 1 ? "s" : ""}</span>` : ""}
                   <br>${e.description || ""}<br><a href="#" onclick="event.preventDefault();document.dispatchEvent(new CustomEvent('mi:focusEntity',{detail:'${e.id}'}))">Focus →</a>`);
      m.on("click", () => document.dispatchEvent(new CustomEvent("mi:focusEntity", { detail: e.id })));
      entityLayer.addLayer(m);
    });

    (news || []).forEach(n => {
      if (n.lat == null || n.lng == null) return;
      const color = catColor[n.category] || "#38bdf8";
      const m = L.circleMarker([n.lat, n.lng], {
        radius: 5, color, fillColor: color, fillOpacity: .5, weight: 1
      });
      m.bindPopup(`<b>${n.title}</b><br>
        <span style="color:#8598b6">${n.domain || ""} · ${n.date || ""}</span><br>
        <a href="${n.url}" target="_blank" rel="noopener">Read →</a>`);
      newsLayer.addLayer(m);
    });
  }

  function focus(country, taxonomy) {
    if (!country) { map.setView([15, 40], 2); return; }
    const c = (taxonomy.countries || []).find(x => x.code === country);
    if (c) map.setView([c.lat, c.lng], 6);
  }

  function centerOn(lat, lng, zoom) { if (map && lat != null && lng != null) map.setView([lat, lng], zoom || 7); }

  return { init, setCategoryColors, render, focus, centerOn, invalidate: () => map && map.invalidateSize() };
})();
