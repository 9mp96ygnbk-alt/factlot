/**
 * estoppel_prepare: the standard statements of a tenant estoppel certificate, prepared from a
 * lease's verified facts.
 *
 * Input: the lease's verified facts (doc_abstract_lease's facts for the lease and its amendments, or
 * doc_verify_facts', each with its quote and page and passing fact_validate), the parties, the
 * premises and the as-of date. Output: numbered statements. A statement that the lease states carries
 * the lease quote, page and document fingerprint it rests on. A statement only the tenant can know
 * (defaults, rent paid through, prepaid rent) is marked "tenant to confirm" and has no lease source:
 * FactLot never writes a source for something no document says. Gaps (a term no fact supplies) and
 * conflicts (facts of the lease and its amendments that disagree, or a schedule that does not cover
 * the as-of date) are listed and the statement is withheld from the items to send.
 *
 * Rules: deterministic (same inputs, same statements; no model, no clock: `as_of` is an input); no
 * source, no fact (a lease statement without a verified lease fact behind it is never produced);
 * nothing is approximated. The statements are facts and arithmetic, not legal advice: the tenant's
 * signature, not FactLot, is what makes a certificate an estoppel. python/src/factlot/estoppel.py is
 * the same code; spec/differential runs both on the same inputs.
 *
 * Hosted plan: like audit_expense_statement, a caller without a Pro or Team key gets the summary only
 * (the host says so through runWithExchangeCaller({ fullAudit: false })). Locally the answer is whole.
 */
import { addDays, round } from "@factlot/calc";
import { z } from "zod";

import { ToolInputError, jsonEqual, validateFact } from "./documents.ts";
import type { Json } from "./documents.ts";
import { currentExchangeCaller } from "./exchange.ts";
import { gateDocument } from "./free_document.ts";

export const ESTOPPEL_PLAN_URL = "https://factlot.com/pricing/";
export const ESTOPPEL_MAX_FACTS = 200;

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Org = z.object({
  organisation: z
    .string()
    .min(1)
    .max(120)
    .describe(
      "The organisation's name as the lease or the certificate uses it.",
    ),
});

export const EstoppelPrepareInput = z.object({
  lease_facts: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(ESTOPPEL_MAX_FACTS)
    .describe(
      "The lease's verified facts, for the lease and every amendment (doc_abstract_lease's facts, or doc_verify_facts' verified[].fact), each with its quote and page and passing fact_validate. Read by predicate: lease.landlord, lease.tenant, lease.commencement_date, lease.expiration_date, lease.rentable_area_sf, lease.base_rent_schedule (dated steps {from, to, annual_rent_psf}), lease.security_deposit (USD), lease.free_rent {months, applies_to}, lease.ti_allowance (USD, or {amount, per_sf?}), lease.renewal_option {count, term_months, notice_months, rent}, lease.renewal_notice_deadline, lease.termination_option {effective_date, notice_months, fee}, lease.termination_notice_deadline, lease.expansion_option (text or {description}), lease.expansion_option_deadline, lease.rofr and lease.rofo {applies_to: space|purchase, description, response_days}, lease.purchase_option (text or {description, price?}). A fact another fact supersedes (supersedes) is history; a fact valid_from after as_of is pending and not used. A term no fact supplies is listed under gaps; nothing is guessed.",
    ),
  parties: z
    .object({
      tenant: Org.describe("The tenant that will sign the certificate."),
      landlord: Org.describe("The landlord the certificate is given about."),
      requested_by: Org.extend({
        role: z
          .enum(["lender", "buyer", "other"])
          .describe("Why the certificate is wanted."),
      })
        .optional()
        .describe(
          "The lender or buyer the certificate is for, if known. The tenant's answers are for it to rely on; it is not the sender.",
        ),
    })
    .describe("The parties."),
  premises: z
    .object({
      label: z
        .string()
        .min(1)
        .max(240)
        .describe("The premises in words: address and suite."),
    })
    .describe("The leased premises."),
  as_of: Date_.describe(
    "The date of the certificate, YYYY-MM-DD. The tool reads no clock: the current rent step and the next one are found from this date.",
  ),
  documents: z
    .array(
      z.object({
        document_id: z
          .string()
          .regex(/^fl:document:sha256-[a-f0-9]{64}$/)
          .describe("The document's FactLot ID, as the facts cite it."),
        role: z.enum(["original", "amendment"]),
        title: z.string().min(1).max(160).optional(),
        effective_date: Date_.optional().describe(
          "For an amendment, the date it takes effect.",
        ),
      }),
    )
    .max(50)
    .optional()
    .describe(
      "Optional: which cited document is the lease and which are amendments. Without it, a document whose facts carry valid_from is an amendment and the one remaining is the lease; anything unclear is flagged, never guessed.",
    ),
  landlord_records: z
    .object({
      rent_paid_through: Date_.optional().describe(
        "The date through which the landlord's own ledger shows rent paid. It is not a lease term: it is shown to the tenant as the landlord's figure to confirm.",
      ),
      security_deposit_held: z
        .number()
        .gt(0)
        .optional()
        .describe(
          "The deposit the landlord's ledger shows held, USD. Compared with the lease's figure; a difference is flagged.",
        ),
    })
    .optional()
    .describe(
      "Optional figures from the landlord's own records. They have no lease source and are marked as the landlord's.",
    ),
});
export type EstoppelInput = z.output<typeof EstoppelPrepareInput>;

// --- value shapes -------------------------------------------------------------------------------

const N = z.number().finite();
const strict = <T extends z.ZodRawShape>(s: T) => z.strictObject(s);
const Text = z.string().min(1).max(600);
const TextOrObj = (shape: z.ZodRawShape): z.ZodType =>
  z.union([Text, strict(shape)]);

const SHAPES: Record<string, z.ZodType> = {
  "lease.landlord": Text,
  "lease.tenant": Text,
  "lease.commencement_date": Date_,
  "lease.expiration_date": Date_,
  "lease.rentable_area_sf": N.gt(0),
  "lease.base_rent_schedule": z
    .array(strict({ from: Date_, to: Date_, annual_rent_psf: N.min(0) }))
    .min(1)
    .max(200),
  "lease.security_deposit": N.gt(0),
  "lease.free_rent": strict({
    months: N.gt(0).optional(),
    applies_to: z.enum(["base_rent", "gross_rent"]).optional(),
  }),
  "lease.ti_allowance": z.union([
    N.gt(0),
    strict({ amount: N.gt(0), per_sf: N.gt(0).optional() }),
  ]),
  "lease.renewal_option": strict({
    count: N.gt(0).optional(),
    term_months: N.gt(0).optional(),
    notice_months: N.gt(0).optional(),
    rent: Text.optional(),
  }),
  "lease.renewal_notice_deadline": Date_,
  "lease.termination_option": strict({
    effective_date: Date_.optional(),
    notice_months: N.gt(0).optional(),
    fee: Text.optional(),
  }),
  "lease.termination_notice_deadline": Date_,
  "lease.expansion_option": TextOrObj({ description: Text }),
  "lease.expansion_option_deadline": Date_,
  "lease.rofr": TextOrObj({
    applies_to: z.enum(["space", "purchase"]),
    description: Text,
    response_days: N.gt(0).optional(),
  }),
  "lease.rofo": TextOrObj({
    applies_to: z.enum(["space", "purchase"]),
    description: Text,
    response_days: N.gt(0).optional(),
  }),
  "lease.purchase_option": TextOrObj({
    description: Text,
    price: Text.optional(),
  }),
};

// --- helpers ------------------------------------------------------------------------------------

const usd = (x: number): number => round(x, 2);
function money(x: number): string {
  const r = round(Math.abs(x), 2).toFixed(2);
  const [int, frac] = r.split(".") as [string, string];
  return `${x < 0 && r !== "0.00" ? "-" : ""}$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}
function sf(x: number): string {
  const [int, frac] = String(round(x, 2)).split(".") as [string, string?];
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function longDate(iso: string): string {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return `${MONTHS[m - 1]!} ${d}, ${y}`;
}
const num = (x: number): string => String(round(x, 6));
const plural = (n: number, one: string, many: string): string =>
  `${num(n)} ${n === 1 ? one : many}`;
const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const sha8 = (documentId: string | null): string =>
  documentId !== null && documentId.startsWith("fl:document:sha256-")
    ? documentId.slice(
        "fl:document:sha256-".length,
        "fl:document:sha256-".length + 12,
      )
    : "unknown";

interface EFact {
  id: string;
  predicate: string;
  value: unknown;
  quote: string;
  page: number;
  section: string | null;
  document_id: string | null;
  valid_from: string | null;
  supersedes: string[];
}

type Issue = { path: string; message: string };

interface Flag {
  code: string;
  severity: "conflict" | "gap" | "check";
  message: string;
}

interface Source {
  fact_id: string;
  role: "lease" | "superseded" | "conflicting";
  predicate: string;
  document_id: string | null;
  document_role: string | null;
  sha256: string | null;
  page: number;
  quote: string;
  section: string | null;
}

type Basis = "lease" | "tenant";
type Status = "ready" | "tenant_to_confirm" | "gap" | "conflict";

interface Statement {
  number: number;
  key: string;
  code: string;
  title: string;
  basis: Basis;
  status: Status;
  sendable: boolean;
  text: string;
  value: string | number | null;
  unit: string | null;
  needs_tenant_value: boolean;
  sources: Source[];
  fact_ids: string[];
  steps: string[];
  flags: Flag[];
  confirm: string[];
}

const CONFIRM_LEASE =
  "that the quoted sentence is the one that governs after every amendment, and that the defined terms mean what the statement assumes";
const CONFIRM_TENANT =
  "nothing in the lease supports or contradicts this statement: only the tenant can confirm it, and the tenant's signature is what makes it a statement of the tenant";

// --- reading facts ------------------------------------------------------------------------------

function readFacts(
  list: Record<string, unknown>[],
  issues: Issue[],
  ignored: string[],
): EFact[] {
  const out: EFact[] = [];
  const ids = new Set<string>();
  list.forEach((f, i) => {
    const at = `lease_facts.${i}`;
    const v = validateFact(f);
    if (!v.valid) {
      for (const x of v.issues.slice(0, 3))
        issues.push({
          path: `${at}${x.path ? `.${x.path}` : ""}`,
          message: `not a valid fact (fact_validate): ${x.message}`,
        });
      return;
    }
    const id = String(f.id);
    const predicate = String(f.predicate);
    const sources = (f.provenance as { sources?: unknown } | undefined)
      ?.sources;
    const src = Array.isArray(sources)
      ? (sources[0] as Json | undefined)
      : undefined;
    if (
      !src ||
      typeof src.quote !== "string" ||
      src.quote.trim() === "" ||
      typeof src.page !== "number"
    ) {
      issues.push({
        path: `${at}.provenance.sources`,
        message:
          "no source: every fact the estoppel reads needs a quote and a page (no source, no statement)",
      });
      return;
    }
    if (!predicate.startsWith("lease.")) {
      issues.push({
        path: `${at}.predicate`,
        message: `${predicate} is not a lease fact: lease_facts holds lease.* predicates`,
      });
      return;
    }
    if (ids.has(id)) {
      issues.push({ path: `${at}.id`, message: `duplicate fact id ${id}` });
      return;
    }
    ids.add(id);
    const shape = SHAPES[predicate];
    if (!shape) {
      ignored.push(predicate);
      return;
    }
    const parsed = shape.safeParse(f.value);
    if (!parsed.success) {
      issues.push({
        path: `${at}.value`,
        message: `${predicate}: ${parsed.error.issues
          .slice(0, 2)
          .map((x) => `${x.path.join(".") || "value"}: ${x.message}`)
          .join("; ")}`,
      });
      return;
    }
    out.push({
      id,
      predicate,
      value: parsed.data,
      quote: src.quote,
      page: src.page,
      section: typeof src.section === "string" ? src.section : null,
      document_id: typeof src.document_id === "string" ? src.document_id : null,
      valid_from: typeof f.valid_from === "string" ? f.valid_from : null,
      supersedes: Array.isArray(f.supersedes)
        ? (f.supersedes as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [],
    });
  });
  return out;
}

// --- the tool -----------------------------------------------------------------------------------

export function prepareEstoppel(input: EstoppelInput): Json {
  const issues: Issue[] = [];
  const ignoredPredicates: string[] = [];
  const all = readFacts(input.lease_facts, issues, ignoredPredicates);
  if (
    input.parties.tenant.organisation.trim().toLowerCase() ===
    input.parties.landlord.organisation.trim().toLowerCase()
  )
    issues.push({
      path: "parties.tenant.organisation",
      message: "the tenant and the landlord must be different organisations",
    });
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  const asOf = input.as_of;
  const warnings: string[] = [];
  const gaps: Json[] = [];

  // Pending (valid after as_of) and superseded facts are not current.
  const pending = all.filter(
    (f) => f.valid_from !== null && f.valid_from > asOf,
  );
  const pendingIds = new Set(pending.map((f) => f.id));
  const live = all.filter((f) => !pendingIds.has(f.id));
  const supersededBy = new Map<string, string>();
  for (const f of live) for (const s of f.supersedes) supersededBy.set(s, f.id);
  const isCurrent = (f: EFact): boolean => !supersededBy.has(f.id);
  if (pending.length) {
    const dates = [...new Set(pending.map((f) => f.valid_from!))].sort();
    warnings.push(
      `${pending.length} fact${pending.length === 1 ? "" : "s"} take effect after the as-of date (${dates.map(longDate).join(", ")}) and are not used: an amendment that is not yet effective does not change what the tenant certifies today`,
    );
  }

  // ---- documents ----------------------------------------------------------------------------------
  const docOrder: string[] = [];
  for (const f of live)
    if (f.document_id !== null && !docOrder.includes(f.document_id))
      docOrder.push(f.document_id);
  const givenDocs = new Map(
    (input.documents ?? []).map((d) => [d.document_id, d]),
  );
  const docFlags: Flag[] = [];
  const undatedOriginal = docOrder.filter((d) => {
    const g = givenDocs.get(d);
    if (g) return g.role === "original";
    return live
      .filter((f) => f.document_id === d)
      .every((f) => f.valid_from === null);
  });
  interface Doc {
    document_id: string;
    sha256: string | null;
    role: "original" | "amendment" | "unknown";
    title: string | null;
    effective_date: string | null;
    fact_ids: string[];
  }
  const docs: Doc[] = docOrder.map((d) => {
    const g = givenDocs.get(d);
    const fs = live.filter((f) => f.document_id === d);
    const dates = fs
      .map((f) => f.valid_from)
      .filter((x): x is string => x !== null)
      .sort();
    const role: Doc["role"] = g
      ? g.role
      : fs.every((f) => f.valid_from === null)
        ? undatedOriginal.length === 1
          ? "original"
          : "unknown"
        : "amendment";
    return {
      document_id: d,
      sha256: d.startsWith("fl:document:sha256-")
        ? d.slice("fl:document:sha256-".length)
        : null,
      role,
      title: g?.title ?? null,
      effective_date:
        g?.effective_date ?? (role === "amendment" ? (dates[0] ?? null) : null),
      fact_ids: fs.map((f) => f.id),
    };
  });
  for (const d of input.documents ?? [])
    if (!docs.some((x) => x.document_id === d.document_id))
      warnings.push(
        `documents lists ${sha8(d.document_id)} but no fact cites it, so it is not in the lease list`,
      );
  if (docs.filter((d) => d.role === "original").length === 0)
    docFlags.push({
      code: "NO_ORIGINAL_LEASE_IDENTIFIED",
      severity: "check",
      message:
        "no cited document is identified as the original lease (every document's facts carry an amendment effective date, or more than one document has none): give documents with each role",
    });
  if (docs.filter((d) => d.role === "original").length > 1)
    docFlags.push({
      code: "SEVERAL_ORIGINALS",
      severity: "check",
      message:
        "more than one document is marked as the original lease: give documents with each role",
    });
  for (const d of docs)
    if (d.role === "amendment" && d.effective_date === null)
      docFlags.push({
        code: "AMENDMENT_WITHOUT_DATE",
        severity: "check",
        message: `an amendment (${sha8(d.document_id)}) has no effective date: amendments apply in date order, so give its effective_date`,
      });
  const amendments = docs
    .filter((d) => d.role === "amendment")
    .sort((a, b) =>
      (a.effective_date ?? "9999-99-99") < (b.effective_date ?? "9999-99-99")
        ? -1
        : (a.effective_date ?? "9999-99-99") >
            (b.effective_date ?? "9999-99-99")
          ? 1
          : 0,
    );
  const roleOf = (id: string | null): string | null =>
    docs.find((d) => d.document_id === id)?.role ?? null;
  const docLabel = (d: Doc): string => {
    const base =
      d.role === "original"
        ? "the Lease"
        : d.role === "amendment"
          ? `Amendment No. ${amendments.indexOf(d) + 1}${d.effective_date ? `, effective ${longDate(d.effective_date)}` : ""}`
          : "an undated document";
    return `${d.title ? `${d.title} (${base})` : base} (document ${sha8(d.document_id)})`;
  };

  const sourceOf = (f: EFact, role: Source["role"] = "lease"): Source => ({
    fact_id: f.id,
    role,
    predicate: f.predicate,
    document_id: f.document_id,
    document_role: roleOf(f.document_id),
    sha256:
      f.document_id !== null && f.document_id.startsWith("fl:document:sha256-")
        ? f.document_id.slice("fl:document:sha256-".length)
        : null,
    page: f.page,
    quote: f.quote,
    section: f.section,
  });

  // Current fact of a single-valued predicate: conflicts when current facts disagree.
  interface Current {
    fact: EFact | null;
    conflicts: EFact[];
    history: EFact[];
  }
  const currentOf = (predicate: string): Current => {
    const fs = live.filter((f) => f.predicate === predicate);
    const cur = fs.filter(isCurrent);
    const history = fs.filter((f) => !isCurrent(f));
    if (cur.length === 0) return { fact: null, conflicts: [], history };
    const first = cur[0]!;
    const conflicts = cur.filter((c) => !jsonEqual(c.value, first.value));
    return { fact: first, conflicts, history };
  };

  const statements: Statement[] = [];
  const flagsAll: Flag[] = [];
  const byCode = new Map<string, Statement>();
  const add = (
    code: string,
    title: string,
    basis: Basis,
    p: {
      text: string;
      value?: string | number | null;
      unit?: string | null;
      facts?: EFact[];
      history?: EFact[];
      conflicting?: EFact[];
      steps?: string[];
      flags?: Flag[];
      status?: Status;
      needs_tenant_value?: boolean;
      confirm?: string[];
    },
  ): Statement => {
    const number = statements.length + 1;
    const flags = p.flags ?? [];
    const sources: Source[] = [
      ...(p.facts ?? []).map((f) => sourceOf(f)),
      ...(p.history ?? []).map((f) => sourceOf(f, "superseded")),
      ...(p.conflicting ?? []).map((f) => sourceOf(f, "conflicting")),
    ];
    const status: Status =
      p.status ?? (basis === "tenant" ? "tenant_to_confirm" : "ready");
    const st: Statement = {
      number,
      key: `S${String(number).padStart(2, "0")}`,
      code,
      title,
      basis,
      status,
      sendable: status === "ready" || status === "tenant_to_confirm",
      text: p.text,
      value: p.value === undefined ? null : p.value,
      unit: p.unit ?? null,
      needs_tenant_value: p.needs_tenant_value === true,
      sources,
      fact_ids: (p.facts ?? []).map((f) => f.id),
      steps: p.steps ?? [],
      flags,
      confirm:
        p.confirm ?? (basis === "tenant" ? [CONFIRM_TENANT] : [CONFIRM_LEASE]),
    };
    statements.push(st);
    byCode.set(code, st);
    flagsAll.push(...flags);
    return st;
  };
  const ref = (code: string): string =>
    byCode.has(code) ? `statement ${byCode.get(code)!.number}` : "";
  const amendedFlag = (c: Current): Flag[] =>
    c.fact !== null && c.history.length
      ? [
          {
            code: "AMENDED",
            severity: "check",
            message: `changed by amendment: the earlier document's sentence (page ${c.history[0]!.page}) is shown as superseded`,
          },
        ]
      : [];
  const conflictFlag = (c: Current, what: string): Flag => ({
    code: "LEASE_AMENDMENT_CONFLICT",
    severity: "conflict",
    message: `${what}: the lease facts state different values (${[c.fact!, ...c.conflicts].map((f) => `${JSON.stringify(f.value)} in document ${sha8(f.document_id)} page ${f.page}`).join("; ")}) and no amendment is marked as superseding the other: resolve which governs`,
  });
  /** A lease statement from one single-valued predicate. */
  const gapStatement = (
    code: string,
    title: string,
    predicate: string,
    what: string,
  ): void => {
    const flag: Flag = {
      code: "MISSING_LEASE_FACT",
      severity: "gap",
      message: `no verified ${predicate} fact was supplied: ${what}. Nothing is stated, and nothing is guessed`,
    };
    add(code, title, "lease", {
      text: `Not prepared: ${what}.`,
      status: "gap",
      flags: [flag],
      confirm: [],
    });
    gaps.push({ code: "MISSING_LEASE_FACT", predicate, message: flag.message });
  };

  const tenantName = input.parties.tenant.organisation;
  const landlordName = input.parties.landlord.organisation;

  // 1 The lease documents
  {
    const landlordFact = currentOf("lease.landlord");
    const tenantFact = currentOf("lease.tenant");
    const flags: Flag[] = [...docFlags];
    const facts: EFact[] = [];
    if (landlordFact.fact) {
      facts.push(landlordFact.fact);
      if (normName(String(landlordFact.fact.value)) !== normName(landlordName))
        flags.push({
          code: "LANDLORD_NAME_DIFFERS",
          severity: "check",
          message: `the lease names the landlord as "${String(landlordFact.fact.value)}", the certificate as "${landlordName}": confirm they are the same party (assignment, merger or a name change)`,
        });
    }
    if (tenantFact.fact) {
      facts.push(tenantFact.fact);
      if (normName(String(tenantFact.fact.value)) !== normName(tenantName))
        flags.push({
          code: "TENANT_NAME_DIFFERS",
          severity: "check",
          message: `the lease names the tenant as "${String(tenantFact.fact.value)}", the certificate as "${tenantName}": confirm they are the same party (assignment, merger or a name change)`,
        });
    }
    if (!landlordFact.fact) {
      const message =
        "no lease.landlord fact was supplied: the lease's landlord is not sourced";
      flags.push({ code: "MISSING_LEASE_FACT", severity: "gap", message });
      gaps.push({
        code: "MISSING_LEASE_FACT",
        predicate: "lease.landlord",
        message,
      });
    }
    if (!tenantFact.fact) {
      const message =
        "no lease.tenant fact was supplied: the lease's tenant is not sourced";
      flags.push({ code: "MISSING_LEASE_FACT", severity: "gap", message });
      gaps.push({
        code: "MISSING_LEASE_FACT",
        predicate: "lease.tenant",
        message,
      });
    }
    // One representative fact per document, so every listed document has a quote and a fingerprint behind it.
    for (const d of docs) {
      const rep = live.find(
        (f) =>
          f.document_id === d.document_id && !facts.some((x) => x.id === f.id),
      );
      if (rep && !facts.some((x) => x.document_id === d.document_id))
        facts.push(rep);
    }
    for (const x of [landlordFact, tenantFact])
      if (x.conflicts.length)
        flags.push(
          conflictFlag(x, x === landlordFact ? "the landlord" : "the tenant"),
        );
    const listed = docs
      .filter((d) => d.role === "original" || d.role === "unknown")
      .concat(amendments);
    const list = listed.map(docLabel).join("; ");
    const sourced = facts.length > 0;
    const conflictBlock = flags.some((f) => f.severity === "conflict");
    add("LEASE_DOCUMENTS", "The lease and its amendments", "lease", {
      text: `The Lease between ${landlordName} as landlord and ${tenantName} as tenant for ${input.premises.label} consists of: ${list || "no document is cited by the facts"}.`,
      value:
        amendments.length === 0
          ? "The Lease, no amendments"
          : `The Lease and ${plural(amendments.length, "amendment", "amendments")}`,
      facts,
      flags,
      status: !sourced ? "gap" : conflictBlock ? "conflict" : "ready",
      steps: listed.map(
        (d) =>
          `${docLabel(d)}: ${d.fact_ids.length} fact${d.fact_ids.length === 1 ? "" : "s"} cite it`,
      ),
      confirm: [
        "that these are every document that makes up the lease, with no side letter, estoppel, consent or work letter left out",
      ],
    });
  }

  // 2 No other modification (tenant)
  add("NO_OTHER_MODIFICATION", "No other agreements", "tenant", {
    text: `The Lease has not been amended, modified, supplemented or assigned except by the documents listed in ${ref("LEASE_DOCUMENTS") || "the list above"}, and there is no other agreement, side letter or understanding between Landlord and Tenant about the Premises.`,
    value: "As stated",
  });

  // 3 Commencement
  const comm = currentOf("lease.commencement_date");
  if (!comm.fact)
    gapStatement(
      "COMMENCEMENT",
      "Commencement date",
      "lease.commencement_date",
      "the commencement date is not in the facts supplied",
    );
  else {
    const d = comm.fact.value as string;
    add("COMMENCEMENT", "Commencement date", "lease", {
      text: `The term of the Lease ${d > asOf ? "commences" : "commenced"} on ${longDate(d)}.`,
      value: d,
      facts: [comm.fact],
      history: comm.history,
      conflicting: comm.conflicts,
      status: comm.conflicts.length ? "conflict" : "ready",
      flags: [
        ...amendedFlag(comm),
        ...(comm.conflicts.length
          ? [conflictFlag(comm, "the commencement date")]
          : []),
        ...(d > asOf
          ? [
              {
                code: "TERM_NOT_STARTED",
                severity: "check" as const,
                message: `the term starts after the as-of date (${longDate(asOf)})`,
              },
            ]
          : []),
      ],
    });
  }

  // 4 Expiration
  const exp = currentOf("lease.expiration_date");
  if (!exp.fact)
    gapStatement(
      "EXPIRATION",
      "Expiration date",
      "lease.expiration_date",
      "the expiration date is not in the facts supplied",
    );
  else {
    const d = exp.fact.value as string;
    const flags: Flag[] = [
      ...amendedFlag(exp),
      ...(exp.conflicts.length
        ? [conflictFlag(exp, "the expiration date")]
        : []),
    ];
    if (d < asOf)
      flags.push({
        code: "TERM_EXPIRED",
        severity: "check",
        message: `the expiration date is before the as-of date (${longDate(asOf)}): confirm the tenant is holding over or the term was extended`,
      });
    if (comm.fact && d < (comm.fact.value as string))
      flags.push({
        code: "EXPIRATION_BEFORE_COMMENCEMENT",
        severity: "conflict",
        message: `the expiration date (${longDate(d)}) is before the commencement date (${longDate(comm.fact.value as string)}): the lease facts do not agree`,
      });
    add("EXPIRATION", "Expiration date", "lease", {
      text: `The term of the Lease ${d < asOf ? "expired" : "expires"} on ${longDate(d)}, unless it is extended or ended earlier as the Lease permits.`,
      value: d,
      facts: [exp.fact],
      history: exp.history,
      conflicting: exp.conflicts,
      status:
        exp.conflicts.length || flags.some((f) => f.severity === "conflict")
          ? "conflict"
          : "ready",
      flags,
    });
  }

  // 5 Premises
  const area = currentOf("lease.rentable_area_sf");
  if (!area.fact)
    gapStatement(
      "PREMISES",
      "Premises",
      "lease.rentable_area_sf",
      "the rentable area is not in the facts supplied",
    );
  else
    add("PREMISES", "Premises", "lease", {
      text: `The Premises are ${input.premises.label}, containing ${sf(area.fact.value as number)} rentable square feet.`,
      value: area.fact.value as number,
      unit: "SF",
      facts: [area.fact],
      history: area.history,
      conflicting: area.conflicts,
      status: area.conflicts.length ? "conflict" : "ready",
      flags: [
        ...amendedFlag(area),
        ...(area.conflicts.length
          ? [conflictFlag(area, "the rentable area")]
          : []),
      ],
      confirm: [
        CONFIRM_LEASE,
        "that the address and suite in the certificate are the premises the quoted sentence describes",
      ],
    });
  const areaSf =
    area.fact && !area.conflicts.length ? (area.fact.value as number) : null;

  // 6 and 7 Base rent now and next
  let rentMonthly: number | null = null;
  {
    interface Step {
      from: string;
      to: string;
      psf: number;
      fact: EFact;
      current: boolean;
    }
    const schedFacts = live.filter(
      (f) => f.predicate === "lease.base_rent_schedule",
    );
    const accepted: Step[] = [];
    const flagsRent: Flag[] = [];
    let conflicted = false;
    const stepsOf = (f: EFact): Step[] =>
      (f.value as { from: string; to: string; annual_rent_psf: number }[]).map(
        (s) => ({
          from: s.from,
          to: s.to,
          psf: s.annual_rent_psf,
          fact: f,
          current: isCurrent(f),
        }),
      );
    const overlaps = (a: Step, b: Step): boolean =>
      a.from <= b.to && b.from <= a.to;
    for (const f of schedFacts.filter(isCurrent))
      for (const s of stepsOf(f)) {
        const clash = accepted.find((a) => overlaps(a, s));
        if (clash) {
          if (clash.psf !== s.psf) {
            conflicted = true;
            flagsRent.push({
              code: "LEASE_AMENDMENT_CONFLICT",
              severity: "conflict",
              message: `the rent schedule facts overlap with different rents (${money(clash.psf)} and ${money(s.psf)} per square foot around ${longDate(s.from)}) and no amendment is marked as superseding the other: resolve which governs`,
            });
          }
          continue;
        }
        accepted.push(s);
      }
    const carried: Step[] = [];
    for (const f of schedFacts.filter((x) => !isCurrent(x)))
      for (const s of stepsOf(f))
        if (
          !accepted.some((a) => overlaps(a, s)) &&
          !carried.some((a) => overlaps(a, s))
        ) {
          carried.push(s);
        }
    const steps = [...accepted, ...carried].sort((a, b) =>
      a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
    );
    const replaced = schedFacts.filter((f) => !isCurrent(f));
    if (steps.length === 0) {
      gapStatement(
        "BASE_RENT",
        "Base rent now",
        "lease.base_rent_schedule",
        "the base rent schedule is not in the facts supplied",
      );
      gapStatement(
        "NEXT_RENT_STEP",
        "Next change in base rent",
        "lease.base_rent_schedule",
        "the next rent step cannot be found without the base rent schedule",
      );
    } else {
      // Contiguity and coverage checks.
      for (let i = 0; i + 1 < steps.length; i++) {
        const a = steps[i]!,
          b = steps[i + 1]!;
        if (addDays(a.to, 1) !== b.from)
          flagsRent.push({
            code: "RENT_SCHEDULE_GAP",
            severity: "check",
            message: `the rent schedule does not run on from ${longDate(a.to)} to ${longDate(b.from)}: the rent between them is not stated`,
          });
      }
      if (comm.fact && steps[0]!.from > (comm.fact.value as string))
        flagsRent.push({
          code: "RENT_SCHEDULE_STARTS_LATE",
          severity: "check",
          message: `the rent schedule starts ${longDate(steps[0]!.from)}, after the commencement date (${longDate(comm.fact.value as string)}): the rent before it is not stated (free rent?)`,
        });
      if (exp.fact && steps[steps.length - 1]!.to < (exp.fact.value as string))
        flagsRent.push({
          code: "RENT_SCHEDULE_ENDS_EARLY",
          severity: "check",
          message: `the rent schedule ends ${longDate(steps[steps.length - 1]!.to)}, before the expiration date (${longDate(exp.fact.value as string)}): the rent after it is not stated`,
        });
      const nowStep = steps.find((s) => s.from <= asOf && asOf <= s.to);
      const next = steps.find((s) => s.from > asOf);
      const amounts = (
        s: Step,
      ): { annual: number | null; monthly: number | null } => {
        if (areaSf === null) return { annual: null, monthly: null };
        const annual = usd(s.psf * areaSf);
        return { annual, monthly: usd(annual / 12) };
      };
      const areaFacts = area.fact ? [area.fact] : [];
      const areaFlag: Flag[] =
        areaSf === null
          ? [
              {
                code: "MISSING_LEASE_FACT",
                severity: "gap",
                message:
                  "no usable lease.rentable_area_sf fact: the annual and monthly amounts cannot be computed, only the rate per square foot",
              },
            ]
          : [];
      if (areaSf === null)
        gaps.push({
          code: "MISSING_LEASE_FACT",
          predicate: "lease.rentable_area_sf",
          message: areaFlag[0]!.message,
        });
      const stepNote = (s: Step): string[] => [
        `Step ${longDate(s.from)} to ${longDate(s.to)}: ${money(s.psf)} per rentable square foot per year`,
        ...(areaSf !== null
          ? [
              `${money(s.psf)} x ${sf(areaSf)} SF = ${money(amounts(s).annual!)} per year`,
              `${money(amounts(s).annual!)} / 12 = ${money(amounts(s).monthly!)} per month`,
            ]
          : []),
      ];
      const histOf = (s: Step): EFact[] =>
        s.current
          ? replaced.filter((f) => stepsOf(f).some((x) => overlaps(x, s)))
          : [];
      if (!nowStep || conflicted) {
        const flag: Flag = conflicted
          ? flagsRent.find((f) => f.severity === "conflict")!
          : {
              code: "RENT_SCHEDULE_DOES_NOT_COVER_AS_OF",
              severity: "gap",
              message: `the rent schedule has no step covering the as-of date (${longDate(asOf)}): the current rent is not stated`,
            };
        add("BASE_RENT", "Base rent now", "lease", {
          text: `Not prepared: ${conflicted ? "the rent schedule facts conflict" : "the rent schedule has no step covering the as-of date"}.`,
          facts: schedFacts.filter(isCurrent),
          status: conflicted ? "conflict" : "gap",
          flags: [flag, ...flagsRent.filter((f) => f !== flag)],
          confirm: [],
        });
        if (!conflicted)
          gaps.push({
            code: flag.code,
            predicate: "lease.base_rent_schedule",
            message: flag.message,
          });
      } else {
        const a = amounts(nowStep);
        rentMonthly = a.monthly;
        add("BASE_RENT", "Base rent now", "lease", {
          text:
            a.annual !== null
              ? `As of ${longDate(asOf)}, annual base rent is ${money(a.annual)} (${money(nowStep.psf)} per rentable square foot), payable at ${money(a.monthly!)} per month.`
              : `As of ${longDate(asOf)}, annual base rent is ${money(nowStep.psf)} per rentable square foot.`,
          value: a.annual ?? nowStep.psf,
          unit: a.annual !== null ? "USD per year" : "USD per SF per year",
          facts: [
            nowStep.fact,
            ...areaFacts.filter((x) => x.id !== nowStep.fact.id),
          ],
          history: histOf(nowStep),
          steps: stepNote(nowStep),
          flags: [
            ...flagsRent,
            ...areaFlag,
            ...(histOf(nowStep).length
              ? [
                  {
                    code: "AMENDED",
                    severity: "check" as const,
                    message:
                      "changed by amendment: the earlier document's schedule is shown as superseded",
                  },
                ]
              : []),
          ],
        });
      }
      if (nowStep && !conflicted) {
        if (!next) {
          add("NEXT_RENT_STEP", "Next change in base rent", "lease", {
            text: `The rent schedule provides no change in base rent after ${longDate(asOf)}.`,
            value: "None scheduled",
            facts: [nowStep.fact],
            steps: [
              `The last step in the schedule runs ${longDate(nowStep.from)} to ${longDate(steps[steps.length - 1]!.to)}`,
            ],
            flags: [
              {
                code: "CHECK_OTHER_ESCALATIONS",
                severity: "check",
                message:
                  "the schedule is the only rent term read: confirm the lease has no other escalation (a rate index, a fair-market reset) that the facts do not capture",
              },
            ],
          });
        } else {
          const a = amounts(next);
          add("NEXT_RENT_STEP", "Next change in base rent", "lease", {
            text:
              a.annual !== null
                ? `Base rent next changes on ${longDate(next.from)}, to ${money(a.annual)} per year (${money(next.psf)} per rentable square foot), payable at ${money(a.monthly!)} per month.`
                : `Base rent next changes on ${longDate(next.from)}, to ${money(next.psf)} per rentable square foot per year.`,
            value: a.annual ?? next.psf,
            unit: a.annual !== null ? "USD per year" : "USD per SF per year",
            facts: [
              next.fact,
              ...areaFacts.filter((x) => x.id !== next.fact.id),
            ],
            history: histOf(next),
            steps: stepNote(next),
            flags: [...areaFlag],
          });
        }
      } else if (steps.length) {
        add("NEXT_RENT_STEP", "Next change in base rent", "lease", {
          text: "Not prepared: the next rent step cannot be found while the current rent is not established.",
          status: conflicted ? "conflict" : "gap",
          flags: [],
          confirm: [],
        });
      }
    }
  }

  // 8 Security deposit (lease) and 9 paid (tenant)
  const dep = currentOf("lease.security_deposit");
  if (!dep.fact)
    gapStatement(
      "SECURITY_DEPOSIT",
      "Security deposit",
      "lease.security_deposit",
      "the security deposit is not in the facts supplied",
    );
  else
    add("SECURITY_DEPOSIT", "Security deposit", "lease", {
      text: `The security deposit under the Lease is ${money(dep.fact.value as number)}.`,
      value: dep.fact.value as number,
      unit: "USD",
      facts: [dep.fact],
      history: dep.history,
      conflicting: dep.conflicts,
      status: dep.conflicts.length ? "conflict" : "ready",
      flags: [
        ...amendedFlag(dep),
        ...(dep.conflicts.length
          ? [conflictFlag(dep, "the security deposit")]
          : []),
      ],
    });
  {
    const held = input.landlord_records?.security_deposit_held;
    const flags: Flag[] = [];
    if (
      held !== undefined &&
      dep.fact &&
      usd(held) !== usd(dep.fact.value as number)
    )
      flags.push({
        code: "DEPOSIT_LEDGER_DIFFERS",
        severity: "check",
        message: `the landlord's ledger shows ${money(held)} held; the lease states ${money(dep.fact.value as number)}: settle the difference before sending`,
      });
    add("SECURITY_DEPOSIT_PAID", "Security deposit paid", "tenant", {
      text:
        held !== undefined
          ? `Tenant has paid a security deposit of ${money(held)} to Landlord, and no part of it has been applied, drawn on or returned.`
          : "Tenant has paid the security deposit to Landlord in full, and no part of it has been applied, drawn on or returned.",
      value: held !== undefined ? held : "As stated",
      unit: held !== undefined ? "USD" : null,
      flags,
    });
  }

  // 10 Rent paid through (tenant) and 11 no prepaid rent (tenant)
  {
    const through = input.landlord_records?.rent_paid_through;
    add("RENT_PAID_THROUGH", "Rent paid through", "tenant", {
      text:
        through !== undefined
          ? `Base rent and additional rent have been paid through ${longDate(through)}.`
          : "Base rent and additional rent have been paid through the date the tenant states below.",
      value: through !== undefined ? through : "To be stated by the tenant",
      needs_tenant_value: through === undefined,
      flags:
        through === undefined
          ? [
              {
                code: "TENANT_TO_STATE",
                severity: "check",
                message:
                  "no date was supplied from the landlord's records: the tenant states the date",
              },
            ]
          : [],
      confirm: [
        through !== undefined
          ? "that the date comes from the landlord's own rent records (it is not a lease term) and that the tenant is asked to confirm it"
          : CONFIRM_TENANT,
      ],
    });
    add("NO_PREPAID_RENT", "No rent paid in advance", "tenant", {
      text: "No rent has been paid more than one month in advance.",
      value: "As stated",
    });
  }

  // 12 Free rent, 13 TI allowance, 14 landlord obligations
  const free = currentOf("lease.free_rent");
  if (free.fact) {
    const v = free.fact.value as { months?: number; applies_to?: string };
    add("FREE_RENT", "Free rent", "lease", {
      text: `The Lease grants ${v.months !== undefined ? plural(v.months, "month", "months") + " of" : ""} ${v.applies_to === "gross_rent" ? "abated gross rent" : v.applies_to === "base_rent" ? "abated base rent" : "abated rent"}.`.replace(
        /\s+/g,
        " ",
      ),
      value: v.months !== undefined ? `${num(v.months)} months` : "Abatement",
      facts: [free.fact],
      history: free.history,
      conflicting: free.conflicts,
      status: free.conflicts.length ? "conflict" : "ready",
      flags: [
        ...amendedFlag(free),
        ...(free.conflicts.length ? [conflictFlag(free, "the free rent")] : []),
      ],
    });
  } else
    gaps.push({
      code: "MISSING_LEASE_FACT",
      predicate: "lease.free_rent",
      message:
        "no lease.free_rent fact was supplied: if the lease grants free rent, add it; if not, the tenant confirms below that none remains",
    });
  const ti = currentOf("lease.ti_allowance");
  if (ti.fact) {
    const v = ti.fact.value as number | { amount: number; per_sf?: number };
    const amount = typeof v === "number" ? v : v.amount;
    add("TI_ALLOWANCE", "Tenant improvement allowance", "lease", {
      text: `The Lease provides a tenant improvement allowance of ${money(amount)}${typeof v === "object" && v.per_sf !== undefined ? ` (${money(v.per_sf)} per rentable square foot)` : ""}.`,
      value: amount,
      unit: "USD",
      facts: [ti.fact],
      history: ti.history,
      conflicting: ti.conflicts,
      status: ti.conflicts.length ? "conflict" : "ready",
      flags: [
        ...amendedFlag(ti),
        ...(ti.conflicts.length ? [conflictFlag(ti, "the allowance")] : []),
      ],
    });
  } else
    gaps.push({
      code: "MISSING_LEASE_FACT",
      predicate: "lease.ti_allowance",
      message:
        "no lease.ti_allowance fact was supplied: if the lease grants an allowance, add it; if not, the tenant confirms below that Landlord owes none",
    });
  add("LANDLORD_OBLIGATIONS", "Landlord obligations outstanding", "tenant", {
    text: `Landlord has completed every improvement and paid every allowance it owes Tenant${byCode.has("TI_ALLOWANCE") ? ` (including the allowance in ${ref("TI_ALLOWANCE")})` : ""}, and no free rent, abatement or other concession remains to be given${byCode.has("FREE_RENT") ? ` (including the abatement in ${ref("FREE_RENT")})` : ""}.`,
    value: "None outstanding",
  });

  // 15 to 19 Options
  const optionSources: string[] = [];
  const renewal = currentOf("lease.renewal_option");
  const renewalDeadline = currentOf("lease.renewal_notice_deadline");
  if (renewal.fact) {
    const v = renewal.fact.value as {
      count?: number;
      term_months?: number;
      notice_months?: number;
      rent?: string;
    };
    const flags: Flag[] = [
      ...amendedFlag(renewal),
      ...(renewal.conflicts.length
        ? [conflictFlag(renewal, "the renewal option")]
        : []),
    ];
    const facts = [renewal.fact];
    let tail = "";
    if (renewalDeadline.fact) {
      const dl = renewalDeadline.fact.value as string;
      facts.push(renewalDeadline.fact);
      tail = ` Notice must be given by ${longDate(dl)}.`;
      if (dl < asOf)
        flags.push({
          code: "OPTION_NOTICE_DATE_PASSED",
          severity: "check",
          message: `the renewal notice date (${longDate(dl)}) is before the as-of date: confirm whether the option was exercised or has lapsed`,
        });
    }
    add("OPTION_RENEWAL", "Renewal option", "lease", {
      text: `Tenant has ${v.count !== undefined ? (v.count === 1 ? "one option" : `${num(v.count)} options`) : "an option"} to extend the term${v.term_months !== undefined ? ` for ${plural(v.term_months, "month", "months")}` : ""}${v.notice_months !== undefined ? ` on ${plural(v.notice_months, "month's", "months'")} notice` : ""}${v.rent !== undefined ? ` at ${v.rent}` : ""}.${tail}`,
      value:
        v.term_months !== undefined
          ? `${num(v.term_months)} months`
          : "Option to extend",
      facts,
      history: renewal.history,
      conflicting: renewal.conflicts,
      status: renewal.conflicts.length ? "conflict" : "ready",
      flags,
    });
    optionSources.push("OPTION_RENEWAL");
  } else
    gaps.push({
      code: "MISSING_LEASE_FACT",
      predicate: "lease.renewal_option",
      message:
        "no lease.renewal_option fact was supplied: the tenant confirms below that it has no other right to renew",
    });

  const spaceRights = ["lease.rofr", "lease.rofo"]
    .map((p) => ({ p, c: currentOf(p) }))
    .filter(
      (x) =>
        x.c.fact &&
        (typeof x.c.fact.value === "string" ||
          (x.c.fact.value as { applies_to: string }).applies_to === "space"),
    );
  const expansion = currentOf("lease.expansion_option");
  const expansionDeadline = currentOf("lease.expansion_option_deadline");
  if (expansion.fact || spaceRights.length) {
    const parts: string[] = [];
    const facts: EFact[] = [];
    const flags: Flag[] = [];
    if (expansion.fact) {
      const v = expansion.fact.value as string | { description: string };
      parts.push(
        `Tenant has an option to expand: ${typeof v === "string" ? v : v.description}.`,
      );
      facts.push(expansion.fact);
      flags.push(...amendedFlag(expansion));
      if (expansionDeadline.fact) {
        const dl = expansionDeadline.fact.value as string;
        facts.push(expansionDeadline.fact);
        parts.push(`It must be exercised by ${longDate(dl)}.`);
        if (dl < asOf)
          flags.push({
            code: "OPTION_NOTICE_DATE_PASSED",
            severity: "check",
            message: `the expansion date (${longDate(dl)}) is before the as-of date: confirm whether the option was exercised or has lapsed`,
          });
      }
    }
    for (const x of spaceRights) {
      const v = x.c.fact!.value as
        string | { description: string; response_days?: number };
      const kind =
        x.p === "lease.rofr"
          ? "a right of first refusal"
          : "a right of first offer";
      parts.push(
        `Tenant has ${kind} on additional space: ${typeof v === "string" ? v : v.description}${typeof v === "object" && v.response_days !== undefined ? `, to be answered within ${plural(v.response_days, "day", "days")}` : ""}.`,
      );
      facts.push(x.c.fact!);
      flags.push(...amendedFlag(x.c));
    }
    add("OPTION_EXPANSION", "Expansion and space rights", "lease", {
      text: parts.join(" "),
      value: "Rights stated",
      facts,
      flags,
    });
    optionSources.push("OPTION_EXPANSION");
  } else
    gaps.push({
      code: "MISSING_LEASE_FACT",
      predicate: "lease.expansion_option",
      message:
        "no expansion, first-refusal or first-offer fact on space was supplied: the tenant confirms below that it has no other right",
    });

  const term = currentOf("lease.termination_option");
  const termDeadline = currentOf("lease.termination_notice_deadline");
  if (term.fact) {
    const v = term.fact.value as {
      effective_date?: string;
      notice_months?: number;
      fee?: string;
    };
    const flags: Flag[] = [
      ...amendedFlag(term),
      ...(term.conflicts.length
        ? [conflictFlag(term, "the termination option")]
        : []),
    ];
    const facts = [term.fact];
    let tail = "";
    if (termDeadline.fact) {
      const dl = termDeadline.fact.value as string;
      facts.push(termDeadline.fact);
      tail = ` Notice must be given by ${longDate(dl)}.`;
      if (dl < asOf)
        flags.push({
          code: "OPTION_NOTICE_DATE_PASSED",
          severity: "check",
          message: `the termination notice date (${longDate(dl)}) is before the as-of date: confirm whether the right was exercised or has lapsed`,
        });
    }
    add("OPTION_TERMINATION", "Termination option", "lease", {
      text: `Tenant may terminate the Lease early${v.effective_date !== undefined ? `, effective ${longDate(v.effective_date)}` : ""}${v.notice_months !== undefined ? `, on ${plural(v.notice_months, "month's", "months'")} notice` : ""}${v.fee !== undefined ? `, on payment of ${v.fee}` : ""}.${tail}`,
      value: v.effective_date ?? "Right to terminate",
      facts,
      history: term.history,
      conflicting: term.conflicts,
      status: term.conflicts.length ? "conflict" : "ready",
      flags,
    });
    optionSources.push("OPTION_TERMINATION");
  } else
    gaps.push({
      code: "MISSING_LEASE_FACT",
      predicate: "lease.termination_option",
      message:
        "no lease.termination_option fact was supplied: the tenant confirms below that it has no other right to terminate early",
    });

  const purchaseRights = ["lease.rofr", "lease.rofo"]
    .map((p) => ({ p, c: currentOf(p) }))
    .filter(
      (x) =>
        x.c.fact &&
        typeof x.c.fact.value !== "string" &&
        (x.c.fact.value as { applies_to: string }).applies_to === "purchase",
    );
  const purchase = currentOf("lease.purchase_option");
  if (purchase.fact || purchaseRights.length) {
    const parts: string[] = [];
    const facts: EFact[] = [];
    const flags: Flag[] = [];
    if (purchase.fact) {
      const v = purchase.fact.value as
        string | { description: string; price?: string };
      parts.push(
        `Tenant has an option to purchase: ${typeof v === "string" ? v : `${v.description}${v.price !== undefined ? `, at ${v.price}` : ""}`}.`,
      );
      facts.push(purchase.fact);
      flags.push(...amendedFlag(purchase));
    }
    for (const x of purchaseRights) {
      const v = x.c.fact!.value as {
        description: string;
        response_days?: number;
      };
      parts.push(
        `Tenant has ${x.p === "lease.rofr" ? "a right of first refusal" : "a right of first offer"} to purchase: ${v.description}${v.response_days !== undefined ? `, to be answered within ${plural(v.response_days, "day", "days")}` : ""}.`,
      );
      facts.push(x.c.fact!);
      flags.push(...amendedFlag(x.c));
    }
    add("OPTION_PURCHASE", "Purchase option or first refusal", "lease", {
      text: parts.join(" "),
      value: "Rights stated",
      facts,
      flags,
    });
    optionSources.push("OPTION_PURCHASE");
  } else
    gaps.push({
      code: "MISSING_LEASE_FACT",
      predicate: "lease.purchase_option",
      message:
        "no purchase option or first-refusal fact on the property was supplied: the tenant confirms below that it has none",
    });

  add("OPTIONS_COMPLETE", "No other options or rights", "tenant", {
    text:
      optionSources.length > 0
        ? `Tenant has no option or right to renew or extend the term, expand the Premises, terminate the Lease early, or purchase the Premises or the Property, other than those stated in ${optionSources.map((c) => ref(c)).join(", ")}.`
        : "Tenant has no option or right to renew or extend the term, expand the Premises, terminate the Lease early, or purchase the Premises or the Property.",
    value: "As stated",
    flags:
      optionSources.length === 0
        ? [
            {
              code: "NO_OPTION_FACTS",
              severity: "check",
              message:
                "no option fact was supplied, so this statement says there are none: confirm from the lease that it grants none before sending",
            },
          ]
        : [],
  });

  // 20 to 22 Defaults, assignment
  add("NO_LANDLORD_DEFAULT", "No landlord default or claims", "tenant", {
    text: "To Tenant's knowledge, Landlord is not in default under the Lease, and Tenant has no offset, defense, counterclaim or claim against Landlord.",
    value: "As stated",
  });
  add("NO_TENANT_DEFAULT", "No tenant default", "tenant", {
    text: "Tenant is not in default under the Lease, and no event has occurred that, with notice or the passage of time, would be a default by Tenant.",
    value: "As stated",
  });
  add("NO_ASSIGNMENT_OR_SUBLEASE", "No assignment or sublease", "tenant", {
    text: "Tenant has not assigned the Lease or sublet or licensed any part of the Premises, and Tenant is in possession of the Premises.",
    value: "As stated",
  });

  // ---- output ---------------------------------------------------------------------------------
  const sendable = statements.filter((s) => s.sendable);
  const packageFactIds: string[] = [];
  for (const s of sendable)
    for (const id of s.fact_ids)
      if (!packageFactIds.includes(id)) packageFactIds.push(id);
  const items: Json[] = sendable.map((s) => ({
    key: s.key,
    label: s.title,
    value: s.value === null ? "As stated" : s.value,
    ...(s.unit !== null ? { unit: s.unit.slice(0, 30) } : {}),
    position: "state_ours",
    fact_ids: s.fact_ids,
    note:
      s.basis === "tenant"
        ? "Only the tenant can confirm this; the lease does not say."
        : "From the lease: the quote and page are shown.",
    number: s.number,
    text: s.text,
    ...(s.basis === "tenant" ? { tenant_to_confirm: true } : {}),
    ...(s.needs_tenant_value ? { needs_tenant_value: true } : {}),
  }));
  const rentNow = byCode.get("BASE_RENT");
  const annualOf = (s: Statement | undefined): number | null =>
    s &&
    s.status === "ready" &&
    s.unit === "USD per year" &&
    typeof s.value === "number"
      ? s.value
      : null;
  const annual = annualOf(rentNow);
  const factsUsed = new Set<string>();
  for (const s of statements)
    for (const src of s.sources) factsUsed.add(src.fact_id);
  const conflicts = statements
    .filter((s) => s.status === "conflict")
    .map((s) => ({
      number: s.number,
      code: s.code,
      flags: s.flags
        .filter((f) => f.severity === "conflict")
        .map((f) => f.message),
    }));
  const fromLease = statements.filter(
    (s) => s.basis === "lease" && s.sendable,
  ).length;
  const tenantTo = statements.filter((s) => s.basis === "tenant").length;
  const gapsN = statements.filter((s) => s.status === "gap").length;
  return {
    as_of: asOf,
    premises: input.premises.label,
    parties: {
      tenant: tenantName,
      landlord: landlordName,
      ...(input.parties.requested_by
        ? { requested_by: input.parties.requested_by }
        : {}),
    },
    statements: statements as unknown as Json[],
    documents: docs.map((d) => ({
      ...d,
      label: docLabel(d),
    })) as unknown as Json[],
    key_figures: {
      commencement_date:
        comm.fact && !comm.conflicts.length ? comm.fact.value : null,
      expiration_date:
        exp.fact && !exp.conflicts.length ? exp.fact.value : null,
      annual_base_rent: annual,
      monthly_base_rent: annual !== null ? rentMonthly : null,
      security_deposit:
        dep.fact && !dep.conflicts.length ? dep.fact.value : null,
      rentable_area_sf: areaSf,
    },
    totals: {
      statement_count: statements.length,
      from_lease: fromLease,
      tenant_to_confirm: tenantTo,
      gaps: gapsN,
      conflicts: conflicts.length,
      sendable: sendable.length,
    },
    gaps,
    conflicts,
    flags: flagsAll,
    package_facts: packageFactIds,
    package_items: items,
    statements_withheld: statements
      .filter((s) => !s.sendable)
      .map((s) => ({ key: s.key, code: s.code, reason: s.status })),
    facts_used: [...factsUsed],
    facts_ignored: [...new Set(ignoredPredicates)],
    warnings,
    notes: [
      "These statements are facts and arithmetic, not legal advice. A statement marked from the lease shows the quote and page it rests on; a statement marked tenant to confirm has no lease source because only the tenant can know it.",
      "The tenant's signature, not FactLot, is what makes this certificate an estoppel. FactLot prepares the statements and records who confirmed or disputed each; nothing here binds the tenant until the tenant answers.",
      "A statement with a gap or a conflict is withheld from the items to send until a person resolves it.",
    ],
  };
}

/** The summary a caller without a paid plan gets (hosted API, gating on): counts and what could not be prepared. */
export function estoppelSummary(full: Json): Json {
  const sts = full.statements as unknown as Statement[];
  return {
    limited: true,
    summary: {
      as_of: full.as_of,
      totals: full.totals,
      statements: sts.map((s) => ({
        number: s.number,
        title: s.title,
        basis: s.basis,
        status: s.status,
      })),
      gaps: (full.gaps as Json[]).map((g) => ({
        code: g.code,
        predicate: g.predicate,
      })),
      conflicts: (full.conflicts as Json[]).map((c) => ({
        number: c.number,
        code: c.code,
      })),
    },
    estoppel_available: "pro",
    estoppel_withheld: [
      "the text of each statement, with the lease quote, page and document fingerprint behind it",
      "the flags (amendment changes, name differences, dates that have passed)",
      "the items to send with fact_package_send",
      "the estoppel certificate (report_create kind estoppel_certificate)",
    ],
    estoppel_note: `The count of statements, which are from the lease and which the tenant must confirm, and the gaps and conflicts are free. Each statement with its lease quote, the certificate and sending it to the tenant are part of the paid plans (Pro and Team): ${ESTOPPEL_PLAN_URL}`,
  };
}

/** True when the host (the hosted Worker) has said this caller gets the summary only. */
export function estoppelLimited(): boolean {
  return currentExchangeCaller()?.fullAudit === false;
}

export function estoppelPrepare(input: EstoppelInput): Json {
  const full = prepareEstoppel(input);
  return gateDocument(
    "estoppel_prepare",
    full,
    estoppelSummary,
    estoppelLimited(),
  );
}
