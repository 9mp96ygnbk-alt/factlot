import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tools } from "@factlot/tools";

import {
  createFactLotServer,
  REQUEST_LOG_FIELDS,
  SERVER_TIMEOUTS,
  UsageMeter,
} from "./index.ts";
import type { FactLotServerOptions } from "./index.ts";

async function start(opts: FactLotServerOptions = {}) {
  const server = createFactLotServer(opts);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("MCP over Streamable HTTP: list and call tools", async () => {
  const { base, close } = await start();
  const client = new Client({ name: "remote-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
  );
  const { tools: listed } = await client.listTools();
  const names = listed.map((t) => t.name);
  for (const t of tools.filter((x) => !x.requires))
    assert.ok(names.includes(t.name), t.name);
  assert.ok(
    !names.includes("registry_get"),
    "registry tools only when configured",
  );
  assert.ok(names.includes("search") && names.includes("fetch"));
  const r = (await client.callTool({
    name: "calc_debt_sizing",
    arguments: {
      noi: 1_000_000,
      value: 15_000_000,
      rate_annual: 0.06,
      amortization_years: 30,
      max_ltv: 0.65,
      min_dscr: 1.25,
    },
  })) as { structuredContent?: { value: { max_loan: number } } };
  assert.equal(r.structuredContent?.value.max_loan, 9_750_000);
  await client.close();
  await close();
});

test("REST endpoints and errors", async () => {
  const { base, close } = await start();
  const ok = await post(`${base}/v1/calc/percentage_rent`, {
    gross_sales: 5_000_000,
    rate: 0.06,
    base_rent_annual: 240_000,
  });
  assert.equal(ok.status, 200);
  assert.equal(
    ((await ok.json()) as { value: { percentage_rent: number } }).value
      .percentage_rent,
    60_000,
  );

  const id = await post(`${base}/v1/id/parcel`, {
    state_fips: "06",
    county_fips: "037",
    apn: "5432-001-012",
  });
  assert.equal(
    ((await id.json()) as { urn: string }).urn,
    "fl:parcel:us-06037:5432001012",
  );

  const bad = await post(`${base}/v1/calc/debt_sizing`, {
    noi: 1,
    rate_annual: 0.05,
    amortization_years: 0,
  });
  assert.equal(bad.status, 400);
  assert.equal(
    ((await bad.json()) as { error: string }).error,
    "CalcInputError",
  );

  const notJson = await fetch(`${base}/v1/id/parcel`, {
    method: "POST",
    body: "{nope",
  });
  assert.equal(notJson.status, 400);
  assert.equal((await fetch(`${base}/v1/id/parcel`)).status, 405);
  assert.equal(
    (await fetch(`${base}/v1/nope`, { method: "POST" })).status,
    404,
  );
  assert.equal((await fetch(`${base}/mcp`)).status, 405);

  const catalog = (await (await fetch(`${base}/v1/tools`)).json()) as {
    tools: { name: string }[];
  };
  assert.equal(catalog.tools.length, tools.length);
  const health = (await (await fetch(`${base}/health`)).json()) as {
    ok: boolean;
  };
  assert.equal(health.ok, true);
  await close();
});

test("OpenAPI documents point at this server", async () => {
  const { base, close } = await start({ trustProxy: true });
  const doc31 = (await (await fetch(`${base}/openapi.json`)).json()) as {
    openapi: string;
    servers: { url: string }[];
    paths: object;
  };
  assert.equal(doc31.openapi, "3.1.0");
  assert.equal(doc31.servers[0]?.url, base);
  assert.equal(Object.keys(doc31.paths).length, tools.length);
  const doc30 = (await (
    await fetch(`${base}/openapi-3.0.json`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "api.example.com",
      },
    })
  ).json()) as {
    openapi: string;
    servers: { url: string }[];
  };
  assert.equal(doc30.openapi, "3.0.3");
  assert.equal(doc30.servers[0]?.url, "https://api.example.com");
  await close();
});

test("optional bearer auth protects MCP and REST but not discovery", async () => {
  const { base, close } = await start({
    apiKey: "secret",
    publicUrl: "https://api.factlot.test/",
  });
  assert.equal(
    (await post(`${base}/v1/id/parse`, { urn: "fl:parcel:us-06037:1" })).status,
    401,
  );
  assert.equal(
    (
      await post(
        `${base}/v1/id/parse`,
        { urn: "fl:parcel:us-06037:1" },
        { authorization: "Bearer wrong" },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await post(
        `${base}/v1/id/parse`,
        { urn: "fl:parcel:us-06037:1" },
        { authorization: "Bearer secret" },
      )
    ).status,
    200,
  );
  assert.equal((await post(`${base}/mcp`, {})).status, 401);
  const doc = (await (await fetch(`${base}/openapi.json`)).json()) as {
    servers: { url: string }[];
    security: unknown[];
  };
  assert.equal(doc.servers[0]?.url, "https://api.factlot.test");
  assert.deepEqual(doc.security, [{ bearerAuth: [] }]);

  const client = new Client({ name: "auth-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: "Bearer secret" } },
    }),
  );
  assert.ok(
    (await client.listTools()).tools.length >
      tools.filter((x) => !x.requires).length,
  );
  await client.close();
  await close();
});

test("CORS preflight and body limit", async () => {
  const { base, close } = await start({ maxBodyBytes: 100 });
  const pre = await fetch(`${base}/mcp`, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  const big = await post(`${base}/v1/id/parse`, { urn: "x".repeat(500) });
  assert.equal(big.status, 413);
  await close();
});

test("registry tools over MCP and REST when a registry is configured", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { configureRegistry } = await import("@factlot/tools");

  const unconfigured = await start();
  configureRegistry(undefined);
  const saved = process.env.FACTLOT_REGISTRY_DB;
  delete process.env.FACTLOT_REGISTRY_DB;
  assert.equal(
    (
      await post(`${unconfigured.base}/v1/registry/get`, {
        urn: "fl:parcel:us-48999:1",
      })
    ).status,
    503,
  );
  await unconfigured.close();

  const db = join(mkdtempSync(join(tmpdir(), "factlot-server-")), "fixture.db");
  execFileSync("python3", [
    fileURLToPath(
      new URL("../../../spec/registry/build_fixture.py", import.meta.url),
    ),
    db,
  ]);
  configureRegistry(db);
  const { base, close } = await start();
  try {
    const urn = "fl:parcel:us-48999:00010000001";
    const got = await post(`${base}/v1/registry/get`, { urn });
    assert.equal(got.status, 200);
    const record = (await got.json()) as {
      status: string;
      facts: { predicate: string }[];
    };
    assert.equal(record.status, "current");
    assert.ok(
      record.facts.some((f) => f.predicate === "ownership.owner_of_record"),
    );
    assert.equal(
      (await post(`${base}/v1/registry/get`, { urn: "fl:parcel:us-48999:404" }))
        .status,
      404,
    );

    const client = new Client({ name: "registry-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(
      names.includes("registry_get") && names.includes("registry_owned_by"),
    );
    const owned = (await client.callTool({
      name: "registry_owned_by",
      arguments: { entity_urn: "fl:entity:us-tx:0801111111" },
    })) as { structuredContent?: { results: { urn: string }[] } };
    assert.deepEqual(
      owned.structuredContent?.results.map((r) => r.urn),
      [urn],
    );
    await client.close();
  } finally {
    configureRegistry(undefined);
    if (saved !== undefined) process.env.FACTLOT_REGISTRY_DB = saved;
    await close();
  }
});

test("named API keys resolve to a key name and unknown keys are rejected", async () => {
  const lines: string[] = [];
  const { base, close } = await start({
    apiKey: "legacy",
    apiKeys: [
      { key: "k-a", name: "tenant-a" },
      { key: "k-b", name: "tenant-b" },
    ],
    log: "json",
    logSink: (l) => lines.push(l),
  });
  const body = { urn: "fl:parcel:us-06037:1" };
  for (const [token, status] of [
    ["legacy", 200],
    ["k-a", 200],
    ["k-b", 200],
    ["k-", 401],
    ["K-A", 401],
  ] as const) {
    const r = await post(`${base}/v1/id/parse`, body, {
      authorization: `Bearer ${token}`,
    });
    assert.equal(r.status, status, token);
    if (status === 401)
      assert.equal(r.headers.get("www-authenticate"), 'Bearer realm="factlot"');
  }
  assert.equal((await post(`${base}/mcp`, {})).status, 401);
  assert.equal(
    (await post(`${base}/mcp`, {}, { authorization: "Basic k-a" })).status,
    401,
  );
  await close();
  const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(
    logged.map((l) => l.key),
    ["default", "tenant-a", "tenant-b", null, null, null, null],
  );
  assert.ok(
    !lines.some((l) => l.includes("k-a") || l.includes("legacy")),
    "full keys are never logged",
  );
  assert.equal(logged[3]?.key_prefix, "…", "rejected tokens log a prefix only");
});

test("per-key rate limit returns 429 with Retry-After on REST and MCP", async () => {
  let clock = Date.UTC(2026, 10, 2, 14, 0, 0) + 5_000;
  const { base, close } = await start({
    apiKeys: [
      { key: "k-a", name: "tenant-a", rateLimitPerMinute: 2 },
      { key: "k-b", name: "tenant-b" },
    ],
    rateLimitPerMinute: 3,
    now: () => clock,
  });
  const call = (token: string, path = "/v1/id/parse") =>
    post(
      `${base}${path}`,
      { urn: "fl:parcel:us-06037:1" },
      {
        authorization: `Bearer ${token}`,
      },
    );

  const first = await call("k-a");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-ratelimit-limit"), "2");
  assert.equal(first.headers.get("x-ratelimit-remaining"), "1");
  assert.equal((await call("k-a")).status, 200);
  const limited = await call("k-a");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "55");
  assert.deepEqual(await limited.json(), {
    error: "RateLimited",
    message: "rate limit of 2 requests per minute exceeded; retry in 55s",
    retry_after_seconds: 55,
  });

  // The same key over /mcp shares the window and gets a JSON-RPC error body.
  const mcp = await post(
    `${base}/mcp`,
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { authorization: "Bearer k-a" },
  );
  assert.equal(mcp.status, 429);
  assert.equal(mcp.headers.get("retry-after"), "55");
  const rpc = (await mcp.json()) as {
    jsonrpc: string;
    error: { code: number; data: { retry_after_seconds: number } };
    id: null;
  };
  assert.equal(rpc.jsonrpc, "2.0");
  assert.equal(rpc.error.code, -32000);
  assert.equal(rpc.error.data.retry_after_seconds, 55);
  assert.equal(rpc.id, null);

  // Another key uses the server default (3) and its own window.
  for (let i = 0; i < 3; i++) assert.equal((await call("k-b")).status, 200);
  assert.equal((await call("k-b")).status, 429);

  // Discovery is never rate limited; the next minute resets the window.
  assert.equal((await fetch(`${base}/health`)).status, 200);
  clock += 60_000;
  assert.equal((await call("k-a")).status, 200);
  await close();
});

test("rate limit without keys buckets everyone as anonymous", async () => {
  const { base, close } = await start({ rateLimitPerMinute: 1 });
  assert.equal(
    (await post(`${base}/v1/id/parse`, { urn: "fl:parcel:us-06037:1" })).status,
    200,
  );
  const r = await post(`${base}/v1/id/parse`, { urn: "fl:parcel:us-06037:1" });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  await close();
});

test("usage metering counts REST and MCP tool calls per key and serves /v1/usage", async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "factlot-usage-")), "u.jsonl");
  const { UsageMeter } = await import("./usage.ts");
  const usage = new UsageMeter({ file });
  const { base, close } = await start({
    apiKeys: [
      { key: "k-a", name: "tenant-a" },
      { key: "k-b", name: "tenant-b" },
    ],
    adminKey: "admin-secret",
    usage,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  assert.equal(
    (
      await post(
        `${base}/v1/calc/percentage_rent`,
        { gross_sales: 5_000_000, rate: 0.06, base_rent_annual: 240_000 },
        auth("k-a"),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        `${base}/v1/calc/percentage_rent`,
        { gross_sales: -1 },
        auth("k-a"),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        `${base}/v1/id/parse`,
        { urn: "fl:parcel:us-06037:1" },
        auth("k-b"),
      )
    ).status,
    200,
  );
  // Rejected and rate-limited requests are not metered; neither are non-tool routes.
  assert.equal(
    (await post(`${base}/v1/id/parse`, {}, auth("nope"))).status,
    401,
  );
  assert.equal(
    (await fetch(`${base}/v1/tools`, { headers: auth("k-a") })).status,
    200,
  );

  const client = new Client({ name: "usage-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: auth("k-b") },
    }),
  );
  await client.listTools();
  await client.callTool({
    name: "id_parse",
    arguments: { urn: "fl:parcel:us-06037:1" },
  });
  await client.close();

  // Admin endpoint: disabled without a key, 401 with the wrong one, data with the right one.
  assert.equal((await fetch(`${base}/v1/usage`)).status, 401);
  assert.equal(
    (await fetch(`${base}/v1/usage`, { headers: auth("k-a") })).status,
    401,
    "an API key is not an admin key",
  );
  assert.equal(
    (
      await fetch(`${base}/v1/usage`, {
        method: "POST",
        headers: auth("admin-secret"),
      })
    ).status,
    405,
  );
  const report = (await (
    await fetch(`${base}/v1/usage`, { headers: auth("admin-secret") })
  ).json()) as {
    key: null;
    hour: {
      keys: Record<
        string,
        {
          calls: number;
          errors: number;
          tools: Record<
            string,
            { calls: number; errors: number; duration_ms: number }
          >;
        }
      >;
    };
    day: { keys: Record<string, { calls: number }> };
  };
  assert.equal(report.key, null);
  assert.deepEqual(report.hour.keys["tenant-a"]?.tools, {
    calc_percentage_rent: {
      calls: 2,
      errors: 1,
      duration_ms:
        report.hour.keys["tenant-a"]?.tools.calc_percentage_rent?.duration_ms,
    },
  });
  assert.equal(report.hour.keys["tenant-a"]?.calls, 2);
  assert.equal(report.hour.keys["tenant-a"]?.errors, 1);
  const b = report.hour.keys["tenant-b"];
  assert.equal(
    b?.tools.id_parse?.calls,
    2,
    "REST + MCP calls of the same tool",
  );
  assert.equal(b?.tools["mcp:tools/list"]?.calls, 1);
  assert.equal(b?.tools["mcp:initialize"]?.calls, 1);
  assert.equal(b?.tools["mcp:notifications/initialized"], undefined);
  assert.equal(report.day.keys["tenant-b"]?.calls, b?.calls);
  assert.equal(report.hour.keys.anonymous, undefined);

  const filtered = (await (
    await fetch(`${base}/v1/usage?key=tenant-a`, {
      headers: auth("admin-secret"),
    })
  ).json()) as { key: string; hour: { keys: Record<string, unknown> } };
  assert.equal(filtered.key, "tenant-a");
  assert.deepEqual(Object.keys(filtered.hour.keys), ["tenant-a"]);

  await close();
  await usage.flush();
  const lines = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.equal(lines.length, 6);
  assert.deepEqual(Object.keys(lines[0] ?? {}), [
    "time",
    "key",
    "tool",
    "surface",
    "status",
    "duration_ms",
  ]);
  assert.deepEqual(
    lines.map((l) => [l.key, l.tool, l.surface, l.status]),
    [
      ["tenant-a", "calc_percentage_rent", "rest", 200],
      ["tenant-a", "calc_percentage_rent", "rest", 400],
      ["tenant-b", "id_parse", "rest", 200],
      ["tenant-b", "mcp:initialize", "mcp", 200],
      ["tenant-b", "mcp:tools/list", "mcp", 200],
      ["tenant-b", "id_parse", "mcp", 200],
    ],
  );

  const disabled = await start({ apiKeys: [{ key: "k", name: "k" }] });
  assert.equal(
    (await fetch(`${disabled.base}/v1/usage`, { headers: auth("k") })).status,
    404,
  );
  await disabled.close();
});

test("FACTLOT_LOG=json writes one JSON line per request", async () => {
  const lines: string[] = [];
  const { base, close } = await start({
    apiKeys: [{ key: "k-a", name: "tenant-a" }],
    log: "json",
    logSink: (l) => lines.push(l),
    now: () => Date.UTC(2026, 10, 2, 14, 3, 7, 412),
  });
  await post(
    `${base}/v1/calc/percentage_rent`,
    { gross_sales: 5_000_000, rate: 0.06, base_rent_annual: 240_000 },
    { authorization: "Bearer k-a" },
  );
  await fetch(`${base}/health`);
  await post(`${base}/v1/id/parse`, {});
  await close();
  assert.equal(lines.length, 3);
  const [tool, health, denied] = lines.map(
    (l) => JSON.parse(l) as Record<string, unknown>,
  );
  assert.deepEqual(tool, {
    time: "2026-11-02T14:03:07.412Z",
    msg: "request",
    method: "POST",
    path: "/v1/calc/percentage_rent",
    tool: "calc_percentage_rent",
    key: "tenant-a",
    status: 200,
    duration_ms: tool?.duration_ms,
  });
  assert.equal(typeof tool?.duration_ms, "number");
  assert.deepEqual(
    { ...health, duration_ms: 0 },
    {
      time: "2026-11-02T14:03:07.412Z",
      msg: "request",
      method: "GET",
      path: "/health",
      tool: null,
      key: null,
      status: 200,
      duration_ms: 0,
    },
  );
  assert.equal(denied?.status, 401);
  assert.equal(denied?.key, null);
  assert.equal(denied?.tool, null);
});

test("no request log unless log is json", async () => {
  const lines: string[] = [];
  const { base, close } = await start({ logSink: (l) => lines.push(l) });
  await fetch(`${base}/health`);
  await close();
  assert.deepEqual(lines, []);
});

test("request and usage logs carry metadata only: no body, arguments, or results", async () => {
  // docs/customer-documents.md, "Logging": document contents never appear in logs. A sentinel
  // travels in every kind of request body; it must not reach any log line, and the line
  // schema must have no field that could carry it.
  const sentinel = "SENTINEL-lease-text-0f3a9c";
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "factlot-usage-")), "u.jsonl");
  const usage = new UsageMeter({ file });
  const lines: string[] = [];
  const { base, close } = await start({
    apiKeys: [{ key: "k-a", name: "tenant-a" }],
    log: "json",
    logSink: (l) => lines.push(l),
    usage,
  });
  // REST: a valid call and a rejected one, both with the sentinel in the body.
  await post(
    `${base}/v1/calc/percentage_rent`,
    {
      gross_sales: 5_000_000,
      rate: 0.06,
      base_rent_annual: 240_000,
      note: sentinel,
    },
    { authorization: "Bearer k-a" },
  );
  await post(
    `${base}/v1/id/parse`,
    { id: sentinel },
    { authorization: "Bearer k-a" },
  );
  // MCP: tool arguments carrying the sentinel.
  await post(
    `${base}/mcp`,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "id_parse", arguments: { id: sentinel } },
    },
    {
      authorization: "Bearer k-a",
      accept: "application/json, text/event-stream",
    },
  );
  // Unauthenticated, with the sentinel as the bearer token and in the body.
  await post(
    `${base}/v1/id/parse`,
    { id: sentinel },
    { authorization: `Bearer ${sentinel}` },
  );
  await close();
  await usage.flush();
  const usageLines = readFileSync(file, "utf8").split("\n").filter(Boolean);

  assert.equal(lines.length, 4);
  const forbidden = [
    "body",
    "arguments",
    "params",
    "input",
    "result",
    "content",
    "headers",
    "authorization",
  ];
  for (const line of [...lines, ...usageLines]) {
    assert.ok(
      !line.includes(sentinel),
      `log line carries request content: ${line}`,
    );
    const keys = Object.keys(JSON.parse(line) as Record<string, unknown>);
    for (const k of keys) assert.ok(!forbidden.includes(k), `log field ${k}`);
  }
  for (const line of lines) {
    const keys = Object.keys(JSON.parse(line) as Record<string, unknown>);
    for (const k of keys)
      assert.ok(
        (REQUEST_LOG_FIELDS as readonly string[]).includes(k),
        `unexpected log field ${k}`,
      );
  }
  for (const f of forbidden)
    assert.ok(!(REQUEST_LOG_FIELDS as readonly string[]).includes(f));
  assert.ok(usageLines.length >= 3);
});

test("forwarded headers are ignored unless trustProxy is set, and Host is validated", async () => {
  const { base, close } = await start();
  try {
    const doc = (await (
      await fetch(`${base}/openapi.json`, {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "evil.example",
        },
      })
    ).json()) as { servers: { url: string }[] };
    assert.equal(doc.servers[0]?.url, base);
  } finally {
    await close();
  }
  const proxied = await start({ trustProxy: true });
  try {
    const doc = (await (
      await fetch(`${proxied.base}/openapi.json`, {
        headers: { "x-forwarded-host": "evil.example/x?y=<script>" },
      })
    ).json()) as { servers: { url: string }[] };
    assert.equal(doc.servers[0]?.url, "http://localhost");
  } finally {
    await proxied.close();
  }
});

test("every response carries security headers and no-store", async () => {
  const { base, close } = await start();
  try {
    for (const r of [
      await fetch(`${base}/health`),
      await fetch(`${base}/openapi.json`),
      await post(`${base}/v1/calc/npv`, { cash_flows: [-1, 2], rate: 0.1 }),
      await fetch(`${base}/nope`),
    ]) {
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("x-frame-options"), "DENY");
      assert.match(
        r.headers.get("content-security-policy") ?? "",
        /default-src 'none'/,
      );
      await r.arrayBuffer();
    }
  } finally {
    await close();
  }
});

test("wrong methods get 405 with Allow; unknown routes 404 without echoing long paths", async () => {
  const { base, close } = await start();
  try {
    const put = await fetch(`${base}/health`, { method: "PUT" });
    assert.equal(put.status, 405);
    assert.equal(put.headers.get("allow"), "GET, OPTIONS");
    const get = await fetch(`${base}/v1/calc/irr`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST, OPTIONS");
    const del = await fetch(`${base}/mcp`, { method: "DELETE" });
    assert.equal(del.status, 405);
    const long = await fetch(`${base}/${"a".repeat(5000)}`);
    assert.equal(long.status, 404);
    const body = (await long.json()) as { message: string };
    assert.ok(body.message.length < 300);
  } finally {
    await close();
  }
});

test("per-IP limit applies to every route, before auth", async () => {
  const { base, close } = await start({
    rateLimitPerIpPerMinute: 2,
    apiKeys: [{ key: "k".repeat(24), name: "a" }],
    now: () => 1_000_000,
  });
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await post(`${base}/v1/id/parse`, {})).status, 401);
    const third = await fetch(`${base}/health`);
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get("retry-after")) >= 1);
  } finally {
    await close();
  }
});

test("rejected tokens are limited per IP, on tool routes and /v1/usage", async () => {
  const good = "g".repeat(24);
  const { base, close } = await start({
    apiKeys: [{ key: good, name: "a" }],
    adminKey: "a".repeat(24),
    authFailuresPerIpPerMinute: 3,
    now: () => 1_000_000,
  });
  const auth = (k: string) => ({ authorization: `Bearer ${k}` });
  try {
    assert.equal(
      (await post(`${base}/v1/id/parse`, { urn: "x" }, auth(good))).status,
      400,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await post(`${base}/v1/id/parse`, {}, auth(`wrong${i}`))).status,
        401,
      );
    assert.equal(
      (await fetch(`${base}/v1/usage`, { headers: auth("nope") })).status,
      401,
    );
    // Budget spent: even the right key waits, so guessing gets no answer.
    const blocked = await post(`${base}/v1/id/parse`, { urn: "x" }, auth(good));
    assert.equal(blocked.status, 429);
    const mcp = await post(`${base}/mcp`, {}, auth(good));
    assert.equal(mcp.status, 429);
    assert.equal(((await mcp.json()) as { jsonrpc: string }).jsonrpc, "2.0");
  } finally {
    await close();
  }
});

test("oversized and over-deep bodies are refused before any tool runs", async () => {
  const { base, close } = await start();
  try {
    const declared = await fetch(`${base}/v1/calc/npv`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[" + "1,".repeat(600_000) + "1]",
    });
    assert.equal(declared.status, 413);
    assert.equal(
      ((await declared.json()) as { error: string }).error,
      "PayloadTooLarge",
    );

    const huge = await post(`${base}/v1/calc/irr`, {
      cash_flows: [-1, ...new Array(20_000).fill(1)],
    });
    assert.equal(huge.status, 400);
    assert.equal(
      ((await huge.json()) as { error: string }).error,
      "CalcInputError",
    );

    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    const mcpDeep = await post(`${base}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "fact_validate", arguments: { fact: { v: deep } } },
    });
    assert.equal(mcpDeep.status, 400);
    assert.match(
      ((await mcpDeep.json()) as { error: { message: string } }).error.message,
      /nested deeper/,
    );

    const batch = await post(
      `${base}/mcp`,
      Array.from({ length: 21 }, (_, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: "tools/list",
      })),
      { accept: "application/json, text/event-stream" },
    );
    assert.equal(batch.status, 400);
    await batch.arrayBuffer();
  } finally {
    await close();
  }
});

test("the Node server sets request, header and keep-alive timeouts", () => {
  const server = createFactLotServer();
  assert.equal(server.requestTimeout, SERVER_TIMEOUTS.requestTimeoutMs);
  assert.equal(server.headersTimeout, SERVER_TIMEOUTS.headersTimeoutMs);
  assert.equal(server.keepAliveTimeout, SERVER_TIMEOUTS.keepAliveTimeoutMs);
});

test("unexpected errors answer 500 (REST) or InternalError (MCP) without detail, and log only the name", async () => {
  const lines: string[] = [];
  const spec = tools.find((t) => t.name === "calc_npv");
  assert.ok(spec);
  const original = spec.run;
  spec.run = () => {
    throw new TypeError("secret /internal/path detail");
  };
  const { base, close } = await start({ errorSink: (l) => lines.push(l) });
  try {
    const r = await post(`${base}/v1/calc/npv`, {
      cash_flows: [-1, 2],
      rate: 0.1,
    });
    assert.equal(r.status, 500);
    assert.doesNotMatch(await r.text(), /secret|internal/);
    assert.equal(lines.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(lines[0] as string)), [
      "time",
      "msg",
      "method",
      "path",
      "error",
    ]);
    assert.doesNotMatch(lines[0] as string, /secret|internal/);

    const client = new Client({ name: "err-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
    );
    const m = (await client.callTool({
      name: "calc_npv",
      arguments: { cash_flows: [-1, 2], rate: 0.1 },
    })) as { isError?: boolean; content: { text: string }[] };
    assert.equal(m.isError, true);
    assert.doesNotMatch(m.content[0]?.text ?? "", /secret|internal/);
    await client.close();
  } finally {
    spec.run = original;
    await close();
  }
});
