import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { generateKey, hashKey, writeKey, type KeyRecord } from "./keys.ts";
import {
  RateLimiterObject,
  objectLimiter,
  objectMeter,
  type DurableObjectNamespaceLike,
} from "./limiter.ts";
import { PLANS, WATCH_LIMITS } from "./plans.ts";
import { handle } from "./router.ts";
import { hmacSha256Hex } from "./stripe.ts";
import { resetUsageForTests, snapshot } from "./usage.ts";
import type { Env, KV, RateLimit } from "./types.ts";
import {
  STOP_PATH,
  WATCH_CHECK,
  objectWatch,
  registryReader,
  resetWatchHealthCache,
  runWatchCheck,
} from "./watch-check.ts";
import { compare, fingerprint, parseAspects, ASPECTS } from "./watch-print.ts";

// --- Fakes -----------------------------------------------------------------------------------

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (p: string) => {
    prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[] };
  };
};

/** A Durable Object's SQL storage over an in-memory SQLite database. */
function sqliteStorage() {
  let db = new DatabaseSync(":memory:");
  return {
    sql: {
      exec(q: string, ...b: (string | number | null)[]) {
        const r = db.prepare(q).all(...b);
        return { toArray: () => r.map((x) => ({ ...x })) };
      },
    },
    getAlarm: async () => null,
    setAlarm: async () => {},
    deleteAll: async () => {
      db = new DatabaseSync(":memory:");
    },
    tables: () =>
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((r) => String(r.name)),
  };
}

/** The LIMITER namespace: real RateLimiterObjects over SQLite, on a shared clock. */
function fakeNamespace(clock: { t: number }) {
  const objects = new Map<
    string,
    { obj: RateLimiterObject; storage: ReturnType<typeof sqliteStorage> }
  >();
  const object = (name: string) => {
    let o = objects.get(name);
    if (!o) {
      const storage = sqliteStorage();
      o = {
        storage,
        obj: new RateLimiterObject({ storage }, {}, { now: () => clock.t }),
      };
      objects.set(name, o);
    }
    return o;
  };
  const ns: DurableObjectNamespaceLike = {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: (input: string, init?: RequestInit) =>
        object(String(id)).obj.fetch(new Request(input, init)),
    }),
  };
  return { ns, objects, object };
}

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  readonly ttl = new Map<string, number | undefined>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.data.set(k, v);
    this.ttl.set(k, o?.expirationTtl);
  }
  async delete(k: string) {
    this.data.delete(k);
  }
}

class OpenLimit implements RateLimit {
  async limit() {
    return { success: true };
  }
  async peek() {
    return { success: true };
  }
}

type Rec = Record<string, unknown>;

const P1 = "fl:parcel:us-48201:0010010000001";
const P2 = "fl:parcel:us-48201:0010010000002";
const E1 = "fl:entity:us-tx:0801234567";

const fact = (
  id: string,
  predicate: string,
  value: unknown,
  as_of = "2025-01-01",
): Rec => ({
  id,
  subject: "",
  predicate,
  value,
  as_of,
  provenance: {
    sources: [
      {
        document_id: `doc-${id}`,
        title: "County roll",
        uri: "https://example.org/roll.csv",
      },
    ],
  },
});

function parcel(
  urn: string,
  o: {
    year?: number;
    market?: number;
    owner?: string;
    deeds?: { date: string; price: number }[];
    zoning?: string;
    idSuffix?: string;
    status?: string;
  } = {},
): Rec {
  const s = o.idSuffix ?? "a";
  return {
    urn,
    kind: "parcel",
    label: `${urn.slice(-4)} Main St`,
    status: o.status ?? "current",
    facts: [
      fact(
        `own-${s}`,
        "ownership.owner_of_record",
        o.owner ?? "ACME HOLDINGS LLC",
      ),
      fact(`zone-${s}`, "parcel.zoning_district", o.zoning ?? "C-2"),
      ...(o.deeds ?? []).map((d, i) =>
        fact(`deed-${i}-${s}`, "transaction.deed", {
          date: d.date,
          price_usd: d.price,
          grantee: "Somebody Personal",
        }),
      ),
    ],
    relationships: [],
    crosswalk: [],
    value_history: [
      {
        tax_year: o.year ?? 2025,
        market_value: o.market ?? 1_000_000,
        appraised_value: o.market ?? 1_000_000,
        as_of: `${o.year ?? 2025}-07-25`,
        citations: {
          market_value: {
            fact_id: `mv-${s}`,
            document_id: `roll-${o.year ?? 2025}`,
            locator: null,
            as_of: `${o.year ?? 2025}-07-25`,
          },
          appraised_value: null,
        },
      },
    ],
  };
}

function entity(urn: string, status: string, s = "a"): Rec {
  return {
    urn,
    kind: "entity",
    label: "ACME HOLDINGS LLC",
    status: "current",
    facts: [
      fact(`name-${s}`, "entity.legal_name", "ACME HOLDINGS LLC"),
      fact(`st-${s}`, "entity.status", status),
    ],
    relationships: [],
    crosswalk: [],
  };
}

/** The registry Worker: /health, /run registry_get and /get-many over a mutable pack. */
function fakeRegistry() {
  const pack = {
    built_at: "2026-11-05T00:00:00Z",
    records: new Map<string, Rec>(),
    /** Every call answers 503. */
    down: false,
    /** No /get-many (an older registry Worker). */
    noGetMany: false,
    /** URNs whose read fails: /run answers 500, /get-many with one of them answers 500. */
    broken: new Set<string>(),
    /** URNs whose outcome is an error other than NotFound. */
    errors: new Set<string>(),
  };
  /** health: /health calls; get: subjects read; binding: every service-binding call. */
  const calls = { health: 0, get: 0, binding: 0 };
  const outcome = (urn: string) => {
    if (pack.errors.has(urn))
      return { ok: false, error: { error: "InternalError", message: "x" } };
    const rec = pack.records.get(urn);
    return rec
      ? { ok: true, result: rec }
      : {
          ok: false,
          error: {
            error: "NotFound",
            message: `no registry record for ${urn}: county not loaded`,
          },
        };
  };
  const fetcher = {
    fetch: async (r: Request) => {
      calls.binding++;
      const url = new URL(r.url);
      if (pack.down) return new Response("down", { status: 503 });
      if (url.pathname === "/health") {
        calls.health++;
        return Response.json({ ok: true, pack: { built_at: pack.built_at } });
      }
      if (url.pathname === "/get-many") {
        if (pack.noGetMany) return new Response("no", { status: 404 });
        const b = (await r.json()) as { urns: string[] };
        assert.ok(b.urns.length <= 50);
        if (b.urns.some((u) => pack.broken.has(u)))
          return new Response("boom", { status: 500 });
        calls.get += b.urns.length;
        return Response.json({
          built_at: pack.built_at,
          outcomes: b.urns.map(outcome),
        });
      }
      const b = (await r.json()) as { tool: string; input: { urn: string } };
      if (pack.broken.has(b.input.urn))
        return new Response("boom", { status: 500 });
      calls.get++;
      return Response.json(outcome(b.input.urn));
    },
  };
  return { pack, calls, fetcher };
}

function fakeEmail() {
  const sent: {
    to: string;
    subject: string;
    text: string;
    headers?: Record<string, string>;
  }[] = [];
  return {
    sent,
    binding: {
      send: async (m: {
        to: unknown;
        subject: string;
        text: string;
        headers?: Record<string, string>;
      }) => {
        sent.push({
          to: String(m.to),
          subject: m.subject,
          text: m.text,
          headers: m.headers,
        });
        return { messageId: `m${sent.length}` };
      },
    },
  };
}

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);

function setup(enabled = "true") {
  resetWatchHealthCache();
  const clock = { t: T0 };
  resetUsageForTests({
    now: () => clock.t,
    sleep: async () => {},
    waitUntil: () => {},
  });
  const space = fakeNamespace(clock);
  const registry = fakeRegistry();
  const email = fakeEmail();
  const points: unknown[] = [];
  const env = {
    KEYS: new MemoryKV(),
    RL_ANON: new OpenLimit(),
    RL_CLAIM: objectLimiter(space.ns, "claim", 1, 2000),
    METER: objectMeter(space.ns),
    WATCH: objectWatch(space.ns),
    REGISTRY: registry.fetcher,
    EMAIL: email.binding,
    RECOVERY_SIGNING_SECRET: "s".repeat(64),
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    WATCH_LISTS_ENABLED: enabled,
    USAGE_COUNTERS_ENABLED: "true",
    USAGE: { writeDataPoint: (p: unknown) => points.push(p) },
    OPERATOR_POSTAL_ADDRESS: "PO Box 1, Austin, TX 78701",
  } as unknown as Env & { KEYS: MemoryKV };
  registry.pack.records.set(P1, parcel(P1));
  registry.pack.records.set(P2, parcel(P2));
  registry.pack.records.set(E1, entity(E1, "Active"));
  const inner = {
    fetch: async (r: Request) => {
      const path = new URL(r.url).pathname;
      if (path === "/mcp") {
        const m = JSON.parse(await r.text()) as { id: unknown; method: string };
        return Response.json({
          jsonrpc: "2.0",
          id: m.id,
          result: m.method === "tools/list" ? { tools: [] } : {},
        });
      }
      return Response.json({ error: "NotFound" }, { status: 404 });
    },
  };
  const call = (req: Request) =>
    handle(req, env, inner, { now: () => clock.t });
  return { env, clock, space, registry, email, call, points };
}

async function issue(env: Env, over: Partial<KeyRecord> = {}): Promise<string> {
  const key = generateKey();
  const hash = await hashKey(key);
  const rec: KeyRecord = {
    plan: "pro",
    status: "active",
    customer: "cus_1",
    subscription: "sub_1",
    stripe_status: "active",
    created: "2026-11-03T00:00:00Z",
    checked_at: T0,
    ...over,
  };
  await writeKey(env.KEYS, hash, rec, T0);
  const list = JSON.parse(
    (await env.KEYS.get(`sub:${rec.subscription}`)) ?? "[]",
  ) as string[];
  await env.KEYS.put(
    `sub:${rec.subscription}`,
    JSON.stringify([...list, hash]),
  );
  return key;
}

const rest = (tool: string, body: unknown, key?: string) =>
  new Request(`https://api.factlot.com/v1/watch/${tool}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });

const mcp = (body: unknown, key?: string) =>
  new Request("https://api.factlot.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });

const lookupsUsed = async (env: Env, subject = "sub:sub_1") =>
  (await env.METER.quota(subject, "month", PLANS.pro.registryLookupsPerMonth))
    .used;

/** A new pack: bump built_at and change records. */
function release(
  s: ReturnType<typeof setup>,
  builtAt: string,
  change: (records: Map<string, Rec>) => void,
) {
  s.registry.pack.built_at = builtAt;
  change(s.registry.pack.records);
  resetWatchHealthCache();
}

/** Run the same check again from the start (as a crashed or overlapping run would). */
function forceRerun(s: ReturnType<typeof setup>) {
  const idx = s.space.object("watch:index").storage.sql;
  idx.exec(
    "DELETE FROM w_meta WHERE name = 'done_seq' OR name = 'lease_until'",
  );
  idx.exec("UPDATE w_owners SET done_seq = 0");
}

/** Turn alerts on and open the confirmation link. */
async function confirmAlerts(
  s: ReturnType<typeof setup>,
  key: string,
  email: string,
) {
  const res = await s.call(rest("alerts", { enabled: true, email }, key));
  assert.equal(res.status, 202);
  const m = s.email.sent.at(-1)!;
  assert.equal(m.to, email);
  const link =
    /https:\/\/factlot\.com(\/account\/watch-alerts\/confirm\/\S+)/.exec(
      m.text,
    )![1]!;
  const ok = await s.call(
    new Request(`https://factlot.com${link}`, { method: "POST" }),
  );
  assert.equal(ok.status, 200);
  return link;
}

// --- Fingerprints and comparison ---------------------------------------------------------------

describe("watch fingerprints", () => {
  const all = new Set(ASPECTS);
  it("a restatement with new fact ids is not a change", async () => {
    const a = await fingerprint(parcel(P1));
    const b = await fingerprint(parcel(P1, { idSuffix: "b" }));
    assert.deepEqual(compare(a, b, all), []);
  });
  it("value: a new roll year, with old and new values and the new citation", async () => {
    const a = await fingerprint(parcel(P1));
    const b = await fingerprint(parcel(P1, { year: 2026, market: 1_250_000 }));
    const [c] = compare(a, b, all);
    assert.equal(c!.aspect, "value");
    assert.deepEqual(c!.old, {
      tax_year: 2025,
      market_value: 1_000_000,
      appraised_value: 1_000_000,
    });
    assert.deepEqual((c!.new as Rec).tax_year, 2026);
    assert.equal((c!.citation as unknown as Rec).document_id, "roll-2026");
    assert.match(c!.summary, /new roll year: 2026 market value \$1,250,000/);
  });
  it("owner: a different owner of record", async () => {
    const a = await fingerprint(parcel(P1));
    const b = await fingerprint(parcel(P1, { owner: "NEW OWNER LP" }));
    const [c] = compare(a, b, all);
    assert.equal(c!.aspect, "owner");
    assert.deepEqual((c!.new as Rec).names, ["NEW OWNER LP"]);
    assert.equal((c!.citation as unknown as Rec).fact_id, "own-a");
  });
  it("documents: a new deed, listed by date and amount only (no party names kept)", async () => {
    const a = await fingerprint(parcel(P1));
    const b = await fingerprint(
      parcel(P1, { deeds: [{ date: "2026-10-01", price: 2_000_000 }] }),
    );
    assert.ok(!JSON.stringify(b).includes("Somebody Personal"));
    const [c] = compare(a, b, all);
    assert.equal(c!.aspect, "documents");
    assert.deepEqual((c!.new as Rec).added, [
      {
        predicate: "transaction.deed",
        date: "2026-10-01",
        amount_usd: 2_000_000,
        fact_id: "deed-0-a",
      },
    ]);
  });
  it("entity status", async () => {
    const a = await fingerprint(entity(E1, "Active"));
    const b = await fingerprint(entity(E1, "Forfeited", "b"));
    const [c] = compare(a, b, all);
    assert.equal(c!.aspect, "entity_status");
    assert.deepEqual(c!.new, { status: "Forfeited" });
  });
  it("other facts, and only the aspects watched", async () => {
    const a = await fingerprint(parcel(P1));
    const b = await fingerprint(
      parcel(P1, { zoning: "R-1", owner: "NEW OWNER LP" }),
    );
    assert.deepEqual(
      compare(a, b, new Set(["other"] as const)).map((c) => c.aspect),
      ["other"],
    );
    assert.deepEqual(
      compare(a, b, new Set(["value"] as const)).map((c) => c.aspect),
      [],
    );
  });
  it("a gone record or a status change is always reported", async () => {
    const a = await fingerprint(parcel(P1));
    const gone = compare(
      a,
      { missing: true, message: "county withheld" },
      new Set(),
    );
    assert.equal(gone[0]!.aspect, "record");
    assert.match(
      gone[0]!.summary,
      /no longer in the registry: county withheld/,
    );
    const stale = await fingerprint(
      parcel(P1, { status: "not_in_latest_snapshot" }),
    );
    assert.equal(compare(a, stale, new Set())[0]!.aspect, "record");
  });
  it("parses aspects", () => {
    assert.deepEqual(parseAspects(undefined), [...ASPECTS]);
    assert.deepEqual(parseAspects(["owner", "value"]), ["value", "owner"]);
    assert.equal(typeof parseAspects(["price"]), "string");
  });
});

// --- Tools -------------------------------------------------------------------------------------

describe("watch tools", () => {
  it("add charges one lookup per new subject; repeats, invalid URNs and misses are free", async () => {
    const s = setup();
    const key = await issue(s.env);
    const res = await s.call(
      rest(
        "add",
        {
          urns: [P1, P2, "fl:parcel:nope", "fl:parcel:us-48201:0099999999999"],
        },
        key,
      ),
    );
    assert.equal(res.status, 200);
    const b = (await res.json()) as Rec;
    assert.deepEqual(
      (b.added as Rec[]).map((a) => a.urn),
      [P1, P2],
    );
    assert.equal(b.lookups_charged, 2);
    assert.deepEqual((b.errors as Rec[]).map((e) => e.error).sort(), [
      "InvalidId",
      "NotFound",
    ]);
    assert.equal(await lookupsUsed(s.env), 2);
    // Again, and into a second list: nothing read, nothing counted.
    const again = (await (
      await s.call(rest("add", { urns: [P1] }, key))
    ).json()) as Rec;
    assert.deepEqual(again.already_watched, [P1]);
    const other = (await (
      await s.call(rest("add", { urns: [P1], list: "lenders" }, key))
    ).json()) as Rec;
    assert.equal(other.lookups_charged, 0);
    assert.equal(await lookupsUsed(s.env), 2);
    assert.equal(s.registry.calls.get, 3);
  });

  it("list, remove a subject, remove a list; fingerprints go with the last membership", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1, P2] }, key));
    await s.call(
      rest("add", { urns: [P1], list: "lenders", aspects: ["owner"] }, key),
    );
    let l = (await (await s.call(rest("list", {}, key))).json()) as Rec;
    assert.deepEqual(
      (l.lists as Rec[]).map((x) => [x.name, x.subjects]),
      [
        ["default", 2],
        ["lenders", 1],
      ],
    );
    assert.deepEqual(l.watched, {
      subjects: 3,
      limit: 200,
      lists: 2,
      lists_limit: 20,
    });
    assert.equal((l.alerts as Rec).enabled, false);
    const r = (await (
      await s.call(rest("remove", { urns: [P2] }, key))
    ).json()) as Rec;
    assert.equal(r.removed, 1);
    assert.equal(r.subjects_forgotten, 1);
    const del = (await (
      await s.call(rest("remove", { list: "default", all: true }, key))
    ).json()) as Rec;
    assert.equal(del.list_removed, true);
    l = (await (await s.call(rest("list", {}, key))).json()) as Rec;
    assert.deepEqual(
      (l.subjects as Rec[]).map((x) => x.urn),
      [P1],
    );
    await s.call(rest("remove", { list: "lenders", all: true }, key));
    const store = s.space.object("watch:sub:sub_1").storage;
    const prints = store.sql
      .exec("SELECT COUNT(*) AS n FROM w_prints")
      .toArray();
    assert.equal(prints[0]!.n, 0);
    const idx = await s.env.WATCH!.index<{ owners: number }>("state");
    assert.equal(idx.owners, 0);
  });

  it("limits: subjects and lists per plan, refused whole and not counted", async () => {
    const s = setup();
    const key = await issue(s.env);
    for (let i = 0; i < WATCH_LIMITS.pro.subjects; i++) {
      const urn = `fl:parcel:us-48201:${String(1_000_000 + i).padStart(13, "0")}`;
      s.registry.pack.records.set(urn, parcel(urn));
    }
    const urns = [...s.registry.pack.records.keys()].filter(
      (u) =>
        u.startsWith("fl:parcel:us-48201:000000") ||
        u.startsWith("fl:parcel:us-48201:0000001"),
    );
    assert.equal(urns.length, 200);
    for (let i = 0; i < 200; i += 50)
      assert.equal(
        (await s.call(rest("add", { urns: urns.slice(i, i + 50) }, key)))
          .status,
        200,
      );
    const used = await lookupsUsed(s.env);
    const over = await s.call(rest("add", { urns: [P1] }, key));
    assert.equal(over.status, 409);
    assert.equal(((await over.json()) as Rec).code, "WatchLimitReached");
    assert.equal(await lookupsUsed(s.env), used);
    await s.call(rest("remove", { urns: urns.slice(0, 25) }, key));
    for (let i = 0; i < WATCH_LIMITS.pro.lists - 1; i++)
      assert.equal(
        (
          await s.call(
            rest("add", { urns: [urns[10 + i]!], list: `l${i}` }, key),
          )
        ).status,
        200,
      );
    const tooMany = await s.call(
      rest("add", { urns: [P1], list: "one-more" }, key),
    );
    assert.equal(((await tooMany.json()) as Rec).code, "WatchListLimit");
  });

  it("a free caller gets PlanRequired, unmetered, on REST and MCP, and no tools listed", async () => {
    const s = setup();
    const res = await s.call(rest("add", { urns: [P1] }));
    assert.equal(res.status, 403);
    const b = (await res.json()) as Rec;
    assert.equal(b.code, "PlanRequired");
    assert.match(
      String(b.message),
      /paid plans only: Pro \(200 watched subjects\) and Team \(5,000\)/,
    );
    assert.equal(s.registry.calls.get, 0);
    const m = (await (
      await s.call(
        mcp({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "watch_changes", arguments: {} },
        }),
      )
    ).json()) as { result: { isError: boolean; structuredContent: Rec } };
    assert.equal(m.result.isError, true);
    assert.equal(m.result.structuredContent.code, "PlanRequired");
    const list = (await (
      await s.call(mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }))
    ).json()) as { result: { tools: Rec[] } };
    assert.ok(
      !list.result.tools.some((t) => String(t.name).startsWith("watch_")),
    );
    const key = await issue(s.env);
    const paidList = (await (
      await s.call(mcp({ jsonrpc: "2.0", id: 3, method: "tools/list" }, key))
    ).json()) as { result: { tools: Rec[] } };
    assert.deepEqual(
      paidList.result.tools
        .filter((t) => String(t.name).startsWith("watch_"))
        .map((t) => t.name),
      [
        "watch_add",
        "watch_remove",
        "watch_list",
        "watch_changes",
        "watch_alerts",
      ],
    );
  });

  it("works over MCP for a paid key", async () => {
    const s = setup();
    const key = await issue(s.env);
    const m = (await (
      await s.call(
        mcp(
          {
            jsonrpc: "2.0",
            id: 7,
            method: "tools/call",
            params: {
              name: "watch_add",
              arguments: { urns: [E1], aspects: ["entity_status"] },
            },
          },
          key,
        ),
      )
    ).json()) as {
      id: number;
      result: { isError?: boolean; structuredContent: Rec };
    };
    assert.equal(m.id, 7);
    assert.equal(m.result.isError, undefined);
    assert.equal(m.result.structuredContent.lookups_charged, 1);
  });

  it("variable off: tools unlisted, routes 404, account page without the section, no check", async () => {
    const s = setup("TRUE");
    const key = await issue(s.env);
    const res = await s.call(rest("add", { urns: [P1] }, key));
    assert.equal(res.status, 404);
    const list = (await (
      await s.call(mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, key))
    ).json()) as { result: { tools: Rec[] } };
    assert.ok(
      !list.result.tools.some((t) => String(t.name).startsWith("watch_")),
    );
    const page = await s.call(
      new Request("https://factlot.com/account", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key }).toString(),
      }),
    );
    assert.ok(!(await page.text()).includes("Watch lists"));
    const r = await runWatchCheck(s.env);
    assert.equal(r.state, "off");
    assert.equal(s.registry.calls.health, 0);
    const stop = await s.call(
      new Request(`https://factlot.com${STOP_PATH}x.y`),
    );
    assert.notEqual(stop.status, 200);
    const plans = (await (
      await s.call(new Request("https://api.factlot.com/v1/plans"))
    ).json()) as Rec;
    assert.equal(plans.watch_lists, undefined);
  });
});

// --- The check --------------------------------------------------------------------------------

describe("watch check", () => {
  it("finds each watched aspect's change once per pack; idempotent per built_at", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1, P2, E1] }, key));
    // Same pack: nothing to do.
    let r = await runWatchCheck(s.env, { now: () => s.clock.t });
    assert.equal(r.changes, 0);
    release(s, "2026-11-12T00:00:00Z", (recs) => {
      recs.set(
        P1,
        parcel(P1, { year: 2026, market: 1_100_000, idSuffix: "n" }),
      );
      recs.set(
        P2,
        parcel(P2, {
          owner: "NEW OWNER LP",
          deeds: [{ date: "2026-09-30", price: 5 }],
          idSuffix: "n",
        }),
      );
      recs.set(E1, entity(E1, "Forfeited", "n"));
    });
    const reads = s.registry.calls.get;
    r = await runWatchCheck(s.env, { now: () => s.clock.t });
    assert.equal(r.state, "run");
    assert.equal(r.left, 0);
    assert.equal(s.registry.calls.get - reads, 3);
    const c = (await (await s.call(rest("changes", {}, key))).json()) as {
      changes: Rec[];
      cursor: string;
      check: Rec;
    };
    assert.deepEqual(
      c.changes
        .map((x) => `${String(x.urn).slice(-2)}:${String(x.aspect)}`)
        .sort(),
      ["01:value", "02:documents", "02:owner", "67:entity_status"],
    );
    assert.equal(c.check.complete, true);
    for (const x of c.changes)
      assert.equal(x.registry_update, "2026-11-12T00:00:00Z");
    // Again: no read, no new change; the cursor returns nothing new.
    r = await runWatchCheck(s.env, { now: () => s.clock.t });
    assert.equal(r.state, "done");
    assert.equal(s.registry.calls.get - reads, 3);
    const next = (await (
      await s.call(rest("changes", { since: c.cursor }, key))
    ).json()) as {
      changes: Rec[];
    };
    assert.equal(next.changes.length, 0);
    // A forced re-run of the same check stores nothing twice.
    forceRerun(s);
    s.space
      .object("watch:sub:sub_1")
      .storage.sql.exec("UPDATE w_prints SET seq = 0");
    r = await runWatchCheck(s.env, { now: () => s.clock.t });
    assert.equal(r.changes, 0);
    const all = (await (await s.call(rest("changes", {}, key))).json()) as {
      changes: Rec[];
    };
    assert.equal(all.changes.length, 4);
    // A list's own aspects filter what it shows.
    await s.call(
      rest("add", { urns: [P2], list: "owners", aspects: ["owner"] }, key),
    );
    const owners = (await (
      await s.call(rest("changes", { list: "owners" }, key))
    ).json()) as {
      changes: Rec[];
    };
    assert.deepEqual(
      owners.changes.map((x) => x.aspect),
      ["owner"],
    );
  });

  it("reports a vanished subject plainly", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    release(s, "2026-11-12T00:00:00Z", (recs) => recs.delete(P1));
    await runWatchCheck(s.env);
    const c = (await (await s.call(rest("changes", {}, key))).json()) as {
      changes: Rec[];
    };
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0]!.aspect, "record");
    assert.match(String(c.changes[0]!.summary), /no longer in the registry/);
    const l = (await (await s.call(rest("list", {}, key))).json()) as {
      subjects: Rec[];
    };
    assert.equal(l.subjects[0]!.status, "missing");
  });

  it("is batched within the per-invocation budget and resumes where it stopped", async () => {
    const s = setup();
    const keyA = await issue(s.env);
    const keyB = await issue(s.env, {
      subscription: "sub_2",
      customer: "cus_2",
    });
    const keyC = await issue(s.env, {
      subscription: "sub_3",
      customer: "cus_3",
    });
    const urns: string[] = [];
    for (let i = 0; i < 30; i++) {
      const urn = `fl:parcel:us-48201:${String(2_000_000 + i).padStart(13, "0")}`;
      s.registry.pack.records.set(urn, parcel(urn));
      urns.push(urn);
    }
    await s.call(rest("add", { urns }, keyA));
    await s.call(rest("add", { urns: urns.slice(0, 10) }, keyB));
    await s.call(rest("add", { urns: urns.slice(5, 25) }, keyC));
    release(s, "2026-11-12T00:00:00Z", (recs) => {
      for (const u of urns)
        recs.set(u, parcel(u, { year: 2026, idSuffix: "n" }));
    });
    const reads = s.registry.calls.get;
    const budget = 12;
    const runs = [];
    for (let i = 0; i < 10; i++) {
      const r = await runWatchCheck(s.env, { budget, now: () => s.clock.t });
      runs.push(r);
      assert.ok(r.invocations <= budget, `run ${i} used ${r.invocations}`);
      if (r.state === "done") break;
    }
    assert.ok(runs.length > 2);
    assert.equal(runs.at(-1)!.state, "done");
    // Each watched subject read at most once per subscription per pack (once per run when shared).
    assert.ok(s.registry.calls.get - reads <= 60);
    for (const key of [keyA, keyB, keyC]) {
      const c = (await (
        await s.call(rest("changes", { limit: 200 }, key))
      ).json()) as {
        changes: Rec[];
      };
      assert.equal(
        c.changes.length,
        key === keyA ? 30 : key === keyB ? 10 : 20,
      );
    }
    assert.ok(WATCH_CHECK.invocations < 32);
  });

  it("watch_changes compares a newer pack inline, a few subjects at a time", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1, P2] }, key));
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(P1, parcel(P1, { owner: "NEW OWNER LP", idSuffix: "n" })),
    );
    const c = (await (await s.call(rest("changes", {}, key))).json()) as {
      changes: Rec[];
      check: Rec;
    };
    assert.deepEqual(
      c.changes.map((x) => x.aspect),
      ["owner"],
    );
    assert.deepEqual(c.check, {
      registry_update: "2026-11-12T00:00:00Z",
      complete: true,
      unchecked: 0,
    });
    // The scheduled run then has nothing left to read.
    const before = s.registry.calls.get;
    await runWatchCheck(s.env);
    assert.equal(s.registry.calls.get, before);
  });

  it("checks never touch the lookup quota", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1, P2] }, key));
    const used = await lookupsUsed(s.env);
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(P1, parcel(P1, { year: 2026, idSuffix: "n" })),
    );
    await runWatchCheck(s.env);
    await s.call(rest("changes", {}, key));
    await s.call(rest("list", {}, key));
    assert.equal(await lookupsUsed(s.env), used);
  });
});

// --- Alerts, deletion, privacy -------------------------------------------------------------------

describe("watch alerts and deletion", () => {
  it("one digest per pack, with the changes, the stop link and the postal line; the stop link works", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    await confirmAlerts(s, key, "owner@example.com");
    // No change, no email (only the confirmation went out).
    await runWatchCheck(s.env);
    assert.equal(s.email.sent.length, 1);
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(
        P1,
        parcel(P1, { year: 2026, market: 1_300_000, idSuffix: "n" }),
      ),
    );
    await runWatchCheck(s.env);
    forceRerun(s);
    await runWatchCheck(s.env);
    assert.equal(s.email.sent.length, 2);
    const m = s.email.sent[1]!;
    assert.equal(m.to, "owner@example.com");
    assert.match(m.subject, /1 change in the 2026-11-12 registry update/);
    assert.match(
      m.text,
      /0001 Main St \(fl:parcel:us-48201:0010010000001\): new roll year: 2026/,
    );
    assert.match(m.text, /PO Box 1, Austin, TX 78701/);
    const stop =
      /https:\/\/factlot\.com(\/account\/watch-alerts\/stop\/\S+)/.exec(
        m.text,
      )![1]!;
    assert.equal(
      m.headers!["List-Unsubscribe"],
      `<https://factlot.com${stop}>`,
    );
    assert.equal(
      m.headers!["List-Unsubscribe-Post"],
      "List-Unsubscribe=One-Click",
    );
    // GET shows a button and changes nothing; POST stops and deletes the address.
    const get = await s.call(new Request(`https://factlot.com${stop}`));
    assert.equal(get.status, 200);
    assert.match(await get.text(), /Stop the emails/);
    const post = await s.call(
      new Request(`https://factlot.com${stop}`, {
        method: "POST",
        body: "List-Unsubscribe=One-Click",
      }),
    );
    assert.equal(post.status, 200);
    const l = (await (await s.call(rest("list", {}, key))).json()) as {
      alerts: Rec;
    };
    assert.equal(l.alerts.enabled, false);
    assert.ok(
      ![...s.env.KEYS.data.keys()].some((k) => k.startsWith("watchstop:")),
    );
    const meta = s.space
      .object("watch:sub:sub_1")
      .storage.sql.exec("SELECT * FROM w_meta")
      .toArray();
    assert.ok(!JSON.stringify(meta).includes("owner@example.com"));
    const again = await s.call(
      new Request(`https://factlot.com${stop}`, { method: "POST" }),
    );
    assert.equal(again.status, 404);
    const forged = await s.call(
      new Request(
        `https://factlot.com${STOP_PATH}${"a".repeat(43)}.${"b".repeat(43)}`,
      ),
    );
    assert.equal(forged.status, 404);
  });

  it("cancelling the subscription deletes lists, fingerprints and the alert address", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    await s.call(
      rest("alerts", { enabled: true, email: "owner@example.com" }, key),
    );
    assert.ok(s.space.object("watch:sub:sub_1").storage.tables().length > 0);
    const t = Math.floor(T0 / 1000);
    const body = JSON.stringify({
      id: "evt_1",
      type: "customer.subscription.deleted",
      created: t,
      data: { object: { id: "sub_1", status: "canceled", customer: "cus_1" } },
    });
    const sig = await hmacSha256Hex("whsec_x", `${t}.${body}`);
    const res = await s.call(
      new Request("https://api.factlot.com/v1/billing/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": `t=${t},v1=${sig}` },
      }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(s.space.object("watch:sub:sub_1").storage.tables(), []);
    assert.ok(
      ![...s.env.KEYS.data.keys()].some(
        (k) => k.startsWith("watchstop:") || k.startsWith("watchconfirm:"),
      ),
    );
    assert.equal(
      (await s.env.WATCH!.index<{ owners: number }>("state")).owners,
      0,
    );
  });

  it("the check deletes a subscription whose keys were cancelled while no webhook came", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    const hash = JSON.parse((await s.env.KEYS.get("sub:sub_1"))!)[0] as string;
    const rec = JSON.parse((await s.env.KEYS.get(`key:${hash}`))!) as KeyRecord;
    await writeKey(s.env.KEYS, hash, { ...rec, stripe_status: "canceled" }, T0);
    release(s, "2026-11-12T00:00:00Z", () => {});
    const r = await runWatchCheck(s.env);
    assert.equal(r.subscriptions_deleted, 1);
    assert.deepEqual(s.space.object("watch:sub:sub_1").storage.tables(), []);
  });

  it("deleting, or reading, for a subscription that never watched creates nothing", async () => {
    const s = setup();
    await s.env.WATCH!.sub("sub_9", "forget");
    await s.env.WATCH!.sub("sub_9", "list", {});
    await s.env.WATCH!.sub("sub_9", "recent", {});
    await s.env.WATCH!.sub("sub_9", "alerts_get", {});
    assert.deepEqual(s.space.object("watch:sub:sub_9").storage.tables(), []);
  });

  it("keeps addresses and tokens out of logs and usage counters", async () => {
    const s = setup();
    const lines: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log =
      console.error =
      console.warn =
        (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      const key = await issue(s.env);
      await s.call(rest("add", { urns: [P1] }, key));
      await confirmAlerts(s, key, "owner@example.com");
      release(s, "2026-11-12T00:00:00Z", (recs) =>
        recs.set(P1, parcel(P1, { owner: "X LLC", idSuffix: "n" })),
      );
      s.email.binding.send = async () => {
        throw Object.assign(new Error("nope"), { code: "E_X" });
      };
      await s.call(
        rest("alerts", { enabled: true, email: "other@example.com" }, key),
      );
      await runWatchCheck(s.env);
      await s.call(rest("add", { urns: [P2] }));
    } finally {
      Object.assign(console, orig);
    }
    const all = lines.join("\n") + JSON.stringify(s.points);
    assert.ok(all.includes("email failed"));
    assert.ok(!all.includes("owner@example.com"));
    assert.ok(!all.includes("other@example.com"));
    assert.ok(!all.includes("fl_live_"));
  });

  it("the registry reader reads built_at and answers misses", async () => {
    const r = fakeRegistry();
    const reader = registryReader(r.fetcher);
    assert.equal(await reader.builtAt(), "2026-11-05T00:00:00Z");
    const one = await reader.getMany([P1], 1);
    assert.deepEqual(one.reads[0], {
      found: false,
      message: `no registry record for ${P1}: county not loaded`,
    });
    r.pack.down = true;
    await assert.rejects(reader.getMany([P1], 1));
  });

  it("the account page shows the section and its forms work", async () => {
    const s = setup();
    const key = await issue(s.env);
    const post = (fields: Record<string, string>) =>
      s.call(
        new Request("https://factlot.com/account", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ key, ...fields }).toString(),
        }),
      );
    let html = await (
      await post({ action: "watch_add", list: "default", urns: `${P1}\n${P2}` })
    ).text();
    assert.match(html, /2 added\./);
    assert.match(html, /2 of 200 subjects watched/);
    html = await (
      await post({ action: "watch_alerts_on", email: "owner@example.com" })
    ).text();
    assert.match(html, /A confirmation link is on its way/);
    assert.match(html, /Waiting for confirmation/);
    html = await (await post({ action: "watch_alerts_off" })).text();
    assert.match(html, /Alert emails are off and the addresses are deleted/);
    html = await (
      await post({ action: "watch_remove_list", list: "default" })
    ).text();
    assert.match(html, /The list is removed/);
  });
});

// --- Review fixes ------------------------------------------------------------------------------

/** A signed Stripe webhook for subscription sub_1's cancellation. */
async function cancelled(sub = "sub_1") {
  const t = Math.floor(T0 / 1000);
  const body = JSON.stringify({
    id: "evt_1",
    type: "customer.subscription.deleted",
    created: t,
    data: { object: { id: sub, status: "canceled", customer: "cus_1" } },
  });
  const sig = await hmacSha256Hex("whsec_x", `${t}.${body}`);
  return new Request("https://api.factlot.com/v1/billing/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": `t=${t},v1=${sig}` },
  });
}

const parcelUrn = (n: number) =>
  `fl:parcel:us-48201:${String(3_000_000 + n).padStart(13, "0")}`;

describe("watch lists: deletion is never a guess", () => {
  it("a key rotation seen half-way, or an empty key list, deletes nothing", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    const hash = JSON.parse((await s.env.KEYS.get("sub:sub_1"))!)[0] as string;
    const rec = JSON.parse((await s.env.KEYS.get(`key:${hash}`))!) as KeyRecord;
    // The old key replaced; the new key's hash not yet in the (stale) list.
    await writeKey(s.env.KEYS, hash, { ...rec, replaced_by: "abc123" }, T0);
    release(s, "2026-11-12T00:00:00Z", () => {});
    let r = await runWatchCheck(s.env);
    assert.equal(r.subscriptions_deleted, 0);
    await s.env.KEYS.put("sub:sub_1", "[]");
    r = await runWatchCheck(s.env);
    assert.equal(r.subscriptions_deleted, 0);
    await s.env.KEYS.delete("sub:sub_1");
    r = await runWatchCheck(s.env);
    assert.equal(r.subscriptions_deleted, 0);
    assert.ok(s.space.object("watch:sub:sub_1").storage.tables().length > 0);
  });

  it("the webhook deletes a subscription that is not in the index, and answers 503 when it cannot", async () => {
    const s = setup();
    const key = await issue(s.env);
    await confirmAlerts(s, key, "owner@example.com");
    await s.env.WATCH!.index("unregister", { owner: "sub:sub_1" });
    assert.equal((await s.call(await cancelled())).status, 200);
    assert.deepEqual(s.space.object("watch:sub:sub_1").storage.tables(), []);
    assert.ok(![...s.env.KEYS.data.keys()].some((k) => k.startsWith("watch")));
    // Storage down: 503, so Stripe sends the event again.
    const t = setup();
    const k2 = await issue(t.env);
    await t.call(rest("add", { urns: [P1] }, k2));
    const real = t.env.WATCH!;
    t.env.WATCH = {
      ...real,
      sub: async () => {
        throw new Error("down");
      },
    };
    assert.equal((await t.call(await cancelled())).status, 503);
  });

  it("with the variable off the webhook calls no watch storage and counts no watch tool label", async () => {
    const s = setup("false");
    const key = await issue(s.env);
    assert.equal((await s.call(await cancelled())).status, 200);
    assert.ok(![...s.space.objects.keys()].some((n) => n.startsWith("watch:")));
    await s.call(
      mcp(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "watch_add", arguments: { urns: [P1] } },
        },
        key,
      ),
    );
    assert.ok(!JSON.stringify(snapshot().counters).includes("watch_add"));
  });
});

describe("watch lists: failures stay contained", () => {
  it("a registry 5xx stops the run without recording a removed record", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1, P2] }, key));
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(P1, parcel(P1, { year: 2026, idSuffix: "n" })),
    );
    // Health answers, then the registry goes down for the reads.
    const realFetch = s.registry.fetcher.fetch;
    let n = 0;
    s.registry.fetcher.fetch = async (r: Request) => {
      if (n++ > 0) return new Response("down", { status: 503 });
      return realFetch(r);
    };
    const r = await runWatchCheck(s.env);
    assert.equal(r.stopped, true);
    assert.equal(r.changes, 0);
    s.registry.fetcher.fetch = realFetch;
    await runWatchCheck(s.env);
    const c = (await (await s.call(rest("changes", {}, key))).json()) as {
      changes: Rec[];
    };
    assert.deepEqual(
      c.changes.map((x) => x.aspect),
      ["value"],
    );
    const l = (await (await s.call(rest("list", {}, key))).json()) as {
      subjects: Rec[];
    };
    assert.ok(l.subjects.every((x) => x.status === "current"));
  });

  it("a subject that keeps failing is given up for the check, and other subscriptions are checked", async () => {
    const s = setup();
    const k1 = await issue(s.env);
    const k2 = await issue(s.env, { subscription: "sub_2", customer: "cus_2" });
    const BAD = parcelUrn(1);
    s.registry.pack.records.set(BAD, parcel(BAD));
    await s.call(rest("add", { urns: [BAD, P1] }, k1));
    await s.call(rest("add", { urns: [P2] }, k2));
    release(s, "2026-11-12T00:00:00Z", (recs) => {
      recs.set(P1, parcel(P1, { year: 2026, idSuffix: "n" }));
      recs.set(P2, parcel(P2, { year: 2026, idSuffix: "n" }));
    });
    // The bad subject breaks every call it is in.
    s.registry.pack.broken.add(BAD);
    const first = await runWatchCheck(s.env);
    assert.equal(first.stopped, undefined);
    const two = (await (await s.call(rest("changes", {}, k2))).json()) as {
      changes: Rec[];
    };
    assert.deepEqual(
      two.changes.map((x) => x.aspect),
      ["value"],
    );
    for (let i = 0; i < 5; i++) await runWatchCheck(s.env);
    const one = (await (await s.call(rest("changes", {}, k1))).json()) as {
      changes: Rec[];
      check: Rec;
    };
    assert.deepEqual(
      one.changes.map((x) => x.urn),
      [P1],
    );
    assert.deepEqual(
      (one.check.not_compared as Rec[]).map((x) => x.urn),
      [BAD],
    );
    assert.equal((await s.env.WATCH!.index<Rec>("state")).done_seq, 2);
    // Next pack it is read again.
    s.registry.pack.broken.clear();
    release(s, "2026-11-19T00:00:00Z", () => {});
    await runWatchCheck(s.env);
    const l = (await (await s.call(rest("list", {}, k1))).json()) as {
      subjects: Rec[];
    };
    assert.ok(l.subjects.every((x) => x.read_error === undefined));
  });

  it("an error answer for one subject is counted for that subject only", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1, P2] }, key));
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(P2, parcel(P2, { year: 2026, idSuffix: "n" })),
    );
    s.registry.pack.errors.add(P1);
    await runWatchCheck(s.env);
    const l = (await (await s.call(rest("list", {}, key))).json()) as {
      subjects: Rec[];
    };
    const byUrn = new Map(l.subjects.map((x) => [x.urn, x]));
    assert.equal(byUrn.get(P1)!.read_error, "InternalError");
    assert.equal(byUrn.get(P2)!.read_error, undefined);
  });
});

describe("watch lists: service-binding calls", () => {
  it("a run stays within 30 registry and Durable Object calls, reading 50 subjects per registry call", async () => {
    const s = setup();
    const keys = [];
    for (let k = 0; k < 4; k++)
      keys.push(
        await issue(s.env, { subscription: `sub_${k}`, customer: `cus_${k}` }),
      );
    for (let i = 0; i < 150; i++)
      s.registry.pack.records.set(parcelUrn(i), parcel(parcelUrn(i)));
    for (const [k, key] of keys.entries())
      for (let i = 0; i < 150; i += 50) {
        const before = s.registry.calls.binding;
        const urns = Array.from({ length: 50 }, (_, j) =>
          parcelUrn((i + j + k * 7) % 150),
        );
        const res = await s.call(rest("add", { urns }, key));
        assert.equal(res.status, 200);
        // One health read (cached afterwards) and one /get-many for 50 subjects.
        assert.ok(s.registry.calls.binding - before <= 2);
      }
    release(s, "2026-11-12T00:00:00Z", (recs) => {
      for (let i = 0; i < 150; i++)
        recs.set(
          parcelUrn(i),
          parcel(parcelUrn(i), { year: 2026, idSuffix: "n" }),
        );
    });
    let runs = 0;
    for (;;) {
      const before = s.registry.calls.binding;
      const r = await runWatchCheck(s.env);
      runs++;
      assert.ok(r.invocations <= WATCH_CHECK.invocations);
      assert.ok(s.registry.calls.binding - before <= WATCH_CHECK.invocations);
      if (r.state === "done" || runs > 20) break;
    }
    assert.ok(runs < 20);
    for (const key of keys) {
      const c = (await (
        await s.call(rest("changes", { limit: 200 }, key))
      ).json()) as {
        changes: Rec[];
      };
      assert.equal(c.changes.length, 150);
    }
  });

  it("falls back to one call per subject against a registry without /get-many, within the budget", async () => {
    const s = setup();
    s.registry.pack.noGetMany = true;
    const key = await issue(s.env);
    const res = await s.call(rest("add", { urns: [P1, P2, E1] }, key));
    assert.equal(((await res.json()) as Rec).lookups_charged, 3);
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(E1, entity(E1, "Forfeited", "n")),
    );
    const r = await runWatchCheck(s.env);
    assert.ok(r.invocations <= WATCH_CHECK.invocations);
    const c = (await (await s.call(rest("changes", {}, key))).json()) as {
      changes: Rec[];
    };
    assert.deepEqual(
      c.changes.map((x) => x.aspect),
      ["entity_status"],
    );
  });
});

describe("watch lists: watch_add bookkeeping", () => {
  it("storage failing after the charge gives every lookup back", async () => {
    const s = setup();
    const key = await issue(s.env);
    const real = s.env.WATCH!;
    s.env.WATCH = {
      ...real,
      sub: async <T>(
        sub: string,
        op: string,
        args?: Record<string, unknown>,
      ) => {
        if (op === "add") throw new Error("down");
        return real.sub<T>(sub, op, args);
      },
    };
    const res = await s.call(rest("add", { urns: [P1, P2] }, key));
    assert.equal(res.status, 503);
    assert.equal(await lookupsUsed(s.env), 0);
  });

  it("registers before storing, and watch_list and watch_changes register again", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    const owners = async () =>
      (await s.env.WATCH!.index<{ owners: number }>("state")).owners;
    assert.equal(await owners(), 1);
    await s.env.WATCH!.index("unregister", { owner: "sub:sub_1" });
    await s.call(rest("list", {}, key));
    assert.equal(await owners(), 1);
    await s.env.WATCH!.index("unregister", { owner: "sub:sub_1" });
    await s.call(rest("changes", {}, key));
    assert.equal(await owners(), 1);
  });

  it("the same new URN added to two lists at once costs one lookup", async () => {
    const s = setup();
    const key = await issue(s.env);
    const [a, b] = await Promise.all([
      s.call(rest("add", { urns: [P1], list: "a" }, key)),
      s.call(rest("add", { urns: [P1], list: "b" }, key)),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(await lookupsUsed(s.env), 1);
  });

  it("subjects beyond a downgraded plan's limit are reported as not checked", async () => {
    const s = setup();
    const key = await issue(s.env, { plan: "team" });
    for (let i = 0; i < 201; i++)
      s.registry.pack.records.set(parcelUrn(i), parcel(parcelUrn(i)));
    for (let i = 0; i < 201; i += 50)
      await s.call(
        rest(
          "add",
          {
            urns: Array.from({ length: Math.min(50, 201 - i) }, (_, j) =>
              parcelUrn(i + j),
            ),
          },
          key,
        ),
      );
    const hash = JSON.parse((await s.env.KEYS.get("sub:sub_1"))!)[0] as string;
    const rec = JSON.parse((await s.env.KEYS.get(`key:${hash}`))!) as KeyRecord;
    await writeKey(s.env.KEYS, hash, { ...rec, plan: "pro" }, T0);
    const l = (await (
      await s.call(rest("list", { limit: 500 }, key))
    ).json()) as {
      watched: Rec;
      subjects: Rec[];
    };
    assert.equal(l.watched.not_checked, 1);
    assert.match(
      String(l.watched.note),
      /1 watched subject is beyond the plan's 200/,
    );
    assert.equal(l.subjects.filter((x) => x.checked === false).length, 1);
  });
});

describe("watch lists: alert address confirmation", () => {
  it("an unconfirmed address gets the confirmation email and nothing else", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    const res = await s.call(
      rest("alerts", { enabled: true, email: "new@example.com" }, key),
    );
    assert.equal(res.status, 202);
    const b = (await res.json()) as Rec;
    assert.equal(b.state, "pending");
    assert.equal(s.email.sent.length, 1);
    assert.match(s.email.sent[0]!.subject, /Confirm FactLot watch-list alerts/);
    assert.ok(!s.email.sent[0]!.text.includes("stop/"));
    let l = (await (await s.call(rest("list", {}, key))).json()) as {
      alerts: Rec;
    };
    assert.equal(l.alerts.state, "pending");
    assert.equal(l.alerts.pending_email, "n•••w@example.com");
    // The unconfirmed address is kept only in KV, which deletes it after 24 hours.
    const stored = JSON.stringify(
      s.space
        .object("watch:sub:sub_1")
        .storage.sql.exec("SELECT * FROM w_meta")
        .toArray(),
    );
    assert.ok(!stored.includes("new@example.com"));
    const kv = [...s.env.KEYS.data.entries()].filter(([k]) =>
      k.startsWith("watchconfirm:"),
    );
    assert.equal(kv.length, 1);
    assert.equal(s.env.KEYS.ttl.get(kv[0]![0]), 24 * 3600);
    assert.equal(l.alerts.enabled, false);
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(P1, parcel(P1, { year: 2026, idSuffix: "n" })),
    );
    await runWatchCheck(s.env);
    assert.equal(s.email.sent.length, 1);
    // Rate limited per subscription, one pending address at a time.
    const again = await s.call(
      rest("alerts", { enabled: true, email: "other@example.com" }, key),
    );
    assert.equal(again.status, 429);
    s.clock.t += 11 * 60_000;
    const firstLink = /(\/account\/watch-alerts\/confirm\/\S+)/.exec(
      s.email.sent[0]!.text,
    )![1]!;
    assert.equal(
      (
        await s.call(
          rest("alerts", { enabled: true, email: "other@example.com" }, key),
        )
      ).status,
      202,
    );
    // The first link no longer works; the second does.
    assert.equal(
      (
        await s.call(
          new Request(`https://factlot.com${firstLink}`, { method: "POST" }),
        )
      ).status,
      404,
    );
    const second = /(\/account\/watch-alerts\/confirm\/\S+)/.exec(
      s.email.sent[1]!.text,
    )![1]!;
    const get = await s.call(new Request(`https://factlot.com${second}`));
    assert.match(await get.text(), /Confirm/);
    assert.equal(
      (
        await s.call(
          new Request(`https://factlot.com${second}`, { method: "POST" }),
        )
      ).status,
      200,
    );
    l = (await (await s.call(rest("list", {}, key))).json()) as { alerts: Rec };
    assert.equal(l.alerts.state, "confirmed");
    assert.equal(l.alerts.email, "o•••r@example.com");
  });

  it("a confirmation link expires", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(
      rest("alerts", { enabled: true, email: "new@example.com" }, key),
    );
    const link = /(\/account\/watch-alerts\/confirm\/\S+)/.exec(
      s.email.sent[0]!.text,
    )![1]!;
    s.clock.t += 25 * 3_600_000;
    assert.equal(
      (
        await s.call(
          new Request(`https://factlot.com${link}`, { method: "POST" }),
        )
      ).status,
      404,
    );
  });

  it("a failed digest is released and sent by a later run; a claimed one never twice", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    await confirmAlerts(s, key, "owner@example.com");
    release(s, "2026-11-12T00:00:00Z", (recs) =>
      recs.set(P1, parcel(P1, { year: 2026, idSuffix: "n" })),
    );
    const send = s.email.binding.send;
    s.email.binding.send = async () => {
      throw new Error("nope");
    };
    await runWatchCheck(s.env);
    s.email.binding.send = send;
    forceRerun(s);
    await runWatchCheck(s.env);
    forceRerun(s);
    await runWatchCheck(s.env);
    assert.equal(
      s.email.sent.filter((m) => /registry update/.test(m.subject)).length,
      1,
    );
  });
});

describe("watch lists: storage", () => {
  it("has indexes on subjects by URN and changes by built_at, and a status column", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    const sql = s.space.object("watch:sub:sub_1").storage.sql;
    const names = sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'index'")
      .toArray()
      .map((r) => r.name);
    assert.ok(names.includes("w_subjects_urn"));
    assert.ok(names.includes("w_changes_built_at"));
    assert.equal(
      sql.exec("SELECT status FROM w_prints").toArray()[0]!.status,
      "current",
    );
  });

  it("old changes go after 400 days even for an unpaid subscription, and on reads", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    const sql = s.space.object("watch:sub:sub_1").storage.sql;
    const old = new Date(T0 - 401 * 86_400_000).toISOString();
    sql.exec(
      "INSERT INTO w_changes (urn, aspect, built_at, seq, detected_at, body) VALUES (?, 'value', 'x', 99, ?, '{}')",
      P1,
      old,
    );
    await s.call(rest("list", {}, key));
    assert.equal(
      sql.exec("SELECT COUNT(*) AS n FROM w_changes").toArray()[0]!.n,
      0,
    );
    sql.exec(
      "INSERT INTO w_changes (urn, aspect, built_at, seq, detected_at, body) VALUES (?, 'value', 'x', 99, ?, '{}')",
      P1,
      old,
    );
    const hash = JSON.parse((await s.env.KEYS.get("sub:sub_1"))!)[0] as string;
    const rec = JSON.parse((await s.env.KEYS.get(`key:${hash}`))!) as KeyRecord;
    await writeKey(s.env.KEYS, hash, { ...rec, stripe_status: "unpaid" }, T0);
    release(s, "2026-11-12T00:00:00Z", () => {});
    await runWatchCheck(s.env, { now: () => s.clock.t });
    assert.equal(
      sql.exec("SELECT COUNT(*) AS n FROM w_changes").toArray()[0]!.n,
      0,
    );
  });

  it("a pack rolled back and deployed again is compared again", async () => {
    const s = setup();
    const key = await issue(s.env);
    await s.call(rest("add", { urns: [P1] }, key));
    const A = parcel(P1);
    const B = parcel(P1, { year: 2026, idSuffix: "n" });
    const builtA = s.registry.pack.built_at;
    release(s, "2026-11-12T00:00:00Z", (recs) => recs.set(P1, B));
    await runWatchCheck(s.env);
    release(s, builtA, (recs) => recs.set(P1, A));
    await runWatchCheck(s.env);
    release(s, "2026-11-12T00:00:00Z", (recs) => recs.set(P1, B));
    await runWatchCheck(s.env);
    const c = (await (await s.call(rest("changes", {}, key))).json()) as {
      changes: Rec[];
    };
    assert.equal(c.changes.length, 3);
  });

  it("recorded-document hashes are keyed by a server secret; a new key re-baselines them", async () => {
    const rec = parcel(P1, { deeds: [{ date: "2026-10-01", price: 9 }] });
    const plain = await fingerprint(rec);
    const keyed = await fingerprint(rec, "k".repeat(64));
    const other = await fingerprint(rec, "z".repeat(64));
    assert.equal(plain.dk, "sha256");
    assert.notEqual(keyed.dk, other.dk);
    assert.notEqual(keyed.documents.items[0]!.h, plain.documents.items[0]!.h);
    assert.deepEqual(compare(keyed, other, new Set(ASPECTS)), []);
  });
});
