// The shell, the fonts, the stylesheet and the drawn figures: one source for every page, nothing
// loaded from another origin, and no figure that says more than the data it is drawn from.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { CONTACT, REPO } from "../../deploy/cloudflare/src/contact.ts";
import { page } from "../../deploy/cloudflare/src/pages.ts";
import {
  notFoundPage,
  renderPropertyPage,
} from "../../deploy/cloudflare/src/property-pages.ts";
import { connectBody, connectData, connectFigure } from "./connect.mjs";
import { INSETS, box, insetSvg, miniMapSvg } from "./coverage-maps.mjs";
import { marketBody, marketCard, hostedMarkets } from "./market-pages.mjs";
import * as shell from "./shell.mjs";
import {
  coveragePreview,
  factCard,
  flowTall,
  flowWide,
  platSvg,
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

  it("the connect drawing names every surface and the one endpoint", () => {
    const raw = json<unknown>("site/_data/connect.json");
    const data = connectData(raw, "0.0.0");
    const fig = connectFigure(raw, "0.0.0");
    for (const s of data.surfaces)
      assert.ok(
        fig.includes(`<li>${s.name.replaceAll("&", "&amp;")}</li>`),
        s.name,
      );
    assert.ok(fig.includes(`<code>${data.mcp_url}</code>`));
    assert.equal(fig.split('class="wire"').length - 1, data.surfaces.length);
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
    }
  });
});

describe("the built site", () => {
  it(
    "gives every page the shell, the font preload and a table box, and writes the map file",
    { skip: !existsSync(new URL("packages/tools/dist/index.js", root)) },
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
      // As served: the same rules without comments and indentation, under 60 KB.
      const served = readFileSync(`${out}/styles.css`, "utf8");
      const squeeze = (css: string) =>
        css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
      assert.equal(squeeze(served), squeeze(read("site/styles.css")));
      assert.ok(served.length <= 60_000, `${served.length} bytes of CSS`);
      assert.ok(!served.includes("/*"));
      const coverage = readFileSync(`${out}/coverage/index.html`, "utf8");
      assert.equal(coverage.split('class="covsvg inset"').length - 1, 3);
      const texasHub = readFileSync(`${out}/texas/index.html`, "utf8");
      assert.ok(texasHub.includes(hubReadouts(texas)));
      assert.ok(texasHub.includes(texasMap(geo, texas)));
    },
  );
});
