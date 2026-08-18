/* GET /api/gdelt?query=...&country=PH&days=30
   Proxies GDELT 2.0 DOC API (no key). Server-side fetch => no browser CORS. */
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get("query") || "").trim();
  const country = (u.searchParams.get("country") || "").trim();
  const days = Math.min(parseInt(u.searchParams.get("days") || "30", 10) || 30, 90);

  // GDELT requires a non-empty query. Bias toward marketing/partnership language.
  let query = q || "(partnership OR sponsorship OR collaboration OR brand)";
  const countryName = ({ PH: "Philippines", SG: "Singapore", ID: "Indonesia", MY: "Malaysia",
    VN: "Vietnam", TH: "Thailand", CN: "China", KR: "\"South Korea\"", US: "\"United States\"" })[country];
  if (countryName) query = `${query} ${countryName}`;

  const api = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  api.searchParams.set("query", query);
  api.searchParams.set("mode", "ArtList");
  api.searchParams.set("format", "json");
  api.searchParams.set("maxrecords", "60");
  api.searchParams.set("sort", "DateDesc");
  api.searchParams.set("timespan", `${days}d`);

  try {
    const r = await fetch(api.toString(), { headers: { "User-Agent": "market-intel/1.0" } });
    if (!r.ok) return json({ articles: [], error: "gdelt " + r.status }, 200);
    const data = await r.json();
    const articles = (data.articles || []).map(a => ({
      title: a.title,
      url: a.url,
      domain: a.domain,
      date: (a.seendate || "").slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
      country: a.sourcecountry || "",
      image: a.socialimage || ""
    }));
    return json({ articles }, 200, 900);
  } catch (e) {
    return json({ articles: [], error: String(e) }, 200);
  }
}

function json(obj, status = 200, cacheSec = 0) {
  const headers = { "content-type": "application/json" };
  if (cacheSec) headers["cache-control"] = `public, max-age=${cacheSec}`;
  return new Response(JSON.stringify(obj), { status, headers });
}
