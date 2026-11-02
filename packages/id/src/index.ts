/**
 * @factlot/id — FactLot ID, v0.
 *
 * Canonical identifiers for commercial real estate. Design goals:
 *
 * 1. **Deterministic where the world already has a key.** A parcel ID is a pure
 *    function of (county FIPS, APN); a legal entity ID is a pure function of
 *    (jurisdiction, registry file number); a document ID is a pure function of
 *    its bytes. Any agent can compute these offline, with no API call, and two
 *    agents will always agree. This is what makes FactLot IDs the default join key.
 * 2. **Registry-minted where it does not.** Buildings, leases, and loans have no
 *    universal public key, so the FactLot registry mints opaque, time-sortable
 *    tokens for them and maintains crosswalks (`same_as`) to other systems.
 * 3. **Two forms.** A readable canonical URN (`fl:parcel:us-06037:5432001012`)
 *    and a compact, URL-safe short ID (`flp_...`) derived from the URN by hash.
 *
 * See docs/id-spec.md for the normative specification.
 */
import { createHash, randomBytes } from "node:crypto";

export const ID_SPEC_VERSION = "0.1";

export type IdKind =
  "parcel" | "entity" | "building" | "space" | "lease" | "document" | "loan";

export const SHORT_PREFIX: Record<IdKind, string> = {
  parcel: "flp",
  entity: "fle",
  building: "flb",
  space: "fls",
  lease: "fll",
  document: "fld",
  loan: "fln",
};

const KINDS = Object.keys(SHORT_PREFIX) as IdKind[];
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
const SHORT_LEN = 24; // 120 bits of SHA-256

export class FactLotIdError extends Error {
  override name = "FactLotIdError";
}

export interface FactLotId {
  kind: IdKind;
  /** Canonical URN, lowercase. */
  urn: string;
  /** Compact form, `<prefix>_<24 crockford base32 chars>`. */
  short: string;
}

function base32(bytes: Uint8Array, length: number): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/** Compact short ID for a canonical URN. Stable: same URN, same short ID, forever. */
export function shortId(urn: string): string {
  const { kind } = parse(urn);
  const digest = createHash("sha256").update(urn, "utf8").digest();
  return `${SHORT_PREFIX[kind]}_${base32(digest, SHORT_LEN)}`;
}

function make(kind: IdKind, urn: string): FactLotId {
  return { kind, urn, short: shortId(urn) };
}

/** Lowercase alphanumerics only. */
function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Generic APN normalization: lowercase, strip every non-alphanumeric character.
 * Counties where separators are significant must pass a county-specific `normalize`.
 */
export function normalizeApn(apn: string): string {
  const n = alnum(apn);
  if (!n) throw new FactLotIdError(`APN "${apn}" is empty after normalization`);
  return n;
}

export interface ParcelInput {
  /** 2-digit state FIPS code, e.g. "06" for California. */
  stateFips: string;
  /** 3-digit county FIPS code, e.g. "037" for Los Angeles County. */
  countyFips: string;
  /** Assessor's parcel number as printed by the county. */
  apn: string;
  /** Override for counties whose APN formatting is semantically significant. */
  normalize?: (apn: string) => string;
}

/** Deterministic parcel ID: `fl:parcel:us-<SSCCC>:<apn>`. */
export function parcelId(input: ParcelInput): FactLotId {
  if (!/^\d{2}$/.test(input.stateFips))
    throw new FactLotIdError("stateFips must be 2 digits");
  if (!/^\d{3}$/.test(input.countyFips))
    throw new FactLotIdError("countyFips must be 3 digits");
  const apn = (input.normalize ?? normalizeApn)(input.apn);
  if (!/^[a-z0-9]+$/.test(apn)) {
    throw new FactLotIdError("normalized APN must be lowercase alphanumerics");
  }
  return make(
    "parcel",
    `fl:parcel:us-${input.stateFips}${input.countyFips}:${apn}`,
  );
}

export interface EntityInput {
  /**
   * Registry jurisdiction: ISO 3166-2 style, lowercase, e.g. "us-de", "us-ny".
   * For companies identified by LEI instead, use "lei".
   */
  jurisdiction: string;
  /** File/registration number issued by that registry (or the 20-char LEI). */
  registryNumber: string;
}

/** Deterministic legal-entity ID: `fl:entity:<jurisdiction>:<number>`. */
export function entityId(input: EntityInput): FactLotId {
  const j = input.jurisdiction.toLowerCase();
  if (!/^([a-z]{2}-[a-z0-9]{1,3}|lei)$/.test(j)) {
    throw new FactLotIdError(
      `jurisdiction "${input.jurisdiction}" must look like "us-de" or "lei"`,
    );
  }
  const n = alnum(input.registryNumber);
  if (!n)
    throw new FactLotIdError("registryNumber is empty after normalization");
  if (j === "lei" && n.length !== 20)
    throw new FactLotIdError("an LEI is 20 characters");
  return make("entity", `fl:entity:${j}:${n}`);
}

/** Content-addressed document ID: `fl:document:sha256-<hex>`. */
export function documentId(bytes: Uint8Array | string): FactLotId {
  const hex = createHash("sha256").update(bytes).digest("hex");
  return make("document", `fl:document:sha256-${hex}`);
}

/**
 * Normalize a suite/unit designator so "Suite 400", "STE. 400", and "#400" agree.
 * Whole floors normalize to `f<n>` ("3rd Floor", "Floor 3", "FL 3" -> "f3").
 */
export function normalizeSuite(suite: string): string {
  const s = suite.trim().toLowerCase();
  const floor =
    s.match(/^(\d+)(?:st|nd|rd|th)?\s*(?:floor|fl\.?)$/) ??
    s.match(/^(?:floor|fl\.?)\s*(\d+)$/);
  if (floor) return `f${Number(floor[1])}`;
  const stripped = s.replace(
    /^(?:suite|ste\.?|unit|space|spc\.?|room|rm\.?|no\.?|#)\s*/,
    "",
  );
  const n = alnum(stripped);
  if (!n)
    throw new FactLotIdError(`suite "${suite}" is empty after normalization`);
  return n;
}

/** Deterministic space ID within a registry-minted building: `fl:space:<building-token>:<suite>`. */
export function spaceId(
  building: string | FactLotId,
  suite: string,
): FactLotId {
  const b = parse(typeof building === "string" ? building : building.urn);
  if (b.kind !== "building")
    throw new FactLotIdError("spaceId requires a building ID");
  return make("space", `fl:space:${b.parts[0]}:${normalizeSuite(suite)}`);
}

/**
 * Mint an opaque, time-sortable token (ULID layout: 48-bit ms timestamp + 80 random bits)
 * for kinds with no natural key. In production these are minted by the FactLot registry;
 * self-hosted registries may mint their own.
 */
export function mint(
  kind: "building" | "lease" | "loan",
  now: number = Date.now(),
): FactLotId {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new FactLotIdError(
      "timestamp must be a non-negative 48-bit integer (ms)",
    );
  }
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) {
    time = CROCKFORD[t % 32] + time;
  }
  return make(kind, `fl:${kind}:${time}${base32(randomBytes(10), 16)}`);
}

export interface ParsedUrn {
  kind: IdKind;
  /** Colon-separated components after the kind. */
  parts: string[];
}

const URN_PATTERNS: Record<IdKind, RegExp> = {
  parcel: /^fl:parcel:(us-\d{5}):([a-z0-9]+)$/,
  entity: /^fl:entity:([a-z]{2}-[a-z0-9]{1,3}|lei):([a-z0-9]+)$/,
  building: /^fl:building:([0-9a-hjkmnp-tv-z]{26})$/,
  space: /^fl:space:([0-9a-hjkmnp-tv-z]{26}):([a-z0-9]+)$/,
  lease: /^fl:lease:([0-9a-hjkmnp-tv-z]{26})$/,
  loan: /^fl:loan:([0-9a-hjkmnp-tv-z]{26})$/,
  document: /^fl:document:(sha256-[a-f0-9]{64})$/,
};

/** Parse and validate a canonical URN. Throws FactLotIdError if invalid. */
export function parse(urn: string): ParsedUrn {
  const kind = urn.split(":")[1] as IdKind | undefined;
  if (!urn.startsWith("fl:") || !kind || !KINDS.includes(kind)) {
    throw new FactLotIdError(`"${urn}" is not a FactLot URN`);
  }
  const m = URN_PATTERNS[kind].exec(urn);
  if (!m) throw new FactLotIdError(`"${urn}" is not a valid ${kind} URN`);
  return { kind, parts: m.slice(1) };
}

export function isFactLotUrn(value: string): boolean {
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

/** Kind of a short ID, from its prefix (short IDs are not reversible to URNs offline). */
export function shortIdKind(short: string): IdKind {
  const m = /^(fl[a-z])_([0-9a-hjkmnp-tv-z]{24})$/.exec(short);
  const kind = m && KINDS.find((k) => SHORT_PREFIX[k] === m[1]);
  if (!kind) throw new FactLotIdError(`"${short}" is not a FactLot short ID`);
  return kind;
}
