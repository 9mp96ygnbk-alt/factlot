#!/usr/bin/env node
// Builds factlot.com into one folder: copies site/ (without its notes and _content/) and renders
// the pages generated from the tool catalog and the shared vectors. Every number on a generated
// page is computed here by the built packages and checked against a vector case, and the build
// fails on a broken internal link, an external script or stylesheet, or JSON-LD that does not parse.
//
//   npm run build && node scripts/site/build.mjs [outDir]   (default deploy/cloudflare/public)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  countyBody,
  countyDescription,
  countyTitle,
  exampleBody,
  exampleDescription,
  exampleTitle,
  otherDistrictsTable,
  countWord,
  hubHostedTable,
  hubRollSentence,
  hubCountyLinks,
} from "./texas-pages.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const out = path.resolve(
  process.argv[2] ?? path.join(root, "deploy/cloudflare/public"),
);
const SITE = "https://factlot.com";
const REPO = "https://github.com/9mp96ygnbk-alt/factlot";
const TODAY = new Date().toISOString().slice(0, 10);

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));
const { runTool } = await import(
  pathToFileURL(path.join(root, "packages/tools/dist/index.js")).href
);

const VERSION = readJson("packages/mcp/package.json").version;
const catalog = readJson("spec/schemas/tools.json");
const tools = Array.isArray(catalog) ? catalog : catalog.tools;
const toolByName = new Map(tools.map((t) => [t.name, t]));
const calcTools = tools.filter((t) => t.name.startsWith("calc_"));

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Last commit date of any of the files (YYYY-MM-DD), or today for uncommitted work. */
function lastmod(files) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", ...files], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (dirty) return TODAY;
  const d = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...files], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return d || TODAY;
}

function fill(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`no value for ${m}`);
    return vars[k];
  });
}

const NAV = [
  ["/try/", "Try it"],
  ["/calculators/", "Calculators"],
  ["/mcp-server/", "MCP server"],
  ["/texas/", "Texas"],
  ["/coverage/", "Coverage"],
  [`${REPO}/blob/main/docs/getting-started.md`, "Docs"],
  ["/pricing/", "Pricing"],
];

/** The trust package, in reading order: how it is run, what is promised, how numbers are proven. */
const TRUST = [
  ["/status/", "Status"],
  ["/security/", "Security"],
  ["/sla/", "Service levels"],
  ["/assurance/", "Assurance"],
];

function layout({
  urlPath,
  title,
  description,
  h1,
  body,
  crumbs,
  jsonld = [],
  scripts = [],
}) {
  const url = SITE + urlPath;
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [["/", "FactLot"], ...crumbs].map(([p, name], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: SITE + p,
    })),
  };
  const ld = [breadcrumb, ...jsonld]
    .map(
      (o) =>
        `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`,
    )
    .join("\n");
  const crumbHtml = [["/", "FactLot"], ...crumbs.slice(0, -1)]
    .map(([p, name]) => `<a href="${p}">${esc(name)}</a>`)
    .concat(esc(crumbs.at(-1)[1]))
    .join(" › ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${url}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/icon-48.png" sizes="48x48" type="image/png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="FactLot" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}/social-preview.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="stylesheet" href="/styles.css" />
${ld}
${scripts.map((src) => `<script src="${src}" defer></script>`).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<div class="wrap row">
<a class="brand" href="/" aria-label="FactLot home">FactLot</a>
<nav aria-label="Site">
<ul>
${NAV.map(([href, label]) => `<li><a href="${href}"${href === urlPath ? ' aria-current="page"' : ""}>${label}</a></li>`).join("\n")}
</ul>
</nav>
</div>
</header>
<main id="main">
<section aria-labelledby="page-title">
<div class="wrap">
<p class="small breadcrumbs">${crumbHtml}</p>
<h1 id="page-title">${esc(h1)}</h1>
${body}
</div>
</section>
</main>
<footer class="site-footer">
<div class="wrap">
<p>
<a href="${REPO}">GitHub</a> ·
<a href="mailto:contact@factlot.com">contact@factlot.com</a> ·
<a href="/privacy">Privacy</a> ·
<a href="/terms">Terms</a> ·
<a href="${REPO}/blob/main/LICENSE">Apache-2.0 (platform) and MIT (schema and SDKs)</a>
</p>
<p>
Trust: ${TRUST.map(([p, name]) => `<a href="${p}">${name}</a>`).join(" · ")}
</p>
<p class="small">"FactLot" and the FactLot logo are trademarks of their owner. The open-source licences cover the code, not the name.</p>
</div>
</footer>
</body>
</html>
`;
}

const pages = []; // { urlPath, html, sources }
// The Worker strips trailing slashes and answers these paths itself on every host
// (deploy/cloudflare/src/router.ts), so a page there would never be served.
const WORKER_PATHS = [
  "/mcp",
  "/openapi.json",
  "/openapi-3.0.json",
  "/health",
  "/v1",
  "/billing",
];
function addPage(page, sources) {
  const p = page.urlPath.replace(/\/+$/, "");
  if (WORKER_PATHS.some((w) => p === w || p.startsWith(`${w}/`)))
    throw new Error(
      `${page.urlPath} is a path the Worker answers itself; pick another`,
    );
  pages.push({ urlPath: page.urlPath, html: layout(page), sources });
}

// --- values, steps and vector checks -------------------------------------------------------

function at(obj, dotted) {
  return dotted
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** A vector's expected number is rounded; accept anything within half a unit of its last digit. */
function matches(actual, expected) {
  if (typeof expected === "number") {
    if (typeof actual !== "number") return false;
    const decimals = (String(expected).split(".")[1] ?? "").length;
    return Math.abs(actual - expected) <= 0.5 * 10 ** -decimals + 1e-9;
  }
  if (expected === null) return actual == null;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function run(toolName, input, expect, label) {
  const r = runTool(toolName, input);
  if (!r.ok)
    throw new Error(
      `${label}: ${toolName} failed: ${JSON.stringify(r).slice(0, 300)}`,
    );
  for (const [k, v] of Object.entries(expect ?? {})) {
    if (!matches(at(r.result, k), v))
      throw new Error(
        `${label}: ${k} = ${JSON.stringify(at(r.result, k))}, vector says ${JSON.stringify(v)}`,
      );
  }
  return r.result;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function fmt(value, unit) {
  if (typeof value === "number") {
    if (unit === "USD") return usd.format(value);
    if (unit === "%" || unit === "percent") return `${num.format(value)}%`;
    return unit ? `${num.format(value)} ${esc(unit)}` : num.format(value);
  }
  if (typeof value === "string") return esc(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return `<code>${esc(JSON.stringify(value))}</code>`;
}

function valueTable(value) {
  const rows = Object.entries(value).filter(
    ([, v]) =>
      v === null ||
      typeof v !== "object" ||
      (Array.isArray(v) &&
        v.length <= 4 &&
        v.every((x) => typeof x !== "object")),
  );
  if (!rows.length) return "";
  return `<table>
<caption class="visually-hidden">Result values</caption>
<thead><tr><th scope="col">Result</th><th scope="col">Value</th></tr></thead>
<tbody>
${rows.map(([k, v]) => `<tr><th scope="row"><code>${esc(k)}</code></th><td>${v === null ? "none" : fmt(v)}</td></tr>`).join("\n")}
</tbody>
</table>`;
}

const MAX_STEPS = 40;
function stepsTable(steps) {
  const shown = steps.slice(0, MAX_STEPS);
  return `<table>
<caption class="visually-hidden">Audit trail</caption>
<thead><tr><th scope="col">Step</th><th scope="col">Value</th><th scope="col">Formula</th></tr></thead>
<tbody>
${shown.map((s) => `<tr><th scope="row">${esc(s.label)}</th><td>${fmt(s.value, s.unit)}</td><td>${s.formula ? `<code>${esc(s.formula)}</code>` : ""}</td></tr>`).join("\n")}
</tbody>
</table>${steps.length > MAX_STEPS ? `\n<p class="small">First ${MAX_STEPS} of ${steps.length} steps shown; the tool returns all of them.</p>` : ""}`;
}

let txRule; // the verified Texas rule's metadata, set when its page is built

// --- /mcp-server/ ---------------------------------------------------------------------------------

addPage(
  {
    urlPath: "/mcp-server/",
    title: "Commercial real estate MCP server | FactLot",
    description:
      "FactLot's hosted MCP server gives AI agents CRE calculators with audit trails, lease document verification, property IDs and cited public-record facts. No API key.",
    h1: "Commercial real estate MCP server",
    crumbs: [["/mcp-server/", "MCP server"]],
    body: fill(read("site/_content/mcp.html"), { VERSION }),
  },
  ["site/_content/mcp.html"],
);

// --- /try/ ----------------------------------------------------------------------------------------
// One address search against the hosted free tier, from the visitor's browser. The page calls the
// same-origin /v1/registry routes the Worker already serves on factlot.com; /try/try.js is its only
// script and is copied from site/try/.

addPage(
  {
    urlPath: "/try/",
    title: "Try a lookup: cited property records, no key | FactLot",
    description:
      "Look up a commercial property by address on FactLot's hosted free tier: parcel ID, situs address, roll values, building facts and the source citations, with the raw JSON an agent receives.",
    h1: "Try a lookup",
    crumbs: [["/try/", "Try a lookup"]],
    body: read("site/_content/try.html"),
    scripts: ["/try/try.js"],
  },
  ["site/_content/try.html", "site/try/try.js"],
);

// --- /pricing/ ------------------------------------------------------------------------------------
// The plan numbers are written in the fragment; site.test.ts checks them against
// deploy/cloudflare/src/plans.ts, so the page cannot drift from what the Worker enforces.

addPage(
  {
    urlPath: "/pricing/",
    title: "Pricing: hosted plans and registry lookups | FactLot",
    description:
      "FactLot's hosted API: Free, Pro ($49 a month) and Team ($599 a month). Request rates, registry lookups, reports, what counts as a lookup, and how to cancel.",
    h1: "Pricing",
    crumbs: [["/pricing/", "Pricing"]],
    body: fill(read("site/_content/pricing.html"), { REPO }),
  },
  ["site/_content/pricing.html", "deploy/cloudflare/src/plans.ts"],
);

// --- calculators ---------------------------------------------------------------------------

const manifest = readJson("site/_content/calculators/manifest.json");
const bySlug = new Map(manifest.map((m) => [m.slug, m]));

for (const m of manifest) {
  const tool = toolByName.get(m.tool);
  if (!tool)
    throw new Error(`calculators/${m.slug}: no tool ${m.tool} in tools.json`);
  const vectorRel = `spec/vectors/calc/${m.vector_file}`;
  const vector = readJson(vectorRel);
  const kase = vector.cases.find((c) => c.name === m.example_case);
  if (!kase)
    throw new Error(
      `calculators/${m.slug}: no case "${m.example_case}" in ${vectorRel}`,
    );
  const result = run(m.tool, kase.input, kase.expect, `calculators/${m.slug}`);
  const fragmentRel = `site/_content/calculators/${m.slug}.html`;
  const formulaId = `${tool.formula.id}@${tool.formula.version}`;
  const body = JSON.stringify(kase.input);
  const curlBody = body.length <= 1200 ? `-d '${body}'` : "-d @input.json";
  const workbook = m.workbook
    ? `<h2 id="excel">Check it in Excel</h2>
<p>The <a href="${REPO}/blob/main/examples/reconciliation/${encodeURIComponent(m.workbook)}">${esc(m.workbook)}</a> workbook recomputes this calculator with live Excel formulas beside FactLot's numbers and a difference column. Its inputs are synthetic; the <a href="${REPO}/blob/main/examples/reconciliation/README.md">reconciliation guide</a> explains each sheet.</p>`
    : "";
  if (
    m.workbook &&
    !fs.existsSync(path.join(root, "examples/reconciliation", m.workbook))
  )
    throw new Error(`calculators/${m.slug}: workbook ${m.workbook} not found`);
  const related = m.related
    .map((s) => {
      const r = bySlug.get(s);
      if (!r)
        throw new Error(`calculators/${m.slug}: related ${s} is not a page`);
      return `<li><a href="/calculators/${s}/">${esc(r.h1)}</a></li>`;
    })
    .join("\n");
  const warnings = result.warnings?.length
    ? `<h3>Warnings</h3>\n<ul>\n${result.warnings.map((w) => `<li>${esc(typeof w === "string" ? w : (w.message ?? JSON.stringify(w)))}</li>`).join("\n")}\n</ul>`
    : "";
  addPage(
    {
      urlPath: `/calculators/${m.slug}/`,
      title: `${m.title} | FactLot`,
      description: m.description,
      h1: m.h1,
      crumbs: [
        ["/calculators/", "Calculators"],
        [`/calculators/${m.slug}/`, m.title],
      ],
      body: `<p class="lede">${esc(m.description)}</p>
${read(fragmentRel)}
<h2 id="example">Worked example</h2>
<p>Inputs from FactLot's shared test case "${esc(m.example_case)}", which the TypeScript and Python libraries must both reproduce:</p>
<pre><code>${esc(JSON.stringify(kase.input, null, 2))}</code></pre>
<h3>Result</h3>
${valueTable(result.value)}
<h3>Audit trail</h3>
<p>Every intermediate value, in order, with the formula that produced it. Formula <code>${esc(formulaId)}</code>.</p>
${stepsTable(result.steps)}
${warnings}
${workbook}
<h2 id="use">Use it from an agent or your code</h2>
<ul class="plain">
<li><strong>MCP:</strong> tool <code>${esc(m.tool)}</code> on <code>https://api.factlot.com/mcp</code> (<a href="/mcp-server/">connect a client</a>).</li>
<li><strong>Python:</strong> <code>factlot.run_tool("${esc(m.tool)}", input)</code> runs the same calculation offline (<a href="${REPO}/blob/main/python/README.md">Python SDK</a>).</li>
<li><strong>Input schema:</strong> every field is described in <a href="${REPO}/blob/main/spec/schemas/tools.json">tools.json</a>.</li>
</ul>
<pre><code>curl -s https://api.factlot.com${esc(tool.path)} \\
  -H 'content-type: application/json' \\
  ${esc(curlBody)}</code></pre>
<h2 id="related">Related calculators</h2>
<ul>
${related}
<li><a href="/calculators/">All calculators</a></li>
</ul>`,
    },
    [fragmentRel, "site/_content/calculators/manifest.json", vectorRel],
  );
}

addPage(
  {
    urlPath: "/calculators/",
    title: "Commercial real estate calculators with audit trails | FactLot",
    description: `${calcTools.length} deterministic commercial real estate calculators: net effective rent, debt sizing, CAM, yield maintenance, ASC 842, WALT, cap rate, waterfalls. Every step shown.`,
    h1: "Commercial real estate calculators",
    crumbs: [["/calculators/", "Calculators"]],
    body: `<p class="lede">FactLot has ${calcTools.length} calculators for lease economics, debt, valuation and returns. Each returns the value, every intermediate step with its formula, warnings, and a versioned formula ID, so an analyst or an AI agent can show exactly how a number was made. The TypeScript and Python libraries produce identical results, checked by shared test cases.</p>
<div class="cards">
${manifest.map((m) => `<article class="card"><h2><a href="/calculators/${m.slug}/">${esc(m.h1)}</a></h2><p>${esc(m.description)}</p></article>`).join("\n")}
</div>
<h2 id="all">Every calculator</h2>
<p>All of them run on the hosted <a href="/mcp-server/">MCP server</a> and REST API, and offline in the SDKs.</p>
<table>
<caption class="visually-hidden">All calculators</caption>
<thead><tr><th scope="col">Calculator</th><th scope="col">Tool</th><th scope="col">Formula</th></tr></thead>
<tbody>
${calcTools.map((t) => `<tr><th scope="row">${esc(t.title)}</th><td><code>${esc(t.name)}</code></td><td><code>${esc(`${t.formula?.id}@${t.formula?.version}`)}</code></td></tr>`).join("\n")}
</tbody>
</table>`,
  },
  ["site/_content/calculators/manifest.json", "spec/schemas/tools.json"],
);

// --- Texas protest deadline ----------------------------------------------------------------

{
  const RULE_TOOL = "rules_tx_property_tax_protest_deadline";
  const vectorRel = "spec/vectors/rules/tx_property_tax_protest_deadline.json";
  const vector = readJson(vectorRel);
  const now = new Date();
  // After May the next season is next year's.
  const first = now.getUTCFullYear() + (now.getUTCMonth() >= 5 ? 1 : 0);
  const years = [first, first + 1, first + 2];
  const rows = years.map((y) => {
    const kase = vector.cases.find(
      (c) => c.input.tax_year === y && Object.keys(c.input).length === 1,
    );
    return run(RULE_TOOL, { tax_year: y }, kase?.expect, `texas ${y}`);
  });
  if (
    !vector.cases.some(
      (c) =>
        years.includes(c.input.tax_year) && Object.keys(c.input).length === 1,
    )
  )
    throw new Error(
      "texas: no vector case covers the years on the page; add one",
    );
  const rule = rows[0].value.rule;
  txRule = rule;
  const long = (iso) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  // Older builds of the rule call the conservative date recommended_file_by.
  const fileBy = (v) => v.conservative_file_by ?? v.recommended_file_by;
  const table = `<table>
<caption class="visually-hidden">Texas protest deadlines by tax year</caption>
<thead><tr><th scope="col">Tax year</th><th scope="col">Statutory deadline</th><th scope="col">Conservative file-by date</th><th scope="col">Why</th></tr></thead>
<tbody>
${rows
  .map((r, i) => {
    const v = r.value;
    const why = v.skipped_non_business_days.length
      ? `May 15 falls on a ${v.skipped_non_business_days[0].reason}; skipped ${v.skipped_non_business_days.map((s) => `${s.date} (${esc(s.reason)})`).join(", ")}`
      : "May 15 is a business day";
    return `<tr><th scope="row">${years[i]}</th><td>${long(v.deadline)}</td><td>${long(fileBy(v))}</td><td>${why}</td></tr>`;
  })
  .join("\n")}
</tbody>
</table>`;
  const sources = `<ul>\n${rule.citations.map((c) => `<li><a href="${esc(c.url)}">${esc(c.law)}</a></li>`).join("\n")}\n</ul>`;
  const next = rows[0].value;
  const nextSummary = next.skipped_non_business_days.length
    ? `For tax year ${years[0]}, May 15 falls on a ${esc(next.skipped_non_business_days[0].reason)}, so under §1.06 the general deadline is ${long(next.deadline)}. The conservative file-by date is ${long(fileBy(next))}.`
    : `For tax year ${years[0]}, May 15 is a business day, so the general deadline is ${long(next.deadline)}.`;
  addPage(
    {
      urlPath: "/texas/property-tax-protest-deadline/",
      title: `Texas property tax protest deadline ${years[0]} | FactLot`,
      description: `The ${years[0]} Texas property tax protest deadline is ${long(next.deadline)} under Tax Code §41.44 and §1.06, unless a later notice moves it. Statute citations included.`,
      h1: `Texas property tax protest deadline (${years[0]})`,
      crumbs: [
        ["/texas/", "Texas"],
        [
          "/texas/property-tax-protest-deadline/",
          "Texas property tax protest deadline",
        ],
      ],
      body: fill(read("site/_content/texas-protest-deadline.html"), {
        TX_RULE_ID: esc(`${rule.id}@${rule.version}`),
        TX_TABLE: table,
        TX_NEXT_YEAR: String(years[0]),
        TX_NEXT_SUMMARY: nextSummary,
        TX_SOURCES: sources,
        TX_CHECKED: long(rule.verification.verified_at),
      }),
    },
    [
      "site/_content/texas-protest-deadline.html",
      vectorRel,
      "packages/calc/src/rules.ts",
    ],
  );
}

// --- /texas/ hub ------------------------------------------------------------------------------------

{
  const hubCounties = readJson("site/_data/texas-counties.json").counties;
  const hubExamples = readJson("site/_data/texas-examples.json").examples.map(
    (e) => e.county,
  );
  const hubTotal = hubCounties.reduce((a, c) => a + c.hosted_parcels, 0);
  addPage(
    {
      urlPath: "/texas/",
      title: "Texas commercial property data and tools | FactLot",
      description: `What FactLot hosts for Texas: ${hubTotal.toLocaleString("en-US")} commercial parcels in ${countWord(hubCounties.length)} counties, the unequal-appraisal calculator, the protest-deadline rule, reports, and how to connect.`,
      h1: "Texas",
      crumbs: [["/texas/", "Texas"]],
      body: fill(read("site/_content/texas.html"), {
        COUNTY_COUNT: countWord(hubCounties.length),
        HOSTED_TABLE: hubHostedTable(hubCounties),
        ROLL_SENTENCE: hubRollSentence(hubCounties),
        COUNTY_LINKS: hubCountyLinks(hubCounties, hubExamples),
        OTHER_DISTRICTS: otherDistrictsTable(),
      }),
    },
    [
      "site/_content/texas.html",
      "site/_data/texas-counties.json",
      "scripts/site/texas-pages.mjs",
    ],
  );
}

// --- /texas/<county>/ and /texas/<county>/example/ ----------------------------------------------
// Figures come from site/_data/texas-counties.json and texas-examples.json, which
// scripts/site/gen-texas-counties.ts and gen-texas-examples.ts write from a built registry file.

{
  const countiesRel = "site/_data/texas-counties.json";
  const examplesRel = "site/_data/texas-examples.json";
  const counties = readJson(countiesRel).counties;
  const examples = new Map(
    readJson(examplesRel).examples.map((e) => [e.county, e]),
  );
  const countyTpl = read("site/_content/texas-county.html");
  const exampleTpl = read("site/_content/texas-example.html");
  for (const c of counties) {
    const e = examples.get(c.slug);
    addPage(
      {
        urlPath: `/texas/${c.slug}/`,
        title: countyTitle(c),
        description: countyDescription(c),
        h1: `${c.name} County, Texas`,
        crumbs: [
          ["/texas/", "Texas"],
          [`/texas/${c.slug}/`, `${c.name} County`],
        ],
        body: countyBody(c, countyTpl, Boolean(e)),
      },
      [
        "site/_content/texas-county.html",
        countiesRel,
        "scripts/site/texas-pages.mjs",
      ],
    );
    if (e)
      addPage(
        {
          urlPath: `/texas/${c.slug}/example/`,
          title: exampleTitle(c),
          description: exampleDescription(c),
          h1: `${c.name} County worked example`,
          crumbs: [
            ["/texas/", "Texas"],
            [`/texas/${c.slug}/`, `${c.name} County`],
            [`/texas/${c.slug}/example/`, "Worked example"],
          ],
          body: exampleBody(c, e, exampleTpl),
        },
        [
          "site/_content/texas-example.html",
          examplesRel,
          "scripts/site/texas-pages.mjs",
        ],
      );
  }
}

// --- County coverage map -------------------------------------------------------------------

let coverageJson;
{
  const covRel = "docs/registry/coverage-counties.json";
  const geoRel = "site/_content/coverage-geometry.json";
  const cov = readJson(covRel);
  const geo = readJson(geoRel);
  const CLASSES = ["hosted", "audited_load", "cited_load"];
  const LABEL = {
    hosted: "Hosted lookups",
    audited_load: "Audited, not yet hosted",
    cited_load: "Loaded, not yet audited",
  };
  const fmtN = (n) => Number(n).toLocaleString("en-US");
  const entries = Object.entries(cov.counties);
  for (const [fips, c] of entries) {
    if (!/^\d{5}$/.test(fips)) throw new Error(`coverage: bad FIPS ${fips}`);
    if (!CLASSES.includes(c.class))
      throw new Error(`coverage: ${fips} class ${c.class}`);
    if (!geo.counties[fips])
      throw new Error(`coverage: ${fips} has no boundary`);
  }
  // Tiny counties (DC, Manhattan) get a dot so they can be seen and tapped.
  const box = (d) => {
    const xs = [],
      ys = [];
    let x = 0,
      y = 0;
    for (const [, cmd, body] of d.matchAll(/([MlZ])([^MlZ]*)/g)) {
      const nums = (body.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      if (cmd === "M") {
        [x, y] = nums;
        xs.push(x);
        ys.push(y);
      }
      if (cmd === "l")
        for (let i = 0; i + 1 < nums.length; i += 2) {
          x += nums[i];
          y += nums[i + 1];
          xs.push(x);
          ys.push(y);
        }
    }
    return {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
  };
  const ordered = entries.sort(
    (a, b) => CLASSES.indexOf(b[1].class) - CLASSES.indexOf(a[1].class),
  );
  const shapes = ordered
    .map(([fips, c]) => {
      const t = `<title>${esc(c.name)}, ${esc(c.state)}: ${LABEL[c.class]}${c.withheld ? ` (${esc(c.withheld)})` : ""}. ${fmtN(c.commercial_parcels)} commercial parcels, data as of ${c.data_as_of}.</title>`;
      const b = box(geo.counties[fips].d);
      const dot =
        Math.max(b.x1 - b.x0, b.y1 - b.y0) < 6
          ? `<circle cx="${((b.x0 + b.x1) / 2).toFixed(1)}" cy="${((b.y0 + b.y1) / 2).toFixed(1)}" r="4.5" class="dot"/>`
          : "";
      return `<g class="cty cov-${c.class}" data-fips="${fips}" tabindex="0">${t}<path d="${geo.counties[fips].d}"/>${dot}</g>`;
    })
    .join("\n");
  const n = Object.fromEntries(
    CLASSES.map((k) => [k, entries.filter(([, c]) => c.class === k).length]),
  );
  const total = 3142; // counties and county equivalents drawn on this map (50 states and DC)
  if (Object.keys(geo.counties).length !== total)
    throw new Error("coverage: geometry county count changed");
  const svg = `<svg class="covsvg" viewBox="${geo.viewBox}" role="img" aria-labelledby="covsvg-t covsvg-d" xmlns="http://www.w3.org/2000/svg">
<title id="covsvg-t">FactLot commercial property data coverage by US county</title>
<desc id="covsvg-d">${n.hosted} counties with hosted lookups, ${n.audited_load} audited, ${n.cited_load} loaded but not yet audited; the other ${total - entries.length} counties are grey. The full list is below the map.</desc>
<path class="nation" d="${geo.nation}"/>
${shapes}
<path class="cmesh" d="${geo.countyMesh}"/>
<path class="smesh" d="${geo.stateMesh}"/>
</svg>`;
  const byState = {};
  for (const [fips, c] of entries) (byState[c.state] ??= []).push([fips, c]);
  const table = `<table class="covtable">
<caption class="visually-hidden">Counties with FactLot data</caption>
<thead><tr><th scope="col">County</th><th scope="col">FIPS</th><th scope="col">Status</th><th scope="col">Commercial parcels</th><th scope="col">Data as of</th></tr></thead>
<tbody>
${Object.keys(byState)
  .sort()
  .map((st) =>
    byState[st]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(
        ([fips, c]) =>
          `<tr><th scope="row">${esc(c.name)}, ${esc(c.state)}</th><td>${fips}</td><td><span class="sw sm cov-${c.class}" aria-hidden="true"></span>${LABEL[c.class]}${c.withheld ? `: ${esc(c.withheld)}` : ""}</td><td>${fmtN(c.commercial_parcels)}</td><td>${c.data_as_of}</td></tr>`,
      )
      .join("\n"),
  )
  .join("\n")}
</tbody>
</table>`;
  const long = new Date(`${cov.reference_date}T12:00:00Z`).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
  );
  coverageJson = JSON.stringify(
    {
      about:
        "FactLot registry coverage by US county (5-digit Census FIPS). Counties not listed are grey (not usable yet). Generated from the registry's review records; see the methodology on https://factlot.com/coverage/.",
      reference_date: cov.reference_date,
      max_age_days: cov.max_age_days,
      classes: cov.classes,
      counts: { ...cov.counts, grey: total - entries.length, drawn: total },
      counties: Object.fromEntries(
        Object.entries(cov.counties).map(([f, c]) => [
          f,
          {
            name: c.name,
            state: c.state,
            class: c.class,
            commercial_parcels: c.commercial_parcels,
            data_as_of: c.data_as_of,
            source_id: c.source_id,
            owner_names: c.owner_names,
            hosted: c.hosted,
            ...(c.withheld ? { withheld: c.withheld } : {}),
          },
        ]),
      ),
      sources: cov.sources,
    },
    null,
    1,
  );
  addPage(
    {
      urlPath: "/coverage/",
      title: "County coverage map: commercial property data | FactLot",
      description: `Which US counties FactLot holds checked commercial property data for: ${n.hosted + n.audited_load + n.cited_load} counties with whole-county loads, as of ${long}. Everything else is grey.`,
      h1: "County coverage",
      crumbs: [["/coverage/", "County coverage"]],
      jsonld: [
        {
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: "FactLot registry coverage by US county",
          description:
            "Per-county status of FactLot's commercial property registry data, keyed by 5-digit FIPS.",
          url: `${SITE}/coverage/`,
          dateModified: cov.reference_date,
          license: "https://www.apache.org/licenses/LICENSE-2.0",
          isAccessibleForFree: true,
          distribution: [
            {
              "@type": "DataDownload",
              encodingFormat: "application/json",
              contentUrl: `${SITE}/coverage/counties.json`,
            },
          ],
        },
      ],
      body: fill(read("site/_content/coverage.html"), {
        COV_SVG: svg,
        COV_N_HOSTED: String(n.hosted),
        COV_N_AUDITED: String(n.audited_load),
        COV_N_CITED: String(n.cited_load),
        COV_N_GREY: fmtN(total - entries.length),
        COV_N_COLORED: String(entries.length),
        COV_ASOF: long,
        COV_MAX_AGE: String(cov.max_age_days),
        COV_TABLE: table,
        COV_REPO: REPO,
      }),
    },
    ["site/_content/coverage.html", covRel, geoRel],
  );
}

// --- Trust package: /status/, /security/, /sla/, /assurance/ ----------------------------------
// The first three are prose. The assurance page quotes sizes (vectors, workbooks, tools, the
// verified rule), and every one of them is counted here from the repository, so the page cannot
// say a number the repository does not back. Run-time figures (differential cases, test counts,
// the live suite) are dated on the page, because they come from running something.

{
  const trustCrumb = (slug, name) => [[`/${slug}/`, name]];
  const trustPage = (slug, title, description, h1, fragment, vars = {}) =>
    addPage(
      {
        urlPath: `/${slug}/`,
        title: `${title} | FactLot`,
        description,
        h1,
        crumbs: trustCrumb(slug, title),
        body: fill(read(`site/_content/${fragment}`), {
          VERSION,
          REPO,
          ...vars,
        }),
      },
      [`site/_content/${fragment}`],
    );

  trustPage(
    "status",
    "Service status",
    "How FactLot's hosted service is checked, the live health endpoint, the incident history and how to report a problem. No uptime percentage is shown because none is measured.",
    "Service status",
    "status.html",
  );
  trustPage(
    "security",
    "Security",
    "How FactLot's hosted service is run: where it runs, what it stores and does not store, how keys and secrets are handled, dependencies, disclosure, and what is not in place yet (no SOC 2).",
    "Security",
    "security.html",
  );
  trustPage(
    "sla",
    "Service levels",
    "What FactLot promises today (no service-level agreement), the draft service-level terms for paid plans, support targets, versioning and deprecation, and data refresh.",
    "Service levels",
    "sla.html",
  );

  // Conformance vectors: every JSON file under spec/vectors with a list of cases.
  const vectorsDir = path.join(root, "spec/vectors");
  let vectorFiles = 0;
  let vectorCases = 0;
  const calcVectorFiles = new Set();
  for (const rel of fs.readdirSync(vectorsDir, { recursive: true })) {
    if (!String(rel).endsWith(".json")) continue;
    const v = JSON.parse(fs.readFileSync(path.join(vectorsDir, rel), "utf8"));
    const cases = Array.isArray(v) ? v : v?.cases;
    if (!Array.isArray(cases)) continue; // lookup tables, not cases
    vectorFiles += 1;
    vectorCases += cases.length;
    if (String(rel).startsWith("calc/")) calcVectorFiles.add(String(rel));
  }
  for (const t of calcTools) {
    const f = `calc/${t.formula.id.replace(/^calc\./, "")}.json`;
    if (!calcVectorFiles.has(f))
      throw new Error(`assurance: ${t.name} has no vector file ${f}`);
  }

  // Excel reconciliation workbooks and the rows each one reconciles (from its README table).
  const reconDir = "examples/reconciliation";
  const workbooks = fs
    .readdirSync(path.join(root, reconDir))
    .filter((f) => f.endsWith(".xlsx"));
  const reconRows = [
    ...read(`${reconDir}/README.md`).matchAll(
      /^\| \[[^\]]+\.xlsx\]\([^)]*\)[^\n]*\| (\d+) +\|$/gm,
    ),
  ].map((m) => Number(m[1]));
  if (reconRows.length !== workbooks.length)
    throw new Error(
      `assurance: ${workbooks.length} workbooks but ${reconRows.length} rows in the reconciliation README`,
    );

  const draftPacks = fs
    .readdirSync(path.join(vectorsDir, "rules/drafts"))
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tables.json")).length;
  const revised = tools.filter((t) => t.formula && t.formula.version > 1);
  if (txRule?.verification?.status !== "verified")
    throw new Error("assurance: the Texas rule is not verified");

  trustPage(
    "assurance",
    "How the numbers are proven",
    "How FactLot's numbers are checked: shared test vectors, a TypeScript and Python differential test, Excel reconciliation workbooks, a live suite against the hosted API, and what is not proven.",
    "How the numbers are proven",
    "assurance.html",
    {
      VECTOR_FILES: String(vectorFiles),
      VECTOR_CASES: String(vectorCases),
      CALC_COUNT: String(calcTools.length),
      TOOL_COUNT: String(tools.length),
      WORKBOOKS: String(workbooks.length),
      WORKBOOK_ROWS: String(reconRows.reduce((a, b) => a + b, 0)),
      RULE_ID: esc(`${txRule.id}@${txRule.version}`),
      RULE_VERIFIED: esc(txRule.verification.verified_at),
      RULE_LAWS: txRule.citations.map((c) => esc(c.law)).join("; "),
      DRAFT_PACKS: String(draftPacks),
      REVISED_COUNT: String(revised.length),
      REVISED_LIST: revised
        .map(
          (t) => `<code>${esc(`${t.formula.id}@${t.formula.version}`)}</code>`,
        )
        .join(", "),
    },
  );
}

// --- write, sitemap, checks ----------------------------------------------------------------

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "site"), out, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(path.join(root, "site"), src);
    return (
      !rel.startsWith("_content") &&
      !rel.startsWith("_data") &&
      !rel.endsWith(".md")
    );
  },
});
for (const p of pages) {
  const file = path.join(out, p.urlPath, "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, p.html);
}
fs.writeFileSync(path.join(out, "coverage", "counties.json"), coverageJson);

const staticPages = [
  ["/", ["site/index.html"]],
  ["/privacy", ["site/privacy.html"]],
  ["/terms", ["site/terms.html"]],
  ["/llms.txt", ["site/llms.txt"]],
];
const entries = [...staticPages, ...pages.map((p) => [p.urlPath, p.sources])];
fs.writeFileSync(
  path.join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(([u, src]) => `  <url><loc>${SITE}${u}</loc><lastmod>${lastmod(src)}</lastmod></url>`).join("\n")}
</urlset>
`,
);

// Every internal link resolves, nothing loads from another origin, JSON-LD parses.
const problems = [];
const exists = (u) => {
  const p = decodeURIComponent(u.split(/[?#]/)[0]);
  const f = path.join(out, p);
  return (
    p === "/" ||
    fs.existsSync(path.join(f, "index.html")) ||
    (fs.existsSync(f) && fs.statSync(f).isFile()) ||
    fs.existsSync(`${f}.html`)
  );
};
for (const f of fs
  .readdirSync(out, { recursive: true })
  .filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(out, f), "utf8");
  for (const [, u] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (u.startsWith("/") && !u.startsWith("//") && !exists(u))
      problems.push(`${f}: broken link ${u}`);
  }
  for (const [tag] of html.matchAll(
    /<script\b[^>]*>|<link\b[^>]*rel="stylesheet"[^>]*>/g,
  )) {
    if (/(?:src|href)="(?:https?:)?\/\//.test(tag))
      problems.push(`${f}: external resource ${tag}`);
    // The only scripts besides JSON-LD are same-origin files under /try/.
    if (
      tag.startsWith("<script") &&
      !tag.includes("application/ld+json") &&
      !/^<script src="\/try\/[a-z-]+\.js" defer>$/.test(tag)
    )
      problems.push(`${f}: script that is not JSON-LD or a /try/ file`);
  }
  for (const [, j] of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    try {
      JSON.parse(j);
    } catch (e) {
      problems.push(`${f}: JSON-LD does not parse: ${e.message}`);
    }
  }
  if (/\{\{[A-Z_]+\}\}/.test(html)) problems.push(`${f}: unfilled placeholder`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `site: ${pages.length} generated pages, ${entries.length} sitemap entries -> ${path.relative(root, out) || out}`,
);
