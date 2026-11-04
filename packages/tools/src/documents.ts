/**
 * Document verification tools: the caller's agent reads a document and proposes values with
 * quotes; FactLot checks each one deterministically against the page text and returns cited
 * FactLot facts. FactLot runs no model here. python/src/factlot/docverify.py is the same code
 * in Python, and spec/vectors/documents.json pins both.
 */
import { createHash } from "node:crypto";

import { documentId } from "@factlot/id";
import { Fact, FactLotIdString, IsoDate } from "@factlot/schema";
import { z } from "zod";

import { suggest } from "./limits.ts";
import {
  PREDICATES,
  PREDICATE_PATTERN,
  PageText,
  checkAnyValue,
  checkConsistency,
  checkValue,
  dateRanges,
  datesIn,
  hasConsistencyRule,
  isIngestPredicate,
  isPlainObject,
  locateQuote,
  missing,
  norm,
  numbersIn,
  showValue,
  textNumberMissing,
  valueParts,
} from "./quotes.ts";
import type { Kind } from "./quotes.ts";

/** Thrown by a tool for input that passed its schema but cannot be used; runTool reports InputError. */
export class ToolInputError extends Error {
  override name = "ToolInputError";
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super(
      `invalid input: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`,
    );
    this.issues = issues;
  }
}

/**
 * Size caps for document tools. The hosted API also caps a request body at 1 MiB, which binds
 * first there; these keep a local call bounded too. Characters are UTF-16 code units in
 * TypeScript and code points in Python, as in INPUT_LIMITS.
 */
export const DOC_LIMITS = {
  pagesPerDocument: 2_000,
  charactersPerPage: 100_000,
  charactersPerCall: 2_000_000,
  candidatesPerDocument: 500,
  candidatesPerCall: 2_000,
  documentsPerAbstract: 50,
  quoteCharacters: 5_000,
  factsPerCall: 2_000,
  assertedPerCall: 500,
} as const;

/** Extractor confidence below this goes to needs_review (the Ingest review threshold). */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

// --- inputs -------------------------------------------------------------------------------------

const Pages = z
  .array(
    z
      .string()
      .max(DOC_LIMITS.charactersPerPage)
      .describe("The text of one page, exactly as extracted."),
  )
  .min(1)
  .max(DOC_LIMITS.pagesPerDocument)
  .describe(
    "The document's text, one string per page in order: pages[0] is page 1. Send the text as extracted (from the PDF text layer or OCR), not a summary; quotes are matched against it.",
  );
const Sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "expected 64 lowercase hex characters")
  .describe(
    "Optional SHA-256 (lowercase hex) of the original file. When given, document_id is fl:document:sha256-<this>, the same ID id_document gives the file; FactLot cannot check that the pages came from that file. Without it, document_id is the SHA-256 of the pages joined by form feeds (\\f).",
  );
const Title = z
  .string()
  .max(500)
  .describe('Document title for citations, e.g. "First Amendment to Lease".');
const OcrPages = z
  .array(z.number().int().min(1).max(100_000))
  .max(DOC_LIMITS.pagesPerDocument)
  .describe(
    "Optional: pages (1-based) whose text came from OCR rather than the file's text layer (doc_read_pdf and factlot.read_pdf report them). Facts and citations on these pages carry ocr: true, so a reviewer checks the scan.",
  );
export const DocumentInput = z.object({
  pages: Pages,
  sha256: Sha256.optional(),
  title: Title.optional(),
  ocr_pages: OcrPages.optional(),
});
const Candidate = z.object({
  predicate: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Dotted lower_snake predicate. Use an Ingest predicate (lease.expiration_date, lease.base_rent_schedule, ...) for its value-shape and quote rules; any other predicate gets the generic rules.",
    ),
  value: z
    .unknown()
    .describe(
      'The value you read, in the predicate\'s shape: dates YYYY-MM-DD, money and areas as plain numbers (1250000, not "$1.25M"), shares and rates as decimals (0.03 for 3%).',
    ),
  quote: z
    .string()
    .max(DOC_LIMITS.quoteCharacters)
    .describe(
      "Verbatim text from the page that states the value, at least 12 characters. Copy it exactly; only whitespace, line breaks, letter case and typographic quotes and dashes may differ.",
    ),
  page: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .describe("1-based page the quote is on."),
  section: z
    .string()
    .max(200)
    .optional()
    .describe('Section or clause as written, e.g. "§4.2(b)".'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Your confidence 0–1. Below 0.8 the candidate goes to needs_review even if it verifies.",
    ),
});
type CandidateIn = z.output<typeof Candidate>;
const Candidates = z
  .array(Candidate)
  .max(DOC_LIMITS.candidatesPerDocument)
  .describe("Values you extracted, each with its quote and page.");
const AsOf = IsoDate.describe(
  "Date the facts are stated as of (YYYY-MM-DD), usually today.",
);
const Subject = FactLotIdString.max(500).describe(
  "FactLot URN the facts are about, e.g. your lease's fl:lease:… ID. Default: the document ID.",
);
const FactObject = z
  .record(z.string(), z.unknown())
  .describe("A FactLot fact, as doc_verify_facts returned it.");

export const VerifyFactsInput = z.object({
  document: DocumentInput.describe(
    "The document the candidates were read from.",
  ),
  candidates: Candidates.min(1),
  as_of: AsOf,
  subject: Subject.optional(),
});

const AbstractDocument = z.object({
  role: z
    .enum(["original", "amendment"])
    .optional()
    .describe(
      'Default: "original" for the first document, "amendment" for the rest.',
    ),
  effective_date: IsoDate.optional().describe(
    "Amendment effective date (YYYY-MM-DD). Amendments apply in date order when every amendment has one, otherwise in the order given. Becomes valid_from on its facts.",
  ),
  title: Title.optional(),
  sha256: Sha256.optional(),
  pages: Pages.optional(),
  ocr_pages: OcrPages.optional(),
  candidates: Candidates.optional(),
  facts: z
    .array(FactObject)
    .max(DOC_LIMITS.candidatesPerDocument)
    .optional()
    .describe(
      "Facts doc_verify_facts already returned for this document. With pages, each is checked again; without pages (to stay under the request size limit), only its value against its quote is checked and the abstract marks it quote_on_page: false.",
    ),
});

export const AbstractLeaseInput = z.object({
  documents: z
    .array(AbstractDocument)
    .min(1)
    .max(DOC_LIMITS.documentsPerAbstract)
    .describe(
      "The lease and its amendments. Each needs pages with candidates or facts, or facts alone.",
    ),
  as_of: AsOf,
  subject: Subject.optional(),
});

export const CompareInput = z.object({
  lease_facts: z
    .array(FactObject)
    .min(1)
    .max(DOC_LIMITS.factsPerCall)
    .describe(
      "Verified lease facts: the facts from doc_abstract_lease (or doc_verify_facts). Facts another fact supersedes are ignored.",
    ),
  asserted: z
    .array(
      z.object({
        predicate: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Predicate of the asserted value, e.g. lease.expiration_date.",
          ),
        value: z
          .unknown()
          .describe(
            "The asserted value in the predicate's shape (YYYY-MM-DD dates, plain numbers, decimal rates). For an object, only the fields given are compared.",
          ),
        label: z
          .string()
          .max(200)
          .optional()
          .describe('Where it was asserted, e.g. "Estoppel ¶3".'),
      }),
    )
    .min(1)
    .max(DOC_LIMITS.assertedPerCall)
    .describe(
      "Values another document states (an estoppel, a rent roll, an OM), mapped to predicates.",
    ),
});

export const VerifyClaimInput = z.object({
  document: DocumentInput.describe("The document the quote is from."),
  claim: z
    .object({
      predicate: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Predicate of the claim, with value."),
      value: z
        .unknown()
        .optional()
        .describe("Claimed value in the predicate's shape, with predicate."),
      text: z
        .string()
        .min(1)
        .max(2_000)
        .optional()
        .describe(
          "Or a short claim sentence instead of predicate and value; its numbers and dates are checked.",
        ),
    })
    .describe("Either {predicate, value} or {text}."),
  quote: z
    .string()
    .max(DOC_LIMITS.quoteCharacters)
    .describe("Verbatim text from the page that the claim rests on."),
  page: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .describe("1-based page the quote is on."),
});

// --- shared -------------------------------------------------------------------------------------

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
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

/** The fact ID Ingest gives a cited fact (python/src/factlot/ingest/pipeline.py `_fact_id`). */
export function factId(
  subject: string,
  predicate: string,
  document: string,
  quote: string,
): string {
  const digest = createHash("sha256")
    .update([subject, predicate, document, quote].join("\x1f"), "utf8")
    .digest();
  return `flf_${base32(digest, 24)}`;
}

export type Json = Record<string, unknown>;
export type Producer = { name: string; version: string };

export interface Doc {
  id: string;
  basis: "sha256" | "page_text";
  title?: string;
  sha256?: string;
  text: PageText;
  /** Pages whose text came from OCR (DocumentInput.ocr_pages). */
  ocr: ReadonlySet<number>;
}

export function characters(pages: readonly string[]): number {
  return pages.reduce((n, p) => n + p.length, 0);
}

/** A document input as pages to check; `path` names it in an error (e.g. "document"). */
export function loadDocument(
  d: {
    pages: string[];
    sha256?: string;
    title?: string;
    ocr_pages?: number[];
  },
  path = "document",
): Doc {
  const beyond = (d.ocr_pages ?? []).find((p) => p > d.pages.length);
  if (beyond !== undefined)
    throw new ToolInputError([
      {
        path: `${path}.ocr_pages`,
        message: `page ${beyond} is listed as OCR, but the document has ${d.pages.length} page${d.pages.length === 1 ? "" : "s"}`,
      },
    ]);
  return {
    id: d.sha256
      ? `fl:document:sha256-${d.sha256}`
      : documentId(d.pages.join("\f")).urn,
    basis: d.sha256 ? "sha256" : "page_text",
    ...(d.title !== undefined ? { title: d.title } : {}),
    ...(d.sha256 !== undefined ? { sha256: d.sha256 } : {}),
    text: new PageText(d.pages),
    ocr: new Set(d.ocr_pages ?? []),
  };
}

export function describeDocument(doc: Doc): Json {
  return {
    document_id: doc.id,
    document_id_basis: doc.basis,
    ...(doc.title !== undefined ? { title: doc.title } : {}),
    pages: doc.text.pages.length,
    ...(doc.ocr.size ? { ocr_pages: [...doc.ocr].sort((a, b) => a - b) } : {}),
  };
}

function predicateNote(predicate: string): string | undefined {
  if (isIngestPredicate(predicate) || !predicate.startsWith("lease."))
    return undefined;
  const near = suggest(predicate, Object.keys(PREDICATES));
  return near
    ? `${predicate} is not an Ingest predicate (did you mean ${near}?); its numbers, ratios and dates were checked with the generic rules`
    : undefined;
}

function coverage(predicate: string, value: unknown): Json {
  const parts = valueParts(predicate, value);
  return {
    checked: parts.filter((p) => p.as).map((p) => ({ path: p.path, as: p.as })),
    not_checked: parts.filter((p) => !p.as).map((p) => p.path),
  };
}

interface Context {
  subject: string;
  asOf: string;
  validFrom?: string;
  producer: Producer;
}

interface Outcome {
  verified: Json[];
  needs_review: Json[];
  rejected: Json[];
  facts: Json[];
}

/** One candidate through the Ingest checks, in order: value shape, quote on page, value in quote, confidence. */
function verifyCandidate(
  doc: Doc,
  c: CandidateIn,
  ctx: Context,
  label: Json,
  out: Outcome,
): void {
  const base = { ...label, predicate: c.predicate };
  const shape = checkAnyValue(c.predicate, c.value);
  if (shape) {
    out.rejected.push({
      ...base,
      value: c.value,
      page: c.page,
      check: "value",
      reason: shape,
    });
    return;
  }
  const loc = locateQuote(doc.text, c.quote, c.page);
  if (!loc.ok) {
    out.rejected.push({
      ...base,
      value: c.value,
      page: c.page,
      check: "quote",
      reason: loc.reason,
    });
    return;
  }
  const notes: string[] = [];
  if (loc.corrected)
    notes.push(`quote found on page ${loc.page}, not ${c.page}`);
  const note = predicateNote(c.predicate);
  if (note) notes.push(note);
  const review = (check: string, reason: string): void => {
    out.needs_review.push({
      ...base,
      value: c.value,
      quote: c.quote,
      page: loc.page,
      ...(c.section !== undefined ? { section: c.section } : {}),
      check,
      reason,
      ...(notes.length ? { notes } : {}),
    });
  };
  const mismatch = checkConsistency(c.predicate, c.value, c.quote);
  if (mismatch) return review("consistency", mismatch);
  if (c.confidence !== undefined && c.confidence < REVIEW_CONFIDENCE_THRESHOLD)
    return review(
      "confidence",
      `extractor confidence ${showValue(c.confidence)} is below ${REVIEW_CONFIDENCE_THRESHOLD}`,
    );
  const span = doc.text.span(loc.page, loc.q);
  const source: Json = {
    document_id: doc.id,
    ...(doc.title !== undefined ? { title: doc.title } : {}),
    page: loc.page,
    ...(c.section !== undefined ? { section: c.section } : {}),
    quote: c.quote,
    ...(doc.ocr.has(loc.page) ? { ocr: true } : {}),
    ...(span ? { span } : {}),
    ...(doc.sha256 !== undefined ? { sha256: doc.sha256 } : {}),
  };
  const fact = buildFact(ctx, c.predicate, c.value, doc.id, c.quote, {
    method: "extracted",
    sources: [source],
    producer: ctx.producer,
    ...(c.confidence !== undefined ? { confidence: c.confidence } : {}),
  });
  out.facts.push(fact);
  out.verified.push({
    ...label,
    fact,
    ...coverage(c.predicate, c.value),
    ...(notes.length ? { notes } : {}),
  });
}

function buildFact(
  ctx: Context,
  predicate: string,
  value: unknown,
  document: string,
  quote: string,
  provenance: Json,
): Json {
  const fact: Json = {
    id: factId(ctx.subject, predicate, document, quote),
    subject: ctx.subject,
    predicate,
    value,
    as_of: ctx.asOf,
    ...(ctx.validFrom !== undefined ? { valid_from: ctx.validFrom } : {}),
    provenance,
  };
  const check = Fact.safeParse(fact);
  if (!check.success)
    throw new Error(
      `document tools built an invalid fact: ${check.error.message}`,
    );
  return fact;
}

export function capCharacters(total: number): void {
  if (total > DOC_LIMITS.charactersPerCall)
    throw new ToolInputError([
      {
        path: "",
        message: `pages hold ${total} characters in all; the limit is ${DOC_LIMITS.charactersPerCall} per call. Verify long documents in several calls (doc_abstract_lease accepts the facts from each)`,
      },
    ]);
}

// --- fact_validate ------------------------------------------------------------------------------

/**
 * The fact_validate checks beyond the schema, for Ingest predicates: the value's shape, and
 * that every source quote supports the value (the Ingest consistency check).
 */
export function factValueIssues(
  fact: unknown,
): { path: string; message: string }[] {
  if (!isPlainObject(fact) || typeof fact.predicate !== "string") return [];
  if (!isIngestPredicate(fact.predicate) || !Object.hasOwn(fact, "value"))
    return [];
  const shape = checkValue(fact.predicate, fact.value);
  if (shape)
    return [
      {
        path: "value",
        message: `value does not fit ${fact.predicate}: ${shape}`,
      },
    ];
  if (!hasConsistencyRule(fact.predicate)) return [];
  const prov = fact.provenance;
  if (!isPlainObject(prov) || !Array.isArray(prov.sources)) return [];
  const out: { path: string; message: string }[] = [];
  prov.sources.forEach((s, i) => {
    if (!isPlainObject(s) || typeof s.quote !== "string") return;
    const reason = checkConsistency(
      fact.predicate as string,
      fact.value,
      s.quote,
    );
    if (reason)
      out.push({
        path: `provenance.sources.${i}.quote`,
        message: `value not supported by quote: ${reason}`,
      });
  });
  return out;
}

/** fact_validate: the published schema (unknown fields, citations, date order), then factValueIssues. */
export function validateFact(fact: unknown): {
  valid: boolean;
  issues: { path: string; message: string }[];
} {
  const r = Fact.safeParse(fact);
  const issues = r.success
    ? []
    : r.error.issues.map((x) => ({
        path: x.path.join("."),
        message: x.message,
      }));
  issues.push(...factValueIssues(fact));
  return { valid: issues.length === 0, issues };
}

// --- doc_verify_facts ---------------------------------------------------------------------------

export function verifyFacts(
  input: z.output<typeof VerifyFactsInput>,
  producer: Producer,
): Json {
  capCharacters(characters(input.document.pages));
  const doc = loadDocument(input.document);
  const out: Outcome = {
    verified: [],
    needs_review: [],
    rejected: [],
    facts: [],
  };
  const ctx: Context = {
    subject: input.subject ?? doc.id,
    asOf: input.as_of,
    producer,
  };
  input.candidates.forEach((c, i) =>
    verifyCandidate(doc, c, ctx, { candidate: i }, out),
  );
  return {
    document: describeDocument(doc),
    verified: out.verified,
    needs_review: out.needs_review,
    rejected: out.rejected,
    summary: {
      candidates: input.candidates.length,
      verified: out.verified.length,
      needs_review: out.needs_review.length,
      rejected: out.rejected.length,
    },
  };
}

// --- doc_abstract_lease -------------------------------------------------------------------------

/** JSON equality: numbers by value, no type coercion, objects regardless of key order. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => jsonEqual(x, b[i]))
    );
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]))
    );
  }
  return a === b;
}

type AbstractDoc = z.output<typeof AbstractDocument>;

/** Original first, then amendments by effective date (input order breaks ties), or in input order if any is undated. */
function applyOrder(docs: AbstractDoc[]): number[] {
  const role = (i: number): string =>
    docs[i]!.role ?? (i === 0 ? "original" : "amendment");
  const idx = docs.map((_, i) => i);
  const originals = idx.filter((i) => role(i) === "original");
  const amendments = idx.filter((i) => role(i) !== "original");
  if (amendments.every((i) => docs[i]!.effective_date))
    amendments.sort((a, b) => {
      const da = docs[a]!.effective_date!;
      const db = docs[b]!.effective_date!;
      return da < db ? -1 : da > db ? 1 : a - b;
    });
  return [...originals, ...amendments];
}

interface Statement {
  fact: Json;
  document: number;
  order: number;
  quoteOnPage: boolean;
}

function citation(s: Statement): Json {
  const src = ((s.fact.provenance as Json).sources as Json[])[0]!;
  const pick = (k: string): Json =>
    src[k] !== undefined ? { [k]: src[k] } : {};
  return {
    document: s.document,
    document_id: src.document_id,
    ...pick("title"),
    ...pick("page"),
    ...pick("section"),
    ...pick("quote"),
    ...pick("span"),
    quote_on_page: s.quoteOnPage,
    fact_id: s.fact.id,
  };
}

function firstIssue(issues: { path: string; message: string }[]): string {
  const [i] = issues;
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : "";
  return `not a valid fact: ${i!.path || "(root)"}: ${i!.message}${more}`;
}

export function abstractLease(
  input: z.output<typeof AbstractLeaseInput>,
  producer: Producer,
): Json {
  const docs = input.documents;
  let total = 0;
  let candidates = 0;
  docs.forEach((d, i) => {
    if (!d.pages && !d.facts?.length)
      throw new ToolInputError([
        {
          path: `documents.${i}`,
          message: "give pages with candidates or facts, or facts alone",
        },
      ]);
    if (d.pages && !d.candidates?.length && !d.facts?.length)
      throw new ToolInputError([
        {
          path: `documents.${i}`,
          message: "pages need candidates (or facts) to verify",
        },
      ]);
    if (!d.pages && d.candidates?.length)
      throw new ToolInputError([
        {
          path: `documents.${i}.candidates`,
          message: "candidates need the document's pages",
        },
      ]);
    total += characters(d.pages ?? []);
    candidates += (d.candidates?.length ?? 0) + (d.facts?.length ?? 0);
  });
  capCharacters(total);
  if (candidates > DOC_LIMITS.candidatesPerCall)
    throw new ToolInputError([
      {
        path: "documents",
        message: `${candidates} candidates and facts in all; the limit is ${DOC_LIMITS.candidatesPerCall} per call`,
      },
    ]);

  const order = applyOrder(docs);
  const loaded = docs.map((d, i) =>
    d.pages
      ? loadDocument({ ...d, pages: d.pages }, `documents.${i}`)
      : undefined,
  );
  // A document given only as facts is identified by the facts' own citations.
  const ids = docs.map((d, i) => {
    if (loaded[i]) return loaded[i].id;
    if (d.sha256) return `fl:document:sha256-${d.sha256}`;
    for (const f of d.facts ?? []) {
      const src =
        isPlainObject(f.provenance) && Array.isArray(f.provenance.sources)
          ? (f.provenance.sources[0] as unknown)
          : undefined;
      if (
        isPlainObject(src) &&
        typeof src.document_id === "string" &&
        src.document_id
      )
        return src.document_id;
    }
    return null;
  });
  const subject =
    input.subject ?? ids[order[0]!] ?? ids.find((x) => x !== null) ?? undefined;
  if (
    subject === undefined ||
    subject === null ||
    !FactLotIdString.safeParse(subject).success
  )
    throw new ToolInputError([
      {
        path: "subject",
        message:
          "no FactLot document ID to use as the subject; pass subject (your lease's fl:lease:… URN)",
      },
    ]);

  const facts: Json[] = [];
  const needsReview: Json[] = [];
  const rejected: Json[] = [];
  const statements: Statement[] = [];
  const documents: Json[] = [];
  order.forEach((di, o) => {
    const d = docs[di]!;
    const doc = loaded[di];
    const ctx: Context = {
      subject,
      asOf: input.as_of,
      ...(d.effective_date !== undefined
        ? { validFrom: d.effective_date }
        : {}),
      producer,
    };
    const out: Outcome = {
      verified: [],
      needs_review: [],
      rejected: [],
      facts: [],
    };
    const placed: { fact: Json; quoteOnPage: boolean }[] = [];
    if (doc) {
      (d.candidates ?? []).forEach((c, i) =>
        verifyCandidate(doc, c, ctx, { document: di, candidate: i }, out),
      );
    }
    (d.facts ?? []).forEach((f, i) => {
      const label = { document: di, fact: i };
      const predicate = typeof f.predicate === "string" ? f.predicate : "";
      const reject = (reason: string): void => {
        out.rejected.push({ ...label, predicate, check: "fact", reason });
      };
      const check = validateFact(f);
      if (!check.valid) return reject(firstIssue(check.issues));
      const prov = f.provenance as Json;
      const src = (prov.sources as Json[])[0]!;
      if (typeof src.quote !== "string" || typeof src.page !== "number")
        return reject("the fact's first source needs a quote and a page");
      if (src.document_id !== ids[di])
        return reject(
          `the fact cites ${String(src.document_id)}, but this document is ${String(ids[di])}`,
        );
      if (doc) {
        verifyCandidate(
          doc,
          {
            predicate,
            value: f.value,
            quote: src.quote,
            page: src.page,
            ...(typeof src.section === "string"
              ? { section: src.section }
              : {}),
            ...(typeof prov.confidence === "number"
              ? { confidence: prov.confidence }
              : {}),
          },
          ctx,
          label,
          out,
        );
        return;
      }
      if (predicate && !isIngestPredicate(predicate)) {
        const reason = checkConsistency(predicate, f.value, src.quote);
        if (reason) return reject(`value not supported by quote: ${reason}`);
      }
      const fact = buildFact(
        ctx,
        predicate,
        f.value,
        ids[di] as string,
        src.quote,
        { ...prov },
      );
      placed.push({ fact, quoteOnPage: false });
    });
    const ordered = [
      ...out.facts.map((fact) => ({ fact, quoteOnPage: true })),
      ...placed,
    ];
    for (const p of ordered) {
      facts.push(p.fact);
      statements.push({
        fact: p.fact,
        document: di,
        order: o,
        quoteOnPage: p.quoteOnPage,
      });
    }
    needsReview.push(...out.needs_review);
    rejected.push(...out.rejected);
    documents.push({
      document: di,
      applied: o + 1,
      role: d.role ?? (di === 0 ? "original" : "amendment"),
      ...(d.effective_date !== undefined
        ? { effective_date: d.effective_date }
        : {}),
      ...(doc
        ? describeDocument(doc)
        : {
            document_id: ids[di],
            document_id_basis: d.sha256 ? "sha256" : "facts",
            ...(d.title !== undefined ? { title: d.title } : {}),
          }),
      verified: ordered.length,
      needs_review: out.needs_review.length,
      rejected: out.rejected.length,
    });
  });

  // Supersession: a later document's statement of a predicate controls; earlier ones are history.
  interface Field {
    predicate: string;
    current: Statement;
    history: Statement[];
    conflicts: Statement[];
  }
  const fields = new Map<string, Field>();
  for (const s of statements) {
    const predicate = s.fact.predicate as string;
    const f = fields.get(predicate);
    if (!f) {
      fields.set(predicate, {
        predicate,
        current: s,
        history: [],
        conflicts: [],
      });
      continue;
    }
    if (f.current.order === s.order) {
      if (
        !jsonEqual(f.current.fact.value, s.fact.value) &&
        !f.conflicts.some((c) => jsonEqual(c.fact.value, s.fact.value))
      )
        f.conflicts.push(s);
      continue;
    }
    s.fact.supersedes = [f.current.fact.id];
    f.history.push(f.current, ...f.conflicts);
    f.current = s;
    f.conflicts = [];
  }
  const orderOf = new Map(order.map((di, o) => [di, o]));
  const open: Json[] = [
    ...needsReview.map((x) => ({ ...x, status: "needs_review" })),
    ...rejected.map((x) => ({ ...x, status: "rejected" })),
  ];
  const out: Json[] = [];
  for (const f of fields.values()) {
    const items = open
      .filter(
        (x) =>
          x.predicate === f.predicate &&
          orderOf.get(x.document as number)! >= f.current.order,
      )
      .map((x) => ({
        document: x.document,
        ...(x.candidate !== undefined
          ? { candidate: x.candidate }
          : { fact: x.fact }),
        status: x.status,
        check: x.check,
        reason: x.reason,
      }));
    const short = (s: Statement): Json => ({
      value: s.fact.value,
      ...citation(s),
    });
    out.push({
      predicate: f.predicate,
      value: f.current.fact.value,
      source: citation(f.current),
      history: f.history.map(short),
      ...(f.conflicts.length ? { conflicts: f.conflicts.map(short) } : {}),
      ...(items.length ? { open_items: items } : {}),
    });
  }
  return {
    subject,
    as_of: input.as_of,
    documents,
    fields: out,
    facts,
    needs_review: needsReview,
    rejected,
    summary: {
      documents: docs.length,
      fields: out.length,
      facts: facts.length,
      needs_review: needsReview.length,
      rejected: rejected.length,
      conflicts: out.filter((f) => f.conflicts).length,
    },
  };
}

// --- doc_compare --------------------------------------------------------------------------------

function differences(a: unknown, l: unknown, path: string, out: Json[]): void {
  if (out.length >= 20) return;
  if (isPlainObject(a) && isPlainObject(l)) {
    for (const [k, v] of Object.entries(a)) {
      if (!Object.hasOwn(l, k)) out.push({ path: `${path}.${k}`, asserted: v });
      else differences(v, l[k], `${path}.${k}`, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(l) && a.length === l.length) {
    a.forEach((v, i) => differences(v, l[i], `${path}.${i}`, out));
    return;
  }
  if (!jsonEqual(a, l)) out.push({ path, asserted: a, lease: l });
}

export function compare(input: z.output<typeof CompareInput>): Json {
  const issues: { path: string; message: string }[] = [];
  input.lease_facts.forEach((f, i) => {
    for (const x of validateFact(f).issues)
      issues.push({
        path: `lease_facts.${i}${x.path ? `.${x.path}` : ""}`,
        message: x.message,
      });
  });
  input.asserted.forEach((a, i) => {
    if (!PREDICATE_PATTERN.test(a.predicate))
      issues.push({
        path: `asserted.${i}.predicate`,
        message: "dotted lower_snake predicate",
      });
    else if (isIngestPredicate(a.predicate)) {
      const shape = checkValue(a.predicate, a.value);
      if (shape) issues.push({ path: `asserted.${i}.value`, message: shape });
    }
  });
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  const superseded = new Set<unknown>();
  for (const f of input.lease_facts)
    for (const id of (f.supersedes as unknown[] | undefined) ?? [])
      superseded.add(id);
  const current = new Map<string, Json[]>();
  for (const f of input.lease_facts) {
    if (f.id !== undefined && superseded.has(f.id)) continue;
    const list = current.get(f.predicate as string) ?? [];
    if (!list.some((g) => jsonEqual(g.value, f.value))) list.push(f);
    current.set(f.predicate as string, list);
  }
  const cite = (f: Json): Json => {
    const src = ((f.provenance as Json).sources as Json[])[0] ?? {};
    const pick = (k: string): Json =>
      src[k] !== undefined ? { [k]: src[k] } : {};
    return {
      ...(f.id !== undefined ? { fact_id: f.id } : {}),
      ...pick("document_id"),
      ...pick("title"),
      ...pick("page"),
      ...pick("section"),
      ...pick("quote"),
    };
  };
  const summary = {
    match: 0,
    mismatch: 0,
    not_in_lease: 0,
    ambiguous_in_lease: 0,
  };
  const results = input.asserted.map((a, i) => {
    const base = {
      asserted: i,
      ...(a.label !== undefined ? { label: a.label } : {}),
      predicate: a.predicate,
      value: a.value,
    };
    const lease = current.get(a.predicate) ?? [];
    if (lease.length === 0) {
      summary.not_in_lease++;
      return { ...base, status: "not_in_lease" };
    }
    if (lease.length > 1) {
      summary.ambiguous_in_lease++;
      return {
        ...base,
        status: "ambiguous_in_lease",
        lease: lease.map((f) => ({ value: f.value, citation: cite(f) })),
      };
    }
    const f = lease[0]!;
    const diffs: Json[] = [];
    differences(a.value, f.value, "value", diffs);
    const status = diffs.length ? "mismatch" : "match";
    summary[status]++;
    return {
      ...base,
      status,
      lease_value: f.value,
      ...(diffs.length ? { differences: diffs } : {}),
      citation: cite(f),
    };
  });
  return { results, summary };
}

// --- doc_verify_claim ---------------------------------------------------------------------------

function decimalToNumber(key: string): number {
  return Number(key);
}

function isoOf(key: string): string {
  const [y, m, d] = key.split("-");
  return `${y!.padStart(4, "0")}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

function quoteStates(q: string): Json {
  return {
    dates: [...datesIn(q)].map(isoOf).sort().slice(0, 20),
    numbers: [...numbersIn(q)]
      .map(decimalToNumber)
      .sort((a, b) => a - b)
      .slice(0, 20),
  };
}

export function verifyClaim(input: z.output<typeof VerifyClaimInput>): Json {
  capCharacters(characters(input.document.pages));
  const { claim } = input;
  const byValue = claim.predicate !== undefined || claim.value !== undefined;
  if (
    byValue === (claim.text !== undefined) ||
    (byValue && (claim.predicate === undefined || claim.value === undefined))
  )
    throw new ToolInputError([
      { path: "claim", message: "give either predicate and value, or text" },
    ]);
  if (byValue) {
    const shape = checkAnyValue(claim.predicate!, claim.value);
    if (shape)
      throw new ToolInputError([
        {
          path: PREDICATE_PATTERN.test(claim.predicate!)
            ? "claim.value"
            : "claim.predicate",
          message: shape,
        },
      ]);
  }
  const doc = loadDocument(input.document);
  const evidence: Json = {
    document_id: doc.id,
    document_id_basis: doc.basis,
    page: input.page,
    quote: input.quote,
  };
  const loc = locateQuote(doc.text, input.quote, input.page);
  if (!loc.ok)
    return {
      status: "unverifiable",
      reason: loc.reason,
      evidence,
      checked: [],
    };
  evidence.page = loc.page;
  if (doc.ocr.has(loc.page)) evidence.ocr = true;
  const span = doc.text.span(loc.page, loc.q);
  if (span) evidence.span = span;
  if (loc.corrected)
    evidence.note = `quote found on page ${loc.page}, not ${input.page}`;
  const q = loc.q;
  const states = quoteStates(q);

  let parts: { path?: string; as: Kind; value: unknown }[];
  let notChecked: string[] = [];
  if (byValue) {
    const all = valueParts(claim.predicate!, claim.value);
    parts = all
      .filter((p) => p.as)
      .map((p) => ({ path: p.path, as: p.as!, value: p.value }));
    notChecked = all.filter((p) => !p.as).map((p) => p.path);
  } else {
    // Dates first; numbers are read from the rest of the sentence, so "June 30, 2031" is one date
    // and not also the numbers 30 and 2031.
    const t = norm(claim.text!);
    let masked = t;
    for (const [s, e] of dateRanges(t))
      masked = masked.slice(0, s) + " ".repeat(e - s) + masked.slice(e);
    parts = [
      ...[...datesIn(t)]
        .map(isoOf)
        .sort()
        .map((v) => ({ as: "date" as Kind, value: v })),
      ...[...numbersIn(masked)]
        .map(decimalToNumber)
        .sort((a, b) => a - b)
        .map((v) => ({ as: "number" as Kind, value: v })),
    ];
  }
  if (parts.length === 0)
    return {
      status: "unverifiable",
      reason: byValue
        ? "nothing in this value can be checked against a quote: FactLot checks numbers, ratios, dates and verbatim names, not enums or free text"
        : "the claim text has no number or date to check; pass claim.predicate and claim.value to check a name, or read the quote yourself",
      evidence,
      checked: [],
      ...(notChecked.length ? { not_checked: notChecked } : {}),
    };
  const checked = parts.map((p) => ({
    ...p,
    found: !missing(p.as, p.value, q),
  }));
  const absent = checked.filter((p) => !p.found);
  const stated = (kind: Kind): unknown[] =>
    kind === "date"
      ? (states.dates as unknown[])
      : kind === "string" || kind === "phrase"
        ? []
        : (states.numbers as unknown[]);
  const shown = (p: { as: Kind; value: unknown }): string =>
    p.as === "text"
      ? `number ${textNumberMissing(p.value as string, q)} in ${showValue(p.value)}`
      : showValue(p.value);
  const contradicting = absent.find((p) => stated(p.as).length > 0);
  const where = (p: { path?: string }): string =>
    p.path && p.path !== "value" ? ` (${p.path.slice("value.".length)})` : "";
  let status: string;
  let reason: string;
  if (absent.length === 0) {
    status = "supported";
    reason = byValue
      ? "every checked part of the value is written in the quote, and the quote is on the page"
      : "every number and date in the claim is written in the quote, and the quote is on the page; FactLot does not read the sentence's meaning";
  } else if (contradicting) {
    status = "contradicted";
    const kind = contradicting.as === "date" ? "dates" : "numbers";
    reason = `${shown(contradicting)}${where(contradicting)} is not written in the quote; the quote states ${kind}: ${stated(contradicting.as).map(String).join(", ")}`;
  } else {
    status = "unverifiable";
    const p = absent[0]!;
    reason =
      p.as === "string"
        ? `${showValue(p.value)}${where(p)} is not written in the quote; FactLot cannot tell whether the quote names someone else`
        : p.as === "phrase"
          ? `${showValue(p.value)}${where(p)} is not worded in the quote as FactLot recognises it (docs/document-verification.md lists the phrases); read the quote`
          : `${showValue(p.value)}${where(p)} is not written in the quote, and the quote states no ${p.as === "date" ? "date" : "number"} to compare it with`;
  }
  return {
    status,
    reason,
    evidence,
    checked,
    ...(notChecked.length ? { not_checked: notChecked } : {}),
    ...(status === "contradicted" ? { quote_states: states } : {}),
  };
}
