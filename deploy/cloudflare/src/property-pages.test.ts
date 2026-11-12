// Property pages end to end: the API Worker's routes (property-pages.ts) over the real registry Worker
// (deploy/registry/src/worker.ts) answering from a small synthetic pack written to a temp directory.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";

import { fileAssets } from "../../registry/src/file_assets.ts";
import {
  ShardEncoder,
  decodeEntry,
  decodeEntryField,
  type EncodedShard,
} from "../../registry/src/format.ts";
import {
  SourceIndex,
  propertyPath,
  urnOfPropertyPath,
} from "../../registry/src/page-rules.ts";
import { handle as registryHandle } from "../../registry/src/worker.ts";

import { page } from "./pages.ts";
import {
  CACHE_MISS,
  CACHE_OK,
  PROPERTY_PAGES_PER_MINUTE,
  PROPERTY_PAGE_CSP,
  SITEMAP_INDEX_PATH,
  ownerNamesAPerson,
  propertyPagesRoute,
  resetPropertyPagesState,
  type CacheLike,
  type PagesEnv,
} from "./property-pages.ts";
import { handle } from "./router.ts";
import { CO_DISCLAIMER } from "./source-notices.ts";
import type { Fetcher, MeterService } from "./types.ts";

// --- a synthetic pack ------------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const DOC_DC = `fl:document:sha256-${"a".repeat(64)}`;
const DOC_DC_ENT = `fl:document:sha256-${"b".repeat(64)}`;
const DOC_TX = `fl:document:sha256-${"c".repeat(64)}`;
const DOC_DEN = `fl:document:sha256-${"d".repeat(64)}`;
const DOC_CO_ENT = `fl:document:sha256-${"e".repeat(64)}`;
const DOC_TAR = `fl:document:sha256-${"f".repeat(64)}`;
const DOC_ACRIS = `fl:document:sha256-${"1".repeat(64)}`;

const RIGHTS: Record<string, Rec> = {
  [DOC_DC]: {
    ai_use: "permitted",
    redistribution: "permitted",
    license: "Public domain (DC Open Data)",
    attribution: "Office of Tax and Revenue <b>DC</b>",
  },
  [DOC_DC_ENT]: {
    ai_use: "permitted",
    redistribution: "attribution_required",
    license: "CC-BY-4.0",
    attribution: "DC Department of Licensing and Consumer Protection",
  },
  [DOC_TX]: {
    ai_use: "unknown",
    redistribution: "unknown",
    license: "Public record; no licence stated",
    attribution: "Harris Central Appraisal District",
  },
  [DOC_DEN]: {
    ai_use: "unknown",
    redistribution: "attribution_required",
    license: "CC BY 3.0",
    attribution: "City and County of Denver",
  },
  [DOC_CO_ENT]: {
    ai_use: "unknown",
    redistribution: "attribution_required",
    license: "Colorado open data terms",
    attribution: "Colorado Secretary of State",
  },
  [DOC_TAR]: {
    ai_use: "permitted",
    redistribution: "permitted",
    license: "test",
  },
  [DOC_ACRIS]: {
    ai_use: "unknown",
    redistribution: "permitted",
    license: "NYC Open Data terms",
    attribution: "New York City Department of Finance, ACRIS",
  },
};
const TITLES: Record<string, string> = {
  [DOC_DC]:
    "DC Office of Tax and Revenue: Integrated Tax System Public Extract (itspe.csv)",
  [DOC_DC_ENT]: "DC DLCP: Corporate Registrations (corps.csv)",
  [DOC_TX]:
    "Harris Central Appraisal District: Real and personal property (real_acct.txt)",
  [DOC_DEN]: "City and County of Denver: Real property (parcels.csv)",
  [DOC_CO_ENT]: "Colorado Secretary of State: Business entities (entities.csv)",
  [DOC_TAR]: "Tarrant Appraisal District: roll (roll.txt)",
  [DOC_ACRIS]:
    "New York City Department of Finance: ACRIS Real Property Legals (acris-legals-2026.csv)",
};

let factN = 0;
function fact(
  subject: string,
  predicate: string,
  value: unknown,
  doc: string,
  asOf: string,
  unit?: string,
): Rec {
  const f: Rec = {
    id: `flf_${String(++factN).padStart(24, "0")}`,
    subject,
    predicate,
    value,
    as_of: asOf,
    provenance: {
      method: "public_record",
      sources: [
        {
          document_id: doc,
          title: TITLES[doc],
          uri: "https://example.gov/data",
          retrieved_at: `${asOf}T00:00:00+00:00`,
          section: `row ${subject.split(":").pop()}`,
        },
      ],
    },
    rights: RIGHTS[doc],
  };
  if (unit) f.unit = unit;
  return f;
}

interface ParcelSpec {
  urn: string;
  doc: string;
  asOf: string;
  address?: string;
  apn?: string;
  owner?: string;
  entity?: string;
  values?: { year: number; market: number; appraised: number }[];
  /** Recorded sales and documents: [predicate, value, document]. */
  recorded?: [string, Rec, string][];
}

function parcel(p: ParcelSpec): Rec {
  const facts: Rec[] = [];
  const add = (pred: string, v: unknown, unit?: string) =>
    facts.push(fact(p.urn, pred, v, p.doc, p.asOf, unit));
  if (p.owner) add("ownership.owner_mailing_address", "PO BOX 1, SOMEWHERE");
  if (p.owner) add("ownership.owner_of_record", p.owner);
  add("parcel.apn", p.apn ?? p.urn.split(":").pop());
  add("parcel.improvement_area_sf", 47934, "sf");
  add("parcel.land_area_sf", 197762.4, "sf");
  add("parcel.state_property_category", "F1");
  if (p.address) add("parcel.situs_address", p.address);
  add("parcel.year_built", 1977);
  for (const [pred, v, doc] of p.recorded ?? [])
    facts.push(fact(p.urn, pred, v, doc, p.asOf));
  const values = p.values ?? [];
  const current = values[0];
  const valueFacts: Record<string, Rec> = {};
  if (current) {
    add("parcel.tax_year", current.year);
    facts.push(
      (valueFacts.market_value = fact(
        p.urn,
        "parcel.market_value",
        current.market,
        p.doc,
        p.asOf,
        "USD",
      )),
    );
    facts.push(
      (valueFacts.appraised_value = fact(
        p.urn,
        "parcel.appraised_value",
        current.appraised,
        p.doc,
        p.asOf,
        "USD",
      )),
    );
  }
  const cite = (field: string, i: number) => ({
    fact_id: i === 0 ? valueFacts[field]!.id : `flf_old${i}${field}`,
    document_id: p.doc,
    locator: `row ${p.urn.split(":").pop()}`,
    as_of: p.asOf,
  });
  return {
    urn: p.urn,
    kind: "parcel",
    short: "flp_x",
    label: p.address ?? p.urn,
    status: "current",
    facts,
    relationships: p.entity
      ? [
          {
            from_urn: p.entity,
            type: "owns",
            to_urn: p.urn,
            as_of: p.asOf,
            method: "inferred",
            confidence: 0.9,
            document_id: p.doc,
          },
        ]
      : [],
    crosswalk: [],
    building: null,
    value_history: values.map((v, i) => ({
      tax_year: v.year,
      market_value: v.market,
      appraised_value: v.appraised,
      as_of: p.asOf,
      citations: {
        market_value: cite("market_value", i),
        appraised_value: cite("appraised_value", i),
      },
    })),
    warnings: [],
  };
}

function entityRec(urn: string, name: string, doc: string, asOf: string): Rec {
  return {
    urn,
    kind: "entity",
    short: "fle_x",
    label: name,
    status: "current",
    facts: [
      fact(urn, "entity.legal_name", name, doc, asOf),
      fact(urn, "entity.registry_number", urn.split(":").pop(), doc, asOf),
    ],
    relationships: [],
    crosswalk: [],
    warnings: [],
  };
}

const P1 = "fl:parcel:us-11001:p1";
const P2 = "fl:parcel:us-11001:p2";
const P3 = "fl:parcel:us-11001:p3";
const P4 = "fl:parcel:us-11001:p4";
const P5 = "fl:parcel:us-11001:p5";
const D1 = "fl:parcel:us-08031:d1";
const T1 = "fl:parcel:us-48201:t1";
const W1 = "fl:parcel:us-48439:w1";
const E1 = "fl:entity:us-dc:e1";
const C1 = "fl:entity:us-co:c1";

/** P2's recorded sales and documents: the 2026 deed is the newest; the rest are for Pro and Team. */
const P2_RECORDED: [string, Rec, string][] = [
  [
    "transaction.deed",
    {
      date: "2026-03-10",
      doc_type: "DEED",
      doc_type_description: "DEED",
      amount_usd: 3030303,
      document_id: "2026031000777001",
      grantors: ["SHOWN GRANTOR LLC"],
      grantors_withheld: { count: 1, kinds: ["estate"] },
      grantees: [],
      grantees_withheld: { count: 2, kinds: ["personal trust"] },
      organizations_only: true,
    },
    DOC_ACRIS,
  ],
  [
    "debt.mortgage_recorded",
    {
      date: "2024-07-01",
      doc_type: "MTGE",
      amount_usd: 8181818,
      document_id: "2024070100888002",
      lenders: ["HIDDEN LENDER BANK"],
      organizations_only: true,
    },
    DOC_ACRIS,
  ],
  ["transaction.sale", { date: "2015-05-05", price_usd: 8282828 }, DOC_ACRIS],
];

/** Values: the current year first. The earlier years' figures must never reach a page. */
const P1_VALUES = [
  { year: 2026, market: 1010101, appraised: 1020202 },
  { year: 2025, market: 7777777, appraised: 7676767 },
  { year: 2024, market: 6666666, appraised: 6565656 },
];

function buildPack(builtAt = "2026-11-12T12:00:00.000Z"): string {
  const dir = mkdtempSync(join(tmpdir(), "factlot-property-pages-"));
  const subjects: Record<number, [string, Rec][]> = { 0: [], 1: [] };
  const put = (db: number, r: Rec, o?: Rec) =>
    subjects[db]!.push([
      r.urn as string,
      { k: db, r, v: [0], ...(o ? { o } : {}) },
    ]);
  put(
    0,
    parcel({
      urn: P1,
      doc: DOC_DC,
      asOf: "2026-11-02",
      address: "900 G ST NW WASHINGTON DC 20001",
      apn: "0376 0068",
      owner: "G STREET HOLDINGS LLC",
      entity: E1,
      values: P1_VALUES,
    }),
  );
  put(
    0,
    parcel({
      urn: P2,
      doc: DOC_DC,
      asOf: "2026-11-02",
      address: "1 SECOND ST NW",
      values: [P1_VALUES[0]!],
      recorded: P2_RECORDED,
    }),
  );
  put(
    0,
    parcel({ urn: P3, doc: DOC_DC, asOf: "2026-11-02", apn: "0003 0003" }),
  );
  put(
    0,
    parcel({
      urn: P4,
      doc: DOC_DC,
      asOf: "2026-11-02",
      address: "4 PERSON OWNED AVE",
      values: [P1_VALUES[0]!],
      // A roll's single latest sale, from a source not recorded as republishable: not shown.
      recorded: [
        [
          "transaction.sale",
          { date: "2020-02-02", price_usd: 5151515 },
          DOC_TX,
        ],
      ],
    }),
  );
  put(
    0,
    parcel({
      urn: P5,
      doc: DOC_DC,
      asOf: "2026-11-02",
      address: '<script>alert(1)</script> 5 MAIN ST "quoted" & more',
      apn: '"><img src=x onerror=alert(1)>',
      owner: "</td><script>alert(2)</script> LLC",
    }),
  );
  put(
    0,
    parcel({
      urn: D1,
      doc: DOC_DEN,
      asOf: "2026-10-01",
      address: "1801 CALIFORNIA ST",
      owner: "CALIFORNIA TOWER LLC",
      entity: C1,
      values: [{ year: 2026, market: 5000000, appraised: 4000000 }],
    }),
  );
  put(0, entityRec(E1, "G STREET HOLDINGS LLC", DOC_DC_ENT, "2026-11-02"), {
    results: [P1, P2, P3].map((urn) => ({
      urn,
      label: urn,
      confidence: 0.9,
      as_of: "2026-11-02",
      building: null,
    })),
    buildings: [],
  });
  put(0, entityRec(C1, "CALIFORNIA TOWER LLC", DOC_CO_ENT, "2026-10-01"), {
    results: [
      {
        urn: D1,
        label: "x",
        confidence: 0.9,
        as_of: "2026-10-01",
        building: null,
      },
    ],
    buildings: [],
  });
  put(
    1,
    parcel({
      urn: T1,
      doc: DOC_TX,
      asOf: "2026-11-01",
      address: "1221 MCKINNEY ST, HOUSTON TX 77010",
      values: [{ year: 2026, market: 9, appraised: 9 }],
    }),
  );
  put(
    1,
    parcel({
      urn: W1,
      doc: DOC_TAR,
      asOf: "2026-11-01",
      address: "1 WITHHELD ST, FORT WORTH TX",
    }),
  );

  for (const db of [0, 1]) {
    const enc = new ShardEncoder();
    for (const [k, v] of subjects[db]!) enc.add(k, v);
    mkdirSync(join(dir, "g", String(db)), { recursive: true });
    writeFileSync(
      join(dir, "g", String(db), "0.json"),
      JSON.stringify(enc.encode()),
    );
  }
  const counties = [
    {
      region: "us-11001",
      state_fips: "11",
      county_fips: "001",
      state: "DC",
      name: "District of Columbia",
      parcels: 5,
      buildings: 0,
      sources: [{ source_id: "dc-otr-real-property", as_of: "2026-11-02" }],
    },
    {
      region: "us-08031",
      state_fips: "08",
      county_fips: "031",
      state: "CO",
      name: "Denver County",
      parcels: 1,
      buildings: 0,
      sources: [{ source_id: "co-denver-assessor", as_of: "2026-10-01" }],
    },
    {
      region: "us-48201",
      state_fips: "48",
      county_fips: "201",
      state: "TX",
      name: "Harris County",
      parcels: 1,
      buildings: 0,
      sources: [{ source_id: "tx-harris-cad", as_of: "2026-11-01" }],
    },
    {
      region: "us-48439",
      state_fips: "48",
      county_fips: "439",
      state: "TX",
      name: "Tarrant County",
      parcels: 1,
      buildings: 0,
      sources: [{ source_id: "tx-tarrant-cad", as_of: "2026-11-01" }],
    },
  ];
  const coverage = {
    counties: counties.map((c) => {
      const { name, ...rest } = c;
      void name;
      return rest;
    }),
    entity_registries: [
      {
        jurisdiction: "us-dc",
        entities: 1,
        sources: [{ source_id: "dc-dlcp-entities", as_of: "2026-11-02" }],
      },
      {
        jurisdiction: "us-co",
        entities: 1,
        sources: [{ source_id: "co-sos-entities", as_of: "2026-10-01" }],
      },
    ],
    crosswalk_systems: [],
    totals: {
      parcels: 8,
      entities: 2,
      buildings: 0,
      counties: 4,
      states: ["CO", "DC", "TX"],
    },
  };
  const manifest = {
    format: 2,
    built_at: builtAt,
    dbs: [
      {
        name: "fx",
        parcel_rule: "2",
        dates: [],
        shards: 1,
        parcels: 6,
        entities: 2,
        buildings: 0,
        subjects: 8,
      },
      {
        name: "tx",
        parcel_rule: "2",
        dates: [],
        shards: 1,
        parcels: 2,
        entities: 0,
        buildings: 0,
        subjects: 2,
      },
    ],
    prefixes: {
      "fl:parcel:us-11001": 0,
      "fl:parcel:us-08031": 0,
      "fl:entity:us-dc": 0,
      "fl:entity:us-co": 0,
      "fl:parcel:us-48201": 1,
      "fl:parcel:us-48439": 1,
    },
    counties: { "us-11001": 0, "us-08031": 0, "us-48201": 1, "us-48439": 1 },
    versions: { name_key_version: "2", address_key_version: "2" },
    coverage,
    coverage_result: { ...coverage, counties },
    crosswalk_shards: 1,
    address_shards: 1,
    names: {
      rows: 0,
      posting_max: 8000,
      gram_buckets: 1,
      exact_buckets: 1,
      label_chunks: 1,
    },
    withheld: { "48439": "withheld for the test" },
    entity_scope: {},
    equity: {
      docs: [
        [
          DOC_TX,
          {
            document_id: DOC_TX,
            source_id: "tx-harris-cad",
            rights: RIGHTS[DOC_TX],
          },
        ],
      ],
      pools: 0,
    },
    counts: { parcels: 8 },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

// --- the API Worker's side ------------------------------------------------------------------------

const PACK = buildPack();

interface Harness {
  env: PagesEnv;
  registryCalls: string[];
  meterCalls: unknown[][];
  cache: CacheLike & { store: Map<string, Response> };
}

function harness(
  vars: Partial<PagesEnv> = {},
  opts: { limitOk?: boolean; pack?: string } = {},
): Harness {
  const registryCalls: string[] = [];
  const meterCalls: unknown[][] = [];
  const assets = fileAssets(opts.pack ?? PACK);
  const registry: Fetcher = {
    async fetch(r: Request) {
      const u = new URL(r.url);
      const body = r.method === "POST" ? await r.clone().text() : "";
      registryCalls.push(`${u.pathname}${u.search} ${body.slice(0, 80)}`);
      return registryHandle(r, { ASSETS: assets });
    },
  };
  const meter = {
    async hit(...args: unknown[]) {
      meterCalls.push(args);
      return { ok: opts.limitOk ?? true, granted: 0 };
    },
  } as unknown as MeterService;
  const site: Fetcher = {
    async fetch(r: Request) {
      const p = new URL(r.url).pathname;
      if (p === "/robots.txt")
        return new Response(
          "User-agent: *\nAllow: /\n\nSitemap: https://factlot.com/sitemap.xml\n",
          {
            headers: { "content-type": "text/plain" },
          },
        );
      return new Response("<!doctype html><title>Not found</title>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    },
  };
  const store = new Map<string, Response>();
  const cache = {
    store,
    async match(req: Request) {
      return store.get(req.url)?.clone();
    },
    async put(req: Request, res: Response) {
      store.set(req.url, res);
    },
  };
  const env = {
    REGISTRY: registry,
    METER: meter,
    ASSETS: site,
    SITE_URL: "https://factlot.com",
    IP_HASH_SALT: "salt",
    PROPERTY_PAGES_ENABLED: "true",
    ...vars,
  } as unknown as PagesEnv;
  return { env, registryCalls, meterCalls, cache };
}

async function get(
  h: Harness,
  path: string,
  method = "GET",
): Promise<Response> {
  const req = new Request(`https://factlot.com${path}`, {
    method,
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  const res = await propertyPagesRoute(req, h.env, path.replace(/\/+$/, ""), {
    cache: h.cache,
  });
  assert.ok(res, `${path} is a property-pages route`);
  return res;
}

const P1_PATH = "/property/us-11001/p1";

beforeEach(() => resetPropertyPagesState());

describe("property pages: URLs", () => {
  it("map a parcel URN to /property/<region>/<id> and back", () => {
    assert.equal(
      propertyPath("fl:parcel:us-36061:1010130039"),
      "/property/us-36061/1010130039",
    );
    assert.equal(
      urnOfPropertyPath("/property/us-49023/xxa00x2dx0021x2dx12"),
      "fl:parcel:us-49023:xxa00x2dx0021x2dx12",
    );
    assert.equal(propertyPath("fl:entity:us-dc:e1"), null);
    assert.equal(urnOfPropertyPath("/property/us-11001/P1"), null);
    assert.equal(urnOfPropertyPath("/property/us-11001/p1/extra"), null);
  });
});

describe("property pages: a permitted-source parcel", () => {
  it("renders its facts, owner, entity, values and every citation", async () => {
    const h = harness();
    const res = await get(h, P1_PATH);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(
      html,
      /<title>900 G ST NW WASHINGTON DC 20001 · District of Columbia, DC · FactLot<\/title>/,
    );
    assert.match(
      html,
      /<link rel="canonical" href="https:\/\/factlot.com\/property\/us-11001\/p1" \/>/,
    );
    assert.doesNotMatch(html, /noindex/);
    assert.ok(html.includes("0376 0068"), "parcel ID");
    assert.ok(html.includes("F1"));
    assert.ok(html.includes("197,762 sq ft"));
    assert.ok(html.includes("47,934 sq ft"));
    assert.ok(html.includes("1977"));
    // Owner of record, the linked entity, and the other parcels of the entity (p3 has no address).
    assert.ok(
      html.includes(
        '<th scope="row">Owner of record</th><td>G STREET HOLDINGS LLC</td>',
      ),
    );
    assert.match(
      html,
      /Registered entity<\/th><td>G STREET HOLDINGS LLC<br><span class="small">registry us-dc \(DC\)/,
    );
    assert.match(html, /Other hosted parcels of this entity<\/th><td>2<ul/);
    assert.ok(
      html.includes('<a href="/property/us-11001/p2">1 SECOND ST NW</a>'),
    );
    assert.ok(
      html.includes('<a href="/property/us-11001/p3">Parcel 0003 0003</a>'),
    );
    // Current roll values, labelled as the publisher's roll figures with year and as-of.
    assert.ok(html.includes("$1,010,101"));
    assert.ok(html.includes("$1,020,202"));
    assert.ok(
      html.includes(
        "figure from the publisher&#39;s 2026 roll, as of 2026-11-02",
      ),
    );
    // Citations: title, publisher, locator, as-of, licence, attribution (escaped as recorded).
    assert.ok(
      html.includes(
        "DC Office of Tax and Revenue: Integrated Tax System Public Extract (itspe.csv)",
      ),
    );
    assert.ok(
      html.includes(
        '<th scope="row">Publisher</th><td>DC Office of Tax and Revenue</td>',
      ),
    );
    assert.ok(html.includes("row p1, as of 2026-11-02"));
    assert.ok(html.includes("Public domain (DC Open Data)"));
    assert.ok(html.includes("Office of Tax and Revenue &lt;b&gt;DC&lt;/b&gt;"));
    assert.ok(
      html.includes("<code>dc-otr-real-property</code>"),
      "source id from coverage",
    );
    assert.ok(
      html.includes("DC Department of Licensing and Consumer Protection"),
      "entity citation",
    );
    assert.ok(html.includes("CC-BY-4.0"));
    // Links and the standing line.
    for (const href of ["/coverage/", "/try/", "/mcp-server/", "/pricing/"])
      assert.ok(html.includes(`href="${href}"`), href);
    assert.ok(
      html.includes(
        "is not an appraisal or an opinion of value, not legal or tax advice",
      ),
    );
    assert.ok(html.includes("contact@factlot.com"));
    // The mailing address is never shown.
    assert.ok(!html.includes("PO BOX 1"));
    assert.ok(!/<script/i.test(html), "no script at all");
  });

  it("never shows a withheld value, only the counts of what a Pro or Team key adds", async () => {
    const h = harness();
    const html = await (await get(h, P1_PATH)).text();
    for (const v of [7777777, 7676767, 6666666, 6565656]) {
      assert.ok(!html.includes(String(v)), `${v} absent`);
      assert.ok(
        !html.includes(new Intl.NumberFormat("en-US").format(v)),
        `${v} formatted absent`,
      );
    }
    assert.ok(!html.includes("flf_old"), "no withheld citation ids");
    assert.match(html, /What a Pro or Team key adds for this parcel/);
    assert.ok(html.includes("2 earlier roll years, 2024 and 2025"));
  });

  it("shows the newest recorded sale or deed as recorded, the withheld-party counts from markers only, and counts of the rest", async () => {
    const h = harness();
    const html = await (await get(h, "/property/us-11001/p2")).text();
    assert.match(html, /<h2 id="sale">Latest recorded sale<\/h2>/);
    assert.ok(html.includes("Date recorded</th><td>2026-03-10</td>"));
    assert.ok(html.includes("Price as recorded</th><td>$3,030,303</td>"));
    assert.ok(html.includes("Document type</th><td>DEED, DEED</td>"));
    assert.ok(
      html.includes(
        "Party names withheld</th><td>grantors: 1 withheld (estate); grantees: 2 withheld (personal trust)</td>",
      ),
    );
    assert.ok(!html.includes("SHOWN GRANTOR"), "no party name on the page");
    assert.ok(html.includes("New York City Department of Finance, ACRIS"));
    assert.ok(
      html.includes(
        "1 more recorded sale, 2015, and 1 recorded mortgage, 2024: each with its date",
      ),
    );
    for (const v of [
      "8181818",
      "8,181,818",
      "8282828",
      "8,282,828",
      "HIDDEN LENDER",
      "2024070100888002",
      "2024-07-01",
      "2015-05-05",
    ])
      assert.ok(!html.includes(v), `${v} absent`);
    assert.doesNotMatch(html, /valuation|comparable/i);
    assert.ok(!/<script/i.test(html), "no script at all");
  });

  it("shows no sale whose source is not recorded as republishable, and no note for a single sale", async () => {
    const h = harness();
    const html = await (await get(h, "/property/us-11001/p4")).text();
    assert.ok(!html.includes('id="sale"'));
    assert.ok(!html.includes("5151515") && !html.includes("5,151,515"));
    assert.ok(!html.includes("recorded sale,"));
  });

  it("shows no owner section for a parcel with no owner fact (a person-owned parcel)", async () => {
    const h = harness();
    const res = await get(h, "/property/us-11001/p4");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      !/owner/i.test(html.replace(/opinion|own system|owned/gi, "")),
      "no owner wording",
    );
    assert.ok(!html.includes("Registered entity"));
    assert.ok(!html.includes('id="owner"'));
  });

  it("escapes every publisher string (an address holding <script> is inert)", async () => {
    const h = harness();
    const res = await get(h, "/property/us-11001/p5");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!/<script/i.test(html));
    assert.ok(!html.includes("<img"));
    assert.ok(
      html.includes(
        "&lt;script&gt;alert(1)&lt;/script&gt; 5 MAIN ST &quot;quoted&quot; &amp; more",
      ),
    );
    assert.ok(html.includes("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(
      html.includes("&lt;/td&gt;&lt;script&gt;alert(2)&lt;/script&gt; LLC"),
    );
  });

  it("marks a parcel without a situs address noindex", async () => {
    const h = harness();
    const res = await get(h, "/property/us-11001/p3");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<meta name="robots" content="noindex" \/>/);
  });

  it("shows the notices a source requires: Denver's credit and the State of Colorado disclaimer", async () => {
    const h = harness();
    const html = await (await get(h, "/property/us-08031/d1")).text();
    assert.ok(
      html.includes(
        "City and County of Denver&quot;, from the Denver Open Data Catalog",
      ) ||
        html.includes(
          '"City and County of Denver", from the Denver Open Data Catalog',
        ),
    );
    assert.ok(html.includes(CO_DISCLAIMER.slice(0, 80)));
    assert.ok(html.includes("<code>co-denver-assessor</code>"));
    assert.ok(html.includes("<code>co-sos-entities</code>"));
    // A DC page carries neither.
    const dc = await (await get(harness(), P1_PATH)).text();
    assert.ok(!dc.includes("Denver Open Data Catalog"));
    assert.ok(!dc.includes("STATE OF COLORADO"));
  });
});

describe("property pages: an owner written like a person's estate or trust", () => {
  // Invented names. The registry's rule reads these as organisations; a page must not show them.
  const hidden = [
    "ESTATE OF PAT EXAMPLE",
    "Example Pat Est Of",
    "PAT EXAMPLE LIFE ESTATE",
    "HEIRS OF PAT EXAMPLE",
    "PAT EXAMPLE LIVING TRUST",
    "EXAMPLE PAT REVOCABLE TRUST",
    "EXAMPLE PAT & LEE IRREV TR",
    "THE EXAMPLE FAMILY TRUST",
    "EXAMPLE HOLDINGS LLC PAT EXAMPLE REV LIV TR DTD 4-27-17",
    "EXAMPLE TRUST DTD 1/2/2003",
    "EXAMPLE TRUST U/A 5-5-99",
    "PAT EXAMPLE TRUSTEE",
    "EXAMPLE PAT TR",
    "PAT EXAMPLE & LEE EXAMPLE TTEES",
    "TRUSTEES FOR PAT EXAMPLE",
    "EXAMPLE TRUST COMPANY CO-TRUSTEES OF PAT EXAMPLE",
  ];
  const shown = [
    "EXAMPLE HOLDINGS LLC",
    "EXAMPLE REAL ESTATE INVESTMENT TRUST",
    "EXAMPLE REALTY TRUST INC",
    "BOARD OF TRUSTEES OF EXAMPLE VILLAGE",
    "TRUSTEES OF EXAMPLE UNIVERSITY",
    "TRUSTEES OF THE EXAMPLE PENSION FUND",
    "EXAMPLE ESTATES LLC",
    "REAL ESTATE OF EXAMPLE STREET LP",
    "EXAMPLE TRUCK CENTER INC",
    "EXAMPLE BANK NA",
  ];
  for (const name of hidden)
    it(`hides "${name}"`, () => assert.equal(ownerNamesAPerson(name), true));
  for (const name of shown)
    it(`shows "${name}"`, () => assert.equal(ownerNamesAPerson(name), false));
});

describe("property pages: which parcels get a page", () => {
  it("an unknown-redistribution source is 404 until PROPERTY_PAGES_EXTRA_SOURCES lists it", async () => {
    const path = "/property/us-48201/t1";
    assert.equal((await get(harness(), path)).status, 404);
    assert.equal(
      (
        await get(
          harness({ PROPERTY_PAGES_EXTRA_SOURCES: "tx-dallas-cad" }),
          path,
        )
      ).status,
      404,
    );
    const ok = await get(
      harness({ PROPERTY_PAGES_EXTRA_SOURCES: "tx-dallas-cad, tx-harris-cad" }),
      path,
    );
    assert.equal(ok.status, 200);
    assert.ok((await ok.text()).includes("<code>tx-harris-cad</code>"));
  });

  it("a withheld county is 404 even when its source is permitted or listed", async () => {
    const h = harness({ PROPERTY_PAGES_EXTRA_SOURCES: "tx-tarrant-cad" });
    const res = await get(h, "/property/us-48439/w1");
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes("WITHHELD ST"));
    assert.ok(
      !h.registryCalls.some((c) => c.includes("us-48439")),
      "the registry is not even asked",
    );
  });

  it("a parcel the pack does not hold is 404", async () => {
    assert.equal((await get(harness(), "/property/us-11001/nope")).status, 404);
  });

  it("with PROPERTY_PAGES_ENABLED off, every route is left to the site (404) and robots.txt is unchanged", async () => {
    for (const enabled of [undefined, "false", "TRUE", "1"]) {
      const h = harness({ PROPERTY_PAGES_ENABLED: enabled });
      for (const path of [
        P1_PATH,
        SITEMAP_INDEX_PATH,
        "/sitemaps/properties/fx-0.xml",
        "/robots.txt",
      ]) {
        const req = new Request(`https://factlot.com${path}`);
        assert.equal(
          await propertyPagesRoute(req, h.env, path, { cache: null }),
          undefined,
        );
        const res = await handle(req, h.env, {
          fetch: async () => new Response("api"),
        });
        if (path === "/robots.txt") {
          assert.equal(res.status, 200);
          assert.ok(!(await res.text()).includes("/sitemaps/"));
        } else assert.equal(res.status, 404, `${path} with ${enabled}`);
      }
      assert.equal(h.registryCalls.length, 0);
    }
  });

  it("is served through the router on the site host, not on the API host", async () => {
    const h = harness();
    const site = await handle(
      new Request(`https://factlot.com${P1_PATH}/`),
      h.env,
      { fetch: async () => new Response("api") },
    );
    assert.equal(site.status, 200);
    assert.match(site.headers.get("content-type") ?? "", /text\/html/);
    const api = await handle(
      new Request(`https://api.factlot.com${P1_PATH}`),
      h.env,
      {
        fetch: async () => new Response("{}", { status: 404 }),
      },
    );
    assert.notEqual(
      api.headers.get("content-security-policy"),
      PROPERTY_PAGE_CSP,
    );
  });
});

describe("property pages: sitemaps", () => {
  async function childUrls(h: Harness, path: string): Promise<string[]> {
    const res = await get(h, path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/xml/);
    return [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => m[1]!,
    );
  }

  it("list exactly the eligible parcels with an address, from the enumeration", async () => {
    const h = harness();
    const index = await childUrls(h, SITEMAP_INDEX_PATH);
    assert.deepEqual(index, [
      "https://factlot.com/sitemaps/properties/fx-0.xml",
    ]);
    const urls = await childUrls(h, "/sitemaps/properties/fx-0.xml");
    assert.deepEqual(
      urls,
      [D1, P1, P2, P4, P5].map((u) => `https://factlot.com${propertyPath(u)}`),
    );
    // Every listed URL renders 200 and indexable; the excluded ones do not.
    for (const u of urls) {
      const res = await get(h, new URL(u).pathname);
      assert.equal(res.status, 200, u);
      assert.doesNotMatch(await res.text(), /noindex/);
    }
    const xml = await (await get(h, "/sitemaps/properties/fx-0.xml")).text();
    assert.match(
      xml,
      /<url><loc>https:\/\/factlot.com\/property\/us-11001\/p1<\/loc><lastmod>2026-11-02<\/lastmod><\/url>/,
    );
    assert.equal((await get(h, "/sitemaps/properties/tx-0.xml")).status, 404);
    assert.equal((await get(h, "/sitemaps/properties/fx-1.xml")).status, 404);
  });

  it("add a listed source's parcels, never a withheld county's", async () => {
    const h = harness({
      PROPERTY_PAGES_EXTRA_SOURCES: "tx-harris-cad,tx-tarrant-cad",
    });
    const index = await childUrls(h, SITEMAP_INDEX_PATH);
    assert.deepEqual(index, [
      "https://factlot.com/sitemaps/properties/fx-0.xml",
      "https://factlot.com/sitemaps/properties/tx-0.xml",
    ]);
    assert.deepEqual(await childUrls(h, "/sitemaps/properties/tx-0.xml"), [
      `https://factlot.com${propertyPath(T1)}`,
    ]);
  });

  it("are named in robots.txt when the pages are on", async () => {
    const h = harness();
    const req = new Request("https://factlot.com/robots.txt");
    const res = await handle(req, h.env, {
      fetch: async () => new Response("api"),
    });
    const body = await res.text();
    assert.ok(body.includes("Sitemap: https://factlot.com/sitemap.xml"));
    assert.ok(
      body.endsWith("Sitemap: https://factlot.com/sitemaps/properties.xml\n"),
    );
  });
});

describe("property pages: cost and abuse", () => {
  it("are cacheable, keyed on the pack, and a cached view reads nothing from the registry", async () => {
    const h = harness();
    const first = await get(h, P1_PATH);
    assert.equal(first.headers.get("cache-control"), CACHE_OK);
    assert.equal(
      (await get(h, "/property/us-11001/nope")).headers.get("cache-control"),
      CACHE_MISS,
    );
    const keys = [...h.cache.store.keys()];
    assert.ok(
      keys.some((k) => k.includes("pack=2026-11-12T12%3A00%3A00.000Z")),
    );
    const firstHtml = await first.text();
    const calls = h.registryCalls.length;
    const again = await get(h, P1_PATH);
    assert.equal(again.status, 200);
    assert.equal(await again.text(), firstHtml);
    // Only the pack version is read again once its 60-second memo is reset; here it is still fresh.
    assert.equal(h.registryCalls.length, calls, "served from the cache");
    // A new pack is a new key.
    resetPropertyPagesState();
    const h2 = harness({}, { pack: buildPack("2026-11-13T00:00:00.000Z") });
    await get(h2, P1_PATH);
    assert.ok(
      [...h2.cache.store.keys()].some((k) => k.includes("pack=2026-11-13")),
    );
  });

  it("count no registry lookup: the meter is hit once per view, under its own subject, with no quota", async () => {
    const h = harness();
    await get(h, P1_PATH);
    await get(h, SITEMAP_INDEX_PATH);
    assert.equal(h.meterCalls.length, 2);
    for (const c of h.meterCalls) {
      assert.match(String(c[0]), /^pages:ip:[0-9a-f]{32}$/);
      assert.ok(!String(c[0]).includes("203.0.113.9"));
      assert.equal(c[1], PROPERTY_PAGES_PER_MINUTE);
      assert.equal(c[2], undefined, "no lookup quota");
    }
  });

  it("answer 429 with Retry-After beyond the per-address limit, before reading the registry", async () => {
    const h = harness({}, { limitOk: false });
    const res = await get(h, P1_PATH);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
    assert.equal(h.registryCalls.length, 0);
  });

  it("answer HEAD like GET without a body, and refuse other methods", async () => {
    const h = harness();
    const head = await get(h, P1_PATH, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(
      head.headers.get("content-security-policy"),
      PROPERTY_PAGE_CSP,
    );
    const post = await get(h, P1_PATH, "POST");
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
  });

  it("send a strict CSP, and the existing pages' CSP is unchanged", async () => {
    const res = await get(harness(), P1_PATH);
    assert.equal(
      res.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    const csp = page("t", "<p>x</p>").headers.get("content-security-policy")!;
    assert.equal(
      csp.replace(/'nonce-[A-Za-z0-9_-]+'/g, "'nonce-N'"),
      "default-src 'none'; style-src 'self' 'nonce-N'; img-src 'self'; script-src 'nonce-N'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
  });
});

describe("registry pages helpers", () => {
  it("decodeEntryField gives the same record as decoding the whole entry", async () => {
    const shard = JSON.parse(
      await (await fileAssets(PACK).fetch("https://x/g/0/0.json")).text(),
    ) as EncodedShard;
    for (const key of Object.keys(shard.e))
      assert.deepEqual(
        decodeEntryField(shard, key, "r"),
        (decodeEntry(shard, key) as { r: unknown }).r,
      );
    assert.equal(
      decodeEntryField(shard, "fl:parcel:us-11001:none", "r"),
      undefined,
    );
  });

  it("SourceIndex reads a document's source from a manifest map, the Texas docs, or a county's one source", () => {
    const idx = new SourceIndex({
      documents: { "doc:m": "from-map" },
      coverage: {
        counties: [
          {
            region: "us-11001",
            sources: [
              { source_id: "a", as_of: "2026-11-02" },
              { source_id: "b", as_of: "2026-11-04" },
            ],
          },
          {
            region: "us-24001",
            sources: [{ source_id: "md", as_of: "2026-11-05" }],
          },
        ],
      },
      equity: {
        docs: [
          [
            "doc:t",
            { source_id: "tx-x", rights: { redistribution: "unknown" } },
          ],
        ],
      },
    });
    const at = (document_id: string, subject: string, as_of = "") =>
      idx.sourceOf({ document_id, subject, as_of });
    assert.equal(at("doc:m", "fl:parcel:us-11001:x"), "from-map");
    assert.equal(at("doc:t", "fl:parcel:us-48201:x"), "tx-x");
    assert.equal(at("doc:?", "fl:parcel:us-24001:x"), "md");
    assert.equal(at("doc:?", "fl:parcel:us-11001:x", "2026-11-04"), "b");
    assert.equal(at("doc:?", "fl:parcel:us-11001:x", "2026-01-01"), null);
    assert.equal(idx.redistribution.get("tx-x"), "unknown");
  });
});
