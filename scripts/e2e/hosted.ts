// Live end-to-end check of the hosted service, as a new customer meets it.
//
//   node --experimental-strip-types scripts/e2e/hosted.ts
//
// Environment and flags:
//   FACTLOT_E2E_URL         API base (default https://api.factlot.com)
//   FACTLOT_E2E_SITE        Site base (default https://factlot.com)
//   FACTLOT_E2E_DELAY_MS    Pause between API calls (default 1100, under the free 60/min limit)
//   FACTLOT_API_KEY         Run on that key's plan and quotas instead of the free tier's (never printed)
//   --no-reports, or FACTLOT_E2E_NO_REPORTS=1
//                           Skip every call that builds a report or calls a model-backed tool (with a key these
//                           spend the key's reports and model allowance); the keyless checks that they answer
//                           PlanRequired still run, since those spend nothing
//
// It prints up front how many registry lookups, reports and model calls the run will spend. The calls it makes
// first are the real lookups in the hosted regions, so a free allowance that runs out (25 registry lookups a day
// per address) is spent on those; when it runs out, the rest of the registry calls are skipped and reported as one
// failure. Calls a free caller's plan does not answer (registry batch tools, recorded facts) are expected to answer
// PlanRequired without a Pro or Team key, and their real answer with one. With a key, it prints the quota left
// from the response headers at the end.
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

import {
  PAID_TIERS,
  RegistryGate,
  isPaidOnlyCall,
  plannedSpend,
} from "./hosted_plan.ts";
import { HOSTED_REGISTRY_CASES } from "./hosted_cases.ts";

const API = (process.env.FACTLOT_E2E_URL ?? "https://api.factlot.com").replace(
  /\/+$/,
  "",
);
const SITE = (process.env.FACTLOT_E2E_SITE ?? "https://factlot.com").replace(
  /\/+$/,
  "",
);
const DELAY = Number(process.env.FACTLOT_E2E_DELAY_MS ?? 1100);
const NO_REPORTS =
  process.argv.includes("--no-reports") ||
  process.env.FACTLOT_E2E_NO_REPORTS === "1";
const root = fileURLToPath(new URL("../..", import.meta.url));

let passed = 0;
const failures: string[] = [];
const notes: string[] = [];

function ok(cond: unknown, label: string): void {
  if (cond) passed++;
  else failures.push(label);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// With FACTLOT_API_KEY set, every call (REST and MCP) carries the key: the suite then runs on that
// plan's quotas instead of the free tier's 25 registry lookups a day per address (several runs a
// day from one machine exhaust the free quota and every registry check answers 429).
const KEY = process.env.FACTLOT_API_KEY;
// The caller's plan (x-factlot-tier on the API's answers): Pro and Team keys get the paid registry calls.
let tier: string | null = null;
const paid = () => tier !== null && PAID_TIERS.has(tier);
// Reports left this month, from x-factlot-reports-quota-remaining.
let reportsLeft: string | null = null;
const gate = new RegistryGate();
async function api(path: string, init?: RequestInit): Promise<Response> {
  await sleep(DELAY);
  let res: Response;
  if (!KEY) res = await fetch(`${API}${path}`, init);
  else {
    const headers = new Headers(init?.headers);
    if (!headers.has("authorization"))
      headers.set("authorization", `Bearer ${KEY}`);
    res = await fetch(`${API}${path}`, { ...init, headers });
  }
  tier = res.headers.get("x-factlot-tier") ?? tier;
  reportsLeft =
    res.headers.get("x-factlot-reports-quota-remaining") ?? reportsLeft;
  return res;
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
  const json = await res.json().catch(() => undefined);
  if (path.startsWith("/v1/registry/"))
    gate.observe(res.status, (json as { error?: unknown })?.error, res.headers);
  return { status: res.status, json };
}
/**
 * A registry call through the gate: undefined when the lookups have run out (the call is not made, and the run
 * reports the stop once), else the answer.
 */
async function registryPost(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown } | undefined> {
  if (!gate.open()) return undefined;
  const r = await post(path, body);
  return r.status === 429 &&
    (r.json as { error?: string })?.error === "RegistryQuotaExceeded"
    ? undefined
    : r;
}
/** The check of a paid-only call made without a Pro or Team key: 403 PlanRequired. */
function planRequired(label: string, status: number, json: unknown): void {
  ok(
    status === 403 && (json as { error?: string })?.error === "PlanRequired",
    `${label}: want 403 PlanRequired without a Pro or Team key (tier ${tier ?? "unknown"}), got ${status} ${JSON.stringify(json).slice(0, 120)}`,
  );
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
  // What this run will spend, printed before any of it is spent.
  {
    const toolsCases = (
      readJson("spec/vectors/tools.json") as { cases: Case[] }
    ).cases;
    const finds = (c: (typeof HOSTED_REGISTRY_CASES)[number]) =>
      !c.expect_error && at(c.expect ?? {}, "urn") !== null;
    const hostedCalls = hostedRegistry
      ? HOSTED_REGISTRY_CASES.map((c) => ({
          tool: c.tool,
          arguments: c.arguments,
          finds: finds(c),
        }))
      : [];
    // MCP repeats one finding call per registry tool.
    const mcpCalls = [
      ...new Map(
        hostedCalls.filter((c) => c.finds).map((c) => [c.tool, c]),
      ).values(),
    ];
    // The vectors written against the test registry file may find something in the hosted regions too.
    const unknown = hostedRegistry
      ? toolsCases.filter(
          (c) =>
            c.tool?.startsWith("registry_") &&
            !c.expect_error &&
            !(isPaidOnlyCall(c.tool, c.arguments) && !paid()),
        ).length
      : 0;
    const spend = plannedSpend([...hostedCalls, ...mcpCalls], {
      paid: paid(),
      keyed: KEY !== undefined,
      reports: !NO_REPORTS && reportsOn,
      unknown,
    });
    console.log(
      `plan: ${KEY ? `a key (tier ${tier ?? "unknown"})` : "no key (the free tier: 25 registry lookups a day per address, 3 reports a month)"}; ` +
        `this run spends about ${spend.lookups} registry lookups (at most ${spend.lookups_max}), ` +
        `${spend.reports} report${spend.reports === 1 ? "" : "s"} and ${spend.model_calls} model calls` +
        (NO_REPORTS ? " (--no-reports)" : ""),
    );
    if (!KEY && spend.lookups > 25)
      console.log(
        "plan: that is more than the free allowance: the registry checks stop when it runs out (the real lookups in the hosted regions run first)",
      );
  }
  // Hosted registry regions (registry_coverage lists them): one real lookup per tool, with values read from the
  // source files. They run before every other registry call, so a free allowance is spent on them first. These also
  // give the MCP section its registry inputs.
  if (hostedRegistry)
    for (const c of HOSTED_REGISTRY_CASES) {
      vectorCount++;
      const label = `hosted ${c.tool} ${JSON.stringify(c.arguments).slice(0, 80)}`;
      const r = await registryPost(pathOf.get(c.tool)!, c.arguments);
      if (!r) continue;
      const { status, json } = r;
      if (isPaidOnlyCall(c.tool, c.arguments) && !paid()) {
        planRequired(label, status, json);
        continue;
      }
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
    let status: number;
    let json: unknown;
    if (tool.startsWith("registry_")) {
      const r = await registryPost(path, c.arguments);
      if (!r) continue;
      ({ status, json } = r);
      // A caller without a Pro or Team key gets PlanRequired before the input is read.
      if (hostedRegistry && isPaidOnlyCall(tool, c.arguments) && !paid()) {
        planRequired(label, status, json);
        continue;
      }
    } else ({ status, json } = await post(path, c.arguments));
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
    if (
      hostedRegistry &&
      tool === "registry_lookup_batch" &&
      c.expect_error === "RegistryUnavailable"
    ) {
      // The lookup batch never fails as a whole for a miss either: the item is not_found, with
      // the single tool's coverage.
      ok(
        status === 200 &&
          at(json, "results.0.status") === "not_found" &&
          typeof at(json, "results.0.coverage") === "object" &&
          at(json, "summary.not_found") === 1,
        `${label}: want 200 with results.0.status not_found, got ${status} ${JSON.stringify(json).slice(0, 160)}`,
      );
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
    const r = await registryPost(
      pathOf.get(tool) ?? "/v1/registry/tx_equity_candidates/batch",
      args,
    );
    const { status, json } = r ?? { status: 0, json: undefined };
    const b = json as
      | {
          error?: string;
          results?: Record<string, unknown>[];
          summary?: { subjects?: number; answered?: number; errors?: number };
          rule?: unknown;
          notice?: unknown;
        }
      | undefined;
    if (!r) {
      // The registry lookups ran out: reported once at the end.
    } else if (!hostedRegistry)
      ok(
        status === 503 && b?.error === "RegistryUnavailable",
        `${tool} without a registry: ${status} ${b?.error}`,
      );
    else if (!paid()) planRequired(`${tool} two subjects`, status, json);
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
    if (KEY && !NO_REPORTS) {
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
  if (NO_REPORTS) notes.push("report_create: skipped (--no-reports)");
  else {
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
  // Inputs of the calls a free caller's plan does not answer (their REST answer was PlanRequired).
  const caseArgs = new Map(
    [...HOSTED_REGISTRY_CASES]
      .reverse()
      .filter((c) => !c.expect_error)
      .map((c) => [c.tool, c.arguments]),
  );
  for (const t of tools) {
    if (t.name.startsWith("registry_") && hostedRegistry && !gate.open()) {
      // The registry lookups ran out: reported once at the end.
      continue;
    }
    // A paid-only registry tool without a Pro or Team key: a PlanRequired tool error, unmetered.
    const paidArgs = caseArgs.get(t.name);
    if (
      hostedRegistry &&
      paidArgs &&
      isPaidOnlyCall(t.name, paidArgs) &&
      !paid()
    ) {
      await sleep(DELAY);
      const r = (await client.callTool({
        name: t.name,
        arguments: paidArgs,
      })) as { isError?: boolean; content: { type: string; text: string }[] };
      ok(
        r.isError && /PlanRequired/.test(r.content?.[0]?.text ?? ""),
        `MCP ${t.name}: want a PlanRequired tool error without a Pro or Team key, got ${r.content?.[0]?.text?.slice(0, 160)}`,
      );
      continue;
    }
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
    if (modelMcp[t.name] && NO_REPORTS) {
      notes.push(`MCP ${t.name}: skipped (--no-reports)`);
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
    const args = restArgs.get(t.name) ?? extra[t.name] ?? caseArgs.get(t.name);
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
    if (r.isError && /RegistryQuotaExceeded/.test(r.content?.[0]?.text ?? "")) {
      // The registry lookups ran out: stop the registry calls, reported once at the end.
      gate.observe(429, "RegistryQuotaExceeded", new Headers());
      continue;
    }
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
  const stop = gate.failure();
  if (stop) failures.push(stop);
  // From the response headers only: never the key itself.
  if (gate.remaining !== null)
    notes.push(
      `registry lookups left${KEY ? " on the key" : " for this address"}: ${gate.remaining}${gate.resets ? ` (resets ${gate.resets})` : ""}`,
    );
  if (KEY && reportsLeft !== null)
    notes.push(`reports left on the key this month: ${reportsLeft}`);
  for (const n of notes) console.log(`note: ${n}`);
  for (const f of failures) console.log(`FAIL: ${f}`);
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

await main();
