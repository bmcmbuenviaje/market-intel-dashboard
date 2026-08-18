/* Fusion engine: correlate curated relationships with the live signal layer to
   rank BD targets. Produces a score + human-readable "why". */
window.FUSION = (function () {

  /* Match a news article to an entity by name/alias (simple contains match). */
  function tagNewsToEntities(news, entities) {
    const idx = entities.map(e => ({
      e, needles: [e.name, ...(e.aliases || [])].map(s => s.toLowerCase()).filter(s => s.length > 2)
    }));
    news.forEach(n => {
      const t = (n.title || "").toLowerCase();
      n.entityIds = [];
      idx.forEach(({ e, needles }) => {
        if (needles.some(nd => t.includes(nd))) n.entityIds.push(e.id);
      });
    });
    return news;
  }

  function perEntitySignals(entities, news, relationships) {
    const byId = {};
    entities.forEach(e => { byId[e.id] = {
      entity: e, articles: [], sentiments: [], partners: 0, competitors: [], recentDeal: false
    }; });

    news.forEach(n => (n.entityIds || []).forEach(id => {
      if (!byId[id]) return;
      byId[id].articles.push(n);
      byId[id].sentiments.push(typeof n.sentiment === "number" ? n.sentiment : DATA.keywordSentiment(n.title));
    }));

    relationships.forEach(r => {
      if (r.type === "partner") {
        if (byId[r.source]) { byId[r.source].partners++; byId[r.source].recentDeal = true; }
        if (byId[r.target]) { byId[r.target].partners++; byId[r.target].recentDeal = true; }
      }
      if (r.type === "competitor") {
        if (byId[r.source]) byId[r.source].competitors.push(r.target);
        if (byId[r.target]) byId[r.target].competitors.push(r.source);
      }
    });
    return byId;
  }

  function avg(a) { return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0; }

  function rank(entities, news, relationships, filters) {
    const sig = perEntitySignals(entities, news, relationships);
    const partnerPairs = new Set(
      relationships.filter(r => r.type === "partner").map(r => r.source + "|" + r.target)
        .concat(relationships.filter(r => r.type === "partner").map(r => r.target + "|" + r.source))
    );

    const out = [];
    entities.forEach(e => {
      if (e.type === "regulator") return;
      if (!filters.entityVisible(e)) return;

      const s = sig[e.id];
      const buzz = s.articles.length;
      const senti = avg(s.sentiments);
      let score = 0;
      const why = [];

      if (buzz > 0) { score += Math.min(buzz * 8, 32); why.push(`${buzz} recent article${buzz > 1 ? "s" : ""}`); }
      if (senti > 5) { score += 20; why.push(`positive sentiment (+${senti})`); }
      else if (senti < -5) { score += 8; why.push(`negative sentiment (${senti}) — timing/PR angle`); }
      if (s.recentDeal) { score += 15; why.push("does brand partnerships (receptive)"); }

      // Whitespace: a competitor already has a partner, this entity does not.
      s.competitors.forEach(cid => {
        const compHasPartner = [...partnerPairs].some(p => p.startsWith(cid + "|"));
        const selfHasPartner = [...partnerPairs].some(p => p.startsWith(e.id + "|"));
        const comp = entities.find(x => x.id === cid);
        if (compHasPartner && !selfHasPartner && comp) {
          score += 18; why.push(`whitespace: rival ${comp.name} has a partner, ${e.name} doesn't`);
        }
      });

      if (score <= 0) return;
      out.push({ id: e.id, name: e.name, category: e.category, country: e.country,
                 score, senti, buzz, why });
    });

    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  }

  /* Whitespace finder: brands with NO recorded partnership, in categories where
     partnerships are actively happening — especially where a direct competitor
     already has a deal. These are the "open, gettable" BD targets. */
  function whitespace(allEntities, relationships, filters) {
    const nameOf = (id) => { const e = allEntities.find(x => x.id === id); return e ? e.name : id; };
    const hasPartner = new Set();
    relationships.filter(r => r.type === "partner").forEach(r => { hasPartner.add(r.source); hasPartner.add(r.target); });

    const activeCats = new Set();
    relationships.filter(r => r.type === "partner").forEach(r => {
      [r.source, r.target].forEach(id => { const e = allEntities.find(x => x.id === id); if (e) activeCats.add(e.category); });
    });

    const compMap = {};
    relationships.filter(r => r.type === "competitor").forEach(r => {
      (compMap[r.source] = compMap[r.source] || []).push(r.target);
      (compMap[r.target] = compMap[r.target] || []).push(r.source);
    });

    const out = [];
    allEntities.forEach(e => {
      if (e.type === "regulator") return;
      if (!filters.entityVisible(e)) return;
      if (hasPartner.has(e.id)) return; // already partnered — not whitespace

      const rivalsWithDeals = (compMap[e.id] || []).filter(c => hasPartner.has(c)).map(nameOf);
      let score = 0; const why = [];
      if (activeCats.has(e.category)) { score += 10; why.push(`partnerships active in "${e.category}"`); }
      if (rivalsWithDeals.length) { score += 22 * rivalsWithDeals.length; why.push(`rival already partnered: ${rivalsWithDeals.join(", ")}`); }
      if (e.role === "parent" || e.role === "ultimate-owner") { score += 4; why.push("owns multiple brands (multi-brand reach)"); }
      if (score <= 0) return;
      out.push({ id: e.id, name: e.name, category: e.category, country: e.country, score, why });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, 15);
  }

  return { tagNewsToEntities, perEntitySignals, rank, whitespace };
})();
