/**
 * lease_comp_validate: check a shared lease comparable and derive its net effective rent.
 *
 * A comp is a `lease.comp` fact whose value is a `LeaseComp` (@factlot/schema). The check reuses
 * fact_validate for the fact itself, adds the comp's own rules (shape, term, concessions within the
 * term, no contact details), and computes the net effective rent with calc.net_effective_rent so
 * every shared comp carries a derived NER with its formula ID. python/src/factlot/comps.py is the
 * same code in Python; spec/vectors/lease_comps.json pins both.
 */
import { netEffectiveRent } from "@factlot/calc";
import type { NetEffectiveRentInput } from "@factlot/calc";
import { LeaseComp } from "@factlot/schema";
import { z } from "zod";

import { validateFact } from "./documents.ts";
import { isPlainObject } from "./quotes.ts";

type Json = Record<string, unknown>;
type Issue = { path: string; message: string };
type Producer = { name: string; version: string };

export const LeaseCompValidateInput = z.object({
  fact: z
    .record(z.string(), z.unknown())
    .describe(
      "A FactLot fact with predicate lease.comp: subject (an fl:lease: URN), value (the comp), as_of, provenance (with at least one source: your own record is fine, cited by document_id or sha256 without sharing it), and rights (ai_use and redistribution).",
    ),
  profile: z
    .enum(["share", "observed"])
    .default("share")
    .describe(
      "share (default): a comp offered to other firms: needs the deal's starting rent, escalations, free rent, TI, expense basis, property type, a term and stated rights. observed: a rent seen in a public record (current_rent_psf_yr is enough); no NER is derived without a starting rent.",
    ),
  discount_rate_annual: z
    .number()
    .min(0)
    .lt(1)
    .default(0.08)
    .describe(
      "Annual discount rate for the discounted NER (an assumption, not part of the comp). 0 gives the straight-line NER only.",
    ),
});

const PERSONAL_DATA: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(?:\+?1[\s.-]?)?\(?[0-9]{3}\)?[\s.-][0-9]{3}[\s.-][0-9]{4}/,
  /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/,
];
const SHARE_METHODS = [
  "reported",
  "human_verified",
  "extracted",
  "public_record",
];
const DAYS_PER_MONTH = 30.4375;

function dayNumber(iso: string): number {
  return Math.floor(
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10)),
    ) / 86_400_000,
  );
}

function isDate(v: unknown): v is string {
  return z.iso.date().safeParse(v).success;
}

function numberOr0(v: unknown): number {
  return isNum(v) ? v : 0;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Months from commencement through expiration (both days inclusive), rounded half up. */
export function impliedTermMonths(
  commencement: string,
  expiration: string,
): number {
  return Math.floor(
    (dayNumber(expiration) - dayNumber(commencement) + 1) / DAYS_PER_MONTH +
      0.5,
  );
}

/** Issues in a `LeaseComp` value: its shape, then the rules that need two fields. Paths are relative to the value. */
export function leaseCompValueIssues(value: unknown): Issue[] {
  const parsed = LeaseComp.safeParse(value);
  const out: Issue[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
  if (!isPlainObject(value)) return out;
  const v = value;
  const has = (k: string) => Object.hasOwn(v, k) && v[k] !== undefined;
  const commencement = isDate(v.commencement_date)
    ? v.commencement_date
    : undefined;
  const expiration = isDate(v.expiration_date) ? v.expiration_date : undefined;
  const termGiven = isNum(v.term_months) ? v.term_months : undefined;

  if (!has("starting_rent_psf_yr") && !has("current_rent_psf_yr"))
    out.push({
      path: "starting_rent_psf_yr",
      message:
        "give starting_rent_psf_yr (the deal's first-year base rent) or current_rent_psf_yr (an observed rent)",
    });
  if (!has("term_months") && !has("expiration_date"))
    out.push({
      path: "term_months",
      message: "give term_months or expiration_date",
    });
  let term = termGiven;
  if (commencement && expiration) {
    if (dayNumber(expiration) <= dayNumber(commencement)) {
      out.push({
        path: "expiration_date",
        message: "expiration_date is not after commencement_date",
      });
    } else {
      const implied = impliedTermMonths(commencement, expiration);
      if (termGiven !== undefined) {
        const exact =
          (dayNumber(expiration) - dayNumber(commencement) + 1) /
          DAYS_PER_MONTH;
        if (Math.abs(termGiven - exact) > 1.5)
          out.push({
            path: "term_months",
            message: `term_months ${termGiven} does not match commencement_date to expiration_date (about ${implied} months)`,
          });
      } else {
        term = implied;
      }
    }
  }
  const early = isDate(v.early_termination_date)
    ? v.early_termination_date
    : undefined;
  if (early && commencement && dayNumber(early) < dayNumber(commencement))
    out.push({
      path: "early_termination_date",
      message: "early_termination_date is before commencement_date",
    });
  if (early && expiration && dayNumber(early) > dayNumber(expiration))
    out.push({
      path: "early_termination_date",
      message: "early_termination_date is after expiration_date",
    });
  const esc = isPlainObject(v.escalation) ? v.escalation : undefined;
  if (esc?.type === "percent" && !isNum(esc.rate))
    out.push({
      path: "escalation.rate",
      message: "an escalation of type percent needs rate (0.03 for 3%)",
    });
  if (esc?.type === "fixed_psf" && !isNum(esc.amount))
    out.push({
      path: "escalation.amount",
      message:
        "an escalation of type fixed_psf needs amount (USD per SF per year)",
    });
  const free = isNum(v.free_rent_months) ? v.free_rent_months : undefined;
  if (free !== undefined && term !== undefined && free > term)
    out.push({
      path: "free_rent_months",
      message: "free_rent_months is longer than the term",
    });
  for (const key of ["notes", "submarket"]) {
    const text = v[key];
    if (typeof text === "string" && PERSONAL_DATA.some((re) => re.test(text)))
      out.push({
        path: key,
        message:
          "looks like an email address, phone number or ID number; a comp carries no personal data",
      });
  }
  return out;
}

function nerSchedule(v: Json, term: number): Json {
  const esc = isPlainObject(v.escalation) ? v.escalation : { type: "none" };
  const escalation: Json =
    esc.type === "percent"
      ? {
          type: "percent",
          rate: esc.rate,
          every_months: esc.every_months ?? 12,
        }
      : esc.type === "fixed_psf"
        ? {
            type: "fixed_psf",
            amount: esc.amount,
            every_months: esc.every_months ?? 12,
          }
        : { type: "none" };
  const free = isNum(v.free_rent_months)
    ? Math.min(v.free_rent_months, term)
    : 0;
  return {
    commencement_date: v.commencement_date,
    term_months: term,
    area_sf: v.area_sf,
    starting_rent_psf_annual: v.starting_rent_psf_yr,
    escalation,
    abated_months: Array.from({ length: free }, (_, i) => i + 1),
  };
}

export function validateLeaseComp(
  input: z.output<typeof LeaseCompValidateInput>,
  producer: Producer,
): Json {
  const { fact, profile, discount_rate_annual } = input;
  const issues: Issue[] = validateFact(fact).issues;
  const warnings: string[] = [];
  if (fact.predicate !== "lease.comp")
    issues.push({ path: "predicate", message: 'expected "lease.comp"' });
  if (typeof fact.subject !== "string" || !fact.subject.startsWith("fl:lease:"))
    issues.push({
      path: "subject",
      message: "a lease comp is about a lease: expected an fl:lease: URN",
    });
  const value = fact.value;
  const valueIssues = leaseCompValueIssues(value);
  for (const i of valueIssues)
    issues.push({
      path: i.path ? `value.${i.path}` : "value",
      message: i.message,
    });
  const v: Json = isPlainObject(value) ? value : {};
  const has = (k: string) => Object.hasOwn(v, k) && v[k] !== undefined;

  const rights = isPlainObject(fact.rights) ? fact.rights : undefined;
  const prov = isPlainObject(fact.provenance) ? fact.provenance : undefined;
  if (profile === "share" && isPlainObject(value)) {
    const need: [string, string][] = [
      [
        "starting_rent_psf_yr",
        "a shared comp states the deal's starting rent (current_rent_psf_yr alone is an observed rent)",
      ],
      ["escalation", "state the escalations (type none if the rent is flat)"],
      ["free_rent_months", "state the free rent (0 if none)"],
      [
        "ti_allowance_psf",
        "state the tenant improvement allowance (0 if none)",
      ],
      ["property_type", "state the property type"],
    ];
    for (const [key, message] of need)
      if (!has(key)) issues.push({ path: `value.${key}`, message });
    if (!has("expense_basis") || v.expense_basis === "unknown")
      issues.push({
        path: "value.expense_basis",
        message:
          "state the expense basis (full_service, nnn, ...): rent means little without it",
      });
    if (!rights)
      issues.push({
        path: "rights",
        message:
          "a shared comp states its rights: ai_use and redistribution (permitted, attribution_required, prohibited or unknown)",
      });
    if (
      prov &&
      typeof prov.method === "string" &&
      !SHARE_METHODS.includes(prov.method)
    )
      issues.push({
        path: "provenance.method",
        message: `a comp is ${SHARE_METHODS.join(", ")}; ${prov.method} facts are not shared as comps`,
      });
    if (v.verification === "document_verified") {
      const sources = prov && Array.isArray(prov.sources) ? prov.sources : [];
      const hashed = sources.some(
        (s) =>
          isPlainObject(s) &&
          (typeof s.sha256 === "string" ||
            (typeof s.document_id === "string" &&
              s.document_id.startsWith("fl:document:sha256-"))),
      );
      if (!hashed)
        issues.push({
          path: "provenance.sources",
          message:
            "verification document_verified needs a source with the document's sha256 (or an fl:document:sha256- document_id)",
        });
    }
  }
  if (rights) {
    if (rights.ai_use === "unknown" || rights.redistribution === "unknown")
      warnings.push(
        "rights say unknown for ai_use or redistribution: other firms cannot tell what they may do with this comp, and a cautious reader will treat unknown as prohibited",
      );
  }
  if (
    isNum(v.starting_rent_psf_yr) &&
    (v.starting_rent_psf_yr > 500 ||
      (v.starting_rent_psf_yr > 0 && v.starting_rent_psf_yr < 1))
  )
    warnings.push(
      `starting_rent_psf_yr ${v.starting_rent_psf_yr} is outside the usual 1 to 500 USD per SF per year: check it is annual, not monthly`,
    );
  if (
    isNum(v.free_rent_months) &&
    isNum(v.term_months) &&
    v.free_rent_months === v.term_months
  )
    warnings.push(
      "free_rent_months equals term_months: no base rent is ever payable, so the NER is negative",
    );
  if (isNum(v.area_sf) && v.area_sf > 5_000_000)
    warnings.push(`area_sf ${v.area_sf} is above 5,000,000: check the unit`);

  const valid = issues.length === 0;
  let ner: Json | null = null;
  let nerReason: string | undefined;
  if (valid && !has("starting_rent_psf_yr")) {
    nerReason =
      "no starting_rent_psf_yr: net effective rent needs the deal's starting rent, and an observed current rent is not one";
  } else if (valid) {
    const term = isNum(v.term_months)
      ? v.term_months
      : impliedTermMonths(
          v.commencement_date as string,
          v.expiration_date as string,
        );
    const result = netEffectiveRent({
      schedule: nerSchedule(v, term) as NetEffectiveRentInput["schedule"],
      ti_allowance_psf: numberOr0(v.ti_allowance_psf),
      leasing_commissions: numberOr0(v.leasing_commissions_usd),
      other_concessions: numberOr0(v.other_concessions_usd),
      discount_rate_annual,
    });
    const formula = `${result.formula.id}@${result.formula.version}`;
    warnings.push(...result.warnings);
    if (v.free_rent_applies_to === "gross_rent")
      warnings.push(
        "free rent applies to gross rent, but the NER abates base rent only: the NER is higher than the tenant's true saving",
      );
    const nerValue: Json = {
      net_effective_rent_psf: result.value.net_effective_rent_psf,
      discounted_net_effective_rent_psf:
        result.value.discounted_net_effective_rent_psf,
      effective_rent_psf: result.value.effective_rent_psf,
      discount_rate_annual,
      term_months: term,
      expense_basis: v.expense_basis ?? "unknown",
    };
    const nerFact: Json = {
      subject: fact.subject,
      predicate: "lease.net_effective_rent",
      value: nerValue,
      unit: "USD/sf/yr",
      as_of: fact.as_of,
      provenance: {
        method: "computed",
        sources: [],
        formula,
        producer,
        ...(typeof fact.id === "string" ? { inputs: [fact.id] } : {}),
      },
      ...(rights ? { rights } : {}),
    };
    ner = { formula, fact: nerFact };
  }
  return {
    valid,
    profile,
    issues,
    warnings,
    ner,
    ...(nerReason ? { ner_reason: nerReason } : {}),
  };
}
