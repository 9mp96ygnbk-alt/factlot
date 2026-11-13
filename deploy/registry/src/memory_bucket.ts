/**
 * An in-memory stand-in for an R2 bucket binding (Node only: the tests and scripts/registry/check_pack.ts use it;
 * the Worker never imports it). It implements the subset of the R2 Workers API the registry Worker and the sync
 * tool use, with R2's etag (the MD5 of the body, hex, for a single-part upload) and conditional puts, and counts
 * operations by R2 operation class. Hooks let tests slow down or fail single operations.
 */
import { createHash } from "node:crypto";

import type { R2BucketLike, R2ObjectBodyLike } from "./r2_pack.ts";

export interface MemoryObject {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  body: Uint8Array;
}

export interface ListResult {
  objects: { key: string; size: number; etag: string; uploaded: Date }[];
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
}

export interface PutOptions {
  onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
  httpMetadata?: { contentType?: string };
}

/** The R2 binding methods the sync tool needs (a real binding has them all). */
export interface R2BucketWritable extends R2BucketLike {
  put(
    key: string,
    value: Uint8Array | string,
    options?: PutOptions,
  ): Promise<{ key: string; etag: string; size: number } | null>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
    delimiter?: string;
  }): Promise<ListResult>;
  delete(keys: string | string[]): Promise<void>;
}

export class MemoryBucket implements R2BucketWritable {
  readonly objects = new Map<string, MemoryObject>();
  /** Operations by R2 class: A (put, list, delete is free but counted here), B (get). */
  ops = { get: 0, put: 0, list: 0, delete: 0 };
  /** Keys read by get, in order. */
  readonly gets: string[] = [];
  /** Awaited before a get answers (tests hold a read open with it). */
  beforeGet?: (key: string) => Promise<void> | void;
  /** Throw from a put to simulate a failed upload. */
  beforePut?: (key: string) => Promise<void> | void;
  /** Throw from a get to simulate a storage error. */
  failGet?: (key: string) => boolean;

  async get(key: string): Promise<R2ObjectBodyLike | null> {
    this.ops.get += 1;
    this.gets.push(key);
    await this.beforeGet?.(key);
    if (this.failGet?.(key)) throw new Error("simulated storage error");
    const o = this.objects.get(key);
    if (!o) return null;
    const body = o.body;
    return {
      key: o.key,
      size: o.size,
      etag: o.etag,
      text: async () => new TextDecoder().decode(body),
      arrayBuffer: async () => body.slice().buffer,
    };
  }

  async put(
    key: string,
    value: Uint8Array | string,
    options: PutOptions = {},
  ): Promise<{ key: string; etag: string; size: number } | null> {
    this.ops.put += 1;
    await this.beforePut?.(key);
    const existing = this.objects.get(key);
    const c = options.onlyIf;
    if (c?.etagMatches !== undefined && existing?.etag !== c.etagMatches)
      return null;
    if (
      c?.etagDoesNotMatch !== undefined &&
      existing &&
      (c.etagDoesNotMatch === "*" || existing.etag === c.etagDoesNotMatch)
    )
      return null;
    const body =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(value);
    const o: MemoryObject = {
      key,
      size: body.length,
      etag: createHash("md5").update(body).digest("hex"),
      uploaded: new Date(),
      body,
    };
    this.objects.set(key, o);
    return { key, etag: o.etag, size: o.size };
  }

  async list(
    options: {
      prefix?: string;
      cursor?: string;
      limit?: number;
      delimiter?: string;
    } = {},
  ): Promise<ListResult> {
    this.ops.list += 1;
    const prefix = options.prefix ?? "";
    const limit = Math.min(options.limit ?? 1000, 1000);
    const keys = [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();
    const objects: ListResult["objects"] = [];
    const prefixes = new Set<string>();
    let i = options.cursor ? Number(options.cursor) : 0;
    for (; i < keys.length && objects.length + prefixes.size < limit; i++) {
      const k = keys[i]!;
      if (options.delimiter) {
        const at = k.indexOf(options.delimiter, prefix.length);
        if (at >= 0) {
          prefixes.add(k.slice(0, at + options.delimiter.length));
          continue;
        }
      }
      const o = this.objects.get(k)!;
      objects.push({
        key: k,
        size: o.size,
        etag: o.etag,
        uploaded: o.uploaded,
      });
    }
    const truncated = i < keys.length;
    return {
      objects,
      delimitedPrefixes: [...prefixes],
      truncated,
      ...(truncated ? { cursor: String(i) } : {}),
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      this.ops.delete += 1;
      this.objects.delete(k);
    }
  }

  /** Overwrite an object's body without the sync tool (tests: corruption, partial uploads). */
  poke(key: string, body: string | Uint8Array): void {
    const b = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.objects.set(key, {
      key,
      size: b.length,
      etag: createHash("md5").update(b).digest("hex"),
      uploaded: new Date(),
      body: b,
    });
  }
}
