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

  if (env.FACTLOT_ADMIN_KEY) opts.adminKey = env.FACTLOT_ADMIN_KEY;

  const limit = env.FACTLOT_RATE_LIMIT_PER_MINUTE?.trim();
  if (limit) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 0)
      throw new Error(
        `FACTLOT_RATE_LIMIT_PER_MINUTE: expected a non-negative integer (got "${limit}")`,
      );
    opts.rateLimitPerMinute = n;
  }

  if (env.FACTLOT_USAGE_LOG) opts.usageLog = env.FACTLOT_USAGE_LOG;

  const log = env.FACTLOT_LOG?.trim().toLowerCase();
  if (log) {
    if (log !== "json" && log !== "none" && log !== "text")
      throw new Error(`FACTLOT_LOG: expected "json" or "none" (got "${log}")`);
    opts.log = log === "json" ? "json" : "none";
  }

  if (env.FACTLOT_PUBLIC_URL) opts.publicUrl = env.FACTLOT_PUBLIC_URL;
  return opts;
}
