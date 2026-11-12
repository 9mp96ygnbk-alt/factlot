// Live end-to-end check of the hosted service, as a new customer meets it.
//
//   node --experimental-strip-types scripts/e2e/hosted.ts
//
// Environment:
//   FACTLOT_E2E_URL       API base (default https://api.factlot.com)
//   FACTLOT_E2E_SITE      Site base (default https://factlot.com)
//   FACTLOT_E2E_DELAY_MS  Pause between API calls (default 1100, under the free 60/min limit)
//
// It replays every conformance vector (spec/vectors: calculators, rules, tools) against the
// hosted REST API with the vectors' own comparison rules, calls every MCP tool and checks the
// MCP answer is identical to the REST answer, and walks every public page and endpoint a
// visitor or agent would touch. Exit code 1 on any failure.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const API = (process.env.FACTLOT_E2E_URL ?? "https://api.factlot.com").replace(
  /\/+$/,
  "",
);
const SITE = (process.env.FACTLOT_E2E_SITE ?? "https://factlot.com").replace(
  /\/+$/,
  "",
);
const DELAY = Number(process.env.FACTLOT_E2E_DELAY_MS ?? 1100);
const root = fileURLToPath(new URL("../..", import.meta.url));

let passed = 0;
const failures: string[] = [];
const notes: string[] = [];
// What the hosted pack serves (site/_data/hosted.json, which scripts/site/gen-hosted.ts writes from the
// pack's manifest).
const HOSTED = JSON.parse(
  readFileSync(
    new URL("../../site/_data/hosted.json", import.meta.url),
    "utf8",
  ),
) as {
  totals: { parcels: number; entities: number; counties: number };
  withheld: { fips: string }[];
  partial: { fips: string; area: string }[];
};
// Real lookups in the hosted regions. Values come from the registry files the hosted pack is built
// from; update them when the pack is rebuilt.
const HOSTED_REGISTRY_CASES: {
  tool: string;
  arguments: Record<string, unknown>;
  expect?: Record<string, unknown>;
  /** Paths whose value must match the regular expression. */
  expect_match?: Record<string, string>;
  /** Fact predicates the answer's `facts` must carry, or must not carry. */
  has_predicates?: string[];
  no_predicates?: string[];
  expect_error?: string;
}[] = [
  {
    tool: "registry_coverage",
    arguments: {},
    expect: {
      "totals.parcels": HOSTED.totals.parcels,
      "totals.entities": HOSTED.totals.entities,
      "totals.counties": HOSTED.totals.counties,
      "hosted.withheld_counties.0.region": `us-${HOSTED.withheld[0]!.fips}`,
      // A county loaded in part (the City of Boston, in Suffolk County) is listed with its part.
      ...(HOSTED.partial.length
        ? {
            "hosted.partial_counties.0.region": `us-${HOSTED.partial[0]!.fips}`,
            "hosted.partial_counties.0.area": HOSTED.partial[0]!.area,
          }
        : {}),
    },
  },
  // Outside Texas the candidate tool is an input error (Texas-only), whatever regions are hosted.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-36061:1000010001" },
    expect_error: "InputError",
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-11001:02570824" },
    expect: { status: "current", kind: "parcel" },
  },
  {
    tool: "registry_resolve_parcel",
    arguments: { state_fips: "11", county_fips: "001", apn: "0257 0824" },
    expect: { urn: "fl:parcel:us-11001:02570824" },
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "dc_ssl", external_id: "0257 0824" },
    expect: { urn: "fl:parcel:us-11001:02570824" },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "1300 Pennsylvania Ave NW", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-11001:02570824" },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "100 Light St", limit: 2 },
    expect: { "results.0.urn": "fl:parcel:us-24510:0304110671-001" },
  },
  { tool: "registry_search_entities", arguments: { query: "LLC", limit: 5 } },
  {
    tool: "registry_owned_by",
    arguments: { entity_urn: "fl:entity:us-dc:c00008141728" },
  },
  // Texas. Values from the pack of 2026-11-10 (release-2026-11-10 tx.db with md.db, ut.db, dc.db;
  // Tarrant 48439 withheld): sixteen counties, Denton and Williamson 2027 preliminary rolls, the
  // Comptroller entities that own a hosted parcel. Expectations were computed with runTool on the
  // release copies.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48201:0180580000001" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 2748333,
    },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48201:0011440000001" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 303755215,
    },
  },
  // Brazos holds eleven roll years (2016 to 2026): value_history runs newest first.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48041:100022" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 1268807,
      "value_history.10.tax_year": 2016,
      "value_history.10.market_value": 521990,
    },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48041:100022" },
    expect: {
      "selection.tax_year": 2026,
      "selection.available_tax_years.0": 2026,
      "selection.available_tax_years.10": 2016,
      "selection.roll_sources.0": "tx-brazos-cad",
      "selection.returned": 38,
      "candidates.0.id": "fl:parcel:us-48041:96141",
      "sources.0.rights.attribution": "Brazos Central Appraisal District",
    },
  },
  // Midland: the parcel is held, its publisher's file has no values.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48329:r000000017" },
    expect: { status: "current", kind: "parcel" },
  },
  {
    tool: "registry_resolve_parcel",
    arguments: {
      state_fips: "48",
      county_fips: "113",
      apn: "00000100057000000",
    },
    expect: { urn: "fl:parcel:us-48113:00000100057000000" },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "1201 S Lamar Blvd", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-48453:100008" },
  },
  {
    tool: "registry_search_address",
    arguments: { query: "1706 W University Dr", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-48085:10000" },
  },
  {
    tool: "registry_search_entities",
    arguments: { query: "holdings", limit: 3 },
    expect: { "results.0.urn": "fl:entity:us-tx:0804844512" },
  },
  {
    tool: "registry_owned_by",
    arguments: { entity_urn: "fl:entity:us-tx:0000452810" },
    expect: { "results.0.urn": "fl:parcel:us-48453:126012" },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48201:0180580000001" },
    expect: {
      "selection.tax_year": 2026,
      "selection.roll_sources.0": "tx-harris-cad",
      "selection.building_class_sources.0": "tx-harris-cad-buildings",
      "selection.tiers.0.matched": 6,
      "selection.tiers.2.matched": 293,
      "selection.widened_to_county": true,
      "selection.returned": 50,
      "candidates.0.id": "fl:parcel:us-48201:0540160000008",
      "sources.0.rights.attribution": "Harris Central Appraisal District",
    },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: {
      urn: "fl:parcel:us-48201:0180580000001",
      area_band: 0.2,
      year_band: 10,
      limit: 5,
    },
    expect: {
      "selection.returned": 5,
      "candidates.0.id": "fl:parcel:us-48201:0540160000008",
    },
  },
  {
    tool: "registry_tx_equity_candidates",
    arguments: { county_fips: "113", apn: "00000100057000000" },
    expect: {
      "selection.tax_year": 2026,
      "selection.matched": 54,
      "selection.returned": 50,
      "candidates.0.id": "fl:parcel:us-48113:000010001301a0000",
    },
  },
  // Denton: a 2027 preliminary roll, compared in that year only.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48121:1002521" },
    expect: {
      "selection.tax_year": 2027,
      "selection.available_tax_years.0": 2027,
      "subject.value_history.0.tax_year": 2027,
      "selection.returned": 14,
      "candidates.0.id": "fl:parcel:us-48121:565139",
      "candidates.0.tax_year": 2027,
    },
  },
  // Tarrant is withheld: an input error from the candidate tool, a miss that says why elsewhere.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48439:00001234" },
    expect_error: "InputError",
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-48439:00001234" },
    expect_error: "NotFound",
  },
  // A Texas parcel the registry does not hold (residential): a coverage miss, not a failure.
  {
    tool: "registry_tx_equity_candidates",
    arguments: { urn: "fl:parcel:us-48201:1" },
    expect_error: "NotFound",
  },
  // New York City, Los Angeles County, San Francisco, the City of Boston, Denver and Connecticut. Values
  // from the registry files of release-2026-11-12 (national/ny.db, ca.db, ma.db, co.db, ct.db); the tools'
  // own answers were read with runTool on read-only copies.
  {
    tool: "registry_resolve_parcel",
    arguments: { state_fips: "36", county_fips: "061", apn: "1000020002" },
    expect: { urn: "fl:parcel:us-36061:1000020002" },
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "nyc_bbl", external_id: "1009941201" },
    expect: { urn: "fl:parcel:us-36061:1009941201" },
  },
  // A New York address with an ordinal: the file writes "214 WEST 42 STREET", the search matches "42nd".
  {
    tool: "registry_search_address",
    arguments: { query: "214 W 42nd St", limit: 3 },
    expect: { "results.0.urn": "fl:parcel:us-36061:1010130039" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-36061:1010130039" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2027,
      "value_history.0.market_value": 30444000,
    },
    has_predicates: ["ownership.owner_of_record"],
  },
  // Los Angeles County and San Francisco: the public files carry no owner names, so no owner fact.
  {
    tool: "registry_resolve_external",
    arguments: { system: "la_ain", external_id: "5151015013" },
    expect: { urn: "fl:parcel:us-06037:5151015013" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-06037:5151015013" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.appraised_value": 509842812,
    },
    has_predicates: ["parcel.situs_address"],
    no_predicates: ["ownership.owner_of_record"],
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-06075:0259026" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2025,
      "value_history.0.appraised_value": 1159518020,
    },
    no_predicates: ["ownership.owner_of_record"],
  },
  // The City of Boston: a hit, and a Suffolk County miss that says only the City is loaded.
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-25025:0401037100" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2026,
      "value_history.0.market_value": 564317600,
    },
  },
  {
    tool: "registry_resolve_parcel",
    arguments: { state_fips: "25", county_fips: "025", apn: "0000000000" },
    expect: { urn: null, "coverage.county_area": "the City of Boston" },
    expect_match: { "coverage.message": "for the City of Boston only" },
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "denver_schednum", external_id: "0234513035000" },
    expect: { urn: "fl:parcel:us-08031:0234513035000" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-08031:0234513035000" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.market_value": 16827500,
    },
    has_predicates: ["ownership.owner_of_record", "zoning.district"],
  },
  {
    tool: "registry_resolve_external",
    arguments: { system: "ct_cama_link", external_id: "37070-204534125" },
    expect: { urn: "fl:parcel:us-09003:37070-204534125" },
  },
  {
    tool: "registry_get",
    arguments: { urn: "fl:parcel:us-09003:37070-204534125" },
    expect: {
      status: "current",
      kind: "parcel",
      "value_history.0.tax_year": 2021,
      "value_history.0.market_value": 107600,
    },
    has_predicates: ["ownership.owner_of_record"],
  },
];

function ok(cond: unknown, label: string): void {
  if (cond) passed++;
  else failures.push(label);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// With FACTLOT_API_KEY set, every call (REST and MCP) carries the key: the suite then runs on that
// plan's quotas instead of the free tier's 25 registry lookups a day per address (several runs a
// day from one machine exhaust the free quota and every registry check answers 429).
const KEY = process.env.FACTLOT_API_KEY;
async function api(path: string, init?: RequestInit): Promise<Response> {
  await sleep(DELAY);
  if (!KEY) return fetch(`${API}${path}`, init);
  const headers = new Headers(init?.headers);
  if (!headers.has("authorization"))
    headers.set("authorization", `Bearer ${KEY}`);
  return fetch(`${API}${path}`, { ...init, headers });
}
async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}

// One unknown subject in a candidates batch: HTTP 200, the subject's own NotFound (with the
// coverage that says why) in results[0].error, and summary.errors counting it.
function batchMissShape(status: number, json: unknown): boolean {
  const o = (v: unknown) => typeof v === "object" && v !== null;
  return (
    status === 200 &&
    at(json, "results.0.error.error") === "NotFound" &&
    (o(at(json, "results.0.error.coverage")) || o(at(json, "coverage"))) &&
    at(json, "summary.errors") === 1
  );
}

const at = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      obj,
    );

function same(actual: unknown, expected: unknown, tol?: number): boolean {
  if (typeof expected === "number" && typeof actual === "number")
    return tol
      ? Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected))
      : actual === expected;
  // A vector's null means the field is absent, as in the unit tests.
  if (expected === null) return actual === undefined || actual === null;
  // Key order is not part of the contract.
  return isDeepStrictEqual(actual, expected);
}

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(`${root}/${rel}`, "utf8"));
}

interface Case {
  name?: string;
  input?: unknown;
  arguments?: unknown;
  tool?: string;
  expect?: Record<string, unknown>;
  expect_error?: boolean | string;
  tolerance?: number;
}

async function main(): Promise<void> {
  // --- 1. Pages a visitor sees ---------------------------------------------------------------
  for (const [path, type] of [
    ["/", "text/html"],
    ["/privacy", "text/html"],
    ["/terms", "text/html"],
    ["/status/", "text/html"],
    ["/security/", "text/html"],
    ["/sla/", "text/html"],
    ["/assurance/", "text/html"],
    ["/llms.txt", "text/plain"],
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "xml"],
    ["/styles.css", "text/css"],
  ] as const) {
    const res = await fetch(`${SITE}${path}`);
    ok(
      res.status === 200 &&
        (res.headers.get("content-type") ?? "").includes(type),
      `site ${path}: ${res.status} ${res.headers.get("content-type")}`,
    );
  }
  const home = await (await fetch(`${SITE}/`)).text();
  for (const needle of [
    'id="pricing"',
    "api.factlot.com/mcp",
    "billing/checkout?plan=pro",
    "/privacy",
    "/terms",
  ])
    ok(home.includes(needle), `home page mentions ${needle}`);
  // Every absolute link on the home page resolves (GitHub links included).
  const links = [
    ...new Set(
      [...home.matchAll(/href="(https:[^"#]+)"/g)].map((m) =>
        m[1]!.replaceAll("&amp;", "&"),
      ),
    ),
  ];
  for (const link of links) {
    if (link.includes("/billing/checkout")) continue; // covered below
    const res = await fetch(link, { method: "GET", redirect: "follow" });
    ok(res.status === 200, `link ${link}: ${res.status}`);
  }
  notes.push(`${links.length} home-page links checked`);
  const www = await fetch(SITE.replace("://", "://www."), {
    redirect: "manual",
  });
  ok(
    www.status === 301 && www.headers.get("location") === `${SITE}/`,
    `www redirect: ${www.status} ${www.headers.get("location")}`,
  );
  const nf = await fetch(`${SITE}/no-such-page`);
  ok(nf.status === 404, `unknown page is 404: ${nf.status}`);

  // --- 2. API discovery an agent does first --------------------------------------------------
  const rootDoc = (await (await api("/")).json()) as {
    mcp: string;
    plans: Record<string, unknown>;
  };
  ok(rootDoc.mcp === `${API}/mcp`, `API root advertises ${rootDoc.mcp}`);
  ok(
    rootDoc.plans && "pro" in rootDoc.plans && "team" in rootDoc.plans,
    "API root lists plans",
  );
  const health = (await (await api("/health")).json()) as {
    ok: boolean;
    version: string;
  };
  ok(health.ok, "health ok");
  notes.push(`server version ${health.version}`);
  const toolList = (await (await api("/v1/tools")).json()) as {
    tools: { name: string; path: string }[];
  };
  const pathOf = new Map(toolList.tools.map((t) => [t.name, t.path]));
  for (const doc of [
    "/openapi.json",
    "/openapi-3.0.json?operations=all",
    "/openapi-3.0.json",
  ]) {
    const o = (await (await api(doc)).json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      servers: { url: string }[];
    };
    const n = Object.keys(o.paths).length;
    // The plain 3.0 document is the Custom GPT Actions subset (at most 30 operations).
    ok(
      doc === "/openapi-3.0.json"
        ? n > 0 && n <= 30
        : n >= toolList.tools.length,
      `${doc}: ${n} paths for ${toolList.tools.length} tools`,
    );
    ok(
      o.servers?.[0]?.url === API,
      `${doc} servers url ${o.servers?.[0]?.url}`,
    );
  }
  const plans = await api("/v1/plans");
  ok(plans.status === 200, `/v1/plans ${plans.status}`);
  const plansDoc = (await plans.json().catch(() => ({}))) as {
    model_tools?: { available?: boolean };
    reports?: { available?: boolean; per_month?: Record<string, number> };
  };
  // Whether the hosted model-backed tools are on (ANTHROPIC_API_KEY set on the Worker).
  const modelOn = plansDoc.model_tools?.available === true;
  notes.push(`model-backed tools: ${modelOn ? "on" : "off"}`);
  ok(plansDoc.reports?.per_month, "/v1/plans lists reports per month");
  // Whether the deployer opened reports (REPORTS_ENABLED=true); closed, /v1/reports answers 503.
  const reportsOn = plansDoc.reports?.available !== false;
  notes.push(`reports: ${reportsOn ? "open" : "closed"}`);

  // OAuth sign-in for header-less clients: metadata, and the 401 challenge at /mcp/signin.
  for (const doc of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
  ]) {
    await sleep(DELAY);
    const r = await fetch(`${API}${doc}`);
    const j = (await r.json().catch(() => undefined)) as
      Record<string, unknown> | undefined;
    ok(
      r.status === 200 &&
        (doc.endsWith("protected-resource")
          ? Array.isArray(j?.authorization_servers)
          : typeof j?.token_endpoint === "string"),
      `${doc}: ${r.status} ${JSON.stringify(j).slice(0, 120)}`,
    );
  }
  await sleep(DELAY);
  const signin = await fetch(`${API}/mcp/signin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const challenge = signin.headers.get("www-authenticate") ?? "";
  ok(
    signin.status === 401 &&
      /^Bearer /.test(challenge) &&
      challenge.includes("resource_metadata="),
    `/mcp/signin without credentials: ${signin.status} ${challenge.slice(0, 120)}`,
  );
  const pre = await api("/mcp", {
    method: "OPTIONS",
    headers: {
      origin: "https://example.org",
      "access-control-request-method": "POST",
    },
  });
  ok(
    pre.status === 204 &&
      pre.headers.get("access-control-allow-origin") === "*",
    `CORS preflight ${pre.status}`,
  );
  const bad = await api("/v1/calc/irr", {
    method: "POST",
    headers: { authorization: "Bearer not-a-key" },
    body: "{}",
  });
  ok(bad.status === 401, `invalid key is 401: ${bad.status}`);

  // --- 3. Every conformance vector over REST -------------------------------------------------
  const restResults = new Map<string, unknown>(); // first successful result per tool, for MCP parity
  const restArgs = new Map<string, unknown>();
  const vectorFiles: [string, string][] = [
    // Vector files only: the folder also holds a reference implementation's subfolder.
    ...readdirSync(`${root}/spec/vectors/calc`)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ["calc", `spec/vectors/calc/${f}`] as [string, string]),
    ["rules", "spec/vectors/rules/tx_property_tax_protest_deadline.json"],
  ];
  let vectorCount = 0;
  for (const [, file] of vectorFiles) {
    const spec = readJson(file) as {
      calculator?: string;
      rule?: string;
      cases: Case[];
    };
    const id = spec.calculator ?? spec.rule ?? "";
    const tool = id.startsWith("calc.")
      ? `calc_${id.slice(5)}`
      : "rules_tx_property_tax_protest_deadline";
    const path = pathOf.get(tool);
    ok(path, `REST path for ${tool}`);
    if (!path) continue;
    for (const c of spec.cases) {
      vectorCount++;
      const label = `${tool} "${c.name ?? ""}"`;
      const { status, json } = await post(path, c.input);
      if (c.expect_error) {
        ok(status === 400, `${label}: expected an input error, got ${status}`);
        continue;
      }
      ok(
        status === 200,
        `${label}: HTTP ${status} ${JSON.stringify(json).slice(0, 200)}`,
      );
      if (status !== 200) continue;
      for (const [k, v] of Object.entries(c.expect ?? {}))
        ok(
          same(at(json, k), v, c.tolerance),
          `${label} ${k}: got ${JSON.stringify(at(json, k))}, want ${JSON.stringify(v)}`,
        );
      if (!restResults.has(tool)) {
        restResults.set(tool, json);
        restArgs.set(tool, c.input);
      }
    }
  }
  // Whether this deployment serves the registry (a registry service bound to the Worker).
  const hostedRegistry =
    (await post("/v1/registry/coverage", {})).status === 200;
  notes.push(
    hostedRegistry ? "hosted registry: served" : "hosted registry: not bound",
  );
  // The batch candidates vector whose only subject is outside the hosted regions: its REST answer,
  // kept for the MCP check.
  let batchMiss: { args: unknown; json: unknown } | undefined;
  const toolsSpec = readJson("spec/vectors/tools.json") as { cases: Case[] };
  for (const c of toolsSpec.cases) {
    vectorCount++;
    const tool = c.tool!;
    const label = `${tool} ${JSON.stringify(c.arguments).slice(0, 80)}`;
    const path = pathOf.get(tool);
    if (!path) {
      ok(
        c.expect_error,
        `${label}: no REST route but the vector expects success`,
      );
      continue;
    }
    const { status, json } = await post(path, c.arguments);
    if (tool.startsWith("registry_") && !c.expect_error) {
      // These vectors are written against a test registry file, not the hosted regions. With a
      // registry service, the hosted answer is a result or a NotFound that carries coverage;
      // without one, it must say clearly that no registry is loaded.
      const error = (json as { error?: string })?.error;
      ok(
        hostedRegistry
          ? status === 200 || (status === 404 && error === "NotFound")
          : status === 503 && error === "RegistryUnavailable",
        `${label}: hosted registry answer ${status} ${error ?? ""}`,
      );
      continue;
    }
    if (
      hostedRegistry &&
      tool === "registry_tx_equity_candidates_batch" &&
      c.expect_error === "RegistryUnavailable"
    ) {
      // A batch never fails as a whole for a coverage miss: it answers 200 and gives the subject
      // its own NotFound (with coverage), counted under summary.errors.
      ok(
        batchMissShape(status, json),
        `${label}: want 200 with results.0.error NotFound, got ${status} ${JSON.stringify(json).slice(0, 160)}`,
      );
      if (status === 200 && batchMiss === undefined)
        batchMiss = { args: c.arguments, json };
      continue;
    }
    if (c.expect_error) {
      // A registry vector that expects "no registry loaded" gets a NotFound with coverage from a
      // deployment that serves the registry.
      const want =
        hostedRegistry && c.expect_error === "RegistryUnavailable"
          ? "NotFound"
          : c.expect_error;
      ok(
        status >= 400 && (json as { error?: string })?.error === want,
        `${label}: want ${want}, got ${status} ${JSON.stringify(json).slice(0, 120)}`,
      );
      continue;
    }
    ok(status === 200, `${label}: HTTP ${status}`);
    for (const [k, v] of Object.entries(c.expect ?? {}))
      ok(
        same(at(json, k), v),
        `${label} ${k}: got ${JSON.stringify(at(json, k))}`,
      );
    if (status === 200 && !restResults.has(tool)) {
      restResults.set(tool, json);
      restArgs.set(tool, c.arguments);
    }
  }
  // Hosted registry regions (registry_coverage lists them): one real lookup per tool, with
  // values read from the source files. These also give the MCP section its registry inputs.
  if (hostedRegistry)
    for (const c of HOSTED_REGISTRY_CASES) {
      vectorCount++;
      const label = `hosted ${c.tool} ${JSON.stringify(c.arguments).slice(0, 80)}`;
      const { status, json } = await post(pathOf.get(c.tool)!, c.arguments);
      if (c.expect_error) {
        ok(
          status >= 400 &&
            (json as { error?: string })?.error === c.expect_error,
          `${label}: want ${c.expect_error}, got ${status}`,
        );
        continue;
      }
      ok(status === 200, `${label}: HTTP ${status}`);
      for (const [k, v] of Object.entries(c.expect ?? {}))
        ok(
          same(at(json, k), v),
          `${label} ${k}: got ${JSON.stringify(at(json, k))}`,
        );
      for (const [k, re] of Object.entries(c.expect_match ?? {}))
        ok(
          new RegExp(re).test(String(at(json, k))),
          `${label} ${k}: got ${JSON.stringify(at(json, k))}`,
        );
      const predicates = new Set(
        ((at(json, "facts") as { predicate?: string }[] | undefined) ?? []).map(
          (f) => f.predicate,
        ),
      );
      for (const p of c.has_predicates ?? [])
        ok(predicates.has(p), `${label}: no ${p} fact`);
      for (const p of c.no_predicates ?? [])
        ok(!predicates.has(p), `${label}: has a ${p} fact`);
      if (status === 200 && !restResults.has(c.tool)) {
        restResults.set(c.tool, json);
        restArgs.set(c.tool, c.arguments);
      }
    }
  // The Texas batch tools: two items, two subjects. The rule answers both; the candidates batch
  // answers each subject or gives it its own error (a coverage miss where Texas is not hosted), so
  // only the shape is checked.
  {
    const tool = "rules_tx_property_tax_protest_deadline_batch";
    const args = {
      items: [
        { id: "a", tax_year: 2026, notice_delivered_date: "2026-05-01" },
        { id: "b", tax_year: 2027 },
      ],
    };
    const { status, json } = await post(
      pathOf.get(tool) ?? "/v1/rules/tx_property_tax_protest_deadline/batch",
      args,
    );
    const v = at(json, "value") as
      | { results?: { id?: string }[]; summary?: { answered?: number } }
      | undefined;
    ok(
      status === 200 &&
        v?.results?.map((r) => r.id).join() === "a,b" &&
        v.summary?.answered === 2,
      `${tool}: ${status} ${JSON.stringify(json).slice(0, 160)}`,
    );
    if (status === 200 && !restResults.has(tool)) {
      restResults.set(tool, json);
      restArgs.set(tool, args);
    }
  }
  {
    const tool = "registry_tx_equity_candidates_batch";
    const args = {
      subjects: [
        { id: "a", urn: "fl:parcel:us-48201:1" },
        { id: "b", county_fips: "113", apn: "1" },
      ],
    };
    const { status, json } = await post(
      pathOf.get(tool) ?? "/v1/registry/tx_equity_candidates/batch",
      args,
    );
    const b = json as
      | {
          error?: string;
          results?: Record<string, unknown>[];
          summary?: { subjects?: number; answered?: number; errors?: number };
          rule?: unknown;
          notice?: unknown;
        }
      | undefined;
    if (!hostedRegistry)
      ok(
        status === 503 && b?.error === "RegistryUnavailable",
        `${tool} without a registry: ${status} ${b?.error}`,
      );
    else {
      const each = (b?.results ?? []).every(
        (r) =>
          (typeof r.error === "object" && r.error !== null) ||
          Array.isArray(r.candidates),
      );
      ok(
        status === 200 &&
          b?.results?.map((r) => r.id).join() === "a,b" &&
          each &&
          b.summary?.subjects === 2 &&
          (b.summary.answered ?? 0) + (b.summary.errors ?? 0) === 2 &&
          typeof b.rule === "string" &&
          typeof b.notice === "string",
        `${tool}: ${status} ${JSON.stringify(json).slice(0, 160)}`,
      );
      if (status === 200 && !restResults.has(tool)) {
        restResults.set(tool, json);
        restArgs.set(tool, args);
      }
    }
  }
  // The model-backed tools: without a key 403 PlanRequired while they are on (503
  // ModelUnavailable while they are off); with FACTLOT_API_KEY, an answer or 503.
  const modelCalls: [string, unknown][] = [
    [
      "/v1/doc/extract_lease",
      {
        document: {
          pages: [
            "1.2 Term. The Term shall commence on March 1, 2026 and shall expire on June 30, 2031.",
          ],
        },
        predicates: ["lease.expiration_date"],
      },
    ],
    [
      "/v1/report/narrative",
      {
        tool: "calc_irr",
        input: { cash_flows: [-100, 10, 10, 110] },
        audience: "summary",
      },
    ],
  ];
  for (const [path, body] of modelCalls) {
    await sleep(DELAY);
    const anon = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const anonError = (
      (await anon.json().catch(() => ({}))) as { error?: string }
    ).error;
    ok(
      modelOn
        ? anon.status === 403 && anonError === "PlanRequired"
        : anon.status === 503 && anonError === "ModelUnavailable",
      `${path} without a key: ${anon.status} ${anonError}`,
    );
    if (KEY) {
      const { status, json } = await post(path, body);
      const r = json as Record<string, unknown> | undefined;
      ok(
        status === 503
          ? r?.error === "ModelUnavailable"
          : status === 200 &&
              r?.nothing_stored === true &&
              (path.endsWith("extract_lease")
                ? Array.isArray(r.facts)
                : typeof r.text === "string"),
        `${path} with a key: ${status} ${JSON.stringify(json).slice(0, 160)}`,
      );
    }
  }
  // Reports: one Texas evidence workbook from the calculator vector, and its download. A report
  // counts against reports a month (3 free per address); a used-up month is noted, not failed,
  // on the free tier. Created reports answer 201. Reports are open on api.factlot.com; a
  // deployment that has them closed (/v1/plans reports.available false) answers 503
  // ReportsUnavailable: noted, not failed.
  {
    const vector = readJson("spec/vectors/calc/tx_unequal_appraisal.json") as {
      cases: Case[];
    };
    const input = vector.cases.find((c) => !c.expect_error)!.input;
    const { status, json } = await post("/v1/reports", {
      kind: "tx_unequal_appraisal",
      format: "xlsx",
      arguments: input,
    });
    const r = json as
      | {
          download_url?: string;
          expires_at?: string;
          bytes?: number;
          sha256?: string;
          content_type?: string;
          error?: string;
        }
      | undefined;
    const XLSX =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!reportsOn) {
      ok(
        status === 503 && r?.error === "ReportsUnavailable",
        `report_create xlsx while reports are closed: ${status} ${JSON.stringify(json).slice(0, 160)}`,
      );
      notes.push("report_create: reports closed: noted");
    } else if (status === 429 && !KEY)
      notes.push(
        `report_create: free reports used up this month (${r?.error})`,
      );
    else {
      ok(
        status === 201 &&
          typeof r?.download_url === "string" &&
          typeof r.expires_at === "string" &&
          typeof r.bytes === "number" &&
          typeof r.sha256 === "string" &&
          r.content_type === XLSX,
        `report_create xlsx: ${status} ${JSON.stringify(json).slice(0, 160)}`,
      );
      if (status === 201 && r?.download_url) {
        await sleep(DELAY);
        const file = await fetch(r.download_url);
        const bytes = new Uint8Array(await file.arrayBuffer());
        ok(
          file.status === 200 &&
            (file.headers.get("content-type") ?? "").startsWith(XLSX) &&
            bytes[0] === 0x50 &&
            bytes[1] === 0x4b,
          `report download: ${file.status} ${file.headers.get("content-type")}`,
        );
      }
    }
  }
  // Lease-comp vectors (spec/vectors/lease_comps.json, lease_comp_search.json): same case shape
  // as tools.json.
  const compCases = ["lease_comps.json", "lease_comp_search.json"].flatMap(
    (f) => (readJson(`spec/vectors/${f}`) as { cases: Case[] }).cases,
  );
  for (const c of compCases) {
    vectorCount++;
    const tool = c.tool!;
    const label = `${tool} ${JSON.stringify(c.arguments).slice(0, 80)}`;
    const path = pathOf.get(tool);
    if (!path) {
      ok(false, `${label}: no REST route`);
      continue;
    }
    const { status, json } = await post(path, c.arguments);
    const wantError = (c as { expect_error?: string }).expect_error;
    if (wantError) {
      ok(
        status === 400 && at(json, "error") === wantError,
        `${label}: want ${wantError}, got HTTP ${status} ${JSON.stringify(at(json, "error"))}`,
      );
      continue;
    }
    ok(status === 200, `${label}: HTTP ${status}`);
    for (const [k, v] of Object.entries(c.expect ?? {}))
      ok(
        same(at(json, k), v),
        `${label} ${k}: got ${JSON.stringify(at(json, k))}`,
      );
    if (status === 200 && !restResults.has(tool)) {
      restResults.set(tool, json);
      restArgs.set(tool, c.arguments);
    }
  }
  // Document-verification vectors: pages are written once under `documents` and referenced as
  // {"$pages": name}; resolve them the way packages/tools/src/documents.test.ts does.
  const docSpec = readJson("spec/vectors/documents.json") as {
    documents: Record<string, string[]>;
    cases: Case[];
  };
  const resolvePages = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(resolvePages);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.$pages === "string") return docSpec.documents[o.$pages];
      return Object.fromEntries(
        Object.entries(o).map(([k, x]) => [k, resolvePages(x)]),
      );
    }
    return v;
  };
  for (const c of docSpec.cases) {
    vectorCount++;
    const tool = c.tool!;
    const args = resolvePages(c.arguments);
    const label = `${tool} ${JSON.stringify(c.arguments).slice(0, 80)}`;
    const path = pathOf.get(tool);
    if (!path) {
      ok(false, `${label}: no REST route`);
      continue;
    }
    const { status, json } = await post(path, args);
    if (c.expect_error) {
      ok(
        status >= 400 && (json as { error?: string })?.error === c.expect_error,
        `${label}: want ${c.expect_error}, got ${status} ${JSON.stringify(json).slice(0, 120)}`,
      );
      continue;
    }
    ok(status === 200, `${label}: HTTP ${status}`);
    for (const [k, v] of Object.entries(c.expect ?? {}))
      ok(
        same(at(json, k), v),
        `${label} ${k}: got ${JSON.stringify(at(json, k))}`,
      );
    if (status === 200 && !restResults.has(tool)) {
      restResults.set(tool, json);
      restArgs.set(tool, args);
    }
  }
  notes.push(`${vectorCount} conformance vectors replayed over REST`);

  // --- 4. Every MCP tool, and MCP = REST ------------------------------------------------------
  // The REST section runs close to the free tier's 60 a minute; the MCP handshake sends several
  // requests at once, so start it in a fresh rate window.
  await sleep(Math.max(DELAY, 61_000));
  const client = new Client({ name: "factlot-hosted-e2e", version: "1.0.0" });
  // With FACTLOT_API_KEY set, MCP carries the key as well (registry tools are metered here too).
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`${API}/mcp`),
      KEY
        ? { requestInit: { headers: { authorization: `Bearer ${KEY}` } } }
        : {},
    ),
  );
  await sleep(DELAY * 2);
  const { tools } = await client.listTools();
  notes.push(`${tools.length} MCP tools listed`);
  const extra: Record<string, unknown> = {
    search: { query: "CAM cap non-cumulative" },
    fetch: { id: "tool:calc_cam_reconciliation" },
    schema_get: {},
    // Hosted account tools: listed only for a key, so these inputs are used only then.
    account_status: {},
    account_usage: { days: 7 },
  };
  // Hosted-only tools that need a key. Without one they are not listed (or answer PlanRequired /
  // ModelUnavailable, which the REST section above already checks): skipped with a note.
  const keyOnly = new Set([
    "account_status",
    "account_usage",
    "doc_extract_lease",
    "report_narrative",
  ]);
  // The model-backed tools cost real model calls: one each per run, with a key.
  const modelMcp: Record<string, Record<string, unknown>> = {
    report_narrative: {
      tool: "calc_debt_sizing",
      input: {
        noi: 1000000,
        value: 15000000,
        rate_annual: 0.065,
        amortization_years: 30,
        max_ltv: 0.65,
        min_dscr: 1.25,
      },
      audience: "summary",
      max_words: 80,
    },
    doc_extract_lease: {
      document: {
        pages: [
          "SYNTHETIC TEST LEASE. 2.1 Term. The Term shall commence on March 1, 2026 (the Commencement Date) and shall expire on June 30, 2031. 3.1 Base Rent. Tenant shall pay Base Rent at the annual rate of $36.00 per rentable square foot from March 1, 2026 through June 30, 2031.",
        ],
      },
      predicates: [
        "lease.commencement_date",
        "lease.expiration_date",
        "lease.base_rent_schedule",
      ],
    },
  };
  // Tools whose only hosted input is a coverage miss: MCP must report it as a tool error.
  const mcpMiss = new Map(
    HOSTED_REGISTRY_CASES.filter((c) => c.expect_error).map((c) => [
      c.tool,
      c.arguments,
    ]),
  );
  for (const t of tools) {
    // report_create: an input error is free, so the check spends no report.
    if (t.name === "report_create") {
      await sleep(DELAY);
      const r = (await client.callTool({
        name: t.name,
        arguments: { kind: "no_such_kind", format: "xlsx" },
      })) as { isError?: boolean; content: { type: string; text: string }[] };
      ok(
        r.isError && /error/i.test(r.content?.[0]?.text ?? ""),
        `MCP report_create: want an input error, got ${r.content?.[0]?.text?.slice(0, 160)}`,
      );
      continue;
    }
    const miss = hostedRegistry ? mcpMiss.get(t.name) : undefined;
    if (miss && !restArgs.has(t.name)) {
      await sleep(DELAY);
      const r = (await client.callTool({ name: t.name, arguments: miss })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      ok(
        r.isError && /NotFound/.test(r.content?.[0]?.text ?? ""),
        `MCP ${t.name}: want a NotFound tool error, got ${r.content?.[0]?.text?.slice(0, 160)}`,
      );
      continue;
    }
    if (keyOnly.has(t.name) && !KEY) {
      notes.push(`MCP ${t.name}: skipped (needs FACTLOT_API_KEY)`);
      continue;
    }
    if (modelMcp[t.name]) {
      // The model may be off (503 ModelUnavailable) or rate-limited (429 ModelRateLimited, or a
      // used-up allowance): those are tool errors, accepted. An answer must have its shape.
      await sleep(DELAY);
      const r = (await client.callTool({
        name: t.name,
        arguments: modelMcp[t.name]!,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      const text = r.content?.[0]?.text ?? "";
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // checked below
      }
      if (r.isError) {
        const accepted = [
          "ModelUnavailable",
          "ModelRateLimited",
          "IngestQuotaExceeded",
          "NarrativeQuotaExceeded",
        ];
        ok(
          accepted.includes(String(body.error)),
          `MCP ${t.name}: tool error ${text.slice(0, 160)}`,
        );
        notes.push(`MCP ${t.name}: ${String(body.error)}: noted`);
      } else
        ok(
          body.nothing_stored === true &&
            (t.name === "doc_extract_lease"
              ? Array.isArray(body.facts) && Array.isArray(body.needs_review)
              : typeof body.text === "string"),
          `MCP ${t.name}: ${text.slice(0, 160)}`,
        );
      continue;
    }
    const args = restArgs.get(t.name) ?? extra[t.name];
    if (args === undefined) {
      failures.push(`MCP ${t.name}: no test input (add a vector)`);
      continue;
    }
    await sleep(DELAY);
    const r = (await client.callTool({
      name: t.name,
      arguments: args as Record<string, unknown>,
    })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    ok(
      !r.isError,
      `MCP ${t.name}: isError ${r.content?.[0]?.text?.slice(0, 160)}`,
    );
    if (r.isError) continue;
    const text = r.content?.[0]?.text ?? "";
    if (restResults.has(t.name)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      ok(
        JSON.stringify(parsed) === JSON.stringify(restResults.get(t.name)),
        `MCP ${t.name}: answer differs from REST`,
      );
    } else if (t.name === "account_status" || t.name === "account_usage") {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      ok(
        t.name === "account_status"
          ? typeof at(body, "model_tools") === "object" &&
              typeof at(body, "reports") === "object"
          : typeof at(body, "month.used") === "number" &&
              typeof at(body, "month.limit") === "number",
        `MCP ${t.name}: unexpected answer ${text.slice(0, 160)}`,
      );
    } else ok(text.length > 20, `MCP ${t.name}: empty answer`);
    // The candidates batch with one unknown subject: MCP gives the same answer as REST (a result
    // with the subject's own NotFound, not a tool error).
    if (t.name === "registry_tx_equity_candidates_batch" && batchMiss) {
      await sleep(DELAY);
      const m = (await client.callTool({
        name: t.name,
        arguments: batchMiss.args as Record<string, unknown>,
      })) as { isError?: boolean; content: { type: string; text: string }[] };
      let mb: unknown;
      try {
        mb = JSON.parse(m.content?.[0]?.text ?? "");
      } catch {
        mb = undefined;
      }
      ok(
        !m.isError &&
          batchMissShape(200, mb) &&
          JSON.stringify(mb) === JSON.stringify(batchMiss.json),
        `MCP ${t.name} unknown subject: ${m.content?.[0]?.text?.slice(0, 160)}`,
      );
    }
  }
  await client.close();

  // --- 5. Paying: checkout as a person and as an agent ------------------------------------------
  const page = await fetch(`${SITE}/billing/checkout?plan=pro`, {
    redirect: "manual",
  });
  const agentCheckout = await post("/v1/billing/checkout", { plan: "pro" });
  if (page.status === 303) {
    ok(
      (page.headers.get("location") ?? "").startsWith(
        "https://checkout.stripe.com/",
      ),
      `checkout redirects to Stripe: ${page.headers.get("location")?.slice(0, 40)}`,
    );
    ok(
      agentCheckout.status === 200 &&
        String((agentCheckout.json as { url?: string }).url).startsWith(
          "https://checkout.stripe.com/",
        ),
      `agent checkout returns a Stripe URL: ${agentCheckout.status}`,
    );
    notes.push("billing OPEN: checkout reaches Stripe");
  } else {
    ok(
      page.status === 503 &&
        (await page.text()).includes("contact@factlot.com"),
      `checkout page while billing is closed: ${page.status}`,
    );
    ok(
      agentCheckout.status === 503,
      `agent checkout while billing is closed: ${agentCheckout.status}`,
    );
    notes.push(
      "billing CLOSED: no STRIPE_SECRET_KEY yet (checkout says so with a contact address)",
    );
  }
  const badPlan = await post("/v1/billing/checkout", { plan: "gold" });
  ok(badPlan.status === 400, `unknown plan is 400: ${badPlan.status}`);
  const success = await fetch(
    `${SITE}/billing/success?session_id=cs_live_<script>`,
  );
  const successText = await success.text();
  ok(
    success.status === 400 || success.status === 503,
    `bad success link: ${success.status}`,
  );
  ok(!successText.includes("<script>"), "success page escapes its input");

  // --- Report -------------------------------------------------------------------------------
  for (const n of notes) console.log(`note: ${n}`);
  for (const f of failures) console.log(`FAIL: ${f}`);
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
