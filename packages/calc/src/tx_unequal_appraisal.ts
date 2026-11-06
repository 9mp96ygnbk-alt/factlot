/**
 * Texas unequal appraisal: the comparison of Tax Code §41.43(b)(3) and §42.26(a)(3), "the
 * appraised value of the property ... the median appraised value of a reasonable number of
 * comparable properties appropriately adjusted".
 *
 * Evidence calculation only. The caller supplies the comparables and every adjustment with its
 * reason; this module normalizes, adjusts, sorts and takes the median, recording each step. It
 * never chooses comparables, invents adjustments, or says what to do with the result.
 */
import { z } from "zod";

import {
  CalcInputError,
  IsoDate,
  Trace,
  fmtMoney,
  fmtNum,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

/** First warning on every result. */
export const TX_EVIDENCE_NOTICE =
  "Evidence calculation only: arithmetic on the values and adjustments supplied. It is not an appraisal (Tax Code §41.66(l)), not legal or tax advice, and does not say whether to protest or what value to claim. FactLot does not represent property owners (Occupations Code ch. 1152).";

/** Fewest comparables accepted: a FactLot product floor, not a rule of law. */
export const TX_MIN_COMPARABLES = 3;
const MAX_COMPARABLES = 200;
/** Comparables below this count draw a warning (the statute does not define "a reasonable number"). */
const FEW_COMPARABLES = 5;
/** Total adjustment above this share (either way) draws a warning: a FactLot flag, not law. */
const LARGE_ADJUSTMENT = 0.25;

const STATUTES = "https://statutes.capitol.texas.gov/Docs/TX/htm";

export const TX_UNEQUAL_APPRAISAL_LAW: readonly {
  section: string;
  url: string;
  covers: string;
}[] = [
  {
    section: "Tex. Tax Code §41.43(b)(3)",
    url: `${STATUTES}/TX.41.htm#41.43`,
    covers:
      "at the appraisal review board, an unequal-appraisal protest is determined for the owner unless the district establishes that the appraised value is equal to or less than the median appraised value of a reasonable number of comparable properties appropriately adjusted",
  },
  {
    section: "Tex. Tax Code §42.26(a)(3) and (b)",
    url: `${STATUTES}/TX.42.htm#42.26`,
    covers:
      "on appeal, relief when the appraised value exceeds that median, and the appraised value changed to the value calculated on the basis of the median appraised value",
  },
  {
    section: "Tex. Tax Code §42.26(d)",
    url: `${STATUTES}/TX.42.htm#42.26`,
    covers:
      "which value is compared when the property is subject to an appraised-value limitation: until 2027-01-01, market value under §23.23 or §23.231; from 2027-01-01, market value for a residence homestead under §23.23",
  },
  {
    section: "Tex. Tax Code §41.66(l)",
    url: `${STATUTES}/TX.41.htm#41.66`,
    covers:
      "a person offering evidence or argument in a value or unequal-appraisal protest is not subject to Occupations Code ch. 1103 unless they say they offer it as a licence or certificate holder",
  },
];

const ValueBasis = z
  .enum(["appraised", "market"])
  .describe(
    'Which roll value this is: "appraised" (after any limitation) or "market". Use the same basis for the subject and every comparable.',
  );

const CountyFips = z
  .string()
  .regex(/^[0-9]{3}$/, { message: "expected a 3-digit county FIPS code" })
  .describe(
    'Texas county FIPS code, 3 digits, e.g. "201" for Harris. Optional; used only to warn when a comparable is in a different county (appraisal district) from the subject.',
  );

const Area = z.number().finite().positive();

const Adjustment = z.strictObject({
  label: z
    .string()
    .min(1)
    .max(100)
    .describe('What the adjustment is for, e.g. "age", "size", "condition".'),
  kind: z
    .enum(["percent", "amount", "psf"])
    .describe(
      '"percent": a decimal share of the normalized value (0.05 for +5%, -0.02 for -2%); "amount": USD added to the value (negative to deduct); "psf": USD per SF of the normalizing area, multiplied by the subject\'s area (only with normalize_by other than "none").',
    ),
  value: z
    .number()
    .finite()
    .describe(
      "The adjustment: a decimal between -1 and 1 for percent (0.05, not 5), else USD or USD/SF. Positive raises the comparable's value.",
    ),
  reason: z
    .string()
    .min(1)
    .max(300)
    .describe(
      'Why the adjustment is made, in the caller\'s words (e.g. "comp built 1998, subject 2006"). Required: FactLot never invents an adjustment.',
    ),
});

const Citation = z
  .strictObject({
    fact_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "FactLot fact ID of the comparable's value, if it came from the registry.",
      ),
    document_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "FactLot document ID of the source (e.g. the appraisal roll file).",
      ),
    locator: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe("Where in the source the value is: row, account number, page."),
    as_of: IsoDate.optional().describe(
      "Date the value was read or certified, YYYY-MM-DD.",
    ),
  })
  .describe(
    "Where the comparable's value comes from. Passed through to the output unchanged.",
  );

const Comparable = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Identifier of the comparable, e.g. its FactLot parcel ID or account number. Must differ from the subject's and from every other comparable's.",
    ),
  county_fips: CountyFips.optional(),
  value: z
    .number()
    .finite()
    .positive()
    .describe("The comparable's value from the appraisal roll, USD."),
  value_basis: ValueBasis,
  improvement_area_sf: Area.optional().describe(
    "Improvement (building) area, SF. Required when normalize_by is improvement_area_sf.",
  ),
  land_area_sf: Area.optional().describe(
    "Land area, SF. Required when normalize_by is land_area_sf.",
  ),
  citation: Citation.optional(),
  adjustments: z
    .array(Adjustment)
    .max(20)
    .default([])
    .describe(
      "Adjustments to this comparable, each with a reason. Percentages are applied first (summed or compounded per adjustment_combine), then amounts and $/SF adjustments.",
    ),
});

export const TxUnequalAppraisalInput = z.strictObject({
  tax_year: z
    .number()
    .int()
    .min(1982)
    .max(2100)
    .describe(
      "Tax year of the values compared, e.g. 2027. Decides which text of §42.26(d) applies.",
    ),
  subject: z
    .strictObject({
      id: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
          "Identifier of the subject property, e.g. its FactLot parcel ID.",
        ),
      county_fips: CountyFips.optional(),
      value: z
        .number()
        .finite()
        .positive()
        .describe(
          "The subject's value from the appraisal roll (or the value at issue), USD.",
        ),
      value_basis: ValueBasis,
      improvement_area_sf: Area.optional().describe(
        "Improvement (building) area, SF. Required when normalize_by is improvement_area_sf.",
      ),
      land_area_sf: Area.optional().describe(
        "Land area, SF. Required when normalize_by is land_area_sf.",
      ),
      circuit_breaker_23_231: z
        .boolean()
        .default(false)
        .describe(
          "Whether the subject is subject to the §23.231 limitation on appraised value (the circuit breaker for non-homestead property). Only used for warnings about which value §42.26(d) compares.",
        ),
    })
    .describe("The property whose value is compared."),
  normalize_by: z
    .enum(["none", "improvement_area_sf", "land_area_sf"])
    .default("none")
    .describe(
      '"none" compares whole values. "improvement_area_sf" or "land_area_sf" converts each comparable to value per SF of that area and multiplies by the subject\'s same area before adjusting; the subject and every comparable must then have that area.',
    ),
  adjustment_combine: z
    .enum(["sum", "compound"])
    .default("sum")
    .describe(
      '"sum" adds a comparable\'s percentage adjustments and applies the total once (the usual adjustment grid); "compound" multiplies (1 + each percentage).',
    ),
  comparables: z
    .array(Comparable)
    .min(TX_MIN_COMPARABLES, {
      message:
        "at least 3 comparables are required (a FactLot product floor, not a rule of law: the statute says only 'a reasonable number')",
    })
    .max(MAX_COMPARABLES)
    .describe(
      "The comparable properties, 3 to 200, chosen by the caller. Values must be on the same basis as the subject's.",
    ),
});
export type TxUnequalAppraisalInput = z.input<typeof TxUnequalAppraisalInput>;

type ParsedComparable = z.output<typeof Comparable>;

export interface TxUnequalAppraisalComparable {
  /** Position in the input list, from 0. */
  index: number;
  id: string | null;
  county_fips: string | null;
  value: number;
  value_basis: "appraised" | "market";
  /** Value ÷ the comparable's area × the subject's area, or the value itself when normalize_by is "none". */
  normalized_value: number;
  /** 1 + Σ percentages (sum) or Π(1 + percentage) (compound), to 6 decimals. */
  percent_factor: number;
  after_percent_value: number;
  /** Σ amount adjustments + Σ $/SF adjustments × the subject's area, USD. */
  amount_adjustments_total: number;
  adjusted_value: number;
  /** Adjusted value ÷ the subject's normalizing area; null when normalize_by is "none". */
  adjusted_value_psf: number | null;
  /** Adjusted ÷ normalized − 1. */
  total_adjustment_pct: number;
  adjustments: {
    label: string;
    kind: "percent" | "amount" | "psf";
    value: number;
    reason: string;
  }[];
  citation: z.output<typeof Citation> | null;
}

export interface TxUnequalAppraisal {
  disclaimer: string;
  tax_year: number;
  normalize_by: "none" | "improvement_area_sf" | "land_area_sf";
  adjustment_combine: "sum" | "compound";
  comparables_count: number;
  comparables: TxUnequalAppraisalComparable[];
  /** Every adjusted value, ascending (ties in input order). */
  sorted_adjusted_values: number[];
  /** The median of the adjusted values: the comparison figure §41.43(b)(3) and §42.26(a)(3) use. */
  median_adjusted_value: number;
  /** The two middle values when the count is even (the median is their mean); null when odd. */
  median_pair: [number, number] | null;
  subject_id: string | null;
  subject_value: number;
  subject_value_basis: "appraised" | "market";
  subject_minus_median: number;
  subject_minus_median_pct: number;
  subject_above_median: boolean;
  law: { section: string; url: string; covers: string }[];
}

function areaOf(
  c: { improvement_area_sf?: number; land_area_sf?: number },
  by: "improvement_area_sf" | "land_area_sf",
): number | undefined {
  return by === "improvement_area_sf" ? c.improvement_area_sf : c.land_area_sf;
}

/** "C-1", or "#2" for a comparable without an id. */
function labelOf(c: ParsedComparable, i: number): string {
  return c.id ?? `#${i + 1}`;
}

/** "comparable C-1" or "comparables C-1, #3". */
function named(labels: string[]): string {
  return `${labels.length === 1 ? "comparable" : "comparables"} ${labels.join(", ")}`;
}

function checkInput(input: z.output<typeof TxUnequalAppraisalInput>): void {
  const issues: { path: string; message: string }[] = [];
  const by = input.normalize_by;
  if (by !== "none" && areaOf(input.subject, by) === undefined)
    issues.push({
      path: `subject.${by}`,
      message: `required when normalize_by is ${by}`,
    });
  const seen = new Map<string, number>();
  input.comparables.forEach((c, i) => {
    if (by !== "none" && areaOf(c, by) === undefined)
      issues.push({
        path: `comparables.${i}.${by}`,
        message: `required when normalize_by is ${by}`,
      });
    if (c.id !== undefined) {
      if (input.subject.id !== undefined && c.id === input.subject.id)
        issues.push({
          path: `comparables.${i}.id`,
          message: `is the subject's id (${c.id}): the subject cannot be its own comparable`,
        });
      const first = seen.get(c.id);
      if (first !== undefined)
        issues.push({
          path: `comparables.${i}.id`,
          message: `duplicates comparables.${first}.id (${c.id})`,
        });
      else seen.set(c.id, i);
    }
    c.adjustments.forEach((a, j) => {
      const at = `comparables.${i}.adjustments.${j}`;
      if (a.kind === "percent" && !(a.value > -1 && a.value < 1))
        issues.push({
          path: `${at}.value`,
          message: `a percent adjustment must be a decimal between -1 and 1 but is ${a.value} (percentages are decimals: pass ${a.value / 100} for ${a.value}%)`,
        });
      if (a.kind === "psf" && by === "none")
        issues.push({
          path: `${at}.kind`,
          message:
            "psf adjustments need a normalizing area: set normalize_by to improvement_area_sf or land_area_sf, or use an amount adjustment",
        });
    });
  });
  if (issues.length > 0)
    throw new CalcInputError(
      `invalid input: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
      issues,
    );
}

/** Texas unequal-appraisal arithmetic (§41.43(b)(3), §42.26(a)(3)): median of adjusted comparables. */
export function txUnequalAppraisal(
  raw: TxUnequalAppraisalInput,
): CalcResult<TxUnequalAppraisal> {
  const input = parseInput(TxUnequalAppraisalInput, raw);
  checkInput(input);
  const t = new Trace();
  t.warn(TX_EVIDENCE_NOTICE);
  const subject = input.subject;
  const by = input.normalize_by;
  const subjectArea = by === "none" ? 0 : (areaOf(subject, by) as number);
  const areaName = by === "improvement_area_sf" ? "improvement" : "land";

  t.step(
    "Normalization",
    by === "none"
      ? "none: whole values compared"
      : `${by}: each comparable's value per SF of ${areaName} area × the subject's ${fmtNum(subjectArea)} SF`,
  );
  t.step(
    "Percentage adjustments",
    input.adjustment_combine === "sum"
      ? "sum: a comparable's percentages are added and applied once"
      : "compound: a comparable's factor is the product of (1 + each percentage)",
  );

  const comps: TxUnequalAppraisalComparable[] = [];
  input.comparables.forEach((c, i) => {
    const name = `Comparable ${labelOf(c, i)}`;
    let normalized: number;
    if (by === "none")
      normalized = t.step(
        `${name}: normalized value`,
        round(c.value, 2),
        "value as given (no normalization)",
        "USD",
      );
    else {
      const area = areaOf(c, by) as number;
      normalized = t.step(
        `${name}: normalized value`,
        round((c.value / area) * subjectArea, 2),
        `${fmtMoney(c.value)} ÷ ${fmtNum(area)} SF × ${fmtNum(subjectArea)} SF`,
        "USD",
      );
    }

    const pcts = c.adjustments.filter((a) => a.kind === "percent");
    let rawFactor: number;
    let factorText: string;
    if (input.adjustment_combine === "sum") {
      let s = 0;
      for (const a of pcts) s += a.value;
      rawFactor = 1 + s;
      factorText =
        pcts.length === 0
          ? "no percentage adjustments"
          : `1 + (${pcts.map((a) => `${a.label} ${fmtNum(a.value)}`).join(" + ")})`;
    } else {
      let f = 1;
      for (const a of pcts) f *= 1 + a.value;
      rawFactor = f;
      factorText =
        pcts.length === 0
          ? "no percentage adjustments"
          : pcts.map((a) => `(1 + ${a.label} ${fmtNum(a.value)})`).join(" × ");
    }
    const factor = t.step(
      `${name}: percentage factor`,
      round(rawFactor, 6),
      factorText,
    );
    if (factor <= 0)
      throw new CalcInputError(
        `${name}: the percentage adjustments total -100% or less (factor ${fmtNum(factor)})`,
        [
          {
            path: `comparables.${i}.adjustments`,
            message: "percentage adjustments leave a factor of 0 or less",
          },
        ],
      );
    const afterPercent = t.step(
      `${name}: after percentages`,
      round(normalized * factor, 2),
      `${fmtMoney(normalized)} × ${fmtNum(factor)}`,
      "USD",
    );

    let amounts = 0;
    let psf = 0;
    for (const a of c.adjustments) {
      if (a.kind === "amount") amounts += a.value;
      else if (a.kind === "psf") psf += a.value;
    }
    const adjusted = t.step(
      `${name}: adjusted value`,
      round(afterPercent + amounts + psf * subjectArea, 2),
      by === "none"
        ? `${fmtMoney(afterPercent)} + ${fmtMoney(amounts)} amount adjustments`
        : `${fmtMoney(afterPercent)} + ${fmtMoney(amounts)} amount adjustments + ${fmtNum(psf)} $/SF × ${fmtNum(subjectArea)} SF`,
      "USD",
    );
    if (adjusted <= 0)
      throw new CalcInputError(
        `${name}: the adjusted value is ${fmtMoney(adjusted)}; adjustments must leave a positive value`,
        [
          {
            path: `comparables.${i}.adjustments`,
            message: "adjustments leave an adjusted value of 0 or less",
          },
        ],
      );
    const totalPct = round(adjusted / normalized - 1, 6);
    comps.push({
      index: i,
      id: c.id ?? null,
      county_fips: c.county_fips ?? null,
      value: c.value,
      value_basis: c.value_basis,
      normalized_value: normalized,
      percent_factor: factor,
      after_percent_value: afterPercent,
      amount_adjustments_total: round(adjusted - afterPercent, 2),
      adjusted_value: adjusted,
      adjusted_value_psf:
        by === "none" ? null : round(adjusted / subjectArea, 2),
      total_adjustment_pct: totalPct,
      adjustments: c.adjustments.map((a) => ({
        label: a.label,
        kind: a.kind,
        value: a.value,
        reason: a.reason,
      })),
      citation: c.citation ? { ...c.citation } : null,
    });
  });

  // Ascending; Array.prototype.sort is stable, so ties stay in input order.
  const sorted = comps.map((c) => c.adjusted_value).sort((a, b) => a - b);
  const n = sorted.length;
  t.step(
    "Adjusted values, ascending",
    sorted.map((v) => fmtMoney(v)).join(", "),
    `${n} comparables`,
  );
  let median: number;
  let pair: [number, number] | null = null;
  if (n % 2 === 1) {
    median = t.step(
      "Median adjusted value",
      sorted[(n - 1) / 2] as number,
      `value ${(n + 1) / 2} of ${n} in ascending order: the comparison figure in §41.43(b)(3) and §42.26(a)(3)`,
      "USD",
    );
  } else {
    const lo = sorted[n / 2 - 1] as number;
    const hi = sorted[n / 2] as number;
    pair = [lo, hi];
    median = t.step(
      "Median adjusted value",
      round((lo + hi) / 2, 2),
      `mean of values ${n / 2} and ${n / 2 + 1} of ${n} in ascending order, (${fmtMoney(lo)} + ${fmtMoney(hi)}) ÷ 2: the comparison figure in §41.43(b)(3) and §42.26(a)(3)`,
      "USD",
    );
  }
  const diff = t.step(
    "Subject value minus median",
    round(subject.value - median, 2),
    `${fmtMoney(subject.value)} − ${fmtMoney(median)}`,
    "USD",
  );
  const diffPct = t.step(
    "Subject value minus median, share of median",
    round(diff / median, 6),
    `${fmtMoney(diff)} ÷ ${fmtMoney(median)}`,
  );

  // Warnings, in a fixed order.
  const labels = (pred: (c: ParsedComparable) => boolean) =>
    input.comparables
      .map((c, i) => (pred(c) ? labelOf(c, i) : undefined))
      .filter((x): x is string => x !== undefined);
  const otherBasis = labels((c) => c.value_basis !== subject.value_basis);
  if (otherBasis.length > 0)
    t.warn(
      `Value basis differs from the subject's (${subject.value_basis}) for ${named(otherBasis)}: compare the same kind of value for the subject and every comparable.`,
    );
  if (subject.circuit_breaker_23_231) {
    if (input.tax_year <= 2026) {
      const appraised = [
        ...(subject.value_basis === "appraised" ? ["the subject"] : []),
        ...labels((c) => c.value_basis === "appraised").map(
          (l) => `comparable ${l}`,
        ),
      ];
      if (appraised.length > 0)
        t.warn(
          `Tax year ${input.tax_year}: §42.26(d), in the text in effect until 2027-01-01, requires market value for the subject and the comparables when the property is subject to the §23.231 limitation, and ${appraised.join(", ")} use appraised value.`,
        );
    } else
      t.warn(
        `Tax year ${input.tax_year}: the subject is marked as subject to the §23.231 limitation, but §42.26(d) and §41.41(a) as in effect from 2027-01-01 no longer refer to §23.231; check whether the limitation still applies and which value is compared.`,
      );
  }
  if (subject.county_fips !== undefined) {
    const other = labels(
      (c) =>
        c.county_fips !== undefined && c.county_fips !== subject.county_fips,
    );
    if (other.length > 0)
      t.warn(
        `In a different county from the subject (FIPS ${subject.county_fips}): ${named(other)}. Unequal-appraisal comparisons are made within the appraisal district.`,
      );
  }
  if (n < FEW_COMPARABLES)
    t.warn(
      `Only ${n} comparables: §41.43(b)(3) and §42.26(a)(3) call for "a reasonable number" and the statute does not define it. FactLot's minimum of 3 is a product floor, not a rule of law.`,
    );
  const large = comps
    .filter((c) => Math.abs(c.total_adjustment_pct) > LARGE_ADJUSTMENT)
    .map((c) =>
      labelOf(input.comparables[c.index] as ParsedComparable, c.index),
    );
  if (large.length > 0)
    t.warn(
      `Total adjustment over 25% (adjusted ÷ normalized − 1) for ${named(large)}. This is a FactLot flag, not a legal limit; large adjustments deserve a second look.`,
    );
  const same = labels(
    (c) =>
      c.value === subject.value &&
      c.value_basis === subject.value_basis &&
      c.improvement_area_sf === subject.improvement_area_sf &&
      c.land_area_sf === subject.land_area_sf,
  );
  if (same.length > 0)
    t.warn(
      `Same value, value basis and areas as the subject: ${named(same)}. Check that the subject is not among its own comparables.`,
    );

  return t.result("calc.tx_unequal_appraisal", 1, {
    disclaimer: TX_EVIDENCE_NOTICE,
    tax_year: input.tax_year,
    normalize_by: by,
    adjustment_combine: input.adjustment_combine,
    comparables_count: n,
    comparables: comps,
    sorted_adjusted_values: sorted,
    median_adjusted_value: median,
    median_pair: pair,
    subject_id: subject.id ?? null,
    subject_value: subject.value,
    subject_value_basis: subject.value_basis,
    subject_minus_median: diff,
    subject_minus_median_pct: diffPct,
    subject_above_median: diff > 0,
    law: TX_UNEQUAL_APPRAISAL_LAW.map((l) => ({ ...l })),
  });
}
