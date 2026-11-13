/**
 * Object storage for the registry pack, as the sync tool and the pack checker see it: an S3-compatible client for
 * Cloudflare R2 (credentials from the environment only), and an adapter over an R2 Workers binding (or the
 * in-memory one the tests use).
 *
 * The S3 client signs requests itself (AWS Signature Version 4) with Node's crypto and fetch, so it needs no
 * dependency. It reads, and never prints or logs:
 *
 *   R2_ACCOUNT_ID         the Cloudflare account id (the endpoint is https://<id>.r2.cloudflarestorage.com)
 *   R2_ENDPOINT           instead of R2_ACCOUNT_ID: the full S3 endpoint (e.g. a jurisdiction endpoint)
 *   R2_ACCESS_KEY_ID      an R2 API token's access key id (Object Read & Write on the pack bucket only)
 *   R2_SECRET_ACCESS_KEY  that token's secret access key
 *   R2_BUCKET             the bucket name
 *
 * Errors name the operation, the object key and the S3 error code only (an S3 error body can echo the access key
 * id, so it is never passed on).
 */
import { createHash, createHmac } from "node:crypto";

import type { R2BucketWritable } from "../../deploy/registry/src/memory_bucket.ts";

export interface StoredObject {
  key: string;
  size: number;
  /** MD5 of the body, hex (R2's etag for a single-part upload). */
  etag: string;
}

export interface ObjectStore {
  /** Every object under `prefix`, all pages. */
  list(prefix: string): Promise<StoredObject[]>;
  /** The "directories" directly under `prefix` (delimiter "/"), each ending in "/". */
  listPrefixes(prefix: string): Promise<string[]>;
  get(key: string): Promise<{ body: Uint8Array; etag: string } | undefined>;
  /** The new etag, or null when a condition failed (ifMatch: the current etag; ifNoneMatch: no object yet). */
  put(
    key: string,
    body: Uint8Array,
    o?: { contentType?: string; ifMatch?: string; ifNoneMatch?: boolean },
  ): Promise<string | null>;
  delete(key: string): Promise<void>;
}

const stripQuotes = (e: string): string => e.replace(/^(W\/)?"|"$/g, "");

/** An ObjectStore over an R2 Workers binding (or MemoryBucket). */
export function bindingStore(bucket: R2BucketWritable): ObjectStore {
  async function* pages(prefix: string, delimiter?: string) {
    let cursor: string | undefined;
    do {
      const r = await bucket.list({
        prefix,
        cursor,
        limit: 1000,
        ...(delimiter ? { delimiter } : {}),
      });
      yield r;
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
  }
  return {
    async list(prefix) {
      const out: StoredObject[] = [];
      for await (const r of pages(prefix))
        for (const o of r.objects)
          out.push({ key: o.key, size: o.size, etag: stripQuotes(o.etag) });
      return out;
    },
    async listPrefixes(prefix) {
      const out: string[] = [];
      for await (const r of pages(prefix, "/"))
        out.push(...r.delimitedPrefixes);
      return out;
    },
    async get(key) {
      const o = await bucket.get(key);
      if (!o) return undefined;
      const body = o.arrayBuffer
        ? new Uint8Array(await o.arrayBuffer())
        : new TextEncoder().encode(await o.text());
      return { body, etag: stripQuotes(o.etag) };
    },
    async put(key, body, o = {}) {
      const r = await bucket.put(key, body, {
        ...(o.contentType
          ? { httpMetadata: { contentType: o.contentType } }
          : {}),
        ...(o.ifMatch !== undefined
          ? { onlyIf: { etagMatches: o.ifMatch } }
          : o.ifNoneMatch
            ? { onlyIf: { etagDoesNotMatch: "*" } }
            : {}),
      });
      return r ? stripQuotes(r.etag) : null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

// --- AWS Signature Version 4 ---------------------------------------------------------------------

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
export function uriEncode(s: string, keepSlash = false): string {
  const e = encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? e.replaceAll("%2F", "/") : e;
}

export interface SignInput {
  method: string;
  url: URL;
  /** Lower-case names; every one is signed. Must include host and x-amz-date. */
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

/** The Authorization header value for a request (the URL's path must already be URI-encoded). */
export function signV4(i: SignInput): string {
  const amzDate = i.headers["x-amz-date"]!;
  const date = amzDate.slice(0, 8);
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const names = Object.keys(i.headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((k) => `${k}:${i.headers[k]!.trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signed = names.join(";");
  const canonical = [
    i.method,
    i.url.pathname || "/",
    query,
    canonicalHeaders,
    signed,
    i.payloadHash,
  ].join("\n");
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join(
    "\n",
  );
  const kDate = hmac(`AWS4${i.secretAccessKey}`, date);
  const kRegion = hmac(kDate, i.region);
  const kService = hmac(kRegion, i.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
}

// --- S3 client for R2 -----------------------------------------------------------------------------

export const S3_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

const xmlText = (s: string): string =>
  s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replaceAll("&amp;", "&");

const tag = (xml: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? xmlText(m[1]!) : undefined;
};

/** An S3-compatible ObjectStore for R2, configured from the environment (see the top of this file). */
export function s3StoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): ObjectStore {
  const missing = [
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ].filter((k) => !env[k]);
  if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID)
    missing.push("R2_ACCOUNT_ID (or R2_ENDPOINT)");
  if (missing.length)
    throw new Error(
      `object storage is not configured: set ${missing.join(", ")} in the environment`,
    );
  const endpoint = new URL(
    env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  );
  const bucket = env.R2_BUCKET!;
  const accessKeyId = env.R2_ACCESS_KEY_ID!;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY!;

  async function request(
    method: string,
    key: string | undefined,
    query: Record<string, string>,
    body?: Uint8Array,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    const url = new URL(endpoint);
    url.pathname = `/${uriEncode(bucket)}${key === undefined ? "" : `/${uriEncode(key, true)}`}`;
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
    const payloadHash = sha256(body ?? "");
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...extra,
    };
    const authorization = signV4({
      method,
      url,
      headers,
      payloadHash,
      accessKeyId,
      secretAccessKey,
      region: "auto",
      service: "s3",
    });
    const { host: _host, ...sent } = headers;
    void _host;
    const res = await fetchImpl(url, {
      method,
      headers: { ...sent, authorization },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    return res;
  }

  async function failure(
    op: string,
    key: string,
    res: Response,
  ): Promise<Error> {
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]{1,64})<\/Code>/.exec(text)?.[1] ?? "";
    return new Error(
      `object storage ${op} ${key}: HTTP ${res.status}${code ? ` ${code}` : ""}`,
    );
  }

  async function* listPages(prefix: string, delimiter?: string) {
    let token: string | undefined;
    do {
      const res = await request("GET", undefined, {
        "list-type": "2",
        prefix,
        "max-keys": "1000",
        ...(delimiter ? { delimiter } : {}),
        ...(token ? { "continuation-token": token } : {}),
      });
      if (!res.ok) throw await failure("list", prefix, res);
      const xml = await res.text();
      yield xml;
      token =
        tag(xml, "IsTruncated") === "true"
          ? tag(xml, "NextContinuationToken")
          : undefined;
    } while (token);
  }

  return {
    async list(prefix) {
      const out: StoredObject[] = [];
      for await (const xml of listPages(prefix))
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const c = m[1]!;
          out.push({
            key: tag(c, "Key")!,
            size: Number(tag(c, "Size")),
            etag: stripQuotes(tag(c, "ETag") ?? ""),
          });
        }
      return out;
    },
    async listPrefixes(prefix) {
      const out: string[] = [];
      for await (const xml of listPages(prefix, "/"))
        for (const m of xml.matchAll(
          /<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g,
        ))
          out.push(tag(m[1]!, "Prefix")!);
      return out;
    },
    async get(key) {
      const res = await request("GET", key, {});
      if (res.status === 404) {
        await res.body?.cancel();
        return undefined;
      }
      if (!res.ok) throw await failure("get", key, res);
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        etag: stripQuotes(res.headers.get("etag") ?? ""),
      };
    },
    async put(key, body, o = {}) {
      const extra: Record<string, string> = {
        "content-type": o.contentType ?? "application/octet-stream",
      };
      if (o.ifMatch !== undefined) extra["if-match"] = `"${o.ifMatch}"`;
      else if (o.ifNoneMatch) extra["if-none-match"] = "*";
      const res = await request("PUT", key, {}, body, extra);
      if (res.status === 412) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw await failure("put", key, res);
      await res.body?.cancel();
      return stripQuotes(res.headers.get("etag") ?? "");
    },
    async delete(key) {
      const res = await request("DELETE", key, {});
      if (!res.ok && res.status !== 404)
        throw await failure("delete", key, res);
      await res.body?.cancel();
    },
  };
}
