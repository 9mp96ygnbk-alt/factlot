/**
 * Server options from environment variables (see bin.ts and the README for the list).
 * Throws a plain Error with a readable message on a malformed value, so the process can
 * refuse to start rather than run with a key file it could not parse.
 */
import { readFileSync } from "node:fs";

import {
  mergeApiKeys,
  parseApiKeysEnv,
  parseApiKeysJson,
  safeEqual,
  type ApiKey,
} from "./auth.ts";
import type { FactLotServerOptions } from "./index.ts";

export type Env = Record<string, string | undefined>;

export function optionsFromEnv(
  env: Env = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): FactLotServerOptions {
  const opts: FactLotServerOptions = {};
  const sources: ApiKey[][] = [];
  if (env.FACTLOT_API_KEY)
    sources.push([{ key: env.FACTLOT_API_KEY, name: "default" }]);
  if (env.FACTLOT_API_KEYS) sources.push(parseApiKeysEnv(env.FACTLOT_API_KEYS));
  if (env.FACTLOT_API_KEYS_FILE) {
    let text: string;
    try {
      text = readFile(env.FACTLOT_API_KEYS_FILE);
    } catch (err) {
      throw new Error(
        `FACTLOT_API_KEYS_FILE: cannot read ${env.FACTLOT_API_KEYS_FILE}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
    sources.push(parseApiKeysJson(text));
  }
  const keys = mergeApiKeys(...sources);
  if (keys.length > 0) opts.apiKeys = keys;

  if (env.FACTLOT_ADMIN_KEY) {
    if (keys.some((k) => safeEqual(k.key, env.FACTLOT_ADMIN_KEY as string)))
      throw new Error(
        "FACTLOT_ADMIN_KEY: must differ from every API key (an API key holder would read all tenants' usage)",
      );
    opts.adminKey = env.FACTLOT_ADMIN_KEY;
  }

  const count = (name: string): number | undefined => {
    const raw = env[name]?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0)
      throw new Error(
        `${name}: expected a non-negative integer (got "${raw.slice(0, 20)}")`,
      );
    return n;
  };
  const limit = count("FACTLOT_RATE_LIMIT_PER_MINUTE");
  if (limit !== undefined) opts.rateLimitPerMinute = limit;
  const perIp = count("FACTLOT_RATE_LIMIT_PER_IP_PER_MINUTE");
  if (perIp !== undefined) opts.rateLimitPerIpPerMinute = perIp;
  const authFailures = count("FACTLOT_AUTH_FAILURES_PER_IP_PER_MINUTE");
  if (authFailures !== undefined)
    opts.authFailuresPerIpPerMinute = authFailures;

  const trust = env.FACTLOT_TRUST_PROXY?.trim().toLowerCase();
  if (trust) {
    if (!["1", "true", "yes", "0", "false", "no"].includes(trust))
      throw new Error(
        `FACTLOT_TRUST_PROXY: expected 1/true or 0/false (got "${trust.slice(0, 20)}")`,
      );
    opts.trustProxy = ["1", "true", "yes"].includes(trust);
  }

  if (env.FACTLOT_USAGE_LOG) opts.usageLog = env.FACTLOT_USAGE_LOG;

  const log = env.FACTLOT_LOG?.trim().toLowerCase();
  if (log) {
    if (log !== "json" && log !== "none" && log !== "text")
      throw new Error(`FACTLOT_LOG: expected "json" or "none" (got "${log}")`);
    opts.log = log === "json" ? "json" : "none";
  }

  if (env.FACTLOT_PUBLIC_URL) {
    let u: URL;
    try {
      u = new URL(env.FACTLOT_PUBLIC_URL);
    } catch {
      throw new Error("FACTLOT_PUBLIC_URL: not a valid URL");
    }
    if (u.protocol !== "https:" && u.protocol !== "http:")
      throw new Error("FACTLOT_PUBLIC_URL: expected an http(s) URL");
    opts.publicUrl = env.FACTLOT_PUBLIC_URL;
  }
  return opts;
}
