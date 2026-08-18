/* GET /api/me
   Returns the Cloudflare Access identity for the current request, if the site is
   behind Access. Cloudflare injects Cf-Access-Authenticated-User-Email on every
   request once an Access policy is enforcing. Empty when Access isn't enabled
   (e.g. local dev) — the app then falls back to the client-side code gate. */
export async function onRequestGet({ request }) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email") || "";
  return new Response(JSON.stringify({ email, access: !!email }), {
    headers: { "content-type": "application/json" }
  });
}
