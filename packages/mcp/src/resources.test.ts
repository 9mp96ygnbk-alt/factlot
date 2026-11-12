import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  DEAL_CALCULATORS,
  HOSTED_MCP_URL,
  PROMPT_ARGS,
  RESOURCES_INSTRUCTIONS,
  RESOURCE_DATA,
  RESOURCE_NOT_FOUND,
  SERVER_INSTRUCTIONS,
  createServer,
  promptText,
  type CreateServerOptions,
  type PromptName,
  type ResourceData,
} from "./index.ts";
import {
  catalogSourceId,
  coverageResource,
  marketResource,
  marketsIndex,
  placeResource,
} from "./resources.ts";

const read = (rel: string) =>
  readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");

async function connect(opts: CreateServerOptions = {}): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await createServer(opts).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

const body = async (client: Client, uri: string) => {
  const r = await client.readResource({ uri });
  assert.equal(r.contents.length, 1, uri);
  const c = r.contents[0]!;
  assert.equal(c.uri, uri);
  return c as { uri: string; mimeType?: string; text: string };
};

const hostedJson = JSON.parse(
  read("site/_data/hosted.json"),
) as ResourceData["hosted"];

/** RESOURCE_DATA with one market's place added to the hosted pack, for the market resources. */
function withMarketHosted(): ResourceData {
  const m = RESOURCE_DATA.markets[0]!;
  return {
    ...RESOURCE_DATA,
    hosted: {
      ...RESOURCE_DATA.hosted,
      places: [
        // The test's own figures for the place, whether or not the pack already serves it.
        ...RESOURCE_DATA.hosted.places.filter((p) => p.key !== m.place),
        {
          key: m.place,
          counties: ["36061"],
          names: ["New York County"],
          parcels: 4321,
          buildings: 21,
          as_of: "2026-11-02",
        },
      ],
      entity_registries: [
        ...RESOURCE_DATA.hosted.entity_registries.filter(
          (r) => r.jurisdiction !== m.entity?.jurisdiction,
        ),
        ...(m.entity
          ? [
              {
                jurisdiction: m.entity.jurisdiction,
                entities: 765,
                total: 9876,
              },
            ]
          : []),
      ],
    },
  };
}

describe("MCP resources", () => {
  test("capabilities declare resources and prompts; the instructions name them", async () => {
    const client = await connect();
    const caps = client.getServerCapabilities();
    assert.ok(caps?.resources, "resources capability");
    assert.ok(caps?.prompts, "prompts capability");
    assert.ok(caps?.tools, "tools capability");
    assert.ok(SERVER_INSTRUCTIONS.endsWith(RESOURCES_INSTRUCTIONS));
    for (const name of Object.keys(PROMPT_ARGS))
      assert.ok(RESOURCES_INSTRUCTIONS.includes(name), name);
    const { resources } = await client.listResources();
    for (const uri of RESOURCES_INSTRUCTIONS.match(/factlot:\/\/[a-z/]+/g)!)
      assert.ok(
        resources.some((r) => r.uri === uri),
        `${uri} is named in the instructions but not listed`,
      );
  });

  for (const opts of [
    { localFiles: true },
    { hosted: true, registry: true },
    {},
  ] as CreateServerOptions[])
    test(`every listed resource reads, and the list stays short (${JSON.stringify(opts)})`, async () => {
      const client = await connect(opts);
      const { resources } = await client.listResources();
      assert.ok(resources.length >= 7, "the static resources");
      assert.ok(resources.length < 60, `${resources.length} listed`);
      assert.equal(
        new Set(resources.map((r) => r.uri)).size,
        resources.length,
        "no URI listed twice",
      );
      for (const r of resources) {
        assert.match(r.uri, /^factlot:\/\//);
        assert.ok(r.title && r.mimeType, r.uri);
        const c = await body(client, r.uri);
        assert.equal(c.mimeType, r.mimeType, r.uri);
        assert.ok(c.text.length > 0, r.uri);
        if (c.mimeType === "application/json") JSON.parse(c.text);
      }
      const { resourceTemplates } = await client.listResourceTemplates();
      assert.deepEqual(resourceTemplates.map((t) => t.uriTemplate).sort(), [
        "factlot://coverage/{place}",
        "factlot://markets/{slug}",
        "factlot://schemas/tools/{tool}",
        "factlot://sources/{source_id}",
      ]);
    });

  test("completion: an argument name from Object.prototype completes nothing", async () => {
    const client = await connect({ hosted: true });
    const templates = {
      "factlot://coverage/{place}": "place",
      "factlot://sources/{source_id}": "source_id",
      "factlot://markets/{slug}": "slug",
      "factlot://schemas/tools/{tool}": "tool",
    };
    for (const [uri, real] of Object.entries(templates)) {
      for (const name of [
        "toString",
        "constructor",
        "__proto__",
        "valueOf",
        "hasOwnProperty",
      ]) {
        const r = await client.complete({
          ref: { type: "ref/resource", uri },
          argument: { name, value: "" },
        });
        assert.deepEqual(r.completion.values, [], `${uri} ${name}`);
      }
      const ok = await client.complete({
        ref: { type: "ref/resource", uri },
        argument: { name: real, value: "" },
      });
      assert.ok(Array.isArray(ok.completion.values), uri);
    }
  });

  for (const opts of [
    { registry: false, localFiles: true },
    { registry: true, localFiles: true },
    { registry: false },
    { hosted: true, registry: true },
  ] as CreateServerOptions[])
    test(`the tool index lists exactly what tools/list lists (${JSON.stringify(opts)})`, async () => {
      const client = await connect(opts);
      const { tools } = await client.listTools();
      const index = JSON.parse(
        (await body(client, "factlot://schemas/tools")).text,
      ) as { about: string; tools: { name: string; uri: string }[] };
      assert.deepEqual(
        index.tools.map((t) => t.name).sort(),
        tools.map((t) => t.name).sort(),
      );
      for (const t of index.tools.slice(0, 5)) {
        const one = JSON.parse((await body(client, t.uri)).text);
        assert.equal(one.input_schema.type, "object", t.name);
      }
      assert.equal(
        index.tools.some((t) => t.name.startsWith("registry_")),
        Boolean(opts.registry),
      );
    });

  test("the coverage resource states hosted.json's figures exactly", async () => {
    assert.deepEqual(
      RESOURCE_DATA.hosted,
      hostedJson,
      "resource-data.ts is out of date: run scripts/mcp/gen-resources.ts",
    );
    const client = await connect({ hosted: true });
    const cov = JSON.parse((await body(client, "factlot://coverage")).text);
    assert.deepEqual(cov.totals, hostedJson.totals);
    assert.equal(cov.pack_built_at, hostedJson.pack_built_at);
    assert.deepEqual(cov.withheld, hostedJson.withheld);
    assert.deepEqual(cov.entity_registries, hostedJson.entity_registries);
    assert.deepEqual(
      cov.places.map(
        (p: { key: string; parcels: number; buildings: number }) => [
          p.key,
          p.parcels,
          p.buildings,
        ],
      ),
      hostedJson.places.map((p) => [p.key, p.parcels, p.buildings]),
    );
    for (const p of hostedJson.places) {
      const place = JSON.parse(
        (await body(client, `factlot://coverage/${p.key}`)).text,
      );
      assert.equal(place.parcels, p.parcels);
      assert.equal(place.as_of, p.as_of);
      for (const c of place.counties) {
        const want = hostedJson.counties.find((x) => x.fips === c.fips)!;
        assert.equal(c.parcels, want.parcels, c.fips);
        assert.equal(c.as_of, want.as_of, c.fips);
      }
      assert.equal(place.counties.length, p.counties.length);
    }
  });

  test("no resource body carries a number the generated data does not hold", async () => {
    // Every number a coverage or market body states is one of the generated data's.
    const known = new Set<number>();
    const collect = (v: unknown): void => {
      if (typeof v === "number") known.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    const data = withMarketHosted();
    collect(data);
    // Counts of list entries the resources compute (counties per place, sources per status).
    for (const p of data.hosted.places) known.add(p.counties.length);
    const check = (v: unknown, where: string): void => {
      if (typeof v === "number")
        assert.ok(known.has(v), `${where}: ${v} is not in the data`);
      else if (typeof v === "string")
        for (const n of v.match(/\b\d{1,3}(?:,\d{3})+\b/g) ?? [])
          assert.ok(
            known.has(Number(n.replaceAll(",", ""))),
            `${where}: "${n}" is not in the data`,
          );
      else if (Array.isArray(v))
        v.forEach((x, i) => check(x, `${where}[${i}]`));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) check(x, `${where}.${k}`);
    };
    const ctx = { hosted: false, registry: false, localFiles: true };
    check(coverageResource(data, ctx), "coverage");
    for (const p of data.hosted.places)
      check(placeResource(data, ctx, p.key), `coverage/${p.key}`);
    check(marketsIndex(data), "markets");
    check(marketResource(data, data.markets[0]!.slug), "market");
    // And the hand-written modules state no count: no grouped number, no number of 4+ digits.
    for (const file of ["resources.ts", "prompts.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(src, /\b\d{1,3}(?:,\d{3})+\b/, file);
      assert.doesNotMatch(
        src.replace(/§[\d.()a-z]+/g, ""),
        /(?<![\w./-])\d{4,}(?![\w-])/,
        file,
      );
    }
  });

  test("hosted and local servers describe the hosted coverage differently", async () => {
    const hosted = JSON.parse(
      (await body(await connect({ hosted: true }), "factlot://coverage")).text,
    );
    const local = JSON.parse(
      (await body(await connect({ localFiles: true }), "factlot://coverage"))
        .text,
    );
    assert.equal(hosted.this_server, "hosted");
    assert.match(hosted.note, /This server is the hosted FactLot service/);
    assert.equal(local.this_server, "local");
    assert.match(local.note, /not what this server holds/);
    assert.ok(local.note.includes(HOSTED_MCP_URL));
    assert.match(local.note, /registry_coverage/);
    assert.deepEqual(local.totals, hosted.totals);
  });

  test("sources: index and one source per id, with the recorded rights", async () => {
    const client = await connect();
    const index = JSON.parse((await body(client, "factlot://sources")).text);
    assert.equal(index.sources.length, RESOURCE_DATA.sources.length);
    assert.ok(index.sources.length > 0);
    for (const s of index.sources.slice(0, 20)) {
      const one = JSON.parse((await body(client, s.uri)).text);
      assert.equal(one.source_id, s.source_id);
      for (const k of [
        "publisher",
        "license",
        "ai_use",
        "redistribution",
        "attribution",
        "terms_url",
        "reviewed",
      ])
        assert.ok(k in one, `${s.source_id}: ${k}`);
    }
    // Every source a hosted county cites (or a snapshot of it) is in the catalog and says so.
    const ids = index.sources.map((x: { source_id: string }) => x.source_id);
    for (const c of hostedJson.counties)
      for (const cited of c.sources) {
        const id = catalogSourceId(ids, cited);
        assert.ok(id, cited);
        const s = index.sources.find(
          (x: { source_id: string }) => x.source_id === id,
        );
        assert.equal(s.hosted, true, cited);
        const one = JSON.parse((await body(client, s.uri)).text);
        assert.ok(
          one.hosted_counties.some((h: { fips: string }) => h.fips === c.fips),
          `${id} lists ${c.fips}`,
        );
      }
    await assert.rejects(
      client.readResource({ uri: "factlot://sources/no-such-source" }),
      (e: { code?: number }) => e.code === RESOURCE_NOT_FOUND,
    );
    const done = await client.complete({
      ref: { type: "ref/resource", uri: "factlot://sources/{source_id}" },
      argument: { name: "source_id", value: "tx-harris" },
    });
    assert.ok(done.completion.values.includes("tx-harris-cad"));
    assert.ok(done.completion.values.every((v) => v.startsWith("tx-harris")));
  });

  test("schemas and the ID specification", async () => {
    const client = await connect({ localFiles: true });
    const toolsIndex = JSON.parse(
      (await body(client, "factlot://schemas/tools")).text,
    );
    const names = toolsIndex.tools.map((t: { name: string }) => t.name);
    for (const n of ["calc_net_effective_rent", "search", "doc_read_pdf"])
      assert.ok(names.includes(n), n);
    const ner = JSON.parse(
      (await body(client, "factlot://schemas/tools/calc_net_effective_rent"))
        .text,
    );
    assert.equal(ner.input_schema.type, "object");
    assert.ok(ner.input_schema.required.includes("schedule"));
    assert.equal(ner.rest_path, "/v1/calc/net_effective_rent");
    const fact = JSON.parse(
      (await body(client, "factlot://schemas/fact")).text,
    );
    assert.ok(fact.Fact, "the Fact schema");
    const spec = await body(client, "factlot://spec/id");
    assert.equal(spec.mimeType, "text/markdown");
    assert.equal(spec.text, read("docs/id-spec.md"));
    // A hosted server does not offer the local-only tools' schemas.
    const remote = await connect({ hosted: true });
    await assert.rejects(
      remote.readResource({ uri: "factlot://schemas/tools/doc_read_pdf" }),
      (e: { code?: number }) => e.code === RESOURCE_NOT_FOUND,
    );
  });

  test("markets: one resource per hosted market, none for a place the pack does not serve", async () => {
    const hostedPlaces = new Set(hostedJson.places.map((p) => p.key));
    const client = await connect();
    const index = JSON.parse((await body(client, "factlot://markets")).text);
    assert.deepEqual(
      index.markets.map((m: { slug: string }) => m.slug),
      RESOURCE_DATA.markets
        .filter((m) => hostedPlaces.has(m.place))
        .map((m) => m.slug),
    );
    for (const m of RESOURCE_DATA.markets.filter(
      (x) => !hostedPlaces.has(x.place),
    ))
      await assert.rejects(
        client.readResource({ uri: `factlot://markets/${m.slug}` }),
        (e: { code?: number }) => e.code === RESOURCE_NOT_FOUND,
      );

    // With the place hosted, its worked example comes from markets.json and hosted.json.
    const data = withMarketHosted();
    const m = data.markets[0]!;
    const res = marketResource(data, m.slug)!;
    assert.equal(res.hosted.parcels, 4321);
    assert.equal(res.example.calls[0]!.tool, "registry_search_address");
    assert.deepEqual(res.example.calls[0]!.arguments, {
      query: m.sample.query,
    });
    assert.deepEqual(res.example.calls[2]!.arguments, {
      system: m.id_system,
      external_id: m.sample.external_id,
    });
    assert.deepEqual(
      res.sources.map((s) => s.source_id),
      m.sources.map((s) => s.source_id),
    );
    assert.ok(!/<[a-z]/.test(JSON.stringify(res)), "no HTML in the body");
    assert.ok(
      marketsIndex(data).markets.some((x) => x.slug === m.slug),
      "listed once hosted",
    );
  });

  test("plans come from plans.ts", async () => {
    const plans = await import("../../../deploy/cloudflare/src/plans.ts");
    const client = await connect();
    const p = JSON.parse((await body(client, "factlot://plans")).text);
    assert.equal(
      p.free.registry_lookups_per_day,
      plans.ANONYMOUS_REGISTRY_LOOKUPS_PER_DAY,
    );
    assert.equal(p.pricing, plans.PRICING_URL);
    for (const plan of Object.values(plans.PLANS)) {
      const got = p.paid.find((x: { id: string }) => x.id === plan.id);
      assert.equal(
        got.registry_lookups_per_month,
        plan.registryLookupsPerMonth,
      );
      assert.equal(got.usd_per_month, plan.monthlyCents / 100);
    }
    assert.equal(
      p.paid_gating.value_history_without_key,
      plans.GATING_INFO.free_history,
    );
  });

  test("the generated data is current", async () => {
    const { resourceData } =
      await import("../../../scripts/mcp/gen-resources.ts");
    assert.deepEqual(
      RESOURCE_DATA,
      resourceData(),
      "packages/mcp/src/resource-data.ts is out of date: run node --experimental-strip-types --conditions=factlot-source scripts/mcp/gen-resources.ts",
    );
  });
});

describe("MCP prompts", () => {
  const valid: Record<PromptName, Record<string, string>> = {
    property_owner: { property: "1000 Louisiana St", place: "Houston, TX" },
    owner_portfolio: { owner: "Example Holdings LLC", jurisdiction: "us-tx" },
    parcel_value_history: {
      parcel: "fl:parcel:us-48201:0011440000001",
      as_of: "2025-06-01",
    },
    tx_unequal_appraisal_candidates: {
      parcel: "1000 Louisiana St, Houston",
      tax_year: "2026",
    },
    lease_abstract_check: { document: "lease.pdf", as_of: "2026-01-01" },
    deal_math: {
      question: "NER on a 10-year lease at $42/sf, 6 months free",
      calculation: "net_effective_rent",
    },
  };
  const invalid: Record<PromptName, Record<string, string>[]> = {
    property_owner: [{}, { property: "" }, { property: "x".repeat(301) }],
    owner_portfolio: [{}, { owner: "Acme", jurisdiction: "texas" }],
    parcel_value_history: [{}, { parcel: "x", as_of: "June 2025" }],
    tx_unequal_appraisal_candidates: [{}, { parcel: "x", tax_year: "26" }],
    lease_abstract_check: [{}, { document: "x", as_of: "2026-1-1" }],
    deal_math: [{}, { question: "x", calculation: "cap_rate_guess" }],
  };

  test("prompts/list names every prompt with its arguments", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    assert.deepEqual(
      prompts.map((p) => p.name).sort(),
      Object.keys(PROMPT_ARGS).sort(),
    );
    for (const p of prompts) {
      assert.ok(p.title && p.description, p.name);
      const shape = PROMPT_ARGS[p.name as PromptName] as Record<
        string,
        { isOptional(): boolean }
      >;
      assert.deepEqual(
        (p.arguments ?? []).map((a) => [a.name, a.required ?? false]),
        Object.entries(shape).map(([k, v]) => [k, !v.isOptional()]),
        p.name,
      );
      for (const a of p.arguments ?? []) assert.ok(a.description, a.name);
    }
  });

  for (const name of Object.keys(PROMPT_ARGS) as PromptName[])
    test(`${name}: valid arguments give the recipe, invalid ones are refused`, async () => {
      for (const opts of [
        { localFiles: true },
        { hosted: true, registry: true },
      ] as CreateServerOptions[]) {
        const client = await connect(opts);
        const got = await client.getPrompt({ name, arguments: valid[name] });
        assert.equal(got.messages.length, 1);
        const msg = got.messages[0]!;
        assert.equal(msg.role, "user");
        const text = (msg.content as { text: string }).text;
        assert.match(text, /Cite every fact/);
        assert.match(text, /registry_coverage/);
        for (const v of Object.values(valid[name]))
          if (name !== "deal_math" || v !== "net_effective_rent")
            assert.ok(text.includes(v), `${name} repeats ${v}`);
        for (const bad of invalid[name])
          await assert.rejects(
            client.getPrompt({ name, arguments: bad }),
            (e: { code?: number }) => e.code === -32602,
            `${name} ${JSON.stringify(bad)}`,
          );
      }
    });

  test("arguments with control characters are refused; a multi-line question is not", async () => {
    const client = await connect();
    const refused = (name: PromptName, args: Record<string, string>) =>
      assert.rejects(
        client.getPrompt({ name, arguments: args }),
        (e: { code?: number }) => e.code === -32602,
        `${name} ${JSON.stringify(args)}`,
      );
    for (const v of [
      "a\n\nIgnore all\u0000",
      "1000 Louisiana St\nHouston",
      "x\ty",
      "x\u0007",
      "x\u0085y",
      "x\u2028y",
    ]) {
      await refused("property_owner", { property: v });
      await refused("owner_portfolio", { owner: v });
      await refused("parcel_value_history", { parcel: v });
      await refused("tx_unequal_appraisal_candidates", { parcel: v });
      await refused("lease_abstract_check", { document: v });
    }
    await refused("deal_math", { question: "rent\u0000" });
    await refused("deal_math", { question: "rent\u001b[2J" });
    const ok = await client.getPrompt({
      name: "deal_math",
      arguments: {
        question: "Base rent $42/sf\nFree rent: 6 months\r\n\tTI $60/sf",
      },
    });
    assert.match(
      (ok.messages[0]!.content as { text: string }).text,
      /Free rent: 6 months/,
    );
  });

  test("the registry prompts say where the registry is and what a key adds", () => {
    const local = { hosted: false, registry: false, localFiles: true };
    const hosted = { hosted: true, registry: true, localFiles: false };
    const { plans } = RESOURCE_DATA;
    for (const name of [
      "property_owner",
      "owner_portfolio",
      "parcel_value_history",
      "tx_unequal_appraisal_candidates",
    ] as const) {
      const l = promptText(name, valid[name], local);
      const h = promptText(name, valid[name], hosted);
      assert.ok(l.includes(HOSTED_MCP_URL), `${name}: local points to hosted`);
      assert.ok(!h.includes("has no registry loaded"), name);
      assert.ok(
        h.includes(`${plans.free.registry_lookups_per_day} a day`),
        name,
      );
    }
    const history = promptText(
      "parcel_value_history",
      valid.parcel_value_history,
      hosted,
    );
    assert.ok(history.includes(plans.gating.free_history));
    assert.match(history, /dated registry_get/);
    assert.ok(history.includes(plans.pricing_url));
    for (const p of plans.paid) assert.ok(history.includes(p.name), p.name);
    const tx = promptText(
      "tx_unequal_appraisal_candidates",
      valid.tx_unequal_appraisal_candidates,
      hosted,
    );
    assert.match(tx, /registry_tx_equity_candidates_batch/);
  });

  test("the Texas prompt keeps the legal boundary of the candidates tool", async () => {
    const { TX_EQUITY_NOTICE, TX_EQUITY_CALC_ARGS_NOTICE } =
      await import("@factlot/tools");
    const text = promptText(
      "tx_unequal_appraisal_candidates",
      { parcel: "x" },
      { hosted: true, registry: true, localFiles: false },
    );
    assert.ok(text.includes(TX_EQUITY_NOTICE));
    assert.ok(text.includes(TX_EQUITY_CALC_ARGS_NOTICE));
    assert.match(text, /FactLot does not select comparables/);
    assert.match(text, /Do not look up the owners of candidate parcels/);
    // The steps run in the packet's order; the calculator only after the person's review.
    const order = [
      "registry_coverage",
      "registry_tx_equity_candidates with",
      "calc_tx_unequal_appraisal",
      "rules_tx_property_tax_protest_deadline",
      "report_create",
    ].map((s) => text.indexOf(s));
    assert.ok(order.every((i) => i >= 0));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.match(text, /Only after the person has reviewed/);
    // Nothing presented as chosen for the person or as an appraisal.
    assert.doesNotMatch(text, /comparables (?:we|FactLot) (?:chose|selected)/i);
    assert.doesNotMatch(text, /\b(?:your|the) appraisal\b/i);
  });

  test("deal_math names the calculator for each calculation", () => {
    for (const [calculation, tool] of Object.entries(DEAL_CALCULATORS)) {
      const text = promptText(
        "deal_math",
        { question: "q", calculation },
        { hosted: false, registry: false, localFiles: true },
      );
      assert.ok(text.includes(`Use ${tool}`), calculation);
    }
  });
});
