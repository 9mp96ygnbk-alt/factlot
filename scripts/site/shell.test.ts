// The shell, the fonts, the stylesheet and the drawn figures: one source for every page, nothing
// loaded from another origin, and no figure that says more than the data it is drawn from.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { transformSync } from "esbuild";

import { CONTACT, REPO } from "../../deploy/cloudflare/src/contact.ts";
import { legacyRedirect } from "../../deploy/cloudflare/src/legacy-paths.ts";
import { page } from "../../deploy/cloudflare/src/pages.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  LOOKUP_RULE,
} from "../../deploy/cloudflare/src/plans.ts";
import {
  notFoundPage,
  renderPropertyPage,
} from "../../deploy/cloudflare/src/property-pages.ts";
import { connectBody, connectData, connectFigure } from "./connect.mjs";
import { INSETS, box, insetSvg, miniMapSvg } from "./coverage-maps.mjs";
import { marketBody, marketCard, hostedMarkets } from "./market-pages.mjs";
import * as shell from "./shell.mjs";
import { published } from "./site-files.mjs";
import {
  HOME_CONNECT,
  connectTile,
  coveragePreview,
  factCard,
  flowTall,
  flowWide,
  platSvg,
  texasSoftwareSentence,
} from "./home.mjs";
import {
  countyReadouts,
  exampleBody,
  exampleFacts,
  exampleSources,
  hubReadouts,
  texasMap,
} from "./texas-pages.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const version = (
  JSON.parse(read("packages/mcp/package.json")) as { version: string }
).version;
const json = <T>(rel: string) => JSON.parse(read(rel)) as T;
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface Geo {
  viewBox: string;
  nation: string;
  stateMesh: string;
  states: Record<string, { name: string; d: string }>;
  counties: Record<string, { name: string; d: string }>;
}
interface TexasCounty {
  slug: string;
  name: string;
  county_fips: string;
  hosted_parcels: number;
  rolls: { tax_year: number }[];
}
const geo = json<Geo>("site/_content/coverage-geometry.json");
const hosted = json<{
  counties: { fips: string }[];
  places: { key: string; parcels: number }[];
}>("site/_data/hosted.json");
const texas = json<{ counties: TexasCounty[] }>(
  "site/_data/texas-counties.json",
).counties;

describe("the page shell", () => {
  it("names the repository and the contact address the Worker uses", () => {
    assert.equal(shell.REPO, REPO);
    assert.equal(shell.CONTACT, CONTACT);
  });

  it("marks the current page, ends the navigation with the lookup, and prefixes site paths on another host", () => {
    const here = shell.siteHeader({ current: "/pricing/" });
    assert.ok(
      here.includes('<a href="/pricing/" aria-current="page">Pricing</a>'),
    );
    assert.equal(here.split("aria-current").length - 1, 1);
    assert.deepEqual(shell.NAV.at(-1), ["/try/", "Try it"]);
    const away = shell.siteHeader({ base: "https://factlot.com" });
    assert.ok(away.includes('href="https://factlot.com/pricing/"'));
    assert.ok(
      away.includes(`href="${REPO}/blob/main/docs/getting-started.md"`),
    );
    assert.ok(!/href="\/[a-z]/.test(away), "no bare site path on another host");
    const foot = shell.siteFooter({ base: "https://factlot.com" });
    assert.ok(!/href="\/[a-z]/.test(foot));
    for (const [href] of [...shell.TRUST, ...shell.PLACES])
      assert.ok(foot.includes(`href="https://factlot.com${href}"`), href);
    assert.ok(foot.includes(`mailto:${CONTACT}`));
    assert.ok(!shell.siteFooter().includes('href="/data/"'));
    assert.ok(shell.siteFooter({ stories: true }).includes('href="/data/"'));
  });

  it("has a menu a keyboard can open: a labelled checkbox before the navigation it controls", () => {
    const h = shell.siteHeader();
    assert.match(
      h,
      /<input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Site menu" aria-controls="site-nav" \/>\n<label for="nav-toggle"[^>]*>Menu<\/label>\n<nav id="site-nav"/,
    );
    assert.ok(!/<script|onclick|style=/.test(h + shell.siteFooter()));
  });

  it("is the header and footer of the Worker's pages, which carry no style of their own", async () => {
    const account = await page("t", "<p>x</p>", {
      site: "https://factlot.com",
    }).text();
    const property = renderPropertyPage({
      site: "https://factlot.com",
      rec: { urn: "fl:parcel:us-11001:x", facts: [] },
      place: { region: "us-11001", name: "District of Columbia", state: "DC" },
      entity: null,
      otherCount: null,
      links: [],
      sourceOf: () => null,
    });
    const missing = await notFoundPage("https://factlot.com").text();
    assert.ok(
      account.includes(shell.siteFooter({ base: "https://factlot.com" })),
    );
    for (const html of [property, missing]) {
      assert.ok(html.includes(shell.siteHeader()));
      assert.ok(html.includes(shell.siteFooter()));
    }
    // The footer names the operator and links the About page, on the site and from another host.
    const operatorLine = (base: string) =>
      `<p class="small">FactLot is run by ${shell.OPERATOR}. It is not a real estate brokerage and is not licensed to broker real estate. <a href="${base}/about/">About FactLot</a>.</p>`;
    assert.ok(account.includes(operatorLine("https://factlot.com")));
    assert.ok(
      account.includes(
        '<li><a href="https://factlot.com/about/">About</a></li>',
      ),
    );
    for (const html of [property, missing]) {
      assert.ok(html.includes(operatorLine("")));
      assert.match(
        html,
        /<li><a href="\/about\/">About<\/a><\/li>\n<li><a href="\/privacy">Privacy<\/a><\/li>\n<li><a href="\/terms">Terms<\/a><\/li>/,
      );
    }
    for (const html of [account, property, missing]) {
      assert.ok(html.includes(shell.MARK));
      assert.ok(html.includes(shell.headLinks()));
      assert.match(html, /<link rel="stylesheet" href="\/styles.css"/);
      assert.doesNotMatch(html, /<style\b|\sstyle=/);
      assert.doesNotMatch(
        html,
        /(?:src|href)="https?:\/\/(?!factlot\.com|github\.com\/9mp96ygnbk-alt\/factlot)/,
      );
    }
  });
});

describe("fonts and stylesheet", () => {
  const css = read("site/styles.css");
  const fonts = readdirSync(new URL("site/fonts/", root));

  it("are two self-hosted variable woff2 files under 150 KB, each with its licence", () => {
    const woff = fonts.filter((f) => f.endsWith(".woff2"));
    assert.deepEqual(
      woff.map((f) => `/fonts/${f}`).sort(),
      [shell.FONT_MONO, shell.FONT_SANS].sort(),
    );
    const bytes = woff.reduce(
      (a, f) => a + statSync(new URL(`site/fonts/${f}`, root)).size,
      0,
    );
    assert.ok(bytes < 150_000, `${bytes} bytes of fonts`);
    const licences = fonts.filter((f) => f.endsWith(".txt"));
    assert.equal(licences.length, woff.length);
    for (const f of licences)
      assert.match(
        read(`site/fonts/${f}`),
        /SIL OPEN FONT LICENSE Version 1\.1/,
      );
  });

  it("load nothing from another origin, and the stylesheet stays small", () => {
    const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]);
    assert.deepEqual(urls.sort(), [shell.FONT_MONO, shell.FONT_SANS].sort());
    assert.ok(!/@import/.test(css));
    assert.match(css, /font-display: swap/);
    assert.match(css, /prefers-color-scheme: dark/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.ok(!css.includes('"/*'), "no comment opener inside a string");
  });
});

describe("drawn maps", () => {
  const hostedFips = hosted.counties.map((c) => c.fips);
  const within = (fips: string, view: number[]) => {
    const b = box(geo.counties[fips]!.d);
    const [x, y, w, h] = view as [number, number, number, number];
    return b.x0 >= x && b.x1 <= x + w && b.y0 >= y && b.y1 <= y + h;
  };

  it("every hosted county lies wholly inside exactly one inset", () => {
    for (const fips of hostedFips)
      assert.equal(
        INSETS.filter((i) => within(fips, i.view)).length,
        1,
        `${fips} ${geo.counties[fips]!.name}`,
      );
  });

  it("an inset draws the counties it is given and no other, and labels only hosted ones", () => {
    const all = hostedFips.map((fips) => ({
      fips,
      cls: "hosted",
      title: geo.counties[fips]!.name,
    }));
    let drawn = 0;
    for (const inset of INSETS) {
      const svg = insetSvg(geo, inset, all);
      const n = svg.split('class="cty cov-hosted"').length - 1;
      assert.equal(n, hostedFips.filter((f) => within(f, inset.view)).length);
      drawn += n;
      for (const [fips, label] of inset.labels) {
        assert.ok(hostedFips.includes(fips), `${label} is not hosted`);
        assert.ok(svg.includes(`>${label}</text>`), label);
      }
      // Standing alone, an inset draws the states it names: every state with a hosted county in view.
      for (const f of new Set(
        hostedFips
          .filter((c) => within(c, inset.view))
          .map((c) => c.slice(0, 2)),
      ))
        assert.ok(
          inset.states.includes(f),
          `${inset.id} leaves out state ${f}`,
        );
      for (const f of inset.states)
        assert.ok(svg.includes(geo.states[f]!.d), f);
      const refs = insetSvg(geo, inset, all, { refs: true });
      assert.ok(
        !/ d="M\d+\.\d/.test(refs.replace(/<clipPath[\s\S]*?<\/clipPath>/, "")),
      );
      assert.equal(refs.split('<use href="#p').length - 1, n);
    }
    assert.equal(drawn, hostedFips.length);
  });

  it("the national map file holds every hosted county and loads nothing", () => {
    const svg = miniMapSvg(geo, hostedFips);
    for (const fips of hostedFips)
      assert.ok(svg.includes(geo.counties[fips]!.d), fips);
    assert.ok(!/href=|<script|<image/.test(svg));
    assert.ok(svg.length < 45_000);
  });

  it("the Texas map links each hosted county once and states its count", () => {
    const map = texasMap(geo, texas);
    for (const c of texas) {
      assert.equal(map.split(`href="/texas/${c.slug}/"`).length - 1, 1, c.slug);
      assert.ok(
        map.includes(
          `${c.name} County: ${c.hosted_parcels.toLocaleString("en-US")} commercial parcels`,
        ),
      );
    }
    const one = texasMap(geo, texas, "harris");
    assert.equal(one.split('class="cty cov-hosted"').length - 1, 1);
    assert.equal(
      one.split('class="cty cov-hosted other"').length - 1,
      texas.length - 1,
    );
    assert.equal(one.split("<text").length - 1, 1);
  });
});

describe("page figures say only what the page says", () => {
  it("the Texas hub's figures are the table's total, its rows and the roll sentence's count", () => {
    const text = words(hubReadouts(texas));
    const total = texas.reduce((a, c) => a + c.hosted_parcels, 0);
    assert.equal(
      text,
      `Commercial parcels hosted in Texas ${total.toLocaleString("en-US")} Counties hosted ${texas.length} Counties with more than one roll year ${texas.filter((c) => c.rolls.length > 1).length}`,
    );
    for (const c of texas) {
      const r = words(countyReadouts(c));
      assert.ok(r.includes(c.hosted_parcels.toLocaleString("en-US")), c.slug);
      assert.equal(/Roll years held/.test(r), c.rolls.length > 0, c.slug);
      if (c.rolls.length)
        assert.ok(
          r.endsWith(String(c.rolls[c.rolls.length - 1]!.tax_year)),
          c.slug,
        );
    }
  });

  it("a market page's card repeats its worked example and nothing else", () => {
    const markets = json<{
      markets: {
        slug: string;
        id_system: string;
        sources: { source_id: string; publisher: string; title: string }[];
        sample: Record<string, string | number | null>;
      }[];
    }>("site/_data/markets.json").markets;
    const tpl = read("site/_content/market.html");
    for (const m of hostedMarkets(hosted)) {
      const d = markets.find((x) => x.slug === m.slug)!;
      const card = words(marketCard(d));
      const body = words(marketBody(m, d, hosted, tpl));
      for (const token of card.match(/\$[\d,]+|\b\d[\d,]*\b/g) ?? [])
        assert.ok(
          body.includes(token),
          `${m.slug}: ${token} is not in the body`,
        );
      assert.ok(card.includes(String(d.sample.label)));
      assert.ok(card.includes(String(d.sample.urn)));
      assert.ok(card.includes(d.sources[0]!.source_id));
      assert.ok(body.includes(String(d.sample.external_id)));
      assert.ok(!/appraisal|advice/i.test(card));
    }
  });

  it("the connect drawing names every surface in full and the one endpoint", () => {
    const raw = json<unknown>("site/_data/connect.json");
    const data = connectData(raw, "0.0.0");
    const fig = connectFigure(raw, "0.0.0");
    for (const s of data.surfaces)
      assert.ok(
        fig.includes(`<li>${s.name.replaceAll("&", "&amp;")}</li>`),
        s.name,
      );
    assert.equal(fig.split("<li>").length - 1, data.surfaces.length);
    assert.ok(fig.includes(`<code>${data.mcp_url}</code>`));
    // Drawn by the stylesheet on the list, so a name is never cut to fit a fixed row.
    assert.ok(!/<svg|style=/.test(fig));
  });

  it("the connect tabs are radio inputs, one per path, and each path keeps its address", () => {
    const raw = json<unknown>("site/_data/connect.json");
    const data = connectData(raw, "0.0.0");
    const body = connectBody(raw, "0.0.0");
    for (const s of data.surfaces) {
      assert.ok(body.includes(`<section class="surface" id="${s.id}"`), s.id);
      for (const p of s.paths) {
        assert.ok(
          body.includes(
            `<input type="radio" name="tab-${s.id}" id="tab-${p.id}" /><label for="tab-${p.id}">`,
          ),
          p.id,
        );
        assert.ok(body.includes(`<div class="tabpanel" id="${p.id}">`), p.id);
      }
      assert.ok(s.paths.length <= 6, "the stylesheet switches up to six tabs");
    }
    assert.ok(
      !/<input[^>]*\bchecked\b/.test(body),
      "no tab is chosen until the reader chooses",
    );
  });
});

describe("the home page's figures", () => {
  interface Example {
    county: string;
    urn: string;
    label: string;
    documents: Record<string, { title: string; retrieved_at: string }>;
  }
  const examples = json<{ examples: Example[] }>(
    "site/_data/texas-examples.json",
  ).examples;
  const harris = examples.find((e) => e.county === "harris")!;
  const county = texas.find((c) => c.slug === "harris")!;
  const page = words(
    exampleBody(county, harris, read("site/_content/texas-example.html")),
  );

  it("the fact card shows only values, records and sources the worked example's page shows", () => {
    const card = factCard(harris, "/texas/harris/example/");
    const rows = exampleFacts(harris);
    const shown = rows.filter((r) => card.includes(`<dt>${r.label}</dt>`));
    assert.equal(shown.length, 4);
    for (const r of shown) {
      assert.ok(
        card.includes(
          `<dd class="src"><span class="cite"><b>${r.source}</b> ${r.locator}</span></dd>`,
        ),
        r.predicate,
      );
      assert.ok(page.includes(words(r.value)), r.value);
      assert.ok(page.includes(r.locator), r.locator);
    }
    for (const token of words(card).match(/\$[\d,]+|\b\d[\d,]{3,}\b/g) ?? [])
      assert.ok(page.includes(token), `${token} is not on the example's page`);
    assert.ok(card.includes(`>${harris.label}</h2>`));
    assert.ok(card.includes(harris.urn));
    for (const s of exampleSources(harris))
      assert.ok(
        card.includes(
          `<li data-n="${s.n}">${s.title}, retrieved ${s.retrieved}</li>`,
        ),
      );
    assert.ok(card.includes('href="/texas/harris/example/"'));
    assert.ok(!/opinion|advice|recommend/i.test(words(card)));
  });

  it("the diagram repeats the card's first value and its record, and nothing the example does not hold", () => {
    const market = exampleFacts(harris).find(
      (r) => r.predicate === "parcel.market_value",
    )!;
    for (const svg of [flowWide(harris), flowTall(harris)]) {
      assert.ok(svg.includes(`>${market.value}</text>`));
      assert.ok(svg.includes(`>[${market.source}] ${market.locator}</text>`));
      assert.ok(svg.includes(harris.urn));
      for (const token of words(svg).match(/\$[\d,]+|\b\d{4}-\d\d-\d\d\b/g) ??
        [])
        assert.ok(
          page.includes(token),
          `${token} is not on the example's page`,
        );
      assert.ok(!/<script|href=|style=/.test(svg));
    }
  });

  it("no card's source line repeats a parenthesised file name, though a recorded title may", () => {
    const twice = /(\(([^()]+)\))\s*\(\2\)/;
    const recorded = examples.flatMap((e) =>
      Object.values(e.documents).map((d) => d.title),
    );
    assert.ok(
      recorded.some((t) => twice.test(t)),
      "no recorded title repeats its file name any more: this rule can go",
    );
    for (const e of examples) {
      const card = factCard(e, `/texas/${e.county}/example/`);
      assert.doesNotMatch(card, twice, e.county);
      for (const s of exampleSources(e)) assert.doesNotMatch(s.title, twice);
    }
    const markets = json<{ markets: { slug: string }[] }>(
      "site/_data/markets.json",
    ).markets;
    for (const m of hostedMarkets(hosted))
      assert.doesNotMatch(
        marketCard(markets.find((x) => x.slug === m.slug)),
        twice,
        m.slug,
      );
    assert.equal(
      shell.sourceTitle("A: roll export (a.zip) (a.zip)  (a.zip)"),
      "A: roll export (a.zip)",
    );
    for (const same of [
      "A: roll (fy<YY>_tc234.zip) (fy27_tc234.zip)",
      "A: file (a.txt) (b.zip)",
      "A (a.zip) and B (a.zip)",
    ])
      assert.equal(shell.sourceTitle(same), same);
    // A property page prints the title once, under the source.
    const urn = "fl:parcel:us-48201:x";
    const doc = `fl:document:sha256-${"7".repeat(64)}`;
    const property = renderPropertyPage({
      site: "https://factlot.com",
      rec: {
        urn,
        facts: [
          {
            id: "flf_1",
            subject: urn,
            predicate: "parcel.year_built",
            value: 1983,
            as_of: "2026-11-01",
            provenance: {
              sources: [
                {
                  document_id: doc,
                  title: recorded.find((t) => twice.test(t))!,
                  uri: "https://example.gov/data",
                  retrieved_at: "2026-11-02T00:00:00+00:00",
                  section: "real_acct.txt acct 1",
                },
              ],
            },
          },
        ],
      },
      place: { region: "us-48201", name: "Harris County", state: "TX" },
      entity: null,
      otherCount: null,
      links: [],
      sourceOf: () => null,
    });
    assert.ok(property.includes("(Real_acct_owner.zip)"));
    assert.doesNotMatch(property, twice);
  });

  it("the plat is a drawing with no text, and the coverage preview draws every hosted county once", () => {
    assert.ok(!/<text|<title|\d{5,}/.test(platSvg()));
    const preview = coveragePreview(
      geo,
      hosted.counties.map((c) => ({ fips: c.fips, title: c.fips })),
    );
    assert.equal(
      preview.split('class="cty cov-hosted"').length - 1,
      hosted.counties.length,
    );
    assert.ok(preview.includes('src="/coverage/map-mini.svg"'));
    assert.ok(preview.length < 26_000, `${preview.length} bytes`);
  });
});

describe("the brand images", () => {
  it("were drawn from the worked example as it stands (scripts/site/brand-images.py redraws them)", () => {
    const drawn = json<Record<string, string | number>>(
      "docs/assets/drawn-from.json",
    );
    const e = json<{
      examples: {
        county: string;
        urn: string;
        label: string;
        parcel_facts: {
          predicate: string;
          value: unknown;
          as_of: string;
          locator: string;
        }[];
      }[];
    }>("site/_data/texas-examples.json").examples.find(
      (x) => x.county === drawn.example,
    )!;
    const fact = (p: string) => e.parcel_facts.find((f) => f.predicate === p)!;
    assert.deepEqual(drawn, {
      example: e.county,
      urn: e.urn,
      label: e.label,
      market_value: fact("parcel.market_value").value,
      year_built: fact("parcel.year_built").value,
      as_of: fact("parcel.market_value").as_of,
      locator: fact("parcel.market_value").locator,
    });
    for (const f of ["readme-hero-light.svg", "readme-hero-dark.svg"]) {
      const svg = read(`docs/assets/${f}`);
      assert.ok(svg.length < 60_000, `${f}: ${svg.length} bytes`);
      assert.ok(
        !/<script|<text|<image|https?:\/\/(?!www\.w3\.org)/.test(svg),
        f,
      );
      // The README shows it, described by the image's own title and description.
      const said = [
        />([^<]+)<\/title>/.exec(svg)![1],
        />([^<]+)<\/desc>/.exec(svg)![1],
      ].join(". ");
      assert.ok(read("README.md").includes(`docs/assets/${f}"`), f);
      assert.ok(read("README.md").includes(`alt="${said}"`), f);
    }
    assert.match(
      read("README.md"),
      /<source media="\(prefers-color-scheme: dark\)" srcset="docs\/assets\/readme-hero-dark\.svg">\s*<img src="docs\/assets\/readme-hero-light\.svg"/,
    );
  });
});

// The legal text as it stood when the pages took the shared shell. A change to the words of either
// page changes its hash: update it in the same commit as the change, on purpose.
const LEGAL_TEXT = {
  "privacy.html":
    "dd2a8b01997bdc3839649e2449c073a80e08cdcbb1fcdd418dcd1b98c21c9bbc",
  "terms.html":
    "b0b31795eec011641812cdfb55f4797b5024579fb83d04b3b9c010fd3087a726",
};
// The same pages' <main>, byte for byte: every tag, attribute and link target as well as the
// words. Only the chrome outside <main> was meant to change when the pages took the shell.
const LEGAL_MAIN = {
  "privacy.html":
    "41a123671f50bfdd6dd41b1e806abfdff2b143bac314ff64690ade341ffde78d",
  "terms.html":
    "ebb871c0546158487d91eb1a1537ef0bd1676cb8c53b570d5ff6b6b4b4bc5e31",
};
const mainOf = (html: string) =>
  /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)![1]!;
const textOf = (html: string) => mainOf(html).replace(/<[^>]*>/g, "");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// These read source files only, so they run on every `npm test`, built packages or not.
describe("the hand-written sources", () => {
  it("the legal pages' text and markup inside <main> are the recorded ones", () => {
    for (const file of Object.keys(LEGAL_TEXT) as (keyof typeof LEGAL_TEXT)[]) {
      const source = read(`site/${file}`);
      assert.equal(
        sha256(textOf(source)),
        LEGAL_TEXT[file],
        `${file}: the text changed`,
      );
      assert.equal(
        sha256(mainOf(source)),
        LEGAL_MAIN[file],
        `${file}: the markup inside <main> changed`,
      );
    }
  });

  it("the home page and the pricing page type no plan number in a plan card or a limits sentence", () => {
    const homeSource = read("site/index.html");
    assert.ok(homeSource.includes("<dd>{{CALC_COUNT}}</dd>"));
    const cards = /<div class="plans">[\s\S]*?<div class="fine">/.exec(
      homeSource,
    )![0];
    for (const id of ["plan-free", "plan-pro", "plan-team"]) {
      const at = cards.indexOf(`id="${id}"`);
      assert.ok(at > 0, id);
      assert.doesNotMatch(
        words(cards.slice(at).split("</article>")[0]!).replace("$0", ""),
        /\d/,
        `${id} states a number by hand`,
      );
    }
    assert.doesNotMatch(
      homeSource.replace(/\s+/g, " "),
      /\d[\d,]* (?:requests a minute|registry lookups|reports a month|a day free|a month on (?:Pro|Team))/,
    );
    const pricingSource = read("site/_content/pricing.html");
    const from = pricingSource.indexOf('<div class="plans">');
    const to = pricingSource.indexOf('<table class="stack">');
    assert.ok(from > 0 && to > from);
    assert.doesNotMatch(
      words(pricingSource.slice(from, to)).replace("$0", ""),
      /\d/,
      "a pricing plan card states a number by hand",
    );
  });

  it("nothing named _* under site/ is published, at any depth, nor a Markdown note", () => {
    for (const kept of [
      "_content/pricing.html",
      "_data/plans.json",
      "_preview/index.html",
      "_design",
      "try/_notes/draft.html",
      "fonts/_unused.woff2",
      "README.md",
      "try/NOTES.md",
    ])
      assert.equal(published(kept), false, kept);
    for (const out of [
      "",
      "index.html",
      "styles.css",
      "try/try.js",
      "fonts/OFL-GeistMono.txt",
      "under_score.html",
    ])
      assert.equal(published(out), true, out);
    assert.match(
      read("scripts/site/build.mjs"),
      /filter: \(src\) => published\(path\.relative\(path\.join\(root, "site"\), src\)\),/,
    );
  });

  it("the About page names the operator as the terms and the privacy notice do, and types no address", () => {
    const about = read("site/_content/about.html");
    const flat = (rel: string) => words(read(rel));
    for (const rel of ["site/terms.html", "site/privacy.html"])
      assert.ok(flat(rel).includes(shell.OPERATOR), rel);
    assert.ok(about.includes("FactLot is run by {{OPERATOR}}."));
    assert.equal(
      shell.OPERATOR,
      "Robert Stovall, a sole proprietor in Texas, USA, doing business as FactLot",
    );
    // The contact lines are the terms' own; the address is theirs, read at build.
    const contact =
      "Operator: Robert Stovall, doing business as FactLot, Texas, USA.";
    assert.ok(words(about).includes(contact));
    assert.ok(flat("site/terms.html").includes(contact));
    assert.ok(about.includes("Postal address: {{POSTAL_ADDRESS}}."));
    assert.doesNotMatch(about, /pending|PO Box|\d{5}/);
    assert.ok(about.includes(`mailto:${CONTACT}`));
    assert.equal(
      about.split("mailto:").length - 1,
      about.split(`mailto:${CONTACT}`).length - 1,
    );
    assert.ok(about.includes("<code>{{MCP_REGISTRY_NAME}}</code>"));
    assert.ok(about.includes('<a href="{{REPO}}">'));
  });

  it("the About page says of names, protests and old addresses only what the site and the code say", () => {
    const about = words(read("site/_content/about.html"));
    // Names: the registry's scope as the terms, the privacy notice and the home page put it.
    const scope = "to exclude natural persons' names";
    assert.ok(about.includes(`the registry is built ${scope}`));
    for (const rel of [
      "site/terms.html",
      "site/privacy.html",
      "site/index.html",
      "site/_content/security.html",
    ])
      assert.ok(words(read(rel)).includes(scope), rel);
    assert.doesNotMatch(about, /not shown or stored/);
    // Protests: nothing the Texas page's own sentence does not also say.
    const texas = texasSoftwareSentence(read("site/_content/texas.html"));
    assert.ok(
      about.includes(
        "FactLot is software: it is not a property tax consultant and does not prepare, file or advise on protests.",
      ),
    );
    for (const part of [
      "FactLot is software",
      "is not a property tax consultant",
      "does not prepare, file or advise on protests",
    ])
      assert.ok(texas.includes(part), part);
    // Old addresses: some redirect to the sister site, as the sentence says, each to a page
    // that site has; the rest go to a page of this one.
    assert.ok(
      about.includes(
        "Some addresses of an earlier version of factlot.com, which carried those rent pages, now redirect there.",
      ),
    );
    assert.ok(
      read("site/_content/about.html").includes(
        '<a href="https://factlease.com/about">FactLease</a>',
      ),
    );
    for (const [old, to] of [
      ["/buildings/", "https://factlease.com/buildings"],
      ["/markets/", "https://factlease.com/"],
      ["/questions/", "https://factlease.com/questions"],
      ["/markets/houston/zip/77002", "https://factlease.com/houston/zip/77002"],
    ] as const)
      assert.equal(legacyRedirect(old), to, old);
    for (const old of [
      "/buildings/houston/1000-louisiana-st",
      "/markets/houston/zip/77999",
      "/markets/dallas",
      "/questions/office-rent-houston-77002",
    ])
      assert.match(
        legacyRedirect(old) ?? "",
        /^\/[a-z-]+\/(?:[a-z-]+\/)?$/,
        old,
      );
    // The pages it sends readers to exist as fragments of the trust package.
    for (const f of ["assurance", "security", "status", "sla"])
      assert.ok(existsSync(new URL(`site/_content/${f}.html`, root)), f);
    const security = words(read("site/_content/security.html"));
    assert.ok(security.includes("There is no SOC 2 report yet"));
    assert.ok(security.includes("FactLot is run by one person"));
  });

  it("the home page and the try page look up through a form that needs no script", () => {
    for (const [file, id] of [
      ["site/index.html", "hero-q"],
      ["site/_content/try.html", "try-q"],
    ] as const) {
      const html = read(file).replace(/\s+/g, " ");
      const form = /<form\b[^>]*action="\/lookup\/"[^>]*>[\s\S]*?<\/form>/.exec(
        html,
      )?.[0];
      assert.ok(form, `${file}: a form that goes to /lookup/`);
      assert.match(form, /<form\b[^>]*method="get"/, file);
      assert.match(
        form,
        new RegExp(`<input [^>]*id="${id}" [^>]*name="q" [^>]*maxlength="200"`),
        file,
      );
      assert.match(form, /<button class="button primary" type="submit"/, file);
      assert.doesNotMatch(form, /<input[^>]*name="(?:key|token)"/i, file);
    }
    // The home page's form also takes the state, as the lookup pages' own form does.
    assert.match(
      read("site/index.html").replace(/\s+/g, " "),
      /<input class="try-state" name="state" type="text" maxlength="40"/,
    );
    const tryPage = read("site/_content/try.html").replace(/\s+/g, " ");
    assert.ok(
      tryPage.includes(
        "With JavaScript off, the Look up button opens the answer as a plain page",
      ),
    );
    assert.ok(!tryPage.includes("This page needs JavaScript"));
  });

  it("lookup pages are kept from crawlers and training, are named to machines, and are in no sitemap", () => {
    const robots = read("site/robots.txt");
    assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
    assert.match(robots, /^Disallow: \/lookup$/m);
    assert.match(
      robots,
      /^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m,
    );
    assert.doesNotMatch(robots, /ai-train=yes/);
    for (const f of ["llms.txt", "site/llms.txt"])
      assert.ok(
        read(f).includes(
          "https://factlot.com/lookup/?q=<address> (&format=json for JSON)",
        ),
        f,
      );
    const connect = json<{
      lookup_pages: Record<string, string | string[]>;
    }>("site/_data/connect.json").lookup_pages;
    assert.equal(connect.search_url, "https://factlot.com/lookup/?q={address}");
    assert.equal(
      connect.record_url,
      "https://factlot.com/lookup/{county}/{parcel_id}",
    );
    assert.deepEqual(connect.place_parameters, [
      "state",
      "city",
      "zip",
      "county",
    ]);
    assert.match(String(connect.auth), /never in the address/);
    // How a lookup page is counted: the allowance from plans.ts, and the one-line rule from plans.ts
    // (LOOKUP_RULE, with its hourly limit), never a sentence of its own about searches that find nothing.
    assert.ok(
      String(connect.counting).includes(
        `(${ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY} a day per IP address without a key)`,
      ),
    );
    assert.ok(String(connect.counting).endsWith(LOOKUP_RULE));
    const tryBullet = /<strong>A lookup page<\/strong>[\s\S]*?<\/li>/.exec(
      read("site/_content/try.html"),
    )![0];
    assert.ok(tryBullet.includes("{{PLAN_LOOKUP_RULE}}"));
    assert.ok(
      read("deploy/cloudflare/src/lookup-pages.ts").includes(
        "${e(LOOKUP_RULE)}",
      ),
    );
    for (const text of [
      String(connect.counting),
      tryBullet,
      read("deploy/cloudflare/src/lookup-pages.ts"),
    ])
      assert.doesNotMatch(text, /(?:finds|found) nothing is not counted/);
    // A record with a public page is checked on the caller's property pages a minute; once those
    // are used up it is looked up and counted, so no page says it is never counted.
    for (const text of [
      String(connect.counting),
      tryBullet,
      read("deploy/cloudflare/src/lookup-pages.ts"),
    ]) {
      assert.doesNotMatch(
        text.replace(/\s+/g, " "),
        /page (?:is sent to that page and )?is not counted|public page costs nothing|unless the parcel has a public page/,
      );
      assert.match(text.replace(/\s+/g, " "), /usually/);
    }
    for (const f of ["site/_content/mcp.html", "README.md"])
      assert.ok(read(f).includes("https://factlot.com/lookup/?q="), f);
  });

  it("the home page takes the Texas sentence from the Texas page and does not type it", () => {
    const texasPage = read("site/_content/texas.html");
    const sentence = texasSoftwareSentence(texasPage);
    assert.equal(
      sentence,
      "FactLot is software. It is not a property tax consultant under Texas Occupations Code chapter 1152, does not prepare, file or advise on protests, and does not represent owners before an appraisal review board.",
    );
    assert.ok(words(texasPage).includes(sentence));
    const homeSource = read("site/index.html");
    assert.ok(homeSource.includes("{{TEXAS_SOFTWARE_SENTENCE}}"));
    assert.ok(!homeSource.includes("Occupations Code"));
  });
});

// The tests of the built pages need the built packages (packages/*/dist). `npm test` skips them
// when those are missing; `npm run test:built`, which CI and `npm run check` run after the build,
// sets FACTLOT_REQUIRE_BUILD so they cannot be skipped there.
const needsBuild = {
  skip:
    process.env.FACTLOT_REQUIRE_BUILD !== "1" &&
    !existsSync(new URL("packages/tools/dist/index.js", root)),
};

describe("the built site", () => {
  it(
    "gives every page the shell, the font preload and a table box, and writes the map file",
    needsBuild,
    () => {
      const out = mkdtempSync(`${tmpdir()}/factlot-site-`);
      execFileSync("node", ["scripts/site/build.mjs", out], {
        cwd: root,
        stdio: "pipe",
      });
      const pagesOf = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? pagesOf(`${dir}/${e.name}`)
            : e.name === "index.html" && dir !== out
              ? [`${dir}/${e.name}`]
              : [],
        );
      const generated = pagesOf(out);
      assert.ok(generated.length > 40);
      for (const f of generated) {
        const html = readFileSync(f, "utf8");
        const path = f.slice(out.length).replace(/index\.html$/, "");
        assert.ok(html.includes(shell.siteHeader({ current: path })), path);
        assert.ok(html.includes(shell.headLinks()), path);
        assert.equal(html.split("<h1").length - 1, 1, path);
        assert.doesNotMatch(html, /\sstyle=/, path);
        for (const m of html.matchAll(/<table\b/g))
          assert.match(
            html.slice(0, m.index).trimEnd(),
            /<div class="(?:tablewrap|covscroll)[^"]*">$/,
            `${path}: a table outside a box`,
          );
        for (const toc of html.matchAll(/<nav class="toc"[\s\S]*?<\/nav>/g))
          for (const [, id] of toc[0].matchAll(/href="#([^"]+)"/g))
            assert.ok(html.includes(`id="${id}"`), `${path}: #${id}`);
      }
      assert.equal(
        readFileSync(`${out}/coverage/map-mini.svg`, "utf8"),
        miniMapSvg(geo, hosted.counties.map((c) => c.fips).sort()),
      );
      for (const f of [shell.FONT_SANS, shell.FONT_MONO, "/styles.css"])
        assert.ok(existsSync(`${out}${f}`), f);
      // As served: the source with its comments and white space taken out by a CSS parser, and
      // nothing else changed; under 60 KB.
      const served = readFileSync(`${out}/styles.css`, "utf8");
      const source = read("site/styles.css");
      assert.equal(
        served,
        transformSync(source, {
          loader: "css",
          minifyWhitespace: true,
          legalComments: "none",
        }).code,
      );
      // The same stylesheet: both reduce to one form, and the served file is already at rest.
      const reduced = (css: string) =>
        transformSync(css, { loader: "css", minify: true }).code;
      assert.equal(reduced(served), reduced(source));
      assert.ok(
        Buffer.byteLength(served) <= 60_000,
        `${Buffer.byteLength(served)} bytes of CSS`,
      );
      assert.ok(!served.includes("/*"));
      // Every selector the source writes is in the served file (white space aside).
      const tight = (x: string) => x.replace(/\s+|"/g, "");
      for (const [, selector] of source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{/g))
        assert.ok(
          tight(served).includes(`${tight(selector!)}{`),
          `the served stylesheet lost ${selector}`,
        );
      // Only what the publishing rule lets through is in the folder.
      const names = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) => [
          e.name,
          ...(e.isDirectory() ? names(`${dir}/${e.name}`) : []),
        ]);
      for (const name of names(out))
        assert.ok(!name.startsWith("_") && !name.endsWith(".md"), name);
      // The Worker serves this folder: wrangler's assets directory is the build's default output.
      assert.match(
        read("deploy/cloudflare/wrangler.jsonc"),
        /"assets": \{\s*"directory": "\.\/public",/,
      );
      assert.match(
        read("scripts/site/build.mjs"),
        /process\.argv\[2\] \?\? path\.join\(root, "deploy\/cloudflare\/public"\)/,
      );
      // The hand-written pages: the shell around them, and not a byte of their own text changed.
      for (const file of Object.keys(LEGAL_TEXT)) {
        const source = read(`site/${file}`);
        const built = readFileSync(`${out}/${file}`, "utf8");
        assert.equal(mainOf(built), mainOf(source), `${file}: main differs`);
        assert.equal(
          sha256(mainOf(built)),
          LEGAL_MAIN[file as keyof typeof LEGAL_MAIN],
          file,
        );
        assert.ok(
          built.includes(
            shell.siteHeader({ current: `/${file.replace(".html", "")}` }),
          ),
        );
        assert.ok(built.includes(shell.siteFooter()), file);
        assert.ok(built.includes(shell.headLinks()), file);
        assert.doesNotMatch(built, /\{\{[A-Z_]+\}\}/);
      }
      const missing = readFileSync(`${out}/404.html`, "utf8");
      assert.ok(missing.includes(shell.siteHeader()));
      assert.ok(missing.includes(shell.siteFooter()));
      assert.equal(mainOf(missing), mainOf(read("site/404.html")));
      // Trust pages: figures only where the page counts something.
      const status = readFileSync(`${out}/status/index.html`, "utf8");
      const answer = `{&quot;ok&quot;:true,&quot;version&quot;:&quot;${version}&quot;}`;
      assert.ok(status.includes(`<dd><code>${answer}</code></dd>`));
      assert.ok(
        status
          .split('<div class="doc-body">')[1]!
          .includes(`{"ok":true,"version":"${version}"}`),
        "the status page's own text gives the same answer",
      );
      const assurance = readFileSync(`${out}/assurance/index.html`, "utf8");
      const [head, body] = assurance.split('<div class="doc-body">') as [
        string,
        string,
      ];
      for (const n of head.match(/<dd>(\d+)<\/dd>/g) ?? [])
        assert.ok(
          words(body).includes(n.replace(/<\/?dd>/g, "")),
          `assurance: ${n} is not in the page's text`,
        );
      assert.equal((head.match(/<dd>\d+<\/dd>/g) ?? []).length, 3);
      for (const slug of ["security", "sla"])
        assert.ok(
          !readFileSync(`${out}/${slug}/index.html`, "utf8").includes(
            "doc-figure",
          ),
          slug,
        );
      // The home page: the shell, and every figure and plan number from the data, none typed.
      const home = readFileSync(`${out}/index.html`, "utf8");
      assert.ok(
        home.includes(shell.siteHeader({ current: "/", brandHref: "#top" })),
      );
      assert.ok(home.includes(shell.siteFooter()));
      assert.ok(home.includes(shell.headLinks()));
      assert.doesNotMatch(home, /\{\{[A-Z_]+\}\}|\sstyle=/);
      const harris = json<{ examples: { county: string }[] }>(
        "site/_data/texas-examples.json",
      ).examples.find((e) => e.county === "harris")!;
      assert.ok(home.includes(factCard(harris, "/texas/harris/example/")));
      assert.ok(home.includes(flowWide(harris)));
      assert.ok(home.includes(flowTall(harris)));
      assert.ok(home.includes(platSvg()));
      assert.equal(
        home.split('class="cty cov-hosted"').length - 1,
        hosted.counties.length,
      );
      const calculators = json<{ tools: { name: string }[] }>(
        "spec/schemas/tools.json",
      ).tools.filter((t) => t.name.startsWith("calc_")).length;
      assert.match(
        home,
        new RegExp(`<dt>Calculators</dt>\\s*<dd>${calculators}</dd>`),
      );
      const plans = json<{
        free: Record<string, number>;
        paid: Record<string, number>[];
      }>("site/_data/plans.json");
      const n = (v: number | undefined) => (v ?? NaN).toLocaleString("en-US");
      const homeText = words(home);
      const [pro, team] = plans.paid as [
        Record<string, number>,
        Record<string, number>,
      ];
      for (const t of [
        `${n(plans.free.requests_per_minute)} requests a minute per IP address`,
        `${n(plans.free.registry_lookups_per_day)} registry lookups a day per IP address`,
        `${n(plans.free.reports_per_month)} reports a month per IP address`,
        `$${pro.usd_per_month} a month, or $${pro.usd_per_year} a year`,
        `${pro.keys} API key ${n(pro.requests_per_minute)} requests a minute ${n(pro.registry_lookups_per_month)} registry lookups a month ${n(pro.reports_per_month)} reports a month`,
        `$${team.usd_per_month} a month`,
        `Up to ${team.keys} API keys ${n(team.requests_per_minute)} requests a minute ${n(team.registry_lookups_per_month)} registry lookups a month ${n(team.reports_per_month)} reports a month`,
        `${n(plans.free.registry_lookups_per_day)} a day free, ${n(pro.registry_lookups_per_month)} a month on Pro, ${n(team.registry_lookups_per_month)} a month on Team`,
      ])
        assert.ok(homeText.includes(t), t);
      // What FactLot is not in Texas: the Texas page's own sentence, taken from it at build.
      assert.ok(
        homeText.includes(
          texasSoftwareSentence(read("site/_content/texas.html")),
        ),
      );
      // The connect tiles: each path's own name and what that client is given, from connect.json.
      const connect = connectData(json("site/_data/connect.json"), version);
      const everyPath = connect.surfaces.flatMap((x) => x.paths);
      for (const ids of Object.values(HOME_CONNECT)) {
        const tile = connectTile(connect, ids);
        assert.ok(home.includes(tile), ids.join());
        for (const id of ids) {
          const path = everyPath.find((x) => x.id === id)!;
          assert.ok(tile.includes(`href="/connect/#${id}"`), id);
          // Nothing in a tile's code but the path's own URL and snippet text.
          for (const [, code] of tile
            .slice(tile.indexOf(`href="/connect/#${id}"`))
            .split('<p class="tile-label">')[0]!
            .matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)) {
            const said = words(code!)
              .replaceAll("&quot;", '"')
              .replaceAll("&lt;", "<")
              .replaceAll("&gt;", ">")
              .replaceAll("&amp;", "&");
            assert.ok(
              said === path.url ||
                (path.snippet?.text ?? "").replace(/\s+/g, " ").includes(said),
              `${id}: ${said}`,
            );
          }
        }
      }
      assert.ok(
        Object.values(HOME_CONNECT).filter(
          (ids) => connectTile(connect, ids).split("<pre>").length - 1 >= 2,
        ).length === 6,
        "every tile shows at least two things to paste",
      );
      // What needs a paid key, as a list: the sentence's opening, then its entries, one a row.
      const paidOnly = json<{
        paid_only: { what: string; free: string }[];
        paid_only_text: string;
      }>("site/_data/plans.json");
      const lead = paidOnly.paid_only_text.split(": ")[0]!;
      assert.match(
        lead,
        /^\w+ things on the hosted API need a Pro or Team key$/,
      );
      const pricingBuilt = readFileSync(`${out}/pricing/index.html`, "utf8");
      for (const [name, page] of [
        ["home", home],
        ["pricing", pricingBuilt],
      ] as const) {
        const list = /<ul class="paid-only">[\s\S]*?<\/ul>/.exec(page)![0];
        const plain = (html: string) =>
          html
            .replace(/<br \/>/g, " ")
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim();
        const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) =>
          plain(m[1]!),
        );
        assert.deepEqual(
          items,
          paidOnly.paid_only.map((f) => `${f.what} Free: ${f.free}`),
          name,
        );
        assert.ok(plain(page).includes(lead), `${name}: ${lead}`);
        assert.ok(!plain(page).includes(paidOnly.paid_only_text), name);
      }
      assert.match(
        home,
        /<details class="fold">\s*<summary>\w+ things on the hosted API need a Pro or Team key<\/summary>\s*<ul class="paid-only">/,
      );
      // The pricing page opens with two plain sentences, then the plan cards.
      const lede = /<p class="lede">([\s\S]*?)<\/p>\s*([\s\S]{0,40})/.exec(
        pricingBuilt,
      )!;
      assert.equal(
        words(lede[1]!),
        "The tools are open source and free to run yourself, with no limits. The hosted endpoint at https://api.factlot.com saves you running it.",
      );
      assert.ok(lede[2]!.startsWith('<div class="plans">'));
      assert.ok(
        pricingBuilt.indexOf('<ul class="paid-only">') >
          pricingBuilt.indexOf('id="paid-features"'),
      );
      // The home page's reference blocks are in the page, behind disclosures that start closed.
      assert.doesNotMatch(home, /<details[^>]*\bopen\b/);
      for (const inside of [
        "<strong>Discovery</strong>",
        "<strong>How quotas work.</strong>",
        "Install v",
        "lease critical dates",
        "hosted:withheld",
        "estoppel",
      ]) {
        const at = home.indexOf(inside);
        assert.ok(at > 0, inside);
        assert.ok(
          home.lastIndexOf('<details class="fold">', at) >
            home.lastIndexOf("</details>", at),
          `${inside} is not behind a disclosure`,
        );
      }
      // No source line anywhere repeats a parenthesised file name.
      const twice = /(\(([^()]+)\))\s*\(\2\)/;
      for (const f of [...generated, `${out}/index.html`])
        assert.doesNotMatch(
          words(readFileSync(f, "utf8")),
          twice,
          f.slice(out.length),
        );
      // The social image's declared size is the file's.
      const png = readFileSync(new URL("site/social-preview.png", root));
      assert.ok(
        home.includes(
          `<meta property="og:image:width" content="${png.readUInt32BE(16)}" />`,
        ) &&
          home.includes(
            `<meta property="og:image:height" content="${png.readUInt32BE(20)}" />`,
          ),
      );
      // The pricing page: the plan cards above the comparison, their numbers from plans.json, and
      // a comparison whose every cell carries its plan's name for the phone layout.
      const pricing = readFileSync(`${out}/pricing/index.html`, "utf8");
      const cardsAt = pricing.indexOf('<div class="plans">');
      const tableAt = pricing.indexOf(
        '<div class="tablewrap stacks"><table class="stack">',
      );
      assert.ok(cardsAt > 0 && tableAt > cardsAt);
      const pricingText = words(pricing.slice(cardsAt, tableAt));
      for (const t of [
        `Requests a minute ${n(plans.free.requests_per_minute)} per IP address Registry lookups ${n(plans.free.registry_lookups_per_day)} a day per IP address Reports ${n(plans.free.reports_per_month)} a month per IP address`,
        `$${pro.usd_per_month} a month, or $${pro.usd_per_year} a year API keys ${pro.keys} Requests a minute ${n(pro.requests_per_minute)} per key Registry lookups ${n(pro.registry_lookups_per_month)} a month Reports ${n(pro.reports_per_month)} a month`,
        `$${team.usd_per_month} a month API keys ${team.keys} Requests a minute ${n(team.requests_per_minute)} per key Registry lookups ${n(team.registry_lookups_per_month)} a month Reports ${n(team.reports_per_month)} a month`,
      ])
        assert.ok(pricingText.includes(t), t);
      const comparison = /<table class="stack">[\s\S]*?<\/table>/.exec(
        pricing,
      )![0];
      const rows = comparison
        .split("<tbody>")[1]!
        .match(/<tr>[\s\S]*?<\/tr>/g)!;
      assert.equal(rows.length, 13);
      for (const row of rows)
        assert.deepEqual(
          [...row.matchAll(/<td data-label="([^"]*)"/g)].map((m) => m[1]),
          ["Free", "Pro", "Team"],
          words(row),
        );
      for (const label of [
        "Value history by tax year",
        "Recorded sales, deeds, mortgages and satisfactions of a parcel",
        "A record on an earlier date",
        "Equity candidates from a roll year you name",
        "Parcels of an owner's portfolio",
        "Batch lookup of many parcels",
      ])
        assert.ok(
          rows.some((r) => words(r).startsWith(label)),
          `the comparison has no row: ${label}`,
        );
      // The About page: built, in the shell, with the operator, the address and the registry
      // name of the pages and files it speaks of; in the sitemap; linked from every page's footer.
      const about = readFileSync(`${out}/about/index.html`, "utf8");
      const aboutText = words(about);
      assert.ok(
        aboutText.includes(
          `FactLot is run by ${shell.OPERATOR}. It is run by one person.`,
        ),
      );
      const postalOf = (file: string) => [
        ...new Set(
          [
            ...words(readFileSync(`${out}/${file}`, "utf8")).matchAll(
              /Postal address: ([^.]+)\./g,
            ),
          ].map((m) => m[1]),
        ),
      ];
      const postal = postalOf("privacy.html");
      assert.equal(postal.length, 1);
      assert.match(postal[0]!, /^PO Box \d+, [A-Za-z ]+, [A-Z]{2} \d{5}$/);
      assert.deepEqual(postalOf("terms.html"), postal);
      assert.deepEqual(postalOf("about/index.html"), postal);
      assert.ok(about.includes(`<dt>Postal address</dt><dd>${postal[0]}</dd>`));
      const registryName = json<{ name: string }>("server.json").name;
      assert.ok(about.includes(`<code>${registryName}</code>`));
      assert.ok(read("site/index.html").includes(registryName));
      assert.ok(about.includes(`<a href="${REPO}">`));
      assert.doesNotMatch(about, /\{\{[A-Z_]+\}\}/);
      // Its structured data states only what the page states.
      const ld = [
        ...about.matchAll(
          /<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g,
        ),
      ]
        .map((m) => JSON.parse(m[1]!) as Record<string, unknown>)
        .find((o) => o["@type"] === "AboutPage")!;
      const entity = ld.mainEntity as Record<string, unknown>;
      assert.deepEqual(Object.keys(entity).sort(), [
        "@type",
        "address",
        "email",
        "name",
        "sameAs",
        "url",
      ]);
      assert.equal(entity.email, CONTACT);
      assert.deepEqual(entity.sameAs, [REPO]);
      const address = entity.address as Record<string, string>;
      assert.equal(
        `PO Box ${address.postOfficeBoxNumber}, ${address.addressLocality}, ${address.addressRegion} ${address.postalCode}`,
        postal[0],
      );
      assert.equal(address.addressRegion, "TX");
      assert.ok(aboutText.includes("Texas, USA"));
      assert.equal(address.addressCountry, "US");
      assert.ok(
        readFileSync(`${out}/sitemap.xml`, "utf8").includes(
          "<loc>https://factlot.com/about/</loc>",
        ),
      );
      for (const f of [
        ...generated,
        `${out}/index.html`,
        `${out}/privacy.html`,
        `${out}/terms.html`,
        `${out}/404.html`,
      ]) {
        const html = readFileSync(f, "utf8");
        assert.ok(
          html.includes('<li><a href="/about/">About</a></li>'),
          f.slice(out.length),
        );
        assert.ok(
          html.includes('<a href="/about/">About FactLot</a>'),
          f.slice(out.length),
        );
      }
      // Lookup pages are the Worker's: the build makes no /lookup/ file, lists none in the
      // sitemap, and the connect page and connect.json say how to open one.
      assert.ok(!existsSync(`${out}/lookup`));
      assert.ok(
        !readFileSync(`${out}/sitemap.xml`, "utf8").includes("/lookup"),
      );
      const connectPage = readFileSync(`${out}/connect/index.html`, "utf8");
      assert.ok(
        connectPage.includes(
          '<h2 id="no-connector">No connector? Open a web address</h2>',
        ),
      );
      assert.ok(
        connectPage.includes(
          "https://factlot.com/lookup/?q=1000+Louisiana+St&amp;state=TX\nhttps://factlot.com/lookup/us-48201/0011440000001",
        ),
      );
      const connectJson = JSON.parse(
        readFileSync(`${out}/connect.json`, "utf8"),
      ) as { lookup_pages: { search_url: string; counting: string } };
      assert.equal(
        connectJson.lookup_pages.search_url,
        "https://factlot.com/lookup/?q={address}",
      );
      assert.ok(
        words(connectPage).includes(connectJson.lookup_pages.counting),
        "the page states the counting rule connect.json gives",
      );
      assert.match(
        readFileSync(`${out}/index.html`, "utf8"),
        /<form\s+class="try-form lookup-form hero-lookup"\s+action="\/lookup\/"\s+method="get"\s*>/,
      );
      const coverage = readFileSync(`${out}/coverage/index.html`, "utf8");
      assert.equal(coverage.split('class="covsvg inset"').length - 1, 3);
      const texasHub = readFileSync(`${out}/texas/index.html`, "utf8");
      assert.ok(texasHub.includes(hubReadouts(texas)));
      assert.ok(texasHub.includes(texasMap(geo, texas)));
    },
  );
});
