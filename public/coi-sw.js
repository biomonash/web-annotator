/*
 * Cross-origin isolation service worker, for static hosts that cannot set headers (GitHub Pages).
 * Adds COOP/COEP/CORP to same-origin responses so SharedArrayBuffer (multi-threaded WASM) is available.
 *
 * Cross-origin requests are deliberately not intercepted: CORS responses already satisfy
 * COEP: require-corp, and relaying very large cross-origin bodies (the ~400 MB model)
 * through a service worker fails in Firefox ("Error in input stream").
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  event.respondWith(
    fetch(req).then((res) => {
      if (res.status === 0) return res; // opaque
      const headers = new Headers(res.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }),
  );
});
