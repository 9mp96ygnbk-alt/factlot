/**
 * Reads a pack through the Worker's static-assets binding (or any fetcher with the same shape, such as the
 * file-backed one the tests and the pack checker use). Parsed files are kept in a small per-isolate cache.
 */
import {
  decodeEntry,
  shardOf,
  urnPrefix,
  type EncodedShard,
  type GetEntry,
  type Manifest,
} from "./format.ts";

export interface AssetFetcher {
  fetch(request: Request | string): Promise<Response>;
}

const CACHE_FILES = 48;

export class Pack {
  private manifestPromise: Promise<Manifest> | undefined;
  private readonly cache = new Map<string, unknown>();
  /** Files read from the assets binding since the pack was opened (for tests and timing). */
  reads = 0;

  private readonly assets: AssetFetcher;

  constructor(assets: AssetFetcher) {
    this.assets = assets;
  }

  async file<T>(path: string): Promise<T | undefined> {
    if (this.cache.has(path)) {
      const v = this.cache.get(path);
      this.cache.delete(path);
      this.cache.set(path, v);
      return v as T;
    }
    this.reads += 1;
    const res = await this.assets.fetch(`https://registry.internal/${path}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`pack file ${path}: HTTP ${res.status}`);
    const v = JSON.parse(await res.text()) as T;
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
