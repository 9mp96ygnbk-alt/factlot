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
 * 2. **Registry-minted where it does not.** Leases and loans have no universal
 *    public key, so the FactLot registry mints opaque, time-sortable tokens for
 *    them and maintains crosswalks (`same_as`) to other systems. A building has a
 *    deterministic ID from its street address (county, ZIP code, street line);
 *    a minted building token stays valid for buildings with no street address.
 * 3. **Two forms.** A readable canonical URN (`fl:parcel:us-06037:5432001012`)
 *    and a compact, URL-safe short ID (`flp_...`) derived from the URN by hash.
 *
 * See docs/id-spec.md for the normative specification.
 */
import { createHash, randomBytes } from "node:crypto";

export const ID_SPEC_VERSION = "0.3";

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

/** The APN key of ID spec 0.1 and 0.2 (parcel rule 1): every character outside `a-z0-9` dropped. */
export function normalizeApnV1(apn: string): string {
  const n = alnum(apn);
  if (!n) throw new FactLotIdError(`APN "${apn}" is empty after normalization`);
  return n;
}

// --- parcel rule 2 (ID spec 0.3) ---------------------------------------------------------------
//
// A county whose APN format is documented gets a format below: each field is zero-padded to its
// fixed width and the fields are joined with no separator, so "5432-1-12", "5432 001 012" and
// "5432001012" are one AIN. Fixed widths are what make dropping the separators safe. Any other
// APN keeps a hyphen wherever it has a separator ("12-34" and "1-234" stay two parcels). Like the
// street tables, these formats are part of the ID rule and change only with a new spec version.

/** Separators between APN fields: any run of characters outside `a-z0-9`. */
const SEP = "[^a-z0-9]+";

interface ApnFormat {
  /** Matched against the lowercased APN with leading and trailing separators removed. */
  pattern: RegExp;
  /**
   * Width each captured field is zero-padded to (0: kept as written); the key is the fields run
   * together. Without widths the key is the match with its separators removed.
   */
  widths?: number[];
}

interface CountyApnRule {
  /** The county's own name for the key and its documented layout. */
  name: string;
  formats: ApnFormat[];
  /** Further check of the fields; returns an error message. */
  check?: (fields: string[]) => string | undefined;
}

/** NYC BBL: borough (1), block (5), lot (4), and an easement letter that makes a separate record. */
function nycBbl(borough: string, county: string): CountyApnRule {
  return {
    name: "New York City BBL: borough (1 digit), tax block (5), tax lot (4), optional easement letter",
    formats: [
      {
        pattern: new RegExp(
          `^([1-5])${SEP}([0-9]{1,5})${SEP}([0-9]{1,4})(?:${SEP})?([a-z]?)$`,
        ),
        widths: [1, 5, 4, 0],
      },
      {
        pattern: /^([1-5])([0-9]{5})([0-9]{4})([a-z]?)$/,
        widths: [1, 5, 4, 0],
      },
    ],
    check: ([b]) =>
      b === borough
        ? undefined
        : `a BBL in ${county} starts with borough ${borough}, not ${b ?? ""}`,
  };
}

/** Fixed-width digit fields, written with separators (fields may omit leading zeros) or run together. */
function digitFields(widths: number[]): ApnFormat[] {
  return [
    {
      pattern: new RegExp(
        `^${widths.map((w) => `([0-9]{1,${w}})`).join(SEP)}$`,
      ),
      widths,
    },
    {
      pattern: new RegExp(`^${widths.map((w) => `([0-9]{${w}})`).join("")}$`),
      widths,
    },
  ];
}

/** County APN formats by `<state FIPS><county FIPS>` (parcel rule 2). */
export const COUNTY_APN_RULES: Readonly<Record<string, CountyApnRule>> = {
  "06037": {
    name: "Los Angeles County AIN: map book (4 digits), page (3), parcel (3)",
    formats: digitFields([4, 3, 3]),
  },
  "11001": {
    name: "District of Columbia SSL: square (4 digits) and suffix (up to 4 letters), lot (4 digits), in fixed-width fields padded with spaces; PAR and 8 digits for a parcel outside a square",
    formats: [
      {
        pattern: new RegExp(
          `^([0-9]{4})(?:${SEP})?([a-z]{0,4})${SEP}([0-9]{1,4})$`,
        ),
        widths: [4, 0, 4],
      },
      { pattern: new RegExp(`^(par)${SEP}([0-9]{8})$`), widths: [0, 8] },
      // Any other SSL as the roll writes it: fixed-width fields padded with spaces.
      { pattern: /^[a-z0-9]+(?: +[a-z0-9]+)*$/ },
    ],
  },
  "17031": {
    name: "Cook County PIN: area (2 digits), subarea (2), block (3), parcel (3), unit (4)",
    formats: digitFields([2, 2, 3, 3, 4]),
  },
  "36005": nycBbl("2", "the Bronx (36005)"),
  "36047": nycBbl("3", "Brooklyn (36047)"),
  "36061": nycBbl("1", "Manhattan (36061)"),
  "36081": nycBbl("4", "Queens (36081)"),
  "36085": nycBbl("5", "Staten Island (36085)"),
};

/**
 * APN key (parcel rule 2, ID spec 0.3). Lowercase; leading and trailing separators are dropped.
 * In a county with a documented format (`COUNTY_APN_RULES`, keyed by the 5-digit state and
 * county FIPS) an APN in that format becomes its fields zero-padded and run together; every other
 * APN keeps one hyphen for each run of separators, so APNs that differ only in where a separator
 * falls ("12-34", "1-234") never share an ID.
 */
export function normalizeApn(apn: string, county?: string): string {
  const core = apn
    .toLowerCase()
    .replace(new RegExp(`^${SEP}|${SEP}$`, "g"), "");
  if (!core)
    throw new FactLotIdError(`APN "${apn}" is empty after normalization`);
  const rule = county === undefined ? undefined : COUNTY_APN_RULES[county];
  for (const format of rule?.formats ?? []) {
    const m = format.pattern.exec(core);
    if (!m) continue;
    const widths = format.widths;
    if (!widths) return alnum(core);
    const fields = m.slice(1).map((f) => f ?? "");
    const problem = rule?.check?.(fields);
    if (problem)
      throw new FactLotIdError(
        `APN "${apn}" is not a valid ${rule?.name}: ${problem}`,
      );
    return fields.map((f, i) => f.padStart(widths[i] ?? 0, "0")).join("");
  }
  return core.replace(new RegExp(SEP, "g"), "-");
}

export interface ParcelInput {
  /** 2-digit state FIPS code, e.g. "06" for California. */
  stateFips: string;
  /** 3-digit county FIPS code, e.g. "037" for Los Angeles County. */
  countyFips: string;
  /** Assessor's parcel number as printed by the county. */
  apn: string;
  /**
   * Override of the APN rule, e.g. `normalizeApnV1` to recompute an ID made under ID spec 0.1 or
   * 0.2. It must return lowercase alphanumerics, with single hyphens between them.
   */
  normalize?: (apn: string) => string;
}

function checkFips(stateFips: string, countyFips: string): void {
  if (!/^\d{2}$/.test(stateFips))
    throw new FactLotIdError("stateFips must be 2 digits");
  if (!/^\d{3}$/.test(countyFips))
    throw new FactLotIdError("countyFips must be 3 digits");
}

/** Deterministic parcel ID: `fl:parcel:us-<SSCCC>:<apn>`. */
export function parcelId(input: ParcelInput): FactLotId {
  checkFips(input.stateFips, input.countyFips);
  const apn = input.normalize
    ? input.normalize(input.apn)
    : normalizeApn(input.apn, `${input.stateFips}${input.countyFips}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(apn)) {
    throw new FactLotIdError(
      "normalized APN must be lowercase alphanumerics, with single hyphens between them",
    );
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
  /** File/registration number issued by that registry (or the 20-character LEI, check digits verified). */
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
  if (j === "lei") checkLei(n, input.registryNumber);
  return make("entity", `fl:entity:${j}:${n}`);
}

/**
 * ISO 17442 LEI: 18 alphanumerics and 2 check digits, valid when the whole code read as a number
 * (letters A = 10 … Z = 35) is 1 modulo 97 (ISO 7064 MOD 97-10, as for an IBAN).
 */
function checkLei(n: string, given: string): void {
  if (n.length !== 20)
    throw new FactLotIdError(
      `"${given}" is not an LEI: an LEI is 20 characters (ISO 17442), got ${n.length}`,
    );
  if (!/^[0-9]{2}$/.test(n.slice(18)))
    throw new FactLotIdError(
      `"${given}" is not an LEI: its last two characters are check digits (ISO 17442)`,
    );
  let rem = 0;
  for (const c of n) {
    const v = parseInt(c, 36);
    rem = (v < 10 ? rem * 10 + v : rem * 100 + v) % 97;
  }
  if (rem !== 1)
    throw new FactLotIdError(
      `"${given}" is not a valid LEI: its check digits do not match (ISO 17442, ISO 7064 MOD 97-10); check for a mistyped character`,
    );
}

/** Content-addressed document ID: `fl:document:sha256-<hex>`. */
export function documentId(bytes: Uint8Array | string): FactLotId {
  const hex = createHash("sha256").update(bytes).digest("hex");
  return make("document", `fl:document:sha256-${hex}`);
}

// Ordinal words for whole floors ("Third Floor" is "3rd Floor").
const ORDINAL_WORDS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
];
const FLOOR_WORD = "(?:floor|flr\\.?|fl\\.?)";
const FLOOR_PATTERNS = [
  new RegExp(`^(\\d+)(?:st|nd|rd|th)?\\s*${FLOOR_WORD}$`),
  new RegExp(`^${FLOOR_WORD}\\s*(\\d+)$`),
];
const ORDINAL_FLOOR = new RegExp(
  `^(${ORDINAL_WORDS.join("|")})\\s*${FLOOR_WORD}$`,
);
const SUITE_DESIGNATOR =
  /^(?:suite|ste\.?|unit|apartment|apt\.?|space|spc\.?|room|rm\.?|no\.?|#)\s*/;

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

/**
 * Normalize a suite/unit designator so "Suite 400", "STE. 400", and "#400" agree (suite rule 2,
 * ID spec 0.2). Whole floors normalize to `f<n>` ("3rd Floor", "Third Floor", "Floor 3", "FL 3",
 * "3rd Flr" -> "f3"). A separator between two digits is kept as one hyphen, so "1-20" and "120"
 * stay distinct; every other separator is dropped ("1200-A" -> "1200a"). Leading zeros are kept
 * ("0100" and "100" are different suites).
 */
export function normalizeSuite(suite: string): string {
  const s = suite.trim().toLowerCase();
  for (const pattern of FLOOR_PATTERNS) {
    const floor = pattern.exec(s);
    if (floor) return `f${Number(floor[1])}`;
  }
  const ordinal = ORDINAL_FLOOR.exec(s);
  if (ordinal) return `f${ORDINAL_WORDS.indexOf(ordinal[1] ?? "") + 1}`;
  const n = s
    .replace(SUITE_DESIGNATOR, "")
    .replace(/[^a-z0-9]+/g, (sep: string, at: number, all: string) =>
      isDigit(all[at - 1]) && isDigit(all[at + sep.length]) ? "-" : "",
    );
  if (!n)
    throw new FactLotIdError(`suite "${suite}" is empty after normalization`);
  return n;
}

/** The suite key of ID spec 0.1 (suite rule 1), kept so earlier space IDs can be recomputed. */
export function normalizeSuiteV1(suite: string): string {
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

// --- street addresses (building IDs, ID spec 0.2) ---------------------------------------------
//
// These tables are part of the ID rule: changing them changes building IDs, so they change only
// with a new ID spec version. The registry's address search uses the same tokens.

/** Directionals, spelled out or abbreviated, to their one- or two-letter form. */
const DIRECTIONAL: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

/** Street types and ordinal street names, spelled out, to the short form rolls use. */
const STREET_WORD: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  AV: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  BOULEVARD: "BLVD",
  LANE: "LN",
  PARKWAY: "PKWY",
  HIGHWAY: "HWY",
  FREEWAY: "FWY",
  EXPRESSWAY: "EXPY",
  COURT: "CT",
  PLACE: "PL",
  CIRCLE: "CIR",
  TRAIL: "TRL",
  TERRACE: "TER",
  SQUARE: "SQ",
  PLAZA: "PLZ",
  ALLEY: "ALY",
  BUILDING: "BLDG",
  ...Object.fromEntries(
    ORDINAL_WORDS.map((w, i) => [w.toUpperCase(), ordinal(i + 1)]),
  ),
};

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`.toUpperCase();
}

// Unit designators: the designator and the one token after it are not part of the street address.
// A floor word counts only before a one- or two-digit floor number or after an ordinal ("FL" is
// also Florida's postal code, before a ZIP code); "RM" is left out because Texas writes
// Ranch-to-Market roads "RM 620".
const UNIT_WORDS = new Set([
  "#",
  "STE",
  "SUITE",
  "UNIT",
  "APT",
  "APARTMENT",
  "ROOM",
  "SPC",
]);
const FLOOR_WORDS = new Set(["FL", "FLR", "FLOOR"]);
const ORDINAL_NUMBER = /^\d{1,3}(?:ST|ND|RD|TH)$/;

/**
 * The comparable tokens of a street address: upper case; a unit, suite, apartment, "#" or floor
 * designator is removed with its value; punctuation becomes a space; directionals are one or two
 * letters wherever they stand ("Northwest", "North West", "N.W." -> "NW"); street types and
 * ordinal street names are abbreviated ("Avenue" -> "AVE", "Fifth" -> "5TH").
 */
export function addressTokens(address: string): string[] {
  const raw = address
    .toUpperCase()
    .replaceAll("#", " # ")
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = (raw[i] ?? "").replace(/\.$/, "");
    const next = (raw[i + 1] ?? "").replace(/[.,]$/, "");
    if (UNIT_WORDS.has(t)) {
      while (raw[i + 1] === "#") i++;
      i++; // the unit's value
      continue;
    }
    if (
      (FLOOR_WORDS.has(t) && /^\d{1,2}$/.test(next)) ||
      (ORDINAL_NUMBER.test(t) && FLOOR_WORDS.has(next))
    ) {
      i++;
      continue;
    }
    kept.push(raw[i] ?? "");
  }
  const words = kept
    .join(" ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => DIRECTIONAL[w] ?? STREET_WORD[w] ?? w);
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if ((prev === "N" || prev === "S") && (w === "E" || w === "W"))
      out[out.length - 1] = prev + w;
    else out.push(w);
  }
  return out;
}

const STATE_AND_ZIP = /(?:^|-)[a-z]{2}-\d{5}(?:-\d{4})?$/;

/**
 * Street key of a building ID: the street line (anything from the first comma on is ignored),
 * normalized by `addressTokens`, lower case, words joined by hyphens:
 * "208 Massachusetts Avenue Northeast, Suite 2" -> "208-massachusetts-ave-ne".
 */
export function normalizeStreet(street: string): string {
  const line = street.split(",")[0] ?? "";
  const key = addressTokens(line).join("-").toLowerCase();
  if (!/^[0-9][a-z0-9]*-[a-z0-9]/.test(key)) {
    throw new FactLotIdError(
      `street "${street}" must start with a house number followed by a street name`,
    );
  }
  if (STATE_AND_ZIP.test(key)) {
    throw new FactLotIdError(
      `street "${street}" seems to include a state and ZIP code: pass the street line only, or put a comma before the city`,
    );
  }
  return key;
}

export interface BuildingInput {
  /** 2-digit state FIPS code, e.g. "11" for the District of Columbia. */
  stateFips: string;
  /** 3-digit county FIPS code, e.g. "001". */
  countyFips: string;
  /** 5-digit ZIP code of the street address (ZIP+4 is accepted; only the first five digits count). */
  zip: string;
  /** Street line: house number and street, e.g. "208 Massachusetts Ave NE". A unit is ignored. */
  street: string;
}

/**
 * Deterministic building ID from a street address: `fl:building:us-<SSCCC>:<zip5>:<street key>`.
 * Every party with the same address computes the same ID offline; units of one condominium share it.
 */
export function buildingId(input: BuildingInput): FactLotId {
  checkFips(input.stateFips, input.countyFips);
  const zip = /^\s*([0-9]{5})(?:-?[0-9]{4})?\s*$/.exec(input.zip);
  if (!zip)
    throw new FactLotIdError("zip must be a 5-digit ZIP code (or ZIP+4)");
  return make(
    "building",
    `fl:building:us-${input.stateFips}${input.countyFips}:${zip[1]}:${normalizeStreet(input.street)}`,
  );
}

/**
 * Deterministic space ID within a building: `fl:space:<building>:<suite>`, where `<building>` is
 * what follows `fl:building:` in the building URN (an address key or a minted token).
 */
export function spaceId(
  building: string | FactLotId,
  suite: string,
): FactLotId {
  const urn = typeof building === "string" ? building : building.urn;
  const b = parse(urn);
  if (b.kind !== "building")
    throw new FactLotIdError("spaceId requires a building ID");
  return make(
    "space",
    `fl:space:${urn.slice("fl:building:".length)}:${normalizeSuite(suite)}`,
  );
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
  /**
   * Colon-separated components after the kind. A minted building is `[token]`, an address
   * building `[region, zip, street]`; a space is its building's parts followed by the suite.
   */
  parts: string[];
}

const TOKEN = "[0-9a-hjkmnp-tv-z]{26}";
// An address building: region, ZIP code, street key (house number first, words joined by hyphens).
const ADDRESS_BUILDING = "(us-\\d{5}):(\\d{5}):([0-9][a-z0-9]*(?:-[a-z0-9]+)+)";
const SUITE = "([a-z0-9]+(?:-[a-z0-9]+)*)";
const URN_PATTERNS: Record<IdKind, RegExp> = {
  parcel: /^fl:parcel:(us-\d{5}):([a-z0-9]+(?:-[a-z0-9]+)*)$/,
  entity: /^fl:entity:([a-z]{2}-[a-z0-9]{1,3}|lei):([a-z0-9]+)$/,
  building: new RegExp(`^fl:building:(?:(${TOKEN})|${ADDRESS_BUILDING})$`),
  space: new RegExp(`^fl:space:(?:(${TOKEN})|${ADDRESS_BUILDING}):${SUITE}$`),
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
  return {
    kind,
    parts: m.slice(1).filter((p): p is string => p !== undefined),
  };
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
