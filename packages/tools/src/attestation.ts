/**
 * Attested results. When the hosted FactLot service runs one of the three tools that compute what
 * fact_package_send carries (audit_expense_statement, estoppel_prepare, rent_roll_certify) it signs
 * the result with its own Ed25519 key and returns the signature as `attestation`. The sender gives
 * the attestation to fact_package_send unchanged; the FactLot record checks the signature against
 * the service's published public keys and checks that the items, grades and figures it received are
 * the ones the service computed. A sender who edited a grade, a figure or an item, or who skipped the
 * tool, has no valid attestation.
 *
 * Same scheme as signed fact packages (packages.ts): RFC 8785 canonical JSON, SHA-256, an Ed25519
 * signature over a prefixed message, base64url, WebCrypto. The one difference is the key: a fact
 * package is signed by the holder's own key and FactLot never holds it; an attestation is signed by
 * the hosted service's key, which is a secret of the hosted service (ATTESTATION_SIGNING_KEY). A
 * self-hosted or SDK run without that key produces no attestation.
 *
 * What is signed (the statement, canonical JSON; `signature` is added beside it):
 *   format, version, key_id, algorithm, issued_at,
 *   tool {name, version}, kind (the exchange kind the items are for),
 *   inputs_digest   SHA-256 of the canonical JSON of the tool's input,
 *   result_digest   SHA-256 of the canonical JSON of {items}, the tool's package_items,
 *   calculation_digest  SHA-256 of the canonical JSON of the tool's package_calculation, or null,
 *   items [{key, digest}]  the digest of each item (so a refusal can name the item that changed),
 *   facts [{id, leaf}]  the RFC 6962 leaf hash of every fact the items cite, so the attestation
 *                       holds only for a package carrying those very facts.
 * The signed message is the UTF-8 bytes of ATTESTATION_PREFIX + canonical JSON of the statement.
 * The Record's exchange function (cre-record/functions/exchange) holds the same verification.
 */
import { createHash } from "node:crypto";
import type { webcrypto } from "node:crypto";

import { canonicalJson, leafHash } from "./packages.ts";
import { currentExchangeCaller } from "./exchange.ts";
import type { Json } from "./documents.ts";

export const ATTESTATION_FORMAT = "factlot.result_attestation";
export const ATTESTATION_VERSION = 1;
export const ATTESTATION_PREFIX = "factlot.result_attestation.v1:";
/** Where the hosted service publishes its public keys (also served by the hosted router). */
export const ATTESTATION_KEYS_PATH =
  "/.well-known/factlot-attestation-keys.json";

/** The tools whose results are attested, and the exchange kind their items are for. */
export const ATTESTED_TOOLS: Readonly<Record<string, string>> = {
  audit_expense_statement: "expense_reconciliation",
  estoppel_prepare: "estoppel",
  rent_roll_certify: "rent_roll",
};

export interface AttestationConfig {
  /**
   * The service's Ed25519 private key: PKCS#8, as PEM or as base64 / base64url of the DER. Held in
   * memory only; never returned, logged or stored.
   */
  signingKey: string;
  /** The key's id. Default: the first 16 hex characters of the SHA-256 of the public key. */
  keyId?: string;
  /** Public keys (32 bytes, base64url) of earlier keys, still published so they can be told apart. */
  previousPublicKeys?: string[];
  /** Replaces the clock (tests). */
  now?: () => Date;
}

export interface PublishedKey {
  kid: string;
  alg: "Ed25519";
  /** The public key: 32 bytes as base64url (a JWK's x). */
  x: string;
  status: "current" | "previous";
}

interface Loaded {
  key: webcrypto.CryptoKey;
  kid: string;
  x: string;
  previous: PublishedKey[];
  now: () => Date;
}

let configured: AttestationConfig | undefined;
let loaded: { sig: string; value: Promise<Loaded> } | undefined;
const sigOf = (c: AttestationConfig): string =>
  JSON.stringify([c.signingKey, c.keyId ?? null, c.previousPublicKeys ?? []]);

/** Set the service's signing key (the hosted Worker does this from its secret). Pass undefined to remove it. */
export function configureAttestation(
  next: AttestationConfig | undefined,
): void {
  configured = next && next.signingKey.trim() ? { ...next } : undefined;
  // The loaded key is reused while the configuration is unchanged (the Worker sets it per request).
  if (!configured || (loaded && loaded.sig !== sigOf(configured)))
    loaded = undefined;
}

/** Whether this process can sign attestations. */
export function attestationEnabled(): boolean {
  return configured !== undefined;
}

const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const sha256Hex = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

function derOf(text: string): Uint8Array {
  const pem =
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(text);
  const body = (pem ? pem[1]! : text).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(body))
    throw new Error(
      "the attestation signing key is not PKCS#8 (PEM or base64)",
    );
  return new Uint8Array(Buffer.from(body, "base64"));
}

async function load(): Promise<Loaded> {
  const c = configured;
  if (!c) throw new Error("no attestation signing key is configured");
  if (loaded && loaded.sig === sigOf(c)) return loaded.value;
  const value = (async (): Promise<Loaded> => {
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.importKey(
      "pkcs8",
      derOf(c.signingKey),
      { name: "Ed25519" },
      true,
      ["sign"],
    );
    const jwk = (await subtle.exportKey("jwk", key)) as { x?: string };
    if (!jwk.x) throw new Error("the attestation signing key is not Ed25519");
    const raw = Buffer.from(jwk.x, "base64url");
    const kid = c.keyId?.trim() || sha256Of(raw).slice(0, 16);
    const previous: PublishedKey[] = [];
    for (const rx of c.previousPublicKeys ?? []) {
      const r = Buffer.from(rx, "base64url");
      if (r.length !== 32) continue;
      previous.push({
        kid: sha256Of(r).slice(0, 16),
        alg: "Ed25519",
        x: rx,
        status: "previous",
      });
    }
    return { key, kid, x: jwk.x, previous, now: c.now ?? (() => new Date()) };
  })();
  loaded = { sig: sigOf(c), value };
  value.catch(() => {
    if (loaded?.value === value) loaded = undefined;
  });
  return value;
}
const sha256Of = (b: Uint8Array): string =>
  createHash("sha256").update(b).digest("hex");

/** The public keys to publish at ATTESTATION_KEYS_PATH: the current key and any previous ones. Empty without a key. */
export async function publishedAttestationKeys(): Promise<PublishedKey[]> {
  if (!configured) return [];
  const l = await load();
  return [
    { kid: l.kid, alg: "Ed25519", x: l.x, status: "current" },
    ...l.previous,
  ];
}

// --- what is signed --------------------------------------------------------------------------------

const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every fact (an object with id, predicate and provenance) anywhere in a tool's input, by id. */
export function factsInInput(input: unknown): Map<string, Json[]> {
  const out = new Map<string, Json[]>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12) return;
    if (Array.isArray(v)) return void v.forEach((x) => walk(x, depth + 1));
    if (!isObj(v)) return;
    if (
      typeof v.id === "string" &&
      typeof v.predicate === "string" &&
      isObj(v.provenance)
    ) {
      const list = out.get(v.id) ?? [];
      list.push(v);
      out.set(v.id, list);
      return;
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(input, 0);
  return out;
}

/** The statement the service signs for one tool result, or the reason there is none. */
export function attestationStatement(args: {
  tool: string;
  toolVersion: string;
  keyId: string;
  issuedAt: string;
  input: unknown;
  items: Json[];
  calculation?: Json | undefined;
}): { statement: Json } | { reason: string } {
  const kind = ATTESTED_TOOLS[args.tool];
  if (!kind) return { reason: `${args.tool} is not an attested tool` };
  const byId = factsInInput(args.input);
  const cited = new Set<string>();
  for (const it of args.items)
    for (const id of Array.isArray(it.fact_ids)
      ? (it.fact_ids as string[])
      : [])
      cited.add(id);
  const facts: { id: string; leaf: string }[] = [];
  for (const id of [...cited].sort()) {
    const found = byId.get(id);
    if (!found)
      return { reason: `the items cite fact ${id}, which is not in the input` };
    const leaves = new Set(found.map(leafHash));
    if (leaves.size !== 1)
      return { reason: `two different facts in the input share the id ${id}` };
    facts.push({ id, leaf: [...leaves][0]! });
  }
  return {
    statement: {
      format: ATTESTATION_FORMAT,
      version: ATTESTATION_VERSION,
      key_id: args.keyId,
      algorithm: "Ed25519",
      issued_at: args.issuedAt,
      tool: { name: args.tool, version: args.toolVersion },
      kind,
      inputs_digest: sha256Hex(canonicalJson(args.input)),
      result_digest: sha256Hex(canonicalJson({ items: args.items })),
      calculation_digest:
        args.calculation === undefined
          ? null
          : sha256Hex(canonicalJson(args.calculation)),
      items: args.items.map((it) => ({
        key: String(it.key),
        digest: sha256Hex(canonicalJson(it)),
      })),
      facts,
    },
  };
}

export const attestationMessage = (statement: Json): Uint8Array =>
  new TextEncoder().encode(`${ATTESTATION_PREFIX}${canonicalJson(statement)}`);

const NO_KEY_NOTE =
  "No attestation: this FactLot service has no attestation signing key configured, so the result is not signed. The tool's answer is unchanged. fact_package_send will take the package as unattested, and the FactLot record accepts an unattested package of this kind in test mode only.";

/**
 * The attestation of a tool's result, added to the answer as `attestation` when this process holds
 * the service key and the answer carries items to send. A hosted service without the key says so
 * (`attestation: null` and `attestation_note`); a local or self-hosted run adds nothing.
 * Runs for the three attested tools only.
 */
export async function attestResult(
  tool: string,
  input: unknown,
  out: unknown,
  toolVersion: string,
): Promise<unknown> {
  if (!ATTESTED_TOOLS[tool] || !isObj(out)) return out;
  const items = out.package_items;
  if (!Array.isArray(items) || items.length === 0 || !items.every(isObj))
    return out;
  if (!configured) {
    if (currentExchangeCaller()?.hosted === true)
      return { ...out, attestation: null, attestation_note: NO_KEY_NOTE };
    return out;
  }
  const l = await load();
  const calc = isObj(out.package_calculation)
    ? out.package_calculation
    : undefined;
  const made = attestationStatement({
    tool,
    toolVersion,
    keyId: l.kid,
    issuedAt: l
      .now()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
    input,
    items: items as Json[],
    calculation: calc,
  });
  if ("reason" in made)
    return {
      ...out,
      attestation: null,
      attestation_note: `No attestation: ${made.reason}. The tool's answer is unchanged; fact_package_send will take the package as unattested.`,
    };
  const sig = await globalThis.crypto.subtle.sign(
    { name: "Ed25519" },
    l.key,
    attestationMessage(made.statement),
  );
  return {
    ...out,
    attestation: { ...made.statement, signature: b64url(new Uint8Array(sig)) },
    attestation_note:
      "Give this attestation, unchanged, to fact_package_send with package_items and package_calculation. The FactLot record then shows the figures as computed by FactLot and unchanged since. Any change to an item, a grade or a figure, or to the facts they cite, makes the attestation invalid and the send is refused.",
  };
}

// --- verification (the reference the record's function follows) --------------------------------------

export interface AttestationCheck {
  ok: boolean;
  problems: string[];
  /** Whether the attestation covers the calculation (it does when the tool returned one). */
  calculation_covered: boolean;
}

/**
 * Check an attestation against what a send carries. `keys` maps key id to the public key (base64url).
 * The same rules the FactLot record applies.
 */
export async function verifyAttestation(
  att: unknown,
  sent: {
    kind: string;
    items: Json[];
    calculation?: Json | undefined;
    facts: Json[];
  },
  keys: ReadonlyMap<string, string>,
): Promise<AttestationCheck> {
  const problems: string[] = [];
  const fail = (m: string): AttestationCheck => ({
    ok: false,
    problems: [...problems, m],
    calculation_covered: false,
  });
  if (!isObj(att)) return fail("the attestation is not an object");
  const { signature, ...statement } = att as Json;
  if (
    statement.format !== ATTESTATION_FORMAT ||
    statement.version !== ATTESTATION_VERSION ||
    statement.algorithm !== "Ed25519"
  )
    return fail(
      "not a FactLot result attestation (format, version or algorithm)",
    );
  const tool = isObj(statement.tool) ? statement.tool : {};
  if (ATTESTED_TOOLS[String(tool.name)] !== statement.kind)
    return fail("the attestation names a tool that does not produce this kind");
  if (statement.kind !== sent.kind)
    return fail(
      `the attestation is for kind ${String(statement.kind)}, not ${sent.kind}`,
    );
  const x = keys.get(String(statement.key_id));
  if (!x)
    return fail(
      `the attestation's key ${String(statement.key_id)} is not a key FactLot publishes`,
    );
  const sigBytes =
    typeof signature === "string"
      ? Buffer.from(signature, "base64url")
      : undefined;
  if (!sigBytes || sigBytes.length !== 64)
    return fail("the attestation's signature is not 64 bytes of base64url");
  let valid: boolean;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      Buffer.from(x, "base64url"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    valid = await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sigBytes,
      attestationMessage(statement),
    );
  } catch {
    valid = false;
  }
  if (!valid) return fail("the attestation's signature does not verify");
  if (
    sha256Hex(canonicalJson({ items: sent.items })) !== statement.result_digest
  ) {
    const attested = new Map(
      (Array.isArray(statement.items) ? (statement.items as Json[]) : []).map(
        (i) => [String(i.key), String(i.digest)],
      ),
    );
    const sentKeys = sent.items.map((i) => String(i.key));
    const changed = sent.items
      .filter(
        (i) => attested.get(String(i.key)) !== sha256Hex(canonicalJson(i)),
      )
      .map((i) => String(i.key));
    const missing = [...attested.keys()].filter((k) => !sentKeys.includes(k));
    if (changed.length)
      problems.push(
        `item ${changed.slice(0, 5).join(", ")} differs from what FactLot computed`,
      );
    if (missing.length)
      problems.push(
        `item ${missing.slice(0, 5).join(", ")} was computed but is not in the package`,
      );
    if (!changed.length && !missing.length)
      problems.push("the items are not in the order FactLot computed them");
    return { ok: false, problems, calculation_covered: false };
  }
  const covered =
    statement.calculation_digest !== null &&
    statement.calculation_digest !== undefined;
  if (covered) {
    if (sent.calculation === undefined)
      return fail(
        "FactLot computed a calculation that the package does not carry",
      );
    if (
      sha256Hex(canonicalJson(sent.calculation)) !==
      statement.calculation_digest
    )
      return fail("the calculation differs from what FactLot computed");
  }
  const leaf = new Map<string, string>();
  for (const f of sent.facts)
    if (typeof f.id === "string") leaf.set(f.id, leafHash(f));
  const attestedFacts = new Map(
    (Array.isArray(statement.facts) ? (statement.facts as Json[]) : []).map(
      (f) => [String(f.id), String(f.leaf)],
    ),
  );
  for (const [id, l] of attestedFacts)
    if (leaf.get(id) !== l)
      return fail(`fact ${id} is not the fact FactLot computed from`);
  for (const it of sent.items)
    for (const id of Array.isArray(it.fact_ids)
      ? (it.fact_ids as string[])
      : [])
      if (!attestedFacts.has(id))
        return fail(
          `item ${String(it.key)} cites fact ${id}, which FactLot did not compute from`,
        );
  return { ok: true, problems: [], calculation_covered: covered };
}
