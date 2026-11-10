// The landing page and llms.txt state tool counts and a release version by hand. These tests
// fail when either drifts from the tool catalog or the packages, so a new tool or a release
// cannot leave the site saying something untrue.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { QUOTA_RULES } from "../../deploy/cloudflare/src/plans.ts";

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
  it("lists the six hosted counties summing to 221,015", () => {
    const rows = [
      ...html.matchAll(/<th scope="row">(\w+)<\/th>\s*<td>([\d,]+)<\/td>/g),
    ].filter((m) => m[1] !== "Total");
    assert.equal(rows.length, 6);
    assert.equal(
      rows.reduce((a, m) => a + Number((m[2] ?? "").replaceAll(",", "")), 0),
      221015,
    );
    assert.ok(html.includes("<td>221,015</td>"));
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
