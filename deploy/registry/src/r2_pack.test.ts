// The object-storage backend (r2_pack.ts) and the sync tool (scripts/registry/sync_pack.ts) on an in-memory bucket:
// the pointer fails closed when missing or inconsistent, a request never mixes two packs, switches and rollbacks,
// and the sync tool uploads only what changed, resumes, verifies before it moves the pointer, and prunes safely.
// Answer parity with the static-assets backend is in worker.test.ts (every parity run reads both backends).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bindingStore,
  signV4,
  type ObjectStore,
} from "../../../scripts/registry/object_store.ts";
import { buildPack } from "../../../scripts/registry/pack.ts";
import {
  SyncError,
  prune,
  readPointer,
  rollback,
  scanPack,
  switchPack,
  syncPack,
  type SyncOptions,
} from "../../../scripts/registry/sync_pack.ts";
import { fileAssets } from "./file_assets.ts";
import type { Manifest } from "./format.ts";
import { MemoryBucket } from "./memory_bucket.ts";
import {
  POINTER_KEY,
  PackResolver,
  PackUnavailable,
  bucketText,
  completeKey,
  packKey,
} from "./r2_pack.ts";
import { handle, type Env } from "./worker.ts";

const spec = fileURLToPath(new URL("../../../spec/registry/", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "factlot-r2-pack-"));
const fixture = join(dir, "fixture.db");
execFileSync("python3", [join(spec, "build_fixture.py"), fixture]);
const packA = join(dir, "pack-a");
buildPack([{ name: "fixture", path: fixture }], packA);
const manifestA = JSON.parse(
  readFileSync(join(packA, "manifest.json"), "utf8"),
) as Manifest;
const urn = Object.keys(
  (
    JSON.parse(readFileSync(join(packA, "g/0/0.json"), "utf8")) as {
      e: Record<string, unknown>;
    }
  ).e,
).find((k) => k.startsWith("fl:parcel:"))!;

/** Pack B: pack A with another built_at and one record shard changed, so answers tell the packs apart. */
const packB = join(dir, "pack-b");
cpSync(packA, packB, { recursive: true });
writeFileSync(
  join(packB, "manifest.json"),
  JSON.stringify({ ...manifestA, built_at: "2026-12-01T00:00:00.000Z" }),
);
const shardB = join(packB, "g/0/0.json");
const shardText = readFileSync(shardB, "utf8");
// A value of the shard's string table, so the record of `urn` (or another in the shard) reads differently.
writeFileSync(shardB, shardText.replaceAll("Example City", "Sample City"));
assert.ok(readFileSync(shardB, "utf8") !== shardText, "pack B differs");

const quiet = { log: () => {}, sleep: async () => {}, seed: 1 };
const opts = (id: string, more: Partial<SyncOptions> = {}): SyncOptions => ({
  id,
  ...quiet,
  ...more,
});

let clock = Date.parse("2026-11-12T00:00:00Z");
const now = () => new Date((clock += 1000));

async function run(
  env: Env,
  tool: string,
  input: unknown,
): Promise<{ status: number; body: string }> {
  const res = await handle(
    new Request("https://registry.internal/run", {
      method: "POST",
      body: JSON.stringify({ tool, input }),
    }),
    env,
  );
  return { status: res.status, body: await res.text() };
}

const r2 = (bucket: MemoryBucket, ttl = "0"): Env => ({
  PACK_BACKEND: "r2",
  PACK_BUCKET: bucket,
  PACK_POINTER_TTL_SECONDS: ttl,
});

async function assetsAnswer(pack: string, tool: string, input: unknown) {
  return run({ ASSETS: fileAssets(pack) }, tool, input);
}

test("the Worker on r2 fails closed: no pointer, a malformed one, an incomplete or mismatched pack", async () => {
  const bucket = new MemoryBucket();
  const env = r2(bucket);
  let r = await run(env, "registry_get", { urn });
  assert.equal(r.status, 503);
  assert.match(r.body, /PackUnavailable/);
  assert.match(r.body, /no pack pointer at packs\/current\.json/);

  bucket.poke(POINTER_KEY, "{not json");
  r = await run(env, "registry_get", { urn });
  assert.equal(r.status, 503);
  assert.match(r.body, /not JSON/);

  // A pack uploaded but never verified (no completion record), the pointer pointed at it by hand. (The sync tool
  // itself refuses to run while the pointer is malformed: it cannot tell which packs are live.)
  const store = bindingStore(bucket);
  await assert.rejects(syncPack(store, packA, opts("a")), PackUnavailable);
  await store.delete(POINTER_KEY);
  await syncPack(store, packA, opts("a", { switchPointer: false }));
  const record = readFileSync(join(packA, "manifest.json"));
  const complete = JSON.parse(
    new TextDecoder().decode((await store.get(completeKey("a")))!.body),
  ) as Record<string, unknown>;
  await store.delete(completeKey("a"));
  bucket.poke(
    POINTER_KEY,
    JSON.stringify({
      ...complete,
      format: 1,
      switched_at: "x",
      previous: null,
    }),
  );
  r = await run(env, "registry_get", { urn });
  assert.equal(r.status, 503);
  assert.match(r.body, /no completion record/);

  // The record back, but the manifest is not the one the pointer names (a half-synced re-upload).
  bucket.poke(completeKey("a"), JSON.stringify(complete));
  assert.equal((await run(env, "registry_get", { urn })).status, 200);
  bucket.poke(
    packKey("a", "manifest.json"),
    JSON.stringify({ ...manifestA, built_at: "2027-01-01T00:00:00.000Z" }),
  );
  r = await run(env, "registry_get", { urn });
  assert.equal(r.status, 503);
  assert.match(r.body, /not the one the pointer names/);
  bucket.poke(packKey("a", "manifest.json"), record);
  assert.equal((await run(env, "registry_get", { urn })).status, 200);

  // A completion record of another upload of the same id.
  bucket.poke(completeKey("a"), JSON.stringify({ ...complete, files: 1 }));
  r = await run(env, "registry_get", { urn });
  assert.equal(r.status, 503);
  assert.match(r.body, /does not match the pointer/);

  // Configuration errors are refusals too.
  r = await run({ PACK_BACKEND: "r2" }, "registry_get", { urn });
  assert.equal(r.status, 503);
  assert.match(r.body, /no PACK_BUCKET binding/);
  r = await run({ PACK_BACKEND: "s3", PACK_BUCKET: bucket }, "registry_get", {
    urn,
  });
  assert.equal(r.status, 503);
  // The default stays the static-assets backend.
  assert.equal(
    (await run({ ASSETS: fileAssets(packA) }, "registry_get", { urn })).status,
    200,
  );
});

test("the Worker on r2 answers as on assets, reads the pointer once per TTL, and reports the pack on /health", async () => {
  const bucket = new MemoryBucket();
  await syncPack(bindingStore(bucket), packA, opts("a"));
  const env = r2(bucket, "30");
  const want = await assetsAnswer(packA, "registry_get", { urn });
  bucket.ops.get = 0;
  const first = await run(env, "registry_get", { urn });
  assert.equal(first.body, want.body);
  // Pointer, completion record, manifest, then the record shard.
  assert.equal(bucket.ops.get, 4);
  const second = await run(env, "registry_get", { urn });
  assert.equal(second.body, want.body);
  assert.equal(bucket.ops.get, 4, "warm: pointer cached, shard cached");
  const h = await handle(new Request("https://registry.internal/health"), env);
  const health = (await h.json()) as { pack: Record<string, unknown> };
  assert.equal(health.pack.backend, "r2");
  assert.equal(health.pack.pack_id, "a");
  assert.equal(health.pack.built_at, manifestA.built_at);
});

test("a pointer switch mid-request: the request keeps its pack; the next one reads the new pack", async () => {
  const bucket = new MemoryBucket();
  const store = bindingStore(bucket);
  await syncPack(store, packA, opts("a", { now }));
  await syncPack(store, packB, opts("b", { now, switchPointer: false }));
  const env = r2(bucket);
  const wantA = await assetsAnswer(packA, "registry_get", { urn });
  const wantB = await assetsAnswer(packB, "registry_get", { urn });
  assert.ok(wantA.body !== wantB.body, "the packs answer differently");

  // Hold request 1 at its record-shard read, after it has opened pack a.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const reached = new Promise<void>((r) => (held = r));
  bucket.beforeGet = async (key) => {
    if (key === packKey("a", "g/0/0.json")) {
      held();
      await gate;
    }
  };
  const readsBefore = bucket.gets.length;
  const first = run(env, "registry_get", { urn });
  await reached;
  await switchPack(store, "b", { ...quiet, now });
  const second = await run(env, "registry_get", { urn });
  release();
  bucket.beforeGet = undefined;
  assert.equal((await first).body, wantA.body, "request 1: pack a only");
  assert.equal(second.body, wantB.body, "request 2: pack b");
  const shardReads = bucket.gets
    .slice(readsBefore)
    .filter((k) => /^packs\/[ab]\/g\//.test(k));
  assert.deepEqual(shardReads, ["packs/a/g/0/0.json", "packs/b/g/0/0.json"]);
});

test("rollback moves the pointer back, and again forward; each pack is checked before the switch", async () => {
  const bucket = new MemoryBucket();
  const store = bindingStore(bucket);
  await syncPack(store, packA, opts("a", { now }));
  await syncPack(store, packB, opts("b", { now }));
  const env = r2(bucket);
  const wantA = await assetsAnswer(packA, "registry_get", { urn });
  const wantB = await assetsAnswer(packB, "registry_get", { urn });
  assert.equal((await run(env, "registry_get", { urn })).body, wantB.body);
  let p = await rollback(store, { ...quiet, now });
  assert.equal(p.pack_id, "a");
  assert.equal(p.previous?.pack_id, "b");
  assert.equal((await run(env, "registry_get", { urn })).body, wantA.body);
  p = await rollback(store, { ...quiet, now });
  assert.equal(p.pack_id, "b");
  assert.equal((await run(env, "registry_get", { urn })).body, wantB.body);

  // No switch to a pack without a completion record, or to one whose stored manifest serves a withheld county.
  await assert.rejects(switchPack(store, "c", quiet), /no completion record/);
  // Uploaded as t, then the stored manifest replaced as if by hand, with a completion record to match.
  await syncPack(store, packA, opts("t", { now, switchPointer: false }));
  const bad = JSON.stringify({
    ...manifestA,
    withheld: {},
    counties: { ...manifestA.counties, "us-48439": 0 },
  });
  bucket.poke(packKey("t", "manifest.json"), bad);
  const rec = JSON.parse(
    new TextDecoder().decode((await store.get(completeKey("t")))!.body),
  ) as Record<string, unknown>;
  bucket.poke(
    completeKey("t"),
    JSON.stringify({
      ...rec,
      manifest_sha256: createHash("sha256").update(bad).digest("hex"),
    }),
  );
  await assert.rejects(switchPack(store, "t", quiet), /serves county 48439/);
  assert.equal((await readPointer(store))!.pointer.pack_id, "b");

  // A rollback target whose completion record is no longer the one the pointer recorded is refused.
  const recA = (await store.get(completeKey("a")))!.body;
  const changedA = JSON.parse(new TextDecoder().decode(recA)) as Record<
    string,
    unknown
  >;
  bucket.poke(completeKey("a"), JSON.stringify({ ...changedA, files: 1 }));
  await assert.rejects(
    rollback(store, quiet),
    /not the pack the pointer recorded/,
  );
  bucket.poke(completeKey("a"), recA);
  assert.equal((await rollback(store, { ...quiet, now })).pack_id, "a");
});

test("PackResolver: the pointer is kept for the TTL; a storage error keeps the pack a while; a bad pointer fails closed", async () => {
  const bucket = new MemoryBucket();
  await syncPack(bindingStore(bucket), packA, opts("a"));
  let t = 0;
  const warnings: string[] = [];
  const r = new PackResolver(bucketText(bucket), {
    ttlMs: 30_000,
    staleMs: 300_000,
    now: () => t,
    warn: (m) => warnings.push(m),
  });
  const p1 = await r.pack();
  assert.equal(r.reads, 3);
  t = 29_000;
  assert.equal(await r.pack(), p1);
  assert.equal(r.reads, 3);
  t = 31_000;
  assert.equal(await r.pack(), p1, "unchanged pointer: same pack, cache kept");
  assert.equal(
    r.reads,
    6,
    "pointer, completion record and manifest read again",
  );
  bucket.failGet = (k) => k === POINTER_KEY;
  t = 100_000;
  assert.equal(await r.pack(), p1, "storage error: still the pack");
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0]!, /simulated/);
  t = 400_000;
  await assert.rejects(r.pack(), PackUnavailable);
  bucket.failGet = undefined;
  t = 410_000;
  assert.ok(await r.pack());
  bucket.poke(POINTER_KEY, "{}");
  t = 500_000;
  await assert.rejects(r.pack(), /no valid pack_id/);
  // A pack the resolver held is not served once the pointer is bad.
  t = 502_000;
  await assert.rejects(r.pack(), PackUnavailable);
  assert.equal(r.packId, undefined);
});

test("sync: only missing or changed files are uploaded; a second run uploads nothing", async () => {
  const bucket = new MemoryBucket();
  const store = bindingStore(bucket);
  const first = await syncPack(
    store,
    packA,
    opts("x", { switchPointer: false }),
  );
  const files = scanPack(packA).files.length;
  assert.equal(first.uploaded, files);
  assert.equal(first.verified, true);
  assert.equal(first.switched, false);
  assert.equal(await readPointer(store), undefined);
  const again = await syncPack(
    store,
    packA,
    opts("x", { switchPointer: false }),
  );
  assert.equal(again.uploaded, 0);
  assert.equal(again.unchanged, files);
  // The same id, one file changed and one gone (not live, so it may change): one upload, one delete.
  const changed = join(dir, "pack-changed");
  cpSync(packA, changed, { recursive: true });
  writeFileSync(
    join(changed, "g/0/0.json"),
    shardText.replaceAll("Example City", "Other City"),
  );
  bucket.poke(packKey("x", "x/999.json"), "{}");
  const third = await syncPack(
    store,
    changed,
    opts("x", { switchPointer: false }),
  );
  assert.equal(third.uploaded, 1);
  assert.equal(third.deleted, 1);
  // A dry run plans and writes nothing.
  bucket.ops.put = 0;
  const dry = await syncPack(store, packA, opts("x", { dryRun: true }));
  assert.equal(dry.uploaded, 1);
  assert.equal(bucket.ops.put, 0);
});

test("sync: an interrupted upload leaves no completion record and no pointer; running again resumes", async () => {
  const bucket = new MemoryBucket();
  const store = bindingStore(bucket);
  const files = scanPack(packA).files.length;
  let puts = 0;
  bucket.beforePut = () => {
    if (++puts > 7) throw new Error("connection reset");
  };
  await assert.rejects(
    syncPack(store, packA, opts("r", { attempts: 2, concurrency: 1 })),
    (err: Error) =>
      err instanceof SyncError && /failed after 2 attempts/.test(err.message),
  );
  assert.equal(await store.get(completeKey("r")), undefined);
  assert.equal(await readPointer(store), undefined);
  bucket.beforePut = undefined;
  const resumed = await syncPack(store, packA, opts("r"));
  assert.equal(resumed.uploaded, files - 7);
  assert.equal(resumed.switched, true);
  // Transient failures are retried per object.
  const flaky = new MemoryBucket();
  const seen = new Set<string>();
  flaky.beforePut = (key) => {
    if (key.includes("/g/") && !seen.has(key)) {
      seen.add(key);
      throw new Error("503");
    }
  };
  const r = await syncPack(
    bindingStore(flaky),
    packA,
    opts("f", { attempts: 3 }),
  );
  assert.equal(r.uploaded, files);
  assert.ok(seen.size > 0);
});

test("sync: a failed verification leaves the pointer on the old pack", async () => {
  const bucket = new MemoryBucket();
  const base = bindingStore(bucket);
  await syncPack(base, packA, opts("a", { now }));
  // A store that loses an object between upload and listing, then one whose read-back differs.
  const losing: ObjectStore = {
    ...base,
    list: async (prefix) =>
      (await base.list(prefix)).filter((o) => !o.key.endsWith("x/0.json")),
  };
  await assert.rejects(
    syncPack(losing, packB, opts("b", { now })),
    /verification of pack b failed; the pointer is unchanged/,
  );
  const garbling: ObjectStore = {
    ...base,
    get: async (key) => {
      const o = await base.get(key);
      return o && key.includes("/g/")
        ? { ...o, body: new TextEncoder().encode("{}") }
        : o;
    },
  };
  await assert.rejects(
    syncPack(garbling, packB, opts("b2", { now, samples: 1000 })),
    /reads back with a different body/,
  );
  const p = await readPointer(base);
  assert.equal(p!.pointer.pack_id, "a");
  assert.equal(await base.get(completeKey("b")), undefined);
  assert.equal(await base.get(completeKey("b2")), undefined);
});

test("sync: a live pack id is never changed, and a pointer moved meanwhile is not overwritten", async () => {
  const bucket = new MemoryBucket();
  const store = bindingStore(bucket);
  await syncPack(store, packA, opts("a", { now }));
  await assert.rejects(
    syncPack(store, packB, opts("a", { now })),
    /named by a pointer/,
  );
  await syncPack(store, packB, opts("b", { now, switchPointer: false }));
  bucket.beforePut = (key) => {
    if (key === POINTER_KEY) {
      bucket.beforePut = undefined;
      bucket.poke(POINTER_KEY, readFileSync(join(packA, "manifest.json")));
    }
  };
  await assert.rejects(
    switchPack(store, "b", { ...quiet, now }),
    /changed while switching/,
  );
});

test("prune: keeps the N newest verified packs and always the current and previous ones", async () => {
  const bucket = new MemoryBucket();
  const store = bindingStore(bucket);
  for (const id of ["p1", "p2", "p3", "p4", "p5"])
    await syncPack(store, id === "p2" ? packB : packA, opts(id, { now }));
  // p5 is live, p4 previous. An abandoned upload p6 has no completion record.
  bucket.beforePut = (key) => {
    if (key.includes("/n/")) throw new Error("gone");
  };
  await assert.rejects(syncPack(store, packA, opts("p6", { attempts: 1 })));
  bucket.beforePut = undefined;
  // Roll back once: p4 live, p5 previous.
  await rollback(store, { ...quiet, now });
  const dry = await prune(store, 1, { ...quiet, dryRun: true });
  assert.deepEqual(dry.sort(), ["p1", "p2", "p3"]);
  assert.ok(bucket.objects.has(packKey("p1", "manifest.json")));
  const gone = await prune(store, 1, quiet);
  assert.deepEqual(gone.sort(), ["p1", "p2", "p3"]);
  const left = new Set([...bucket.objects.keys()].map((k) => k.split("/")[1]));
  assert.deepEqual([...left].sort(), ["current.json", "p4", "p5", "p6"]);
  // keep 0 still never touches the current and previous packs; --prune-incomplete removes p6.
  assert.deepEqual(await prune(store, 0, { ...quiet, incomplete: true }), [
    "p6",
  ]);
  const env = r2(bucket);
  assert.equal((await run(env, "registry_get", { urn })).status, 200);
  await assert.rejects(
    prune(bindingStore(new MemoryBucket()), 1, quiet),
    /refusing to prune without knowing the live pack/,
  );
});

test("the pack checker reads the r2 backend through the fake bucket with the assets backend's answers", () => {
  const scratch = join(dir, "check");
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--conditions=factlot-source",
      fileURLToPath(
        new URL("../../../scripts/registry/check_pack.ts", import.meta.url),
      ),
      "--pack",
      packA,
      "--scratch",
      scratch,
      "--samples",
      "60",
      "--equity",
      "20",
      "--backend",
      "r2-memory",
      fixture,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.match(out, /r2-memory: pack check/);
  assert.match(out, /total mismatches: 0/);
});

test("SigV4 signing matches the AWS test suite's get-vanilla vector", () => {
  const auth = signV4({
    method: "GET",
    url: new URL("https://example.amazonaws.com/"),
    headers: {
      host: "example.amazonaws.com",
      "x-amz-date": "20150830T123600Z",
    },
    payloadHash: createHash("sha256").update("").digest("hex"),
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "service",
  });
  assert.equal(
    auth,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
});
