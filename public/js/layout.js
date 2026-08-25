/* Fluid resizable dashboard: draggable gutters between the grid columns/rows.
   Drag to resize (kept in fr so it stays fluid), double-click a gutter to reset
   that axis, sizes persist in localStorage. Disabled on the stacked mobile layout. */
(function () {
  const DEFAULT_COLS = "1.3fr 1.3fr 1fr", DEFAULT_ROWS = "1.4fr 1fr";
  let grid, gv1, gv2, gh;

  document.addEventListener("mi:authed", () => setTimeout(init, 400), { once: true });

  function init() {
    grid = document.querySelector("#app .grid");
    if (!grid || grid.dataset.resizable) return;
    grid.dataset.resizable = "1";
    grid.style.position = "relative";

    const saved = load();
    if (saved.cols) grid.style.gridTemplateColumns = saved.cols;
    if (saved.rows) grid.style.gridTemplateRows = saved.rows;

    gv1 = mk("col"); gv2 = mk("col"); gh = mk("row");
    grid.append(gv1, gv2, gh);
    drag(gv1, "col", 0); drag(gv2, "col", 1); drag(gh, "row", 0);
    gv1.ondblclick = () => resetAxis("col"); gv2.ondblclick = () => resetAxis("col"); gh.ondblclick = () => resetAxis("row");

    place();
    new ResizeObserver(place).observe(grid);
    window.addEventListener("resize", place);
  }

  function mk(kind) {
    const g = document.createElement("div");
    g.className = "gutter " + kind;
    return g;
  }
  function px(prop) { return getComputedStyle(grid)[prop].split(" ").map(parseFloat); }
  function gap() { return parseFloat(getComputedStyle(grid).columnGap) || 10; }
  function big() { return window.innerWidth > 1100; }

  function place() {
    if (!big()) { [gv1, gv2, gh].forEach(g => g.style.display = "none"); return; }
    [gv1, gv2, gh].forEach(g => g.style.display = "block");
    const c = px("gridTemplateColumns"), r = px("gridTemplateRows"), gp = gap(), H = grid.clientHeight;
    gv1.style.cssText += `;top:0;height:${H}px;left:${c[0] + gp / 2 - 3}px`;
    gv2.style.cssText += `;top:0;height:${H}px;left:${c[0] + gp + c[1] + gp / 2 - 3}px`;
    gh.style.cssText += `;left:0;width:${c[0] + gp + c[1]}px;top:${r[0] + gp / 2 - 3}px`;
  }

  function drag(handle, kind, i) {
    handle.addEventListener("pointerdown", (e) => {
      if (!big()) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId); handle.classList.add("active");
      const startPos = kind === "col" ? e.clientX : e.clientY;
      const sizes = px(kind === "col" ? "gridTemplateColumns" : "gridTemplateRows");
      const a0 = sizes[i], b0 = sizes[i + 1];
      const move = (ev) => {
        const d = (kind === "col" ? ev.clientX : ev.clientY) - startPos;
        let a = Math.max(140, a0 + d), b = Math.max(140, b0 - d);
        // keep the pair's combined size constant
        const sum = a0 + b0; if (a + b !== sum) { if (a === 140) b = sum - 140; else if (b === 140) a = sum - 140; }
        const next = sizes.slice(); next[i] = a; next[i + 1] = b;
        const total = next.reduce((x, y) => x + y, 0);
        const val = next.map(v => (v / total).toFixed(4) + "fr").join(" ");
        if (kind === "col") grid.style.gridTemplateColumns = val; else grid.style.gridTemplateRows = val;
        place(); reflow();
      };
      const up = (ev) => {
        handle.releasePointerCapture(ev.pointerId); handle.classList.remove("active");
        handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up);
        save(); reflow();
      };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
    });
  }

  function reflow() {
    try { window.MAPVIEW && MAPVIEW.invalidate(); } catch (e) {}
    try { window.cy && cy.resize(); } catch (e) {}
  }
  function save() {
    localStorage.setItem("mi_layout", JSON.stringify({ cols: grid.style.gridTemplateColumns, rows: grid.style.gridTemplateRows }));
  }
  function load() { try { return JSON.parse(localStorage.getItem("mi_layout")) || {}; } catch (e) { return {}; } }
  function resetAxis(kind) {
    if (kind === "col") grid.style.gridTemplateColumns = DEFAULT_COLS; else grid.style.gridTemplateRows = DEFAULT_ROWS;
    save(); place(); reflow();
  }
})();
