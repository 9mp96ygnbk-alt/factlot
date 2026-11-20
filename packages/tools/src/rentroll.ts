/**
 * rent_roll_certify: check a commercial rent roll, line by line, against the leases and (where there
 * is one) the tenant's estoppel answers, and grade each line.
 *
 * Input: the rent roll's lines as verified facts (rent_roll.* predicates, each with the verbatim quote
 * and page from the rent roll document), the leases as verified facts (lease.* predicates, with
 * amendments), the property's as-of date and, per lease, optionally the answers of a confirmed
 * estoppel. Output: a grade for each line (matches lease; matches lease and confirmed by tenant;
 * differs, with both figures, the difference and the quotes; no lease supplied; not checkable, with
 * the reason), the totals (occupied and vacant area, occupancy, annual base rent as stated and as the
 * leases yield, the difference, WALT by calc.walt, rollover by year, top-tenant concentration), the
 * flags, and the items to hand to fact_package_send kind rent_roll.
 *
 * Rules: deterministic (same facts, same grades; no model, no clock: `as_of` is an input); no source,
 * no fact (a figure on the roll or in a lease without a verified fact behind it is never used);
 * nothing is approximated (a field the lease facts do not cover is "not checked", never assumed to
 * match). A line is "matches" only when its tenant, area, expiration and current base rent were each
 * compared with the lease and agree. These are facts and arithmetic, not legal, appraisal or lending
 * advice: the certifying party's certification, not FactLot, is what a lender or buyer relies on, and
 * FactLot checked the roll against the documents supplied only. python/src/factlot/rentroll.py is
 * the same code; spec/differential runs both on the same inputs.
 *
 * Hosted plan: like audit_expense_statement, a caller without a Pro or Team key gets the summary only
 * (totals, key figures, counts of each grade); the host says so through
 * runWithExchangeCaller({ fullAudit: false }). Locally the answer is whole.
 */
import { addMonths, daysBetween, round, walt } from "@factlot/calc";
import { z } from "zod";

import { ToolInputError, jsonEqual, validateFact } from "./documents.ts";
import type { Json } from "./documents.ts";
import { RENT_ROLL_PACKAGE_FACTS, currentExchangeCaller } from "./exchange.ts";
import { gateDocument } from "./free_document.ts";

export const RENT_ROLL_PLAN_URL = "https://factlot.com/pricing/";
export const RENT_ROLL_MAX_LINES = 60;
/** The most facts the Record takes in one rent roll package. */
export const RENT_ROLL_MAX_PACKAGE_FACTS = RENT_ROLL_PACKAGE_FACTS;

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LineId = z
  .string()
  .regex(/^[A-Za-z0-9_.-]{1,40}$/, "letters, digits, _ . and - only (1 to 40)");
const Org = z.object({
  organisation: z
    .string()
    .min(1)
    .max(120)
    .describe("The organisation's name as the documents use it."),
});
const FactList = (max: number) =>
  z.array(z.record(z.string(), z.unknown())).min(1).max(max);

export const ESTOPPEL_CODES = [
  "COMMENCEMENT",
  "EXPIRATION",
  "PREMISES",
  "BASE_RENT",
  "NEXT_RENT_STEP",
  "SECURITY_DEPOSIT",
  "FREE_RENT",
  "OPTION_RENEWAL",
] as const;

export const RentRollCertifyInput = z.object({
  property: z.object({
    label: z
      .string()
      .min(1)
      .max(240)
      .describe("The property in words: name and address."),
  }),
  as_of: Date_.describe(
    "The date of the rent roll, YYYY-MM-DD. The tool reads no clock: the current rent step, the leases expiring within 12 months and WALT are all measured from this date.",
  ),
  parties: z
    .object({
      certifier: Org.extend({
        role: z
          .enum(["borrower", "seller", "broker"])
          .describe(
            "Who certifies the roll: the borrower or seller (or the broker acting for one). The certifier asserts the roll; the lender or buyer relies on the certifier's certification.",
          ),
      }).describe("The party that certifies the rent roll."),
      relying_party: Org.extend({
        role: z.enum(["lender", "buyer", "other"]),
      })
        .optional()
        .describe("The lender or buyer the certification is for, if known."),
    })
    .describe("The parties."),
  roll_document: z
    .object({
      title: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("The rent roll's title as printed, for the report."),
    })
    .optional()
    .describe("Optional: the rent roll document."),
  building_area_sf: z
    .number()
    .finite()
    .gt(0)
    .optional()
    .describe(
      "Optional: the building's total rentable area. Vacant area is then the building area less the occupied area (stated as derived); with vacant lines on the roll as well, the two are compared and a difference is flagged.",
    ),
  roll_lines: z
    .array(
      z.object({
        line_id: LineId.describe(
          "Your stable id for the line (for example L1 or the suite); unique in the roll.",
        ),
        occupancy: z
          .enum(["occupied", "vacant"])
          .optional()
          .describe(
            "occupied (default) or vacant. A vacant line needs only its suite and area facts and is not graded.",
          ),
        facts: FactList(40).describe(
          "The line's verified facts from the rent roll document, each with its verbatim quote and page and passing fact_validate, one fact per predicate: rent_roll.tenant_name (text), rent_roll.suite (text), rent_roll.rentable_area_sf (SF), rent_roll.lease_start_date, rent_roll.lease_expiration_date, rent_roll.base_rent_monthly (USD per month), rent_roll.base_rent_annual (USD per year), rent_roll.base_rent_psf (USD per SF per year), rent_roll.next_rent_step {date, annual_rent_psf?, annual_rent?, monthly_rent?}, rent_roll.security_deposit (USD), rent_roll.free_rent_outstanding {months?, amount?}, rent_roll.renewal_option {count?, term_months?}, rent_roll.recoveries {structure: nnn|modified_gross|gross|base_year|other, base_year?}. A field the roll does not state is simply left out.",
        ),
      }),
    )
    .min(1)
    .max(RENT_ROLL_MAX_LINES)
    .describe("The rent roll's lines."),
  leases: z
    .array(
      z.object({
        line_id: LineId.optional().describe(
          "The roll line this lease is for. Without it the lease is matched to the one occupied line whose tenant name is the same (ignoring case and punctuation); an unmatched lease is flagged, never guessed.",
        ),
        label: z
          .string()
          .min(1)
          .max(160)
          .optional()
          .describe("A label for the lease, for the flags."),
        facts: FactList(100).describe(
          "The lease's verified facts, with every amendment's (doc_abstract_lease, or doc_verify_facts), each with quote and page. Read by predicate: lease.tenant, lease.suite (text), lease.rentable_area_sf, lease.commencement_date, lease.expiration_date, lease.rent_commencement_date, lease.base_rent_schedule (steps {from, to, annual_rent_psf}), lease.security_deposit, lease.free_rent {months}, lease.renewal_option {count, term_months}, lease.recovery_structure {structure}, lease.operating_expense_base_year. A fact another fact supersedes is history; a fact with valid_from after as_of is pending and not used. A field no fact covers is not checked, never assumed.",
        ),
        estoppel: z
          .object({
            package_id: z
              .string()
              .min(1)
              .max(60)
              .describe(
                "The estoppel package's id from fact_package_send (kind estoppel).",
              ),
            as_of: Date_.describe(
              "The date the estoppel statements are as of.",
            ),
            statements: z
              .array(
                z.object({
                  key: z
                    .string()
                    .min(1)
                    .max(60)
                    .describe(
                      "The statement's key from estoppel_prepare (S01 ...).",
                    ),
                  code: z
                    .enum(ESTOPPEL_CODES)
                    .describe(
                      "The statement's code from estoppel_prepare: COMMENCEMENT, EXPIRATION, PREMISES, BASE_RENT, NEXT_RENT_STEP, SECURITY_DEPOSIT, FREE_RENT or OPTION_RENEWAL.",
                    ),
                  decision: z
                    .enum(["agreed", "disputed"])
                    .describe(
                      "The tenant's answer, as fact_package_status gives it.",
                    ),
                  tenants_own_version: z.string().max(400).optional(),
                }),
              )
              .min(1)
              .max(60),
          })
          .optional()
          .describe(
            "Optional: the tenant's answers to a confirmed estoppel for this lease (join estoppel_prepare's statement keys and codes with fact_package_status' answers). A line whose tenant, area, expiration and rent all match the lease is then graded confirmed by tenant only if the tenant agreed the premises, expiration and base rent statements and the estoppel speaks to the same rent step as the roll. A statement the tenant disputed makes the line differ. fact_package_send checks the estoppel with the Record when the roll is sent.",
          ),
      }),
    )
    .max(RENT_ROLL_MAX_LINES)
    .optional()
    .describe(
      "The leases, one entry per tenant with the facts of the lease and its amendments.",
    ),
  tolerance: z
    .object({
      annual_usd: z
        .number()
        .finite()
        .min(0)
        .max(100)
        .optional()
        .describe(
          "A difference of annual base rent up to this many dollars is a match within rounding (monthly rent: one twelfth of it). Default 1.",
        ),
      psf: z
        .number()
        .finite()
        .min(0)
        .max(5)
        .optional()
        .describe(
          "A difference of rent per SF up to this many dollars is a match within rounding. Default 0.01.",
        ),
    })
    .optional(),
});
export type RentRollInput = z.output<typeof RentRollCertifyInput>;

// --- value shapes ---------------------------------------------------------------------------------

const N = z.number().finite();
const strict = <T extends z.ZodRawShape>(s: T) => z.strictObject(s);
const Text = z.string().min(1).max(600);
const STRUCTURES = [
  "nnn",
  "modified_gross",
  "gross",
  "base_year",
  "other",
] as const;

const ROLL_SHAPES: Record<string, z.ZodType> = {
  "rent_roll.tenant_name": Text,
  "rent_roll.suite": Text,
  "rent_roll.rentable_area_sf": N.gt(0),
  "rent_roll.lease_start_date": Date_,
  "rent_roll.lease_expiration_date": Date_,
  "rent_roll.base_rent_monthly": N.min(0),
  "rent_roll.base_rent_annual": N.min(0),
  "rent_roll.base_rent_psf": N.min(0),
  "rent_roll.next_rent_step": strict({
    date: Date_,
    annual_rent_psf: N.min(0).optional(),
    annual_rent: N.min(0).optional(),
    monthly_rent: N.min(0).optional(),
  }),
  "rent_roll.security_deposit": N.min(0),
  "rent_roll.free_rent_outstanding": strict({
    months: N.min(0).optional(),
    amount: N.min(0).optional(),
  }),
  "rent_roll.renewal_option": strict({
    count: N.min(0).optional(),
    term_months: N.gt(0).optional(),
  }),
  "rent_roll.recoveries": strict({
    structure: z.enum(STRUCTURES),
    base_year: z.number().int().min(1900).max(2200).optional(),
  }),
};

const LEASE_SHAPES: Record<string, z.ZodType> = {
  "lease.tenant": Text,
  "lease.suite": Text,
  "lease.commencement_date": Date_,
  "lease.expiration_date": Date_,
  "lease.rent_commencement_date": Date_,
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
  "lease.renewal_option": strict({
    count: N.gt(0).optional(),
    term_months: N.gt(0).optional(),
    notice_months: N.gt(0).optional(),
    rent: Text.optional(),
  }),
  "lease.recovery_structure": strict({ structure: z.enum(STRUCTURES) }),
  "lease.operating_expense_base_year": z.number().int().min(1900).max(2200),
};

// --- helpers ----------------------------------------------------------------------------------------

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
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]!} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}
const num = (x: number): string => String(round(x, 6));
const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const SHA = "fl:document:sha256-";
const shaOf = (id: string | null): string | null =>
  id !== null && id.startsWith(SHA) ? id.slice(SHA.length) : null;

interface RFact {
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

interface Src {
  fact_id: string;
  predicate: string;
  document_id: string | null;
  sha256: string | null;
  page: number;
  quote: string;
  section: string | null;
}
const srcOf = (f: RFact | null | undefined): Src | null =>
  f
    ? {
        fact_id: f.id,
        predicate: f.predicate,
        document_id: f.document_id,
        sha256: shaOf(f.document_id),
        page: f.page,
        quote: f.quote,
        section: f.section,
      }
    : null;

type Issue = { path: string; message: string };

function readFacts(
  list: Record<string, unknown>[],
  at: string,
  ns: string,
  shapes: Record<string, z.ZodType>,
  seen: Set<string>,
  issues: Issue[],
  ignored: string[],
): RFact[] {
  const out: RFact[] = [];
  list.forEach((f, i) => {
    const here = `${at}.${i}`;
    const v = validateFact(f);
    if (!v.valid) {
      for (const x of v.issues.slice(0, 3))
        issues.push({
          path: `${here}${x.path ? `.${x.path}` : ""}`,
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
        path: `${here}.provenance.sources`,
        message:
          "no source: every fact the certification reads needs a quote and a page (no source, no fact)",
      });
      return;
    }
    if (!predicate.startsWith(ns)) {
      issues.push({
        path: `${here}.predicate`,
        message: `${predicate} is not a ${ns.slice(0, -1)} fact: ${at} holds ${ns}* predicates`,
      });
      return;
    }
    if (f.id === undefined || id === "undefined") {
      issues.push({ path: `${here}.id`, message: "every fact needs an id" });
      return;
    }
    if (seen.has(id)) {
      issues.push({ path: `${here}.id`, message: `duplicate fact id ${id}` });
      return;
    }
    seen.add(id);
    const shape = shapes[predicate];
    if (!shape) {
      ignored.push(predicate);
      return;
    }
    const parsed = shape.safeParse(f.value);
    if (!parsed.success) {
      issues.push({
        path: `${here}.value`,
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

// --- grades and checks ------------------------------------------------------------------------------

export const GRADES = [
  "matches_lease",
  "matches_lease_confirmed_by_tenant",
  "differs",
  "no_lease_supplied",
  "not_checkable",
] as const;
type Grade = (typeof GRADES)[number];
export const GRADE_LABEL: Record<Grade, string> = {
  matches_lease: "Matches lease",
  matches_lease_confirmed_by_tenant: "Matches lease and confirmed by tenant",
  differs: "Differs from lease",
  no_lease_supplied: "No lease supplied",
  not_checkable: "Not checkable",
};

type Status = "match" | "differs" | "not_checked" | "not_stated";
type Cell = string | number | null;

interface Check {
  field: string;
  label: string;
  status: Status;
  roll_value: Cell;
  against: "lease" | "roll" | "estoppel" | null;
  against_value: Cell;
  unit: string | null;
  difference: number | null;
  difference_unit: string | null;
  within_rounding: boolean;
  roll_source: Src | null;
  lease_source: Src | null;
  reason: string | null;
  estoppel: { key: string; code: string; decision: string } | null;
}

interface Flag {
  code: string;
  severity: "difference" | "check" | "info";
  line_id: string | null;
  message: string;
}

const FIELD_LABEL: Record<string, string> = {
  tenant_name: "Tenant name",
  suite: "Suite",
  area: "Rentable area",
  start: "Lease start",
  expiration: "Lease expiration",
  rent_annual: "Base rent per year",
  rent_monthly: "Base rent per month",
  rent_psf: "Base rent per SF per year",
  rent_internal: "The roll's own arithmetic",
  next_step: "Next rent step",
  deposit: "Security deposit",
  free_rent: "Free rent outstanding",
  renewal: "Renewal options",
  recoveries: "Recoveries",
};
const FIELD_CODE: Record<string, string> = {
  area: "PREMISES",
  start: "COMMENCEMENT",
  expiration: "EXPIRATION",
  rent: "BASE_RENT",
  next_step: "NEXT_RENT_STEP",
  deposit: "SECURITY_DEPOSIT",
  free_rent: "FREE_RENT",
  renewal: "OPTION_RENEWAL",
};
const RENT_FIELDS = ["rent_annual", "rent_monthly", "rent_psf"];
const CONFIRM_FIELDS = ["area", "expiration", "rent"];

interface Step {
  from: string;
  to: string;
  psf: number;
  fact: RFact;
}

// --- the tool -----------------------------------------------------------------------------------------

interface Line {
  number: number;
  line_id: string;
  vacant: boolean;
  facts: Map<string, RFact>;
  all: RFact[];
}

interface LeaseIn {
  index: number;
  label: string | null;
  line_id: string | null;
  facts: RFact[];
  estoppel: RentRollInput["leases"] extends (infer L)[] | undefined
    ? L extends { estoppel?: infer E }
      ? E
      : never
    : never;
}

const pct4 = (x: number): number => round(x, 4);

export function certifyRentRoll(input: RentRollInput): Json {
  const issues: Issue[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  const asOf = input.as_of;
  const tolAnnual = input.tolerance?.annual_usd ?? 1;
  const tolPsf = input.tolerance?.psf ?? 0.01;
  const tolMonthly = tolAnnual / 12;

  // ---- roll lines ----------------------------------------------------------------------------------
  const lineIds = new Set<string>();
  const lines: Line[] = [];
  input.roll_lines.forEach((l, i) => {
    const at = `roll_lines.${i}`;
    if (lineIds.has(l.line_id))
      issues.push({
        path: `${at}.line_id`,
        message: `duplicate line id ${l.line_id}`,
      });
    lineIds.add(l.line_id);
    const facts = readFacts(
      l.facts,
      `${at}.facts`,
      "rent_roll.",
      ROLL_SHAPES,
      seen,
      issues,
      ignored,
    );
    const byPred = new Map<string, RFact>();
    for (const f of facts) {
      if (byPred.has(f.predicate))
        issues.push({
          path: `${at}.facts`,
          message: `two facts for ${f.predicate} on line ${l.line_id}: a roll line has one value for each field`,
        });
      else byPred.set(f.predicate, f);
    }
    lines.push({
      number: i + 1,
      line_id: l.line_id,
      vacant: l.occupancy === "vacant",
      facts: byPred,
      all: facts,
    });
  });

  // ---- leases --------------------------------------------------------------------------------------
  const leasesIn: LeaseIn[] = [];
  (input.leases ?? []).forEach((l, i) => {
    const at = `leases.${i}`;
    leasesIn.push({
      index: i,
      label: l.label ?? null,
      line_id: l.line_id ?? null,
      facts: readFacts(
        l.facts,
        `${at}.facts`,
        "lease.",
        LEASE_SHAPES,
        seen,
        issues,
        ignored,
      ),
      estoppel: l.estoppel as LeaseIn["estoppel"],
    });
  });
  if (
    input.parties.certifier.organisation.trim().toLowerCase() ===
    input.parties.relying_party?.organisation.trim().toLowerCase()
  )
    issues.push({
      path: "parties.relying_party.organisation",
      message:
        "the relying party must be a different organisation from the certifier",
    });

  // Match each lease to a roll line.
  const leaseOf = new Map<string, LeaseIn>();
  const unmatched: { lease: LeaseIn; reason: string }[] = [];
  const nameOfLine = (l: Line): string | null => {
    const f = l.facts.get("rent_roll.tenant_name");
    return f ? String(f.value) : null;
  };
  const leaseTenant = (l: LeaseIn): string | null => {
    const f = l.facts.find((x) => x.predicate === "lease.tenant");
    return f ? String(f.value) : null;
  };
  const lineById = new Map(lines.map((l) => [l.line_id, l]));
  for (const ls of leasesIn) {
    const at = `leases.${ls.index}`;
    if (ls.line_id !== null) {
      const ln = lineById.get(ls.line_id);
      if (!ln) {
        unmatched.push({
          lease: ls,
          reason: `names roll line ${ls.line_id}, which is not on the roll`,
        });
        continue;
      }
      if (ln.vacant) {
        unmatched.push({
          lease: ls,
          reason: `names roll line ${ls.line_id}, which the roll shows as vacant`,
        });
        continue;
      }
      if (leaseOf.has(ln.line_id)) {
        issues.push({
          path: `${at}.line_id`,
          message: `two leases name roll line ${ln.line_id}: give one lease entry with the facts of the lease and its amendments together`,
        });
        continue;
      }
      leaseOf.set(ln.line_id, ls);
    }
  }
  for (const ls of leasesIn) {
    if (ls.line_id !== null) continue;
    const t = leaseTenant(ls);
    if (t === null) {
      unmatched.push({
        lease: ls,
        reason:
          "names no roll line and has no lease.tenant fact to match a tenant name",
      });
      continue;
    }
    const cands = lines.filter(
      (l) =>
        !l.vacant &&
        !leaseOf.has(l.line_id) &&
        nameOfLine(l) !== null &&
        normName(nameOfLine(l)!) === normName(t),
    );
    const all = lines.filter(
      (l) =>
        !l.vacant &&
        nameOfLine(l) !== null &&
        normName(nameOfLine(l)!) === normName(t),
    );
    if (cands.length === 1) leaseOf.set(cands[0]!.line_id, ls);
    else
      unmatched.push({
        lease: ls,
        reason:
          all.length === 0
            ? `matches no tenant name on the roll (${t})`
            : `matches ${all.length} roll lines by tenant name: name the line with line_id`,
      });
  }
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  // ---- per-line checks -----------------------------------------------------------------------------
  const flags: Flag[] = [];
  const flag = (
    code: string,
    severity: Flag["severity"],
    line_id: string | null,
    message: string,
  ): void => {
    flags.push({ code, severity, line_id, message });
  };

  interface Out {
    line: Line;
    tenant: string;
    suite: string | null;
    grade: Grade | null;
    checks: Check[];
    reasons: string[];
    lineFlags: Flag[];
    rollAnnual: number | null;
    rollBasis: string | null;
    leaseAnnual: number | null;
    leaseExp: string | null;
    leaseArea: number | null;
    leaseLabel: string | null;
    hasLease: boolean;
    confirmed: string[];
    estoppelPackage: string | null;
    estoppelStatements: string[];
    factIds: string[];
  }
  const outs: Out[] = [];

  for (const ln of lines) {
    const rf = (p: string): RFact | undefined => ln.facts.get(`rent_roll.${p}`);
    const rv = <T>(p: string): T | null => {
      const f = rf(p);
      return f ? (f.value as T) : null;
    };
    const tenant = rv<string>("tenant_name") ?? ln.line_id;
    const suite = rv<string>("suite");
    const rollArea = rv<number>("rentable_area_sf");
    const mAnnual = rv<number>("base_rent_annual");
    const mMonthly = rv<number>("base_rent_monthly");
    const mPsf = rv<number>("base_rent_psf");
    let rollAnnual: number | null = null;
    let rollBasis: string | null = null;
    if (mAnnual !== null) {
      rollAnnual = usd(mAnnual);
      rollBasis = "stated per year";
    } else if (mMonthly !== null) {
      rollAnnual = usd(mMonthly * 12);
      rollBasis = "stated per month, times 12";
    } else if (mPsf !== null && rollArea !== null) {
      rollAnnual = usd(mPsf * rollArea);
      rollBasis = "stated per SF, times the area on the roll";
    }
    const o: Out = {
      line: ln,
      tenant,
      suite,
      grade: null,
      checks: [],
      reasons: [],
      lineFlags: [],
      rollAnnual,
      rollBasis,
      leaseAnnual: null,
      leaseExp: null,
      leaseArea: null,
      leaseLabel: null,
      hasLease: false,
      confirmed: [],
      estoppelPackage: null,
      estoppelStatements: [],
      factIds: [],
    };
    outs.push(o);
    if (ln.vacant) continue;

    const lease = leaseOf.get(ln.line_id) ?? null;
    o.hasLease = lease !== null;

    // The lease side: current facts as of the roll date.
    const lf = lease?.facts ?? [];
    const pending = lf.filter(
      (f) => f.valid_from !== null && f.valid_from > asOf,
    );
    const pendingIds = new Set(pending.map((f) => f.id));
    const live = lf.filter((f) => !pendingIds.has(f.id));
    const supersededBy = new Set<string>();
    for (const f of live) for (const s of f.supersedes) supersededBy.add(s);
    const isCurrent = (f: RFact): boolean => !supersededBy.has(f.id);
    if (pending.length)
      flag(
        "LEASE_FACTS_PENDING",
        "info",
        ln.line_id,
        `${pending.length} lease fact${pending.length === 1 ? "" : "s"} for ${tenant} take effect after the as-of date and are not used`,
      );
    interface Cur {
      fact: RFact | null;
      conflict: boolean;
    }
    const cur = (p: string): Cur => {
      const c = live.filter((f) => f.predicate === p && isCurrent(f));
      if (c.length === 0) return { fact: null, conflict: false };
      return {
        fact: c[0]!,
        conflict: c.some((x) => !jsonEqual(x.value, c[0]!.value)),
      };
    };
    const conflictedPreds: string[] = [];
    const lease1 = (
      p: string,
    ): { fact: RFact | null; blocked: string | null } => {
      const c = cur(p);
      if (c.conflict) {
        conflictedPreds.push(p);
        return {
          fact: null,
          blocked: `the lease facts disagree about ${p.replace("lease.", "").replace(/_/g, " ")} and no amendment is marked as superseding the other`,
        };
      }
      return {
        fact: c.fact,
        blocked: c.fact ? null : "no lease fact states it",
      };
    };

    const push = (
      c: Partial<Check> & { field: string; status: Status },
    ): Check => {
      const full: Check = {
        label: FIELD_LABEL[c.field]!,
        roll_value: null,
        against: null,
        against_value: null,
        unit: null,
        difference: null,
        difference_unit: null,
        within_rounding: false,
        roll_source: null,
        lease_source: null,
        reason: null,
        estoppel: null,
        ...c,
      };
      o.checks.push(full);
      return full;
    };
    const notStated = (field: string): void => {
      push({
        field,
        status: "not_stated",
        reason: "the roll does not state it",
      });
    };
    const notChecked = (
      field: string,
      rollF: RFact | undefined,
      rollValue: Cell,
      unit: string | null,
      reason: string,
    ): void => {
      push({
        field,
        status: "not_checked",
        roll_value: rollValue,
        unit,
        roll_source: srcOf(rollF),
        reason,
      });
    };
    const compareNum = (
      field: string,
      rollF: RFact | undefined,
      rollValue: number,
      leaseF: RFact | null,
      leaseValue: number,
      unit: string,
      tol: number,
      dp: number,
    ): Check => {
      const diff = round(rollValue - leaseValue, dp);
      const within = Math.abs(rollValue - leaseValue) <= tol + 1e-9;
      return push({
        field,
        status: within ? "match" : "differs",
        roll_value: rollValue,
        against: "lease",
        against_value: leaseValue,
        unit,
        difference: diff,
        difference_unit: unit,
        within_rounding: within && diff !== 0,
        roll_source: srcOf(rollF),
        lease_source: srcOf(leaseF),
      });
    };
    const compareText = (
      field: string,
      rollF: RFact | undefined,
      rollValue: string,
      leaseF: RFact | null,
      leaseValue: string,
    ): Check =>
      push({
        field,
        status:
          normName(rollValue) === normName(leaseValue) ? "match" : "differs",
        roll_value: rollValue,
        against: "lease",
        against_value: leaseValue,
        unit: "text",
        roll_source: srcOf(rollF),
        lease_source: srcOf(leaseF),
      });
    const compareDate = (
      field: string,
      rollF: RFact | undefined,
      rollValue: string,
      leaseF: RFact | null,
      leaseValue: string,
    ): Check =>
      push({
        field,
        status: rollValue === leaseValue ? "match" : "differs",
        roll_value: rollValue,
        against: "lease",
        against_value: leaseValue,
        unit: "date",
        difference:
          rollValue === leaseValue ? 0 : daysBetween(leaseValue, rollValue),
        difference_unit: "days",
        roll_source: srcOf(rollF),
        lease_source: srcOf(leaseF),
      });
    const noLeaseFact = (
      field: string,
      rollF: RFact | undefined,
      rollValue: Cell,
      unit: string | null,
      p: string,
      blocked: string | null,
    ): void =>
      notChecked(
        field,
        rollF,
        rollValue,
        unit,
        blocked && blocked !== "no lease fact states it"
          ? blocked
          : `the lease facts supplied do not state ${p}`,
      );

    // Roll's own arithmetic: monthly rent times 12 against annual rent.
    if (mAnnual !== null && mMonthly !== null) {
      const twelve = usd(mMonthly * 12);
      const diff = round(mAnnual - twelve, 2);
      if (Math.abs(mAnnual - twelve) > tolAnnual + 1e-9) {
        push({
          field: "rent_internal",
          status: "differs",
          roll_value: mAnnual,
          against: "roll",
          against_value: twelve,
          unit: "USD per year",
          difference: diff,
          difference_unit: "USD per year",
          roll_source: srcOf(rf("base_rent_annual")),
          lease_source: srcOf(rf("base_rent_monthly")),
          reason: "the roll's monthly rent times 12 is not its annual rent",
        });
        flag(
          "ROLL_RENT_INTERNAL",
          "difference",
          ln.line_id,
          `${tenant}: the roll states ${money(mMonthly)} per month (${money(twelve)} per year) and ${money(mAnnual)} per year, a difference of ${money(Math.abs(diff))}`,
        );
      }
    }

    // Tenant name.
    {
      const f = rf("tenant_name");
      if (!f) notStated("tenant_name");
      else if (!lease)
        notChecked(
          "tenant_name",
          f,
          String(f.value),
          "text",
          "no lease was supplied",
        );
      else {
        const l = lease1("lease.tenant");
        if (l.fact)
          compareText(
            "tenant_name",
            f,
            String(f.value),
            l.fact,
            String(l.fact.value),
          );
        else
          noLeaseFact(
            "tenant_name",
            f,
            String(f.value),
            "text",
            "the tenant",
            l.blocked,
          );
      }
    }
    // Suite.
    {
      const f = rf("suite");
      if (!f) notStated("suite");
      else if (!lease)
        notChecked(
          "suite",
          f,
          String(f.value),
          "text",
          "no lease was supplied",
        );
      else {
        const l = lease1("lease.suite");
        if (l.fact)
          compareText(
            "suite",
            f,
            String(f.value),
            l.fact,
            String(l.fact.value),
          );
        else
          noLeaseFact(
            "suite",
            f,
            String(f.value),
            "text",
            "the suite",
            l.blocked,
          );
      }
    }
    // Area.
    const la = lease
      ? lease1("lease.rentable_area_sf")
      : { fact: null, blocked: null };
    const leaseAreaV = la.fact ? (la.fact.value as number) : null;
    o.leaseArea = leaseAreaV;
    {
      const f = rf("rentable_area_sf");
      if (!f) notStated("area");
      else if (!lease)
        notChecked("area", f, rollArea, "SF", "no lease was supplied");
      else if (la.fact)
        compareNum("area", f, rollArea!, la.fact, leaseAreaV!, "SF", 0.005, 2);
      else
        noLeaseFact("area", f, rollArea, "SF", "the rentable area", la.blocked);
    }
    // Start and expiration.
    for (const [field, rp, lp] of [
      ["start", "lease_start_date", "lease.commencement_date"],
      ["expiration", "lease_expiration_date", "lease.expiration_date"],
    ] as const) {
      const f = rf(rp);
      if (!f) notStated(field);
      else if (!lease)
        notChecked(field, f, String(f.value), "date", "no lease was supplied");
      else {
        const l = lease1(lp);
        if (l.fact)
          compareDate(field, f, String(f.value), l.fact, String(l.fact.value));
        else
          noLeaseFact(
            field,
            f,
            String(f.value),
            "date",
            lp.replace("lease.", "the ").replace(/_/g, " "),
            l.blocked,
          );
      }
    }
    const le = lease
      ? lease1("lease.expiration_date")
      : { fact: null, blocked: null };
    o.leaseExp = le.fact ? String(le.fact.value) : null;

    // The lease's rent schedule at the as-of date.
    let nowStep: Step | null = null;
    let nextStep: Step | null = null;
    let scheduleBlock: string | null = null;
    let stepAt: (d: string) => Step | null = () => null;
    if (lease) {
      const sched = live.filter(
        (f) => f.predicate === "lease.base_rent_schedule",
      );
      const stepsOf = (f: RFact): Step[] =>
        (
          f.value as { from: string; to: string; annual_rent_psf: number }[]
        ).map((s) => ({
          from: s.from,
          to: s.to,
          psf: s.annual_rent_psf,
          fact: f,
        }));
      const overlaps = (a: Step, b: Step): boolean =>
        a.from <= b.to && b.from <= a.to;
      const accepted: Step[] = [];
      let conflicted = false;
      for (const f of sched.filter(isCurrent))
        for (const s of stepsOf(f)) {
          const clash = accepted.find((a) => overlaps(a, s));
          if (clash) {
            if (clash.psf !== s.psf) conflicted = true;
            continue;
          }
          accepted.push(s);
        }
      const carried: Step[] = [];
      for (const f of sched.filter((x) => !isCurrent(x)))
        for (const s of stepsOf(f))
          if (
            !accepted.some((a) => overlaps(a, s)) &&
            !carried.some((a) => overlaps(a, s))
          )
            carried.push(s);
      const steps = [...accepted, ...carried].sort((a, b) =>
        a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
      );
      stepAt = (d) => steps.find((s) => s.from <= d && d <= s.to) ?? null;
      if (conflicted) {
        scheduleBlock =
          "the lease's rent schedule facts overlap with different rents and no amendment is marked as superseding the other";
        conflictedPreds.push("lease.base_rent_schedule");
      } else if (steps.length === 0)
        scheduleBlock =
          "the lease facts supplied do not state the base rent schedule";
      else {
        nowStep = stepAt(asOf);
        nextStep = steps.find((s) => s.from > asOf) ?? null;
        if (!nowStep)
          scheduleBlock = `the lease's rent schedule has no step covering ${longDate(asOf)}`;
      }
    }
    const leaseAnnual =
      nowStep && leaseAreaV !== null ? usd(nowStep.psf * leaseAreaV) : null;
    const leaseMonthly = leaseAnnual !== null ? usd(leaseAnnual / 12) : null;
    o.leaseAnnual = leaseAnnual;

    // Rent.
    const rentReason = (needsArea: boolean): string =>
      !lease
        ? "no lease was supplied"
        : scheduleBlock
          ? scheduleBlock
          : needsArea
            ? la.blocked && la.blocked !== "no lease fact states it"
              ? la.blocked
              : "the lease facts supplied do not state the rentable area, which the annual and monthly rent need"
            : "";
    const rentSrc = nowStep ? nowStep.fact : null;
    if (mAnnual === null && mMonthly === null && mPsf === null)
      notStated("rent_annual");
    if (mAnnual !== null) {
      const f = rf("base_rent_annual");
      if (leaseAnnual !== null)
        compareNum(
          "rent_annual",
          f,
          mAnnual,
          rentSrc,
          leaseAnnual,
          "USD per year",
          tolAnnual,
          2,
        );
      else
        notChecked(
          "rent_annual",
          f,
          mAnnual,
          "USD per year",
          rentReason(nowStep !== null),
        );
    }
    if (mMonthly !== null) {
      const f = rf("base_rent_monthly");
      if (leaseMonthly !== null)
        compareNum(
          "rent_monthly",
          f,
          mMonthly,
          rentSrc,
          leaseMonthly,
          "USD per month",
          tolMonthly,
          2,
        );
      else
        notChecked(
          "rent_monthly",
          f,
          mMonthly,
          "USD per month",
          rentReason(nowStep !== null),
        );
    }
    if (mPsf !== null) {
      const f = rf("base_rent_psf");
      if (nowStep)
        compareNum(
          "rent_psf",
          f,
          mPsf,
          rentSrc,
          nowStep.psf,
          "USD per SF per year",
          tolPsf,
          4,
        );
      else
        notChecked(
          "rent_psf",
          f,
          mPsf,
          "USD per SF per year",
          rentReason(false),
        );
    }
    if (
      leaseAnnual !== null &&
      o.rollAnnual !== null &&
      o.rollAnnual - leaseAnnual > tolAnnual + 1e-9
    )
      flag(
        "ROLL_RENT_ABOVE_LEASE",
        "difference",
        ln.line_id,
        `${tenant}: the roll's base rent (${money(o.rollAnnual)} per year) is above what the lease yields (${money(leaseAnnual)}), by ${money(o.rollAnnual - leaseAnnual)}`,
      );

    // Next step.
    {
      const f = rf("next_rent_step");
      const v = rv<{
        date: string;
        annual_rent_psf?: number;
        annual_rent?: number;
        monthly_rent?: number;
      }>("next_rent_step");
      if (!f || !v) notStated("next_step");
      else if (!lease)
        notChecked("next_step", f, v.date, "date", "no lease was supplied");
      else if (scheduleBlock && !nextStep)
        notChecked("next_step", f, v.date, "date", scheduleBlock);
      else if (!nextStep)
        notChecked(
          "next_step",
          f,
          v.date,
          "date",
          `the lease facts supplied show no rent step after ${longDate(asOf)}`,
        );
      else {
        const c = compareDate(
          "next_step",
          f,
          v.date,
          nextStep.fact,
          nextStep.from,
        );
        // The stated amounts of the step, against the lease's step.
        const nAnnual =
          leaseAreaV !== null ? usd(nextStep.psf * leaseAreaV) : null;
        const parts: [string, number | undefined, number | null, number][] = [
          ["per SF per year", v.annual_rent_psf, nextStep.psf, tolPsf],
          ["per year", v.annual_rent, nAnnual, tolAnnual],
          [
            "per month",
            v.monthly_rent,
            nAnnual !== null ? usd(nAnnual / 12) : null,
            tolMonthly,
          ],
        ];
        for (const [what, rollV, leaseV, tol] of parts) {
          if (rollV === undefined) continue;
          if (leaseV === null) continue;
          if (Math.abs(rollV - leaseV) > tol + 1e-9 && c.status === "match") {
            c.status = "differs";
            c.reason = `the step's rent ${what} is ${money(rollV)} on the roll and ${money(leaseV)} in the lease`;
          } else if (Math.abs(rollV - leaseV) > tol + 1e-9) {
            c.reason = `${c.reason ? `${c.reason}; ` : ""}the step's rent ${what} is ${money(rollV)} on the roll and ${money(leaseV)} in the lease`;
          }
        }
      }
    }
    // Security deposit.
    {
      const f = rf("security_deposit");
      if (!f) notStated("deposit");
      else if (!lease)
        notChecked(
          "deposit",
          f,
          rv<number>("security_deposit"),
          "USD",
          "no lease was supplied",
        );
      else {
        const l = lease1("lease.security_deposit");
        if (l.fact)
          compareNum(
            "deposit",
            f,
            rv<number>("security_deposit")!,
            l.fact,
            l.fact.value as number,
            "USD",
            0.005,
            2,
          );
        else
          noLeaseFact(
            "deposit",
            f,
            rv<number>("security_deposit"),
            "USD",
            "a security deposit",
            l.blocked,
          );
      }
    }
    // Free rent outstanding.
    {
      const f = rf("free_rent_outstanding");
      const v = rv<{ months?: number; amount?: number }>(
        "free_rent_outstanding",
      );
      if (!f || !v) notStated("free_rent");
      else if (!lease)
        notChecked(
          "free_rent",
          f,
          v.months ?? v.amount ?? null,
          v.months !== undefined ? "months" : "USD",
          "no lease was supplied",
        );
      else {
        const fr = lease1("lease.free_rent");
        const rc = lease1("lease.rent_commencement_date");
        const lm = fr.fact
          ? ((fr.fact.value as { months?: number }).months ?? null)
          : null;
        if (v.months !== undefined && lm !== null) {
          push({
            field: "free_rent",
            status: v.months <= lm ? "match" : "differs",
            roll_value: v.months,
            against: "lease",
            against_value: lm,
            unit: "months",
            difference: round(v.months - lm, 2),
            difference_unit: "months",
            roll_source: srcOf(f),
            lease_source: srcOf(fr.fact),
            reason:
              v.months <= lm
                ? "outstanding free rent is within the months the lease grants"
                : "the roll shows more free rent outstanding than the lease grants",
          });
        } else if (v.months === 0 && rc.fact && String(rc.fact.value) > asOf) {
          push({
            field: "free_rent",
            status: "differs",
            roll_value: 0,
            against: "lease",
            against_value: String(rc.fact.value),
            unit: "months",
            roll_source: srcOf(f),
            lease_source: srcOf(rc.fact),
            reason: `the roll shows no free rent outstanding, but the lease's rent commencement date (${longDate(String(rc.fact.value))}) is after the as-of date`,
          });
        } else
          notChecked(
            "free_rent",
            f,
            v.months ?? v.amount ?? null,
            v.months !== undefined ? "months" : "USD",
            v.months === undefined
              ? "the roll states a dollar amount and the lease states months, not an amount"
              : "the lease facts supplied state no free rent period to compare with",
          );
      }
    }
    // Renewal options.
    {
      const f = rf("renewal_option");
      const v = rv<{ count?: number; term_months?: number }>("renewal_option");
      const text = (x: { count?: number; term_months?: number }): string =>
        x.count === 0
          ? "none"
          : `${x.count !== undefined ? num(x.count) : "an"} option${x.count === 1 || x.count === undefined ? "" : "s"}${x.term_months !== undefined ? ` of ${num(x.term_months)} months` : ""}`;
      if (!f || !v) notStated("renewal");
      else if (!lease)
        notChecked("renewal", f, text(v), "text", "no lease was supplied");
      else {
        const l = lease1("lease.renewal_option");
        if (!l.fact) {
          if (v.count === 0 && l.blocked === "no lease fact states it")
            notChecked(
              "renewal",
              f,
              text(v),
              "text",
              "the lease facts supplied state no renewal option, which does not prove there is none",
            );
          else
            noLeaseFact(
              "renewal",
              f,
              text(v),
              "text",
              "a renewal option",
              l.blocked,
            );
        } else {
          const lv = l.fact.value as { count?: number; term_months?: number };
          const bad: string[] = [];
          let compared = 0;
          if (v.count !== undefined && lv.count !== undefined) {
            compared++;
            if (v.count !== lv.count) bad.push("number of options");
          }
          if (v.term_months !== undefined && lv.term_months !== undefined) {
            compared++;
            if (v.term_months !== lv.term_months)
              bad.push("length of each option");
          }
          if (v.count === 0 && compared === 0) bad.push("number of options");
          if (compared === 0 && bad.length === 0)
            notChecked(
              "renewal",
              f,
              text(v),
              "text",
              "the roll and the lease state different parts of the option, so none can be compared",
            );
          else
            push({
              field: "renewal",
              status: bad.length ? "differs" : "match",
              roll_value: text(v),
              against: "lease",
              against_value: text(lv),
              unit: "text",
              roll_source: srcOf(f),
              lease_source: srcOf(l.fact),
              reason: bad.length
                ? `differs in the ${bad.join(" and the ")}`
                : null,
            });
        }
      }
    }
    // Recoveries.
    {
      const f = rf("recoveries");
      const v = rv<{ structure: string; base_year?: number }>("recoveries");
      const text = (s: string, y?: number): string =>
        `${s.replace(/_/g, " ")}${y !== undefined ? `, base year ${y}` : ""}`;
      if (!f || !v) notStated("recoveries");
      else if (!lease)
        notChecked(
          "recoveries",
          f,
          text(v.structure, v.base_year),
          "text",
          "no lease was supplied",
        );
      else {
        const l = lease1("lease.recovery_structure");
        const by = lease1("lease.operating_expense_base_year");
        const lstruct = l.fact
          ? (l.fact.value as { structure: string }).structure
          : null;
        const lyear = by.fact ? (by.fact.value as number) : null;
        const bad: string[] = [];
        let compared = 0;
        if (lstruct !== null) {
          compared++;
          if (lstruct !== v.structure) bad.push("structure");
        }
        if (v.base_year !== undefined && lyear !== null) {
          compared++;
          if (lyear !== v.base_year) bad.push("base year");
        }
        if (compared === 0)
          notChecked(
            "recoveries",
            f,
            text(v.structure, v.base_year),
            "text",
            "the lease facts supplied do not state the recoveries structure",
          );
        else
          push({
            field: "recoveries",
            status: bad.length ? "differs" : "match",
            roll_value: text(v.structure, v.base_year),
            against: "lease",
            against_value: text(lstruct ?? v.structure, lyear ?? v.base_year),
            unit: "text",
            roll_source: srcOf(f),
            lease_source: srcOf(l.fact ?? by.fact),
            reason: bad.length
              ? `differs in the ${bad.join(" and the ")}`
              : null,
          });
      }
    }
    for (const p of [...new Set(conflictedPreds)])
      flag(
        "LEASE_FACTS_CONFLICT",
        "check",
        ln.line_id,
        `${tenant}: the lease facts disagree about ${p.replace("lease.", "").replace(/_/g, " ")}; that field is not checked until a person resolves which governs`,
      );

    // ---- the tenant's estoppel answers ----------------------------------------------------------
    const est = lease?.estoppel ?? null;
    let estOk = false;
    if (est) {
      o.estoppelPackage = est.package_id;
      const byCode = new Map(est.statements.map((s) => [s.code, s] as const));
      const sameStep =
        est.as_of === asOf ||
        (est.as_of < asOf &&
          stepAt(est.as_of) !== null &&
          stepAt(asOf) !== null &&
          stepAt(est.as_of)!.from === stepAt(asOf)!.from &&
          stepAt(est.as_of)!.to === stepAt(asOf)!.to);
      estOk = sameStep;
      if (!sameStep)
        flag(
          "ESTOPPEL_DATE_DIFFERS",
          "check",
          ln.line_id,
          `${tenant}: the estoppel is as of ${longDate(est.as_of)} and the roll as of ${longDate(asOf)}, and the lease's rent step differs between them (or the estoppel is later), so the tenant's confirmation is not counted for this line`,
        );
      const primaryRent = RENT_FIELDS.find((r) =>
        o.checks.some((c) => c.field === r && c.status !== "not_stated"),
      );
      for (const c of [...o.checks]) {
        const code =
          FIELD_CODE[
            c.field === "rent_annual" ||
            c.field === "rent_monthly" ||
            c.field === "rent_psf"
              ? "rent"
              : c.field
          ];
        const s = code
          ? byCode.get(code as (typeof ESTOPPEL_CODES)[number])
          : undefined;
        if (!s || c.status === "not_stated") continue;
        c.estoppel = { key: s.key, code: s.code, decision: s.decision };
        if (
          s.decision === "disputed" &&
          (c.field === primaryRent || !RENT_FIELDS.includes(c.field))
        ) {
          push({
            field: c.field,
            label: `${c.label}, tenant's answer`,
            status: "differs",
            roll_value: c.roll_value,
            against: "estoppel",
            against_value: s.tenants_own_version ?? "disputed, no figure given",
            unit: c.unit,
            roll_source: c.roll_source,
            reason: "the tenant disputed the estoppel statement for this field",
            estoppel: { key: s.key, code: s.code, decision: s.decision },
          });
          flag(
            "ESTOPPEL_DISPUTED",
            "difference",
            ln.line_id,
            `${tenant}: the tenant disputed the estoppel statement on ${c.label.toLowerCase()}${s.tenants_own_version ? ` and gave its own version: ${s.tenants_own_version}` : ""}`,
          );
        }
      }
      o.estoppelStatements = est.statements
        .filter((s) => s.decision === "agreed")
        .map((s) => s.key);
    }

    // ---- the grade ----------------------------------------------------------------------------------
    const differs = o.checks.filter((c) => c.status === "differs");
    const coreMissing: string[] = [];
    const coreState = (
      fields: string[],
    ): "match" | "not_stated" | "not_checked" => {
      const cs = o.checks.filter(
        (c) =>
          fields.includes(c.field) &&
          c.against !== "estoppel" &&
          c.against !== "roll",
      );
      const stated = cs.filter((c) => c.status !== "not_stated");
      if (stated.length === 0) return "not_stated";
      return stated.every((c) => c.status === "match" || c.status === "differs")
        ? "match"
        : "not_checked";
    };
    const coreLabels: [string, string[], string][] = [
      ["the tenant name", ["tenant_name"], "tenant name"],
      ["the rentable area", ["area"], "rentable area"],
      ["the lease expiration", ["expiration"], "lease expiration"],
      ["the base rent", RENT_FIELDS, "base rent"],
    ];
    if (differs.length) o.grade = "differs";
    else if (!lease) {
      o.grade = "no_lease_supplied";
      o.reasons.push("no lease was supplied for this line");
    } else {
      for (const [label, fields] of coreLabels) {
        const s = coreState(fields);
        if (s === "not_stated")
          coreMissing.push(
            `the roll does not state ${label.replace("the ", "")}`,
          );
        else if (s === "not_checked") {
          const why =
            o.checks.find(
              (c) => fields.includes(c.field) && c.status === "not_checked",
            )?.reason ?? "no lease fact covers it";
          coreMissing.push(
            `${label.replace("the ", "")} was not checked: ${why}`,
          );
        }
      }
      if (coreMissing.length) {
        o.grade = "not_checkable";
        o.reasons.push(...coreMissing);
      } else {
        const agreed = (code: string): boolean =>
          est?.statements.some(
            (s) => s.code === code && s.decision === "agreed",
          ) ?? false;
        const confirmed =
          est !== null &&
          estOk &&
          CONFIRM_FIELDS.every((f) => agreed(FIELD_CODE[f]!));
        o.grade = confirmed
          ? "matches_lease_confirmed_by_tenant"
          : "matches_lease";
        if (confirmed)
          o.confirmed = CONFIRM_FIELDS.map(
            (f) => FIELD_LABEL[f === "rent" ? "rent_annual" : f]!,
          );
        else if (est && estOk)
          o.reasons.push(
            "the estoppel does not carry an agreed answer to each of the premises, expiration and base rent statements",
          );
      }
    }
    if (o.grade === "no_lease_supplied")
      flag(
        "NO_LEASE_SUPPLIED",
        "check",
        ln.line_id,
        `${tenant}${suite ? `, suite ${suite}` : ""}: the roll shows a tenant but no lease was supplied, so nothing on this line was checked`,
      );

    // The facts this line rests on, in order of importance (at most 20).
    const prio = [
      "rent_roll.base_rent_annual",
      "rent_roll.base_rent_monthly",
      "rent_roll.base_rent_psf",
      "rent_roll.lease_expiration_date",
      "rent_roll.rentable_area_sf",
      "rent_roll.tenant_name",
      "rent_roll.suite",
      "rent_roll.lease_start_date",
      "rent_roll.next_rent_step",
      "rent_roll.security_deposit",
      "rent_roll.free_rent_outstanding",
      "rent_roll.renewal_option",
      "rent_roll.recoveries",
    ];
    const ids: string[] = [];
    const add = (id: string | undefined): void => {
      if (id && !ids.includes(id)) ids.push(id);
    };
    for (const p of prio) add(ln.facts.get(p)?.id);
    for (const c of o.checks) add(c.lease_source?.fact_id);
    o.factIds = ids.slice(0, 20);
  }

  // ---- flags that need the whole roll -------------------------------------------------------------------
  for (const u of unmatched)
    flag(
      "LEASE_WITHOUT_ROLL_LINE",
      "check",
      null,
      `${u.lease.label ?? leaseTenant(u.lease) ?? `lease ${u.lease.index + 1}`}: a lease was supplied that ${u.reason}`,
    );
  const bySuite = new Map<string, string[]>();
  for (const o of outs) {
    if (o.suite === null) continue;
    const k = normName(o.suite);
    bySuite.set(k, [...(bySuite.get(k) ?? []), o.line.line_id]);
  }
  for (const [k, ids] of [...bySuite.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  ))
    if (ids.length > 1)
      flag(
        "DUPLICATE_SUITE",
        "check",
        null,
        `suite ${k} appears on ${ids.length} roll lines (${ids.join(", ")})`,
      );
  const horizon = addMonths(asOf, 12);
  for (const o of outs) {
    if (o.line.vacant) continue;
    const rollExp = o.line.facts.get("rent_roll.lease_expiration_date");
    const exp = o.leaseExp ?? (rollExp ? String(rollExp.value) : null);
    if (exp === null) continue;
    if (exp < asOf)
      flag(
        "LEASE_EXPIRED",
        "check",
        o.line.line_id,
        `${o.tenant}: the lease expired on ${longDate(exp)}, before the as-of date, and the roll still shows the space as occupied`,
      );
    else if (exp <= horizon)
      flag(
        "LEASE_EXPIRING_WITHIN_12_MONTHS",
        "check",
        o.line.line_id,
        `${o.tenant}: the lease expires on ${longDate(exp)}, within 12 months of the as-of date${o.leaseExp !== null ? " (the date in the lease)" : " (the date on the roll)"}`,
      );
  }

  // ---- totals ---------------------------------------------------------------------------------------------
  const occ = outs.filter((o) => !o.line.vacant);
  const vac = outs.filter((o) => o.line.vacant);
  const areaOf = (o: Out): number | null => {
    const f = o.line.facts.get("rent_roll.rentable_area_sf");
    return f ? (f.value as number) : null;
  };
  const occSf = round(
    occ.reduce((s, o) => s + (areaOf(o) ?? 0), 0),
    2,
  );
  const noAreaOcc = occ.filter((o) => areaOf(o) === null);
  if (noAreaOcc.length)
    warnings.push(
      `${noAreaOcc.length} occupied line${noAreaOcc.length === 1 ? " states" : "s state"} no area on the roll (${noAreaOcc.map((o) => o.line.line_id).join(", ")}); the occupied area, occupancy and area-weighted figures leave ${noAreaOcc.length === 1 ? "it" : "them"} out`,
    );
  let vacSf: number | null = null;
  let vacBasis: string | null = null;
  const vacStated = round(
    vac.reduce((s, o) => s + (areaOf(o) ?? 0), 0),
    2,
  );
  const vacNoArea = vac.filter((o) => areaOf(o) === null);
  if (input.building_area_sf !== undefined) {
    vacSf = round(input.building_area_sf - occSf, 2);
    vacBasis = "building area less occupied area";
    if (vacSf < 0) {
      warnings.push(
        `the occupied area on the roll (${sf(occSf)} SF) is more than the building area (${sf(input.building_area_sf)} SF)`,
      );
      vacSf = 0;
    }
    if (
      vac.length &&
      vacNoArea.length === 0 &&
      Math.abs(vacStated - vacSf) > 0.005
    )
      flag(
        "VACANT_AREA_DIFFERS",
        "check",
        null,
        `the vacant lines on the roll add up to ${sf(vacStated)} SF, but the building area less the occupied area is ${sf(vacSf)} SF`,
      );
  } else if (vac.length) {
    vacSf = vacStated;
    vacBasis = "vacant lines on the roll";
    if (vacNoArea.length)
      warnings.push(
        `${vacNoArea.length} vacant line${vacNoArea.length === 1 ? " states" : "s state"} no area; the vacant area leaves ${vacNoArea.length === 1 ? "it" : "them"} out`,
      );
  }
  const totalSf = vacSf !== null ? round(occSf + vacSf, 2) : null;
  const occupancy =
    totalSf !== null && totalSf > 0 ? pct4(occSf / totalSf) : null;
  if (occupancy === null)
    warnings.push(
      "occupancy is not given: the roll has no vacant lines and no building_area_sf was supplied, so the total area is not known",
    );

  const statedAll = occ.filter((o) => o.rollAnnual !== null);
  const statedTotal = usd(statedAll.reduce((s, o) => s + o.rollAnnual!, 0));
  const withLease = occ.filter(
    (o) => o.leaseAnnual !== null && o.rollAnnual !== null,
  );
  const statedOnChecked = usd(withLease.reduce((s, o) => s + o.rollAnnual!, 0));
  const perLeases = usd(withLease.reduce((s, o) => s + o.leaseAnnual!, 0));
  const noRent = occ.filter((o) => o.rollAnnual === null);
  if (noRent.length)
    warnings.push(
      `${noRent.length} occupied line${noRent.length === 1 ? " states" : "s state"} no base rent (${noRent.map((o) => o.line.line_id).join(", ")}); the rent totals leave ${noRent.length === 1 ? "it" : "them"} out`,
    );
  const differenceRent = usd(statedOnChecked - perLeases);

  // WALT: by calc.walt, the same calculator as calc_walt.
  const exp = (o: Out): string | null => {
    const f = o.line.facts.get("rent_roll.lease_expiration_date");
    return f ? String(f.value) : null;
  };
  const waltInputs = (
    pick: (o: Out) => { id: string; exp: string | null; w: number | null },
    by: "area" | "rent",
  ): ReturnType<typeof walt> | null => {
    const ls = occ
      .map(pick)
      .filter((x) => x.exp !== null && x.w !== null && x.w > 0)
      .map((x) => ({
        id: x.id,
        expiration_date: x.exp!,
        ...(by === "area" ? { area_sf: x.w! } : { annual_rent: x.w! }),
      }));
    return ls.length ? walt({ as_of: asOf, weight_by: by, leases: ls }) : null;
  };
  const wRollArea = waltInputs(
    (o) => ({ id: o.line.line_id, exp: exp(o), w: areaOf(o) }),
    "area",
  );
  const wRollRent = waltInputs(
    (o) => ({ id: o.line.line_id, exp: exp(o), w: o.rollAnnual }),
    "rent",
  );
  const wLeaseArea = waltInputs(
    (o) => ({ id: o.line.line_id, exp: o.leaseExp, w: o.leaseArea }),
    "area",
  );
  const noExp = occ.filter((o) => exp(o) === null);
  if (noExp.length)
    warnings.push(
      `${noExp.length} occupied line${noExp.length === 1 ? " states" : "s state"} no expiration date (${noExp.map((o) => o.line.line_id).join(", ")}); the weighted average lease term and the rollover leave ${noExp.length === 1 ? "it" : "them"} out`,
    );
  const waltOut = (w: ReturnType<typeof walt> | null): Json | null =>
    w
      ? {
          years: w.value.walt_years,
          weight_total: w.value.total_weight,
          expired_count: w.value.expired_count,
          steps: w.steps as unknown as Json[],
          warnings: w.warnings,
        }
      : null;

  // Rollover by calendar year of the expiration on the roll.
  const rollRows = new Map<string, { n: number; sf: number; rent: number }>();
  for (const o of occ) {
    const e = exp(o);
    if (e === null) continue;
    const key = e < asOf ? "expired" : e.slice(0, 4);
    const r = rollRows.get(key) ?? { n: 0, sf: 0, rent: 0 };
    r.n += 1;
    r.sf = round(r.sf + (areaOf(o) ?? 0), 2);
    r.rent = usd(r.rent + (o.rollAnnual ?? 0));
    rollRows.set(key, r);
  }
  const rollKeys = [...rollRows.keys()].sort((a, b) =>
    a === "expired" ? -1 : b === "expired" ? 1 : a < b ? -1 : a > b ? 1 : 0,
  );
  const rollover = rollKeys.map((k) => {
    const r = rollRows.get(k)!;
    return {
      period: k === "expired" ? "Expired before the as-of date" : k,
      year: k === "expired" ? null : Number(k),
      leases: r.n,
      area_sf: r.sf,
      share_of_occupied_area: occSf > 0 ? pct4(r.sf / occSf) : null,
      annual_base_rent: r.rent,
      share_of_stated_rent: statedTotal > 0 ? pct4(r.rent / statedTotal) : null,
    };
  });

  // Concentration by tenant name.
  const groups = new Map<
    string,
    { name: string; rent: number; sf: number; lines: number }
  >();
  for (const o of occ) {
    const k = normName(o.tenant) || o.line.line_id;
    const g = groups.get(k) ?? { name: o.tenant, rent: 0, sf: 0, lines: 0 };
    g.rent = usd(g.rent + (o.rollAnnual ?? 0));
    g.sf = round(g.sf + (areaOf(o) ?? 0), 2);
    g.lines += 1;
    groups.set(k, g);
  }
  const ranked = [...groups.values()].sort((a, b) =>
    b.rent !== a.rent
      ? b.rent - a.rent
      : a.name < b.name
        ? -1
        : a.name > b.name
          ? 1
          : 0,
  );
  const top = ranked.slice(0, 5).map((g, i) => ({
    rank: i + 1,
    tenant: g.name,
    lines: g.lines,
    annual_base_rent: g.rent,
    share_of_stated_rent: statedTotal > 0 ? pct4(g.rent / statedTotal) : null,
    area_sf: g.sf,
    share_of_occupied_area: occSf > 0 ? pct4(g.sf / occSf) : null,
  }));
  const topShare = (n: number): number | null =>
    statedTotal > 0
      ? pct4(
          usd(ranked.slice(0, n).reduce((s, g) => s + g.rent, 0)) / statedTotal,
        )
      : null;

  // Grades.
  const gradeCounts: Record<string, number> = {};
  for (const g of GRADES)
    gradeCounts[g] = occ.filter((o) => o.grade === g).length;
  const relyable = occ.filter(
    (o) =>
      o.grade === "matches_lease" ||
      o.grade === "matches_lease_confirmed_by_tenant",
  );

  // ---- items for fact_package_send -----------------------------------------------------------------------
  const packageIds: string[] = [];
  const items: Json[] = occ.map((o) => {
    for (const id of o.factIds)
      if (!packageIds.includes(id)) packageIds.push(id);
    const diffs = o.checks
      .filter((c) => c.status === "differs")
      .slice(0, 12)
      .map((c) => ({
        field: c.field,
        label: c.label,
        roll: c.roll_value,
        against: c.against_value,
        against_label:
          c.against === "lease"
            ? "Lease"
            : c.against === "estoppel"
              ? "Tenant"
              : "Roll",
        ...(c.difference !== null && c.difference_unit !== "days"
          ? { difference: c.difference }
          : {}),
      }));
    return {
      key: o.line.line_id,
      label: `${o.suite ? `Suite ${o.suite}, ` : ""}${o.tenant}`.slice(0, 160),
      value: o.rollAnnual !== null ? o.rollAnnual : "Not stated",
      ...(o.rollAnnual !== null ? { unit: "USD per year" } : {}),
      position: "state_ours",
      ...(o.leaseAnnual !== null ? { their_value: o.leaseAnnual } : {}),
      fact_ids: o.factIds,
      note: `${GRADE_LABEL[o.grade!]}${o.reasons.length ? `: ${o.reasons[0]}` : ""}`.slice(
        0,
        600,
      ),
      number: o.line.number,
      grade: o.grade,
      grade_label: GRADE_LABEL[o.grade!],
      ...(diffs.length ? { differences: diffs } : {}),
      ...(o.grade === "matches_lease_confirmed_by_tenant"
        ? {
            estoppel_package_id: o.estoppelPackage,
            estoppel_statements: o.estoppelStatements,
          }
        : {}),
    } as Json;
  });
  if (packageIds.length > RENT_ROLL_MAX_PACKAGE_FACTS)
    warnings.push(
      `the items rest on ${packageIds.length} facts and the Record takes at most ${RENT_ROLL_MAX_PACKAGE_FACTS} in one rent roll: send the roll in parts (by building or floor)`,
    );

  // ---- output lines ------------------------------------------------------------------------------------------
  const outLines = outs.map((o) => ({
    number: o.line.number,
    line_id: o.line.line_id,
    occupancy: o.line.vacant ? "vacant" : "occupied",
    tenant: o.line.vacant ? null : o.tenant,
    suite: o.suite,
    grade: o.grade,
    grade_label: o.grade ? GRADE_LABEL[o.grade] : "Vacant, not graded",
    reliance_possible:
      o.grade === "matches_lease" ||
      o.grade === "matches_lease_confirmed_by_tenant",
    roll: {
      area_sf: areaOf(o),
      lease_start_date:
        o.line.facts.get("rent_roll.lease_start_date")?.value ?? null,
      lease_expiration_date: exp(o),
      annual_base_rent: o.rollAnnual,
      annual_base_rent_basis: o.rollBasis,
    },
    lease: {
      supplied: o.hasLease,
      area_sf: o.leaseArea,
      expiration_date: o.leaseExp,
      annual_base_rent: o.leaseAnnual,
    },
    rent_difference:
      o.rollAnnual !== null && o.leaseAnnual !== null
        ? usd(o.rollAnnual - o.leaseAnnual)
        : null,
    checks: o.checks as unknown as Json[],
    reasons: o.reasons,
    confirmed_fields: o.confirmed,
    estoppel_package_id: o.estoppelPackage,
    fact_ids: o.factIds,
    roll_facts: o.line.all.map((f) => srcOf(f) as unknown as Json),
  })) as unknown as Json[];

  const sortedFlags = flags;
  const differenceFlags = sortedFlags.filter(
    (f) => f.severity === "difference",
  ).length;
  return {
    as_of: asOf,
    property: input.property.label,
    parties: input.parties as unknown as Json,
    ...(input.roll_document?.title
      ? { roll_document: { title: input.roll_document.title } }
      : {}),
    lines: outLines,
    key_figures: {
      occupancy,
      annual_base_rent_per_leases: perLeases,
      difference_from_roll: differenceRent,
      walt_years: wRollArea ? wRollArea.value.walt_years : null,
    },
    area: {
      occupied_sf: occSf,
      vacant_sf: vacSf,
      total_sf: totalSf,
      occupancy,
      vacant_basis: vacBasis,
    },
    base_rent: {
      stated_total: statedTotal,
      stated_on_lines_with_lease_rent: statedOnChecked,
      per_leases: perLeases,
      difference: differenceRent,
      stated_without_lease_rent: usd(statedTotal - statedOnChecked),
      lines_with_lease_rent: withLease.length,
      lines_without_lease_rent: statedAll.length - withLease.length,
    },
    walt: {
      formula: { id: "calc.walt", version: 1 },
      weighted_by_area_on_roll: waltOut(wRollArea),
      weighted_by_rent_on_roll: waltOut(wRollRent),
      weighted_by_area_per_leases: waltOut(wLeaseArea),
    },
    rollover,
    concentration: {
      top_tenants: top,
      top_1_share: topShare(1),
      top_3_share: topShare(3),
      top_5_share: topShare(5),
      tenants: ranked.length,
    },
    totals: {
      lines: outs.length,
      occupied_lines: occ.length,
      vacant_lines: vac.length,
      grades: gradeCounts,
      reliance_possible: relyable.length,
      flags: sortedFlags.length,
      differences: differenceFlags,
      leases_supplied: leasesIn.length,
      leases_without_roll_line: unmatched.length,
    },
    flags: sortedFlags as unknown as Json[],
    tolerance: {
      annual_usd: tolAnnual,
      monthly_usd: round(tolMonthly, 6),
      psf: tolPsf,
    },
    package_facts: packageIds,
    package_items: items,
    package_calculation: {
      tool: "rent_roll_certify",
      as_of: asOf,
      occupancy,
      occupied_sf: occSf,
      vacant_sf: vacSf,
      annual_base_rent_as_stated: statedTotal,
      annual_base_rent_per_leases: perLeases,
      difference: differenceRent,
      walt_years: wRollArea ? wRollArea.value.walt_years : null,
      walt_formula: "calc.walt@1",
      grades: gradeCounts,
      rollover: rollover as unknown as Json[],
      top_tenants: top as unknown as Json[],
      flags: sortedFlags.map((f) => ({
        code: f.code,
        line_id: f.line_id,
        message: f.message,
      })),
    },
    facts_ignored: [...new Set(ignored)],
    warnings,
    notes: [
      "These are facts and arithmetic, not legal, appraisal or lending advice. FactLot checked the rent roll against the lease documents (and the estoppel answers) supplied, and against nothing else.",
      "A line is graded 'matches' only when its tenant, area, expiration and current base rent were each compared with the lease and agree. A field no lease fact covers is 'not checked', never assumed to match.",
      "The certifying party's certification, not FactLot, is what a lender or buyer relies on. Reliance is recorded per line, only for lines graded as matching.",
    ],
  };
}

/** The summary a caller without a paid plan gets (hosted API, gating on). */
export function rentRollSummary(full: Json): Json {
  return {
    limited: true,
    summary: {
      as_of: full.as_of,
      key_figures: full.key_figures,
      area: full.area,
      base_rent: full.base_rent,
      totals: full.totals,
      flags: (full.flags as Json[]).map((f) => ({
        code: f.code,
        line_id: f.line_id,
      })),
    },
    rent_roll_available: "pro",
    rent_roll_withheld: [
      "the grade of each line with the roll and lease figures, quotes, pages and document fingerprints behind it",
      "the differences, with both figures and the quotes",
      "the rollover schedule and the top-tenant concentration",
      "the items to send with fact_package_send (kind rent_roll)",
      "the rent roll certificate (report_create kind rent_roll_certificate)",
    ],
    rent_roll_note: `The totals, key figures, the count of lines under each grade and the flags are free. Each line's grade with its sources, the report and sending the certified roll are part of the paid plans (Pro and Team): ${RENT_ROLL_PLAN_URL}`,
  };
}

/** True when the host (the hosted Worker) has said this caller gets the summary only. */
export function rentRollLimited(): boolean {
  return currentExchangeCaller()?.fullAudit === false;
}

export function rentRollCertify(input: RentRollInput): Json {
  const full = certifyRentRoll(input);
  return gateDocument(
    "rent_roll_certify",
    full,
    rentRollSummary,
    rentRollLimited(),
  );
}
