/* Scheduled worker (optional, free). Cloudflare Pages can't run cron, so this
   standalone Worker fires on a schedule and pings your deployed site's endpoints:
     - /api/digest   (watchlist digest → DIGEST_WEBHOOK)
     - /api/detect?post=1  (NEW partnership signals → DIGEST_WEBHOOK)
   Both post to DIGEST_WEBHOOK, configured on the Pages project.

   Deploy from this folder:  npx wrangler deploy
   Config (wrangler.toml): DIGEST_TARGET (your pages URL) and WATCHLIST_IDS. */
async function run(env) {
  const base = (env.DIGEST_TARGET || "").replace(/\/$/, "");
  if (!base) return "configure DIGEST_TARGET";
  const jobs = [`${base}/api/detect?post=1`];
  const ids = (env.WATCHLIST_IDS || "").trim();
  if (ids) jobs.unshift(`${base}/api/digest?ids=${encodeURIComponent(ids)}`);
  const results = await Promise.allSettled(jobs.map(u => fetch(u)));
  return `ran ${jobs.length} job(s): ${results.map(r => r.status).join(", ")}`;
}
export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) { return new Response(await run(env), { headers: { "content-type": "text/plain" } }); }
};
