import assert from "node:assert/strict";
import test from "node:test";

import {
  bearerToken,
  keyPrefix,
  mergeApiKeys,
  parseApiKeysEnv,
  parseApiKeysJson,
  resolveApiKey,
  safeEqual,
} from "./auth.ts";

test("safeEqual compares in constant time without leaking length", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false, "different lengths");
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual("", "x"), false);
  // timingSafeEqual throws on unequal buffers; hashing first means it never does.
  assert.doesNotThrow(() => safeEqual("a".repeat(1000), "b"));
});

test("keyPrefix never reveals more than a quarter of the key", () => {
  assert.equal(keyPrefix("sk-live-0123456789abcdef"), "sk-liv…");
  assert.equal(keyPrefix("secret"), "s…");
  assert.equal(keyPrefix("abc"), "…");
  for (const key of ["x", "abcdefgh", "a".repeat(100)])
    assert.ok(keyPrefix(key).length - 1 <= Math.max(0, key.length / 4));
});

test("bearerToken parses the Authorization header", () => {
  assert.equal(bearerToken("Bearer abc"), "abc");
  assert.equal(bearerToken("bearer abc"), "abc");
  assert.equal(bearerToken("Bearer   abc  "), "abc");
  assert.equal(bearerToken("Basic abc"), undefined);
  assert.equal(bearerToken("Bearer"), undefined);
  assert.equal(bearerToken(undefined), undefined);
  assert.equal(bearerToken(["Bearer a", "Bearer b"]), undefined);
});

test("resolveApiKey resolves to a name and rejects unknown tokens", () => {
  const keys = [
    { key: "k-one", name: "tenant-a" },
    { key: "k-two", name: "tenant-b", rateLimitPerMinute: 5 },
    { key: "k-three", name: "tenant-b" },
  ];
  assert.equal(resolveApiKey("k-one", keys)?.name, "tenant-a");
  assert.equal(resolveApiKey("k-two", keys)?.rateLimitPerMinute, 5);
  assert.equal(resolveApiKey("k-three", keys)?.name, "tenant-b");
  assert.equal(resolveApiKey("k-on", keys), undefined);
  assert.equal(resolveApiKey("k-one ", keys), undefined);
  assert.equal(resolveApiKey("", keys), undefined);
  assert.equal(resolveApiKey(undefined, keys), undefined);
  assert.equal(resolveApiKey("k-one", []), undefined);
});

test("parseApiKeysEnv accepts key:name pairs and rejects bad entries", () => {
  assert.deepEqual(parseApiKeysEnv("key1:tenant-a, key2:tenant-b ,"), [
    { key: "key1", name: "tenant-a" },
    { key: "key2", name: "tenant-b" },
  ]);
  assert.deepEqual(parseApiKeysEnv(""), []);
  assert.throws(() => parseApiKeysEnv("key1"), /key:name/);
  assert.throws(() => parseApiKeysEnv("key1:"), /key:name/);
  assert.throws(() => parseApiKeysEnv(":tenant"), /key:name/);
  assert.throws(() => parseApiKeysEnv("same:a,same:b"), /duplicate key/);
  // The error names only a prefix of the offending entry, never the whole key.
  assert.throws(
    () => parseApiKeysEnv("sk-live-0123456789abcdef"),
    (err: unknown) =>
      err instanceof Error && !err.message.includes("0123456789abcdef"),
  );
});

test("parseApiKeysJson validates the keys file", () => {
  const keys = parseApiKeysJson(
    JSON.stringify([
      { key: "k1", name: "tenant-a", rate_limit_per_minute: 600 },
      { key: "k2", name: "tenant-b" },
    ]),
  );
  assert.deepEqual(keys, [
    { key: "k1", name: "tenant-a", rateLimitPerMinute: 600 },
    { key: "k2", name: "tenant-b" },
  ]);
  assert.throws(() => parseApiKeysJson("{nope"), /not valid JSON/);
  assert.throws(() => parseApiKeysJson("{}"), /expected a JSON array/);
  assert.throws(() => parseApiKeysJson("[1]"), /\[0\]: expected an object/);
  assert.throws(
    () => parseApiKeysJson(JSON.stringify([{ name: "a" }])),
    /"key" must be/,
  );
  assert.throws(
    () => parseApiKeysJson(JSON.stringify([{ key: "k" }])),
    /"name" must be/,
  );
  assert.throws(
    () =>
      parseApiKeysJson(
        JSON.stringify([{ key: "k", name: "a", rate_limit_per_minute: -1 }]),
      ),
    /rate_limit_per_minute/,
  );
  assert.throws(
    () =>
      parseApiKeysJson(
        JSON.stringify([{ key: "k", name: "a", rate_limit_per_minute: "5" }]),
      ),
    /rate_limit_per_minute/,
  );
  assert.throws(
    () =>
      parseApiKeysJson(
        JSON.stringify([
          { key: "k", name: "a" },
          { key: "k", name: "b" },
        ]),
      ),
    /duplicate key/,
  );
});

test("mergeApiKeys rejects the same key from two sources", () => {
  assert.equal(
    mergeApiKeys([{ key: "a", name: "x" }], [{ key: "b", name: "x" }]).length,
    2,
  );
  assert.throws(
    () => mergeApiKeys([{ key: "a", name: "x" }], [{ key: "a", name: "y" }]),
    /duplicate key/,
  );
});
