/* Cytoscape relationship graph: ownership / partnership / competition / regulation. */
window.GRAPHVIEW = (function () {
  let cy, catColor = {}, relStyle = {};

  function setColors(categories, relTypes) {
    categories.forEach(c => { catColor[c.id] = c.color; });
    relTypes.forEach(r => { relStyle[r.id] = r; });
  }

  function init() {
    cy = cytoscape({
      container: document.getElementById("graph"),
      wheelSensitivity: 0.2,
      style: [
        { selector: "node", style: {
            "background-color": "data(color)",
            "label": "data(label)", "color": "#e6edf7", "font-size": 10,
            "text-valign": "bottom", "text-margin-y": 3, "text-wrap": "wrap", "text-max-width": 90,
            "width": "data(size)", "height": "data(size)",
            "border-width": 1, "border-color": "rgba(255,255,255,.25)"
        }},
        { selector: "node[type='regulator']", style: { "shape": "diamond" } },
        { selector: "node[role='parent'], node[role='ultimate-owner']", style: { "shape": "round-rectangle" } },
        { selector: "node:selected", style: { "border-width": 3, "border-color": "#38bdf8" } },
        { selector: "edge", style: {
            "width": 1.5, "curve-style": "bezier",
            "line-color": "data(color)", "target-arrow-color": "data(color)",
            "target-arrow-shape": "data(arrow)", "line-style": "data(lineStyle)",
            "label": "data(label)", "font-size": 8, "color": "#8598b6",
            "text-rotation": "autorotate", "text-background-color": "#121a2b",
            "text-background-opacity": .8, "text-background-padding": 2
        }},
        { selector: "edge:selected", style: { "width": 3 } }
      ],
      layout: { name: "cose", animate: false }
    });

    cy.on("tap", "node", (evt) => {
      document.dispatchEvent(new CustomEvent("mi:selectEntity", { detail: evt.target.id() }));
    });
    window.cy = cy; // exposed for debugging/inspection
  }

  function build(entities, relationships) {
    const ids = new Set(entities.map(e => e.id));
    const els = [];
    entities.forEach(e => {
      const size = (e.role === "parent" || e.role === "ultimate-owner") ? 34 :
                   (e.type === "company") ? 26 : 20;
      els.push({ data: {
        id: e.id, label: e.name, color: catColor[e.category] || "#94a3b8",
        size, type: e.type, role: e.role || "", category: e.category, country: e.country
      }});
    });
    relationships.forEach((r, i) => {
      if (!ids.has(r.source) || !ids.has(r.target)) return;
      const st = relStyle[r.type] || { color: "#94a3b8", style: "solid" };
      els.push({ data: {
        id: "e" + i, source: r.source, target: r.target,
        label: r.label || "", color: st.color,
        lineStyle: st.style === "dotted" ? "dotted" : st.style === "dashed" ? "dashed" : "solid",
        arrow: r.type === "owns" ? "triangle" : "none",
        relType: r.type
      }});
    });
    cy.elements().remove();
    cy.add(els);

    // Size-aware rendering: a 600-node force-directed graph would hang + be an
    // unreadable hairball. Use a fast degree-concentric layout and drop labels
    // when large; use pretty force-directed layout when the view is filtered small.
    const n = entities.length;
    const big = n > 150, huge = n > 320;
    cy.batch(() => {
      cy.style().selector("edge").style("label", big ? "" : "data(label)").update();
      cy.style().selector("node").style("label", huge ? "" : "data(label)").update();
      cy.style().selector("node").style("font-size", n > 250 ? 7 : 10).update();
    });
    const layout = big
      ? { name: "concentric", concentric: (node) => node.degree(), levelWidth: () => 3,
          minNodeSpacing: 6, animate: false, padding: 20 }
      : { name: "cose", animate: false, padding: 30, nodeRepulsion: 6000, idealEdgeLength: 90 };
    cy.layout(layout).run();
  }

  function highlight(id) {
    cy.$(":selected").unselect();
    const n = cy.getElementById(id);
    if (n) { n.select(); cy.animate({ center: { eles: n }, zoom: 1.4 }, { duration: 300 }); }
  }

  const fit = () => cy && cy.fit(undefined, 30);
  return { init, setColors, build, highlight, fit };
})();
