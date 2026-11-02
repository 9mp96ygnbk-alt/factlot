import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tools } from "@factlot/tools";

import { createFactLotServer } from "./index.ts";
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
  for (const t of tools) assert.ok(names.includes(t.name), t.name);
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
  const { base, close } = await start();
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
  assert.ok((await client.listTools()).tools.length > tools.length);
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
