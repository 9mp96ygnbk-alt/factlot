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
      ". The search and the record fetch each count as one, and a search inside loaded coverage that finds nothing still counts; misses outside loaded coverage and input errors are free.";
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

  // --- the plain summary ------------------------------------------------------------------------
  // A person's view of the same answer, shown first: address, owner (or why there is none),
  // the values by roll year the answer holds, building and land facts, sources with dates, and
  // three actions. Built from the answer only; plain words, no programming terms.
  // summary:start
  var REPORTS = "/v1/reports";
  var PARCEL_ID = /^fl:parcel:(us-\d{5}):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
  // Places whose public file publishes no owner names (as the hint above says).
  var NO_OWNER_PLACES = /^us-(06037|06075|24\d{3}|49\d{3})$/;
  var OWNER_NOT_PUBLISHED =
    "This source does not publish owner names, so the record has no owner of record.";
  var OWNER_NOT_ORGANISATION =
    "The record has no owner of record: the registry keeps owners only when they are organisations, so the owner is not an organisation or the source left it blank.";
  var OWNER_PERSON_STYLE =
    "Not shown: the owner of record is written like a person's estate or trust.";
  var BOUNDARY =
    "Public-record values as their publisher released them. Not an appraisal or an opinion of value; not legal or tax advice.";
  var SHEET_UNSURE =
    "No answer came back in time, so the sheet may or may not have been made: one report and one lookup may have been counted. Check the free lookups left above, and wait a minute before trying again.";
  var SHEET_NO_LINK =
    "The sheet was made and one report and one lookup were counted, but the download link that came back is not one this page can open. Email contact@factlot.com with the time of this lookup.";
  var SHEET_NOTE =
    "The sheet uses one of the free tier's 3 reports a month and one lookup.";

  // The property pages' rule for an owner written like a person's estate or trust.
  // person-rule:start
  var INSTITUTION =
    /\b(UNIVERSITY|COLLEGE|SCHOOLS?|ACADEMY|SEMINARY|CHURCH|DIOCESE|ARCHDIOCESE|PARISH|SYNAGOGUE|TEMPLE|MOSQUE|DISTRICT|AUTHORITY|FUND|FOUNDATION|ASSOCIATION|SOCIETY|HOSPITAL|MUSEUM|LIBRARY|PENSION)\b/;
  var PERSON_STYLE = [
    /(?<!\bREAL )\bESTATE OF\b/,
    /\bEST OF\b/,
    /\bLIFE ESTATE\b/,
    /\bHEIRS?\b/,
    /\b(LIVING|REVOCABLE|IRREVOCABLE|REV|REVOC|IRREV|IRREVOC|FAMILY|TESTAMENTARY|MARITAL|SURVIVORS?|BYPASS|CREDIT SHELTER)\b.*\b(TRUST|TR|TRST)\b/,
    /\b(TRUST|TR|TRST)\b.*\b(DTD|DATED|U A|UA|UTA|U T A|UAD|UDT|FBO)\b/,
    /\b(TR|TRS|TRSTEE|TTEE|TTEES)$/,
  ];
  function ownerReadsAsPerson(value) {
    var s = String(value)
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      PERSON_STYLE.some(function (p) {
        return p.test(s);
      })
    )
      return true;
    if (/\b(TRUSTEES?|TTEES?|TRSTEES?)\b/.test(s))
      return !(/\bBOARD OF TRUSTEES\b/.test(s) || INSTITUTION.test(s));
    return false;
  }
  // person-rule:end

  function money(n) {
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function factOf(record, predicate) {
    var facts = Array.isArray(record.facts) ? record.facts : [];
    for (var i = 0; i < facts.length; i++)
      if (facts[i] && facts[i].predicate === predicate) return facts[i];
    return null;
  }

  /** The owner line: the organisation the answer names, or why there is none. */
  function ownerOf(record) {
    var f = factOf(record, "ownership.owner_of_record");
    if (f && typeof f.value === "string" && f.value.trim()) {
      if (ownerReadsAsPerson(f.value)) return { text: OWNER_PERSON_STYLE };
      return { name: f.value, fact: f };
    }
    var m = PARCEL_ID.exec(record.urn || "");
    return {
      text:
        m && NO_OWNER_PLACES.test(m[1])
          ? OWNER_NOT_PUBLISHED
          : OWNER_NOT_ORGANISATION,
    };
  }

  /** The values the answer holds, one per roll year and value type, newest first. */
  function valuesOf(record) {
    var out = [];
    var vh = Array.isArray(record.value_history) ? record.value_history : [];
    vh.forEach(function (e) {
      [
        ["market_value", "Market value"],
        ["appraised_value", "Appraised value"],
      ].forEach(function (t) {
        if (!e || typeof e[t[0]] !== "number") return;
        var c = (e.citations && e.citations[t[0]]) || {};
        out.push({
          year: typeof e.tax_year === "number" ? String(e.tax_year) : "",
          type: t[1],
          amount: e[t[0]],
          asOf: c.as_of || e.as_of || "",
          doc: c.document_id || "",
        });
      });
    });
    if (out.length) return out;
    var year = factOf(record, "parcel.tax_year");
    [
      ["parcel.market_value", "Market value"],
      ["parcel.appraised_value", "Appraised value"],
    ].forEach(function (t) {
      var f = factOf(record, t[0]);
      if (!f || typeof f.value !== "number") return;
      var s = sourcesOf(f)[0];
      out.push({
        year: year ? String(year.value) : "",
        type: t[1],
        amount: f.value,
        asOf: f.as_of || "",
        doc: (s && s.document_id) || "",
      });
    });
    return out;
  }

  /** One value row: every value on the summary is drawn by this function. */
  function valueRow(v) {
    return el("tr", null, [
      el("th", { scope: "row", text: v.year || "Year not stated" }),
      el("td", { text: v.type }),
      el("td", { text: money(v.amount) }),
      el("td", { class: "small", text: v.asOf ? "as of " + v.asOf : "" }),
    ]);
  }

  var BUILDING = [
    ["parcel.improvement_area_sf", "Building area"],
    ["parcel.year_built", "Year built"],
    ["parcel.building_class", "Building class"],
    ["parcel.state_property_category", "State property category"],
    ["parcel.local_use_code", "Local use code"],
    ["parcel.num_floors", "Floors"],
    ["parcel.land_area_sf", "Land area"],
  ];

  function buildingOf(record) {
    var out = [];
    BUILDING.forEach(function (b) {
      var f = factOf(record, b[0]);
      if (!f || f.value === null || f.value === undefined || f.value === "")
        return;
      var text =
        typeof f.value === "number" && /_sf$/.test(b[0])
          ? f.value.toLocaleString("en-US", { maximumFractionDigits: 0 }) +
            " sq ft"
          : String(f.value);
      out.push({ label: b[1], text: text, fact: f });
    });
    return out;
  }

  /** The source files behind what the summary shows, with every as-of date they carry. */
  function summarySources(record, shownFacts, values) {
    var byDoc = {};
    var list = [];
    var facts = Array.isArray(record.facts) ? record.facts : [];
    function add(doc, asOf, f) {
      if (!doc) return;
      var x = byDoc[doc];
      if (!x) {
        var holder =
          f ||
          facts.filter(function (g) {
            return sourcesOf(g).some(function (s) {
              return s.document_id === doc;
            });
          })[0];
        var s = holder
          ? sourcesOf(holder).filter(function (y) {
              return y.document_id === doc;
            })[0]
          : null;
        x = {
          title: (s && s.title) || "Document " + doc,
          rights: (holder && holder.rights) || {},
          dates: [],
        };
        byDoc[doc] = x;
        list.push(x);
      }
      if (asOf && x.dates.indexOf(asOf) === -1) x.dates.push(asOf);
    }
    shownFacts.forEach(function (f) {
      sourcesOf(f).forEach(function (s) {
        add(s.document_id, f.as_of, f);
      });
    });
    values.forEach(function (v) {
      add(v.doc, v.asOf, null);
    });
    return list;
  }

  function sourceLine(x) {
    var parts = [x.title];
    if (x.dates.length)
      parts.push("as of " + x.dates.sort().reverse().join(", "));
    if (x.rights.attribution)
      parts.push("attribution: " + x.rights.attribution);
    else if (x.rights.license) parts.push("licence: " + x.rights.license);
    return parts.join("; ");
  }

  /** The summary as plain text, for pasting into an email. */
  function summaryText(record, s) {
    var lines = [s.title];
    if (s.apn) lines.push("Account or parcel number: " + s.apn);
    lines.push("FactLot ID: " + record.urn);
    lines.push(
      "Owner of record: " + (s.owner.name ? s.owner.name : s.owner.text),
    );
    if (s.values.length) {
      lines.push("", "Values:");
      s.values.forEach(function (v) {
        lines.push(
          "  " +
            (v.year ? v.year + " " : "") +
            v.type.toLowerCase() +
            ": " +
            money(v.amount) +
            (v.asOf ? " (as of " + v.asOf + ")" : ""),
        );
      });
    }
    if (s.note) lines.push(s.note);
    if (s.building.length) {
      lines.push("", "Building and land:");
      s.building.forEach(function (b) {
        lines.push("  " + b.label + ": " + b.text);
      });
    }
    if (s.sources.length) {
      lines.push("", "Sources:");
      s.sources.forEach(function (x) {
        lines.push("  " + sourceLine(x));
      });
    }
    lines.push("", BOUNDARY, "Looked up with FactLot (factlot.com).");
    return lines.join("\n");
  }

  /**
   * The report service's own link, as a path on this site (factlot.com serves /v1/ too), so the
   * download stays on this origin; null for anything else.
   */
  function downloadLink(u) {
    var m =
      typeof u === "string" &&
      /^https:\/\/[a-z0-9.-]+(\/v1\/reports\/d\/[A-Za-z0-9_-]{43})$/.exec(u);
    return m ? m[1] : null;
  }

  function sheetAction(urn, slot) {
    var b = el("button", {
      type: "button",
      class: "button primary",
      text: "Download a one-page sheet (PDF)",
    });
    var out = el("p", { class: "small", role: "status" });
    b.addEventListener("click", function () {
      b.disabled = true;
      out.textContent = "Building the sheet…";
      post(REPORTS, {
        kind: "property_sheet",
        format: "pdf",
        arguments: { urn: urn },
      })
        .then(function (r) {
          clear(out);
          showQuota(r.headers);
          var d = r.data || {};
          var link = r.status === 201 ? downloadLink(d.download_url) : null;
          if (r.status === 201 && !link) {
            out.textContent = SHEET_NO_LINK;
          } else if (link) {
            out.appendChild(
              el("a", { href: link, text: "Your sheet is ready: download it" }),
            );
            out.appendChild(
              document.createTextNode(
                " (the link works for 24 hours" +
                  (d.reports && typeof d.reports.remaining === "number"
                    ? "; free reports left this month: " + d.reports.remaining
                    : "") +
                  ").",
              ),
            );
          } else {
            out.textContent =
              typeof d.message === "string" && d.message
                ? d.message
                : "The sheet could not be made (HTTP " + r.status + ").";
            b.disabled = false;
          }
        })
        .catch(function () {
          // A timeout or a dropped connection: the server may still have made the sheet.
          out.textContent = SHEET_UNSURE;
          b.disabled = false;
        });
    });
    slot.appendChild(b);
    return out;
  }

  /** The public property page, linked only when the site serves one for this parcel. */
  function pageAction(urn, slot) {
    var m = PARCEL_ID.exec(urn || "");
    if (!m || typeof fetch !== "function") return;
    var path = "/property/" + m[1] + "/" + m[2];
    fetch(path, { method: "HEAD", credentials: "omit", cache: "no-store" })
      .then(function (res) {
        if (res.status === 200)
          slot.appendChild(
            el("a", {
              class: "button",
              href: path,
              text: "Open this property's page",
            }),
          );
      })
      .catch(function () {});
  }

  function copyAction(text, slot) {
    var b = el("button", {
      type: "button",
      class: "button",
      text: "Copy as text",
    });
    var out = el("p", { class: "small", role: "status" });
    b.addEventListener("click", function () {
      var shown = function () {
        clear(out);
        var area = el("textarea", {
          class: "try-copy",
          rows: "12",
          readonly: "readonly",
          "aria-label": "The summary as text",
        });
        area.value = text;
        out.appendChild(area);
        area.focus();
        area.select();
      };
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(text).then(function () {
          out.textContent = "Copied. Paste it into an email or a document.";
        }, shown);
      else shown();
    });
    slot.appendChild(b);
    return out;
  }

  function summaryBlock(record) {
    var situs = factOf(record, "parcel.situs_address");
    var apn = factOf(record, "parcel.apn");
    var s = {
      title: situs ? String(situs.value) : record.label || record.urn,
      apn: apn ? String(apn.value) : "",
      owner: ownerOf(record),
      values: valuesOf(record),
      building: buildingOf(record),
      note: "",
    };
    s.sources = summarySources(
      record,
      [situs, apn, s.owner.fact]
        .concat(
          s.building.map(function (b) {
            return b.fact;
          }),
        )
        .filter(Boolean),
      s.values,
    );
    var box = el("section", { class: "try-summary", "aria-label": "Summary" });
    box.appendChild(el("h2", { text: s.title }));
    var ids = el("dl", { class: "try-ids" });
    var row = function (k, v) {
      ids.appendChild(el("dt", { text: k }));
      ids.appendChild(
        el("dd", null, [el("span", { class: "try-wrap", text: v })]),
      );
    };
    if (s.apn) row("Account or parcel number", s.apn);
    row("FactLot ID", record.urn);
    row("Owner of record", s.owner.name ? s.owner.name : s.owner.text);
    box.appendChild(ids);

    box.appendChild(el("h3", { text: "Values by roll year" }));
    if (s.values.length) {
      var t = el("table");
      t.appendChild(
        el("caption", {
          class: "visually-hidden",
          text: "Values by roll year",
        }),
      );
      var tb = el("tbody");
      s.values.forEach(function (v) {
        tb.appendChild(valueRow(v));
      });
      t.appendChild(tb);
      box.appendChild(el("div", { class: "try-table" }, [t]));
    } else
      box.appendChild(el("p", { text: "The record holds no roll value." }));
    var notes = [];
    [record.history_note, record.sales_note].forEach(function (n) {
      if (typeof n !== "string" || !n) return;
      // The API's own sentence, shown as text. It ends with the pricing URL; the page links
      // its own /pricing/ instead of printing the address.
      notes.push(n.replace(/:\s*https?:\/\/\S+\s*$/, "."));
    });
    if (notes.length) {
      s.note = notes.join(" ");
      box.appendChild(
        el("p", { class: "note try-history" }, [
          s.note + " ",
          el("a", {
            class: "button primary",
            href: "/pricing/",
            text: "Plans and limits",
          }),
        ]),
      );
    }
    if (s.building.length) {
      box.appendChild(el("h3", { text: "Building and land" }));
      var bl = el("dl", { class: "try-ids" });
      s.building.forEach(function (b) {
        bl.appendChild(el("dt", { text: b.label }));
        bl.appendChild(el("dd", { text: b.text }));
      });
      box.appendChild(bl);
    }
    if (s.sources.length) {
      box.appendChild(el("h3", { text: "Sources" }));
      var ul = el("ul", { class: "try-sources" });
      s.sources.forEach(function (x) {
        ul.appendChild(el("li", { text: sourceLine(x) }));
      });
      box.appendChild(ul);
    }
    box.appendChild(el("p", { class: "small", text: BOUNDARY }));

    var actions = el("p", { class: "actions try-actions" });
    var sheetOut = sheetAction(record.urn, actions);
    var copyOut = copyAction(summaryText(record, s), actions);
    pageAction(record.urn, actions);
    box.appendChild(actions);
    box.appendChild(el("p", { class: "small", text: SHEET_NOTE }));
    box.appendChild(sheetOut);
    box.appendChild(copyOut);
    return box;
  }

  /** What tells one matching parcel from another, from the search answer itself. */
  function distinguish(it) {
    var m = PARCEL_ID.exec((it && it.urn) || "");
    return m
      ? "County code " + m[1].slice(3) + ", parcel " + m[2]
      : String((it && it.urn) || "");
  }
  // summary:end

  // The page carries one hidden link per hosted Texas county (try-texas-links, written at build
  // from the county data). A parcel's ID names its county by FIPS code: fl:parcel:us-48201:...
  function texasLink(urn) {
    var m = /^fl:parcel:us-(48\d{3}):/.exec(String(urn || ""));
    if (!m) return null;
    var items = document.querySelectorAll("#try-texas-links li[data-fips]");
    for (var i = 0; i < items.length; i++)
      if (items[i].getAttribute("data-fips") === m[1]) {
        var a = items[i].querySelector("a");
        if (a) return { href: a.getAttribute("href"), text: a.textContent };
      }
    return null;
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
    var apn = byPredicate["parcel.apn"];

    var card = el("div", { class: "try-record" });
    card.appendChild(summaryBlock(record));
    card.appendChild(el("h3", { text: "Every fact, with its citation" }));
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
      // The roll as the registry marks it (value_history's `roll`): "preliminary" where it says so.
      var entry = (record.value_history || []).filter(function (e) {
        return year && e.tax_year === year.value;
      })[0];
      var rollNote =
        entry && entry.roll === "preliminary" ? ", preliminary roll" : "";
      card.appendChild(
        el("h3", {
          text:
            "Values" +
            (year ? " (roll year " + year.value + rollNote + ")" : ""),
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
    var ownerLine = ownerOf(record);
    if (owner.length && ownerLine.name) {
      card.appendChild(
        factsTable("Owner of record as the API returned it", owner),
      );
    } else {
      card.appendChild(el("p", { text: ownerLine.text }));
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
    var tx = texasLink(record.urn);
    if (tx)
      card.appendChild(
        el("p", { class: "note try-texas" }, [
          "For a Texas account the Texas tools go further: candidate comparables under a stated default rule for you to review, this account's values by roll year, the unequal-appraisal arithmetic on the comparables you choose, and the protest deadline. See ",
          el("a", { href: tx.href, text: tx.text }),
          ".",
        ]),
      );
    // The newest recorded sale or deed the API returned (a free answer keeps one), as recorded.
    var sale = facts.filter(function (f) {
      return (
        f.predicate === "transaction.sale" || f.predicate === "transaction.deed"
      );
    })[0];
    if (sale && sale.value && typeof sale.value === "object") {
      var sv = sale.value;
      var deed = sale.predicate === "transaction.deed";
      var amount = deed ? sv.amount_usd : sv.price_usd;
      var saleRows = [
        [deed ? "Date recorded" : "Sale date", sv.date || "not recorded"],
        [
          "Price as recorded",
          typeof amount === "number"
            ? "$" + amount.toLocaleString("en-US")
            : "not recorded",
        ],
        ["Document type", deed ? sv.doc_type || "not recorded" : "sale record"],
      ];
      var st = el("table");
      st.appendChild(
        el("caption", {
          class: "visually-hidden",
          text: "Latest recorded sale as the API returned it",
        }),
      );
      var sb = el("tbody");
      saleRows.forEach(function (r) {
        sb.appendChild(
          el("tr", null, [
            el("th", { scope: "row", text: r[0] }),
            el("td", { text: String(r[1]) }),
            el("td", { class: "small", text: citation(sale) }),
          ]),
        );
      });
      st.appendChild(sb);
      card.appendChild(el("h3", { text: "Latest recorded sale" }));
      card.appendChild(el("div", { class: "try-table" }, [st]));
      card.appendChild(
        el("p", {
          class: "small",
          text: "As recorded. The record does not say whether a sale was at arm's length.",
        }),
      );
    }
    card.appendChild(
      sourceBlock(
        parcelFacts.concat(ownerLine.name ? owner : [], sale ? [sale] : []),
      ),
    );
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
      var b = el("button", { type: "button", class: "try-chip" }, [
        it.label || it.urn,
        el("br"),
        el("span", { class: "small", text: distinguish(it) }),
      ]);
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
        if (!items.length)
          return missed(
            typeof r.data.message === "string" ? r.data.message : "",
            r.data.coverage,
          );
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
    // A URL with a query is a lookup, not a page to index (robots.txt says so too).
    if (document.head) {
      var meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      meta.setAttribute("content", "noindex");
      document.head.appendChild(meta);
    }
    input.value = fromLink;
    lookup(fromLink);
  }
})();
