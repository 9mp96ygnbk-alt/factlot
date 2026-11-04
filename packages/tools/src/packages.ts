/**
 * Fact packages: a canonical JSON bundle of FactLot facts with the hashes of their source
 * documents, an RFC 6962 Merkle tree over the canonical facts, and an optional Ed25519 signature
 * made by the holder's own key. FactLot never holds a private key: fact_package_create builds an
 * unsigned package, the signer signs locally (signFactPackage here, factlot.sign_fact_package in
 * Python, or the local MCP server's fact_package_sign), and fact_package_verify checks hashes,
 * the signature (WebCrypto Ed25519) and, given the documents' pages, every quote.
 * python/src/factlot/factpackage.py is the same code; spec/vectors/documents.json pins both.
 */
import { createHash } from "node:crypto";
import type { webcrypto } from "node:crypto";

import { IsoDateTime } from "@factlot/schema";
import { z } from "zod";

import {
  DOC_LIMITS,
  DocumentInput,
  ToolInputError,
  capCharacters,
  characters,
  loadDocument,
  validateFact,
} from "./documents.ts";
import type { Doc, Json } from "./documents.ts";
import { isPlainObject, locateQuote } from "./quotes.ts";

export const PACKAGE_FORMAT = "factlot.fact_package";
export const PACKAGE_VERSION = 1;
export const SIGNING_PREFIX = "factlot.fact_package.v1:";

const FactObject = z
  .record(z.string(), z.unknown())
  .describe("A FactLot fact (it must pass fact_validate).");
const PackageDocument = z.object({
  document_id: z
    .string()
    .min(1)
    .max(500)
    .describe("The document's ID as the facts cite it."),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "expected 64 lowercase hex characters")
    .optional()
    .describe("SHA-256 of the exact file, when known."),
  title: z.string().max(500).optional(),
});

export const FactPackageCreateInput = z.object({
  facts: z
    .array(FactObject)
    .min(1)
    .max(DOC_LIMITS.factsPerCall)
    .describe(
      "The facts to package, in order: verified facts from the doc_* tools or any facts that pass fact_validate.",
    ),
  title: z.string().max(500).optional().describe("A title for the package."),
  created_at: IsoDateTime.optional().describe(
    "When the package was made (ISO 8601 with offset). FactLot adds no clock time, so the same input always gives the same package.",
  ),
  created_by: z
    .string()
    .max(200)
    .optional()
    .describe("The organization making the package."),
  documents: z
    .array(PackageDocument)
    .max(DOC_LIMITS.documentsPerAbstract)
    .optional()
    .describe(
      "Source documents to describe beyond what the facts cite (a title, the file's sha256). Every document a fact cites is listed automatically.",
    ),
});

export const FactPackageVerifyInput = z.object({
  package: z
    .record(z.string(), z.unknown())
    .describe("A fact package from fact_package_create, signed or not."),
  public_key: z
    .string()
    .max(200)
    .optional()
    .describe(
      "The signer's Ed25519 public key you trust: 32 bytes as base64url (a JWK's x). With it the signature must verify for the package to be valid.",
    ),
  documents: z
    .array(DocumentInput)
    .max(DOC_LIMITS.documentsPerAbstract)
    .optional()
    .describe(
      "Optional: the source documents' pages (with sha256 when the facts cite the file's hash). Each fact's quote is then checked on its cited page.",
    ),
});

// --- canonical JSON and hashes -------------------------------------------------------------------

/** RFC 8785 (JCS) canonical JSON: keys sorted by UTF-16 code units, ECMAScript numbers and strings. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string")
    return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v))
      throw new Error("canonical JSON has no NaN or Infinity");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  throw new Error(`canonical JSON cannot hold ${typeof v}`);
}

function sha256(data: Uint8Array | string): Uint8Array {
  return createHash("sha256").update(data).digest();
}
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

/** RFC 6962 leaf hash of one fact: SHA-256(0x00 || canonical JSON). */
export function leafHash(fact: unknown): string {
  return hex(
    sha256(
      Buffer.concat([
        Buffer.from([0]),
        Buffer.from(canonicalJson(fact), "utf8"),
      ]),
    ),
  );
}

/** RFC 6962 Merkle tree hash over leaf hashes (hex). */
export function merkleRoot(leaves: readonly string[]): string {
  const tree = (from: number, to: number): Uint8Array => {
    if (to - from === 1) return Buffer.from(leaves[from]!, "hex");
    let k = 1;
    while (k * 2 < to - from) k *= 2;
    return sha256(
      Buffer.concat([
        Buffer.from([1]),
        tree(from, from + k),
        tree(from + k, to),
      ]),
    );
  };
  return leaves.length ? hex(tree(0, leaves.length)) : hex(sha256(""));
}

const SHA_ID = /^fl:document:sha256-([a-f0-9]{64})$/;

/** Compare strings by UTF-16 code units (JavaScript's default sort, and Python's utf-16-be key). */
const byCodeUnits = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

interface Manifest {
  format: string;
  version: number;
  title?: string;
  created_at?: string;
  created_by?: string;
  documents: Json[];
  fact_count: number;
  merkle_root: string;
}

function digestOf(m: Manifest): string {
  return hex(sha256(canonicalJson(m)));
}

// --- fact_package_create -------------------------------------------------------------------------

export function createFactPackage(
  input: z.output<typeof FactPackageCreateInput>,
): Json {
  const issues: { path: string; message: string }[] = [];
  input.facts.forEach((f, i) => {
    for (const x of validateFact(f).issues)
      issues.push({
        path: `facts.${i}${x.path ? `.${x.path}` : ""}`,
        message: x.message,
      });
  });
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  // Every document a fact cites, with its sha256 when the source or the ID gives it.
  const docs = new Map<string, Json>();
  const conflict: { path: string; message: string }[] = [];
  const note = (d: Json, path: string): void => {
    const id = d.document_id as string;
    const have = docs.get(id) ?? { document_id: id };
    const sha = (d.sha256 as string | undefined) ?? SHA_ID.exec(id)?.[1];
    if (sha !== undefined) {
      if (have.sha256 !== undefined && have.sha256 !== sha)
        conflict.push({
          path,
          message: `${id} is given two different sha256 values`,
        });
      else have.sha256 = sha;
    }
    if (d.title !== undefined && have.title === undefined) have.title = d.title;
    docs.set(id, have);
  };
  input.facts.forEach((f, i) =>
    ((f.provenance as Json).sources as Json[]).forEach((s, j) =>
      note(s, `facts.${i}.provenance.sources.${j}`),
    ),
  );
  (input.documents ?? []).forEach((d, i) => note(d, `documents.${i}`));
  if (conflict.length) throw new ToolInputError(conflict.slice(0, 20));
  const documents = [...docs.values()]
    .sort((a, b) =>
      byCodeUnits(a.document_id as string, b.document_id as string),
    )
    .map((d) => ({
      document_id: d.document_id,
      ...(d.sha256 !== undefined ? { sha256: d.sha256 } : {}),
      ...(d.title !== undefined ? { title: d.title } : {}),
    }));

  const leaves = input.facts.map(leafHash);
  const root = merkleRoot(leaves);
  const manifest: Manifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.created_at !== undefined ? { created_at: input.created_at } : {}),
    ...(input.created_by !== undefined ? { created_by: input.created_by } : {}),
    documents,
    fact_count: input.facts.length,
    merkle_root: root,
  };
  const digest = digestOf(manifest);
  const head: Json = { ...manifest };
  delete head.fact_count;
  delete head.merkle_root;
  return {
    package: {
      ...head,
      facts: input.facts,
      integrity: {
        hash: "sha256",
        canonicalization: "RFC 8785 (JCS)",
        tree: "RFC 6962 Merkle tree hash",
        leaf_hashes: leaves,
        merkle_root: root,
        digest,
      },
    },
    digest,
    signing_message: `${SIGNING_PREFIX}${digest}`,
    next: "To sign, sign the UTF-8 bytes of signing_message with your own Ed25519 key on your own machine (factlot.sign_fact_package in Python, signFactPackage in @factlot/tools, or fact_package_sign in the local MCP server) and add signature {algorithm: Ed25519, public_key, value}. FactLot never sees or stores a private key.",
  };
}

// --- verification ---------------------------------------------------------------------------------

const B64URL = /^[A-Za-z0-9_-]*={0,2}$/;

/** Strict base64url (padding optional), or undefined. */
export function fromBase64url(s: string): Uint8Array | undefined {
  if (!B64URL.test(s) || s.replace(/=+$/, "").length % 4 === 1)
    return undefined;
  return new Uint8Array(Buffer.from(s.replace(/=+$/, ""), "base64url"));
}
export const toBase64url = (b: Uint8Array): string =>
  Buffer.from(b).toString("base64url");

async function ed25519Verify(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature,
      message,
    );
  } catch {
    return false;
  }
}

interface Recomputed {
  problems: string[];
  leaves: string[];
  root: string;
  digest: string;
}

/** The package's hashes recomputed from its content, and how they differ from what it states. */
function recompute(pkg: Json): Recomputed {
  const facts = pkg.facts as Json[];
  const problems: string[] = [];
  const leaves = facts.map(leafHash);
  const root = merkleRoot(leaves);
  const documents = Array.isArray(pkg.documents)
    ? (pkg.documents as Json[])
    : [];
  if (!Array.isArray(pkg.documents)) problems.push("documents is missing");
  const manifest: Manifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    ...(pkg.title !== undefined ? { title: pkg.title as string } : {}),
    ...(pkg.created_at !== undefined
      ? { created_at: pkg.created_at as string }
      : {}),
    ...(pkg.created_by !== undefined
      ? { created_by: pkg.created_by as string }
      : {}),
    documents,
    fact_count: facts.length,
    merkle_root: root,
  };
  const digest = digestOf(manifest);
  const integrity = isPlainObject(pkg.integrity) ? pkg.integrity : undefined;
  if (!integrity) problems.push("integrity is missing");
  else {
    const stated = integrity.leaf_hashes;
    if (!Array.isArray(stated))
      problems.push("integrity.leaf_hashes is missing");
    else {
      if (stated.length !== leaves.length)
        problems.push(
          `integrity.leaf_hashes has ${stated.length} hashes for ${leaves.length} facts`,
        );
      const changed = leaves
        .map((h, i) => (stated[i] === h ? -1 : i))
        .filter((i) => i >= 0);
      if (changed.length)
        problems.push(
          `facts ${changed.slice(0, 20).join(", ")}${changed.length > 20 ? ", ..." : ""} do not match their leaf hashes`,
        );
    }
    if (integrity.merkle_root !== root)
      problems.push("integrity.merkle_root does not match the facts");
    if (integrity.digest !== digest)
      problems.push(
        "integrity.digest does not match the package (title, dates, documents or facts changed)",
      );
  }
  const listed = new Set(
    documents.map((d) => (isPlainObject(d) ? d.document_id : undefined)),
  );
  const unlisted: string[] = [];
  for (const f of facts) {
    const prov = isPlainObject(f.provenance) ? f.provenance : {};
    for (const s of Array.isArray(prov.sources) ? prov.sources : [])
      if (
        isPlainObject(s) &&
        typeof s.document_id === "string" &&
        !listed.has(s.document_id) &&
        !unlisted.includes(s.document_id)
      )
        unlisted.push(s.document_id);
  }
  if (unlisted.length)
    problems.push(
      `documents does not list ${unlisted.slice(0, 5).join(", ")}${unlisted.length > 5 ? ", ..." : ""}`,
    );
  return { problems, leaves, root, digest };
}

async function checkSignature(
  pkg: Json,
  digest: string,
  trusted: Uint8Array | undefined,
  trustedText: string | undefined,
): Promise<Json> {
  const sig = pkg.signature;
  if (sig === undefined)
    return {
      status: "absent",
      reason: trusted
        ? "the package is not signed, but a public key was given"
        : "the package is not signed",
    };
  if (!isPlainObject(sig) || sig.algorithm !== "Ed25519")
    return {
      status: "invalid",
      reason: "signature must be {algorithm: Ed25519, public_key, value}",
    };
  const embedded =
    typeof sig.public_key === "string"
      ? fromBase64url(sig.public_key)
      : undefined;
  const value =
    typeof sig.value === "string" ? fromBase64url(sig.value) : undefined;
  const base: Json = {
    ...(typeof sig.public_key === "string"
      ? { public_key: sig.public_key }
      : {}),
    ...(typeof sig.key_id === "string" ? { key_id: sig.key_id } : {}),
  };
  if (!embedded || embedded.length !== 32)
    return {
      ...base,
      status: "invalid",
      reason: "signature.public_key is not 32 bytes of base64url",
    };
  if (!value || value.length !== 64)
    return {
      ...base,
      status: "invalid",
      reason: "signature.value is not 64 bytes of base64url",
    };
  if (
    trusted &&
    Buffer.compare(Buffer.from(trusted), Buffer.from(embedded)) !== 0
  )
    return {
      ...base,
      status: "key_mismatch",
      reason: `the package was signed with ${String(sig.public_key)}, not the public key given (${trustedText})`,
    };
  const ok = await ed25519Verify(
    embedded,
    value,
    new TextEncoder().encode(`${SIGNING_PREFIX}${digest}`),
  );
  if (!ok)
    return {
      ...base,
      status: "invalid",
      reason: "the signature does not verify for this package's digest",
    };
  return trusted
    ? { ...base, status: "verified", reason: "signed by the public key given" }
    : {
        ...base,
        status: "matches_embedded_key",
        reason:
          "the signature matches the public key inside the package, but anyone can sign: pass the signer's public key you trust as public_key",
      };
}

export async function verifyFactPackage(
  input: z.output<typeof FactPackageVerifyInput>,
): Promise<Json> {
  const pkg = input.package;
  const issues: { path: string; message: string }[] = [];
  if (pkg.format !== PACKAGE_FORMAT || pkg.version !== PACKAGE_VERSION)
    issues.push({
      path: "package",
      message: `expected format ${PACKAGE_FORMAT}, version ${PACKAGE_VERSION}`,
    });
  const facts = pkg.facts;
  if (
    !Array.isArray(facts) ||
    facts.length === 0 ||
    facts.length > DOC_LIMITS.factsPerCall ||
    !facts.every(isPlainObject)
  )
    issues.push({
      path: "package.facts",
      message: `expected 1 to ${DOC_LIMITS.factsPerCall} fact objects`,
    });
  for (const k of ["title", "created_at", "created_by"])
    if (pkg[k] !== undefined && typeof pkg[k] !== "string")
      issues.push({ path: `package.${k}`, message: "expected string" });
  let trusted: Uint8Array | undefined;
  if (input.public_key !== undefined) {
    trusted = fromBase64url(input.public_key);
    if (!trusted || trusted.length !== 32) {
      trusted = undefined;
      issues.push({
        path: "public_key",
        message: "expected an Ed25519 public key: 32 bytes as base64url",
      });
    }
  }
  if (issues.length) throw new ToolInputError(issues);
  capCharacters(
    (input.documents ?? []).reduce((n, d) => n + characters(d.pages), 0),
  );

  const r = recompute(pkg);
  const factIssues: Json[] = [];
  (facts as Json[]).forEach((f, i) => {
    const v = validateFact(f);
    if (!v.valid) factIssues.push({ fact: i, issues: v.issues.slice(0, 20) });
  });
  const signature = await checkSignature(
    pkg,
    r.digest,
    trusted,
    input.public_key,
  );

  // Quotes on their pages, for the documents given.
  const docs = new Map<string, Doc>();
  (input.documents ?? []).forEach((d, i) => {
    const doc = loadDocument(d, `documents.${i}`);
    docs.set(doc.id, doc);
  });
  let checked = 0;
  let onPage = 0;
  const quoteProblems: Json[] = [];
  const notSupplied: string[] = [];
  (facts as Json[]).forEach((f, i) => {
    const prov = isPlainObject(f.provenance) ? f.provenance : {};
    const sources = Array.isArray(prov.sources) ? prov.sources : [];
    sources.forEach((s, j) => {
      if (!isPlainObject(s) || typeof s.document_id !== "string") return;
      if (typeof s.quote !== "string" || typeof s.page !== "number") return;
      const doc = docs.get(s.document_id);
      if (!doc) {
        if (!notSupplied.includes(s.document_id))
          notSupplied.push(s.document_id);
        return;
      }
      checked++;
      const loc = locateQuote(doc.text, s.quote, s.page);
      const where = {
        fact: i,
        source: j,
        document_id: s.document_id,
        page: s.page,
      };
      if (loc.ok && !loc.corrected) onPage++;
      else if (loc.ok)
        quoteProblems.push({
          ...where,
          status: "other_page",
          reason: `quote found on page ${loc.page}, not ${s.page}`,
        });
      else
        quoteProblems.push({
          ...where,
          status: "not_found",
          reason: loc.reason,
        });
    });
  });

  const integrityOk = r.problems.length === 0;
  const signatureOk =
    input.public_key !== undefined
      ? signature.status === "verified"
      : !["invalid", "key_mismatch"].includes(signature.status as string);
  const valid =
    integrityOk &&
    signatureOk &&
    factIssues.length === 0 &&
    quoteProblems.length === 0;
  return {
    valid,
    integrity: {
      status: integrityOk ? "ok" : "mismatch",
      merkle_root: r.root,
      digest: r.digest,
      ...(r.problems.length ? { problems: r.problems } : {}),
    },
    signature,
    facts: {
      count: (facts as Json[]).length,
      invalid: factIssues,
    },
    quotes: {
      checked,
      on_page: onPage,
      problems: quoteProblems,
      documents_not_supplied: notSupplied,
    },
  };
}

// --- signing (local only: the private key stays with its holder) --------------------------------

/**
 * Sign a package from fact_package_create with an Ed25519 private key (an extractable WebCrypto
 * CryptoKey, e.g. from importKey("pkcs8", ..., "Ed25519", true, ["sign"])). Returns the package
 * with `signature`. Throws if the package's hashes do not match its content.
 */
export async function signFactPackage(
  pkg: Json,
  privateKey: webcrypto.CryptoKey,
  keyId?: string,
): Promise<Json> {
  const r = recompute(pkg);
  if (r.problems.length)
    throw new Error(`cannot sign: ${r.problems.join("; ")}`);
  const jwk = await globalThis.crypto.subtle.exportKey("jwk", privateKey);
  if (jwk.crv !== "Ed25519" || typeof jwk.x !== "string")
    throw new Error("cannot sign: expected an extractable Ed25519 private key");
  const value = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      new TextEncoder().encode(`${SIGNING_PREFIX}${r.digest}`),
    ),
  );
  const rest: Json = { ...pkg };
  delete rest.signature;
  return {
    ...rest,
    signature: {
      algorithm: "Ed25519",
      public_key: jwk.x,
      ...(keyId !== undefined ? { key_id: keyId } : {}),
      value: toBase64url(value),
    },
  };
}
