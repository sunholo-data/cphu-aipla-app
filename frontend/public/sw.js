/* AIPLA service worker — MOBILE-1 (2026-08-13).
 *
 * Scope of this worker, stated up front because the tempting features are the
 * dangerous ones:
 *
 *   IT DOES        serve the app shell and Next's content-hashed static assets
 *                  when the network is slow or gone, so a student who walks
 *                  behind the sports hall still has a UI instead of a Safari
 *                  error page.
 *
 *   IT DOES NOT    cache anything from /api/**, ever. Those responses are
 *                  per-group and authenticated: a cached /api/skills served to
 *                  the next group on the same shared phone is a data leak, and
 *                  a cached 401 is an unrecoverable "logged out" that survives
 *                  reloads. Same reason it never touches SSE.
 *
 *   IT DOES NOT    queue outgoing chat turns for replay. That is the feature
 *                  the playground-tutor scope doc asks for, and it is a real
 *                  piece of work: turns ride an AG-UI POST, the group holds a
 *                  turn-taking lock, and the tutor's reply streams back. A
 *                  naive queue silently double-sends on reconnect or replays a
 *                  turn into a lesson that has moved on. Half a queue is worse
 *                  than none, so it is a follow-on, not a smuggled-in extra.
 *
 * Cache versioning: bump CACHE_VERSION to invalidate. Old caches are deleted on
 * activate, so a bad cache is one deploy away from gone.
 */

// v2 (1.1.138 M3, 2026-10-26): navigations no longer fall back to a cached app
// page, and the bump deletes every app page the v1 worker had cached.
const CACHE_VERSION = "aipla-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline.html";

// Kept deliberately tiny. Precaching routes would bake in a build's HTML, and
// Next serves content-hashed chunks that the HTML must match — a stale shell
// paired with fresh chunks is the classic PWA white screen. For the same reason
// navigations are never cached at all (below): the offline page is the only
// HTML this worker ever serves.
const PRECACHE = [OFFLINE_URL, "/images/logo/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(PRECACHE)),
  );
  // Take over as soon as installed. Safe here because this worker never serves
  // stale HTML while the network is up (navigations are network-first), so a
  // mid-session swap cannot pair old markup with new chunks.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Everything the worker must keep its hands off entirely. */
function isBypass(request, url) {
  // Only GET is cacheable; POST/PUT/DELETE carry the student's work.
  if (request.method !== "GET") return true;
  // Same-origin only — the MCP-App sandbox is a different origin by ADR-013
  // and must keep its own CSP/caching story.
  if (url.origin !== self.location.origin) return true;
  // Authenticated, per-group, and often 401 — never cache, never serve stale.
  if (url.pathname.startsWith("/api/")) return true;
  // AG-UI streams. Caching a stream would hang the response forever.
  if (request.headers.get("accept")?.includes("text/event-stream")) return true;
  // Range requests (audio playback for read-aloud) — partial responses do not
  // belong in a cache keyed by URL.
  if (request.headers.has("range")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (isBypass(request, url)) return; // fall through to the network untouched

  // Next's static output is content-hashed and immutable — cache-first is both
  // safe and the whole reason a second visit is fast.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations: network only, and on a network failure the OFFLINE PAGE —
  // never a cached app page (1.1.138 M3, option b). A cached page is HTML from
  // whichever build last served it; on a school Wi-Fi blip it would be paired
  // with the current build's chunks — the module-map skew behind the
  // `reading 'call'` crashes. An offline app page cannot reach the tutor
  // anyway, so the honest "you are offline" loses nothing.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((hit) => hit || Response.error()),
      ),
    );
    return;
  }

  // Same-origin images / fonts / static public assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((hit) => {
      const net = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
