import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { optionsFromEnv } from "./config.ts";

test("nothing configured keeps the defaults", () => {
  assert.deepEqual(optionsFromEnv({}), {});
});

test("keys from FACTLOT_API_KEY, FACTLOT_API_KEYS, and a keys file are merged", () => {
  const dir = mkdtempSync(join(tmpdir(), "factlot-config-"));
  const file = join(dir, "keys.json");
  writeFileSync(
    file,
    JSON.stringify([
      { key: "k-file", name: "tenant-c", rate_limit_per_minute: 30 },
    ]),
  );
  const opts = optionsFromEnv({
    FACTLOT_API_KEY: "k-shared",
    FACTLOT_API_KEYS: "k-a:tenant-a,k-b:tenant-b",
    FACTLOT_API_KEYS_FILE: file,
    FACTLOT_ADMIN_KEY: "admin",
    FACTLOT_RATE_LIMIT_PER_MINUTE: "120",
    FACTLOT_USAGE_LOG: join(dir, "usage.jsonl"),
    FACTLOT_LOG: "json",
    FACTLOT_PUBLIC_URL: "https://api.example.com",
  });
  assert.deepEqual(opts, {
    apiKeys: [
      { key: "k-shared", name: "default" },
      { key: "k-a", name: "tenant-a" },
      { key: "k-b", name: "tenant-b" },
      { key: "k-file", name: "tenant-c", rateLimitPerMinute: 30 },
    ],
    adminKey: "admin",
    rateLimitPerMinute: 120,
    usageLog: join(dir, "usage.jsonl"),
    log: "json",
    publicUrl: "https://api.example.com",
  });
});

test("malformed values refuse to start", () => {
  assert.throws(
    () => optionsFromEnv({ FACTLOT_RATE_LIMIT_PER_MINUTE: "lots" }),
    /FACTLOT_RATE_LIMIT_PER_MINUTE/,
  );
  assert.throws(
    () => optionsFromEnv({ FACTLOT_RATE_LIMIT_PER_MINUTE: "-1" }),
    /FACTLOT_RATE_LIMIT_PER_MINUTE/,
  );
  assert.throws(() => optionsFromEnv({ FACTLOT_LOG: "xml" }), /FACTLOT_LOG/);
  assert.throws(
    () => optionsFromEnv({ FACTLOT_API_KEYS: "nocolon" }),
    /FACTLOT_API_KEYS/,
  );
  assert.throws(
    () => optionsFromEnv({ FACTLOT_API_KEYS_FILE: "/nonexistent/keys.json" }),
    /cannot read/,
  );
  assert.throws(
    () => optionsFromEnv({ FACTLOT_API_KEYS_FILE: "x" }, () => "{bad"),
    /not valid JSON/,
  );
  assert.throws(
    () =>
      optionsFromEnv({ FACTLOT_API_KEY: "same", FACTLOT_API_KEYS: "same:a" }),
    /duplicate key/,
  );
  assert.equal(optionsFromEnv({ FACTLOT_LOG: "none" }).log, "none");
  assert.equal(
    optionsFromEnv({ FACTLOT_RATE_LIMIT_PER_MINUTE: "0" }).rateLimitPerMinute,
    0,
  );
});
