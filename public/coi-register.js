/*
 * Registers coi-sw.js (next to this script) and reloads once so the page is served with
 * cross-origin isolation headers. Does nothing when the host already sends them.
 */
(function () {
  var KEY = "coi-sw-reloaded";
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

  var script = document.currentScript;
  var swUrl = new URL("coi-sw.js", script.src).href;
  var scope = new URL("./", script.src).pathname;
  var controller = navigator.serviceWorker.controller;
  // A different worker (e.g. the old coi-serviceworker, which broke large downloads in Firefox) must be replaced.
  var foreignController = controller && controller.scriptURL !== swUrl;

  if (window.crossOriginIsolated && !foreignController) {
    sessionStorage.removeItem(KEY);
    return;
  }

  function reloadOnce() {
    if (sessionStorage.getItem(KEY)) return; // avoid reload loops if isolation still fails
    sessionStorage.setItem(KEY, "1");
    window.location.reload();
  }

  navigator.serviceWorker.register(swUrl, { scope: scope }).then(
    function () {
      if (controller && !foreignController) reloadOnce();
      else navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
    },
    function (err) {
      console.warn("Cross-origin isolation service worker failed to register:", err);
    },
  );
})();
