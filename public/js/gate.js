/* Access gate. Two layers:
   1. Cloudflare Access (server-enforced) — if the site is behind Access, /api/me
      returns the signed-in email and we unlock immediately, no prompt. This is the
      real security layer for production.
   2. Client-side code gate (fallback) — only hides the UI; anyone can read source.
      Used for local dev or if Access isn't enabled. */
(function () {
  const KEY = "mi_auth_ok";
  const gate = document.getElementById("gate");
  const app = document.getElementById("app");
  const form = document.getElementById("gateForm");
  const pass = document.getElementById("gatePass");
  const err = document.getElementById("gateErr");

  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function unlock() {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    document.dispatchEvent(new Event("mi:authed"));
  }
  function deferUnlock() {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", unlock, { once: true });
    else unlock();
  }

  // Always wire the fallback form + logout so they work if Access isn't present.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const h = await sha256(pass.value.trim());
    if (h === window.CONFIG.ACCESS_HASH) { sessionStorage.setItem(KEY, "1"); unlock(); }
    else { err.textContent = "Incorrect access code."; pass.value = ""; }
  });
  window.miLogout = function () {
    sessionStorage.removeItem(KEY);
    // If behind Cloudflare Access, also clear the Access session.
    fetch("/cdn-cgi/access/logout").catch(() => {}).finally(() => location.reload());
  };

  // Layer 1: is Cloudflare Access enforcing? If so, unlock without a prompt.
  fetch("/api/me").then(r => r.json()).then(j => {
    if (j && j.access) { window.MI_USER = j.email; sessionStorage.setItem(KEY, "1"); deferUnlock(); return; }
    // Layer 2: returning client-gate session.
    if (sessionStorage.getItem(KEY) === "1") deferUnlock();
  }).catch(() => {
    if (sessionStorage.getItem(KEY) === "1") deferUnlock();
  });
})();
