/* Phraortes service worker
 * - App files (same origin): network-first with a 3.5 s timeout, cached copy as the offline fallback,
 *   so updates ship immediately but the app still opens with no signal.
 * - Third-party libraries/fonts (jsDelivr, cdnjs, Google Fonts): stale-while-revalidate.
 * - Never touches API calls, POSTs, or anything else cross-origin (chat, payments, OAuth stay live).
 * Bump VERSION to force every device to drop old caches.
 */
const VERSION = "phraortes-v2-6";
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "security.js", "artifacts.js", "payment.js", "katex.min.js", "katex.min.css"];
const CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)); }

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([fetch(req), timeout(3500)]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
    if (req.mode === "navigate") { const shell = await cache.match("./"); if (shell) return shell; }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.includes("/api/") || url.hostname.endsWith("workers.dev")) return;
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (CDN_HOSTS.includes(url.hostname)) { e.respondWith(staleWhileRevalidate(req)); }
});
