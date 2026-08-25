/* Rearrangeable + resizable dashboard via GridStack.
   Drag a panel by its header to move it, drag any edge/corner to resize.
   Layout persists per-browser in localStorage; Leaflet/Cytoscape reflow on change.
   Double-click the brand logo to reset the layout. */
(function () {
  let grid;
  document.addEventListener("mi:authed", () => setTimeout(init, 450), { once: true });

  function cell() { return Math.max(46, Math.floor((window.innerHeight - 140) / 12)); }

  function init() {
    const el = document.getElementById("dash");
    if (!el || !window.GridStack || el.dataset.gridInit) return;
    el.dataset.gridInit = "1";
    grid = GridStack.init({
      column: 12, cellHeight: cell(), margin: 5, float: false, minRow: 1,
      handle: ".panel-head",
      draggable: { handle: ".panel-head", cancel: ".seg, .graph-actions, button, input, select, a" },
      resizable: { handles: "e, se, s, sw, w, n, ne, nw" },
      columnOpts: { breakpoints: [{ w: 820, c: 1 }] }
    }, el);
    window.__grid = grid;

    try { const s = JSON.parse(localStorage.getItem("mi_grid") || "null"); if (s && s.length) grid.load(s); } catch (e) {}
    grid.on("resizestop dragstop change", () => { reflow(); save(); });
    window.addEventListener("resize", () => { grid.cellHeight(cell()); reflow(); });

    const brand = document.querySelector(".topbar .brand");
    if (brand) { brand.style.cursor = "pointer"; brand.title = "Double-click to reset layout"; brand.ondblclick = resetLayout; }
    reflow();
  }

  function reflow() {
    setTimeout(() => {
      try { window.MAPVIEW && MAPVIEW.invalidate(); } catch (e) {}
      try { window.cy && cy.resize(); } catch (e) {}
    }, 90);
  }
  function save() { try { localStorage.setItem("mi_grid", JSON.stringify(grid.save(false))); } catch (e) {} }
  function resetLayout() {
    localStorage.removeItem("mi_grid");
    const def = { map: [0, 0, 5, 6], graph: [5, 0, 4, 6], side: [9, 0, 3, 12], bd: [0, 6, 5, 6], feed: [5, 6, 4, 6] };
    grid.batchUpdate();
    grid.engine.nodes.forEach(n => { const d = def[n.el.getAttribute("gs-id")]; if (d) grid.update(n.el, { x: d[0], y: d[1], w: d[2], h: d[3] }); });
    grid.commit(); reflow(); save();
  }
})();
