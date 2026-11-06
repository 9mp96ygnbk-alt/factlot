// Run the connector-guide recipes for the TypeScript MCP SDKs and the Vercel AI SDK against a
// FactLot MCP endpoint. NOT part of `npm test` or CI. No LLM key is needed: it tests the MCP
// connection layer (connect, list tools, convert schemas, call tools through each library).
// See connectors/frameworks/README.md for the recipes this script mirrors.
//
// It has no package.json of its own. Copy it to a scratch folder with the packages installed:
//
//   mkdir scratch && cd scratch && npm init -y
//   npm i @modelcontextprotocol/client @modelcontextprotocol/sdk @ai-sdk/mcp ai
//   cp <repo>/scripts/e2e/frameworks/node_frameworks.mjs .
//   FACTLOT_MCP_URL=http://127.0.0.1:8787/mcp node node_frameworks.mjs
//
// Packages that are not installed are skipped. Run from inside the repo it finds the repo's own
// copy of @modelcontextprotocol/sdk (v1) and skips the rest.
//
// Environment:
//   FACTLOT_MCP_URL     MCP endpoint (default http://127.0.0.1:8787/mcp; hosted https://api.factlot.com/mcp)
//   FACTLOT_API_KEY     optional; sent as `Authorization: Bearer <key>`
//   FACTLOT_USER_AGENT  User-Agent header (default factlot-framework-recipes/1.0)
//   FACTLOT_MIN_GAP_S   minimum seconds between HTTP requests (default 0; use 2 or more on the hosted free tier)
//   FACTLOT_BASELINE_FILE optional path; the server's tools/list is cached there (shared with the Python script)
//   FACTLOT_VECTORS_DIR spec/vectors/calc directory for --vectors (default: relative to this file)
// Options:  [sdk-v1 sdk-v2 ai-sdk ...]  limit to these;  --lean  fewest requests (skip the rent check);  --vectors  also replay every calculator
//           case in spec/vectors/calc through each library (about 130 calls each; local servers only).
// Exit status 1 if any check fails.
/* global fetch, setTimeout, Headers, URL */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_ = process.env.FACTLOT_MCP_URL ?? "http://127.0.0.1:8787/mcp";
const API_KEY = process.env.FACTLOT_API_KEY;
const USER_AGENT =
  process.env.FACTLOT_USER_AGENT ?? "factlot-framework-recipes/1.0";
const MIN_GAP_S = Number(process.env.FACTLOT_MIN_GAP_S ?? 0);

// Inputs shared by every recipe. The lease page is SYNTHETIC test text, not a real lease.
const DEBT_INPUT = {
  noi: 1_000_000,
  value: 15_000_000,
  rate_annual: 0.06,
  amortization_years: 30,
  max_ltv: 0.65,
  min_dscr: 1.25,
};
const DOC_INPUT = {
  document: {
    title: "Synthetic lease page (not a real lease)",
    pages: [
      "SYNTHETIC EXAMPLE - NOT A REAL LEASE. Tenant shall deposit the sum of $95,000.00 " +
        "with Landlord. The Term shall expire on June 30, 2031.",
    ],
  },
  candidates: [
    {
      predicate: "lease.security_deposit",
      value: 95000,
      quote: "deposit the sum of $95,000.00 with Landlord",
      page: 1,
    },
    // A deliberate misread: the page says 2031, so this one must not come back verified.
    {
      predicate: "lease.expiration_date",
      value: "2033-06-30",
      quote: "shall expire on June 30, 2031",
      page: 1,
    },
  ],
  as_of: "2026-11-06",
};
const RENT_INPUT = {
  commencement_date: "2026-01-01",
  term_months: 60,
  area_sf: 10000,
  starting_rent_psf_annual: 30,
  escalation: { type: "percent", rate: 0.03 }, // a oneOf/const union in the input schema
  abated_months: [1, 2, 3],
};
const BASELINE_FILE = process.env.FACTLOT_BASELINE_FILE;
const LEAN = process.argv.includes("--lean");
const WANTED = ["calc_debt_sizing", "calc_irr", "doc_verify_facts"];
const TRACKED = [
  "oneOf", "anyOf", "const", "enum", "propertyNames", "additionalProperties", "required",
  "minItems", "maxItems", "minLength", "maxLength", "pattern", "format", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "default",
]; // prettier-ignore

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Shared HTTP behaviour: User-Agent, bearer key, optional pacing, and the 429 policy. ----
let lastRequest = 0;
async function factlotFetch(input, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  if (API_KEY) headers.set("Authorization", `Bearer ${API_KEY}`);
  for (let attempt = 0; ; attempt++) {
    if (MIN_GAP_S) {
      const pause = lastRequest + MIN_GAP_S * 1000 - Date.now();
      if (pause > 0) await sleep(pause);
      lastRequest = Date.now();
    }
    const res = await fetch(input, { ...init, headers });
    if (res.status !== 429 || attempt >= 2) return res;
    const wait = await retryAfterSeconds(res);
    console.log(`  429 from server; waiting ${wait}s (retry ${attempt + 1})`);
    await sleep(Math.min(wait, 70) * 1000);
  }
}

// Seconds to wait: the Retry-After header, else data.retry_after_seconds in the body, else 60.
async function retryAfterSeconds(res) {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;
  try {
    const body = await res.clone().json();
    const seconds = Number((body.error?.data ?? body).retry_after_seconds);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  } catch {
    // fall through to the documented window
  }
  return 60;
}

// ---- Checks ----
const textOf = (result) => {
  if (typeof result === "string") return result;
  const content = result?.content ?? result;
  if (Array.isArray(content)) return content.map((c) => c.text ?? "").join("");
  return String(result);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function checkDebt(result) {
  const body = JSON.parse(textOf(result));
  assert(body.value.max_loan === 9_750_000, `max_loan ${body.value.max_loan}`);
  assert(body.provenance.formula.startsWith("calc.debt_sizing@"), "formula");
  return { max_loan: body.value.max_loan, formula: body.provenance.formula };
}
function checkDoc(result) {
  const body = JSON.parse(textOf(result));
  const verified = body.verified.map((v) => v.fact.predicate);
  const review = body.needs_review.map((r) => [r.predicate, r.reason]);
  assert(equal(verified, ["lease.security_deposit"]), JSON.stringify(body));
  assert(
    equal(
      review.map((r) => r[0]),
      ["lease.expiration_date"],
    ),
    "review",
  );
  return { verified, needs_review: review };
}
function checkRent(result, reference) {
  const body = JSON.parse(textOf(result));
  assert(
    equal(body.value, reference.value),
    "escalation union changed in transit",
  );
  return { total_rent_due: body.value.total_rent_due };
}

function walk(node, counts) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, counts));
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (
      ["properties", "$defs", "definitions", "patternProperties"].includes(
        key,
      ) &&
      value &&
      typeof value === "object"
    ) {
      for (const sub of Object.values(value)) walk(sub, counts);
      continue;
    }
    if (TRACKED.includes(key)) counts[key] = (counts[key] ?? 0) + 1;
    walk(value, counts);
  }
}
const keywordCounts = (schema) => {
  const c = {};
  walk(schema, c);
  return c;
};

// Canonical form so key order does not matter.
const canon = (v) =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon(v[k])]),
        )
      : v;

function compareSchemas(server, converted) {
  const lost = {};
  const gained = {};
  const notable = {};
  let identical = 0;
  const missing = Object.keys(server).filter((n) => !(n in converted));
  for (const [name, original] of Object.entries(server)) {
    if (!(name in converted)) continue;
    if (equal(canon(original), canon(converted[name]))) identical++;
    const before = keywordCounts(original);
    const after = keywordCounts(converted[name]);
    for (const kw of TRACKED) {
      const b = before[kw] ?? 0;
      const a = after[kw] ?? 0;
      if (b > a) {
        lost[kw] = (lost[kw] ?? 0) + b - a;
        if (["oneOf", "const", "propertyNames"].includes(kw))
          (notable[kw] ??= []).push(name);
      } else if (a > b) gained[kw] = (gained[kw] ?? 0) + a - b;
    }
  }
  return {
    tools_missing: missing,
    identical,
    of: Object.keys(server).length,
    lost,
    gained,
    tools_losing_oneOf_const_propertyNames: notable,
  };
}

// ---- Baseline: raw JSON-RPC, no library ----
async function rpc(method, params) {
  const res = await factlotFetch(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params ? { params } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  let text = await res.text();
  if (/^\s*(event|data):/.test(text))
    text = text
      .split("\n")
      .find((l) => l.startsWith("data:"))
      .slice(5);
  return JSON.parse(text).result;
}

async function loadVectorCases() {
  const dir =
    process.env.FACTLOT_VECTORS_DIR ??
    fileURLToPath(new URL("../../../spec/vectors/calc/", import.meta.url));
  const cases = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const doc = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
    const tool = doc.calculator.replace(".", "_");
    for (const c of doc.cases) {
      const r = await rpc("tools/call", { name: tool, arguments: c.input });
      if (r.isError) continue; // an expect_error case: libraries surface errors differently
      cases.push([tool, c.input, JSON.parse(textOf(r))]);
    }
  }
  return cases;
}

async function replayVectors(call, cases) {
  const failures = [];
  let matched = 0;
  for (const [i, [tool, args, ref]] of cases.entries()) {
    try {
      const got = JSON.parse(textOf(await call(tool, args)));
      if (equal(canon(got), canon(ref))) matched++;
      else failures.push(`${tool}[${i}]: result differs from the direct call`);
    } catch (err) {
      failures.push(`${tool}[${i}]: ${String(err).slice(0, 200)}`);
    }
  }
  return { cases: cases.length, matched, failures: failures.slice(0, 8) };
}

// ---- Recipes ----
async function viaSdk(v2, mod, baseline, reference, vectors) {
  const { Client, StreamableHTTPClientTransport, version } = mod;
  // The SDK's own request timeout (60 s) also covers a Retry-After sleep inside fetch, and the
  // hosted API says "retry in 60s", so give each request more room than the longest wait.
  const opts = { timeout: 130_000 };
  const out = { version };
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    // User-Agent and bearer key on every request; the custom fetch adds the 429 policy.
    requestInit: {
      headers: {
        "User-Agent": USER_AGENT,
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
    },
    fetch: factlotFetch,
  });
  const client = new Client({ name: "factlot-recipe", version: "1.0.0" });
  await (v2 ? client.connect(transport) : client.connect(transport, opts));
  try {
    const { tools } = await client.listTools(undefined, opts);
    out.tools = tools.length;
    out.filtered = tools
      .map((t) => t.name)
      .filter((n) => WANTED.includes(n))
      .sort();
    assert(equal(out.filtered, [...WANTED].sort()), "filter");
    out.schema = compareSchemas(
      baseline,
      Object.fromEntries(tools.map((t) => [t.name, t.inputSchema])),
    );
    const call = (name, args) =>
      v2
        ? client.callTool({ name, arguments: args }, opts)
        : client.callTool({ name, arguments: args }, undefined, opts);
    out.debt = checkDebt(await call("calc_debt_sizing", DEBT_INPUT));
    out.doc = checkDoc(await call("doc_verify_facts", DOC_INPUT));
    if (!LEAN)
      out.rent = checkRent(
        await call("calc_rent_schedule", RENT_INPUT),
        reference,
      );
    if (vectors) out.vectors = await replayVectors(call, vectors);
  } finally {
    await client.close();
  }
  return out;
}

async function viaAiSdk(baseline, reference, vectors) {
  const { createMCPClient } = await import("@ai-sdk/mcp");
  const out = {};
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: URL_,
      headers: {
        "User-Agent": USER_AGENT,
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      fetch: factlotFetch,
    },
  });
  try {
    const all = await client.tools(); // downloads the whole tools/list
    out.tools = Object.keys(all).length;
    const some = Object.fromEntries(
      Object.entries(all).filter(([n]) => WANTED.includes(n)),
    );
    out.filtered = Object.keys(some).sort();
    assert(equal(out.filtered, [...WANTED].sort()), "filter");
    out.schema = compareSchemas(
      baseline,
      Object.fromEntries(
        Object.entries(all).map(([n, t]) => [n, t.inputSchema.jsonSchema]),
      ),
    );
    // execute() is what the AI SDK calls when a model returns a tool call.
    const call = (name, args) =>
      all[name].execute(args, { toolCallId: "call_1", messages: [] });
    out.debt = checkDebt(await call("calc_debt_sizing", DEBT_INPUT));
    out.doc = checkDoc(await call("doc_verify_facts", DOC_INPUT));
    if (!LEAN)
      out.rent = checkRent(
        await call("calc_rent_schedule", RENT_INPUT),
        reference,
      );
    if (vectors) out.vectors = await replayVectors(call, vectors);
  } finally {
    await client.close();
  }
  return out;
}

async function tryImport(spec) {
  try {
    return await import(spec);
  } catch {
    return null;
  }
}
// Installed version of a package, found by walking up from the working directory and from this file.
function packageVersion(name) {
  const starts = [process.cwd(), fileURLToPath(new URL(".", import.meta.url))];
  for (let dir of starts) {
    for (;;) {
      try {
        return JSON.parse(
          readFileSync(`${dir}/node_modules/${name}/package.json`, "utf8"),
        ).version;
      } catch {
        // keep walking up
      }
      const parent = dir.replace(/\/[^/]*$/, "");
      if (!parent || parent === dir) break;
      dir = parent;
    }
  }
  return "unknown";
}

const args = process.argv.slice(2);
const wantVectors = args.includes("--vectors");
const names = args.filter((a) => !a.startsWith("--"));
const all = ["sdk-v2", "sdk-v1", "ai-sdk"];
const selected = names.length ? names : all;

console.log(
  `endpoint ${URL_}  user-agent '${USER_AGENT}'  key ${API_KEY ? "set" : "not set"}`,
);
let baseline, reference, vectors;
try {
  let listed;
  if (BASELINE_FILE && existsSync(BASELINE_FILE))
    listed = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  else {
    listed = (await rpc("tools/list")).tools;
    if (BASELINE_FILE) writeFileSync(BASELINE_FILE, JSON.stringify(listed));
  }
  baseline = Object.fromEntries(listed.map((t) => [t.name, t.inputSchema]));
  if (!LEAN)
    reference = JSON.parse(
      textOf(
        await rpc("tools/call", {
          name: "calc_rent_schedule",
          arguments: RENT_INPUT,
        }),
      ),
    );
  vectors = wantVectors ? await loadVectorCases() : null;
} catch (err) {
  console.log(`cannot reach ${URL_}: ${err.message}`);
  process.exit(1);
}
if (vectors) console.log(`vector cases: ${vectors.length}`);
console.log(`server tools/list: ${Object.keys(baseline).length} tools`);

const summary = {};
let failed = 0;
for (const name of selected) {
  let run;
  if (name === "sdk-v2") {
    const m = await tryImport("@modelcontextprotocol/client");
    if (m)
      run = async () => ({
        ...(await viaSdk(
          true,
          {
            ...m,
            version: `@modelcontextprotocol/client ${packageVersion("@modelcontextprotocol/client")}`,
          },
          baseline,
          reference,
          vectors,
        )),
      });
    else
      summary[name] = {
        skipped: "@modelcontextprotocol/client is not installed",
      };
  } else if (name === "sdk-v1") {
    const client = await tryImport("@modelcontextprotocol/sdk/client/index.js");
    const http = await tryImport(
      "@modelcontextprotocol/sdk/client/streamableHttp.js",
    );
    if (client && http)
      run = async () =>
        viaSdk(
          false,
          {
            Client: client.Client,
            StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
            version: `@modelcontextprotocol/sdk ${packageVersion("@modelcontextprotocol/sdk")}`,
          },
          baseline,
          reference,
          vectors,
        );
    else
      summary[name] = { skipped: "@modelcontextprotocol/sdk is not installed" };
  } else if (name === "ai-sdk") {
    if (await tryImport("@ai-sdk/mcp"))
      run = async () => ({
        version: `@ai-sdk/mcp ${packageVersion("@ai-sdk/mcp")}, ai ${packageVersion("ai")}`,
        ...(await viaAiSdk(baseline, reference, vectors)),
      });
    else summary[name] = { skipped: "@ai-sdk/mcp is not installed" };
  } else {
    console.log(`unknown library ${name}; choose from ${all.join(" ")}`);
    process.exit(2);
  }
  if (!run) {
    console.log(`[${name}] SKIPPED: ${summary[name].skipped}`);
    continue;
  }
  const started = Date.now();
  try {
    summary[name] = {
      ...(await run()),
      seconds: (Date.now() - started) / 1000,
      ok: true,
    };
    console.log(`[${name}] OK in ${summary[name].seconds}s`);
  } catch (err) {
    failed++;
    summary[name] = { ok: false, error: String(err).slice(0, 500) };
    console.log(`[${name}] FAILED: ${String(err).slice(0, 300)}`);
  }
}
console.log(JSON.stringify(summary, null, args.includes("--json") ? 0 : 2));
process.exit(failed ? 1 : 0);
