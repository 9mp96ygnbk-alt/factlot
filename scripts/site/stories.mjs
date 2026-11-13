// Data stories: loads the story files that python -m factlot.registry.story wrote and verified
// (site/_data/stories/<slug>.json, each with a <slug>.stamp.json), and renders /data/ and
// /data/<slug>/. A story whose stamp is missing, failed, or holds a different SHA-256 than the
// story file is refused, so an edited or unverified figure cannot reach the page. The renderers are
// pure: they take the story and return the page body, and print only what the story holds.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { esc } from "./texas-pages.mjs";

const MIN_CELL = 10;
const int = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const longDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

/** A value in the unit its figure or column states; null is a cell the minimum cell size left empty. */
export function fmt(value, unit) {
  if (value === null || value === undefined) return "fewer than 10 parcels";
  if (unit === "usd")
    return Number.isInteger(value) ? usd.format(value) : usd2.format(value);
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "year") return String(value);
  if (unit === "count") return int.format(value);
  return String(value);
}

const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;

/** Numbers in sentences, the title or the description that are not a figure the sentence cites (signs ignored). */
export function strayNumbers(story) {
  const byId = new Map(story.figures.map((f) => [f.id, f]));
  const problems = [];
  const values = (ids) =>
    new Set(
      ids
        .map((i) => byId.get(i)?.value)
        .filter((v) => typeof v === "number")
        .map((v) => Math.abs(v)),
    );
  for (const s of story.sentences) {
    const allowed = values(s.figures);
    for (const tok of s.text.match(NUMBER) ?? [])
      if (!allowed.has(Number(tok.replaceAll(",", ""))))
        problems.push(
          `sentence ${s.id}: number ${tok} is not one of its figures`,
        );
  }
  const years = values(
    story.figures
      .filter((f) => f.id.startsWith("param.year."))
      .map((f) => f.id),
  );
  for (const field of ["title", "description"])
    for (const tok of String(story[field]).match(NUMBER) ?? [])
      if (!years.has(Number(tok.replaceAll(",", ""))))
        problems.push(`${field}: number ${tok} is not a roll year`);
  return problems;
}

/** Tables: no parcel count under the minimum outside a county total, and no owner names unless the story asked for them. */
export function tableProblems(story) {
  const countCols = {
    "t.group_year": [2],
    "t.group_change": [2, 3, 4, 5],
    "t.dim.neighborhood": [1],
    "t.dim.building_class": [1],
    "t.owners": [1],
  };
  const problems = [];
  for (const t of story.tables) {
    if (t.id === "t.owners" && !story.options.name_organisations)
      problems.push("table t.owners: owner names without name_organisations");
    for (const r of t.rows) {
      if (r[0] === ALL_LABEL) continue;
      for (const i of countCols[t.id] ?? [])
        if (typeof r[i] === "number" && r[i] < MIN_CELL)
          problems.push(`table ${t.id}: a cell built from ${r[i]} parcels`);
    }
  }
  return problems;
}

const ALL_LABEL = "All parcels in the commercial scope";

/**
 * The verified stories in a folder: [{ story, stamp, sha256 }], sorted by slug. A missing folder is no
 * stories. Throws, naming the file, on a story without a passing stamp for exactly its bytes.
 */
export function loadStories(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".stamp.json"))
    .sort();
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(dir, file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const stampFile = path.join(dir, file.replace(/\.json$/, ".stamp.json"));
    if (!fs.existsSync(stampFile))
      throw new Error(
        `story ${file} has no verification stamp: run python -m factlot.registry.story --verify`,
      );
    const stamp = JSON.parse(fs.readFileSync(stampFile, "utf8"));
    if (stamp.result !== "pass" || stamp.story_file !== file)
      throw new Error(`story ${file}: the stamp is not a pass for this file`);
    if (stamp.story_sha256 !== sha256)
      throw new Error(
        `story ${file} changed after it was verified (the stamp holds a different SHA-256): run the verifier again`,
      );
    const story = JSON.parse(bytes.toString("utf8"));
    if (story.story_format !== 1 || file !== `${story.slug}.json`)
      throw new Error(
        `story ${file}: unknown format or the slug does not match the file name`,
      );
    const problems = [...strayNumbers(story), ...tableProblems(story)];
    if (problems.length)
      throw new Error(`story ${file}: ${problems.join("; ")}`);
    out.push({ story, stamp, sha256 });
  }
  return out;
}

export const storyPath = (story) => `/data/${story.slug}/`;
export const storyTitle = (story) => `${story.title} | FactLot`;
export const indexTitle =
  "Data stories: figures computed from public roll files | FactLot";
export const indexDescription =
  "Short pages of figures computed from public appraisal roll files, each with its source file, as-of date and rule, and each re-checked by a second method before it is published.";

const sourceLine = (s) => {
  const pre = s.preliminary ? "preliminary roll, " : "";
  return `${esc(s.attribution)}: ${esc(s.title)}, ${pre}file <code>${esc(s.filename)}</code>, as of ${esc(longDate(s.as_of))}. Source id <code>${esc(s.source_id)}</code>.`;
};

const sentenceGroups = (story) => {
  const groups = [];
  const byPair = new Map();
  for (const s of story.sentences) {
    const m = /^s\.p(\d+)_(\d+)\./.exec(s.id);
    if (!m) {
      const g = groups.at(-1);
      if (g && g.pair === null) g.items.push(s);
      else groups.push({ pair: null, items: [s] });
    } else {
      const key = `${m[1]} to ${m[2]}`;
      if (!byPair.has(key)) {
        const g = { pair: key, items: [] };
        byPair.set(key, g);
        groups.push(g);
      }
      byPair.get(key).items.push(s);
    }
  }
  return groups;
};

function tableHtml(t) {
  const units = t.columns.map((c) => c.unit);
  const head = t.columns
    .map((c) => `<th scope="col">${esc(c.label)}</th>`)
    .join("");
  const rows = t.rows
    .map(
      (r) =>
        `<tr>${r
          .map((cell, i) =>
            i === 0
              ? `<th scope="row">${esc(cell)}</th>`
              : `<td>${esc(fmt(cell, units[i]))}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("\n");
  const src = t.sources
    .map((s) => `${esc(s.source_id)} (as of ${esc(s.as_of)})`)
    .join("; ");
  return `<h3 id="${esc(t.id.replaceAll(".", "-"))}">${esc(t.title)}</h3>
<p class="small">${esc(t.rule)}</p>
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="small">Sources: ${src}.</p>`;
}

function figuresTable(story) {
  const rows = story.figures
    .filter((f) => !f.id.startsWith("param."))
    .map(
      (f) =>
        `<tr><th scope="row">${esc(f.label)}</th><td>${esc(fmt(f.value, f.unit))}</td><td>${esc(f.rule)}</td><td>${f.sources
          .map((s) => `${esc(s.source_id)}, as of ${esc(s.as_of)}`)
          .join("<br />")}</td></tr>`,
    )
    .join("\n");
  return `<table>
<caption class="visually-hidden">Every figure on this page with its rule and source</caption>
<thead><tr><th scope="col">Figure</th><th scope="col">Value</th><th scope="col">Rule</th><th scope="col">Source and as-of date</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/**
 * The page body for one story. `texasSlug` is the county's slug in texas-counties.json when the county is
 * hosted (for the link to its page), else null.
 */
export function storyBody(story, stamp, texasSlug) {
  const publishers = [
    ...new Set(story.sources.filter((s) => s.tax_year).map((s) => s.publisher)),
  ];
  const vt = story.value_type;
  const prelim = story.period.years
    .filter((y) => y.preliminary)
    .map((y) => y.year);
  const findings = sentenceGroups(story)
    .map(
      (g) =>
        `${g.pair ? `<h3>${esc(g.pair)}</h3>\n` : ""}${g.items.map((s) => `<p>${esc(s.text)}</p>`).join("\n")}`,
    )
    .join("\n");
  const sources = story.sources
    .map((s) => `<li>${sourceLine(s)}</li>`)
    .join("\n");
  const rights = [
    ...new Set(
      story.sources.map((s) => `${esc(s.attribution)}: ${esc(s.license)}`),
    ),
  ]
    .map((l) => `<li>${l}</li>`)
    .join("\n");
  const lookup = [
    `<li><a href="/try/">Try it</a>: one property at a time, with its value history cited to the same files.</li>`,
    texasSlug
      ? `<li><a href="/texas/${esc(texasSlug)}/">${esc(story.county.name)}, Texas</a>: what is hosted for this county and the tools that answer these questions for one property.</li>`
      : "",
    `<li><a href="/coverage/">Coverage</a>: which counties and files are loaded.</li>`,
  ]
    .filter(Boolean)
    .join("\n");
  return `<p class="lede">${esc(story.description)}</p>
<p class="small">Every figure here was computed by code from one registry file and then recomputed by a second method; the page is built only when the two agree (checked ${esc(longDate(stamp.verified_on))}, ${esc(String(stamp.figures_checked))} figures and ${esc(String(stamp.tables_checked))} tables). The sentences are built by code from the figures, so each number in them is a figure listed below.</p>
${prelim.length ? `<p>Roll year${prelim.length > 1 ? "s" : ""} ${esc(prelim.join(", "))} ${prelim.length > 1 ? "are" : "is"} a preliminary roll.</p>` : ""}

<h2 id="findings">What the files show</h2>
${findings}

<h2 id="tables">Tables</h2>
${story.tables.map(tableHtml).join("\n")}

<h2 id="sources">Sources</h2>
<ul>
${sources}
</ul>
<p class="small">Terms as the registry records them:</p>
<ul>
${rights}
</ul>

<h2 id="rules">How each figure is computed</h2>
<p>Values are the ${esc(vt)} values stated in each file. A parcel is counted in a year only if it is in the current file and has a positive stated value in that year's file; parcels that left the roll before the current file are in no year's figures. Property group, neighborhood code, building class and owner of record are read from the current file. A district can revise a roll year's file after certification, so a file read later can differ from the roll as first certified; each file is cited with its as-of date. A link between an owner of record and a registered organisation is an inference by exact normalized name, not a statement in the roll.</p>
${figuresTable(story)}

<h2 id="limits">What this is and is not</h2>
<p>
  The figures are the stated values of ${esc(publishers.join(" and "))} as published in the files named above. They are not an appraisal or an opinion of value, and not legal, tax or other advice. They do not say what any property is worth, whether a value is right, or whether to protest it. The registry's build and the generator that made this page are listed in the story file, version ${esc(story.generator.version)}.
</p>

<h2 id="lookup">One property at a time</h2>
<p>The hosted tools answer the same questions for a single property, with the same citations.</p>
<ul>
${lookup}
</ul>

<h2 id="more">More</h2>
<ul>
  <li><a href="/data/">All data stories</a></li>
  <li><a href="/pricing/">Pricing and registry lookups</a></li>
</ul>`;
}

export function indexBody(stories) {
  const items = stories
    .map(
      ({ story, stamp }) =>
        `<li><a href="${storyPath(story)}">${esc(story.title)}</a><br /><span class="small">${esc(story.description)} Verified ${esc(longDate(stamp.verified_on))}.</span></li>`,
    )
    .join("\n");
  return `<p class="lede">Short pages of figures computed from public appraisal roll files. Each figure lists its source file, the file's as-of date and the rule used, and is recomputed by a second method before the page is built.</p>
<ul>
${items}
</ul>
<p class="small">The figures are the stated values published in the named files. They are not an appraisal, not an opinion of value and not advice. See <a href="/coverage/">coverage</a> for what is loaded.</p>`;
}
