/* GET /api/wikidata?id=Q1706083
   Returns parent orgs + subsidiaries from Wikidata (P749 parent, P355 subsidiary,
   P127 owned by). Server-side SPARQL, cached. */
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const id = (u.searchParams.get("id") || "").trim();
  if (!/^Q\d+$/.test(id)) return json({ parents: [], subs: [], error: "bad id" }, 200);

  const sparql = `
    SELECT ?rel ?otherLabel WHERE {
      { wd:${id} wdt:P749 ?other. BIND("parent" AS ?rel) }
      UNION { wd:${id} wdt:P127 ?other. BIND("owner" AS ?rel) }
      UNION { wd:${id} wdt:P355 ?other. BIND("subsidiary" AS ?rel) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 50`;
  const api = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql);

  try {
    const r = await fetch(api, { headers: { "User-Agent": "market-intel/1.0 (BD tool)", "Accept": "application/sparql-results+json" } });
    if (!r.ok) return json({ parents: [], subs: [], error: "wikidata " + r.status }, 200);
    const data = await r.json();
    const parents = [], subs = [];
    (data.results?.bindings || []).forEach(b => {
      const name = b.otherLabel?.value;
      if (!name) return;
      if (b.rel.value === "subsidiary") subs.push(name);
      else parents.push(name);
    });
    return json({ parents: [...new Set(parents)], subs: [...new Set(subs)] }, 200, 86400);
  } catch (e) {
    return json({ parents: [], subs: [], error: String(e) }, 200);
  }
}

function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
