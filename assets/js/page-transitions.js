/**
 * Same-tab page transitions: fade out before navigate, fade in after (via sessionStorage flag).
 */
(function () {
  var prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var STYLE =
    "html.pt-root{min-height:100%;}" +
    "body.pt-from-nav{opacity:0;transform:translateY(8px) scale(0.995);filter:blur(2px);transition:none;}" +
    "body.pt-from-nav.pt-in{opacity:1;transform:none;filter:none;transition:opacity 0.42s cubic-bezier(0.22,1,0.36,1),transform 0.42s cubic-bezier(0.22,1,0.36,1),filter 0.42s ease;}" +
    "body.pt-out{opacity:0!important;transform:translateY(10px) scale(0.992)!important;filter:blur(2px)!important;transition:opacity 0.3s cubic-bezier(0.4,0,1,1)!important,transform 0.3s cubic-bezier(0.4,0,1,1)!important,filter 0.3s ease!important;pointer-events:none;}" +
    "@media (prefers-reduced-motion: reduce){body.pt-from-nav,body.pt-from-nav.pt-in,body.pt-out{opacity:1!important;transform:none!important;filter:none!important;transition:none!important;}}";

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
      if (prefersReducedMotion) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

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
      }, 320);
    },
    true
  );
})();
