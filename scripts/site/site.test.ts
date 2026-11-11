// The landing page and llms.txt state tool counts and a release version by hand. These tests
// fail when either drifts from the tool catalog or the packages, so a new tool or a release
// cannot leave the site saying something untrue.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { QUOTA_RULES } from "../../deploy/cloudflare/src/plans.ts";
import {
  countyBody,
  exampleBody,
  OTHER_DISTRICTS,
  otherDistrictsTable,
  hubHostedTable,
  hubRollSentence,
  hubCountyLinks,
} from "./texas-pages.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const catalog = JSON.parse(read("spec/schemas/tools.json")) as
  { name: string }[] | { tools: { name: string }[] };
const tools = Array.isArray(catalog) ? catalog : catalog.tools;
const calculators = tools.filter((t) => t.name.startsWith("calc_")).length;
const version = (
  JSON.parse(read("packages/mcp/package.json")) as { version: string }
).version;

for (const file of ["site/index.html", "llms.txt", "site/llms.txt"]) {
  describe(file, () => {
    const text = read(file).replace(/\s+/g, " ");
    it(`states ${calculators} calculators wherever it counts them`, () => {
      const counts = [
        ...text.matchAll(/(\d+) (?:deterministic )?calculators/g),
      ].map((m) => Number(m[1]));
      assert.ok(counts.length > 0, "no calculator count found");
      assert.deepEqual([...new Set(counts)], [calculators]);
    });
    it(`links release v${version} only`, () => {
      const versions = new Set(
        [...text.matchAll(/releases\/download\/v(\d+\.\d+\.\d+)\//g)].map(
          (m) => m[1],
        ),
      );
      assert.deepEqual([...versions], versions.size ? [version] : []);
    });
  });
}

describe("llms-install.md", () => {
  it(`links release v${version} only`, () => {
    const versions = new Set(
      [
        ...read("llms-install.md").matchAll(
          /releases\/download\/v(\d+\.\d+\.\d+)\//g,
        ),
      ].map((m) => m[1]),
    );
    assert.deepEqual([...versions], [version]);
  });
});

describe("site/llms.txt", () => {
  it("is a copy of llms.txt", () => {
    assert.equal(read("site/llms.txt"), read("llms.txt"));
  });
});

const flat = (rel: string) => read(rel).replace(/\s+/g, " ");

describe("pricing page", () => {
  const html = flat("site/_content/pricing.html");
  const plans = read("deploy/cloudflare/src/plans.ts");
  const block = (id: string) =>
    new RegExp(`${id}: \\{[\\s\\S]*?\\n  \\},`).exec(plans)?.[0] ?? "";
  const num = (re: RegExp, from = plans): number =>
    Number(re.exec(from)?.[1]?.replaceAll("_", ""));
  const n = (v: number) => v.toLocaleString("en-US");
  it("states the numbers plans.ts enforces", () => {
    for (const id of ["pro", "team"]) {
      const b = block(id);
      assert.ok(b, `${id} block found in plans.ts`);
      const price = num(/monthlyCents: (\d+)/, b) / 100;
      assert.ok(html.includes(`$${n(price)} a month`), `${id} price`);
      assert.ok(
        html.includes(`${n(num(/requestsPerMinute: ([\d_]+)/, b))} per key`),
        `${id} requests a minute`,
      );
      assert.ok(
        html.includes(
          `${n(num(/registryLookupsPerMonth: ([\d_]+)/, b))} a month`,
        ),
        `${id} lookups`,
      );
    }
    assert.ok(
      html.includes(
        `${num(/ANONYMOUS_REQUESTS_PER_MINUTE = (\d+)/)} per IP address`,
      ),
    );
    assert.ok(
      html.includes(
        `${num(/ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY = (\d+)/)} a day per IP address`,
      ),
    );
    const reports = /REPORTS_PER_MONTH[\s\S]*?\};/.exec(plans)?.[0] ?? "";
    for (const k of ["anonymous", "pro", "team"])
      assert.ok(
        html.includes(
          `${n(num(new RegExp(`${k}: ([\\d_]+)`), reports))} a month`,
        ),
        `reports ${k}`,
      );
    assert.deepEqual(
      [...plans.matchAll(/maxKeys: (\d+)/g)].map((m) => m[1]),
      ["1", "5"],
    );
    assert.match(html, /<td>1<\/td> <td>5<\/td>/);
  });
  it("carries the lookup rules, the renewal sentence and the checkout links", () => {
    const text = html.replace(/<[^>]+>/g, "").replace(/ +/g, " ");
    for (const rule of Object.values(QUOTA_RULES))
      assert.ok(text.includes(rule), rule);
    assert.ok(
      html.includes("renews monthly until cancelled. Cancel any time."),
    );
    assert.ok(html.includes("api.factlot.com/billing/checkout?plan=pro"));
    assert.ok(html.includes("api.factlot.com/billing/checkout?plan=team"));
  });
});

describe("texas hub", () => {
  const html = flat("site/_content/texas.html");
  const deadline = flat("site/_content/texas-protest-deadline.html");
  it("lists the sixteen hosted counties summing to 305,684", () => {
    const data = JSON.parse(read("site/_data/texas-counties.json")) as {
      total_hosted_parcels: number;
      counties: { name: string; hosted_parcels: number; rolls: unknown[] }[];
    };
    const table = hubHostedTable(data.counties).replace(/\s+/g, " ");
    const rows = [
      ...table.matchAll(/<th scope="row">(\w+)<\/th> <td>([\d,]+)<\/td>/g),
    ].filter((m) => m[1] !== "Total");
    assert.equal(rows.length, 16);
    assert.equal(
      rows.reduce((a, m) => a + Number((m[2] ?? "").replaceAll(",", "")), 0),
      305684,
    );
    assert.equal(data.total_hosted_parcels, 305684);
    assert.ok(table.includes("<td>305,684</td>"));
    assert.ok(html.includes("{{HOSTED_TABLE}}"));
    // Midland has no values; the multi-year counties say so.
    assert.ok(table.includes("no values in the publisher's file"));
    assert.ok(table.includes("eleven roll years, 2016 to 2026"));
    assert.ok(!html.includes("one roll year per county"));
    assert.ok(
      hubRollSentence(data.counties).startsWith("Six of the sixteen counties"),
    );
  });
  it("keeps the legal disclaimers word for word", () => {
    for (const sentence of [
      "FactLot is software. It is not a property tax consultant under Texas Occupations Code chapter 1152",
      "not an appraisal or an opinion of value (Occupations Code §1103.003(1)), not legal or tax advice, and not a substitute for the advice of an attorney.",
    ])
      assert.ok(html.includes(sentence) && deadline.includes(sentence));
  });
  it("names the tools and the connection URLs", () => {
    for (const t of [
      "registry_get",
      "registry_tx_equity_candidates",
      "calc_tx_unequal_appraisal",
      "rules_tx_property_tax_protest_deadline",
      "tx_protest_deadline",
      "https://api.factlot.com/mcp",
      "https://api.factlot.com/mcp/signin",
      "/texas/property-tax-protest-deadline/",
    ])
      assert.ok(html.includes(t), t);
  });
});

describe("trust pages", () => {
  it("cite the same live-suite run", () => {
    for (const f of ["status", "assurance"]) {
      const t = flat(`site/_content/${f}.html`);
      assert.ok(t.includes("4,635 checks"), f);
      assert.ok(t.includes("8 November 2026"), f);
      assert.ok(!t.includes("4,447"), f);
    }
  });
});

interface County {
  slug: string;
  name: string;
  publisher: string;
  license: string;
  terms_url: string;
  source_url: string;
  hosted_parcels: number;
  neighborhood_tier: boolean;
  rolls: { tax_year: number; as_of: string; parcels: number }[];
}
interface Example {
  county: string;
  parcel_facts: { predicate: string }[];
  candidates: unknown[];
  calc_args: { comparables: { adjustments?: unknown }[] };
}
const counties = (
  JSON.parse(read("site/_data/texas-counties.json")) as {
    total_hosted_parcels: number;
    counties: County[];
  }
).counties;
const examples = (
  JSON.parse(read("site/_data/texas-examples.json")) as { examples: Example[] }
).examples;
const SENTENCES = [
  "FactLot is software. It is not a property tax consultant under Texas Occupations Code chapter 1152",
  "not an appraisal or an opinion of value (Occupations Code §1103.003(1)), not legal or tax advice, and not a substitute for the advice of an attorney.",
];
const group = (n: number) => n.toLocaleString("en-US");

describe("texas county pages", () => {
  const hub = flat("site/_content/texas.html");
  const tpl = read("site/_content/texas-county.html");
  const flatten = (h: string) => h.replace(/\s+/g, " ");
  it("cover the sixteen hosted counties and match the hub", () => {
    assert.deepEqual(
      counties.map((c) => c.slug),
      [
        "harris",
        "dallas",
        "travis",
        "collin",
        "denton",
        "williamson",
        "cameron",
        "nueces",
        "galveston",
        "jefferson",
        "brazos",
        "midland",
        "ector",
        "grayson",
        "guadalupe",
        "kaufman",
      ],
    );
    const hubTable = hubHostedTable(counties).replace(/\s+/g, " ");
    const hubLinks = hubCountyLinks(counties, ["harris", "dallas"]);
    for (const c of counties) {
      assert.ok(
        hubTable.includes(
          `<th scope="row">${c.name}</th> <td>${group(c.hosted_parcels)}</td>`,
        ),
        `hub row ${c.name}`,
      );
      assert.ok(hubLinks.includes(`/texas/${c.slug}/`), `hub links ${c.slug}`);
    }
  });
  it("state exactly the numbers in texas-counties.json", () => {
    for (const c of counties) {
      const body = flatten(countyBody(c, tpl, true));
      assert.ok(body.includes(group(c.hosted_parcels)), c.slug);
      for (const r of c.rolls) {
        assert.ok(body.includes(`<th scope="row">${r.tax_year}`), c.slug);
        assert.ok(body.includes(group(r.parcels)), c.slug);
      }
      assert.equal(
        body.includes("Values are not in the publisher's file"),
        c.rolls.length === 0,
        c.slug,
      );
      assert.ok(body.includes(c.publisher.replaceAll("&", "&amp;")), c.slug);
      assert.ok(
        body.includes(`href="${c.terms_url.replaceAll("&", "&amp;")}"`),
        c.slug,
      );
      assert.equal(
        body.includes("Neighborhood code: not available"),
        !c.neighborhood_tier && c.rolls.length > 0,
        c.slug,
      );
    }
    assert.deepEqual(
      counties.filter((c) => c.neighborhood_tier).map((c) => c.slug),
      ["harris", "dallas", "travis"],
    );
  });
  it("lists Tarrant withheld and no hosted district as not yet hosted", () => {
    const t = flatten(otherDistrictsTable());
    assert.ok(t.includes("Tarrant"));
    assert.ok(t.includes("Withheld"));
    assert.equal(OTHER_DISTRICTS.length, 0);
    for (const c of counties) assert.ok(!t.includes(`>${c.name}</th>`), c.name);
    assert.ok(!t.includes("not yet hosted"));
    assert.ok(hub.includes("{{OTHER_DISTRICTS}}"));
  });
  it("carry the disclaimers word for word", () => {
    for (const c of counties) {
      const body = flatten(countyBody(c, tpl, true));
      for (const sentence of SENTENCES)
        assert.ok(body.includes(sentence), c.slug);
    }
  });
  it(
    "are built into the site",
    { skip: !existsSync(new URL("packages/tools/dist/index.js", root)) },
    () => {
      const out = mkdtempSync(`${tmpdir()}/factlot-site-`);
      execFileSync("node", ["scripts/site/build.mjs", out], {
        cwd: root,
        stdio: "pipe",
      });
      for (const c of counties) {
        const page = readFileSync(`${out}/texas/${c.slug}/index.html`, "utf8");
        assert.ok(page.includes(group(c.hosted_parcels)), c.slug);
        for (const sentence of SENTENCES)
          assert.ok(flatten(page).includes(sentence), c.slug);
      }
      for (const e of examples) {
        const page = readFileSync(
          `${out}/texas/${e.county}/example/index.html`,
          "utf8",
        );
        for (const sentence of SENTENCES)
          assert.ok(flatten(page).includes(sentence), e.county);
        assert.ok(!/ownership\./.test(page), e.county);
      }
    },
  );
});

describe("texas worked examples", () => {
  const tpl = read("site/_content/texas-example.html");
  const raw = read("site/_data/texas-examples.json");
  it("are one Harris and one Dallas parcel", () => {
    assert.deepEqual(
      examples.map((e) => e.county),
      ["harris", "dallas"],
    );
  });
  it("hold parcel facts only, with no ownership key and no owner name", () => {
    const names =
      /\b(?:LLC|L\.L\.C|LP|L\.P|INC|LTD|CORP|CORPORATION|TRUST|HOLDINGS|PARTNERS|PARTNERSHIP|ESTATE|FOUNDATION)\b/;
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          assert.ok(!/owner|mailing/i.test(k), `${path}.${k}`);
          walk(x, `${path}.${k}`);
        }
      else if (typeof v === "string") {
        assert.ok(!/ownership\./.test(v), `${path} names an ownership fact`);
        if (!/notice|disclaimer/.test(path))
          assert.ok(!names.test(v), `${path} looks like an owner name: ${v}`);
      }
    };
    assert.ok(
      !/median_adjusted_value|subject_minus_median|calc_result/.test(raw),
    );
    walk(JSON.parse(raw), "examples");
    for (const e of examples)
      for (const f of e.parcel_facts)
        assert.ok(f.predicate.startsWith("parcel."), f.predicate);
  });
  it("hold the calculator input for ten candidates with no adjustments and no result", () => {
    for (const e of examples) {
      assert.equal(e.candidates.length, 10);
      assert.equal(e.calc_args.comparables.length, 10);
      for (const c of e.calc_args.comparables)
        assert.equal(c.adjustments, undefined);
    }
  });
  it("render the disclaimers verbatim and no computed result", () => {
    const counts = new Map(counties.map((c) => [c.slug, c]));
    for (const e of examples) {
      const body = exampleBody(counts.get(e.county), e, tpl).replace(
        /\s+/g,
        " ",
      );
      for (const sentence of SENTENCES)
        assert.ok(body.includes(sentence), e.county);
      assert.ok(
        body.includes("after the user reviews, removes or adds comparables"),
      );
      assert.ok(body.includes("does not show a result for a real property"));
      assert.ok(body.includes("spec/vectors/calc/tx_unequal_appraisal.json"));
      assert.ok(
        !/median_adjusted_value|subject_minus_median|normalize_by|calc_result/.test(
          body,
        ),
        e.county,
      );
      assert.ok(!/ownership\.|owner_of_record/.test(body), e.county);
    }
  });
});

describe("pricing page alternatives", () => {
  const html = flat("site/_content/pricing.html");
  it("compares the free sources, the district packet and TaxNetUSA with a cited price", () => {
    assert.ok(html.includes("What you would otherwise use"));
    assert.ok(html.includes("https://www.taxnetusa.com/pricing/pro.php"));
    assert.ok(html.includes("$12.49 per month per county, billed annually"));
    assert.ok(html.includes("Tax Code §41.461"));
  });
});
