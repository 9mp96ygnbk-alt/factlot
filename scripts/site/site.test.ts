// The landing page and llms.txt state tool counts and a release version by hand. These tests
// fail when either drifts from the tool catalog or the packages, so a new tool or a release
// cannot leave the site saying something untrue.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  QUOTA_RULES,
} from "../../deploy/cloudflare/src/plans.ts";
import {
  countyBody,
  exampleBody,
  OTHER_DISTRICTS,
  otherDistrictsTable,
  hubHostedTable,
  tryTexasLinks,
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

describe("operator's postal address", () => {
  const ADDRESS = "Postal address: PO Box 12488, San Antonio, TX 78212.";
  it("is on the privacy notice once and on the terms in both places", () => {
    const privacy = flat("site/privacy.html");
    const terms = flat("site/terms.html");
    assert.equal(privacy.split(ADDRESS).length - 1, 1);
    assert.equal(terms.split(ADDRESS).length - 1, 2);
    for (const page of [privacy, terms])
      assert.ok(!/Postal address: pending/i.test(page));
  });
  it("states a PO box and no street address or phone number", () => {
    for (const f of ["site/privacy.html", "site/terms.html"])
      assert.ok(
        !/\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/.test(read(f)),
        f,
      );
  });
});

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
  it("has both Pro checkout links and states the two gated things and what stays free", () => {
    const hrefs = [
      ...html.matchAll(/href="([^"]*billing\/checkout[^"]*)"/g),
    ].map((m) => m[1]);
    assert.deepEqual(hrefs, [
      "https://api.factlot.com/billing/checkout?plan=pro",
      "https://api.factlot.com/billing/checkout?plan=pro&amp;interval=year",
      "https://api.factlot.com/billing/checkout?plan=team",
    ]);
    const pro = read("deploy/cloudflare/src/plans.ts");
    assert.match(pro, /cents: 49000/);
    assert.match(pro, /monthlyCents: 4900/);
    assert.ok(html.includes("$49 a month, or $490 a year"));
    assert.ok(html.includes("two months free"));
    assert.ok(html.includes("Every tax year and every snapshot"));
    assert.ok(html.includes("The current roll year only"));
    assert.ok(html.includes("registry_tx_equity_candidates_batch"));
    assert.ok(html.includes('id="stays-free"'));
    assert.ok(html.includes("What you would otherwise use"));
    assert.ok(
      html.includes("a partial month, or a partial year on yearly billing"),
    );
    assert.ok(!html.includes("carries its market"));
    assert.ok(!/limited time|testimonial|hurry|last chance/i.test(html));
  });
  it("matches the gating the Worker applies", () => {
    const gating = read("deploy/cloudflare/src/gating.ts");
    assert.match(gating, /endsWith\("_batch"\)/);
    assert.match(gating, /startsWith\("registry_"\)/);
    assert.match(gating, /HISTORY_TOOL = "registry_get"/);
  });
});

describe("home page", () => {
  const html = read("site/index.html");
  it("opens with the three promises, each linking to its page, above the developer material", () => {
    const promises = html.indexOf('id="promise-title"');
    const developer = html.indexOf('id="hero-title"');
    assert.ok(promises > 0 && developer > promises);
    const top = html.slice(promises, developer);
    for (const href of ["/texas/", "/mcp-server/", "/try/"])
      assert.ok(top.includes(`href="${href}"`), href);
    assert.ok(/unequal-appraisal\s+arithmetic/.test(top));
    assert.ok(/Free, no key/.test(top));
    assert.ok(/Every answer\s+cites the public record/.test(top));
    assert.equal(html.split("<h1").length - 1, 1);
    // The developer material stays.
    for (const id of ["layers", "how", "connect", "agents", "pricing"])
      assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(html.includes("26 calculators"));
  });
  it("makes no claim of being the only, widest or first", () => {
    for (const bad of [
      /\bthe only\b/i,
      /\bwidest\b/i,
      /\bno other\b/i,
      /\bthe best\b/i,
      /can't get wrong/i,
      /\bThe open fact layer\b/,
    ])
      assert.ok(!bad.test(html), String(bad));
    for (const f of ["README.md", "llms.txt"])
      assert.ok(!/\bThe open fact layer\b|Fastest path/.test(read(f)), f);
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
    // Harris, Dallas and Travis: 2022 to 2025 loaded as value history beside the current roll.
    assert.equal(table.split("five roll years, 2022 to 2026").length - 1, 3);
    assert.ok(!html.includes("one roll year per county"));
    assert.ok(
      hubRollSentence(data.counties).startsWith("Nine of the sixteen counties"),
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

describe("free key links", () => {
  const js = read("site/try/freekey.js");
  const pages = {
    pricing: read("site/_content/pricing.html"),
    try: read("site/_content/try.html"),
    mcp: read("site/_content/mcp.html"),
  };
  it("are hidden in the page source, and only the script shows them", () => {
    for (const [name, html] of Object.entries(pages)) {
      const tags = [...html.matchAll(/<[a-z]+\b[^>]*data-free-key[^>]*>/g)];
      assert.ok(tags.length > 0, `${name} has a free key link`);
      for (const t of tags) assert.match(t[0], /\bhidden\b/, name);
      assert.ok(
        html.includes('href="https://factlot.com/account#free-key"'),
        name,
      );
      assert.ok(!/<form\b/.test(html.match(/data-free-key[\s\S]{0,600}/)![0]));
    }
  });
  it("reads only /v1/plans, with no key, storage, HTML injection or absolute URL", () => {
    assert.deepEqual(
      [...js.matchAll(/"(\/v1\/[^"]*)"/g)].map((m) => m[1]),
      ["/v1/plans"],
    );
    assert.match(js, /plans\.free\.free_key|free\.free_key/);
    assert.match(js, /credentials: "omit"/);
    assert.ok(!/https?:\/\//.test(js));
    for (const bad of [
      "authorization",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "innerHTML",
      "eval(",
      "body:",
    ])
      assert.ok(!js.includes(bad), bad);
  });
});

describe("/try/ page", () => {
  const FORBIDDEN = [
    "median_adjusted_value",
    "subject_minus_median",
    "over_assess",
    "equity_candidates",
    "calc_tx_unequal_appraisal",
  ];
  const html = read("site/_content/try.html");
  const js = read("site/try/try.js");

  it("calls only same-origin routes (two registry routes and reports), with no key, storage or HTML injection", () => {
    const paths = [...js.matchAll(/"(\/v1\/[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(paths.sort(), [
      "/v1/registry/get",
      "/v1/registry/search_address",
      "/v1/reports",
    ]);
    assert.ok(!/https?:\/\//.test(js), "no absolute URL in the script");
    for (const bad of [
      "authorization",
      "api_key",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "eval(",
    ])
      assert.ok(!js.toLowerCase().includes(bad.toLowerCase()), bad);
    assert.match(js, /credentials: "omit"/);
  });
  it("shows the API's history note as text with a link to /pricing/, only when present", () => {
    assert.match(js, /typeof record\.history_note === "string"/);
    assert.match(js, /class: "note try-history"/);
    assert.match(
      js,
      /class: "button primary",\s+href: "\/pricing\/",\s+text: "Plans and limits"/,
    );
    // The note is the same sentence the Worker writes, minus the trailing address.
    const note =
      "4 earlier roll years, 2022 to 2025, are available with a Pro or Team key: https://factlot.com/pricing/";
    assert.equal(
      note.replace(/:\s*https?:\/\/\S+\s*$/, "."),
      "4 earlier roll years, 2022 to 2025, are available with a Pro or Team key.",
    );
  });
  it("says what the Texas tools do for a Texas record and links its worked example or the hub", () => {
    assert.match(js, /\^fl:parcel:us-\(48\\d\{3\}\):/);
    assert.match(js, /class: "note try-texas"/);
    assert.ok(js.includes("#try-texas-links li[data-fips]"));
    const data = JSON.parse(read("site/_data/texas-counties.json")) as {
      counties: { slug: string; county_fips: string; rolls: unknown[] }[];
    };
    const links = tryTexasLinks(data.counties, ["harris", "dallas"]);
    assert.ok(html.includes("{{TEXAS_LINKS}}"));
    assert.ok(
      links.includes(
        '<li data-fips="48201"><a href="/texas/harris/example/">Harris County worked example</a></li>',
      ),
    );
    assert.ok(links.includes('data-fips="48113"'));
    // A county without an example points at the hub; one with no values has no entry.
    assert.ok(
      links.includes(
        '<li data-fips="48453"><a href="/texas/">Texas tools</a></li>',
      ),
    );
    const noValues = data.counties.filter((c) => c.rolls.length === 0);
    assert.ok(noValues.length > 0);
    for (const c of noValues)
      assert.ok(!links.includes(`data-fips="48${c.county_fips}"`), c.slug);
    assert.ok(links.startsWith('<ul id="try-texas-links" hidden>'));
  });
  it("prints a year without a thousands separator", () => {
    assert.match(
      js,
      /YEAR_PREDICATES = \["parcel\.year_built", "parcel\.tax_year"\]/,
    );
    assert.match(
      js,
      /YEAR_PREDICATES\.indexOf\(f\.predicate\) !== -1\) return String\(v\);/,
    );
  });
  it("shows no calculator result for a real property", () => {
    for (const f of FORBIDDEN) {
      assert.ok(!html.includes(f), `try.html has ${f}`);
      assert.ok(!js.includes(f), `try.js has ${f}`);
    }
  });
  it("names the free quota, the pricing link and the coverage link", () => {
    assert.match(html, /25 registry lookups a day per IP address/);
    assert.equal(ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY, 25);
    assert.ok(js.includes('"/pricing/"') && js.includes('"/coverage/"'));
    assert.ok(html.includes('href="/mcp-server/"'));
  });
  it("carries the disclaimers word for word", () => {
    const flat = html.replace(/\s+/g, " ");
    for (const sentence of SENTENCES) assert.ok(flat.includes(sentence));
  });
  it("is linked from the home page and listed in llms.txt", () => {
    assert.ok(read("site/index.html").includes('href="/try/"'));
    assert.ok(read("llms.txt").includes("https://factlot.com/try/"));
  });
  it(
    "is built into the site with no external resource",
    { skip: !existsSync(new URL("packages/tools/dist/index.js", root)) },
    () => {
      const out = mkdtempSync(`${tmpdir()}/factlot-site-`);
      execFileSync("node", ["scripts/site/build.mjs", out], {
        cwd: root,
        stdio: "pipe",
      });
      const page = readFileSync(`${out}/try/index.html`, "utf8");
      const script = readFileSync(`${out}/try/try.js`, "utf8");
      assert.equal(script, js);
      const scripts = [...page.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      assert.ok(scripts.includes('<script src="/try/try.js" defer>'));
      for (const tag of scripts)
        assert.ok(
          tag === '<script src="/try/try.js" defer>' ||
            tag === '<script src="/try/freekey.js" defer>' ||
            tag === '<script type="application/ld+json">',
          tag,
        );
      const loaded = [
        ...page.matchAll(
          /<(?:script|link|img|iframe|source|video|audio|object|embed)\b[^>]*>/g,
        ),
      ]
        .map((m) => m[0])
        .filter((tag) => !tag.includes('rel="canonical"'));
      for (const tag of loaded)
        assert.ok(!/(?:src|href|srcset)="(?:https?:)?\/\//.test(tag), tag);
      assert.ok(!/@import|url\(\s*["']?https?:/.test(page));
      for (const f of FORBIDDEN) assert.ok(!page.includes(f), f);
      assert.ok(
        page.includes('<a href="/try/" aria-current="page">Try it</a>'),
      );
      const sitemap = readFileSync(`${out}/sitemap.xml`, "utf8");
      assert.ok(sitemap.includes("<loc>https://factlot.com/try/</loc>"));
    },
  );
});

describe("hosted registry figures (site/_data/hosted.json)", async () => {
  const hosted = await import("./hosted.mjs");
  const { hostedData, hostedText } = await import("./gen-hosted.ts");
  const data = JSON.parse(read("site/_data/hosted.json")) as ReturnType<
    typeof hostedData
  >;
  it("every page, document and llms.txt states what hosted.json says", () => {
    for (const file of hosted.HOSTED_FILES) {
      const text = read(file);
      const r = hosted.renderHosted(
        text,
        data,
        ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
      );
      assert.ok(r.found > 0, `${file}: no hosted text marked`);
      assert.deepEqual(
        hosted.hostedDifferences(
          text,
          data,
          ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
        ),
        [],
        `${file} is out of date: run scripts/site/gen-hosted.ts --text`,
      );
    }
  });
  it("the account page's hosted note is generated from hosted.json", async () => {
    const { noteSource } = await import("./gen-hosted.ts");
    assert.equal(
      read("deploy/cloudflare/src/hosted_note.ts").replace(/\s+/g, " "),
      noteSource(data).replace(/\s+/g, " "),
      "run scripts/site/gen-hosted.ts --text",
    );
  });
  it("adds up: places partition the counties, and the totals are their sums", () => {
    const fips = data.places.flatMap((p) => p.counties).sort();
    assert.deepEqual(fips, data.counties.map((c) => c.fips).sort());
    assert.equal(
      data.places.reduce((a, p) => a + p.parcels, 0),
      data.totals.parcels,
    );
    assert.equal(
      data.counties.reduce((a, c) => a + c.parcels, 0),
      data.totals.parcels,
    );
    assert.equal(data.counties.length, data.totals.counties);
    assert.deepEqual(data.text, hostedText(data));
    assert.ok(
      !data.counties.some((c) => data.withheld.some((w) => w.fips === c.fips)),
    );
  });
  it("words new regions by place, and a county loaded in part by its part", async () => {
    // A manifest with the regions FactLot builds next (invented counts).
    const county = (
      fips: string,
      st: string,
      parcels: number,
      source: string,
    ) => ({
      region: `us-${fips}`,
      state_fips: fips.slice(0, 2),
      county_fips: fips.slice(2),
      state: st,
      parcels,
      buildings: 0,
      sources: [{ source_id: source, as_of: "2026-10-01" }],
    });
    const counties = [
      county("06037", "CA", 100, "ca-los-angeles-assessor"),
      county("06075", "CA", 10, "ca-san-francisco-assessor"),
      county("08031", "CO", 20, "co-denver-assessor"),
      ...["001", "003", "005", "007", "009", "011", "013", "015"].map((c) =>
        county(`09${c}`, "CT", 5, "ct-parcel-cama-layer"),
      ),
      county("24005", "MD", 7, "md-sdat-real-property"),
      county("25025", "MA", 30, "ma-boston-assessing"),
      ...["36005", "36047", "36061", "36081", "36085"].map((f) =>
        county(f, "NY", 40, "ny-nyc-dof"),
      ),
      county("48201", "TX", 9, "tx-harris-cad"),
      county("51059", "VA", 3, "va-fairfax"),
    ];
    const parcels = counties.reduce((a, c) => a + c.parcels, 0);
    const m = {
      built_at: "2026-12-01T00:00:00Z",
      coverage: {
        counties,
        entity_registries: [
          { jurisdiction: "us-ny", entities: 1234, sources: [] },
          { jurisdiction: "us-co", entities: 56, sources: [] },
        ],
        crosswalk_systems: [],
        totals: {
          parcels,
          entities: 1290,
          buildings: 0,
          counties: counties.length,
          states: ["CA", "CO", "CT", "MA", "MD", "NY", "TX", "VA"],
        },
      },
      entity_scope: { "us-ny": { served: 1234, total: 3631216 } },
      withheld: { "48439": "terms" },
      partial_counties: {
        "25025": { area: "the City of Boston", rest: "the rest" },
      },
    } as unknown as Parameters<typeof hostedData>[0];
    const d = hostedData(m, ["Harris"]);
    assert.equal(
      hosted.placesText(d),
      "Maryland (1 of its 24 jurisdictions), one Texas county (Harris), New York City (all five boroughs), Los Angeles County, San Francisco, the City of Boston, Denver, Connecticut (statewide, by town), and Fairfax County, VA",
    );
    const line = hosted.llmsHostedLine(d, 25);
    assert.match(
      line,
      /New York City \(all five boroughs; 200 commercial parcels/,
    );
    assert.match(
      line,
      /the 1,234 New York Department of State entities that own a hosted parcel/,
    );
    assert.match(
      line,
      /the City of Boston \(the City of Boston only, not Chelsea, Revere or Winthrop, the rest of Suffolk County; 30 commercial parcels from the Assessing Department's fiscal-year 2026 file, with values as of 2026-10-01, older than the other regions/,
    );
    assert.match(
      line,
      /Connecticut \(40 commercial parcels in eight former counties, from the towns' grand lists in the statewide parcel and CAMA layer as of 2026-10-01; CC0\)/,
    );
    assert.match(
      line,
      /Los Angeles County \(100 commercial parcels from the Assessor's parcel data roll as of 2026-10-01; no owner names, which the public file does not carry/,
    );
    assert.match(
      line,
      /San Francisco \(10 commercial parcels from the Assessor's secured roll \(the 2025 roll year, the latest published; file as of 2026-10-01\); no owner names/,
    );
    assert.match(
      line,
      /Denver \(20 commercial parcels[^)]*CC BY 3\.0, "City and County of Denver", and 56 Colorado/,
    );
    // The README table and the account page's note come from the same places.
    const table = hosted.tableText(d);
    assert.match(table, /\| The City of Boston \| The City of Boston only,/);
    assert.match(table, /\| Los Angeles County \| 100 commercial parcels/);
    assert.ok(table.startsWith("\n\n| Region | Hosted data |"));
    // The market pages take their counts from the same data and say what the place lacks.
    const markets = await import("./market-pages.mjs");
    const examples = JSON.parse(read("site/_data/markets.json")) as {
      markets: {
        slug: string;
        sources: { source_id: string }[];
        holds: { owner_of_record: boolean };
      }[];
    };
    const tpl = read("site/_content/market.html");
    assert.deepEqual(
      markets.hostedMarkets(d).map((m: { slug: string }) => m.slug),
      markets.MARKETS.map((m: { slug: string }) => m.slug),
    );
    for (const m of markets.hostedMarkets(d)) {
      const e = examples.markets.find((x) => x.slug === m.slug);
      assert.ok(e, `${m.slug}: markets.json has no entry`);
      assert.deepEqual(
        e.sources.map((s) => s.source_id),
        m.sources,
        m.slug,
      );
      const html = markets.marketBody(m, e, d, tpl);
      assert.ok(
        !/\{\{[A-Z_]+\}\}/.test(html),
        `${m.slug}: unfilled placeholder`,
      );
      const place = d.places.find((p) => p.key === m.place)!;
      assert.ok(html.includes(place.parcels.toLocaleString("en-US")), m.slug);
      assert.equal(
        /no owner-of-record fact/.test(html),
        !e.holds.owner_of_record,
        `${m.slug}: owner statement`,
      );
    }
    const html = (slug: string) => {
      const m = markets.MARKETS.find((x: { slug: string }) => x.slug === slug)!;
      return markets.marketBody(
        m,
        examples.markets.find((x) => x.slug === slug),
        d,
        tpl,
      );
    };
    assert.match(html("los-angeles"), /no owner names/);
    assert.match(html("san-francisco"), /no owner names/);
    assert.match(html("boston"), /Chelsea, Revere and Winthrop/);
    assert.match(html("boston"), /older than the other places/);
    assert.match(html("denver"), /Creative Commons Attribution 3\.0/);
    assert.ok(html("denver").includes(markets.CO_DISCLAIMER));
    // The State of Colorado's disclaimer is the one its terms require (the review record quotes it whole).
    assert.ok(
      read("docs/registry/sources/co-sos-entities.md")
        .replace(/\s+/g, " ")
        .includes(markets.CO_DISCLAIMER),
    );
    const notices = markets.sourceNotices(d);
    assert.ok(
      notices.includes("THE STATE OF COLORADO MAKES NO REPRESENTATIONS"),
    );
    assert.match(markets.marketLinks(d), /href="\/new-york-city\/"/);
    assert.match(line, /: 419 parcels in 20 counties, on every plan/);
    assert.match(line, /Tarrant County is not served by the hosted registry/);
  });
});

describe("connect page and connect.json", async () => {
  const { connectBody, connectData, connectJson, cursorLink, vscodeLink } =
    await import("./connect.mjs");
  const raw = JSON.parse(read("site/_data/connect.json"));
  const data = connectData(raw, version);
  const body = connectBody(raw, version);
  const serverJson = JSON.parse(read("server.json")) as {
    remotes: { url: string }[];
  };
  const decode = (s: string) =>
    s
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"');

  it("names the MCP URL server.json publishes and a sign-in URL under it", () => {
    assert.equal(data.mcp_url, serverJson.remotes[0]!.url);
    assert.equal(data.signin_url, `${data.mcp_url}/signin`);
  });

  it("shows every surface and every path on the page", () => {
    const html = decode(body);
    assert.ok(data.surfaces.length >= 7);
    for (const s of data.surfaces) {
      assert.ok(html.includes(`id="${s.id}"`), s.id);
      assert.ok(html.includes(s.name), s.name);
      for (const p of s.paths) {
        assert.ok(html.includes(`id="${p.id}"`), p.id);
        assert.ok(html.includes(p.name), p.name);
        for (const step of p.steps) assert.ok(html.includes(step), step);
        if (p.snippet) assert.ok(html.includes(p.snippet.text), p.id);
        assert.ok(p.verification.docs && p.verification.exercised, p.id);
      }
    }
  });

  it("covers the surfaces the connectors guide names", () => {
    const ids = data.surfaces.flatMap((s: { paths: { id: string }[] }) =>
      s.paths.map((p) => p.id),
    );
    for (const id of [
      "claude-ai",
      "claude-desktop-extension",
      "claude-code",
      "claude-api",
      "chatgpt-app",
      "chatgpt-gpt-action",
      "openai-responses",
      "gemini-cli",
      "gemini-api",
      "copilot-studio-mcp",
      "copilot-studio-connector",
      "bedrock-converse",
      "bedrock-agents",
      "cursor",
      "vscode",
      "windsurf",
      "zed",
      "other-clients",
      "langgraph",
      "openai-agents",
      "crewai",
      "vercel-ai-sdk",
      "mcp-sdks",
    ])
      assert.ok(ids.includes(id), id);
  });

  it("uses only FactLot and repository URLs, and the release version in file names", () => {
    const text = JSON.stringify(data);
    for (const [u] of text.matchAll(/https?:\/\/[^\s"\\)<>']+/g))
      assert.ok(
        /^https:\/\/(api\.factlot\.com|factlot\.com|github\.com\/9mp96ygnbk-alt\/factlot)(\/|$)/.test(
          u,
        ),
        u,
      );
    assert.equal(data.version, version);
    assert.equal(
      data.release_assets.standalone_mcp,
      `factlot-mcp-standalone-${version}.tgz`,
    );
    assert.equal(
      data.release_assets.claude_desktop_extension,
      `factlot-${version}.mcpb`,
    );
    const versions = new Set(
      [...text.matchAll(/releases\/download\/v(\d+\.\d+\.\d+)\//g)].map(
        (m) => m[1],
      ),
    );
    assert.deepEqual([...versions], [version]);
    for (const m of text.matchAll(
      /factlot(?:-mcp-standalone)?-(\d+\.\d+\.\d+)\.(?:tgz|mcpb)/g,
    ))
      assert.equal(m[1], version);
    assert.ok(!/\{VERSION\}/.test(text));
    // the files exist under the names the release workflow uses
    assert.ok(
      text.includes(`releases/download/v${version}/factlot-${version}.mcpb`),
    );
  });

  it("builds the Cursor and VS Code links the vendors document", () => {
    const cursor = data.surfaces
      .flatMap(
        (s: { paths: { install_links?: { kind: string; url: string }[] }[] }) =>
          s.paths,
      )
      .flatMap(
        (p: { install_links?: { kind: string; url: string }[] }) =>
          p.install_links ?? [],
      );
    assert.deepEqual(
      cursor.map((l: { kind: string }) => l.kind),
      ["cursor", "vscode", "vscode-insiders"],
    );
    const entry = { url: data.mcp_url };
    const c = new URL(cursorLink("factlot", entry));
    assert.equal(c.protocol, "cursor:");
    assert.equal(c.host, "anysphere.cursor-deeplink");
    assert.equal(c.pathname, "/mcp/install");
    assert.equal(c.searchParams.get("name"), "factlot");
    assert.deepEqual(
      JSON.parse(
        Buffer.from(c.searchParams.get("config")!, "base64").toString(),
      ),
      entry,
    );
    const v = vscodeLink("vscode", "factlot", {
      type: "http",
      url: data.mcp_url,
    });
    assert.ok(v.startsWith("vscode:mcp/install?"));
    assert.deepEqual(JSON.parse(decodeURIComponent(v.split("?")[1]!)), {
      name: "factlot",
      type: "http",
      url: data.mcp_url,
    });
    for (const l of cursor)
      assert.ok(
        body.includes(`href="${l.url.replaceAll("&", "&amp;")}"`),
        l.kind,
      );
  });

  it("claims no verification and loads nothing from another origin", () => {
    assert.ok(!/verified|endorse|official partner/i.test(body));
    assert.ok(!/<(?:script|img|iframe|link)\b/.test(body));
    assert.ok(!/(?:src|srcset)=/.test(body));
    for (const [, u = ""] of body.matchAll(/href="([^"]+)"/g))
      assert.ok(
        u.startsWith("#") ||
          u.startsWith("/") ||
          /^(cursor|vscode|vscode-insiders):/.test(u) ||
          u.startsWith("https://github.com/9mp96ygnbk-alt/factlot/"),
        u,
      );
  });

  it("generates connect.json from the same data", () => {
    const json = JSON.parse(connectJson(raw, version));
    assert.deepEqual(json, data);
    assert.ok(
      json.surfaces.every(
        (s: {
          paths: { transport: string; auth: unknown; steps: unknown[] }[];
        }) => s.paths.every((p) => p.transport && p.auth && p.steps.length),
      ),
    );
  });

  it("is linked from the home page, the MCP page, the try page, llms.txt and the connectors guide", () => {
    assert.ok(read("site/index.html").includes('href="/connect/"'));
    assert.ok(read("site/_content/mcp.html").includes('href="/connect/"'));
    assert.ok(read("site/_content/try.html").includes('href="/connect/"'));
    assert.ok(read("llms.txt").includes("https://factlot.com/connect/"));
    assert.ok(
      read("site/llms.txt").includes("https://factlot.com/connect.json"),
    );
    assert.ok(
      read("connectors/README.md").includes("https://factlot.com/connect/"),
    );
  });

  it(
    "is built into the site, the navigation, the sitemap and /connect.json",
    { skip: !existsSync(new URL("packages/tools/dist/index.js", root)) },
    () => {
      const out = mkdtempSync(`${tmpdir()}/factlot-site-`);
      execFileSync("node", ["scripts/site/build.mjs", out], {
        cwd: root,
        stdio: "pipe",
      });
      const page = readFileSync(`${out}/connect/index.html`, "utf8");
      assert.ok(
        page.includes('<a href="/connect/" aria-current="page">Connect</a>'),
      );
      assert.deepEqual(
        JSON.parse(readFileSync(`${out}/connect.json`, "utf8")),
        data,
      );
      assert.ok(
        readFileSync(`${out}/sitemap.xml`, "utf8").includes(
          "<loc>https://factlot.com/connect/</loc>",
        ),
      );
    },
  );
});
