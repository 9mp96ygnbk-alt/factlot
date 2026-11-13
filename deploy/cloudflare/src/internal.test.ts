// Requests built for the inner handler carry a Host header (internal.ts); without one the inner
// handler's MCP transport answers an empty 400. hostedRegions reports a failed read instead of
// hiding it.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { describe, it } from "node:test";

import { createHandler } from "@factlot/server";

import { hostedRegions, resetCoverageCache } from "./account-tools.ts";
import { innerRequest } from "./internal.ts";
import { asCaller } from "./property-sheet.ts";

/**
 * Send one raw HTTP/1.1 request to the inner handler (the real @factlot/server handler, as worker.ts
 * runs it, on a server that, like the Workers runtime's node:http, does not itself refuse a request
 * without Host), and return the status line and the body.
 */
async function raw(
  lines: string[],
  body: string,
): Promise<{ status: number; body: string }> {
  const handler = createHandler({
    maxBodyBytes: 1024 * 1024,
    trustProxy: true,
    hosted: true,
    logSink: () => {},
  });
  const server = createServer(
    { requireHostHeader: false },
    (req, res) => void handler(req, res),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let out = "";
      socket.on("data", (d) => (out += d.toString()));
      socket.on("end", () => resolve(out));
      socket.on("error", reject);
      socket.write(
        [
          ...lines,
          `content-length: ${Buffer.byteLength(body)}`,
          "connection: close",
          "",
          body,
        ].join("\r\n"),
      );
    });
    const at = text.indexOf("\r\n\r\n");
    const head = text.slice(0, at);
    let content = text.slice(at + 4);
    if (/transfer-encoding: chunked/i.test(head)) {
      // Decode the chunks: size line, data, until the zero-size chunk.
      let out = "";
      for (;;) {
        const nl = content.indexOf("\r\n");
        const size = parseInt(content.slice(0, nl), 16);
        if (!size) break;
        out += content.slice(nl + 2, nl + 2 + size);
        content = content.slice(nl + 2 + size + 2);
      }
      content = out;
    }
    return {
      status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0),
      body: content,
    };
  } finally {
    server.close();
  }
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
});
const mcpLines = (host?: string) => [
  "POST /mcp HTTP/1.1",
  ...(host ? [`host: ${host}`] : []),
  "content-type: application/json",
  "accept: application/json, text/event-stream",
];

async function errors(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return lines;
}

describe("requests built for the inner handler", () => {
  it("the inner handler's MCP transport answers an empty 400 without Host; REST does not need it", async () => {
    const without = await raw(mcpLines(), initialize);
    assert.equal(without.status, 400);
    assert.equal(without.body, "", "empty: not one of FactLot's own errors");
    const withHost = await raw(mcpLines("api.factlot.com"), initialize);
    assert.equal(withHost.status, 200);
    const rest = await raw(
      ["POST /v1/calc/npv HTTP/1.1", "content-type: application/json"],
      JSON.stringify({ rate: 0.08, cash_flows: [-100, 60, 60] }),
    );
    assert.equal(rest.status, 200, "a REST route answers without Host");
  });

  it("innerRequest sets Host from the URL and keeps method, headers and body", async () => {
    const r = innerRequest("https://api.factlot.com/v1/registry/coverage", {
      method: "POST",
      headers: { "content-type": "application/json", host: "evil.example" },
      body: "{}",
    });
    assert.equal(r.headers.get("host"), "api.factlot.com");
    assert.equal(r.method, "POST");
    assert.equal(r.headers.get("content-type"), "application/json");
    assert.equal(await r.text(), "{}");
    assert.equal(
      innerRequest("http://127.0.0.1:8787/x").headers.get("host"),
      "127.0.0.1:8787",
    );
  });

  it("asCaller builds the property sheet's /mcp call with the host and only the caller's identity", async () => {
    const client = new Request(
      "https://factlot.com/property/us-48999/1/sheet",
      {
        headers: {
          authorization: "Bearer fl_live_x",
          "cf-connecting-ip": "203.0.113.9",
          cookie: "a=b",
        },
      },
    );
    const r = asCaller(client, new URL(client.url), "{}");
    assert.equal(r.url, "https://factlot.com/mcp");
    assert.equal(r.method, "POST");
    assert.equal(r.headers.get("host"), "factlot.com");
    assert.equal(r.headers.get("authorization"), "Bearer fl_live_x");
    assert.equal(r.headers.get("cf-connecting-ip"), "203.0.113.9");
    assert.equal(r.headers.get("cookie"), null);
    assert.equal(await r.text(), "{}");
  });

  it("hostedRegions reads the coverage with the API host", async () => {
    resetCoverageCache();
    const seen: (string | null)[] = [];
    const api = {
      fetch: async (r: Request) => {
        seen.push(r.headers.get("host"));
        return new Response(
          JSON.stringify({
            counties: [
              { state: "TX", parcels: 10, sources: [{ as_of: "2026-07-25" }] },
              { state: "MD", parcels: 5, sources: [{ as_of: "2026-07-01" }] },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    };
    const logged = await errors(async () => {
      const regions = await hostedRegions(api, "https://api.factlot.com", 1);
      assert.deepEqual(
        regions.map((r) => r.state),
        ["MD", "TX"],
      );
    });
    assert.deepEqual(seen, ["api.factlot.com"]);
    assert.deepEqual(logged, []);
    resetCoverageCache();
  });

  it("hostedRegions logs a failed read, returns no regions, and does not cache the failure", async () => {
    resetCoverageCache();
    const down = { fetch: async () => new Response("no", { status: 503 }) };
    const logged = await errors(async () => {
      assert.deepEqual(
        await hostedRegions(down, "https://api.factlot.com", 1),
        [],
      );
    });
    assert.equal(logged.length, 1);
    assert.deepEqual(JSON.parse(logged[0]!), {
      msg: "hosted regions unavailable",
      status: 503,
    });
    const thrown = {
      fetch: async (): Promise<Response> => {
        throw new Error("binding gone");
      },
    };
    const logged2 = await errors(async () => {
      assert.deepEqual(
        await hostedRegions(thrown, "https://api.factlot.com", 2),
        [],
      );
    });
    assert.match(logged2[0] ?? "", /hosted regions unavailable/);
    const ok = {
      fetch: async () =>
        new Response(
          JSON.stringify({ counties: [{ state: "TX", parcels: 1 }] }),
        ),
    };
    assert.equal(
      (await hostedRegions(ok, "https://api.factlot.com", 3)).length,
      1,
      "the failure was not cached",
    );
    resetCoverageCache();
  });
});
