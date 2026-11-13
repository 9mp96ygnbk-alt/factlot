// Requests built for the inner handler carry a Host header (internal.ts), and hostedRegions
// reports a failed read instead of hiding it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostedRegions, resetCoverageCache } from "./account-tools.ts";
import { innerRequest } from "./internal.ts";

/** An inner handler as the runtime's node:http server runs it: an empty 400 without a Host header. */
function strictInner(answer: unknown) {
  const seen: (string | null)[] = [];
  return {
    seen,
    api: {
      fetch: async (r: Request) => {
        seen.push(r.headers.get("host"));
        if (!r.headers.get("host")) return new Response(null, { status: 400 });
        return new Response(JSON.stringify(answer), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  };
}

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

  it("hostedRegions reads the coverage through a server that requires Host", async () => {
    resetCoverageCache();
    const { api, seen } = strictInner({
      counties: [
        { state: "TX", parcels: 10, sources: [{ as_of: "2026-07-25" }] },
        { state: "MD", parcels: 5, sources: [{ as_of: "2026-07-01" }] },
      ],
    });
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
    const down = {
      fetch: async () => new Response("no", { status: 503 }),
    };
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
    // Not cached: the next call reads again and gets the regions.
    const { api } = strictInner({ counties: [{ state: "TX", parcels: 1 }] });
    assert.equal(
      (await hostedRegions(api, "https://api.factlot.com", 3)).length,
      1,
    );
    resetCoverageCache();
  });
});
