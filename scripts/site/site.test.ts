// The landing page and llms.txt state tool counts and a release version by hand. These tests
// fail when either drifts from the tool catalog or the packages, so a new tool or a release
// cannot leave the site saying something untrue.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  FREE_KEY_ADDRESS_LOOKUPS_PER_DAY,
  LOOKUP_RULE,
  MODEL_TOOLS,
  PAID_ONLY,
  PLANS,
  PRO_YEARLY,
  QUOTA_RULES,
  REPORTS_PER_MONTH,
  paidOnlyText,
} from "../../deploy/cloudflare/src/plans.ts";
import {
  PLAN_FILES,
  markdownCode,
  plansData,
  renderPlans,
} from "./gen-plans.ts";
import {
  countyBody,
  priorRollNote,
  exampleBody,
  OTHER_DISTRICTS,
  otherDistrictsTable,
  hubHostedTable,
  tryTexasLinks,
  hubRollSentence,
  hubCountyLinks,
  texasRollsText,
  countWord,
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
/** The hosted Texas counties of the pack (site/_data/hosted.json, from its manifest). */
const hostedTexas = () =>
  (
    JSON.parse(read("site/_data/hosted.json")) as {
      counties: { fips: string; name: string; parcels: number }[];
    }
  ).counties.filter((c) => c.fips.startsWith("48"));

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
  });
  it("has both Pro checkout links and states the two gated things and what stays free", () => {
    const hrefs = [
      ...html.matchAll(/href="([^"]*billing\/checkout[^"]*)"/g),
    ].map((m) => m[1]);
    assert.deepEqual(hrefs, []);
    assert.deepEqual(
      [...html.matchAll(/href="(\{\{PLAN_CHECKOUT_[A-Z_]+\}\})"/g)].map(
        (m) => m[1],
      ),
      [
        "{{PLAN_CHECKOUT_PRO}}",
        "{{PLAN_CHECKOUT_PRO_YEARLY}}",
        "{{PLAN_CHECKOUT_TEAM}}",
      ],
    );
    const pro = read("deploy/cloudflare/src/plans.ts");
    assert.match(pro, /cents: 49000/);
    assert.match(pro, /monthlyCents: 4900/);
    assert.ok(html.includes("$49 a month, or $490 a year"));
    assert.ok(html.includes("two months free"));
    assert.ok(html.includes("Every tax year and every snapshot"));
    assert.ok(html.includes("The current roll year only"));
    assert.ok(html.includes("registry_tx_equity_candidates_batch"));
    assert.ok(html.includes("{{PLAN_PAID_ONLY_LIST}}"));
    for (const arg of ["as_of", "tax_year", "registry_owned_by"])
      assert.ok(html.includes(`<code>${arg}</code>`), arg);
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
  it("puts the three promises, each linking to its page, above the developer material", () => {
    const promises = html.indexOf('id="promise-title"');
    const developer = html.indexOf('id="hero-title"');
    assert.ok(promises > 0 && developer > promises);
    const top = html.slice(promises, developer);
    for (const href of ["/texas/", "/mcp-server/", "/try/"])
      assert.ok(top.includes(`href="${href}"`), href);
    assert.ok(/unequal-appraisal\s+arithmetic/.test(top));
    assert.ok(/Free, no key/.test(top));
    assert.ok(/Every answer\s+cites\s+the\s+public\s+record/.test(top));
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
  it("lists the pack's hosted Texas counties with their parcel total (hosted.json)", () => {
    const data = JSON.parse(read("site/_data/texas-counties.json")) as {
      total_hosted_parcels: number;
      counties: { name: string; hosted_parcels: number; rolls: unknown[] }[];
    };
    const table = hubHostedTable(data.counties).replace(/\s+/g, " ");
    const rows = [
      ...table.matchAll(/<th scope="row">(\w+)<\/th> <td>([\d,]+)<\/td>/g),
    ].filter((m) => m[1] !== "Total");
    const pack = hostedTexas();
    const total = pack.reduce((a, c) => a + c.parcels, 0);
    assert.equal(rows.length, pack.length);
    assert.equal(
      rows.reduce((a, m) => a + Number((m[2] ?? "").replaceAll(",", "")), 0),
      total,
    );
    assert.equal(data.total_hosted_parcels, total);
    assert.ok(table.includes(`<td>${total.toLocaleString("en-US")}</td>`));
    assert.ok(html.includes("{{HOSTED_TABLE}}"));
    // Midland has no values; the multi-year counties say so.
    assert.ok(table.includes("no values in the publisher's file"));
    assert.ok(table.includes("eleven roll years, 2016 to 2026"));
    // Harris, Dallas and Travis: 2022 to 2025 loaded as value history beside the current roll.
    assert.equal(table.split("five roll years, 2022 to 2026").length - 1, 3);
    assert.ok(!html.includes("one roll year per county"));
    const multi = data.counties.filter((c) => c.rolls.length > 1).length;
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
    assert.ok(
      hubRollSentence(data.counties).startsWith(
        `${cap(countWord(multi))} of the ${countWord(pack.length)} counties`,
      ),
    );
  });
  it("leads with what the account gets, for whom, the price and the next step", () => {
    const first = html.slice(0, html.indexOf('id="get"'));
    for (const part of [
      "values by roll year",
      "candidate comparables under a stated default rule",
      "§41.43(b)(3) and §42.26(a)(3)",
      "Excel file",
      "{{VALUE_COUNTY_COUNT}}",
      'href="/try/"',
      'href="#examples"',
      'href="/pricing/"',
      "property tax consultants, tax attorneys",
      "you choose the comparables",
    ])
      assert.ok(first.includes(part), part);
    assert.ok(
      html.indexOf('id="limits"') > html.indexOf('id="price"') &&
        html.indexOf('id="limits"') > html.indexOf('id="status"'),
      "the notice follows the offer, the coverage and Tarrant",
    );
    assert.ok(html.includes("{{EXAMPLE_LINKS}}"));
    assert.ok(html.includes("{{ROLL_SENTENCE}}"));
    assert.ok(
      html.includes("does not choose comparables for a client") &&
        html.includes("Tarrant County is not served"),
    );
  });
  it("states the plan numbers plans.ts enforces, and no result claims", () => {
    const n = (v: number) => v.toLocaleString("en-US");
    const free = ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY;
    assert.ok(html.includes(`${free} registry lookups a day`));
    assert.ok(html.includes(`${REPORTS_PER_MONTH.anonymous} reports a month`));
    assert.ok(
      html.includes(
        `$${PLANS.pro.monthlyCents / 100} a month or $${PRO_YEARLY.cents / 100} a year`,
      ),
    );
    assert.ok(
      html.includes(`Plans from $${PLANS.pro.monthlyCents / 100} a month`),
    );
    assert.ok(
      html.includes(
        `${n(PLANS.pro.registryLookupsPerMonth)} lookups and ${REPORTS_PER_MONTH.pro} reports a month`,
      ),
    );
    assert.ok(
      html.includes(
        `Team, $${PLANS.team.monthlyCents / 100} a month:</strong> up to ${PLANS.team.maxKeys} keys, ${n(PLANS.team.registryLookupsPerMonth)} lookups and ${n(REPORTS_PER_MONTH.team)} reports a month`,
      ),
    );
    assert.ok(
      !/\b(save|win|lower your|best comparables|founding|refund|discount)\b/i.test(
        html,
      ),
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
  county_fips: string;
  hosted_parcels: number;
  neighborhood_tier: boolean;
  neighborhood_code_parcels: number;
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
  it("cover the pack's hosted Texas counties, largest first, and match the hub", () => {
    assert.deepEqual(
      counties.map((c) => c.county_fips),
      hostedTexas()
        .sort((a, b) => b.parcels - a.parcels || a.name.localeCompare(b.name))
        .map((c) => c.fips.slice(2)),
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
  it("say what the earlier roll years are where they differ from the current roll", () => {
    const travis = counties.find((c) => c.slug === "travis")!;
    const dallas = counties.find((c) => c.slug === "dallas")!;
    const harris = counties.find((c) => c.slug === "harris")!;
    const travisBody = flatten(countyBody(travis, tpl, true));
    assert.ok(travisBody.includes("as submitted on the date shown for each"));
    assert.ok(travisBody.includes("Texas Comptroller (EARS)"));
    assert.ok(travisBody.includes("They hold market value only"));
    const earlier = travis.rolls.slice(0, -1);
    assert.ok(
      priorRollNote(travis).includes(
        `(tax years ${earlier[0]!.tax_year} to ${earlier[earlier.length - 1]!.tax_year})`,
      ),
    );
    assert.ok(
      flatten(countyBody(dallas, tpl, true)).includes(
        "hold market value only: the district's certified export",
      ),
    );
    assert.equal(priorRollNote(harris), "");
    assert.equal(
      priorRollNote({ ...travis, rolls: travis.rolls.slice(-1) }),
      "",
    );
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
      counties
        .filter((c) => c.neighborhood_code_parcels > 0)
        .map((c) => c.slug),
    );
    assert.ok(counties.some((c) => c.neighborhood_tier));
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
  it("shows the API's history and sales notes as text with a link to /pricing/, only when present", () => {
    assert.match(js, /\[record\.history_note, record\.sales_note\]/);
    assert.match(js, /typeof n !== "string" \|\| !n\) return;/);
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
      const built = JSON.parse(readFileSync(`${out}/connect.json`, "utf8"));
      const { rest, ...others } = built as { rest: { routes: unknown[] } };
      assert.deepEqual(others, data);
      assert.ok(rest.routes.length >= 15, "the REST reference is in it");
      assert.ok(page.includes('<h2 id="rest">REST reference</h2>'));
      assert.ok(
        readFileSync(`${out}/sitemap.xml`, "utf8").includes(
          "<loc>https://factlot.com/connect/</loc>",
        ),
      );
    },
  );
});

describe("plan facts (site/_data/plans.json and the documents that state them)", () => {
  const catalogTools = (
    JSON.parse(read("spec/schemas/tools.json")) as {
      tools: { name: string; input_schema?: { properties?: object } }[];
    }
  ).tools;
  it("the registry batch tools' descriptions state how they are counted as QUOTA_RULES.batch does", () => {
    const desc = (name: string) =>
      (
        JSON.parse(read("spec/schemas/tools.json")) as {
          tools: { name: string; description: string }[];
        }
      ).tools.find((t) => t.name === name)!.description;
    for (const [tool, phrase] of [
      [
        "registry_lookup_batch",
        "an item that finds nothing inside loaded coverage, a URN not in the registry included, is an answer that finds nothing",
      ],
      [
        "registry_tx_equity_candidates_batch",
        "subjects with an error are given back (a subject not in the registry inside loaded coverage as an answer that finds nothing",
      ],
    ] as const) {
      assert.ok(
        QUOTA_RULES.batch.includes(phrase),
        `QUOTA_RULES.batch: ${phrase}`,
      );
      assert.ok(desc(tool).includes(phrase), `${tool}: ${phrase}`);
      assert.match(desc(tool), /up to an hourly limit/, tool);
      assert.doesNotMatch(
        desc(tool),
        /a miss inside loaded coverage count|is not counted\)/,
        `${tool} states the old rule`,
      );
    }
    assert.match(QUOTA_RULES.counted, /up to an hourly limit/);
  });
  it("the terms name every PAID_ONLY limit in the Free plan's paragraph", () => {
    const free = flat("site/terms.html")
      .replace(/<[^>]+>/g, "")
      .match(/Free, no key:(.*?)A free key \(section 3\)/)![1]!;
    // One phrase of the Free plan's paragraph per PAID_ONLY entry: a new entry fails here until
    // the terms name it.
    const named: Record<string, string> = {
      history:
        "Registry value history and superseded facts are limited to the current roll year and the current facts",
      dated_get: "dated lookups (as_of)",
      candidates_tax_year: "equity candidates for a tax year you name",
      recorded:
        "recorded sales, deeds and mortgages are limited to the newest sale or deed, and the recorded-facts lookup is not included",
      portfolio: "an owner's parcels are limited to the first three",
      batch: "the registry batch lookups",
      model_tools: "the model-backed tools",
      account_tools: "the account tools are not included",
    };
    assert.deepEqual(
      Object.keys(named).sort(),
      PAID_ONLY.map((f) => f.id).sort(),
    );
    for (const [id, phrase] of Object.entries(named))
      assert.ok(free.includes(phrase), `${id}: ${phrase}`);
  });
  it("plans.json is what plans.ts says (run scripts/site/gen-plans.ts)", () => {
    assert.deepEqual(JSON.parse(read("site/_data/plans.json")), plansData());
  });
  it("checkout links are the ones /v1/plans gives, on factlot.com", () => {
    const { checkout } = plansData();
    assert.deepEqual(checkout, {
      pro: "https://factlot.com/billing/checkout?plan=pro",
      pro_yearly: "https://factlot.com/billing/checkout?plan=pro&interval=year",
      team: "https://factlot.com/billing/checkout?plan=team",
    });
    for (const f of [
      "site/index.html",
      "site/_content/pricing.html",
      "README.md",
      "llms.txt",
      "docs/getting-started.md",
    ])
      assert.ok(
        !read(f).includes("api.factlot.com/billing/checkout"),
        `${f} names another checkout host`,
      );
  });
  it("PAID_ONLY names every registry batch tool, real tools and real arguments", () => {
    const batch = catalogTools
      .map((t) => t.name)
      .filter((n) => n.startsWith("registry_") && n.endsWith("_batch"));
    assert.deepEqual(
      [...PAID_ONLY.find((f) => f.id === "batch")!.tools].sort(),
      [...batch].sort(),
    );
    assert.deepEqual(
      PAID_ONLY.find((f) => f.id === "model_tools")!.tools,
      MODEL_TOOLS,
    );
    assert.deepEqual(
      PAID_ONLY.find((f) => f.id === "account_tools")!.tools,
      [
        ...read("deploy/cloudflare/src/account-tools.ts").matchAll(
          /name: "(account_[a-z_]+)"/g,
        ),
      ].map((m) => m[1]),
    );
    // Hosted-only tools are not in the catalog; every other entry names catalog tools.
    for (const f of PAID_ONLY) {
      if (f.id === "model_tools" || f.id === "account_tools") continue;
      for (const name of f.tools) {
        const t = catalogTools.find((x) => x.name === name);
        assert.ok(t, `${name} is in the catalog`);
        if (f.arg)
          assert.ok(
            f.arg in ((t.input_schema?.properties ?? {}) as object),
            `${name} takes ${f.arg}`,
          );
      }
    }
    const gating = read("deploy/cloudflare/src/gating.ts");
    assert.match(gating, /endsWith\("_batch"\)/);
    assert.match(gating, /\.as_of != null/);
    assert.match(gating, /\.tax_year != null/);
    assert.match(gating, /FREE_PORTFOLIO_PARCELS = 3/);
    assert.match(gating, /RECORDED_TOOL = "registry_recorded_facts"/);
    assert.match(gating, /export function limitSales/);
    assert.match(gating, /export function limitEntityPortfolio/);
  });
  it("the free-key figures the documents type match plans.ts", () => {
    for (const f of ["README.md", "docs/getting-started.md"]) {
      const t = flat(f);
      assert.ok(
        t.includes(
          `share ${ANONYMOUS_REQUESTS_PER_MINUTE} requests a minute and ${FREE_KEY_ADDRESS_LOOKUPS_PER_DAY} lookups a day`,
        ),
        f,
      );
    }
    assert.ok(
      read("llms.txt").includes(
        `share ${ANONYMOUS_REQUESTS_PER_MINUTE}/min and ${FREE_KEY_ADDRESS_LOOKUPS_PER_DAY} lookups/day`,
      ),
    );
  });
  it("no document or page states the old lookup rule by hand, and the short rule is generated", () => {
    assert.ok(
      read("docs/getting-started.md").includes(
        `<!-- plans:rule -->${markdownCode(LOOKUP_RULE)}<!-- /plans:rule -->`,
      ),
    );
    const files = [
      "README.md",
      "llms-install.md",
      "site/try/try.js",
      ...[
        "docs",
        "connectors",
        "site",
        "site/_content",
        "packages/mcp",
        "packages/tools",
        "packages/server",
        "python",
      ].flatMap((dir) =>
        readdirSync(new URL(`${dir}/`, root))
          .filter((f) => /\.(md|html)$/.test(f))
          .map((f) => `${dir}/${f}`),
      ),
    ];
    for (const f of files) {
      const text = flat(f);
      assert.doesNotMatch(
        text,
        /one answered call to a|answered lookups count|finds nothing still counts|misses outside the loaded coverage and input errors are free/,
        f,
      );
    }
    assert.match(
      read("site/try/try.js"),
      /finds nothing \(up to an hourly limit\)/,
    );
  });
  it("README, the docs and llms.txt state the same two sentences (run scripts/site/gen-plans.ts)", () => {
    for (const f of PLAN_FILES) {
      const text = read(f);
      const r = renderPlans(text);
      assert.ok(r.found >= 2, `${f}: plan sentences not marked`);
      assert.equal(r.text, text, `${f} is out of date`);
    }
    const llms = read("llms.txt");
    assert.ok(llms.includes(paidOnlyText().slice(0, 20)));
    for (const f of PAID_ONLY)
      for (const name of [...f.tools, ...(f.arg ? [f.arg] : [])])
        assert.ok(llms.includes(`\`${name}\``), `llms.txt names ${name}`);
  });
  it("the built pages take the plan facts from plans.json", () => {
    for (const [f, keys] of [
      [
        "site/index.html",
        [
          "PLAN_PAID_ONLY_LIST",
          "PLAN_LOOKUP_COUNTED",
          "PLAN_PRO_YEARLY_USD",
          "PLAN_CHECKOUT_PRO_YEARLY",
        ],
      ],
      [
        "site/_content/pricing.html",
        ["PLAN_PAID_ONLY_LIST", "PLAN_CHECKOUT_PRO"],
      ],
      ["site/_content/mcp.html", ["PLAN_PAID_ONLY", "PLAN_LOOKUP_COUNTED"]],
      ["site/_content/try.html", ["PLAN_LOOKUP_COUNTED"]],
    ] as const)
      for (const k of keys)
        assert.ok(read(f).includes(`{{${k}}}`), `${f} uses ${k}`);
    // The home page states the free key and paid gating as on, without asking the API.
    const wrangler = read("deploy/cloudflare/wrangler.jsonc");
    assert.match(wrangler, /"FREE_KEY_ENABLED": "true"/);
    assert.match(wrangler, /"GATING_ENABLED": "true"/);
    assert.ok(!/refreshed weekly/i.test(read("site/index.html")));
    assert.ok(!/refreshed weekly/i.test(read("site/_content/pricing.html")));
    assert.ok(!/refreshed weekly/i.test(read("README.md")));
    // The usage totals keep a state prefix only (usage.ts regionDim), and the welcome email
    // states the interval bought (email.ts renewalText).
    assert.ok(!/state or county prefix/.test(read("site/privacy.html")));
    assert.ok(
      !/renews monthly until cancelled/.test(read("site/privacy.html")),
    );
    // The privacy notice says FactLot keeps no access log of its own: the API Worker's request
    // (invocation) logs must stay off while it says so.
    assert.match(read("site/privacy.html"), /keeps no access log of its own/);
    assert.match(wrangler, /"invocation_logs": false/);
    assert.match(wrangler, /"redact_query_string": true/);
  });
});

describe("hand-typed counts", () => {
  const catalogNames = tools.map((t) => t.name);
  const registry = catalogNames.filter((n) => n.startsWith("registry_")).length;
  const WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  it("README states the calculator and workbook counts", () => {
    const readme = flat("README.md");
    assert.ok(readme.includes(`${calculators} deterministic CRE calculators`));
    const workbooks = readdirSync(
      new URL("examples/reconciliation/", root),
    ).filter((f) => f.endsWith(".xlsx")).length;
    assert.ok(
      readme.includes(`[${WORDS[workbooks]} Excel workbooks]`),
      `README says ${WORDS[workbooks]} workbooks`,
    );
    const debt = (
      JSON.parse(read("spec/schemas/tools.json")) as {
        tools: { name: string; formula?: { id: string; version: number } }[];
      }
    ).tools.find((t) => t.name === "calc_debt_sizing")!.formula!;
    assert.ok(
      readme.includes(`{ id: "${debt.id}", version: ${debt.version} }`),
      "README library example states the debt sizing formula version",
    );
  });
  it("the docs state the catalog's tool counts", () => {
    const rest = catalogNames.length;
    // The MCP server adds three discovery tools to the catalog, and the hosted one report_create;
    // none of the four is in tools.json, so the count is built here and the four are checked.
    const mcpSrc = read("packages/mcp/src/index.ts");
    for (const t of ["search", "fetch", "schema_get"])
      assert.ok(mcpSrc.includes(`handlers.set("${t}"`), t);
    assert.match(
      read("deploy/cloudflare/src/reports.ts"),
      /REPORT_TOOL_NAME = "report_create"/,
    );
    const mcp = rest + 4;
    const core = rest - registry;
    const gs = flat("docs/getting-started.md");
    assert.ok(gs.includes(`(${core} tools)`), "getting-started core count");
    assert.ok(gs.includes(`The ${WORDS[registry]} \`registry_*\` tools`));
    assert.ok(
      gs.includes(`${rest} tools over REST`) && gs.includes(`${mcp} over MCP`),
    );
    const conn = flat("connectors/README.md");
    assert.ok(
      conn.includes(`Serves ${core} tools plus ${registry} registry tools`),
    );
    assert.ok(conn.includes(`(${mcp} in all)`));
    assert.ok(
      flat("docs/registry/README.md").includes(
        `the catalog gains ${WORDS[registry]} tools`,
      ),
    );
    for (const n of catalogNames.filter((x) => x.startsWith("registry_")))
      assert.ok(read("docs/registry/README.md").includes(`\`${n}\``), n);
    const fw = flat("connectors/frameworks/README.md");
    assert.ok(
      fw.includes(`lists ${rest} tools over REST`) &&
        fw.includes(`and ${mcp} over MCP`),
    );
    assert.ok(
      flat("site/index.html").includes(
        `${WORDS[registry]} <code>registry_*</code> lookups`,
      ),
    );
  });
  it("README lists every catalog tool", () => {
    const readme = read("README.md");
    for (const n of catalogNames)
      assert.ok(readme.includes(`\`${n}\``), `README lists ${n}`);
  });
  it(
    "the install pages name every tool the next local release adds",
    {
      skip: (() => {
        try {
          execFileSync(
            "git",
            ["rev-parse", "--verify", "-q", `v${version}^{commit}`],
            {
              cwd: root,
              stdio: "pipe",
            },
          );
          return false;
        } catch {
          return `tag v${version} not fetched`;
        }
      })(),
    },
    () => {
      const old = JSON.parse(
        execFileSync("git", ["show", `v${version}:spec/schemas/tools.json`], {
          cwd: root,
          encoding: "utf8",
        }),
      ) as { tools: { name: string; input_schema?: unknown }[] };
      const before = new Set(old.tools.map((t) => t.name));
      const added = catalogNames.filter((n) => !before.has(n));
      // Every input added to a tool v${version} already had, by its own name (nested ones too).
      type S = { properties?: Record<string, S>; items?: S };
      const leaves = (x: S | undefined, at = ""): string[] =>
        Object.entries(x?.properties ?? {}).flatMap(([k, v]) => [
          `${at}${k}`,
          ...leaves(v, `${at}${k}.`),
          ...leaves(v.items, `${at}${k}[].`),
        ]);
      const now = tools as unknown as { name: string; input_schema?: S }[];
      const inputs = new Set<string>();
      for (const t of old.tools) {
        const was = new Set(leaves(t.input_schema as S));
        const is = now.find((x) => x.name === t.name);
        for (const l of leaves(is?.input_schema))
          if (!was.has(l))
            inputs.add(
              l
                .split(/[.[\]]+/)
                .filter(Boolean)
                .at(-1)!,
            );
      }
      assert.ok(inputs.size > 0);
      for (const f of [
        "README.md",
        "docs/getting-started.md",
        "llms-install.md",
        "site/index.html",
        "site/_content/mcp.html",
        "scripts/site/connect.mjs",
      ])
        for (const n of added)
          assert.ok(
            read(f).includes(n),
            `${f} names ${n}, new since v${version}`,
          );
      for (const f of [
        "README.md",
        "docs/getting-started.md",
        "llms-install.md",
        "site/index.html",
        "site/_content/mcp.html",
        "scripts/site/connect.mjs",
      ]) {
        const text = read(f);
        for (const i of inputs)
          assert.ok(
            text.includes(`\`${i}\``) || text.includes(`<code>${i}</code>`),
            `${f} names the input ${i}, new since v${version}`,
          );
      }
    },
  );
  it("the MCP page, README, llms.txt and the agent guide list every fixed resource", () => {
    const src = read("packages/mcp/src/resources.ts");
    const fixed = [
      ...src.matchAll(/\(\s*"[a-z-]+",\s*"(factlot:\/\/[a-z/]+)"/g),
    ].map((m) => m[1]!);
    assert.ok(fixed.length >= 7, `found ${fixed.length} resources`);
    for (const f of [
      "site/_content/mcp.html",
      "README.md",
      "llms.txt",
      "docs/agents.md",
    ])
      for (const uri of fixed)
        assert.ok(read(f).includes(uri), `${f} lists ${uri}`);
  });
  it("README, llms.txt and the agent guide state the Texas roll years from texas-counties.json", () => {
    const expected = texasRollsText(counties);
    assert.ok(
      expected.includes(` of the ${countWord(counties.length)} counties`),
    );
    for (const f of ["README.md", "docs/agents.md"]) {
      const m = /<!-- texas:rolls -->([\s\S]*?)<!-- \/texas:rolls -->/.exec(
        read(f),
      );
      assert.ok(m, `${f}: no texas:rolls span`);
      assert.equal(
        m[1]!.replace(/\s+/g, " "),
        expected,
        `${f}: paste texasRollsText()`,
      );
    }
    assert.ok(
      read("llms.txt").split("\n").includes(expected),
      "llms.txt: paste texasRollsText()",
    );
  });
});

describe("hosted Texas counties come from the pack", () => {
  const tx = (
    JSON.parse(read("site/_data/texas-counties.json")) as {
      counties: {
        name: string;
        county_fips: string;
        id_system: string;
        rolls: { preliminary: boolean }[];
      }[];
    }
  ).counties;
  it("coverage.json names each county's ID system as the registry file does", async () => {
    const { ID_SYSTEMS } = await import("./coverage-catalog.mjs");
    for (const c of tx)
      assert.equal(
        (ID_SYSTEMS as Record<string, string>)[`48${c.county_fips}`],
        c.id_system,
        c.name,
      );
  });
  it("the Texas note names the preliminary and value-less counties the data holds", async () => {
    const { TX_NOTE } = await import("./hosted.mjs");
    const prelim = tx
      .filter((c) => c.rolls.at(-1)?.preliminary)
      .map((c) => c.name);
    const none = tx.filter((c) => c.rolls.length === 0).map((c) => c.name);
    for (const n of [...prelim, ...none]) assert.ok(TX_NOTE.includes(n), n);
    for (const c of tx)
      if (!prelim.includes(c.name) && !none.includes(c.name))
        assert.ok(!TX_NOTE.includes(c.name), `${c.name} is not in the note`);
  });
  it("the pricing page and the agent guide take the Texas count and names from data", () => {
    assert.ok(
      read("site/_content/pricing.html").includes("{{TX_COUNTY_COUNT_CAP}}"),
    );
    assert.ok(read("docs/agents.md").includes("<!-- hosted:texas-names -->"));
    for (const f of [
      "site/_content/pricing.html",
      "site/_content/texas.html",
      "site/index.html",
    ])
      assert.ok(
        !/\b(sixteen|fifteen) (hosted )?Texas counties\b/i.test(read(f)),
        f,
      );
  });
});

describe("REST reference on /connect/", async () => {
  const { openApi31, tools: specs } = await import("@factlot/tools");
  const { ReportRequest, reportRequestJsonSchema } =
    await import("@factlot/reports");
  const { withHostedOperations } =
    await import("../../deploy/cloudflare/src/openapi-hosted.ts");
  const ref = await import("./rest-reference.mjs");
  const data = JSON.parse(read("site/_data/rest-reference.json")) as {
    tools: { tool: string; example?: unknown; fields?: string }[];
  };
  const deps = {
    catalog: tools as never,
    reportSchema: reportRequestJsonSchema(),
    vectors: (tool: string) =>
      ref.vectorInputs(new URL(".", root).pathname, tool),
    paidTools: ref.paidToolsOf(plansData().paid_only),
    validate: (tool: string, body: unknown) => {
      const schema =
        tool === "report_create"
          ? ReportRequest
          : specs.find((t) => t.name === tool)?.input;
      const r = schema?.safeParse(body);
      return !r ? "no schema" : r.success ? undefined : r.error.message;
    },
  };
  const entries = ref.restReference(data, deps);

  it("lists the tools of the data file, each with a valid example", () => {
    assert.deepEqual(
      entries.map((e) => e.tool),
      data.tools.map((t) => t.tool),
    );
    assert.ok(entries.length >= 15);
    for (const e of entries)
      assert.equal(deps.validate(e.tool, e.example), undefined, e.tool);
  });

  it("every listed path and method is in the OpenAPI document the API serves", async () => {
    const inner = new Response(
      JSON.stringify(openApi31({ filter: () => true })),
      { headers: { "content-type": "application/json" } },
    );
    const doc = (await (
      await withHostedOperations(inner, "3.1", false)
    ).json()) as { paths: Record<string, Record<string, unknown>> };
    for (const e of entries)
      assert.ok(
        doc.paths[e.path]?.[e.method.toLowerCase()],
        `${e.method} ${e.path} (${e.tool})`,
      );
  });

  it("takes method, path and required fields from the catalog, not from the data file", () => {
    for (const e of entries) {
      if (e.tool === "report_create") {
        assert.equal(e.path, "/v1/reports");
        continue;
      }
      const t = (
        tools as unknown as {
          name: string;
          path: string;
          input_schema: { required?: string[] };
        }[]
      ).find((x) => x.name === e.tool)!;
      assert.equal(e.path, t.path);
      assert.deepEqual(e.required, t.input_schema.required ?? []);
    }
  });

  it("says which routes need a Pro or Team key, from PAID_ONLY, and what address search needs", () => {
    assert.deepEqual(
      [...ref.paidToolsOf(plansData().paid_only)].sort(),
      [
        ...PAID_ONLY.find((f) => f.id === "batch")!.tools,
        ...PAID_ONLY.find((f) => f.id === "model_tools")!.tools,
        ...PAID_ONLY.find((f) => f.id === "account_tools")!.tools,
        "registry_recorded_facts",
      ].sort(),
    );
    for (const e of entries)
      assert.equal(
        e.paid === true,
        e.tool.endsWith("_batch") && e.tool.startsWith("registry_"),
        e.tool,
      );
    const html = ref.restReferenceHtml(entries);
    assert.match(
      html,
      /registry_lookup_batch<\/strong>: <code>POST \/v1\/registry\/lookup\/batch<\/code>\. Required: <code>items<\/code>\. Needs a Pro or Team key\./,
    );
    assert.match(
      html,
      /registry_search_address<\/strong>: <code>POST \/v1\/registry\/search_address<\/code>\. Required: query \(or address\)\./,
    );
  });

  it("refuses an example that is not a valid input", () => {
    assert.throws(
      () =>
        ref.restReference(
          { tools: [{ tool: "registry_get", example: { id: "x" } }] },
          deps,
        ),
      /not a valid input/,
    );
    assert.throws(
      () => ref.restReference({ tools: [{ tool: "no_such_tool" }] }, deps),
      /no tool no_such_tool/,
    );
  });

  it("is on the page and in connect.json", () => {
    const html = ref.restReferenceHtml(entries);
    for (const e of entries) {
      assert.ok(html.includes(`id="rest-${e.tool}"`), e.tool);
      assert.ok(html.includes(`${e.method} ${e.path}`), e.tool);
    }
    assert.ok(html.includes("https://api.factlot.com/openapi.json"));
    const json = ref.restReferenceJson(entries);
    assert.equal(json.routes.length, entries.length);
    assert.equal(
      json.routes[0]!.url,
      "https://api.factlot.com/v1/registry/search_address",
    );
  });
});
