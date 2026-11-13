import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { FACTLEASE_PAGES } from "./legacy-factlease.ts";
import { legacyRedirect } from "./legacy-paths.ts";

const root = new URL("../../../", import.meta.url);
const json = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, root), "utf8"));

describe("legacyRedirect", () => {
  it("sends the old section pages to the sister site, as the earlier site did", () => {
    for (const [from, to] of [
      ["/buildings", "https://factlease.com/buildings"],
      ["/buildings/", "https://factlease.com/buildings"],
      ["/Buildings/", "https://factlease.com/buildings"],
      ["/questions", "https://factlease.com/questions"],
      ["/questions/", "https://factlease.com/questions"],
      ["/markets", "https://factlease.com/"],
      ["/markets/", "https://factlease.com/"],
    ] as const)
      assert.equal(legacyRedirect(from), to, from);
  });
  it("sends /search and /for-ai to the pages that took their place, and nothing under them", () => {
    assert.equal(legacyRedirect("/search"), "/try/");
    assert.equal(legacyRedirect("/search/"), "/try/");
    assert.equal(legacyRedirect("/for-ai"), "/connect/");
    assert.equal(legacyRedirect("/for-ai/"), "/connect/");
    for (const p of [
      "/search/x",
      "/for-ai/x",
      "/searches",
      "/for-ais",
      "/x/search",
    ])
      assert.equal(legacyRedirect(p), undefined, p);
  });
  it("sends a city or ZIP page FactLease has to that page, and only those", () => {
    assert.equal(
      legacyRedirect("/markets/houston/zip/77002"),
      "https://factlease.com/houston/zip/77002",
    );
    assert.equal(
      legacyRedirect("/markets/san-antonio/zip/78205"),
      "https://factlease.com/san-antonio/zip/78205",
    );
    assert.equal(
      legacyRedirect("/markets/houston"),
      "https://factlease.com/houston",
    );
    assert.equal(
      legacyRedirect("/markets/San-Antonio/"),
      "https://factlease.com/san-antonio",
    );
    // The list as read: its count, its date, and nothing but the two cities' pages.
    const urls: readonly string[] = FACTLEASE_PAGES.urls;
    assert.equal(urls.length, FACTLEASE_PAGES.count);
    assert.equal(new Set(urls).size, urls.length);
    assert.match(FACTLEASE_PAGES.read_on, /^\d{4}-\d\d-\d\d$/);
    assert.equal(urls.filter((u) => /\/houston\/zip\//.test(u)).length, 27);
    assert.equal(urls.filter((u) => /\/san-antonio\/zip\//.test(u)).length, 47);
    for (const url of urls) {
      assert.match(
        url,
        /^https:\/\/factlease\.com\/(?:houston|san-antonio)(?:\/zip\/\d{5})?$/,
      );
      // Each page is reached from the old address that named it, with or without the slash.
      const old = `/markets${url.slice("https://factlease.com".length)}`;
      assert.equal(legacyRedirect(old), url);
      assert.equal(legacyRedirect(`${old}/`), url);
    }
    // A ZIP or a page FactLease does not list goes where it went before, on this site.
    for (const [from, to] of [
      ["/markets/houston/zip/77999", "/texas/harris/"],
      ["/markets/houston/zip/7700", "/texas/harris/"],
      ["/markets/houston/zip/77002/office", "/texas/harris/"],
      ["/markets/houston/zip/77002x", "/texas/harris/"],
      ["/markets/houston/office", "/texas/harris/"],
      ["/markets/san-antonio/zip/78299", "/texas/"],
      ["/markets/san-antonio/office", "/texas/"],
      ["/markets/dallas/zip/77002", "/texas/dallas/"],
    ] as const)
      assert.equal(legacyRedirect(from), to, from);
  });
  it("never sends anyone off this site except to a listed FactLease page", () => {
    const allowed = new Set<string>([
      ...FACTLEASE_PAGES.urls,
      "https://factlease.com/buildings",
      "https://factlease.com/questions",
      "https://factlease.com/",
    ]);
    for (const p of [
      "/markets/houston/zip/77002",
      "/markets//factlease.com/houston",
      "/markets/houston/zip/77002/../../../evil.example",
      "/markets/https://evil.example",
      "/markets/houston/zip/77002%2f..",
      "/markets/houston/zip/77002?next=https://evil.example",
      "/buildings//evil.example",
      "/questions/https:evil.example",
      "/markets/evil.example/zip/77002",
      "//evil.example/markets/houston",
      "/search//evil.example",
    ]) {
      const to = legacyRedirect(p);
      if (to !== undefined && !to.startsWith("/"))
        assert.ok(allowed.has(to), p);
      if (to?.startsWith("/"))
        assert.match(to, /^\/[a-z-]+\/(?:[a-z-]+\/)?$/, p);
    }
  });
  it("sends anything under /buildings/ to /coverage/", () => {
    assert.equal(
      legacyRedirect("/buildings/fl:building:us-48201:abc"),
      "/coverage/",
    );
    assert.equal(legacyRedirect("/buildings/a/b/c"), "/coverage/");
  });
  it("sends Texas markets to the county page or the Texas hub", () => {
    assert.equal(legacyRedirect("/markets/harris"), "/texas/harris/");
    assert.equal(
      legacyRedirect("/markets/houston/zip/77999"),
      "/texas/harris/",
    );
    assert.equal(legacyRedirect("/markets/dallas/zip/75201"), "/texas/dallas/");
    assert.equal(legacyRedirect("/markets/austin"), "/texas/travis/");
    assert.equal(legacyRedirect("/markets/san-antonio/zip/78299"), "/texas/");
    assert.equal(legacyRedirect("/markets/Fort-Worth"), "/texas/");
  });
  it("sends a hosted market outside Texas to its page and any other to /coverage/", () => {
    assert.equal(legacyRedirect("/markets/denver/zip/80202"), "/denver/");
    assert.equal(legacyRedirect("/markets/new-york"), "/new-york-city/");
    assert.equal(legacyRedirect("/markets/phoenix/zip/85004"), "/coverage/");
  });
  it("sends /questions/… by the place it names", () => {
    assert.equal(
      legacyRedirect("/questions/office-rent-houston"),
      "/texas/harris/",
    );
    assert.equal(
      legacyRedirect("/questions/what-is-office-rent-in-el-paso"),
      "/texas/",
    );
    assert.equal(
      legacyRedirect("/questions/cap-rates-in-seattle"),
      "/coverage/",
    );
  });
  it("matches whole words, not parts of them", () => {
    assert.equal(legacyRedirect("/questions/austinite-rents"), "/coverage/");
  });
  it("leaves every other path alone", () => {
    for (const p of [
      "/",
      "/coverage/",
      "/texas/",
      "/texas/harris/",
      "/denver/",
      "/pricing/",
      "/mcp",
      "/account",
      "/billing/checkout",
      "/v1/registry/get",
      "/property/us-48201/0011440000001",
      "/marketsplace",
      "/constructor",
      "/__proto__",
      "/toString/",
      "/hasownproperty",
      "/buildingsx/1",
      "/texas/markets/houston",
    ])
      assert.equal(legacyRedirect(p), undefined, p);
  });
  it("only names pages the site builds", () => {
    const counties = new Set(
      json("site/_data/texas-counties.json").counties.map(
        (c: { slug: string }) => c.slug,
      ),
    );
    const markets = new Set(
      json("site/_data/markets.json").markets.map(
        (m: { slug: string }) => m.slug,
      ),
    );
    const probes = [
      "houston-office",
      "dallas",
      "austin",
      "harris",
      "travis",
      "new-york",
      "los-angeles",
      "san-francisco",
      "boston",
      "denver",
      "connecticut",
      "nyc",
      "brooklyn",
      "manhattan",
    ];
    for (const p of probes) {
      const target = legacyRedirect(`/markets/${p}`)!;
      const county = target.match(/^\/texas\/([a-z-]+)\/$/)?.[1];
      if (county) assert.ok(counties.has(county), target);
      else assert.ok(markets.has(target.replaceAll("/", "")), target);
    }
  });
});
