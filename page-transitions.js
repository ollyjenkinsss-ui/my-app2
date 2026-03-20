/**
 * Same-tab page transitions: fade out before navigate, fade in after (via sessionStorage flag).
 */
(function () {
  var STYLE =
    "html.pt-root{min-height:100%;}" +
    "body.pt-from-nav{opacity:0;transition:none;}" +
    "body.pt-from-nav.pt-in{opacity:1;transition:opacity 0.45s ease;}" +
    "body.pt-out{opacity:0!important;transition:opacity 0.32s ease!important;pointer-events:none;}";

  var styleEl = document.createElement("style");
  styleEl.textContent = STYLE;
  document.documentElement.classList.add("pt-root");
  document.head.appendChild(styleEl);

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    if (sessionStorage.getItem("ptNav")) {
      sessionStorage.removeItem("ptNav");
      document.body.classList.add("pt-from-nav");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          document.body.classList.add("pt-in");
        });
      });
    }
  });

  document.addEventListener(
    "click",
    function (e) {
      var a = e.target.closest("a[href]");
      if (!a) return;
      if (a.target === "_blank" || a.hasAttribute("download")) return;

      var hrefAttr = a.getAttribute("href");
      if (!hrefAttr || hrefAttr.startsWith("javascript:")) return;

      var url;
      try {
        url = new URL(a.href, window.location.href);
      } catch (err) {
        return;
      }

      if (url.pathname === window.location.pathname && url.hash) return;

      if (url.protocol === "http:" || url.protocol === "https:") {
        if (url.origin !== window.location.origin) return;
      }

      e.preventDefault();
      sessionStorage.setItem("ptNav", "1");
      document.body.classList.remove("pt-from-nav", "pt-in");
      document.body.classList.add("pt-out");
      var dest = a.href;
      window.setTimeout(function () {
        window.location.href = dest;
      }, 300);
    },
    true
  );
})();
