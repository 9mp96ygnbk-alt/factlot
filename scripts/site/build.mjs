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
  ["/calculators/", "Calculators"],
  ["/mcp/", "MCP server"],
  ["/texas/property-tax-protest-deadline/", "Texas protest deadline"],
  [`${REPO}/blob/main/docs/getting-started.md`, "Docs"],
  ["/#pricing", "Pricing"],
];

function layout({
  urlPath,
  title,
  description,
  h1,
  body,
  crumbs,
  jsonld = [],
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
<p class="small">"FactLot" and the FactLot logo are trademarks of their owner. The open-source licences cover the code, not the name.</p>
</div>
</footer>
</body>
</html>
`;
}

const pages = []; // { urlPath, html, sources }
function addPage(page, sources) {
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

// --- /mcp/ ---------------------------------------------------------------------------------

addPage(
  {
    urlPath: "/mcp/",
    title: "Commercial real estate MCP server | FactLot",
    description:
      "FactLot's hosted MCP server gives AI agents CRE calculators with audit trails, lease document verification, property IDs and cited public-record facts. No API key.",
    h1: "Commercial real estate MCP server",
    crumbs: [["/mcp/", "MCP server"]],
    body: fill(read("site/_content/mcp.html"), { VERSION }),
  },
  ["site/_content/mcp.html"],
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
<li><strong>MCP:</strong> tool <code>${esc(m.tool)}</code> on <code>https://api.factlot.com/mcp</code> (<a href="/mcp/">connect a client</a>).</li>
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
<p>All of them run on the hosted <a href="/mcp/">MCP server</a> and REST API, and offline in the SDKs.</p>
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
  const long = (iso) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
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
    return `<tr><th scope="row">${years[i]}</th><td>${long(v.deadline)}</td><td>${long(v.recommended_file_by)}</td><td>${why}</td></tr>`;
  })
  .join("\n")}
</tbody>
</table>`;
  const sources = `<ul>\n${rule.citations.map((c) => `<li><a href="${esc(c.url)}">${esc(c.law)}</a></li>`).join("\n")}\n</ul>`;
  const next = rows[0].value;
  addPage(
    {
      urlPath: "/texas/property-tax-protest-deadline/",
      title: `Texas property tax protest deadline ${years[0]} | FactLot`,
      description: `The ${years[0]} Texas property tax protest deadline is ${long(next.deadline)} under Tax Code §41.44 and §1.06, unless a later notice moves it. Statute citations included.`,
      h1: `Texas property tax protest deadline (${years[0]})`,
      crumbs: [
        [
          "/texas/property-tax-protest-deadline/",
          "Texas property tax protest deadline",
        ],
      ],
      body: fill(read("site/_content/texas-protest-deadline.html"), {
        TX_RULE_ID: esc(`${rule.id}@${rule.version}`),
        TX_TABLE: table,
        TX_NEXT_YEAR: String(years[0]),
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

// --- write, sitemap, checks ----------------------------------------------------------------

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "site"), out, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(path.join(root, "site"), src);
    return !rel.startsWith("_content") && !rel.endsWith(".md");
  },
});
for (const p of pages) {
  const file = path.join(out, p.urlPath, "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, p.html);
}

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
    if (/src=|href="(?:https?:)?\/\//.test(tag))
      problems.push(`${f}: external resource ${tag}`);
    if (tag.startsWith("<script") && !tag.includes("application/ld+json"))
      problems.push(`${f}: script that is not JSON-LD`);
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
