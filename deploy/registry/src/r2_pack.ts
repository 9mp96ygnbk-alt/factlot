/**
 * The object-storage backend of the registry pack: packs kept in a bucket (Cloudflare R2 through the PACK_BUCKET
 * binding), the live one named by a small pointer object.
 *
 *   packs/<pack id>/<pack path>            the pack's files, exactly as pack.ts wrote them
 *   packs/<pack id>/_sync/complete.json    written by scripts/registry/sync_pack.ts once every file is uploaded and
 *                                          verified: pack id, built_at, file count, bytes, manifest and listing hashes
 *   packs/current.json                     the pointer: the live pack's id with the same fields, and the pack it
 *                                          replaced (for rollback)
 *
 * A pack directory is never changed once a pointer has named it; a release uploads a new pack id and moves the
 * pointer (one object write, so the switch is atomic). The Worker reads the pointer at most once per
 * PACK_POINTER_TTL_SECONDS per isolate and answers from a pack only while its completion record matches the pointer
 * and the manifest hashes to the pointer's manifest_sha256 (checked when the pack is opened and again with each
 * pointer read: three small reads per isolate per TTL). Anything else fails closed (PackUnavailable): a missing,
 * malformed or inconsistent pointer, a pack without a completion record (a sync that did not finish), or a manifest
 * that is not the one the pointer names. Each request takes one opened Pack and reads every file through it, and a
 * Pack reads one pack id, so a pointer switch never mixes two packs within a request.
 *
 * Pure TypeScript with no Node or Workers imports: the Worker, the sync tool and the pack checker share it.
 */
import { PACK_FORMAT, type Manifest } from "./format.ts";
import { Pack, type PackSource } from "./store.ts";

/** The parts of an R2 object body the backend reads. */
export interface R2ObjectBodyLike {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

/** The parts of an R2 bucket binding the Worker reads. */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

/** Where the live pack's pointer lives (PACK_POINTER overrides it, e.g. a staging pointer). */
export const POINTER_KEY = "packs/current.json";
export const PACKS_PREFIX = "packs/";
/** A pack id: the name of its directory under packs/ (pack.ts output directories are named like this). */
export const PACK_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
/** The pointer and completion record format. */
export const POINTER_FORMAT = 1;
/** Seconds an isolate keeps a pointer before reading it again. */
export const POINTER_TTL_SECONDS = 30;
/** How long an isolate keeps answering from its pack when the pointer cannot be read (a bucket error, not a bad pointer). */
export const POINTER_STALE_MS = 5 * 60_000;

export function validPackId(id: string): boolean {
  return PACK_ID.test(id) && !id.includes("..") && !id.endsWith(".json");
}

export function packPrefix(id: string): string {
  if (!validPackId(id)) throw new Error(`not a pack id: ${JSON.stringify(id)}`);
  return `${PACKS_PREFIX}${id}/`;
}

export const packKey = (id: string, path: string): string =>
  `${packPrefix(id)}${path}`;

/** Files under this directory of a pack's prefix are the sync tool's, not the pack's. */
export const SYNC_DIR = "_sync/";
export const completeKey = (id: string): string =>
  packKey(id, `${SYNC_DIR}complete.json`);

/** What a pointer and a completion record both state about a pack. */
export interface PackIdentity {
  pack_id: string;
  built_at: string;
  /** Pack files (the _sync/ records not counted). */
  files: number;
  bytes: number;
  /** sha256 (hex) of manifest.json as stored. */
  manifest_sha256: string;
  /** sha256 (hex) of the sorted "<path> <md5> <size>\n" lines of every pack file. */
  listing_sha256: string;
}

export interface PackComplete extends PackIdentity {
  format: number;
  verified_at: string;
}

export interface PackPointer extends PackIdentity {
  format: number;
  switched_at: string;
  /** The pack this pointer replaced, for --rollback (its own `previous` is not kept). */
  previous: PackIdentity | null;
}

/** The registry cannot answer from the object-storage backend; the message says why (never a credential). */
export class PackUnavailable extends Error {
  override name = "PackUnavailable";
}

const HEX64 = /^[0-9a-f]{64}$/;

function identityProblem(v: unknown, what: string): string | undefined {
  if (typeof v !== "object" || v === null) return `${what} is not an object`;
  const o = v as Record<string, unknown>;
  if (typeof o.pack_id !== "string" || !validPackId(o.pack_id))
    return `${what} has no valid pack_id`;
  if (typeof o.built_at !== "string" || !o.built_at)
    return `${what} has no built_at`;
  for (const k of ["files", "bytes"])
    if (!Number.isSafeInteger(o[k]) || (o[k] as number) < 0)
      return `${what} has no valid ${k}`;
  for (const k of ["manifest_sha256", "listing_sha256"])
    if (typeof o[k] !== "string" || !HEX64.test(o[k]))
      return `${what} has no valid ${k}`;
  return undefined;
}

export function identityOf(v: PackIdentity): PackIdentity {
  return {
    pack_id: v.pack_id,
    built_at: v.built_at,
    files: v.files,
    bytes: v.bytes,
    manifest_sha256: v.manifest_sha256,
    listing_sha256: v.listing_sha256,
  };
}

export function sameIdentity(a: PackIdentity, b: PackIdentity): boolean {
  return JSON.stringify(identityOf(a)) === JSON.stringify(identityOf(b));
}

/** A pointer object's text, checked; throws PackUnavailable. */
export function parsePointer(text: string, key = POINTER_KEY): PackPointer {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new PackUnavailable(`the pack pointer ${key} is not JSON`);
  }
  const bad = identityProblem(v, `the pack pointer ${key}`);
  if (bad) throw new PackUnavailable(bad);
  const p = v as PackPointer;
  if (p.format !== POINTER_FORMAT)
    throw new PackUnavailable(
      `the pack pointer ${key} has format ${String(p.format)}, this Worker reads ${POINTER_FORMAT}`,
    );
  if (p.previous != null) {
    const prev = identityProblem(p.previous, `the pack pointer's previous`);
    if (prev) throw new PackUnavailable(prev);
  }
  return { ...p, previous: p.previous ?? null };
}

/** A completion record's text, checked; throws PackUnavailable. */
export function parseComplete(text: string, id: string): PackComplete {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new PackUnavailable(
      `the completion record of pack ${id} is not JSON`,
    );
  }
  const bad = identityProblem(v, `the completion record of pack ${id}`);
  if (bad) throw new PackUnavailable(bad);
  return v as PackComplete;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Reads an object's text by key; undefined when there is no such object. Throws on a storage error. */
export type GetText = (key: string) => Promise<string | undefined>;

export function bucketText(bucket: R2BucketLike): GetText {
  return async (key) => {
    const o = await bucket.get(key);
    return o ? o.text() : undefined;
  };
}

/** The files of one pack of the bucket. */
export function objectSource(get: GetText, id: string): PackSource {
  const prefix = packPrefix(id);
  return { read: (path) => get(`${prefix}${path}`) };
}

export interface OpenedPack {
  pointer: PackPointer;
  pointerText: string;
  pack: Pack;
}

/**
 * Checks the pack a pointer names: its completion record must match the pointer, and its manifest must hash to the
 * pointer's manifest_sha256. Reads two objects; returns the manifest's text.
 */
export async function checkPack(
  get: GetText,
  pointer: PackIdentity,
): Promise<string> {
  const id = pointer.pack_id;
  const completeText = await get(completeKey(id));
  if (completeText === undefined)
    throw new PackUnavailable(
      `pack ${id} has no completion record: its upload did not finish or was not verified`,
    );
  const complete = parseComplete(completeText, id);
  if (!sameIdentity(complete, pointer))
    throw new PackUnavailable(
      `pack ${id}'s completion record does not match the pointer (a different upload of the same id?)`,
    );
  const manifestText = await get(packKey(id, "manifest.json"));
  if (manifestText === undefined)
    throw new PackUnavailable(`pack ${id} has no manifest.json`);
  if ((await sha256Hex(manifestText)) !== pointer.manifest_sha256)
    throw new PackUnavailable(
      `pack ${id}'s manifest.json is not the one the pointer names`,
    );
  return manifestText;
}

/**
 * Checks a pack named by `pointer` (checkPack) and opens it: the manifest must also name the same built_at and be of
 * the format this code reads. The manifest is handed to the Pack, so it is not read again.
 */
export async function openPack(
  get: GetText,
  pointer: PackIdentity,
): Promise<Pack> {
  const id = pointer.pack_id;
  const manifestText = await checkPack(get, pointer);
  let m: Manifest;
  try {
    m = JSON.parse(manifestText) as Manifest;
  } catch {
    throw new PackUnavailable(`pack ${id}'s manifest.json is not JSON`);
  }
  if (m.format !== PACK_FORMAT)
    throw new PackUnavailable(
      `pack ${id} has format ${String(m.format)}, this Worker reads ${PACK_FORMAT}`,
    );
  if (m.built_at !== pointer.built_at)
    throw new PackUnavailable(
      `pack ${id}'s manifest was built at ${m.built_at}, the pointer says ${pointer.built_at}`,
    );
  return new Pack(objectSource(get, id), new Map([["manifest.json", m]]));
}

/** Reads the pointer at `key` and opens the pack it names (three reads). */
export async function openPointedPack(
  get: GetText,
  key = POINTER_KEY,
): Promise<OpenedPack> {
  const pointerText = await get(key);
  if (pointerText === undefined)
    throw new PackUnavailable(
      `there is no pack pointer at ${key}: sync a pack (scripts/registry/sync_pack.ts) before serving from the bucket`,
    );
  const pointer = parsePointer(pointerText, key);
  return { pointer, pointerText, pack: await openPack(get, pointer) };
}

export interface ResolverOptions {
  pointerKey?: string;
  ttlMs?: number;
  staleMs?: number;
  now?: () => number;
  /** Called when the isolate keeps a pack because the pointer could not be read (no secrets in the message). */
  warn?: (message: string) => void;
}

/**
 * The pack an isolate answers from, following the pointer. One instance per isolate and bucket; `pack()` is called
 * once per request and the request keeps what it returns.
 */
export class PackResolver {
  private readonly get: GetText;
  private readonly key: string;
  private readonly ttl: number;
  private readonly stale: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private current:
    { opened: OpenedPack; checkedAt: number; validatedAt: number } | undefined;
  private failure: { error: Error; at: number } | undefined;
  private inflight: Promise<Pack> | undefined;
  /** Objects read for the pointer and pack checks (each one R2 Class B operation and one subrequest). */
  reads = 0;

  constructor(get: GetText, o: ResolverOptions = {}) {
    this.get = async (k) => {
      this.reads += 1;
      return get(k);
    };
    this.key = o.pointerKey ?? POINTER_KEY;
    this.ttl = o.ttlMs ?? POINTER_TTL_SECONDS * 1000;
    this.stale = o.staleMs ?? POINTER_STALE_MS;
    this.now = o.now ?? Date.now;
    this.warn = o.warn ?? (() => {});
  }

  /** The id of the pack last opened (for /health and tests). */
  get packId(): string | undefined {
    return this.current?.opened.pointer.pack_id;
  }

  get pointer(): PackPointer | undefined {
    return this.current?.opened.pointer;
  }

  async pack(): Promise<Pack> {
    const t = this.now();
    if (this.current && t - this.current.checkedAt < this.ttl)
      return this.current.opened.pack;
    // A bad pointer is not read again on every request, but no longer than the pointer would be kept.
    if (this.failure && t - this.failure.at < Math.min(this.ttl, 5000))
      throw this.failure.error;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(): Promise<Pack> {
    const t = this.now();
    let text: string | undefined;
    try {
      text = await this.get(this.key);
    } catch (err) {
      return this.keepOrFail(t, err);
    }
    try {
      // The same pointer: the pack is checked again (completion record, manifest hash) and kept with its cache.
      if (text !== undefined && text === this.current?.opened.pointerText) {
        const current = this.current;
        await checkPack(this.get, current.opened.pointer);
        current.checkedAt = t;
        current.validatedAt = t;
        return current.opened.pack;
      }
      if (text === undefined)
        throw new PackUnavailable(
          `there is no pack pointer at ${this.key}: sync a pack (scripts/registry/sync_pack.ts) before serving from the bucket`,
        );
      const pointer = parsePointer(text, this.key);
      const pack = await openPack(this.get, pointer);
      this.current = {
        opened: { pointer, pointerText: text, pack },
        checkedAt: t,
        validatedAt: t,
      };
      this.failure = undefined;
      return pack;
    } catch (err) {
      if (err instanceof PackUnavailable) {
        // Fail closed: never keep answering from a pack the pointer no longer names correctly.
        this.current = undefined;
        this.failure = { error: err, at: t };
        throw err;
      }
      return this.keepOrFail(t, err);
    }
  }

  /** A storage error (not a bad pointer): keep the open pack for a while, else fail. */
  private keepOrFail(t: number, err: unknown): Pack {
    const why = err instanceof Error ? err.name : typeof err;
    if (this.current && t - this.current.validatedAt < this.stale) {
      this.warn(
        `pack pointer ${this.key} could not be read (${why}); still answering from pack ${this.current.opened.pointer.pack_id}`,
      );
      this.current.checkedAt = t;
      return this.current.opened.pack;
    }
    this.current = undefined;
    throw new PackUnavailable(
      `the pack pointer ${this.key} could not be read (${why})`,
    );
  }
}
