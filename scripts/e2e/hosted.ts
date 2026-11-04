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
function ok(cond: unknown, label: string): void {
  if (cond) passed++;
  else failures.push(label);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, init?: RequestInit): Promise<Response> {
  await sleep(DELAY);
  return fetch(`${API}${path}`, init);
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
  return JSON.stringify(actual) === JSON.stringify(expected);
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
  for (const doc of ["/openapi.json", "/openapi-3.0.json"]) {
    const o = (await (await api(doc)).json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      servers: { url: string }[];
    };
    ok(
      Object.keys(o.paths).length >= toolList.tools.length,
      `${doc}: ${Object.keys(o.paths).length} paths for ${toolList.tools.length} tools`,
    );
    ok(
      o.servers?.[0]?.url === API,
      `${doc} servers url ${o.servers?.[0]?.url}`,
    );
  }
  const plans = await api("/v1/plans");
  ok(plans.status === 200, `/v1/plans ${plans.status}`);
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
    ...readdirSync(`${root}/spec/vectors/calc`).map(
      (f) => ["calc", `spec/vectors/calc/${f}`] as [string, string],
    ),
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
      // The hosted free endpoint carries no registry database yet: it must say so clearly.
      ok(
        status === 503 &&
          (json as { error?: string })?.error === "RegistryUnavailable",
        `${label}: hosted registry answer ${status}`,
      );
      continue;
    }
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
  await sleep(DELAY);
  const client = new Client({ name: "factlot-hosted-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${API}/mcp`)),
  );
  await sleep(DELAY * 2);
  const { tools } = await client.listTools();
  notes.push(`${tools.length} MCP tools listed`);
  const extra: Record<string, unknown> = {
    search: { query: "CAM cap non-cumulative" },
    fetch: { id: "tool:calc_cam_reconciliation" },
    schema_get: {},
  };
  for (const t of tools) {
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
    } else ok(text.length > 20, `MCP ${t.name}: empty answer`);
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
