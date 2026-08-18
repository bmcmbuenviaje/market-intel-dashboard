/* Filter state + helpers shared across map, graph, feed. */
window.FILTERS = (function () {
  const state = {
    scope: "country",     // global | region | country
    region: "sea",
    country: "PH",
    category: "all",
    windowDays: 30
  };

  let taxonomy = null;
  function setTaxonomy(t) { taxonomy = t; }

  function activeCountries() {
    if (state.scope === "global") return null; // null = all
    if (state.scope === "country") return [state.country];
    const r = (taxonomy.regions || []).find(r => r.id === state.region);
    return r ? r.countries : null;
  }

  function matchCountry(code) {
    const list = activeCountries();
    if (!list) return true;
    return list.includes(code);
  }

  function matchCategory(cat) {
    return state.category === "all" || cat === state.category;
  }

  /* Entity passes the current filters? */
  function entityVisible(e) {
    return matchCountry(e.country) && matchCategory(e.category);
  }

  return { state, setTaxonomy, activeCountries, matchCountry, matchCategory, entityVisible };
})();
