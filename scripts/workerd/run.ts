/**
 * Start-and-answer test of both Workers in the real Workers runtime (workerd, through Wrangler's
 * local test harness), hermetic: no network, no Cloudflare account.
 *
 *   npm run test:workerd
 *
 * What it does:
 * 1. Builds the synthetic registry fixture (spec/registry/build_fixture.py) and packs it with
 *    scripts/registry/pack.ts into a temporary folder; builds the site into another.
 * 2. Writes temporary copies of deploy/registry/wrangler.jsonc and deploy/cloudflare/wrangler.jsonc
 *    that point at those folders (everything else as committed: entry module, compatibility date
 *    and flags, bindings, Durable Object, assets settings), and starts both Workers in one
 *    workerd with the API Worker's REGISTRY service binding pointing at the registry Worker.
 *    Wrangler bundles each Worker as `wrangler deploy` does.
 * 3. Calls the registry Worker (/health, /run registry_coverage, registry_get,
 *    registry_search_address, /get-many) and the API Worker (/health, /v1/plans, a keyless
 *    registry call, a property page and a key-authenticated batch call through the service
 *    binding, MCP initialize and tools/list, the home page and the stylesheet from assets), and
 *    runs the scheduled handler with the feature variables unset and set.
 *
 * Exits non-zero on the first failed expectation, printing what was asked and what came back.
 * Prerequisite: `npm run build` (the site build reads packages/*\/dist).
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { createTestHarness } from "wrangler";

import { bindingStore } from "../registry/object_store.ts";
import { buildPack } from "../registry/pack.ts";
import { syncPack } from "../registry/sync_pack.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const say = (line: string) => console.log(`[workerd ${elapsed()}] ${line}`);

let failures = 0;
function expect(ok: boolean, what: string, detail: unknown = ""): void {
  if (ok) say(`ok   ${what}`);
  else {
    failures++;
    say(
      `FAIL ${what} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(
        0,
        2000,
      ),
    );
  }
}

/** JSON with comments and trailing commas (wrangler.jsonc) to a value. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<
    string,
    unknown
  >;
}

const tmp = mkdtempSync(join(tmpdir(), "factlot-workerd-"));
const keep = process.env.KEEP_WORKERD_TMP === "1";

async function main(): Promise<void> {
  // --- A tiny pack from the fixture registry, and the site --------------------------------------
  const fixture = join(tmp, "fixture.db");
  execFileSync("python3", [
    join(root, "spec/registry/build_fixture.py"),
    fixture,
  ]);
  const pack = join(tmp, "pack");
  buildPack([{ name: "fixture", path: fixture }], pack);
  const site = join(tmp, "public");
  execFileSync(process.execPath, [join(root, "scripts/site/build.mjs"), site], {
    stdio: "ignore",
  });
  say("fixture pack and site built");

  // --- Temporary configs: the committed ones, pointed at the temporary folders -------------------
  const registryConfig = parseJsonc(
    readFileSync(join(root, "deploy/registry/wrangler.jsonc"), "utf8"),
  );
  delete registryConfig.$schema;
  registryConfig.main = join(root, "deploy/registry/src/worker.ts");
  registryConfig.assets = {
    ...(registryConfig.assets as object),
    directory: pack,
  };
  const registryPath = join(tmp, "registry.wrangler.json");
  writeFileSync(registryPath, JSON.stringify(registryConfig, null, 2));

  const apiConfig = parseJsonc(
    readFileSync(join(root, "deploy/cloudflare/wrangler.jsonc"), "utf8"),
  );
  delete apiConfig.$schema;
  apiConfig.main = join(root, "deploy/cloudflare/src/worker.ts");
  apiConfig.assets = { ...(apiConfig.assets as object), directory: site };
  const apiPath = join(tmp, "api.wrangler.json");
  writeFileSync(apiPath, JSON.stringify(apiConfig, null, 2));

  // The bundles `wrangler deploy` would upload (dry run: no account, no network), measured, then
  // started as they are.
  const bundle = (config: string, out: string) => {
    execFileSync(
      join(root, "node_modules/.bin/wrangler"),
      ["deploy", "--dry-run", "--outdir", out, "--config", config],
      {
        cwd: tmp,
        stdio: "ignore",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    const bytes = readdirSync(out)
      .filter((f) => !f.endsWith(".map"))
      .reduce((n, f) => n + gzipSync(readFileSync(join(out, f))).length, 0);
    return bytes;
  };
  const apiOut = join(tmp, "out-api");
  const registryOut = join(tmp, "out-registry");
  const apiGz = bundle(apiPath, apiOut);
  const registryGz = bundle(registryPath, registryOut);
  // Workers Paid allows 10 MB of compressed Worker code; keep a margin.
  expect(
    apiGz < 8 * 1024 * 1024,
    `api bundle ${(apiGz / 1024 / 1024).toFixed(2)} MB gzipped, under 8 MB`,
  );
  expect(
    registryGz < 8 * 1024 * 1024,
    `registry bundle ${(registryGz / 1024 / 1024).toFixed(2)} MB gzipped, under 8 MB`,
  );

  const harness = createTestHarness({
    root: tmp,
    workers: [
      {
        configPath: apiPath,
        prebuiltWorkerDir: apiOut,
        bindingOverrides: { REGISTRY: "factlot-registry" },
      },
      { configPath: registryPath, prebuiltWorkerDir: registryOut },
    ],
  });
  try {
    await harness.listen();
    say("both Workers started");
    await registryChecks(harness);
    await apiChecks(harness);
    await scheduledChecks(harness, apiPath);
    await objectStoreChecks(harness, registryPath, registryOut, pack);
    const errors = harness
      .getLogs()
      .filter((l) =>
        /uncaught|TypeError|ReferenceError|"msg\\?":\\?"(error|watch check failed|lifecycle sweep failed|watch check stopped)/i.test(
          JSON.stringify(l),
        ),
      );
    expect(
      errors.length === 0,
      "no uncaught errors in the runtime logs",
      errors.slice(0, 5),
    );
  } finally {
    await harness.close().catch(() => undefined);
  }
}

type Harness = ReturnType<typeof createTestHarness>;

async function asJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
}

// --- A: the registry Worker ---------------------------------------------------------------------

async function registryChecks(harness: Harness): Promise<void> {
  const reg = harness.getWorker("factlot-registry");
  const call = (path: string, body?: unknown) =>
    reg.fetch(`https://registry.internal${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const health = await call("/health");
  const h = (await asJson(health)) as {
    ok?: boolean;
    pack?: { built_at?: unknown };
  };
  expect(health.status === 200 && h.ok === true, "registry GET /health", h);
  const run = async (tool: string, input: unknown) => {
    const res = await call("/run", { tool, input });
    return {
      status: res.status,
      body: (await asJson(res)) as { ok?: boolean },
    };
  };
  const cov = await run("registry_coverage", {});
  expect(
    cov.status === 200 && cov.body.ok === true,
    "registry /run registry_coverage",
    cov,
  );
  const get = await run("registry_get", {
    urn: "fl:parcel:us-48999:0001-000-0001",
  });
  expect(
    get.status === 200 && get.body.ok === true,
    "registry /run registry_get",
    get,
  );
  const search = await run("registry_search_address", { query: "100 Main St" });
  expect(
    search.status === 200 && search.body.ok === true,
    "registry /run registry_search_address",
    search,
  );
  const many = await call("/get-many", {
    urns: [
      "fl:parcel:us-48999:0001-000-0001",
      "fl:parcel:us-48999:0001-000-0002",
    ],
  });
  const m = (await asJson(many)) as { outcomes?: { ok?: boolean }[] };
  expect(
    many.status === 200 &&
      m.outcomes?.length === 2 &&
      m.outcomes.every((o) => o.ok === true),
    "registry POST /get-many",
    m,
  );
}

// --- B: the API Worker --------------------------------------------------------------------------

async function apiChecks(harness: Harness): Promise<void> {
  const api = harness.getWorker("factlot-api");
  const get = (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
      "cf-connecting-ip": "203.0.113.7",
    };
    return api.fetch(url, { ...init, headers } as Parameters<
      typeof api.fetch
    >[1]);
  };
  const health = await get("https://api.factlot.com/health");
  expect(health.status === 200, "api GET /health", await health.text());
  const plans = await get("https://api.factlot.com/v1/plans");
  const p = (await asJson(plans)) as { plans?: unknown };
  expect(plans.status === 200 && !!p.plans, "api GET /v1/plans", p);

  // Keyless registry call through the service binding.
  const cov = await get("https://api.factlot.com/v1/registry/coverage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const c = (await asJson(cov)) as { counties?: unknown[] };
  expect(
    cov.status === 200 && Array.isArray(c.counties),
    "api POST /v1/registry/coverage (keyless, through REGISTRY)",
    c,
  );
  const one = await get("https://api.factlot.com/v1/registry/get", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urn: "fl:parcel:us-48999:0001-000-0001" }),
  });
  const o = (await asJson(one)) as { urn?: unknown };
  expect(
    one.status === 200 && o.urn === "fl:parcel:us-48999:0001-000-0001",
    "api POST /v1/registry/get (keyless)",
    o,
  );

  // A property page (the page reads the registry through the binding; the fixture's sources are
  // not redistributable, so a page may be refused, but never with a server error).
  const page = await get("https://factlot.com/property/us-48999/0001-000-0001");
  expect(
    page.status < 500,
    "property page answers without a server error",
    `${page.status} ${(await page.text()).slice(0, 200)}`,
  );

  // MCP initialize and tools/list.
  const mcp = (body: unknown, extra: Record<string, string> = {}) =>
    get("https://api.factlot.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...extra,
      },
      body: JSON.stringify(body),
    });
  const init = await mcp({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "workerd-test", version: "1" },
    },
  });
  const ib = (await asJson(init)) as { result?: { serverInfo?: unknown } };
  expect(
    init.status === 200 && !!ib.result?.serverInfo,
    "api MCP initialize",
    ib,
  );
  const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const lb = (await asJson(list)) as {
    result?: { tools?: { name: string }[] };
  };
  const names = lb.result?.tools?.map((t) => t.name) ?? [];
  expect(
    list.status === 200 && names.includes("registry_get"),
    `api MCP tools/list (${names.length} tools)`,
    lb,
  );
  expect(
    !names.some((n) => n.startsWith("watch_")),
    "no watch_* tool while WATCH_LISTS_ENABLED is unset",
    names,
  );

  // Static assets.
  const home = await get("https://factlot.com/");
  expect(
    home.status === 200 && /<html/i.test(await home.text()),
    "assets GET / (factlot.com)",
  );
  const css = await get("https://factlot.com/styles.css");
  expect(css.status === 200, "assets GET /styles.css", css.status);
  const about = await get("https://factlot.com/about/");
  expect(
    about.status === 200 && (await about.text()).includes("About FactLot"),
    "assets GET /about/",
    about.status,
  );
  // An address that moved answers with a redirect, not followed here: /about without its slash
  // as every page does, an old utility page to its successor, an old rent page to the sister
  // site when that site has the page, and to the nearest page of this site when it does not.
  for (const [from, statuses, to] of [
    ["/about", [301, 307, 308], "/about/"],
    ["/pricing", [301, 307, 308], "/pricing/"],
    ["/search?q=a", [301], "https://factlot.com/try/"],
    ["/for-ai", [301], "https://factlot.com/connect/"],
    ["/buildings/", [301], "https://factlease.com/buildings"],
    ["/markets/", [301], "https://factlease.com/"],
    [
      "/markets/houston/zip/77002",
      [301],
      "https://factlease.com/houston/zip/77002",
    ],
    ["/markets/houston/zip/77999", [301], "https://factlot.com/texas/harris/"],
    ["/questions/office-rent-in-el-paso", [301], "https://factlot.com/texas/"],
  ] as const) {
    const res = await get(`https://factlot.com${from}`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    expect(
      (statuses as readonly number[]).includes(res.status) &&
        (location === to || location === `https://factlot.com${to}`),
      `redirect GET ${from}`,
      `${res.status} ${location}`,
    );
  }

  // A key-authenticated batch call through the binding, with a test key seeded here.
  const key = `fl_live_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const env = (await api.getEnv()) as {
    KEYS: { put(k: string, v: string): Promise<void> };
  };
  await env.KEYS.put(
    `key:${hash}`,
    JSON.stringify({
      plan: "pro",
      status: "active",
      customer: "cus_workerd_test",
      subscription: "sub_workerd_test",
      stripe_status: "active",
      created: new Date().toISOString(),
      checked_at: Date.now(),
    }),
  );
  await env.KEYS.put("sub:sub_workerd_test", JSON.stringify([hash]));
  const acct = await get("https://api.factlot.com/v1/account", {
    headers: { authorization: `Bearer ${key}` },
  });
  expect(
    acct.status === 200,
    "api GET /v1/account with a seeded test key",
    await asJson(acct),
  );
  const batch = await get(
    "https://api.factlot.com/v1/registry/tx_equity_candidates/batch",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        subjects: [
          { id: "a", urn: "fl:parcel:us-48997:1000001" },
          { id: "b", urn: "fl:parcel:us-48997:1000010" },
        ],
      }),
    },
  );
  // A property sheet: report_create runs registry_get as the caller through the router and the
  // inner HTTP handler again, then stores the PDF; the download link answers the file.
  const sheet = await get("https://api.factlot.com/v1/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "property_sheet",
      format: "pdf",
      arguments: { urn: "fl:parcel:us-48999:0001-000-0001" },
    }),
  });
  const sh = (await asJson(sheet)) as { download_url?: string };
  expect(
    sheet.status === 201 && typeof sh.download_url === "string",
    "api POST /v1/reports property_sheet (keyless, registry_get as the caller)",
    sh,
  );
  if (typeof sh.download_url === "string") {
    const file = await get(sh.download_url);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(
      file.status === 200 &&
        new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-",
      "api GET the property sheet's download link (a PDF)",
      file.status,
    );
  }
  const bb = (await asJson(batch)) as { summary?: { subjects?: number } };
  expect(
    batch.status === 200 && bb.summary?.subjects === 2,
    "api batch candidates with a key (fan-out through REGISTRY)",
    bb,
  );
}

async function scheduledChecks(
  harness: Harness,
  apiPath: string,
): Promise<void> {
  for (const cron of ["*/15 * * * *", "0 * * * *"]) {
    const r = await harness
      .getWorker("factlot-api")
      .scheduled({ cron, scheduledTime: new Date() });
    expect(
      r.outcome === "ok",
      `scheduled ${cron} with the feature variables unset`,
      r,
    );
  }
  // The same with both features on, in this test's own config only.
  await harness.update((cur) => ({
    ...cur,
    workers: cur.workers.map((w) =>
      "configPath" in w && w.configPath === apiPath
        ? {
            ...w,
            vars: {
              WATCH_LISTS_ENABLED: "true",
              LIFECYCLE_EMAILS_ENABLED: "true",
            },
            secrets: {
              RECOVERY_SIGNING_SECRET: "workerd-test-secret-not-real",
              POSTAL_ADDRESS: "1 Test Way, Testville",
            },
          }
        : w,
    ),
  }));
  for (const cron of ["*/15 * * * *", "0 * * * *"]) {
    const r = await harness
      .getWorker("factlot-api")
      .scheduled({ cron, scheduledTime: new Date() });
    expect(
      r.outcome === "ok",
      `scheduled ${cron} with both feature variables set`,
      r,
    );
  }
  // The watch check reached the registry through the binding and its index object.
  const ran = harness
    .getLogs()
    .some((l) => /watch check\\?"/.test(JSON.stringify(l)));
  expect(ran, "the scheduled watch check ran (feature on)");
  const list = await harness
    .getWorker("factlot-api")
    .fetch("https://api.factlot.com/v1/watch/list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  expect(
    list.status === 403,
    "watch tools answer (PlanRequired without a key) once the variable is set",
    list.status,
  );
}

// --- The registry Worker on its object-storage backend (r2_pack.ts) -------------------------------

async function objectStoreChecks(
  harness: Harness,
  registryPath: string,
  registryOut: string,
  pack: string,
): Promise<void> {
  // The same Worker and bundle with a local bucket bound and PACK_BACKEND "r2", as the commented
  // lines of deploy/registry/wrangler.jsonc would configure it.
  const config = JSON.parse(readFileSync(registryPath, "utf8")) as Record<
    string,
    unknown
  >;
  config.r2_buckets = [
    { binding: "PACK_BUCKET", bucket_name: "workerd-test-packs" },
  ];
  config.vars = {
    PACK_BACKEND: "r2",
    PACK_POINTER: "packs/current.json",
    PACK_POINTER_TTL_SECONDS: "0",
  };
  const r2Path = registryPath.replace(/\.json$/, ".r2.json");
  writeFileSync(r2Path, JSON.stringify(config, null, 2));
  await harness.update((cur) => ({
    ...cur,
    workers: cur.workers.map((w) =>
      "configPath" in w && w.configPath === registryPath
        ? { configPath: r2Path, prebuiltWorkerDir: registryOut }
        : w,
    ),
  }));
  const reg = harness.getWorker("factlot-registry");
  const env = (await reg.getEnv()) as {
    PACK_BUCKET: Parameters<typeof bindingStore>[0];
  };
  await syncPack(bindingStore(env.PACK_BUCKET), pack, {
    id: "workerd-test",
    log: () => {},
  });
  say("fixture pack synced to the local bucket");
  const health = await reg.fetch("https://registry.internal/health");
  const h = (await asJson(health)) as { ok?: boolean };
  expect(
    health.status === 200 && h.ok === true,
    "registry (object storage) GET /health",
    h,
  );
  const run = await reg.fetch("https://registry.internal/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool: "registry_get",
      input: { urn: "fl:parcel:us-48999:0001-000-0001" },
    }),
  });
  const r = (await asJson(run)) as { ok?: boolean };
  expect(
    run.status === 200 && r.ok === true,
    "registry (object storage) /run registry_get",
    r,
  );
}

main()
  .catch((err) => {
    failures++;
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  })
  .finally(() => {
    if (!keep) rmSync(tmp, { recursive: true, force: true });
    else say(`kept ${tmp}`);
    say(failures ? `${failures} failure(s)` : "all passed");
    process.exit(failures ? 1 : 0);
  });
