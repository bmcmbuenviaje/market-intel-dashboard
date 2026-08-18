#!/usr/bin/env python3
"""Local dev server (no Node required).

Serves ./public AND implements the same /api/* proxy that the Cloudflare Pages
Functions provide in production. Lets you run the full app with just Python.

    python devserver.py            # http://localhost:8788
    set FINNHUB_KEY=xxx & python devserver.py   # enable Finnhub (Windows)

Production still uses functions/api/*.js on Cloudflare — this file is dev-only.
"""
import json, os, re, ssl, sys, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import URLError

PORT = int(os.environ.get("PORT", "8788"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
SSL_CTX = ssl.create_default_context()

COUNTRY_NAMES = {
    "PH": "Philippines", "SG": "Singapore", "ID": "Indonesia", "MY": "Malaysia",
    "VN": "Vietnam", "TH": "Thailand", "CN": "China", "KR": '"South Korea"',
    "US": '"United States"',
}


def http_get(url, headers=None, timeout=20, retries=2):
    """GET with one or two retries on HTTP 429 (transient rate limits)."""
    import time
    from urllib.error import HTTPError
    req = Request(url, headers=headers or {"User-Agent": "market-intel/1.0"})
    for attempt in range(retries + 1):
        try:
            with urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                return r.status, r.read()
        except HTTPError as e:
            if e.code == 429 and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise


# ---- endpoint implementations (mirror functions/api/*.js) ----

def api_gdelt(qs):
    q = (qs.get("query", [""])[0] or "").strip()
    country = (qs.get("country", [""])[0] or "").strip()
    days = min(int(qs.get("days", ["30"])[0] or 30), 90)
    query = q or "(partnership OR sponsorship OR collaboration OR brand)"
    if country in COUNTRY_NAMES:
        query = f"{query} {COUNTRY_NAMES[country]}"
    api = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode({
        "query": query, "mode": "ArtList", "format": "json",
        "maxrecords": "60", "sort": "DateDesc", "timespan": f"{days}d",
    })
    try:
        status, body = http_get(api, retries=1)
        if status != 200:
            return {"articles": [], "error": f"gdelt {status}"}
        data = json.loads(body or b"{}")
        arts = []
        for a in data.get("articles", []):
            sd = (a.get("seendate") or "")[:8]
            date = f"{sd[0:4]}-{sd[4:6]}-{sd[6:8]}" if len(sd) == 8 else ""
            arts.append({"title": a.get("title"), "url": a.get("url"),
                         "domain": a.get("domain"), "date": date,
                         "country": a.get("sourcecountry", ""),
                         "image": a.get("socialimage", "")})
        return {"articles": arts}
    except Exception as e:
        return {"articles": [], "error": str(e)}


def api_yahoo(qs):
    symbol = (qs.get("symbol", [""])[0] or "").strip()
    if not symbol:
        return {"error": "symbol required"}
    api = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}?range=1mo&interval=1d"
    try:
        status, body = http_get(api, headers={"User-Agent": "Mozilla/5.0 market-intel"})
        if status != 200:
            return {"error": f"yahoo {status}"}
        res = (json.loads(body).get("chart", {}).get("result") or [None])[0]
        if not res:
            return {"error": "no data"}
        meta = res.get("meta", {})
        closes = [c for c in (res.get("indicators", {}).get("quote", [{}])[0].get("close") or []) if c is not None]
        change = round((closes[-1] - closes[0]) / closes[0] * 100, 2) if len(closes) > 1 else None
        return {"symbol": symbol, "price": meta.get("regularMarketPrice"),
                "currency": meta.get("currency", ""), "changePct": change, "series": closes}
    except Exception as e:
        return {"error": str(e)}


def api_wikidata(qs):
    wid = (qs.get("id", [""])[0] or "").strip()
    if not (wid.startswith("Q") and wid[1:].isdigit()):
        return {"parents": [], "subs": [], "error": "bad id"}
    sparql = (
        "SELECT ?rel ?otherLabel WHERE {"
        f" {{ wd:{wid} wdt:P749 ?other. BIND('parent' AS ?rel) }}"
        f" UNION {{ wd:{wid} wdt:P127 ?other. BIND('owner' AS ?rel) }}"
        f" UNION {{ wd:{wid} wdt:P355 ?other. BIND('subsidiary' AS ?rel) }}"
        " SERVICE wikibase:label { bd:serviceParam wikibase:language 'en'. } } LIMIT 50"
    )
    api = "https://query.wikidata.org/sparql?format=json&query=" + quote(sparql)
    try:
        status, body = http_get(api, retries=1, headers={
            "User-Agent": "market-intel/1.0 (BD tool)",
            "Accept": "application/sparql-results+json"})
        if status != 200:
            return {"parents": [], "subs": [], "error": f"wikidata {status}"}
        data = json.loads(body)
        parents, subs = [], []
        for b in data.get("results", {}).get("bindings", []):
            name = b.get("otherLabel", {}).get("value")
            if not name:
                continue
            (subs if b["rel"]["value"] == "subsidiary" else parents).append(name)
        return {"parents": sorted(set(parents)), "subs": sorted(set(subs))}
    except Exception as e:
        return {"parents": [], "subs": [], "error": str(e)}


def api_finnhub(qs):
    key = os.environ.get("FINNHUB_KEY")
    symbol = (qs.get("symbol", [""])[0] or "").strip()
    if not key:
        return {"articles": [], "error": "FINNHUB_KEY not configured"}
    if not symbol:
        return {"articles": [], "error": "symbol required"}
    import datetime
    to = datetime.date.today().isoformat()
    frm = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()
    api = (f"https://finnhub.io/api/v1/company-news?symbol={quote(symbol)}"
           f"&from={frm}&to={to}&token={key}")
    try:
        status, body = http_get(api)
        if status != 200:
            return {"articles": [], "error": f"finnhub {status}"}
        data = json.loads(body)
        arts = [{"title": a.get("headline"), "url": a.get("url"), "domain": a.get("source"),
                 "date": __import__("datetime").datetime.utcfromtimestamp(a.get("datetime", 0)).date().isoformat(),
                 "image": a.get("image")} for a in data[:40]]
        return {"articles": arts}
    except Exception as e:
        return {"articles": [], "error": str(e)}


def api_digest(qs):
    ids = [s.strip() for s in (qs.get("ids", [""])[0] or "").split(",") if s.strip()][:12]
    if not ids:
        return {"items": [], "error": "no ids"}
    try:
        with open(os.path.join(ROOT, "data", "knowledge-base.json"), encoding="utf-8") as f:
            kb = json.load(f)
    except Exception as e:
        return {"items": [], "error": f"kb load failed: {e}"}
    by_id = {e["id"]: e for e in kb.get("entities", [])}
    items = []
    for _id in ids:
        e = by_id.get(_id)
        if not e:
            continue
        art = _top_article(e["name"])
        items.append({"id": _id, "name": e["name"],
                      "headline": art and art.get("title"), "url": art and art.get("url")})
    import datetime
    generated = datetime.datetime.utcnow().isoformat() + "Z"
    posted = False
    hook = os.environ.get("DIGEST_WEBHOOK")
    if hook:
        text = f"Watchlist digest - {generated[:10]}\n" + "\n".join(
            f"- {it['name']}: {(it['headline'] + ' ' + it['url']) if it['headline'] else 'no new signals'}"
            for it in items)
        try:
            body = json.dumps({"content": text, "text": text}).encode()
            from urllib.request import Request as _R
            urlopen(_R(hook, data=body, headers={"content-type": "application/json"}),
                    timeout=15, context=SSL_CTX)
            posted = True
        except Exception:
            posted = False
    return {"generatedAt": generated, "items": items, "posted": posted}


def _top_article(name):
    api = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode({
        "query": f'"{name}"', "mode": "ArtList", "format": "json",
        "maxrecords": "3", "sort": "DateDesc", "timespan": "14d"})
    try:
        status, body = http_get(api, retries=0)
        if status != 200:
            return None
        arts = json.loads(body or b"{}").get("articles", [])
        a = arts[0] if arts else None
        return {"title": a.get("title"), "url": a.get("url"), "domain": a.get("domain")} if a else None
    except Exception:
        return None


def api_me(qs, headers=None):
    """Mirror the Cloudflare Access identity header locally (empty in dev)."""
    email = ""
    if headers:
        email = headers.get("Cf-Access-Authenticated-User-Email", "") or ""
    return {"email": email, "access": bool(email)}


DEFAULT_FEEDS = [
    ("BusinessWorld", "https://www.bworldonline.com/feed/"),
    ("Inquirer Business", "https://business.inquirer.net/feed"),
    ("BusinessMirror", "https://businessmirror.com.ph/feed/"),
    ("Philstar Business", "https://www.philstar.com/rss/business"),
    ("Manila Bulletin", "https://mb.com.ph/feed/"),
    ("Manila Times", "https://www.manilatimes.net/business/feed"),
    ("GMA Money", "https://data.gmanetwork.com/gno/rss/money/feed.xml"),
    ("Rappler Business", "https://www.rappler.com/business/feed/"),
]

def _clean(s):
    s = re.sub(r"<!\[CDATA\[|\]\]>", "", s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'").replace("&apos;", "'")
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"&[a-z]+;", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def _tag(block, name):
    m = re.search(rf"<{name}[^>]*>([\s\S]*?)</{name}>", block, re.I)
    return m.group(1) if m else ""

def _parse_dt(s):
    if not s:
        return 0
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(s).timestamp()
    except Exception:
        try:
            import datetime
            return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0

def _parse_feed(xml, source):
    out = []
    import datetime
    for b in re.findall(r"<(?:item|entry)\b[\s\S]*?</(?:item|entry)>", xml, re.I):
        title = _clean(_tag(b, "title"))
        link = (_tag(b, "link") or "").strip()
        if not link:
            m = re.search(r"<link[^>]*href=[\"']([^\"']+)[\"']", b, re.I)
            if m:
                link = m.group(1)
        ts = _parse_dt(_tag(b, "pubDate") or _tag(b, "published") or _tag(b, "updated") or _tag(b, "dc:date"))
        summary = _clean(_tag(b, "description") or _tag(b, "summary") or "")[:220]
        if title and link:
            d = datetime.datetime.fromtimestamp(ts).date().isoformat() if ts else ""
            out.append({"title": title, "url": link, "source": source, "summary": summary, "date": d, "ts": ts})
    return out[:12]

def api_news(qs):
    days = min(int(qs.get("days", ["7"])[0] or 7), 30)
    q = (qs.get("q", [""])[0] or "").lower()
    feeds = DEFAULT_FEEDS
    try:
        with open(os.path.join(ROOT, "data", "news-sources.json"), encoding="utf-8") as f:
            j = json.load(f)
        if j.get("feeds"):
            feeds = [(x["source"], x["url"]) for x in j["feeds"]]
    except Exception:
        pass
    import concurrent.futures
    def one(su):
        s, url = su
        try:
            status, body = http_get(url, headers={"User-Agent": "Mozilla/5.0 market-intel"}, retries=0, timeout=9)
            return _parse_feed(body.decode("utf-8", "ignore"), s) if status == 200 else []
        except Exception:
            return []
    items = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(one, feeds):
            items += r
    cutoff = time.time() - days * 86400
    seen = set(); res = []
    for a in sorted(items, key=lambda x: x["ts"], reverse=True):
        if a["url"] in seen:
            continue
        seen.add(a["url"])
        if a["ts"] and a["ts"] < cutoff:
            continue
        if q and q not in (a["title"] + " " + a["summary"]).lower():
            continue
        res.append({k: a[k] for k in ("title", "url", "source", "summary", "date")})
    return {"articles": res[:80], "sources": len(feeds), "count": len(res[:80])}


ROUTES = {"gdelt": api_gdelt, "yahoo": api_yahoo, "wikidata": api_wikidata,
          "finnhub": api_finnhub, "digest": api_digest, "me": api_me, "news": api_news}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            name = parsed.path[len("/api/"):]
            if name == "kb":
                return self._serve_kb()
            fn = ROUTES.get(name)
            if not fn:
                return self._json({"error": "unknown endpoint"}, 404)
            qs = parse_qs(parsed.query)
            return self._json(api_me(qs, self.headers) if name == "me" else fn(qs))
        return super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/kb":
            return self._save_kb()
        return self._json({"error": "not found"}, 404)

    # local KV stand-in: read/write public/data/knowledge-base.json
    def _serve_kb(self):
        try:
            with open(os.path.join(ROOT, "data", "knowledge-base.json"), "rb") as f:
                payload = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("x-kb-source", "file")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def _save_kb(self):
        want = os.environ.get("ADMIN_TOKEN")
        if want and self.headers.get("X-Admin-Token", "") != want:
            return self._json({"error": "unauthorized"}, 401)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self._json({"error": f"invalid JSON: {e}"}, 400)
        if not isinstance(body.get("entities"), list) or not isinstance(body.get("relationships"), list):
            return self._json({"error": "body must contain entities[] and relationships[]"}, 400)
        ids = {e["id"] for e in body["entities"]}
        body["relationships"] = [r for r in body["relationships"] if r.get("source") in ids and r.get("target") in ids]
        body.setdefault("_meta", {})
        import datetime
        body["_meta"]["lastUpdated"] = datetime.date.today().isoformat()
        with open(os.path.join(ROOT, "data", "knowledge-base.json"), "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False, indent=2)
        return self._json({"ok": True, "entities": len(body["entities"]),
                           "relationships": len(body["relationships"])})

    def _json(self, obj, status=200):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def end_headers(self):
        # dev: never cache, so edited JS/HTML/JSON always reload fresh
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  " + (fmt % args) + "\n")


if __name__ == "__main__":
    print(f"Market & Sales Intel dev server -> http://localhost:{PORT}")
    print(f"  serving: {ROOT}")
    print(f"  finnhub: {'enabled' if os.environ.get('FINNHUB_KEY') else 'disabled (set FINNHUB_KEY to enable)'}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
