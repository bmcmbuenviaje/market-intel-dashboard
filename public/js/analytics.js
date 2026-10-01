/* Market Pulse analytics: everything is derived from the already-fetched signal
   layer (S.news) — each article carries a date + sentiment + entityIds + source,
   so a time series over the active window needs no extra storage or API. */
window.ANALYTICS = (function () {
  const DAY = 864e5;

  function dayList(days) {
    const out = [], now = Date.now();
    for (let i = days - 1; i >= 0; i--) out.push(new Date(now - i * DAY).toISOString().slice(0, 10));
    return out;
  }

  /* Daily volume + average sentiment for one entity across the window. */
  function entitySeries(id, news, days) {
    const labels = dayList(days), idx = {};
    labels.forEach((l, i) => { idx[l] = i; });
    const vol = labels.map(() => 0), sen = labels.map(() => 0), cnt = labels.map(() => 0);
    news.forEach(n => {
      if (!n.date || !(n.entityIds || []).includes(id)) return;
      const d = n.date.slice(0, 10); if (idx[d] == null) return;
      vol[idx[d]]++;
      if (typeof n.sentiment === "number") { sen[idx[d]] += n.sentiment; cnt[idx[d]]++; }
    });
    return { labels, vol, avgSen: sen.map((s, i) => (cnt[i] ? Math.round(s / cnt[i]) : null)) };
  }

  /* Spike / swing detector: compares each brand's last `recent` days against its
     own baseline over the rest of the window. Flags volume spikes and sentiment
     swings — "what moved, and is it good or bad". */
  function spikes(entities, news, opts) {
    opts = opts || {};
    const days = opts.days || 30, recentN = opts.recent || 2, now = Date.now();
    const out = [];
    entities.forEach(e => {
      if (e.type === "regulator") return;
      const arts = news.filter(n => n.date && (n.entityIds || []).includes(e.id));
      if (arts.length < 2) return;
      const age = (n) => now - Date.parse(n.date);
      const recent = arts.filter(n => age(n) <= recentN * DAY);
      const prior = arts.filter(n => age(n) > recentN * DAY && age(n) <= days * DAY);
      const expected = prior.length / Math.max(days - recentN, 1) * recentN;
      const rc = recent.length;
      const sNow = recent.length ? Math.round(recent.reduce((a, n) => a + (n.sentiment || 0), 0) / recent.length) : 0;
      const sPrev = prior.length ? Math.round(prior.reduce((a, n) => a + (n.sentiment || 0), 0) / prior.length) : 0;
      const swing = sNow - sPrev;
      let type = null, score = 0; const why = [];
      if (rc >= 2 && rc >= expected * 1.5 + 1) {
        type = "volume"; score = rc - expected;
        why.push(`${rc} signal${rc > 1 ? "s" : ""} in ${recentN}d vs ~${expected.toFixed(1)} expected`);
      }
      if (prior.length >= 2 && recent.length >= 2 && Math.abs(swing) >= 20) {
        if (!type) { type = "sentiment"; score = Math.abs(swing); }
        why.push(`sentiment ${swing >= 0 ? "▲" : "▼"} ${swing >= 0 ? "+" : ""}${swing} (now ${sNow >= 0 ? "+" : ""}${sNow} vs ${sPrev >= 0 ? "+" : ""}${sPrev})`);
      }
      if (!type) return;
      out.push({ id: e.id, name: e.name, category: e.category, country: e.country,
        type, score, recent: rc, expected: Math.round(expected * 10) / 10, sNow, sPrev, swing, why });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, opts.limit || 12);
  }

  /* Share of Voice over time: daily volume series for the top-N loudest brands. */
  function sovOverTime(entities, news, opts) {
    opts = opts || {};
    const days = opts.days || 30, topN = opts.topN || 5;
    const totals = {};
    news.forEach(n => (n.entityIds || []).forEach(id => { totals[id] = (totals[id] || 0) + 1; }));
    const top = entities.filter(e => e.type !== "regulator" && totals[e.id])
      .sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0)).slice(0, topN);
    return { labels: dayList(days), series: top.map(e => ({ e, s: entitySeries(e.id, news, days) })) };
  }

  /* Which outlets / channels / handles drive coverage (optionally for one brand). */
  function topSources(news, opts) {
    opts = opts || {};
    const id = opts.entityId, m = {};
    news.forEach(n => {
      if (id && !(n.entityIds || []).includes(id)) return;
      const src = (n.source || n.domain || "").trim(); if (!src) return;
      const o = m[src] || (m[src] = { count: 0, sen: 0, cnt: 0 });
      o.count++; if (typeof n.sentiment === "number") { o.sen += n.sentiment; o.cnt++; }
    });
    return Object.keys(m).map(source => ({ source, count: m[source].count, senti: m[source].cnt ? Math.round(m[source].sen / m[source].cnt) : 0 }))
      .sort((a, b) => b.count - a.count).slice(0, opts.limit || 14);
  }

  /* Campaign / keyword tracker: match a term across titles/summaries/notes. */
  function campaign(news, keyword, days) {
    const kw = (keyword || "").toLowerCase().trim();
    const labels = dayList(days || 30), idx = {};
    labels.forEach((l, i) => { idx[l] = i; });
    const vol = labels.map(() => 0); let sen = 0, cnt = 0; const items = [];
    news.forEach(n => {
      const t = ((n.title || "") + " " + (n.summary || "") + " " + (n.note || "")).toLowerCase();
      if (!kw || !t.includes(kw)) return;
      items.push(n);
      if (n.date && idx[n.date.slice(0, 10)] != null) vol[idx[n.date.slice(0, 10)]]++;
      if (typeof n.sentiment === "number") { sen += n.sentiment; cnt++; }
    });
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return { labels, vol, count: items.length, senti: cnt ? Math.round(sen / cnt) : 0, items: items.slice(0, 20) };
  }

  return { dayList, entitySeries, spikes, sovOverTime, topSources, campaign };
})();
