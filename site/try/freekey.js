// Shows the "free key by email" links on /pricing/, /try/ and /mcp-server/ only when the hosted
// API says the option is open (plans.free.free_key in /v1/plans). Same-origin GET, no key sent,
// nothing stored, no personal data. The request form itself is the page /account#free-key.
(function () {
  "use strict";
  var nodes = document.querySelectorAll("[data-free-key]");
  if (!nodes.length || typeof fetch !== "function") return;
  fetch("/v1/plans", {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
  })
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      var free = data && data.plans && data.plans.free;
      if (!free || !free.free_key) return;
      for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute("hidden");
    })
    .catch(function () {});
})();
