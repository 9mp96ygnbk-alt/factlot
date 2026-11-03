/**
 * API key handling for the hosted connector.
 *
 * Keys come from `FACTLOT_API_KEY` (one shared key, name "default"), `FACTLOT_API_KEYS`
 * (`key1:tenant-a,key2:tenant-b`), or `FACTLOT_API_KEYS_FILE` (a JSON array of
 * `{key, name, rate_limit_per_minute?}`). Every request resolves to a key *name*; names are
 * what rate limits, metering, and logs use. Raw keys are never logged, only a short prefix.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export interface ApiKey {
  /** The bearer token clients send. */
  key: string;
  /** Tenant or engagement name used for limits, metering, and logs. Need not be unique. */
  name: string;
  /** Requests per minute for this key; overrides the server default. 0 = unlimited. */
  rateLimitPerMinute?: number;
}

/** Constant-time string comparison that does not leak length or matching prefix. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** A short, loggable prefix of a key: at most 6 characters, never more than a quarter of it. */
export function keyPrefix(key: string): string {
  return `${key.slice(0, Math.min(6, Math.floor(key.length / 4)))}…`;
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1];
}

/**
 * Find the key matching `token`. Every configured key is compared, in constant time, whether
 * or not an earlier one matched, so the response time does not depend on which key was sent.
 */
export function resolveApiKey(
  token: string | undefined,
  keys: readonly ApiKey[],
): ApiKey | undefined {
  if (token === undefined) return undefined;
  let found: ApiKey | undefined;
  for (const k of keys) {
    const match = safeEqual(token, k.key);
    if (match && found === undefined) found = k;
  }
  return found;
}

function rejectDuplicates(keys: ApiKey[], source: string): ApiKey[] {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k.key))
      throw new Error(`${source}: duplicate key ${keyPrefix(k.key)}`);
    seen.add(k.key);
  }
  return keys;
}

/** Parse `FACTLOT_API_KEYS="key1:tenant-a,key2:tenant-b"`. */
export function parseApiKeysEnv(
  value: string,
  source = "FACTLOT_API_KEYS",
): ApiKey[] {
  const keys: ApiKey[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const colon = entry.indexOf(":");
    const key = colon < 0 ? entry : entry.slice(0, colon);
    const name = colon < 0 ? "" : entry.slice(colon + 1).trim();
    if (!key || !name)
      throw new Error(
        `${source}: each entry must be "key:name" (got "${keyPrefix(entry)}")`,
      );
    keys.push({ key, name });
  }
  return rejectDuplicates(keys, source);
}

/** Parse a keys file: `[{"key": "...", "name": "tenant-a", "rate_limit_per_minute": 600}]`. */
export function parseApiKeysJson(
  text: string,
  source = "FACTLOT_API_KEYS_FILE",
): ApiKey[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${source}: not valid JSON`);
  }
  if (!Array.isArray(data))
    throw new Error(
      `${source}: expected a JSON array of {key, name, rate_limit_per_minute?}`,
    );
  const keys = data.map((item: unknown, i: number): ApiKey => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new Error(`${source}[${i}]: expected an object`);
    const { key, name, rate_limit_per_minute } = item as Record<
      string,
      unknown
    >;
    if (typeof key !== "string" || !key)
      throw new Error(`${source}[${i}]: "key" must be a non-empty string`);
    if (typeof name !== "string" || !name)
      throw new Error(`${source}[${i}]: "name" must be a non-empty string`);
    const out: ApiKey = { key, name };
    if (rate_limit_per_minute !== undefined) {
      if (
        typeof rate_limit_per_minute !== "number" ||
        !Number.isInteger(rate_limit_per_minute) ||
        rate_limit_per_minute < 0
      )
        throw new Error(
          `${source}[${i}]: "rate_limit_per_minute" must be a non-negative integer`,
        );
      out.rateLimitPerMinute = rate_limit_per_minute;
    }
    return out;
  });
  return rejectDuplicates(keys, source);
}

/** Merge keys from several sources, rejecting a key that appears twice. */
export function mergeApiKeys(...sources: ApiKey[][]): ApiKey[] {
  return rejectDuplicates(sources.flat(), "API keys");
}
