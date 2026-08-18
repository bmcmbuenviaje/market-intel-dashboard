/* Scheduled digest worker (optional, free).
   Cloudflare Pages can't run cron, so this standalone Worker fires on a schedule
   and pings your deployed site's /api/digest, which builds the digest and posts it
   to DIGEST_WEBHOOK (configured on the Pages project).

   Deploy from this folder:  npx wrangler deploy
   Config (wrangler.toml): set DIGEST_TARGET (your pages URL) and WATCHLIST_IDS. */
export default {
  async scheduled(event, env, ctx) {
    const ids = (env.WATCHLIST_IDS || "").trim();
    if (!env.DIGEST_TARGET || !ids) return;
    const url = `${env.DIGEST_TARGET.replace(/\/$/, "")}/api/digest?ids=${encodeURIComponent(ids)}`;
    ctx.waitUntil(fetch(url).catch(() => {}));
  },
  // Allow manual trigger for testing: GET the worker URL.
  async fetch(request, env) {
    const ids = (env.WATCHLIST_IDS || "").trim();
    if (!env.DIGEST_TARGET || !ids) return new Response("configure DIGEST_TARGET + WATCHLIST_IDS", { status: 400 });
    const url = `${env.DIGEST_TARGET.replace(/\/$/, "")}/api/digest?ids=${encodeURIComponent(ids)}`;
    const r = await fetch(url);
    return new Response(await r.text(), { headers: { "content-type": "application/json" } });
  }
};
