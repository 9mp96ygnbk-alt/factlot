// The /try/ page: one address search, then one record fetch, against the hosted free tier.
// Same-origin POSTs to /v1/registry/search_address and /v1/registry/get; no key is sent and
// nothing is stored. Every string from the API is written with textContent, never as HTML.
(function () {
  "use strict";
  var SEARCH = "/v1/registry/search_address";
  var GET = "/v1/registry/get";
  var TIMEOUT_MS = 20000;

  var form = document.getElementById("try-form");
  var input = document.getElementById("try-q");
  var go = document.getElementById("try-go");
  var statusEl = document.getElementById("try-status");
  var results = document.getElementById("try-results");
  var quotaEl = document.getElementById("try-quota");
  if (!form || !input || !go || !statusEl || !results || !quotaEl) return;

  var token = 0;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs)
      for (var k in attrs)
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          if (k === "text") node.textContent = attrs[k];
          else node.setAttribute(k, attrs[k]);
        }
    (children || []).forEach(function (c) {
      if (c != null)
        node.appendChild(
          typeof c === "string" ? document.createTextNode(c) : c,
        );
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function post(path, body) {
    var ctl =
      typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl
      ? setTimeout(function () {
          ctl.abort();
        }, TIMEOUT_MS)
      : null;
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      signal: ctl ? ctl.signal : undefined,
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
          return { status: res.status, data: data, headers: res.headers };
        });
      })
      .then(
        function (r) {
          if (timer) clearTimeout(timer);
          return r;
        },
        function (e) {
          if (timer) clearTimeout(timer);
          throw e;
        },
      );
  }

  function showQuota(headers) {
    var left = headers.get("x-factlot-registry-quota-remaining");
    var limit = headers.get("x-factlot-registry-quota-limit");
    if (left === null || limit === null) return;
    quotaEl.textContent =
      "Free lookups left today for your IP address: " +
      left +
      " of " +
      limit +
      ". A search that finds a parcel and the record fetch each count as one; misses and input errors are free.";
  }

  function problem(title, lines, links) {
    clear(results);
    var box = el("div", { class: "try-problem", role: "alert" }, [
      el("h2", { text: title }),
    ]);
    lines.forEach(function (l) {
      if (l) box.appendChild(el("p", { text: l }));
    });
    if (links && links.length)
      box.appendChild(
        el(
          "p",
          { class: "actions" },
          links.map(function (l) {
            return el("a", { class: "button", href: l[0], text: l[1] });
          }),
        ),
      );
    results.appendChild(box);
    setStatus("");
  }

  function missed(message, coverage) {
    var detail =
      coverage && typeof coverage.message === "string"
        ? coverage.message
        : message;
    problem(
      "Not in loaded coverage",
      [
        "No parcel matched. This is the API's answer:",
        detail || "no parcel matched in this registry",
      ],
      [["/coverage/", "See which counties are loaded"]],
    );
  }

  function apiProblem(r) {
    var d = r.data || {};
    var message = typeof d.message === "string" ? d.message : "";
    if (r.status === 429) {
      problem(
        d.error === "RegistryQuotaExceeded"
          ? "Today's free lookups are used up"
          : "Too many requests just now",
        [
          message || "The free tier is rate limited. Try again shortly.",
          typeof d.next === "string" ? d.next : "",
        ],
        [
          ["/pricing/", "Plans and limits"],
          ["/mcp-server/", "Connect your agent"],
        ],
      );
    } else if (r.status === 404) {
      missed(message, d.coverage);
    } else if (r.status >= 500 || !r.data) {
      problem(
        "The lookup service did not answer",
        [
          "The hosted registry is not responding right now (HTTP " +
            r.status +
            "). Nothing was counted. Try again in a minute.",
        ],
        [["/status/", "Service status"]],
      );
    } else {
      problem(
        "The API refused that input",
        [message || "HTTP " + r.status],
        null,
      );
    }
  }

  function networkProblem(e) {
    problem(
      e && e.name === "AbortError"
        ? "The lookup timed out"
        : "The lookup could not reach the API",
      ["Check your connection and try again. Nothing was counted."],
      null,
    );
  }

  var LABELS = {
    "parcel.apn": "Parcel number (APN)",
    "parcel.situs_address": "Situs address",
    "parcel.land_value": "Land value",
    "parcel.improvement_value": "Improvement value",
    "parcel.market_value": "Market value",
    "parcel.appraised_value": "Appraised value",
    "parcel.tax_year": "Roll year",
    "parcel.land_area_sf": "Land area",
    "parcel.improvement_area_sf": "Improvement area",
    "parcel.year_built": "Year built",
    "parcel.building_class": "Building class",
    "parcel.state_property_category": "State property category",
    "parcel.neighborhood_code": "Neighborhood code",
    "parcel.num_floors": "Floors",
    "ownership.owner_of_record": "Owner of record",
  };

  var YEAR_PREDICATES = ["parcel.year_built", "parcel.tax_year"];

  function formatValue(f) {
    var v = f.value;
    if (typeof v === "number") {
      // A year is a label, not a quantity: 1983, never 1,983.
      if (YEAR_PREDICATES.indexOf(f.predicate) !== -1) return String(v);
      var n = v.toLocaleString("en-US", { maximumFractionDigits: 6 });
      if (f.unit === "USD") return "$" + n;
      return f.unit ? n + " " + f.unit : n;
    }
    if (typeof v === "string" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  }

  function sourcesOf(f) {
    var p = f && f.provenance;
    return p && Array.isArray(p.sources) ? p.sources : [];
  }

  function citation(f) {
    var s = sourcesOf(f)[0];
    var parts = [];
    if (s && s.title) parts.push(s.title);
    if (s && s.section) parts.push(s.section);
    if (f.as_of) parts.push("as of " + f.as_of);
    return parts.join(" · ");
  }

  function factsTable(caption, facts) {
    var table = el("table");
    table.appendChild(
      el("caption", { class: "visually-hidden", text: caption }),
    );
    table.appendChild(
      el("thead", null, [
        el("tr", null, [
          el("th", { scope: "col", text: "Fact" }),
          el("th", { scope: "col", text: "Value" }),
          el("th", { scope: "col", text: "Cited to" }),
        ]),
      ]),
    );
    var body = el("tbody");
    facts.forEach(function (f) {
      body.appendChild(
        el("tr", null, [
          el("th", { scope: "row", text: LABELS[f.predicate] || f.predicate }),
          el("td", { text: formatValue(f) }),
          el("td", { class: "small", text: citation(f) }),
        ]),
      );
    });
    table.appendChild(body);
    return el("div", { class: "try-table" }, [table]);
  }

  function sourceBlock(facts) {
    var seen = {};
    var list = [];
    facts.forEach(function (f) {
      var rights = f.rights || {};
      sourcesOf(f).forEach(function (s) {
        var id = s.document_id || s.title;
        if (seen[id]) return;
        seen[id] = true;
        list.push({ s: s, rights: rights });
      });
    });
    var wrap = el("div", { class: "try-sources" }, [
      el("h3", { text: "Sources, as returned" }),
    ]);
    if (!list.length) {
      wrap.appendChild(
        el("p", { text: "The record returned no source documents." }),
      );
      return wrap;
    }
    var ul = el("ul");
    list.forEach(function (x) {
      var s = x.s;
      var li = el("li");
      li.appendChild(
        el("strong", { text: s.title || s.document_id || "Source" }),
      );
      var rows = [];
      if (s.uri) rows.push(["Source", s.uri, true]);
      if (s.retrieved_at) rows.push(["Retrieved", s.retrieved_at]);
      if (s.section) rows.push(["Record", s.section]);
      if (s.document_id) rows.push(["Document", s.document_id]);
      if (x.rights.license) rows.push(["Licence", x.rights.license]);
      if (x.rights.attribution)
        rows.push(["Attribution", x.rights.attribution]);
      rows.forEach(function (r) {
        li.appendChild(document.createElement("br"));
        li.appendChild(document.createTextNode(r[0] + ": "));
        if (r[2] && /^https:\/\//.test(r[1])) {
          li.appendChild(
            el("a", { href: r[1], rel: "noopener noreferrer", text: r[1] }),
          );
        } else {
          li.appendChild(el("span", { class: "try-wrap", text: r[1] }));
        }
      });
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  function pick(byPredicate, names) {
    return names
      .map(function (p) {
        return byPredicate[p];
      })
      .filter(Boolean);
  }

  function render(record) {
    clear(results);
    var facts = Array.isArray(record.facts) ? record.facts : [];
    var parcelFacts = facts.filter(function (f) {
      return /^parcel\./.test(f.predicate);
    });
    var byPredicate = {};
    parcelFacts.forEach(function (f) {
      byPredicate[f.predicate] = f;
    });
    var owner = facts.filter(function (f) {
      return f.predicate === "ownership.owner_of_record";
    });
    var values = pick(byPredicate, [
      "parcel.land_value",
      "parcel.improvement_value",
      "parcel.market_value",
      "parcel.appraised_value",
    ]);
    var building = pick(byPredicate, [
      "parcel.year_built",
      "parcel.improvement_area_sf",
      "parcel.land_area_sf",
      "parcel.building_class",
      "parcel.state_property_category",
      "parcel.num_floors",
      "parcel.neighborhood_code",
    ]);
    var year = byPredicate["parcel.tax_year"];
    var situs = byPredicate["parcel.situs_address"];
    var apn = byPredicate["parcel.apn"];

    var card = el("div", { class: "try-record" });
    card.appendChild(
      el("h2", {
        text: situs ? String(situs.value) : record.label || record.urn,
      }),
    );
    var ids = el("dl", { class: "try-ids" });
    var dt = function (k, v) {
      ids.appendChild(el("dt", { text: k }));
      ids.appendChild(
        el("dd", null, [el("span", { class: "try-wrap", text: v })]),
      );
    };
    dt("Canonical parcel ID", record.urn);
    if (apn) dt("County parcel number", String(apn.value));
    if (year) dt("Roll year", String(year.value));
    if (record.status) dt("Status", String(record.status));
    card.appendChild(ids);

    if (values.length) {
      card.appendChild(
        el("h3", {
          text: "Values" + (year ? " (roll year " + year.value + ")" : ""),
        }),
      );
      card.appendChild(factsTable("Values from the county roll", values));
    }
    if (building.length) {
      card.appendChild(el("h3", { text: "Land and building facts" }));
      card.appendChild(
        factsTable("Land and building facts from the county roll", building),
      );
    }
    card.appendChild(el("h3", { text: "Owner of record" }));
    if (owner.length) {
      card.appendChild(
        factsTable("Owner of record as the API returned it", owner),
      );
    } else {
      card.appendChild(
        el("p", {
          text: "The API returned no owner for this parcel. It withholds the names of natural persons.",
        }),
      );
    }
    if (Array.isArray(record.warnings) && record.warnings.length) {
      var warn = el("div", { class: "note" }, [
        el("strong", { text: "Warnings from the API:" }),
      ]);
      var wl = el("ul");
      record.warnings.forEach(function (w) {
        wl.appendChild(
          el("li", { text: typeof w === "string" ? w : JSON.stringify(w) }),
        );
      });
      warn.appendChild(wl);
      card.appendChild(warn);
    }
    if (typeof record.history_note === "string" && record.history_note) {
      // The API's own sentence, shown as text. It ends with the pricing URL; the page links
      // its own /pricing/ instead of printing the address.
      var sentence = record.history_note.replace(/:\s*https?:\/\/\S+\s*$/, ".");
      card.appendChild(
        el("p", { class: "note try-history" }, [
          sentence + " ",
          el("a", { href: "/pricing/", text: "Plans and limits" }),
        ]),
      );
    }
    card.appendChild(sourceBlock(parcelFacts.concat(owner)));
    card.appendChild(
      el("details", { class: "try-raw" }, [
        el("summary", { text: "Raw JSON: what your agent receives" }),
        el("pre", { text: JSON.stringify(record, null, 2) }),
      ]),
    );
    card.appendChild(
      el("p", { class: "actions" }, [
        el("a", {
          class: "button primary",
          href: "/mcp-server/",
          text: "Connect your agent",
        }),
        el("a", {
          class: "button",
          href: "/pricing/",
          text: "Plans and limits",
        }),
      ]),
    );
    results.appendChild(card);
    setStatus("Record loaded.");
  }

  function choose(items, my) {
    clear(results);
    var box = el("div", { class: "try-choose" }, [
      el("h2", { text: "Several parcels match" }),
      el("p", {
        class: "small",
        text: "Pick one. Fetching its record counts as one lookup.",
      }),
    ]);
    var ul = el("ul", { class: "try-chips" });
    items.forEach(function (it) {
      var b = el("button", {
        type: "button",
        class: "try-chip",
        text: it.label || it.urn,
      });
      b.addEventListener("click", function () {
        fetchRecord(it.urn, my);
      });
      ul.appendChild(el("li", null, [b]));
    });
    box.appendChild(ul);
    results.appendChild(box);
    setStatus("");
  }

  function fetchRecord(urn, my) {
    setStatus("Fetching the record…");
    return post(GET, { urn: urn }).then(function (r) {
      if (my !== token) return;
      showQuota(r.headers);
      if (r.status === 200 && r.data && r.data.urn) render(r.data);
      else apiProblem(r);
    });
  }

  function lookup(query) {
    var q = String(query || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!q) {
      setStatus("Enter a street address first.");
      return Promise.resolve();
    }
    var my = ++token;
    go.disabled = true;
    clear(results);
    setStatus("Searching the registry…");
    return post(SEARCH, { query: q, limit: 5 })
      .then(function (r) {
        if (my !== token) return;
        showQuota(r.headers);
        if (r.status !== 200 || !r.data) return apiProblem(r);
        var items = Array.isArray(r.data.results) ? r.data.results : [];
        if (!items.length) return missed("", r.data.coverage);
        if (items.length === 1) return fetchRecord(items[0].urn, my);
        choose(items, my);
      })
      .catch(function (e) {
        if (my === token) networkProblem(e);
      })
      .then(function () {
        if (my === token) go.disabled = false;
      });
  }

  // A link such as /try/?q=1000+Louisiana+St runs that lookup on load. The parameter is cut to
  // a plain address (letters, digits and . , # ' & / - only) of at most 120 characters; without
  // it, or with nothing left of it, no lookup runs.
  var QUERY_MAX = 120;
  function cleanQuery(raw) {
    if (typeof raw !== "string") return "";
    return raw
      .slice(0, QUERY_MAX * 4)
      .replace(/[^A-Za-z0-9 .,#'&/-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, QUERY_MAX)
      .trim();
  }
  function queryParam(search, name) {
    var parts = String(search || "")
      .slice(0, 2000)
      .replace(/^\?/, "")
      .split("&");
    for (var i = 0; i < parts.length; i++) {
      var at = parts[i].indexOf("=");
      if (at < 1 || parts[i].slice(0, at) !== name) continue;
      try {
        return decodeURIComponent(parts[i].slice(at + 1).replace(/\+/g, " "));
      } catch {
        return "";
      }
    }
    return "";
  }
  var fromLink = cleanQuery(queryParam(document.location.search, "q"));

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    lookup(input.value);
  });
  Array.prototype.forEach.call(
    document.querySelectorAll(".try-chip[data-q]"),
    function (b) {
      b.addEventListener("click", function () {
        input.value = b.getAttribute("data-q");
        lookup(input.value);
      });
    },
  );
  if (fromLink) {
    input.value = fromLink;
    lookup(fromLink);
  }
})();
