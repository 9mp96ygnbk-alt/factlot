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

/** The `disclaimer` on every result. */
export const TX_EVIDENCE_NOTICE =
  "Evidence calculation only: arithmetic on the values and adjustments supplied. It is not an appraisal or an opinion of value (Occupations Code §1103.003(1)), it is not legal or tax advice, and it is not a substitute for the advice of an attorney. It does not say whether to protest or what value to claim. FactLot does not represent property owners.";

/** Fewest comparables accepted: a FactLot product floor, not a rule of law. */
export const TX_MIN_COMPARABLES = 3;
const MAX_COMPARABLES = 200;
/** Comparables below this count draw a warning (the statute does not define "a reasonable number"). */
const FEW_COMPARABLES = 5;
/** Total adjustment above this share (either way) draws a warning: a FactLot flag, not law. */
const LARGE_ADJUSTMENT = 0.25;
/** Areas further than this share from the subject's draw a warning when values are compared whole: a FactLot flag. */
const AREA_SPREAD = 0.25;
/** A comparable's value per SF or land-to-improvement ratio beyond this multiple (or below its inverse) is flagged. */
const FLAG_RATIO = 2;
/** The words of §41.43(b)(3) and §42.26(a)(3) the comparison uses, as quoted in TX_UNEQUAL_APPRAISAL_LAW. */
const APPROPRIATELY_ADJUSTED =
  "the median appraised value of a reasonable number of comparable properties appropriately adjusted";

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
      "the unequal-appraisal comparison at an appraisal review board hearing: the median appraised value of a reasonable number of comparable properties appropriately adjusted",
  },
  {
    section: "Tex. Tax Code §42.26(a)(3) and (b)",
    url: `${STATUTES}/TX.42.htm#42.26`,
    covers:
      "the same comparison in a district-court appeal and how the court sets the value",
  },
  {
    section: "Tex. Tax Code §42.26(d)",
    url: `${STATUTES}/TX.42.htm#42.26`,
    covers:
      "which value, market or appraised, is used for the subject and the comparables for purposes of §42.26 when the property is subject to an appraised-value limitation; the text in effect from 2027-01-01 refers only to a residence homestead under §23.23",
  },
  {
    section: "Tex. Tax Code §41.66(l)",
    url: `${STATUTES}/TX.41.htm#41.66`,
    covers:
      'a property owner, attorney or agent offering evidence or argument in a value or unequal-appraisal protest, and Occupations Code ch. 1103 ("A property owner, attorney, or agent offering evidence")',
  },
  {
    section: "Tex. Occ. Code §1103.003(1)",
    url: "https://statutes.capitol.texas.gov/Docs/OC/htm/OC.1103.htm#1103.003",
    covers: "defines an appraisal as an opinion of value",
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

const Label = z
  .string()
  .min(1)
  .max(80)
  .describe(
    "A name to print for this property in reports (up to 80 characters), e.g. its street address or the caller's comp number. Echoed in the result; not used in the arithmetic.",
  );
const Address = z
  .string()
  .min(1)
  .max(120)
  .describe(
    "The property's address as the caller wants it printed (up to 120 characters). Echoed in the result; not used in the arithmetic.",
  );

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
  label: Label.optional(),
  address: Address.optional(),
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
      label: Label.optional(),
      address: Address.optional(),
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
  /** The caller's label and address, echoed for reports; null when not given. */
  label: string | null;
  address: string | null;
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
  /** Data-quality flags (FactLot checks, not legal tests): facts about the inputs, never a reason to drop a comparable. */
  flags: TxComparableFlag[];
}

export type TxComparableFlagCode =
  | "value_psf_above_2x"
  | "value_psf_below_half"
  | "land_ratio_above_2x"
  | "land_ratio_below_half"
  | "missing_area";

export interface TxComparableFlag {
  code: TxComparableFlagCode;
  message: string;
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
  subject_label: string | null;
  subject_address: string | null;
  subject_value: number;
  subject_value_basis: "appraised" | "market";
  subject_minus_median: number;
  /** (subject value − median) ÷ median, 6 decimals, as a fraction like every FactLot rate: 0.1554 is 15.54%. */
  subject_minus_median_pct: number;
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

const AREA_WORD = {
  improvement_area_sf: "improvement",
  land_area_sf: "land",
} as const;

/**
 * A comparable's data-quality flags (`_flags` in Python): its value per SF of the normalizing area (improvement area
 * when normalize_by is "none") more than twice or less than half the subject's, its land-to-improvement area ratio
 * more than twice or less than half the subject's, and, when values are compared whole, a missing area the subject
 * has. Facts about the inputs only; FactLot thresholds, not legal tests.
 */
function comparableFlags(
  subject: z.output<typeof TxUnequalAppraisalInput>["subject"],
  c: ParsedComparable,
  by: "none" | "improvement_area_sf" | "land_area_sf",
): TxComparableFlag[] {
  const flags: TxComparableFlag[] = [];
  const key = by === "none" ? "improvement_area_sf" : by;
  const word = AREA_WORD[key];
  const sArea = subject[key];
  const cArea = c[key];
  if (sArea !== undefined && cArea !== undefined) {
    const sPsf = subject.value / sArea;
    const cPsf = c.value / cArea;
    if (cPsf > FLAG_RATIO * sPsf)
      flags.push({
        code: "value_psf_above_2x",
        message: `Value per SF of ${word} area (${fmtMoney(cPsf)}) is more than twice the subject's (${fmtMoney(sPsf)}).`,
      });
    else if (cPsf < sPsf / FLAG_RATIO)
      flags.push({
        code: "value_psf_below_half",
        message: `Value per SF of ${word} area (${fmtMoney(cPsf)}) is less than half the subject's (${fmtMoney(sPsf)}).`,
      });
  } else if (by === "none" && sArea !== undefined && cArea === undefined)
    flags.push({
      code: "missing_area",
      message: `No ${key} given while the subject has one: value per SF is not compared, and normalize_by ${key} would need it.`,
    });
  if (
    subject.land_area_sf !== undefined &&
    subject.improvement_area_sf !== undefined &&
    c.land_area_sf !== undefined &&
    c.improvement_area_sf !== undefined
  ) {
    const sRatio = subject.land_area_sf / subject.improvement_area_sf;
    const cRatio = c.land_area_sf / c.improvement_area_sf;
    if (cRatio > FLAG_RATIO * sRatio)
      flags.push({
        code: "land_ratio_above_2x",
        message: `Land-to-improvement area ratio (${fmtNum(cRatio, 2)}) is more than twice the subject's (${fmtNum(sRatio, 2)}).`,
      });
    else if (cRatio < sRatio / FLAG_RATIO)
      flags.push({
        code: "land_ratio_below_half",
        message: `Land-to-improvement area ratio (${fmtNum(cRatio, 2)}) is less than half the subject's (${fmtNum(sRatio, 2)}).`,
      });
  }
  return flags;
}

/** Texas unequal-appraisal arithmetic (§41.43(b)(3), §42.26(a)(3)): median of adjusted comparables. */
export function txUnequalAppraisal(
  raw: TxUnequalAppraisalInput,
): CalcResult<TxUnequalAppraisal> {
  const input = parseInput(TxUnequalAppraisalInput, raw);
  checkInput(input);
  const t = new Trace();
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
      label: c.label ?? null,
      address: c.address ?? null,
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
      flags: comparableFlags(subject, c, by),
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
          `Tax year ${input.tax_year}: on appeal under §42.26, §42.26(d) (text in effect until 2027-01-01) requires market value for the subject and the comparables when the property is subject to the §23.231 limitation, and ${appraised.join(", ")} use appraised value; appraisal review board practice may differ.`,
        );
    } else
      t.warn(
        `Tax year ${input.tax_year}: the subject is marked as subject to the §23.231 limitation, but §23.231(k) says "This section expires December 31, 2026", and §42.26(d) and §41.41(a) as in effect from 2027-01-01 no longer refer to §23.231; check whether the limitation applies and which value is compared.`,
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
      `Total adjustments exceed 25% of the comparable's normalized value (adjusted ÷ normalized − 1) for ${named(large)}. This is a FactLot flag, not a legal limit.`,
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
  if (input.comparables.every((c) => c.adjustments.length === 0))
    t.warn(
      `No adjustments were supplied: the median is of ${by === "none" ? "unadjusted values" : `values normalized by ${by} and otherwise unadjusted`}. §41.43(b)(3) and §42.26(a)(3) refer to "${APPROPRIATELY_ADJUSTED}".`,
    );
  if (by === "none") {
    const key =
      subject.improvement_area_sf !== undefined
        ? "improvement_area_sf"
        : subject.land_area_sf !== undefined
          ? "land_area_sf"
          : undefined;
    if (key !== undefined) {
      const sArea = subject[key] as number;
      const spread = labels((c) => {
        const a = c[key];
        return a !== undefined && Math.abs(a / sArea - 1) > AREA_SPREAD;
      });
      if (spread.length > 0)
        t.warn(
          `Values are compared whole (normalize_by "none"), and the ${AREA_WORD[key]} area of ${named(spread)} differs from the subject's (${fmtNum(sArea)} SF) by more than 25%: a median of whole values and a median of values per SF can differ materially. normalize_by "${key}" compares values per SF of that area. The 25% is a FactLot flag, not a legal limit.`,
        );
    }
  }

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
    subject_label: subject.label ?? null,
    subject_address: subject.address ?? null,
    subject_value: subject.value,
    subject_value_basis: subject.value_basis,
    subject_minus_median: diff,
    subject_minus_median_pct: diffPct,
    law: TX_UNEQUAL_APPRAISAL_LAW.map((l) => ({ ...l })),
  });
}
