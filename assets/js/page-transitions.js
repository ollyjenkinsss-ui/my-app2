/**
 * Same-tab page transitions: fade out before navigate, fade in after (via sessionStorage flag).
 */
(function () {
  var prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var STYLE =
    "html.pt-root{min-height:100%;}" +
    "#globalBackBtn{position:fixed;left:12px;top:60px;z-index:1200;border:1px solid rgba(165,180,252,.45);background:rgba(12,20,44,.82);color:#eef3ff;border-radius:999px;padding:7px 12px;font:600 14px/1 'Barlow Condensed',sans-serif;cursor:pointer;backdrop-filter:blur(8px);box-shadow:0 6px 18px rgba(0,0,0,.28);transition:transform .16s ease,background .16s ease,border-color .16s ease;}" +
    "#globalBackBtn:hover{transform:translateY(-1px);background:rgba(70,108,220,.28);border-color:rgba(165,180,252,.75);}" +
    "body.light #globalBackBtn{background:rgba(245,248,255,.88);color:#102247;border-color:rgba(90,90,175,.35);}" +
    "@media (max-width:820px){#globalBackBtn{left:10px;top:72px;padding:6px 10px;font-size:13px;}}" +
    "body.pt-from-nav{opacity:0;transform:translateY(8px) scale(0.995);filter:blur(2px);transition:none;}" +
    "body.pt-from-nav.pt-in{opacity:1;transform:none;filter:none;transition:opacity 0.42s cubic-bezier(0.22,1,0.36,1),transform 0.42s cubic-bezier(0.22,1,0.36,1),filter 0.42s ease;}" +
    "body.pt-out{opacity:0!important;transform:translateY(10px) scale(0.992)!important;filter:blur(2px)!important;transition:opacity 0.3s cubic-bezier(0.4,0,1,1)!important,transform 0.3s cubic-bezier(0.4,0,1,1)!important,filter 0.3s ease!important;pointer-events:none;}" +
    "@media (prefers-reduced-motion: reduce){body.pt-from-nav,body.pt-from-nav.pt-in,body.pt-out{opacity:1!important;transform:none!important;filter:none!important;transition:none!important;}#globalBackBtn{transition:none!important;}}";

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
    if (!document.getElementById("globalBackBtn")) {
      var backBtn = document.createElement("button");
      backBtn.id = "globalBackBtn";
      backBtn.type = "button";
      backBtn.setAttribute("aria-label", "Go back");
      backBtn.textContent = "← Back";

      backBtn.addEventListener("click", function () {
        var fallback = function () {
          window.location.href = "/index.html";
        };

        if (prefersReducedMotion) {
          if (window.history.length > 1) {
            window.history.back();
            window.setTimeout(function () {
              if (document.visibilityState === "visible") fallback();
            }, 420);
          } else {
            fallback();
          }
          return;
        }

        sessionStorage.setItem("ptNav", "1");
        document.body.classList.remove("pt-from-nav", "pt-in");
        document.body.classList.add("pt-out");

        window.setTimeout(function () {
          if (window.history.length > 1) {
            window.history.back();
            window.setTimeout(function () {
              if (document.visibilityState === "visible") fallback();
            }, 420);
          } else {
            fallback();
          }
        }, 220);
      });

      document.body.appendChild(backBtn);
    }

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
