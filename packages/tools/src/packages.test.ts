// Fact packages, statement spreading and use conflicts: the parts the shared vectors
// (spec/vectors/documents.json) do not reach.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runTool, runToolAsync } from "./index.ts";
import {
  canonicalJson,
  fromBase64url,
  leafHash,
  merkleRoot,
  signFactPackage,
} from "./packages.ts";
import { KeywordIndex, stem, words } from "./words.ts";

const spec = JSON.parse(
  readFileSync(
    new URL("../../../spec/vectors/documents.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: { name: string; tool: string; arguments: Record<string, unknown> }[];
};
const byName = (prefix: string) =>
  spec.cases.find((c) => c.name.startsWith(prefix))!;

// RFC 8032 section 7.1, test 1: a published test key, never a real one.
const SEED = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex",
);
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

async function testKey(): Promise<webcrypto.CryptoKey> {
  return webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.concat([PKCS8_PREFIX, SEED]),
    { name: "Ed25519" },
    true,
    ["sign"],
  );
}

test("signFactPackage gives the vector's signature (Ed25519 is deterministic), and it verifies", async () => {
  const create = byName("fact package: canonical facts");
  const made = runTool(create.tool, create.arguments);
  assert.ok(made.ok);
  const pkg = (made.result as { package: Record<string, unknown> }).package;
  const signed = await signFactPackage(
    pkg,
    await testKey(),
    "rfc8032-test-vector-1",
  );
  const vector = byName("verify a signed package").arguments.package as {
    signature: unknown;
  };
  assert.deepEqual(signed.signature, vector.signature);
  const check = await runToolAsync("fact_package_verify", {
    package: signed,
    public_key: (signed.signature as { public_key: string }).public_key,
  });
  assert.ok(check.ok);
  assert.equal((check.result as { valid: boolean }).valid, true);
  // A package whose content no longer matches its hashes cannot be signed.
  const changed = { ...pkg, title: "changed" };
  await assert.rejects(
    signFactPackage(changed, await testKey()),
    /integrity.digest does not match/,
  );
});

test("fact_package_verify needs runToolAsync; runTool says so", () => {
  const out = runTool("fact_package_verify", {
    package: byName("verify a signed package").arguments.package,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.error.message, /call runToolAsync/);
});

test("Merkle root follows RFC 6962 for 1 to 5 leaves", () => {
  const h = (...parts: Buffer[]): Buffer =>
    createHash("sha256").update(Buffer.concat(parts)).digest();
  const leaves = [1, 2, 3, 4, 5].map((n) => leafHash({ n }));
  const L = leaves.map((x) => Buffer.from(x, "hex"));
  const node = (a: Buffer, b: Buffer): Buffer => h(Buffer.from([1]), a, b);
  assert.equal(
    leaves[0],
    h(Buffer.from([0]), Buffer.from('{"n":1}')).toString("hex"),
  );
  assert.equal(merkleRoot(leaves.slice(0, 1)), leaves[0]);
  assert.equal(
    merkleRoot(leaves.slice(0, 2)),
    node(L[0]!, L[1]!).toString("hex"),
  );
  assert.equal(
    merkleRoot(leaves.slice(0, 3)),
    node(node(L[0]!, L[1]!), L[2]!).toString("hex"),
  );
  assert.equal(
    merkleRoot(leaves),
    node(node(node(L[0]!, L[1]!), node(L[2]!, L[3]!)), L[4]!).toString("hex"),
  );
});

test("canonical JSON refuses what JSON cannot hold; base64url is strict", () => {
  assert.throws(() => canonicalJson(Number.NaN));
  assert.equal(canonicalJson({ b: undefined, a: 1 }), '{"a":1}');
  assert.equal(fromBase64url("ab+c"), undefined);
  assert.equal(fromBase64url("a"), undefined);
  assert.deepEqual([...fromBase64url("AAE")!], [0, 1]);
});

test("words: plurals fold, accents and & are read, the longest keyword wins", () => {
  assert.deepEqual(words("Café & Bakeries"), ["cafe", "and", "bakery"]);
  assert.deepEqual(
    ["taxes", "glasses", "sandwiches", "drinks", "gas", "bus", "analysis"].map(
      stem,
    ),
    ["tax", "glass", "sandwich", "drink", "gas", "bus", "analysis"],
  );
  const index = new KeywordIndex([
    { key: "bar", keywords: ["bar"] },
    { key: "juice", keywords: ["juice bar"] },
  ]);
  assert.deepEqual(
    index.find(words("a juice bar and a bar")).map((m) => m.key),
    ["juice", "bar"],
  );
});

test("doc_spread_statement: a caller's tolerance decides footing", () => {
  const args = {
    document: {
      pages: [
        "SYNTHETIC. Rental Income 1,000\nInsurance 300\nNet Operating Income 702",
      ],
    },
    property_type: "commercial",
    lines: [
      {
        label: "Rental Income",
        amount: 1000,
        quote: "Rental Income 1,000",
        page: 1,
      },
      { label: "Insurance", amount: 300, quote: "Insurance 300\nNet", page: 1 },
      {
        label: "Net Operating Income",
        amount: 702,
        quote: "Net Operating Income 702",
        page: 1,
      },
    ],
  };
  const strict = runTool("doc_spread_statement", args);
  const loose = runTool("doc_spread_statement", { ...args, tolerance: 5 });
  assert.ok(strict.ok && loose.ok);
  const foots = (r: unknown): boolean =>
    (r as { summary: { foots: boolean } }).summary.foots;
  assert.equal(foots(strict.result), false); // default 0.5 per line: 1 for two lines
  assert.equal(foots(loose.result), true);
});

test("the ASCII span fast path gives the general path's result", async () => {
  const { generalSpanMap, spanMap } = await import("./quotes.ts");
  const alphabet = [
    "a",
    "B",
    " ",
    "\t",
    "\n",
    "\v",
    "\f",
    "\r",
    "\x1c",
    "\x1f",
  ];
  alphabet.push("\x00", "-", "Z", "  ", "\n\n", "1", ",", "(", "~", "\x7f");
  let seed = 7;
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let n = 0; n < 5000; n++) {
    let page = "";
    for (let i = next(30); i > 0; i--) page += alphabet[next(alphabet.length)];
    assert.deepEqual(spanMap(page), generalSpanMap(page), JSON.stringify(page));
  }
});
