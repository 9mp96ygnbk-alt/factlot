/**
 * Reads a pack from a storage backend: the Worker's static-assets binding (or any fetcher with the same shape, such
 * as the file-backed one the tests and the pack checker use), or one pack of an object-storage bucket (r2_pack.ts).
 * Parsed files are kept in a small per-isolate cache. One Pack reads one pack only, so a request that holds a Pack
 * never mixes the files of two packs.
 */
import {
  decodeEntry,
  shardOf,
  urnPrefix,
  type EncodedShard,
  type GetEntry,
  type Manifest,
} from "./format.ts";
import { hostedWithheldCounties } from "../../../packages/tools/src/registry.ts";

/** Counties the hosted registry never answers (see hostedWithheldCounties). */
const WITHHELD = hostedWithheldCounties();

export interface AssetFetcher {
  fetch(request: Request | string): Promise<Response>;
}

/** Where a pack's files come from: the text of a pack file by its path, or undefined when the pack has no such file. */
export interface PackSource {
  read(path: string): Promise<string | undefined>;
}

/** The static-assets backend: pack files served to the Worker by its ASSETS binding. */
export function assetsSource(assets: AssetFetcher): PackSource {
  return {
    async read(path: string): Promise<string | undefined> {
      const res = await assets.fetch(`https://registry.internal/${path}`);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`pack file ${path}: HTTP ${res.status}`);
      return res.text();
    },
  };
}

const CACHE_FILES = 48;

export class Pack {
  private manifestPromise: Promise<Manifest> | undefined;
  private readonly cache = new Map<string, unknown>();
  private readonly pinned: Map<string, unknown>;
  /** Files read from the backend since the pack was opened (for tests and timing). */
  reads = 0;

  private readonly source: PackSource;

  /**
   * `source`: the backend, or an assets fetcher (the static-assets backend). `pinned`: files kept from an earlier
   * reader of the same pack (the checker uses it to time a warm isolate; the object-storage backend passes the
   * manifest it has already read and checked).
   */
  constructor(
    source: AssetFetcher | PackSource,
    pinned = new Map<string, unknown>(),
  ) {
    this.source = "read" in source ? source : assetsSource(source);
    this.pinned = pinned;
  }

  /** A pack file, parsed; `pin` keeps it for the life of the isolate (a small file read on most requests). */
  async file<T>(path: string, pin = false): Promise<T | undefined> {
    if (this.pinned.has(path)) return this.pinned.get(path) as T;
    if (this.cache.has(path)) {
      const v = this.cache.get(path);
      this.cache.delete(path);
      this.cache.set(path, v);
      return v as T;
    }
    this.reads += 1;
    const text = await this.source.read(path);
    if (text === undefined) return undefined;
    const v = JSON.parse(text) as T;
    if (pin) {
      this.pinned.set(path, v);
      return v;
    }
    this.cache.set(path, v);
    if (this.cache.size > CACHE_FILES)
      this.cache.delete(this.cache.keys().next().value as string);
    return v;
  }

  manifest(): Promise<Manifest> {
    this.manifestPromise ??= this.file<Manifest>("manifest.json").then((m) => {
      if (!m) throw new Error("the registry pack has no manifest.json");
      return m;
    });
    return this.manifestPromise;
  }

  /** The stored answers for a subject URN, or undefined when the pack holds no such subject. */
  async entry(urn: string): Promise<GetEntry | undefined> {
    const m = await this.manifest();
    const prefix = urnPrefix(urn);
    if (!Object.hasOwn(m.prefixes, prefix)) return undefined;
    // A withheld county is never answered, even from a pack built without excluding it.
    const county = /^fl:(?:parcel|building):us-([0-9]{5})$/.exec(prefix)?.[1];
    if (
      county &&
      (Object.hasOwn(m.withheld ?? {}, county) ||
        Object.hasOwn(WITHHELD, county))
    )
      return undefined;
    const db = m.prefixes[prefix]!;
    const shard = await this.file<EncodedShard>(
      `g/${db}/${shardOf(urn, m.dbs[db]!.shards)}.json`,
    );
    return shard
      ? (decodeEntry(shard, urn) as GetEntry | undefined)
      : undefined;
  }

  /** registry_resolve_external's crosswalk lookup. */
  async crosswalk(system: string, externalId: string): Promise<string | null> {
    const m = await this.manifest();
    const key = JSON.stringify([system, externalId]);
    const shard = await this.file<Record<string, string>>(
      `x/${shardOf(key, m.crosswalk_shards)}.json`,
    );
    return shard && Object.hasOwn(shard, key) ? shard[key]! : null;
  }
}
