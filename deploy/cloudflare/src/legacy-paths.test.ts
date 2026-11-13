import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { legacyRedirect } from "./legacy-paths.ts";

const root = new URL("../../../", import.meta.url);
const json = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, root), "utf8"));

describe("legacyRedirect", () => {
  it("sends /buildings/… to /coverage/", () => {
    assert.equal(legacyRedirect("/buildings"), "/coverage/");
    assert.equal(
      legacyRedirect("/buildings/fl:building:us-48201:abc"),
      "/coverage/",
    );
    assert.equal(legacyRedirect("/buildings/a/b/c"), "/coverage/");
  });
  it("sends Texas markets to the county page or the Texas hub", () => {
    assert.equal(legacyRedirect("/markets/houston"), "/texas/harris/");
    assert.equal(
      legacyRedirect("/markets/houston/zip/77002"),
      "/texas/harris/",
    );
    assert.equal(legacyRedirect("/markets/dallas/zip/75201"), "/texas/dallas/");
    assert.equal(legacyRedirect("/markets/austin"), "/texas/travis/");
    assert.equal(legacyRedirect("/markets/san-antonio/zip/78205"), "/texas/");
    assert.equal(legacyRedirect("/markets/Fort-Worth"), "/texas/");
  });
  it("sends a hosted market outside Texas to its page and any other to /coverage/", () => {
    assert.equal(legacyRedirect("/markets/denver/zip/80202"), "/denver/");
    assert.equal(legacyRedirect("/markets/new-york"), "/new-york-city/");
    assert.equal(legacyRedirect("/markets/phoenix/zip/85004"), "/coverage/");
    assert.equal(legacyRedirect("/markets"), "/coverage/");
    assert.equal(legacyRedirect("/markets/"), "/coverage/");
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
    assert.equal(legacyRedirect("/questions"), "/coverage/");
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
      "houston",
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
