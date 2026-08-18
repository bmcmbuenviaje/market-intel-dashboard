/* Leaflet map: plots curated entities + live news events, colored by category. */
window.MAPVIEW = (function () {
  let map, entityLayer, newsLayer, catColor = {};

  function init() {
    map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([12.88, 121.77], 5);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19
    }).addTo(map);
    entityLayer = L.layerGroup().addTo(map);
    newsLayer = L.layerGroup().addTo(map);
  }

  function setCategoryColors(categories) {
    categories.forEach(c => { catColor[c.id] = c.color; });
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

    entities.forEach(e => {
      if (e.lat == null || e.lng == null) return;
      const color = catColor[e.category] || "#94a3b8";
      const m = L.marker([e.lat, e.lng], { icon: dot(color, 7) });
      m.bindPopup(`<b>${e.name}</b><br><span style="color:#8598b6">${e.category} · ${e.country}</span>
                   <br>${e.description || ""}`);
      m.on("click", () => document.dispatchEvent(new CustomEvent("mi:selectEntity", { detail: e.id })));
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

  return { init, setCategoryColors, render, focus, invalidate: () => map && map.invalidateSize() };
})();
