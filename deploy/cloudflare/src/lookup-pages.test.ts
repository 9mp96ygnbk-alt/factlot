// Lookup pages end to end: the router (router.ts) with real meters, the real inner API server
// (@factlot/server over HTTP) and the real registry Worker answering from the shared fixture pack.
// What is checked is what a page costs and shows: the same lookups, on the same meters, as the API
// calls behind it, and nothing the API would not give the same caller.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createFactLotServer } from "@factlot/server";
import { configureRegistryRunner } from "@factlot/tools";

import { buildPack } from "../../../scripts/registry/pack.ts";
import { fileAssets } from "../../registry/src/file_assets.ts";
import { handle as registryHandle } from "../../registry/src/worker.ts";

import { generateKey, hashKey, writeKey, type KeyRecord } from "./keys.ts";
import {
  RateLimiterObject,
  objectLimiter,
  objectMeter,
  type CounterStore,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import {
  LOOKUP_MAX_QUERY,
  LOOKUP_PAGE_CSP,
  lookupPath,
} from "./lookup-pages.ts";
import {
  ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
  ANONYMOUS_REQUESTS_PER_MINUTE,
  EMPTY_ANSWERS_PER_HOUR,
  PLANS,
} from "./plans.ts";
import { resetPropertyPagesState } from "./property-pages.ts";
import { registryRunner } from "./registry.ts";
import { handle } from "./router.ts";
import type { Env, Fetcher, KV, RateLimit } from "./types.ts";
import { classifyPath } from "./usage.ts";

// --- the fixture pack, the registry Worker over it, and the inner API server over that -------------

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "factlot-lookup-pages-"));
const fixture = join(dir, "fixture.db");
execFileSync("python3", [
  join(root, "spec/registry/build_fixture.py"),
  fixture,
]);
const pack = join(dir, "pack");
buildPack([{ name: "fixture", path: fixture }], pack);

const registryCalls: string[] = [];
const registry: Fetcher = {
  async fetch(r: Request) {
    const body = r.method === "POST" ? await r.clone().text() : "";
    registryCalls.push(`${new URL(r.url).pathname} ${body.slice(0, 60)}`);
    return registryHandle(r, { ASSETS: fileAssets(pack) });
  },
};
configureRegistryRunner(registryRunner(registry));

const server = createFactLotServer({
  maxBodyBytes: 1024 * 1024,
  trustProxy: true,
  hosted: true,
  log: "none",
});
let port = 0;
before(
  () =>
    new Promise<void>((done) =>
      server.listen(0, "127.0.0.1", () => {
        port = (server.address() as AddressInfo).port;
        done();
      }),
    ),
);
after(() => new Promise<void>((done) => server.close(() => done())));

/** The inner API as the Worker reaches it; every REST path it was asked is kept. */
const apiCalls: string[] = [];
const api: Fetcher = {
  async fetch(r: Request) {
    const u = new URL(r.url);
    apiCalls.push(u.pathname);
    const headers = new Headers(r.headers);
    headers.delete("host");
    return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, {
      method: r.method,
      headers,
      body:
        r.method === "GET" || r.method === "HEAD" ? undefined : await r.text(),
    });
  },
};

// --- real meters over memory, as worker.test.ts builds them -----------------------------------------

class MemoryStore implements CounterStore {
  readonly counts = new Map<string, number>();
  readonly claims = new Map<string, string>();
  readonly usage = new Map<string, number>();
  readonly meta = new Map<string, string>();
  getCount(w: string) {
    return this.counts.get(w) ?? 0;
  }
  setCount(w: string, n: number) {
    this.counts.set(w, n);
  }
  pruneBefore(w: string) {
    const kind = w.slice(0, w.indexOf(":") + 1);
    for (const k of [...this.counts.keys()])
      if (k.startsWith(kind) && k < w) this.counts.delete(k);
  }
  getClaim(n: string) {
    return this.claims.get(n);
  }
  setClaim(n: string, v: string) {
    if (!this.claims.has(n)) this.claims.set(n, v);
  }
  addUsage(day: string, tool: string, region: string, n: number) {
    const k = `${day}|${tool}|${region}`;
    this.usage.set(k, (this.usage.get(k) ?? 0) + n);
  }
  readUsage(fromDay: string) {
    return [...this.usage.entries()]
      .map(([k, n]) => {
        const [day, tool, region] = k.split("|") as [string, string, string];
        return { day, tool, region, n };
      })
      .filter((r) => r.day >= fromDay);
  }
  pruneUsageBefore(day: string) {
    for (const k of [...this.usage.keys()])
      if (k.split("|")[0]! < day) this.usage.delete(k);
  }
  getMeta(n: string) {
    return this.meta.get(n);
  }
  setMeta(n: string, v: string) {
    this.meta.set(n, v);
  }
  deleteMeta(n: string) {
    this.meta.delete(n);
  }
  size() {
    return (
      this.counts.size + this.claims.size + this.usage.size + this.meta.size
    );
  }
  clearClaims() {
    this.claims.clear();
  }
  reset() {}
}

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.data.set(k, v);
  }
  async delete(k: string) {
    this.data.delete(k);
  }
  async list(o: { prefix?: string } = {}) {
    return {
      keys: [...this.data.keys()]
        .filter((k) => k.startsWith(o.prefix ?? ""))
        .map((name) => ({ name })),
      list_complete: true,
    };
  }
}

const allow: RateLimit = {
  limit: async () => ({ success: true }),
  peek: async () => ({ success: true }),
} as RateLimit;

/** 2026-11-13 12:00 UTC. */
const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);

function world(vars: Record<string, string> = {}) {
  const clock = { t: T0 };
  const stores = new Map<string, MemoryStore>();
  const objects = new Map<string, RateLimiterObject>();
  const ns: DurableObjectNamespaceLike = {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: (input: string, init?: RequestInit) => {
        const name = String(id);
        let o = objects.get(name);
        if (!o) {
          const store = new MemoryStore();
          let alarm: number | null = null;
          stores.set(name, store);
          o = new RateLimiterObject(
            {
              storage: {
                sql: {
                  exec() {
                    throw new Error("memory store in tests");
                  },
                },
                getAlarm: async () => alarm,
                setAlarm: async (t: number) => {
                  alarm = t;
                },
                deleteAll: async () => {},
              },
            },
            {},
            { store, now: () => clock.t },
          );
          objects.set(name, o);
        }
        return o.fetch(new Request(input, init));
      },
    }),
  };
  const kv = new MemoryKV();
  const env = {
    KEYS: kv,
    RL_ANON: allow,
    RL_CLAIM: objectLimiter(ns, "claim", 1, 2000),
    METER: objectMeter(ns),
    REGISTRY: registry,
    ASSETS: {
      fetch: async () => new Response("site", { status: 404 }),
    },
    SITE_URL: "https://factlot.com",
    IP_HASH_SALT: "salt",
    GATING_ENABLED: "true",
    FREE_KEY_ENABLED: "true",
    ...vars,
  } as unknown as Env;
  /** Every count the meters hold, by window name (a lookup day window starts "day:"). */
  const counts = (prefix: string): number =>
    [...stores.values()]
      .flatMap((s) => [...s.counts.entries()])
      .filter(([k]) => k.startsWith(prefix))
      .reduce((n, [, v]) => n + v, 0);
  const get = (
    pathAndQuery: string,
    init: {
      ip?: string;
      key?: string;
      accept?: string;
      method?: string;
      host?: string;
    } = {},
  ) =>
    handle(
      new Request(`https://${init.host ?? "factlot.com"}${pathAndQuery}`, {
        method: init.method ?? "GET",
        headers: {
          "cf-connecting-ip": init.ip ?? "203.0.113.9",
          accept: init.accept ?? "text/html",
          ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
        },
      }),
      env,
      api,
      { now: () => clock.t },
    );
  /** Today's free lookups taken from one address, as the keyless API reports them. */
  const usedToday = async (ip = "203.0.113.9"): Promise<number> => {
    const res = await handle(
      new Request("https://api.factlot.com/v1/registry/coverage", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      }),
      env,
      api,
      { now: () => clock.t },
    );
    return (
      Number(res.headers.get("x-factlot-registry-quota-limit")) -
      Number(res.headers.get("x-factlot-registry-quota-remaining"))
    );
  };
  /** The same call on the keyless API, for comparing what it costs and says. */
  const apiPost = (path: string, body: unknown, ip = "203.0.113.9") =>
    handle(
      new Request(`https://api.factlot.com${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      }),
      env,
      api,
      { now: () => clock.t },
    );
  return { env, kv, clock, counts, get, usedToday, apiPost };
}

async function issue(kv: MemoryKV, plan: "pro" | "team" = "pro") {
  const key = generateKey();
  const hash = await hashKey(key);
  const rec: KeyRecord = {
    plan,
    status: "active",
    customer: "cus_1",
    subscription: "sub_1",
    stripe_status: "active",
    created: "2026-11-03T00:00:00Z",
    checked_at: T0,
  } as KeyRecord;
  await writeKey(kv, hash, rec, T0);
  return key;
}

const MAIN_TX = "fl:parcel:us-48999:0001-000-0001";
const MAIN_TX_PATH = "/lookup/us-48999/0001-000-0001";
const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("lookup pages: a search", () => {
  it("one exact match in the place named goes to its record, and costs the search's one lookup", async () => {
    const w = world();
    const res = await w.get("/lookup/?q=100+Main+Street&state=TX");
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), MAIN_TX_PATH);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(await w.usedToday(), 1);
    // The same search on the keyless API costs the same, on the same meter.
    await w.apiPost("/v1/registry/search_address", {
      address: "100 Main Street",
      state: "TX",
      limit: 20,
    });
    assert.equal(await w.usedToday(), 2);
  });

  it("an address in two counties with no city or ZIP code is listed, never picked", async () => {
    const w = world();
    const res = await w.get("/lookup/?q=100+Main+Street");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      strip(html).includes(
        "2 parcels in 2 counties match this address, which names no city or ZIP code.",
      ),
    );
    assert.ok(html.includes(`<a href="${MAIN_TX_PATH}" rel="nofollow">`));
    assert.ok(
      html.includes('<a href="/lookup/us-24998/20-0001" rel="nofollow">'),
    );
    // Each match: its label, county and state, account, category and building area.
    const card = /<li class="match">[\s\S]*?<\/li>/.exec(html)![0];
    for (const label of ["County", "Account", "Category"])
      assert.ok(card.includes(`<dt>${label}</dt>`), label);
    assert.match(strip(card), /County [A-Za-z0-9 -]+, (TX|MD) Account/);
    assert.equal(await w.usedToday(), 1);
  });

  it("two accounts at one address are both listed", async () => {
    const w = world();
    const html = await (
      await w.get("/lookup/?q=500+Market+Street&city=Example+City&state=TX")
    ).text();
    assert.ok(
      strip(html).includes(
        "2 parcels have this address exactly: separate accounts at one address.",
      ),
    );
    assert.equal(html.split('<li class="match">').length - 1, 2);
    assert.match(html, /<dt>Building area<\/dt><dd>[\d,]+ sq ft<\/dd>/);
    for (const account of ["0007-000-0001", "0007-000-0002"])
      assert.ok(
        html.includes(`<dt>Account</dt><dd><code>${account}</code></dd>`),
        account,
      );
  });

  it("a miss gives the search's own reason, the nearest numbers and the coverage page, uncounted", async () => {
    const w = world();
    const res = await w.get("/lookup/?q=999+Main+Street&state=TX");
    assert.equal(res.status, 200);
    const html = await res.text();
    const viaApi = (await (
      await w.apiPost(
        "/v1/registry/search_address",
        { address: "999 Main Street", state: "TX", limit: 20 },
        "198.51.100.1",
      )
    ).json()) as { coverage: { message: string; reason: string } };
    assert.equal(viaApi.coverage.reason, "house_number_not_found");
    const said = viaApi.coverage.message;
    assert.ok(
      strip(html).includes(said.charAt(0).toUpperCase() + said.slice(1)),
      "the API's own message",
    );
    assert.match(
      html,
      /Nearest numbers held on [A-Z ]+: <a href="\/lookup\/\?q=100\+MAIN/,
    );
    assert.ok(html.includes('href="/coverage/"'));
    assert.ok(
      strip(html).includes(
        "This search found nothing and was not counted as a lookup.",
      ),
    );
    assert.equal(await w.usedToday(), 0);
    // A state the registry does not hold: said so, uncounted.
    const other = await (await w.get("/lookup/?q=1+Main+St&state=WA")).text();
    assert.ok(strip(other).includes("WA is not loaded in this registry"));
    assert.equal(await w.usedToday(), 0);
  });

  it("answers that find nothing are counted past the hourly guard, exactly as on the API", async () => {
    const w = world();
    const guard = EMPTY_ANSWERS_PER_HOUR.anonymous;
    for (let i = 0; i < guard; i++) {
      // The guard is an hour's; the minute limit is passed by moving the clock within the hour.
      if (i % 20 === 0) w.clock.t += 61_000;
      await w.apiPost("/v1/registry/search_address", {
        address: `${900 + i} Main Street`,
        state: "TX",
      });
    }
    w.clock.t += 61_000;
    assert.equal(await w.usedToday(), 0);
    const html = await (
      await w.get("/lookup/?q=999+Main+Street&state=TX")
    ).text();
    assert.equal(await w.usedToday(), 1);
    assert.ok(strip(html).includes("counts as a registry lookup"));
  });

  it("an empty search is the form and looks nothing up; a HEAD looks nothing up", async () => {
    const w = world();
    apiCalls.length = 0;
    const res = await w.get("/lookup/");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(
      html,
      /<form class="try-form lookup-form" action="\/lookup\/" method="get">/,
    );
    assert.match(html, /<input id="lookup-q" name="q" type="text"/);
    assert.match(html, /<meta name="robots" content="noindex" \/>/);
    const head = await w.get("/lookup/?q=100+Main+Street&state=TX", {
      method: "HEAD",
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.deepEqual(apiCalls, []);
    assert.equal(await w.usedToday(), 0);
  });
});

describe("lookup pages: a record", () => {
  it("is the cited sheet of the free view, for one lookup, never indexed or stored", async () => {
    const w = world();
    const res = await w.get(MAIN_TX_PATH);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("content-security-policy"), LOOKUP_PAGE_CSP);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex" \/>/);
    assert.doesNotMatch(html, /rel="canonical"/);
    assert.doesNotMatch(html, /<script/i);
    assert.ok(html.includes(`FactLot ID <code>${MAIN_TX}</code>`));
    // A citation on every fact row, each leading to its record under its source.
    const rows = [
      ...html.matchAll(
        /<tr><th scope="row">([^<]+)<\/th><td>[\s\S]*?<\/td><td class="cited">([\s\S]*?)<\/td><\/tr>/g,
      ),
    ];
    assert.ok(rows.length >= 6, `${rows.length} fact rows`);
    for (const [, label, cited] of rows)
      if (label !== "County and state")
        assert.match(cited!, /<a class="cite" href="#source-\d+-\d+"/, label);
    for (const [, id] of html.matchAll(/<a class="cite" href="#([^"]+)"/g))
      assert.ok(html.includes(`id="${id}"`), id);
    // The rights lines are the source record's own.
    const viaApi = (await (
      await w.apiPost("/v1/registry/get", { urn: MAIN_TX }, "198.51.100.2")
    ).json()) as {
      facts: {
        rights?: { license?: string; redistribution?: string; ai_use?: string };
      }[];
      value_history?: unknown[];
    };
    const rights = viaApi.facts.find((f) => f.rights)!.rights!;
    for (const [label, v] of [
      ["Licence as recorded", rights.license],
      ["Redistribution", rights.redistribution],
      ["AI use", rights.ai_use],
    ] as const)
      assert.ok(
        html.includes(`<th scope="row">${label}</th><td>${v}</td>`),
        `${label}: ${v}`,
      );
    assert.ok(strip(html).includes("This record is one registry lookup."));
    assert.ok(
      strip(html).includes(
        `${ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY - 1} of ${ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY} free registry lookups left today for your IP address`,
      ),
    );
    assert.equal(await w.usedToday(), 1);
  });

  it("shows no value of an earlier roll year, only how many a paid key adds", async () => {
    const w = world();
    const full = (await (
      await registryHandle(
        new Request("https://registry.internal/run", {
          method: "POST",
          body: JSON.stringify({
            tool: "registry_get",
            input: { urn: MAIN_TX },
          }),
        }),
        { ASSETS: fileAssets(pack) },
      )
    ).json()) as {
      result: { value_history: { tax_year: number; market_value?: number }[] };
    };
    const history = full.result.value_history;
    assert.ok(history.length > 1, "the fixture parcel has earlier roll years");
    const html = await (await w.get(MAIN_TX_PATH)).text();
    const newest = Math.max(...history.map((h) => h.tax_year));
    for (const h of history)
      if (h.tax_year !== newest && typeof h.market_value === "number")
        assert.ok(
          !html.includes(h.market_value.toLocaleString("en-US")),
          `the ${h.tax_year} value is on the page`,
        );
    assert.ok(
      html.includes(
        '<h2 id="pro">What a Pro or Team key adds for this parcel</h2>',
      ),
    );
    assert.match(strip(html), /\d+ earlier roll years?/);
  });

  it("by URN it goes to the same record's path, uncounted", async () => {
    const w = world();
    const res = await w.get(`/lookup/${MAIN_TX}`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), MAIN_TX_PATH);
    assert.equal(lookupPath(MAIN_TX), MAIN_TX_PATH);
    assert.equal(await w.usedToday(), 0);
  });

  it("a parcel the registry does not hold is a 404 page with the API's words, and a bad path looks nothing up", async () => {
    const w = world();
    const res = await w.get("/lookup/us-48999/9999-999-9999");
    assert.equal(res.status, 404);
    assert.ok(
      strip(await res.text()).includes(
        "This parcel is not in the hosted registry",
      ),
    );
    apiCalls.length = 0;
    for (const bad of [
      "/lookup/us-48999",
      "/lookup/us-48999/a/b",
      "/lookup/us-4899/x",
      "/lookup/fl:entity:us-tx:1",
      "/lookup/%E0%A4%A",
    ]) {
      const r = await w.get(bad);
      assert.equal(r.status, 404, bad);
    }
    assert.deepEqual(apiCalls, []);
  });

  it("with public property pages on, a parcel that has one is sent there and nothing is counted", async () => {
    resetPropertyPagesState();
    const w = world({ PROPERTY_PAGES_ENABLED: "true" });
    const res = await w.get(MAIN_TX_PATH);
    assert.equal(res.status, 303);
    assert.equal(
      res.headers.get("location"),
      "/property/us-48999/0001-000-0001",
    );
    assert.equal(await w.usedToday(), 0);
    // A search that finds that one parcel goes straight to the public page: the search's lookup only.
    const found = await w.get("/lookup/?q=100+Main+Street&state=TX");
    assert.equal(
      found.headers.get("location"),
      "/property/us-48999/0001-000-0001",
    );
    assert.equal(await w.usedToday(), 1);
    // Asked for JSON, the record is the API's answer and is counted as the API counts it.
    const json = await w.get(`${MAIN_TX_PATH}?format=json`);
    assert.equal(json.status, 200);
    assert.equal(((await json.json()) as { urn: string }).urn, MAIN_TX);
    assert.equal(await w.usedToday(), 2);
    resetPropertyPagesState();
  });
});

describe("lookup pages: the allowance", () => {
  it("a page and the API draw on one allowance: neither is a way around the other", async () => {
    const w = world();
    const limit = ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY;
    // All but two through the API, then two pages: the next page and the next API call are refused.
    for (let i = 0; i < limit - 2; i++)
      assert.equal(
        (await w.apiPost("/v1/registry/get", { urn: MAIN_TX })).status,
        200,
      );
    assert.equal((await w.get(MAIN_TX_PATH)).status, 200);
    assert.equal((await w.get("/lookup/?q=100+Main+Street")).status, 200);
    assert.equal(await w.usedToday(), limit);
    const refused = await w.get(MAIN_TX_PATH);
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get("retry-after")) > 0);
    assert.equal(refused.headers.get("cache-control"), "no-store");
    const html = await refused.text();
    const text = strip(html);
    assert.ok(text.includes("Today&#39;s free lookups are used up"));
    const reset = refused.headers.get("x-factlot-registry-quota-reset")!;
    assert.ok(text.includes(`They reset at ${reset}.`), reset);
    assert.ok(
      html.includes('<a href="/account#free-key">free key by email</a>'),
    );
    assert.ok(
      text.includes(
        `A Pro key gives ${PLANS.pro.registryLookupsPerMonth.toLocaleString("en-US")} registry lookups a month`,
      ),
    );
    assert.equal(
      (await w.get("/lookup/?q=500+Market+Street&state=TX")).status,
      429,
    );
    assert.equal(
      (await w.apiPost("/v1/registry/get", { urn: MAIN_TX })).status,
      429,
    );
    // Another address has its own allowance.
    assert.equal(
      (await w.get(MAIN_TX_PATH, { ip: "198.51.100.7" })).status,
      200,
    );
    assert.equal(await w.usedToday(), limit);
  });

  it("is limited per minute as every keyless request is", async () => {
    const w = world();
    let last = 200;
    for (let i = 0; i <= ANONYMOUS_REQUESTS_PER_MINUTE && last !== 429; i++)
      last = (await w.get("/lookup/?q=1+Nowhere+Rd&state=WA")).status;
    assert.equal(last, 429);
    const res = await w.get("/lookup/?q=1+Nowhere+Rd&state=WA");
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
    assert.ok(
      strip(await res.text()).includes("Too many requests this minute"),
    );
    assert.equal(await w.usedToday("198.51.100.9"), 0);
  });

  it("honours a key in the Authorization header as the API does, and never one in the address", async () => {
    const w = world();
    const key = await issue(w.kv);
    const res = await w.get(MAIN_TX_PATH, { key });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-factlot-tier"), "pro");
    assert.equal(
      res.headers.get("x-factlot-registry-quota-limit"),
      String(PLANS.pro.registryLookupsPerMonth),
    );
    assert.equal(
      res.headers.get("x-factlot-registry-quota-remaining"),
      String(PLANS.pro.registryLookupsPerMonth - 1),
    );
    assert.ok(
      strip(await res.text()).includes(
        "registry lookups left this month for this key",
      ),
    );
    // The key's month was charged, not the address's day.
    assert.equal(await w.usedToday(), 0);
    // A paid caller's JSON holds every roll year, as the API gives it to them.
    const json = (await (
      await w.get(`${MAIN_TX_PATH}?format=json`, { key })
    ).json()) as { value_history: unknown[]; history_withheld?: unknown };
    assert.ok(json.value_history.length > 1);
    assert.equal(json.history_withheld, undefined);
    // A rejected key is refused as the API refuses it.
    const bad = await w.get(MAIN_TX_PATH, { key: "fl_live_" + "x".repeat(43) });
    assert.equal(bad.status, 401);
    // A key in the address is never used: nothing is looked up, and it is not echoed.
    apiCalls.length = 0;
    for (const param of [
      "key",
      "api_key",
      "token",
      "access_token",
      "Authorization",
    ]) {
      const r = await w.get(`${MAIN_TX_PATH}?${param}=${key}`);
      assert.equal(r.status, 400, param);
      const body = await r.text();
      assert.ok(!body.includes(key), param);
      assert.ok(strip(body).includes("A key does not go in a page address"));
    }
    assert.deepEqual(apiCalls, []);
  });
});

describe("lookup pages: JSON for a program", () => {
  it("answers the API's own search and record answers, with its headers", async () => {
    const w = world();
    for (const how of [
      {
        path: "/lookup/?q=500+Market+Street&state=TX&format=json",
        accept: "text/html",
      },
      {
        path: "/lookup/?q=500+Market+Street&state=TX",
        accept: "application/json",
      },
    ]) {
      const res = await w.get(how.path, { accept: how.accept });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type")!, /^application\/json/);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("x-robots-tag"), "noindex");
      const viaApi = await w.apiPost(
        "/v1/registry/search_address",
        { address: "500 Market Street", state: "TX", limit: 20 },
        "198.51.100.3",
      );
      assert.deepEqual(await res.json(), await viaApi.json());
    }
    assert.equal(await w.usedToday(), 2);
    const rec = await w.get(`${MAIN_TX_PATH}?format=json`);
    const viaApi = await w.apiPost(
      "/v1/registry/get",
      { urn: MAIN_TX },
      "198.51.100.4",
    );
    assert.deepEqual(await rec.json(), await viaApi.json());
    assert.equal(
      rec.headers.get("x-factlot-registry-quota-remaining"),
      String(ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY - 3),
    );
    // A browser that accepts both gets the page.
    const page = await w.get(MAIN_TX_PATH, {
      accept: "text/html,application/xhtml+xml,application/json;q=0.9",
    });
    assert.match(page.headers.get("content-type")!, /^text\/html/);
    // The page names the JSON address in one line.
    assert.ok(
      (await page.text()).includes(
        `<a href="${MAIN_TX_PATH}?format=json" rel="nofollow"><code>${MAIN_TX_PATH}?format=json</code></a>`,
      ),
    );
    // A used-up allowance is the API's 429 body.
    for (let i = 0; i < ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY; i++)
      await w.get(`${MAIN_TX_PATH}?format=json`);
    const refused = await w.get(`${MAIN_TX_PATH}?format=json`);
    assert.equal(refused.status, 429);
    assert.equal(
      ((await refused.json()) as { code: string }).code,
      "RegistryQuotaExceeded",
    );
  });
});

describe("lookup pages: hostile input and privacy", () => {
  const HOSTILE = `"><script>alert(1)</script><img src=x onerror=alert(2)> ' & </title>`;

  it("writes the query into a page only escaped, wherever it lands", async () => {
    const w = world();
    for (const path of [
      `/lookup/?q=${encodeURIComponent(HOSTILE)}`,
      `/lookup/?q=${encodeURIComponent("100 Main Street")}&state=${encodeURIComponent(HOSTILE.slice(0, 40))}`,
      `/lookup/?q=${encodeURIComponent("999 Main Street " + HOSTILE)}&state=TX`,
      `/lookup/?q=${encodeURIComponent("100 Main Street")}&city=${encodeURIComponent(HOSTILE)}`,
      `/lookup/?q=x&format=${encodeURIComponent(HOSTILE)}`,
      `/lookup/${encodeURIComponent(HOSTILE)}`,
      `/lookup/us-48999/${encodeURIComponent(HOSTILE)}`,
    ]) {
      const res = await w.get(path);
      const html = await res.text();
      assert.doesNotMatch(html, /<script|<img|onerror=alert\(2\)>/i, path);
      assert.ok(!html.includes(HOSTILE) && !html.includes("</title> "), path);
      assert.equal(res.headers.get("referrer-policy"), "no-referrer", path);
      assert.equal(res.headers.get("cache-control"), "no-store", path);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
      assert.ok(!res.headers.get("location"), path);
    }
    // The form shows what was typed, escaped.
    const html = await (
      await w.get(`/lookup/?q=${encodeURIComponent('5 "Main" <St>')}&state=TX`)
    ).text();
    assert.ok(html.includes('value="5 &quot;Main&quot; &lt;St&gt;"'));
  });

  it("refuses any parameter named like a credential, whatever its spelling, and never echoes it", async () => {
    const w = world();
    const secret = "fl_live_abcdefSECRETvalue123";
    apiCalls.length = 0;
    for (const param of [
      "x-api-key",
      "api-key",
      "API_KEY",
      "apiKey",
      "access-token",
      "id_token",
      "client_secret",
      "secret",
      "auth",
      "x-authorization",
      "password",
      "passwd",
      "bearer",
    ])
      for (const path of [
        `/lookup/?q=1+Main&${param}=${secret}`,
        `/lookup/?q=1+Main&${param}=${secret}&format=json`,
        `${MAIN_TX_PATH}?${param}=${secret}`,
        `/lookup/?${param}=${secret}`,
      ]) {
        const r = await w.get(path);
        assert.equal(r.status, 400, path);
        const body = await r.text();
        assert.ok(!body.includes(secret) && !body.includes("SECRET"), path);
        assert.ok(!r.headers.get("location"), path);
        assert.equal(r.headers.get("referrer-policy"), "no-referrer", path);
      }
    assert.deepEqual(apiCalls, []);
    assert.equal(await w.usedToday(), 0);
  });

  it("builds a page's JSON link from the search's own parameters only", async () => {
    const w = world();
    const extra = "&utm_source=zzqq&ref=zzqq&format=html&page=zzqq";
    const list = await (
      await w.get(`/lookup/?q=500+Market+Street&state=TX${extra}`)
    ).text();
    assert.ok(!list.includes("zzqq"));
    assert.ok(
      list.includes(
        '<a href="/lookup/?q=500+Market+Street&amp;state=TX&amp;format=json" rel="nofollow">',
      ),
    );
    const miss = await (
      await w.get(
        `/lookup/?q=999+Main+Street&city=Example+City&zip=77002&county=48999&state=TX${extra}`,
      )
    ).text();
    assert.ok(!miss.includes("zzqq"));
    assert.ok(
      miss.includes(
        "/lookup/?q=999+Main+Street&amp;state=TX&amp;city=Example+City&amp;zip=77002&amp;county=48999&amp;format=json",
      ),
    );
    // A record's JSON link is its path and format=json, whatever else its address held.
    const rec = await (await w.get(`${MAIN_TX_PATH}?ref=zzqq`)).text();
    assert.ok(!rec.includes("zzqq"));
    assert.ok(rec.includes(`href="${MAIN_TX_PATH}?format=json"`));
    // Every link and form these pages write leads to /lookup/ with q and state at most.
    for (const html of [list, miss, rec])
      for (const [, href] of html.matchAll(
        /(?:href|action)="(\/lookup[^"]*)"/g,
      )) {
        const u = new URL(
          href!.replaceAll("&amp;", "&"),
          "https://factlot.com",
        );
        for (const k of u.searchParams.keys())
          assert.ok(
            ["q", "state", "city", "zip", "county", "format"].includes(k),
            href,
          );
      }
  });

  it("caps the query and the place fields before anything is looked up", async () => {
    const w = world();
    apiCalls.length = 0;
    const long = await w.get(`/lookup/?q=${"a".repeat(LOOKUP_MAX_QUERY + 1)}`);
    assert.equal(long.status, 400);
    assert.ok(!(await long.text()).includes("a".repeat(50)));
    for (const q of [
      `q=1+Main&state=${"x".repeat(41)}`,
      `q=1+Main&city=${"x".repeat(101)}`,
      `q=1+Main&zip=${"1".repeat(11)}`,
      `q=1+Main&county=${"1".repeat(6)}`,
    ])
      assert.equal((await w.get(`/lookup/?${q}`)).status, 400, q);
    assert.deepEqual(apiCalls, []);
    assert.equal(
      (await w.get(`/lookup/?q=${"a".repeat(LOOKUP_MAX_QUERY)}`)).status,
      200,
    );
  });

  it("is one path group in the usage counters, with no address or parcel in it", () => {
    for (const p of [
      "/lookup",
      "/lookup/",
      MAIN_TX_PATH,
      `/lookup/${MAIN_TX}`,
      "/lookup/us-48999/0001-000-0001/",
    ]) {
      const site = classifyPath(p, false, 200);
      assert.ok(site.group === "/lookup" || site.group === "/lookup/*", p);
      assert.equal(classifyPath(p, true, 200).group, "/lookup", p);
    }
  });

  it("refuses other methods, and on the API host points at the site's page", async () => {
    const w = world();
    const post = await w.get("/lookup/?q=1+Main", { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    const onApi = await w.get("/lookup/?q=100+Main+Street&state=TX", {
      host: "api.factlot.com",
    });
    assert.equal(onApi.status, 302);
    assert.equal(
      onApi.headers.get("location"),
      "https://factlot.com/lookup/?q=100+Main+Street&state=TX",
    );
    // The redirect carries the headers every lookup answer has.
    for (const res of [
      onApi,
      await w.get(MAIN_TX_PATH, { host: "api.factlot.com", method: "HEAD" }),
    ]) {
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(res.headers.get("x-robots-tag"), "noindex");
    }
    // A credential in the address is refused on the API host too, before any redirect, unechoed.
    const secret = "fl_live_abcdefSECRETvalue123";
    for (const param of ["key", "x-api-key", "api-key", "access_token"]) {
      for (const accept of ["text/html", "application/json"]) {
        const r = await w.get(`/lookup/?q=1+Main&${param}=${secret}`, {
          host: "api.factlot.com",
          accept,
        });
        assert.equal(r.status, 400, param);
        assert.equal(r.headers.get("location"), null, param);
        assert.equal(r.headers.get("referrer-policy"), "no-referrer", param);
        assert.equal(r.headers.get("cache-control"), "no-store", param);
        assert.equal(r.headers.get("x-robots-tag"), "noindex", param);
        assert.ok(!(await r.text()).includes("SECRET"), param);
      }
    }
    assert.equal(await w.usedToday(), 0);
  });
});
