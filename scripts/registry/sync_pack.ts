/**
 * Release a registry pack to object storage (the registry Worker's "r2" backend; deploy/registry/src/r2_pack.ts).
 *
 *   node --experimental-strip-types scripts/registry/sync_pack.ts <pack dir> [--id <pack id>] [--no-switch]
 *        [--dry-run] [--concurrency 16] [--samples 64] [--pointer packs/current.json]
 *   ... --switch <pack id> [--pointer <key>]       move the pointer to an uploaded, verified pack
 *   ... --rollback [--pointer <key>]               move the pointer back to the pack it replaced
 *   ... --prune <N> [--prune-incomplete] [--dry-run]
 *                                                  delete packs beyond the N most recent verified ones, never the
 *                                                  current or previous pack of any pointer
 *   ... --status [--pointer <key>]                 the pointer and the packs in the bucket
 *
 * Credentials come from the environment only (R2_ACCOUNT_ID or R2_ENDPOINT, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET; scripts/registry/object_store.ts) and are never printed.
 *
 * A sync runs the same refusals as deploy.ts (no manifest, a withheld county served or not recorded, a file over
 * 25 MiB, a file that is not a pack file) except the static-assets file-count cap, then:
 *   1. hashes every file (MD5, which is R2's etag for a single-part upload, and SHA-256 of the manifest);
 *   2. lists packs/<id>/ and uploads only the files that are missing or whose etag or size differ, with bounded
 *      parallelism and per-object retries (an interrupted sync is resumed by running it again: what is already
 *      there is not uploaded twice), and deletes objects the pack does not have;
 *   3. verifies: lists again and compares every key, size and etag, the total count and bytes, the stored
 *      manifest's SHA-256, and a sample of files read back and hashed;
 *   4. writes packs/<id>/_sync/complete.json, then (unless --no-switch) the pointer, conditional on the pointer
 *      it read (two releases at once cannot both win).
 * A failure at any step leaves the pointer alone. A pack id the pointer names (current or previous) is never
 * changed: upload a new pack under a new id.
 *
 * Packs are stored whole under their own prefix (packs/<id>/<path>). A content-addressed store (objects keyed by
 * hash, a per-pack index) would save storage across releases but makes every Worker read two-step or needs the
 * index in memory; it is not built. The listing hash and per-file MD5s in the completion record are what such a
 * store would key on.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Manifest } from "../../deploy/registry/src/format.ts";
import {
  POINTER_FORMAT,
  POINTER_KEY,
  PACKS_PREFIX,
  SYNC_DIR,
  completeKey,
  identityOf,
  packKey,
  packPrefix,
  parseComplete,
  parsePointer,
  sameIdentity,
  validPackId,
  type PackComplete,
  type PackIdentity,
  type PackPointer,
} from "../../deploy/registry/src/r2_pack.ts";
import { manifestProblems, packProblems, walk } from "./deploy.ts";
import { s3StoreFromEnv, type ObjectStore } from "./object_store.ts";

const md5 = (b: Uint8Array): string =>
  createHash("md5").update(b).digest("hex");
const sha256 = (b: Uint8Array | string): string =>
  createHash("sha256").update(b).digest("hex");
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

export interface LocalFile {
  path: string;
  abs: string;
  size: number;
  md5: string;
}

export interface LocalPack {
  dir: string;
  files: LocalFile[];
  identity: Omit<PackIdentity, "pack_id">;
}

export function listingSha256(
  files: { path: string; md5: string; size: number }[],
): string {
  return sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => `${f.path} ${f.md5} ${f.size}\n`)
      .join(""),
  );
}

/** Every file of a pack directory with its MD5, and the identity a pointer would give it. */
export function scanPack(dir: string): LocalPack {
  const files: LocalFile[] = walk(dir)
    .map((abs) => {
      const body = readFileSync(abs);
      return {
        path: relative(dir, abs).split("\\").join("/"),
        abs,
        size: body.length,
        md5: md5(body),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifestText = readFileSync(resolve(dir, "manifest.json"));
  const m = JSON.parse(manifestText.toString("utf8")) as Manifest;
  return {
    dir,
    files,
    identity: {
      built_at: m.built_at,
      files: files.length,
      bytes: files.reduce((a, f) => a + f.size, 0),
      manifest_sha256: sha256(manifestText),
      listing_sha256: listingSha256(files),
    },
  };
}

export interface RunOptions {
  pointerKey?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
  /** Injected for tests. */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncOptions extends RunOptions {
  id: string;
  concurrency?: number;
  /** Attempts per object (default 5). */
  attempts?: number;
  /** Files read back and hashed in the verification pass (default 64; the manifest always). */
  samples?: number;
  /** Move the pointer after a verified sync (default true). */
  switchPointer?: boolean;
  /** Seed of the read-back sample (default: random). */
  seed?: number;
}

export interface SyncReport {
  id: string;
  files: number;
  bytes: number;
  uploaded: number;
  uploadedBytes: number;
  deleted: number;
  unchanged: number;
  verified: boolean;
  switched: boolean;
  dryRun: boolean;
}

export class SyncError extends Error {
  override name = "SyncError";
}

/** Runs `fn` over `items`, at most `n` at a time; the first error stops new work and is thrown. */
export async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed: unknown;
  const worker = async () => {
    while (failed === undefined && next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (err) {
        failed ??= err;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker),
  );
  if (failed !== undefined) throw failed;
}

async function withRetry<T>(
  what: string,
  attempts: number,
  sleep: (ms: number) => Promise<void>,
  fn: () => Promise<T>,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts)
        throw new SyncError(
          `${what} failed after ${attempts} attempts: ${err instanceof Error ? err.message : String(err)}`,
        );
      await sleep(Math.min(30_000, 500 * 2 ** (i - 1)) * (0.5 + Math.random()));
    }
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/** The pointer at `key` and its etag, or undefined when there is none. */
export async function readPointer(
  store: ObjectStore,
  key = POINTER_KEY,
): Promise<{ pointer: PackPointer; etag: string } | undefined> {
  const o = await store.get(key);
  if (!o) return undefined;
  return { pointer: parsePointer(dec(o.body), key), etag: o.etag };
}

async function readComplete(
  store: ObjectStore,
  id: string,
): Promise<PackComplete | undefined> {
  const o = await store.get(completeKey(id));
  return o ? parseComplete(dec(o.body), id) : undefined;
}

/** Every pointer object directly under packs/ (packs/current.json and any staging pointer). */
async function allPointers(store: ObjectStore): Promise<PackPointer[]> {
  const out: PackPointer[] = [];
  for (const o of await store.list(PACKS_PREFIX)) {
    const rest = o.key.slice(PACKS_PREFIX.length);
    if (rest.includes("/") || !rest.endsWith(".json")) continue;
    const p = await readPointer(store, o.key);
    if (p) out.push(p.pointer);
  }
  return out;
}

/** Upload a pack directory as packs/<id>/, verify it, record it complete and (by default) switch the pointer. */
export async function syncPack(
  store: ObjectStore,
  dir: string,
  o: SyncOptions,
): Promise<SyncReport> {
  const log = o.log ?? console.log;
  const sleep = o.sleep ?? defaultSleep;
  const attempts = o.attempts ?? 5;
  const id = o.id;
  if (!validPackId(id))
    throw new SyncError(
      `not a pack id: ${JSON.stringify(id)} (lower-case letters, digits, ".", "_" and "-")`,
    );
  const problems = packProblems(dir, { maxFiles: Infinity });
  if (problems.length)
    throw new SyncError(
      `refusing to sync ${dir}:\n  ${problems.slice(0, 20).join("\n  ")}`,
    );
  const local = scanPack(dir);
  const identity: PackIdentity = { pack_id: id, ...local.identity };
  log(
    `pack ${id}: ${identity.files} files, ${identity.bytes} bytes, built ${identity.built_at}`,
  );

  // Packs a pointer names are never changed (re-running the sync of the same pack only repairs missing objects).
  let live = false;
  for (const p of await allPointers(store))
    for (const named of [p, p.previous])
      if (named?.pack_id === id) {
        if (!sameIdentity(named, identity))
          throw new SyncError(
            `pack id ${id} is named by a pointer (current or previous) and holds a different pack; upload this one under a new id`,
          );
        live = true;
      }

  const prefix = packPrefix(id);
  const remote = new Map<string, { size: number; etag: string }>();
  for (const r of await store.list(prefix))
    remote.set(r.key.slice(prefix.length), { size: r.size, etag: r.etag });
  const complete = remote.has(`${SYNC_DIR}complete.json`)
    ? await readComplete(store, id)
    : undefined;
  const upload = local.files.filter((f) => {
    const r = remote.get(f.path);
    return !r || r.etag !== f.md5 || r.size !== f.size;
  });
  const localPaths = new Set(local.files.map((f) => f.path));
  const extra = [...remote.keys()].filter(
    (p) => !localPaths.has(p) && !p.startsWith(SYNC_DIR),
  );
  const report: SyncReport = {
    id,
    files: identity.files,
    bytes: identity.bytes,
    uploaded: upload.length,
    uploadedBytes: upload.reduce((a, f) => a + f.size, 0),
    deleted: extra.length,
    unchanged: local.files.length - upload.length,
    verified: false,
    switched: false,
    dryRun: !!o.dryRun,
  };
  log(
    `${upload.length} files to upload (${report.uploadedBytes} bytes), ${report.unchanged} already there, ${extra.length} to delete`,
  );
  if (o.dryRun) return report;

  // A pack being changed is not complete: drop its record first, so no switch can name it meanwhile.
  if (
    !live &&
    complete &&
    (upload.length || extra.length || !sameIdentity(complete, identity))
  )
    await store.delete(completeKey(id));

  let done = 0;
  await pool(upload, o.concurrency ?? 16, async (f) => {
    await withRetry(`upload of ${f.path}`, attempts, sleep, async () => {
      const etag = await store.put(packKey(id, f.path), readFileSync(f.abs), {
        contentType: "application/json",
      });
      if (etag !== f.md5)
        throw new Error(`stored etag ${etag ?? "none"} is not the file's MD5`);
    });
    done += 1;
    if (done % 1000 === 0) log(`  ${done} / ${upload.length} uploaded`);
  });
  await pool(extra, o.concurrency ?? 16, (p) =>
    withRetry(`delete of ${p}`, attempts, sleep, () =>
      store.delete(packKey(id, p)),
    ),
  );

  await verifyPack(store, local, id, o);
  report.verified = true;
  const record: PackComplete = {
    format: POINTER_FORMAT,
    ...identity,
    verified_at: (o.now ?? (() => new Date()))().toISOString(),
  };
  await store.put(completeKey(id), enc(JSON.stringify(record, null, 1)), {
    contentType: "application/json",
  });
  log(`verified and recorded complete: ${completeKey(id)}`);
  if (o.switchPointer ?? true) {
    await switchPack(store, id, { ...o, dryRun: false });
    report.switched = true;
  }
  return report;
}

/** The verification pass: the full listing against the local files, the manifest hash, a sampled read-back. */
export async function verifyPack(
  store: ObjectStore,
  local: LocalPack,
  id: string,
  o: SyncOptions,
): Promise<void> {
  const prefix = packPrefix(id);
  const listed = (await store.list(prefix)).filter(
    (r) => !r.key.slice(prefix.length).startsWith(SYNC_DIR),
  );
  const bad: string[] = [];
  if (listed.length !== local.files.length)
    bad.push(
      `${listed.length} objects stored, the pack has ${local.files.length} files`,
    );
  const bytes = listed.reduce((a, r) => a + r.size, 0);
  if (bytes !== local.identity.bytes)
    bad.push(`${bytes} bytes stored, the pack has ${local.identity.bytes}`);
  const byPath = new Map(listed.map((r) => [r.key.slice(prefix.length), r]));
  for (const f of local.files) {
    const r = byPath.get(f.path);
    if (!r) bad.push(`${f.path} is not stored`);
    else if (r.etag !== f.md5 || r.size !== f.size)
      bad.push(`${f.path} is stored with a different body`);
    if (bad.length > 20) break;
  }
  const stored = listingSha256(
    listed.map((r) => ({
      path: r.key.slice(prefix.length),
      md5: r.etag,
      size: r.size,
    })),
  );
  if (!bad.length && stored !== local.identity.listing_sha256)
    bad.push("the stored listing does not hash to the pack's");
  const manifest = await store.get(packKey(id, "manifest.json"));
  if (!manifest || sha256(manifest.body) !== local.identity.manifest_sha256)
    bad.push("the stored manifest.json is not the pack's");
  let seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  const sample = new Set<LocalFile>();
  const want = Math.min(o.samples ?? 64, local.files.length);
  while (sample.size < want)
    sample.add(local.files[Math.floor(rand() * local.files.length)]!);
  await pool([...sample], o.concurrency ?? 16, async (f) => {
    const got = await store.get(packKey(id, f.path));
    if (!got || md5(got.body) !== f.md5)
      bad.push(`${f.path} reads back with a different body`);
  });
  if (bad.length)
    throw new SyncError(
      `verification of pack ${id} failed; the pointer is unchanged:\n  ${bad.slice(0, 20).join("\n  ")}`,
    );
}

/**
 * Move the pointer to pack `id`: its completion record must exist, its stored manifest must hash to the record's
 * and pass deploy.ts's manifest refusals (format, withheld counties). The write is conditional on the pointer read.
 */
export async function switchPack(
  store: ObjectStore,
  id: string,
  o: RunOptions & { expect?: PackIdentity } = {},
): Promise<PackPointer> {
  const log = o.log ?? console.log;
  const key = o.pointerKey ?? POINTER_KEY;
  if (!validPackId(id))
    throw new SyncError(`not a pack id: ${JSON.stringify(id)}`);
  const complete = await readComplete(store, id);
  if (!complete)
    throw new SyncError(
      `pack ${id} has no completion record: sync it (and let the verification pass) before switching to it`,
    );
  if (o.expect && !sameIdentity(complete, o.expect))
    throw new SyncError(
      `pack ${id} in the bucket is not the pack the pointer recorded (re-uploaded or pruned); not switching`,
    );
  const manifest = await store.get(packKey(id, "manifest.json"));
  if (!manifest || sha256(manifest.body) !== complete.manifest_sha256)
    throw new SyncError(
      `pack ${id}'s stored manifest.json does not match its completion record; not switching`,
    );
  const problems = manifestProblems(JSON.parse(dec(manifest.body)) as Manifest);
  if (problems.length)
    throw new SyncError(
      `refusing to switch to pack ${id}:\n  ${problems.join("\n  ")}`,
    );
  const current = await readPointer(store, key);
  if (
    current?.pointer.pack_id === id &&
    sameIdentity(current.pointer, complete)
  ) {
    log(`${key} already names pack ${id}`);
    return current.pointer;
  }
  const pointer: PackPointer = {
    format: POINTER_FORMAT,
    ...identityOf(complete),
    switched_at: (o.now ?? (() => new Date()))().toISOString(),
    previous: current ? identityOf(current.pointer) : null,
  };
  if (o.dryRun) {
    log(
      `would switch ${key} from ${current?.pointer.pack_id ?? "(none)"} to ${id}`,
    );
    return pointer;
  }
  const etag = await store.put(key, enc(JSON.stringify(pointer, null, 1)), {
    contentType: "application/json",
    ...(current ? { ifMatch: current.etag } : { ifNoneMatch: true }),
  });
  if (etag === null)
    throw new SyncError(
      `${key} changed while switching (another release?); nothing was changed by this run, read --status and retry`,
    );
  log(`switched ${key} from ${current?.pointer.pack_id ?? "(none)"} to ${id}`);
  return pointer;
}

/** Move the pointer back to the pack it replaced (the replaced pack becomes the new previous). */
export async function rollback(
  store: ObjectStore,
  o: RunOptions = {},
): Promise<PackPointer> {
  const key = o.pointerKey ?? POINTER_KEY;
  const current = await readPointer(store, key);
  if (!current) throw new SyncError(`there is no pointer at ${key}`);
  const prev = current.pointer.previous;
  if (!prev)
    throw new SyncError(`${key} records no previous pack to roll back to`);
  return switchPack(store, prev.pack_id, { ...o, expect: prev });
}

export interface PackListing {
  id: string;
  complete?: PackComplete;
  objects: number;
  bytes: number;
}

async function listPacks(store: ObjectStore): Promise<PackListing[]> {
  const ids = (await store.listPrefixes(PACKS_PREFIX))
    .map((p) => p.slice(PACKS_PREFIX.length).replace(/\/$/, ""))
    .filter(validPackId);
  const out: PackListing[] = [];
  for (const id of ids) {
    const objs = await store.list(packPrefix(id));
    let complete: PackComplete | undefined;
    try {
      complete = await readComplete(store, id);
    } catch {
      complete = undefined;
    }
    out.push({
      id,
      complete,
      objects: objs.length,
      bytes: objs.reduce((a, r) => a + r.size, 0),
    });
  }
  return out;
}

/**
 * Delete packs beyond the `keep` most recently verified ones. Never deletes the current or previous pack of any
 * pointer under packs/; a pack without a completion record (an upload in progress or abandoned) only with
 * `incomplete`. Returns the ids deleted (or, with dryRun, that would be).
 */
export async function prune(
  store: ObjectStore,
  keep: number,
  o: RunOptions & { incomplete?: boolean; concurrency?: number } = {},
): Promise<string[]> {
  const log = o.log ?? console.log;
  if (!Number.isInteger(keep) || keep < 0)
    throw new SyncError(
      "--prune takes the number of packs to keep (0 or more)",
    );
  const pointers = await allPointers(store);
  if (!pointers.length)
    throw new SyncError(
      "no pointer under packs/: refusing to prune without knowing the live pack",
    );
  const protect = new Set(
    pointers.flatMap((p) => [p.pack_id, p.previous?.pack_id ?? ""]),
  );
  const packs = await listPacks(store);
  const complete = packs
    .filter((p) => p.complete)
    .sort((a, b) =>
      a.complete!.verified_at < b.complete!.verified_at ? 1 : -1,
    );
  const kept = new Set(complete.slice(0, keep).map((p) => p.id));
  const doomed = packs.filter(
    (p) =>
      !protect.has(p.id) && !kept.has(p.id) && (p.complete || o.incomplete),
  );
  for (const p of packs)
    if (!p.complete && !o.incomplete && !protect.has(p.id))
      log(
        `keeping ${p.id}: no completion record (pass --prune-incomplete to delete it)`,
      );
  for (const p of doomed) {
    log(
      `${o.dryRun ? "would delete" : "deleting"} pack ${p.id} (${p.objects} objects, ${p.bytes} bytes)`,
    );
    if (o.dryRun) continue;
    // The completion record first: a half-deleted pack is never complete.
    await store.delete(completeKey(p.id));
    const keys = (await store.list(packPrefix(p.id))).map((r) => r.key);
    await pool(keys, o.concurrency ?? 16, (k) => store.delete(k));
  }
  return doomed.map((p) => p.id);
}

export async function status(
  store: ObjectStore,
  o: RunOptions = {},
): Promise<void> {
  const log = o.log ?? console.log;
  const key = o.pointerKey ?? POINTER_KEY;
  const current = await readPointer(store, key);
  log(
    current
      ? `${key}: ${current.pointer.pack_id} (built ${current.pointer.built_at}, ${current.pointer.files} files, switched ${current.pointer.switched_at}); previous ${current.pointer.previous?.pack_id ?? "(none)"}`
      : `${key}: no pointer`,
  );
  for (const p of await listPacks(store))
    log(
      `  ${p.id}: ${p.objects} objects, ${p.bytes} bytes, ${p.complete ? `verified ${p.complete.verified_at}` : "incomplete"}`,
    );
}

async function main(argv: string[]): Promise<void> {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  const valued = new Set([
    "--id",
    "--concurrency",
    "--samples",
    "--pointer",
    "--switch",
    "--prune",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (valued.has(a)) flags.set(a, argv[++i] ?? "");
    else if (a.startsWith("--")) flags.set(a, true);
    else rest.push(a);
  }
  const o: RunOptions = {
    pointerKey: (flags.get("--pointer") as string | undefined) ?? POINTER_KEY,
    dryRun: flags.has("--dry-run"),
  };
  let store: ObjectStore;
  try {
    store = s3StoreFromEnv();
  } catch (err) {
    // A dry run of a sync without credentials still checks and hashes the pack.
    if (!(o.dryRun && rest[0])) throw err;
    const dir = resolve(rest[0]);
    const problems = packProblems(dir, { maxFiles: Infinity });
    if (problems.length)
      throw new SyncError(
        `refusing to sync ${dir}:\n  ${problems.slice(0, 20).join("\n  ")}`,
      );
    const local = scanPack(dir);
    console.log(
      `${(err as Error).message}; checked and hashed the pack only: ${JSON.stringify(local.identity)}`,
    );
    return;
  }
  if (flags.has("--status")) return status(store, o);
  if (flags.has("--switch")) {
    await switchPack(store, String(flags.get("--switch")), o);
    return;
  }
  if (flags.has("--rollback")) {
    await rollback(store, o);
    return;
  }
  if (flags.has("--prune")) {
    await prune(store, Number(flags.get("--prune")), {
      ...o,
      incomplete: flags.has("--prune-incomplete"),
    });
    return;
  }
  const dir = rest[0];
  if (!dir) {
    console.error(
      "usage: sync_pack.ts <pack dir> [--id <pack id>] [--no-switch] [--dry-run] | --switch <id> | --rollback | --prune <N> | --status",
    );
    process.exit(2);
  }
  const pack = resolve(dir);
  const r = await syncPack(store, pack, {
    ...o,
    id: (flags.get("--id") as string | undefined) ?? basename(pack),
    concurrency: Number(flags.get("--concurrency") ?? 16),
    samples: Number(flags.get("--samples") ?? 64),
    switchPointer: !flags.has("--no-switch"),
  });
  console.log(JSON.stringify(r));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
