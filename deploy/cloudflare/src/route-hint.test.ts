import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tools } from "@factlot/tools";

import {
  isPaidRoute,
  routeHint,
  routeKey,
  withRouteHint,
} from "./route-hint.ts";

const ON = { reports: true, model: true };

describe("routeHint: near misses of /v1/ paths", () => {
  const cases: [string, string | undefined][] = [
    // Separators: slashes, hyphens, underscores, dots and case.
    [
      "/v1/rules/tx/property-tax-protest-deadline",
      "POST /v1/rules/tx_property_tax_protest_deadline",
    ],
    ["/v1/registry/search-address", "POST /v1/registry/search_address"],
    ["/v1/Registry/Owned_By", "POST /v1/registry/owned_by"],
    ["/v1/calc-npv", "POST /v1/calc/npv"],
    [
      "/v1/registry/tx-equity-candidates-batch",
      "POST /v1/registry/tx_equity_candidates/batch",
    ],
    // A tool name used as a path.
    ["/v1/report_create", "POST /v1/reports"],
    ["/v1/registry_get", "POST /v1/registry/get"],
    ["/v1/fact_validate", "POST /v1/facts/validate"],
    ["/v1/fact_package_create", "POST /v1/facts/package"],
    [
      "/v1/rules_tx_property_tax_protest_deadline",
      "POST /v1/rules/tx_property_tax_protest_deadline",
    ],
    // Hosted routes that are not tools.
    ["/v1/plan", undefined],
    ["/v1/Plans", "GET /v1/plans"],
    // No guessing beyond separators and names.
    ["/v1/registry/serch_address", undefined],
    ["/v1/report", undefined],
    ["/v1/registry/get/extra", undefined],
    ["/v1/nothing", undefined],
    ["/mcp_server", undefined],
  ];
  for (const [path, want] of cases)
    it(`${path} -> ${want ?? "no hint"}`, () => {
      const r = routeHint(path);
      assert.equal(r && `${r.method} ${r.path}`, want);
    });

  it("a real path is never a near miss of itself", () => {
    for (const t of tools) assert.equal(routeHint(t.path), undefined, t.path);
    assert.equal(routeHint("/v1/reports"), undefined);
  });

  it("every tool name and every tool path, however separated, leads to the tool's path", () => {
    for (const t of tools) {
      const byName = routeHint(`/v1/${t.name}`);
      if (`/v1/${t.name}` !== t.path)
        assert.equal(byName?.path, t.path, t.name);
      const hyphens = t.path.replaceAll("_", "-");
      if (hyphens !== t.path)
        assert.equal(routeHint(hyphens)?.path, t.path, hyphens);
    }
  });

  it("names reports and model-backed routes only while they answer, as /openapi.json lists them", () => {
    const off = { reports: false, model: false };
    assert.equal(routeHint("/v1/report_create", off), undefined);
    assert.equal(routeHint("/v1/doc_extract_lease", off), undefined);
    assert.equal(routeHint("/v1/report-narrative", off), undefined);
    assert.equal(routeHint("/v1/registry_get", off)?.path, "/v1/registry/get");
    assert.equal(
      routeHint("/v1/doc_extract_lease", { reports: false, model: true })?.path,
      "/v1/doc/extract_lease",
    );
    assert.equal(
      routeHint("/v1/report_create", { reports: true, model: false })?.path,
      "/v1/reports",
    );
  });

  it("routeKey normalises case, /v1/ and separators only", () => {
    assert.equal(
      routeKey("/v1/Rules/TX/property-tax.protest__deadline/"),
      "rules_tx_property_tax_protest_deadline",
    );
    assert.equal(routeKey("registry_get"), "registry_get");
  });
});

describe("withRouteHint", () => {
  const notFound = (path: string) =>
    new Response(
      JSON.stringify({
        error: "NotFound",
        message: `no route for POST ${path}`,
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );

  it("adds did_you_mean and next, and names the route in the message", async () => {
    const res = await withRouteHint(
      notFound("/v1/registry_get"),
      "/v1/registry_get",
      "https://api.factlot.com",
      ON,
    );
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.deepEqual(await res.json(), {
      error: "NotFound",
      message:
        "no route for POST /v1/registry_get. Did you mean POST /v1/registry/get? Every route: https://api.factlot.com/openapi.json",
      did_you_mean: "POST /v1/registry/get",
      next: "POST https://api.factlot.com/v1/registry/get",
    });
  });

  it("says when the route it names needs a Pro or Team key", async () => {
    const res = await withRouteHint(
      notFound("/v1/registry_lookup_batch"),
      "/v1/registry_lookup_batch",
      "https://api.factlot.com",
      ON,
    );
    const b = (await res.json()) as Record<string, string>;
    assert.equal(b.did_you_mean, "POST /v1/registry/lookup/batch");
    assert.equal(b.needs, "a Pro or Team key");
    assert.match(b.message!, /\(it needs a Pro or Team key\)\?/);
    for (const t of tools)
      assert.equal(
        isPaidRoute(t.path),
        t.name.endsWith("_batch") && t.name.startsWith("registry_")
          ? true
          : t.name === "registry_recorded_facts",
        t.name,
      );
    const free = (await (
      await withRouteHint(
        notFound("/v1/registry_get"),
        "/v1/registry_get",
        "https://x",
        ON,
      )
    ).json()) as Record<string, string>;
    assert.equal(free.needs, undefined);
  });

  it("leaves other answers alone: not a near miss, not a 404, not JSON", async () => {
    const plain = notFound("/v1/nothing");
    assert.equal(
      await withRouteHint(plain, "/v1/nothing", "https://x", ON),
      plain,
    );
    const ok = new Response("{}", { status: 200 });
    assert.equal(
      await withRouteHint(ok, "/v1/registry_get", "https://x", ON),
      ok,
    );
    const text = new Response("not json", { status: 404 });
    assert.equal(
      await withRouteHint(text, "/v1/registry_get", "https://x", ON),
      text,
    );
  });
});
