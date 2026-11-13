/**
 * Watch lists: the compact fingerprint of a registry record and the comparison of two of them.
 *
 * A fingerprint keeps, for each aspect a caller can watch, just enough to tell that it changed
 * and to say what changed:
 *
 *   value          the newest roll year's market and appraised values (numbers), with citations
 *   owner          the owner-of-record values and the entity URNs that own the subject
 *   documents      one short hash per recorded sale, deed, mortgage, satisfaction or CMBS loan
 *                  fact (of its predicate and value), with its date and amount only
 *   entity_status  the entity.status value
 *   other          one short hash per remaining predicate and relationship type
 *
 * Values are compared, not fact ids: a fact restated by a newer file of the same source gets a
 * new id but is not a change. Recorded-document values can carry party names, so only a keyed hash
 * of each is kept (HMAC-SHA-256 under a key derived from a server secret, so the hashes cannot be
 * matched against guessed values), with its date and amount. Each fingerprint names its key
 * (`dk`): after the secret changes, the first comparison re-baselines the documents instead of
 * reporting them all as changed. A record that is gone (a retired parcel, a withheld
 * county) or no longer in the latest snapshot is reported as a change of aspect `record`, whatever
 * the caller watches.
 */

export const ASPECTS = [
  "value",
  "owner",
  "documents",
  "entity_status",
  "other",
] as const;
export type Aspect = (typeof ASPECTS)[number];
/** Aspects of a change record: the watched ones, and `record` (gone or not in the latest snapshot). */
export type ChangeAspect = Aspect | "record";

/** Recorded-document predicates (one fact per instrument). */
export const DOCUMENT_PREDICATES: ReadonlySet<string> = new Set([
  "transaction.sale",
  "transaction.deed",
  "debt.mortgage_recorded",
  "debt.mortgage_satisfaction_recorded",
  "debt.cmbs_loan",
]);
const VALUE_PREDICATES = new Set([
  "parcel.market_value",
  "parcel.appraised_value",
  "parcel.tax_year",
]);
const OWNER_PREDICATE = "ownership.owner_of_record";
const STATUS_PREDICATE = "entity.status";
/** Recorded documents kept per subject (newest first); more are counted. */
export const MAX_DOCUMENTS = 200;
/** Recorded documents listed in one change record. */
const MAX_DOCUMENTS_LISTED = 20;

type Json = Record<string, unknown>;

export interface Citation {
  fact_id: string | null;
  document_id: string | null;
  as_of: string | null;
  title?: string;
  uri?: string;
}

export interface DocumentMark {
  /** 16 hex characters of SHA-256 over the predicate and the value. */
  h: string;
  predicate: string;
  date: string | null;
  amount_usd: number | null;
  fact_id: string | null;
}

export interface Print {
  v: 1;
  kind: string;
  /** The record's status (current, not_in_latest_snapshot), or "missing". */
  status: string;
  value: {
    tax_year: number | null;
    market_value: number | null;
    appraised_value: number | null;
    citation: Citation | null;
  } | null;
  owner: {
    names: string[];
    entities: string[];
    citation: Citation | null;
  } | null;
  documents: { count: number; items: DocumentMark[] };
  /** Which key hashed the documents ("sha256" without a secret). */
  dk: string;
  entity_status: { value: string | null; citation: Citation | null } | null;
  /** predicate (or `rel:<type>`) to 16 hex characters. */
  other: Record<string, string>;
  /** The newest as_of among the record's facts. */
  newest_as_of: string | null;
}

export interface ChangeBody {
  aspect: ChangeAspect;
  summary: string;
  old: unknown;
  new: unknown;
  citation?: Citation | Citation[] | null;
}

const hex16 = (d: ArrayBuffer) =>
  [...new Uint8Array(d).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const docKeys = new Map<string, Promise<{ key: HmacKey; id: string }>>();

/** The documents' HMAC key, derived from `secret`, and its id. */
function docKey(secret: string): Promise<{ key: HmacKey; id: string }> {
  let k = docKeys.get(secret);
  if (!k) {
    k = (async () => {
      const root = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const raw = await crypto.subtle.sign(
        "HMAC",
        root,
        new TextEncoder().encode("factlot-watch-documents"),
      );
      const key = await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const id = hex16(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("id")),
      );
      return { key, id };
    })();
    docKeys.set(secret, k);
  }
  return k;
}

async function hash16(text: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(d).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** JSON with sorted keys, so equal values hash equally. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Json)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Json)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function factCitation(f: Json): Citation {
  const src = (
    (f.provenance as Json | undefined)?.sources as Json[] | undefined
  )?.[0];
  return {
    fact_id: str(f.id),
    document_id: str(src?.document_id),
    as_of: str(f.as_of),
    ...(str(src?.title) ? { title: str(src?.title)! } : {}),
    ...(str(src?.uri) ? { uri: str(src?.uri)! } : {}),
  };
}

function ownerName(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 200);
  if (v && typeof v === "object") {
    const n = (v as Json).name ?? (v as Json).legal_name;
    if (typeof n === "string") return n.slice(0, 200);
  }
  return canonical(v).slice(0, 200);
}

/** The fingerprint of a registry_get answer (the record as a Pro or Team caller sees it). */
export async function fingerprint(
  record: Json,
  /** The server secret the documents' key is derived from (RECOVERY_SIGNING_SECRET). */
  secret?: string,
): Promise<Print> {
  const dkey = secret ? await docKey(secret) : undefined;
  const docHash = async (text: string) =>
    dkey
      ? hex16(
          await crypto.subtle.sign(
            "HMAC",
            dkey.key,
            new TextEncoder().encode(text),
          ),
        )
      : hash16(text);
  const urn = str(record.urn) ?? "";
  const kind = str(record.kind) ?? "";
  const facts = (Array.isArray(record.facts) ? record.facts : []) as Json[];
  const rels = (
    Array.isArray(record.relationships) ? record.relationships : []
  ) as Json[];
  const history = (
    Array.isArray(record.value_history) ? record.value_history : []
  ) as Json[];

  let value: Print["value"] = null;
  if (kind === "parcel") {
    const newest = history[0];
    const cites = (newest?.citations ?? {}) as Json;
    const c = (cites.market_value ?? cites.appraised_value) as Json | null;
    value = newest
      ? {
          tax_year: num(newest.tax_year),
          market_value: num(newest.market_value),
          appraised_value: num(newest.appraised_value),
          citation: c
            ? {
                fact_id: str(c.fact_id),
                document_id: str(c.document_id),
                as_of: str(c.as_of),
              }
            : null,
        }
      : {
          tax_year: null,
          market_value: null,
          appraised_value: null,
          citation: null,
        };
  }

  let owner: Print["owner"] = null;
  if (kind !== "entity") {
    const ownerFacts = facts.filter((f) => f.predicate === OWNER_PREDICATE);
    owner = {
      names: [...new Set(ownerFacts.map((f) => ownerName(f.value)))].sort(),
      entities: [
        ...new Set(
          rels
            .filter((r) => r.type === "owns" && r.to_urn === urn)
            .map((r) => String(r.from_urn)),
        ),
      ].sort(),
      citation: ownerFacts[0] ? factCitation(ownerFacts[0]) : null,
    };
  }

  const docs: DocumentMark[] = [];
  for (const f of facts) {
    const predicate = String(f.predicate);
    if (!DOCUMENT_PREDICATES.has(predicate)) continue;
    const v = (f.value ?? {}) as Json;
    docs.push({
      h: await docHash(`${predicate}|${canonical(f.value)}`),
      predicate,
      date: str(v.date) ?? str(v.reporting_period_end) ?? str(f.as_of),
      amount_usd:
        num(v.price_usd) ??
        num(v.amount_usd) ??
        num(v.original_amount_usd) ??
        num(v.current_balance_usd),
      fact_id: str(f.id),
    });
  }
  docs.sort((a, b) =>
    (b.date ?? "") === (a.date ?? "")
      ? a.h.localeCompare(b.h)
      : (b.date ?? "").localeCompare(a.date ?? ""),
  );
  const uniqueDocs = docs.filter(
    (d, i) => docs.findIndex((x) => x.h === d.h) === i,
  );

  let entity_status: Print["entity_status"] = null;
  if (kind === "entity") {
    const f = facts.find((x) => x.predicate === STATUS_PREDICATE);
    entity_status = {
      value: f ? ownerName(f.value) : null,
      citation: f ? factCitation(f) : null,
    };
  }

  const groups = new Map<string, string[]>();
  for (const f of facts) {
    const p = String(f.predicate);
    if (
      DOCUMENT_PREDICATES.has(p) ||
      VALUE_PREDICATES.has(p) ||
      p === OWNER_PREDICATE ||
      p === STATUS_PREDICATE
    )
      continue;
    groups.set(p, [...(groups.get(p) ?? []), canonical(f.value)]);
  }
  for (const r of rels) {
    if (r.type === "owns" && r.to_urn === urn) continue;
    const k = `rel:${String(r.type)}`;
    groups.set(k, [
      ...(groups.get(k) ?? []),
      `${String(r.from_urn)}>${String(r.to_urn)}`,
    ]);
  }
  const other: Record<string, string> = {};
  for (const [k, vals] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    other[k] = await hash16(vals.sort().join("\n"));

  const dates = facts.map((f) => str(f.as_of)).filter((d): d is string => !!d);
  return {
    v: 1,
    kind,
    status: str(record.status) ?? "current",
    value,
    owner,
    documents: {
      count: uniqueDocs.length,
      items: uniqueDocs.slice(0, MAX_DOCUMENTS),
    },
    dk: dkey ? dkey.id : "sha256",
    entity_status,
    other,
    newest_as_of: dates.length ? dates.sort().at(-1)! : null,
  };
}

/** A registry miss: what a fingerprint becomes when the record is gone. */
export interface Missing {
  missing: true;
  message: string;
}

const money = (n: number | null) =>
  n === null ? "none" : `$${n.toLocaleString("en-US")}`;

/**
 * The changes from `old` to `cur` in the `aspects` watched (a gone record, or one no longer in the
 * latest snapshot, is always reported). An empty list when nothing watched changed.
 */
export function compare(
  old: Print,
  cur: Print | Missing,
  aspects: ReadonlySet<Aspect>,
): ChangeBody[] {
  if ("missing" in cur) {
    if (old.status === "missing") return [];
    return [
      {
        aspect: "record",
        summary: `the record is no longer in the registry: ${cur.message}`,
        old: { status: old.status },
        new: { status: "missing", reason: cur.message },
      },
    ];
  }
  const out: ChangeBody[] = [];
  if (old.status !== cur.status)
    out.push({
      aspect: "record",
      summary:
        old.status === "missing"
          ? "the record is back in the registry"
          : `the record's status changed from ${old.status} to ${cur.status}`,
      old: { status: old.status },
      new: { status: cur.status },
    });

  if (aspects.has("value") && old.value && cur.value) {
    const a = old.value;
    const b = cur.value;
    if (
      a.tax_year !== b.tax_year ||
      a.market_value !== b.market_value ||
      a.appraised_value !== b.appraised_value
    ) {
      const year = b.tax_year === null ? "" : `${b.tax_year} `;
      out.push({
        aspect: "value",
        summary:
          a.tax_year !== b.tax_year
            ? `new roll year: ${year}market value ${money(b.market_value)}, appraised ${money(b.appraised_value)} (was ${a.tax_year ?? "none"}: ${money(a.market_value)}, ${money(a.appraised_value)})`
            : `${year}values changed: market value ${money(a.market_value)} to ${money(b.market_value)}, appraised ${money(a.appraised_value)} to ${money(b.appraised_value)}`,
        old: {
          tax_year: a.tax_year,
          market_value: a.market_value,
          appraised_value: a.appraised_value,
        },
        new: {
          tax_year: b.tax_year,
          market_value: b.market_value,
          appraised_value: b.appraised_value,
        },
        citation: b.citation,
      });
    }
  }

  if (aspects.has("owner") && old.owner && cur.owner) {
    const same = (x: string[], y: string[]) =>
      x.length === y.length && x.every((v, i) => v === y[i]);
    if (
      !same(old.owner.names, cur.owner.names) ||
      !same(old.owner.entities, cur.owner.entities)
    )
      out.push({
        aspect: "owner",
        summary:
          cur.owner.names.length === 0 && cur.owner.entities.length === 0
            ? "the owner of record is no longer published for this record"
            : `owner of record changed to ${cur.owner.names.join("; ") || cur.owner.entities.join("; ")}`,
        old: { names: old.owner.names, entities: old.owner.entities },
        new: { names: cur.owner.names, entities: cur.owner.entities },
        citation: cur.owner.citation,
      });
  }

  // Documents hashed under another key cannot be compared: the new ones become the baseline.
  if (aspects.has("documents") && old.dk === cur.dk) {
    const before = new Set(old.documents.items.map((d) => d.h));
    const after = new Set(cur.documents.items.map((d) => d.h));
    const added = cur.documents.items.filter((d) => !before.has(d.h));
    const removed = old.documents.items.filter((d) => !after.has(d.h));
    // Beyond MAX_DOCUMENTS only the count is compared.
    if (
      added.length ||
      removed.length ||
      old.documents.count !== cur.documents.count
    ) {
      const list = (ds: DocumentMark[]) =>
        ds.slice(0, MAX_DOCUMENTS_LISTED).map((d) => ({
          predicate: d.predicate,
          date: d.date,
          amount_usd: d.amount_usd,
          fact_id: d.fact_id,
        }));
      const words = added
        .slice(0, 3)
        .map(
          (d) =>
            `${d.predicate.split(".")[1]!.replaceAll("_", " ")}${d.date ? ` dated ${d.date}` : ""}${d.amount_usd !== null ? ` (${money(d.amount_usd)})` : ""}`,
        );
      out.push({
        aspect: "documents",
        summary: added.length
          ? `${added.length} new recorded document${added.length === 1 ? "" : "s"}: ${words.join("; ")}${added.length > 3 ? "; ..." : ""}`
          : `recorded documents changed: ${old.documents.count} before, ${cur.documents.count} now`,
        old: { count: old.documents.count },
        new: {
          count: cur.documents.count,
          added: list(added),
          removed: removed.length,
        },
        citation: added.slice(0, MAX_DOCUMENTS_LISTED).map((d) => ({
          fact_id: d.fact_id,
          document_id: null,
          as_of: d.date,
        })),
      });
    }
  }

  if (
    aspects.has("entity_status") &&
    old.entity_status &&
    cur.entity_status &&
    old.entity_status.value !== cur.entity_status.value
  )
    out.push({
      aspect: "entity_status",
      summary: `entity status changed from ${old.entity_status.value ?? "none"} to ${cur.entity_status.value ?? "none"}`,
      old: { status: old.entity_status.value },
      new: { status: cur.entity_status.value },
      citation: cur.entity_status.citation,
    });

  if (aspects.has("other")) {
    const keys = new Set([
      ...Object.keys(old.other),
      ...Object.keys(cur.other),
    ]);
    const changed = [...keys]
      .filter((k) => old.other[k] !== cur.other[k])
      .sort();
    if (changed.length)
      out.push({
        aspect: "other",
        summary: `other facts changed: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ", ..." : ""}`,
        old: { newest_as_of: old.newest_as_of },
        new: { newest_as_of: cur.newest_as_of, changed },
      });
  }
  return out;
}

/** Parse an aspects argument: undefined or ["any"] is every aspect. */
export function parseAspects(v: unknown): Aspect[] | string {
  if (v === undefined || v === null) return [...ASPECTS];
  if (!Array.isArray(v) || v.length === 0 || v.length > 6)
    return `aspects must be a list of: any, ${ASPECTS.join(", ")}`;
  const out = new Set<Aspect>();
  for (const a of v) {
    if (a === "any") return [...ASPECTS];
    if (!(ASPECTS as readonly unknown[]).includes(a))
      return `unknown aspect ${JSON.stringify(a)}; use any, ${ASPECTS.join(", ")}`;
    out.add(a as Aspect);
  }
  return ASPECTS.filter((a) => out.has(a));
}
