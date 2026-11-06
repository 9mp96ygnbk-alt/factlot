import { z } from "zod";

import {
  Money,
  NonNegMoney,
  Trace,
  fmtMoney,
  fmtNum,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { DcfProFormaInput, MAX_HOLD_YEARS, dcfProForma } from "./dcf.ts";
import type { DcfProForma, DcfYear } from "./dcf.ts";

/** The annual lines of calc_dcf_pro_forma, in table order. */
export const DCF_LINES = [
  "potential_base_rent",
  "free_rent",
  "expense_recoveries",
  "gross_revenue",
  "general_vacancy",
  "credit_loss",
  "effective_gross_revenue",
  "operating_expenses",
  "management_fee",
  "net_operating_income",
  "tenant_improvements",
  "leasing_commissions",
  "capital_reserves",
  "cash_flow_before_debt",
] as const;
export type DcfLine = (typeof DCF_LINES)[number];

const TARGETS = [...DCF_LINES, "turnover_vacancy", "ignore"] as const;
type Target = (typeof TARGETS)[number];

/**
 * Default label mappings: common CRE line names only, each overridable with `mapping`. FactLot's
 * own line names (potential_base_rent, "Potential Base Rent", ...) always map to themselves.
 * These are generic terms, not any system's report layout: check them against your own export.
 */
export const DEFAULT_LINE_LABELS: readonly (readonly [string, Target])[] = [
  ["Potential Base Rent", "potential_base_rent"],
  ["Absorption & Turnover Vacancy", "turnover_vacancy"],
  ["Free Rent", "free_rent"],
  ["Base Rent Abatements", "free_rent"],
  ["Free Rent / Base Rent Abatements", "free_rent"],
  ["Expense Reimbursements", "expense_recoveries"],
  ["Expense Recoveries", "expense_recoveries"],
  ["Expense Reimbursements / Recoveries", "expense_recoveries"],
  ["General Vacancy", "general_vacancy"],
  ["Credit Loss", "credit_loss"],
  ["Effective Gross Revenue", "effective_gross_revenue"],
  ["Operating Expenses", "operating_expenses"],
  ["Total Operating Expenses", "operating_expenses"],
  ["Net Operating Income", "net_operating_income"],
  ["NOI", "net_operating_income"],
  ["Tenant Improvements", "tenant_improvements"],
  ["Leasing Commissions", "leasing_commissions"],
  ["Capital Reserves", "capital_reserves"],
  ["Cash Flow Before Debt Service", "cash_flow_before_debt"],
];

/**
 * A label as compared: "&" read as "and", ASCII letters lowercased, every run of other characters
 * a single space. "Absorption & Turnover Vacancy" and "absorption and turnover vacancy" match.
 */
export function normalizeLabel(label: string): string {
  return label
    .replace(/&/g, " and ")
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const DEFAULTS = new Map<string, Target>();
for (const k of DCF_LINES) DEFAULTS.set(normalizeLabel(k), k);
for (const [label, k] of DEFAULT_LINE_LABELS)
  DEFAULTS.set(normalizeLabel(label), k);

/** Lines FactLot reports as negative amounts (deductions). */
const DEDUCTIONS = new Set<Target>([
  "free_rent",
  "turnover_vacancy",
  "general_vacancy",
  "credit_loss",
  "operating_expenses",
  "management_fee",
  "tenant_improvements",
  "leasing_commissions",
  "capital_reserves",
]);

/** Subtotals and the lines they foot from. */
const PARTS: Partial<Record<DcfLine, DcfLine[]>> = {
  gross_revenue: ["potential_base_rent", "free_rent", "expense_recoveries"],
  effective_gross_revenue: ["gross_revenue", "general_vacancy", "credit_loss"],
  net_operating_income: [
    "effective_gross_revenue",
    "operating_expenses",
    "management_fee",
  ],
  cash_flow_before_debt: [
    "net_operating_income",
    "tenant_improvements",
    "leasing_commissions",
    "capital_reserves",
  ],
};

export const ReconcileTolerance = z
  .object({
    absolute: NonNegMoney.default(1).describe(
      "Largest difference, USD, still counted as agreeing (default 1.00).",
    ),
    relative: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .default(0)
      .describe(
        "Largest difference as a share of the other system's amount still counted as agreeing, e.g. 0.0001; the larger of the two tolerances applies (default 0).",
      ),
  })
  .describe(
    "When two amounts agree: |FactLot − other| ≤ max(absolute, relative × |other|).",
  );

const DcfTolerance = ReconcileTolerance.extend({
  irr: z
    .number()
    .finite()
    .min(0)
    .lt(1)
    .default(0.0001)
    .describe(
      "Largest IRR difference still counted as agreeing, as a decimal (default 0.0001, one basis point).",
    ),
});

const Label = z.string().min(1).max(200);

export const ReconcileDcfInput = z
  .object({
    dcf: DcfProFormaInput.describe(
      "The FactLot DCF input, exactly as calc_dcf_pro_forma takes it (the same rent roll and assumptions you entered in the other system).",
    ),
    other: z
      .object({
        system: Label.default("other system").describe(
          'Name of the system or file the lines come from, echoed in the result, e.g. "ARGUS export, Nov 2026" (free text).',
        ),
        lines: z
          .array(
            z.object({
              label: Label.describe(
                'Line name as the other system prints it, e.g. "Potential Base Rent". Compared ignoring case and punctuation, "&" read as "and".',
              ),
              values: z
                .array(Money)
                .min(1)
                .max(MAX_HOLD_YEARS + 1)
                .describe(
                  "Annual amounts in USD, year 1 first, one per analysis year (the hold plus the year after it at most). Deductions may be negative or positive; see sign_convention.",
                ),
            }),
          )
          .min(1)
          .max(200)
          .describe(
            "The other system's annual cash-flow lines (factlot.reconcile_files reads them from a CSV or XLSX).",
          ),
        value: Money.optional().describe(
          "The other system's present value at the discount rate, USD.",
        ),
        unlevered_irr: z
          .number()
          .finite()
          .gt(-1)
          .max(1)
          .optional()
          .describe(
            "The other system's unlevered IRR as a decimal (0.0825 for 8.25%). Compared only when dcf.purchase_price is given.",
          ),
        gross_sale_price: Money.optional().describe(
          "The other system's gross sale (reversion) price before selling costs, USD.",
        ),
        net_sale_proceeds: Money.optional().describe(
          "The other system's sale proceeds after selling costs, USD.",
        ),
      })
      .describe("What the other system reported for the same property."),
    mapping: z
      .array(
        z.object({
          label: Label.describe(
            "A label in other.lines (matched ignoring case and punctuation).",
          ),
          line: z
            .enum(TARGETS)
            .describe(
              'FactLot line to compare it with. "turnover_vacancy" is a deduction compared together with potential_base_rent (FactLot\'s potential base rent already excludes rollover downtime); "ignore" leaves the line out. Several labels mapped to one line are summed.',
            ),
        }),
      )
      .max(200)
      .default([])
      .describe(
        "Your label mappings; they override the defaults (common CRE line names such as Potential Base Rent, General Vacancy, Net Operating Income, Cash Flow Before Debt Service).",
      ),
    sign_convention: z
      .enum(["auto", "as_reported", "deductions_positive"])
      .default("auto")
      .describe(
        'FactLot reports deductions (free rent, vacancy, credit loss, expenses, fees, TI, commissions, reserves) as negative amounts. "auto": a deduction line whose amounts are all zero or positive is read as positive deductions and negated; "as_reported": compare as given; "deductions_positive": negate every deduction line.',
      ),
    tolerance: DcfTolerance.default({
      absolute: 1,
      relative: 0,
      irr: 0.0001,
    }).describe(
      "When two amounts agree: |FactLot − other| ≤ max(absolute, relative × |other|); the IRR within irr. Default: 1.00 USD, 0, and one basis point.",
    ),
  })
  .superRefine((v, ctx) => {
    const seen = new Map<string, number>();
    v.other.lines.forEach((l, i) => {
      const n = normalizeLabel(l.label);
      if (n === "") return;
      const j = seen.get(n);
      if (j !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["other", "lines", i, "label"],
          message: `"${l.label}" reads the same as line ${j}'s label (labels are compared ignoring case and punctuation)`,
        });
      else seen.set(n, i);
    });
    const mapped = new Map<string, number>();
    v.mapping.forEach((m, i) => {
      const n = normalizeLabel(m.label);
      if (n === "")
        ctx.addIssue({
          code: "custom",
          path: ["mapping", i, "label"],
          message: "needs a letter or digit",
        });
      else if (mapped.has(n))
        ctx.addIssue({
          code: "custom",
          path: ["mapping", i, "label"],
          message: `"${m.label}" is mapped twice`,
        });
      else mapped.set(n, i);
    });
  });
export type ReconcileDcfInput = z.input<typeof ReconcileDcfInput>;

export interface LikelyCause {
  /** Stable pattern id, e.g. "rollover_convention". */
  cause: string;
  /** Years the pattern rests on (empty for value, IRR and sale items). */
  years: number[];
  /** What the pattern is consistent with and what to check: a hypothesis, not a finding. */
  hypothesis: string;
}

export interface ReconcileDcfYear {
  year: number;
  in_hold: boolean;
  factlot: number;
  other: number;
  /** FactLot − other, rounded to the cent. */
  difference: number;
  within_tolerance: boolean;
}

export interface ReconcileDcfLine {
  line: DcfLine;
  other_labels: string[];
  years: ReconcileDcfYear[];
  all_within_tolerance: boolean;
  max_abs_difference: number;
  likely_causes: LikelyCause[];
}

export interface ReconcileTotal {
  item: "gross_sale_price" | "net_sale_proceeds" | "value" | "unlevered_irr";
  factlot: number;
  other: number;
  difference: number;
  within_tolerance: boolean;
  likely_causes: LikelyCause[];
}

export interface ReconcileDcf {
  system: string;
  hold_years: number;
  all_within_tolerance: boolean;
  cells_compared: number;
  cells_outside_tolerance: number;
  lines: ReconcileDcfLine[];
  totals: ReconcileTotal[];
  mapping: {
    label: string;
    line: Target | null;
    source: "mapping" | "default" | "unmapped";
    sign_flipped: boolean;
  }[];
  unmapped_labels: string[];
  ignored_labels: string[];
  factlot_lines_not_compared: DcfLine[];
  factlot_dcf: {
    formula: string;
    value: number;
    unlevered_irr: number | null;
    exit: DcfProForma["exit"];
    warnings: string[];
  };
}

const TITLE: Record<DcfLine, string> = {
  potential_base_rent: "potential base rent",
  free_rent: "free rent",
  expense_recoveries: "expense recoveries",
  gross_revenue: "gross revenue",
  general_vacancy: "general vacancy",
  credit_loss: "credit loss",
  effective_gross_revenue: "effective gross revenue",
  operating_expenses: "operating expenses",
  management_fee: "management fee",
  net_operating_income: "net operating income",
  tenant_improvements: "tenant improvements",
  leasing_commissions: "leasing commissions",
  capital_reserves: "capital reserves",
  cash_flow_before_debt: "cash flow before debt",
};

const yearOf = (m: number): number => Math.floor((m - 1) / 12) + 1;

/** Within `tol` once the difference is rounded to the cent. */
const close = (a: number, b: number, tol: number): boolean =>
  Math.abs(round(a - b, 2)) <= tol;

const listOf = (xs: (string | number)[], max = 10): string =>
  xs.length > max
    ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`
    : xs.join(", ");

const range = (a: number, b: number): number[] =>
  Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

const yearsText = (ys: number[]): string =>
  `${ys.length === 1 ? "year" : "years"} ${ys.join(", ")}`;

interface Compared {
  line: DcfLine;
  fl: number[];
  ot: number[];
  d: number[];
  tol: number[];
  /** Years (1-based) outside tolerance. */
  bad: number[];
  out: ReconcileDcfLine;
}

/**
 * Tie FactLot's DCF out against another system's annual cash-flow lines: runs calc_dcf_pro_forma,
 * maps the other system's labels to FactLot lines, compares every line and year within a
 * tolerance, and names likely causes for the differences from FactLot's own documented
 * conventions, as hypotheses to check.
 */
export function reconcileDcf(raw: ReconcileDcfInput): CalcResult<ReconcileDcf> {
  const input = parseInput(ReconcileDcfInput, raw);
  const t = new Trace();
  const dcfRun = dcfProForma(input.dcf);
  const dcf = dcfRun.value;
  const H = dcf.hold_years;
  const N = H + 1;
  const rows = dcf.cash_flows;
  const col = (k: DcfLine): number[] =>
    rows.map((r: DcfYear) => r[k] as number);
  const tolAbs = input.tolerance.absolute;
  const tolRel = input.tolerance.relative;
  const tolOf = (other: number): number =>
    Math.max(tolAbs, tolRel * Math.abs(other));
  const mode = input.sign_convention;
  const system = input.other.system;

  t.step("Other system", system);
  t.step(
    "FactLot DCF value",
    dcf.value,
    `calc.dcf_pro_forma@${dcfRun.formula.version} on the dcf input: ${N} years (the hold of ${H} and the forward year)`,
    "USD",
  );

  // --- labels to FactLot lines
  const userMap = new Map<string, Target>();
  for (const m of input.mapping) userMap.set(normalizeLabel(m.label), m.line);
  const usedMappings = new Set<string>();
  const entries = input.other.lines.map((l) => {
    const n = normalizeLabel(l.label);
    let line: Target | null = null;
    let source: "mapping" | "default" | "unmapped" = "unmapped";
    if (n !== "" && userMap.has(n)) {
      line = userMap.get(n) as Target;
      source = "mapping";
      usedMappings.add(n);
    } else if (n !== "" && DEFAULTS.has(n)) {
      line = DEFAULTS.get(n) as Target;
      source = "default";
    }
    let factor = 1;
    if (line !== null && DEDUCTIONS.has(line)) {
      if (mode === "deductions_positive") factor = -1;
      else if (
        mode === "auto" &&
        l.values.every((v) => v >= 0) &&
        l.values.some((v) => v > 0)
      )
        factor = -1;
    }
    return { label: l.label, values: l.values, line, source, factor };
  });
  const unmapped = entries.filter((e) => e.line === null).map((e) => e.label);
  const ignored = entries
    .filter((e) => e.line === "ignore")
    .map((e) => e.label);
  const byUser = entries.filter((e) => e.source === "mapping").length;
  const byDefault = entries.filter((e) => e.source === "default").length;
  t.step(
    "Label mapping",
    `${entries.length - unmapped.length - ignored.length} of ${entries.length} lines mapped (${byUser} by your mapping, ${byDefault} by default labels), ${ignored.length} ignored, ${unmapped.length} unmapped`,
  );
  const flipped = entries.filter((e) => e.factor === -1).map((e) => e.label);
  t.step(
    "Sign convention",
    mode,
    flipped.length
      ? `negated as positive deductions: ${listOf(flipped)}`
      : "no line negated",
  );
  t.step(
    "Difference",
    "FactLot − other, rounded to the cent",
    `agrees when |difference| ≤ max(${fmtMoney(tolAbs)}, ${fmtNum(tolRel)} × |other|)`,
  );

  // --- compare each FactLot line with the sum of the labels mapped to it
  const compared = new Map<DcfLine, Compared>();
  const notCompared: DcfLine[] = [];
  for (const k of DCF_LINES) {
    const direct = entries.filter((e) => e.line === k);
    const turnover =
      k === "potential_base_rent"
        ? entries.filter((e) => e.line === "turnover_vacancy")
        : [];
    if (direct.length === 0) {
      notCompared.push(k);
      if (turnover.length)
        t.warn(
          `${listOf(turnover.map((e) => e.label))} mapped to turnover_vacancy, but no line is mapped to potential_base_rent, so it is not compared: map the other system's potential base rent too.`,
        );
      continue;
    }
    const parts = [...direct, ...turnover].sort(
      (a, b) => entries.indexOf(a) - entries.indexOf(b),
    );
    const n = Math.min(N, ...parts.map((e) => e.values.length));
    if (turnover.length)
      t.warn(
        `potential_base_rent is compared with ${listOf(parts.map((e) => e.label))} together: FactLot's potential base rent already leaves out the months a suite is vacant at rollover.`,
      );
    else if (parts.length > 1)
      t.warn(
        `${k} is compared with the sum of ${listOf(parts.map((e) => e.label))}; make sure none of them is a subtotal of the others.`,
      );
    const flAll = col(k);
    const c: Compared = {
      line: k,
      fl: [],
      ot: [],
      d: [],
      tol: [],
      bad: [],
      out: {
        line: k,
        other_labels: parts.map((e) => e.label),
        years: [],
        all_within_tolerance: true,
        max_abs_difference: 0,
        likely_causes: [],
      },
    };
    for (let y = 1; y <= n; y++) {
      let sum = 0;
      for (const e of parts) sum += e.factor * (e.values[y - 1] as number);
      const other = round(sum, 2);
      const fl = flAll[y - 1] as number;
      const diff = round(fl - other, 2);
      const tol = tolOf(other);
      const ok = Math.abs(diff) <= tol;
      c.fl.push(fl);
      c.ot.push(other);
      c.d.push(diff);
      c.tol.push(tol);
      if (!ok) c.bad.push(y);
      c.out.years.push({
        year: y,
        in_hold: y <= H,
        factlot: fl,
        other,
        difference: diff,
        within_tolerance: ok,
      });
      if (Math.abs(diff) > c.out.max_abs_difference)
        c.out.max_abs_difference = Math.abs(diff);
    }
    c.out.all_within_tolerance = c.bad.length === 0;
    compared.set(k, c);
  }
  for (const e of entries)
    if (e.line !== null && e.line !== "ignore" && e.values.length > N)
      t.warn(
        `"${e.label}" has ${e.values.length} years; FactLot projects ${N} (the hold and the year after it), so the years after ${N} are not compared.`,
      );
  for (const m of input.mapping)
    if (!usedMappings.has(normalizeLabel(m.label)))
      t.warn(`mapping label "${m.label}" matches no line in other.lines.`);
  if (unmapped.length)
    t.warn(
      `Not compared, no mapping: ${listOf(
        unmapped.map((l) => `"${l}"`),
        20,
      )}. Add them to mapping (or map them to "ignore").`,
    );

  // --- rollover years: downtime, a rollover lease's first month, and its free-rent months
  const horizon = N * 12;
  const rollover = new Set<number>();
  const fractional: { y: number; text: string }[] = [];
  for (const e of dcf.lease_events) {
    if (e.kind === "in_place") continue;
    const s = e.start_month;
    const whole = Math.floor(e.downtime_months);
    const last = s + Math.max(Math.ceil(e.free_rent_months), 1) - 1;
    for (let m = s - whole; m <= last; m++)
      if (m >= 1 && m <= horizon) rollover.add(yearOf(m));
    const fracD = e.downtime_months !== whole;
    const fracF = e.free_rent_months !== Math.floor(e.free_rent_months);
    if ((fracD || fracF) && s <= horizon) {
      const parts: string[] = [];
      if (fracD) parts.push(`downtime ${fmtNum(e.downtime_months)} months`);
      if (fracF) parts.push(`free rent ${fmtNum(e.free_rent_months)} months`);
      fractional.push({
        y: yearOf(s),
        text: `${e.lease} ${parts.join(", ")} (lease starting month ${s}, year ${yearOf(s)})`,
      });
    }
  }

  const input0 = input.dcf;
  const leaseCount = input0.leases.length;
  const rateOf: Partial<Record<DcfLine, [number, string]>> = {
    general_vacancy: [input0.general_vacancy_rate, "general_vacancy_rate"],
    credit_loss: [input0.credit_loss_rate, "credit_loss_rate"],
    management_fee: [input0.management_fee_rate, "management_fee_rate"],
  };
  const pbr = col("potential_base_rent");
  const fr = col("free_rent");
  const rec = col("expense_recoveries");
  const gross = col("gross_revenue");
  const egr = col("effective_gross_revenue");
  const bases: Partial<Record<DcfLine, [string, number[]][]>> = {
    general_vacancy: [
      ["potential base rent", pbr],
      [
        "potential base rent after free rent",
        pbr.map((v, i) => v + (fr[i] as number)),
      ],
      [
        "potential base rent plus recoveries, before free rent",
        pbr.map((v, i) => v + (rec[i] as number)),
      ],
    ],
    management_fee: [
      ["gross revenue", gross],
      [
        "potential base rent after free rent",
        pbr.map((v, i) => v + (fr[i] as number)),
      ],
      ["potential base rent", pbr],
    ],
  };
  bases.credit_loss = bases.general_vacancy;
  const grossText =
    "gross revenue (base rent after free rent, plus recoveries)";
  const factlotBase: Partial<Record<DcfLine, [string, string, number[]]>> = {
    general_vacancy: [grossText, "gross revenue", gross],
    credit_loss: [grossText, "gross revenue", gross],
    management_fee: ["effective gross revenue", "effective gross revenue", egr],
  };
  const rentLines = new Set<DcfLine>([
    "potential_base_rent",
    "free_rent",
    "tenant_improvements",
    "leasing_commissions",
  ]);

  const causesFor = (c: Compared): LikelyCause[] => {
    const { line: k, fl, ot, d, tol, bad } = c;
    const n = fl.length;
    const S = bad;
    const out: LikelyCause[] = [];
    const add = (cause: string, hypothesis: string, years = S): void => {
      out.push({ cause, years: [...years], hypothesis });
    };
    const all = (f: (y: number) => boolean): boolean => {
      for (let y = 1; y <= n; y++) if (!f(y)) return false;
      return true;
    };
    const at = (xs: number[], y: number): number => xs[y - 1] as number;

    // Opposite sign: nothing else to read into it.
    if (
      all((y) => close(at(ot, y), -at(fl, y), at(tol, y))) &&
      fl.some((v, i) => Math.abs(v) > (tol[i] as number))
    ) {
      add(
        "opposite_sign",
        `The other amounts equal FactLot's with the opposite sign in every compared year: the other export may show this line as a positive deduction, or income as negative. Check the sign and set sign_convention (or the export) to match.`,
      );
      return out;
    }

    // Carried from the lines a subtotal foots from.
    const parts = PARTS[k];
    if (parts) {
      const present = parts.filter((p) => compared.has(p));
      const differing = present.filter((p) =>
        (compared.get(p) as Compared).bad.some((y) => S.includes(y)),
      );
      if (
        differing.length > 0 &&
        S.every((y) => {
          let sum = 0;
          for (const p of present) {
            const pc = compared.get(p) as Compared;
            if (y <= pc.d.length) sum += pc.d[y - 1] as number;
          }
          return close(at(d, y), sum, at(tol, y));
        })
      )
        add(
          "carried_from_other_lines",
          `Explained by ${differing.join(", ")}: their differences add up to this line's in ${yearsText(S)}. Resolve ${differing.length === 1 ? "that line" : "those lines"} first.`,
        );
    }
    const rate = rateOf[k];
    const fb = factlotBase[k];
    if (rate && fb) {
      const baseLine: DcfLine =
        k === "management_fee" ? "effective_gross_revenue" : "gross_revenue";
      const bc = compared.get(baseLine);
      if (
        rate[0] > 0 &&
        bc &&
        bc.bad.some((y) => S.includes(y)) &&
        S.every(
          (y) =>
            y <= bc.ot.length &&
            close(at(ot, y), round(-rate[0] * at(bc.ot, y), 2), at(tol, y)),
        )
      )
        add(
          "carried_from_other_lines",
          `The other ${TITLE[k]} equals ${fmtNum(rate[0])} × the other export's ${TITLE[baseLine]} in ${yearsText(S)}, the same rate on a base that differs: resolve ${baseLine} first.`,
        );
    }
    if (out.length) return out;

    // Management fee inside operating expenses.
    if (k === "operating_expenses") {
      const mg = col("management_fee");
      if (
        mg.some((v) => v !== 0) &&
        all((y) => close(at(ot, y), at(fl, y) + at(mg, y), at(tol, y)))
      ) {
        add(
          "management_fee_in_opex",
          `The other operating expenses equal FactLot's operating expenses plus its management fee (${fmtMoney(at(mg, 1))} in year 1) in every compared year: the other model may count the management fee as an operating expense, where FactLot reports it on its own line (management_fee_rate × effective gross revenue). Map the other system's management fee line, if it has one, or compare net operating income.`,
        );
        return out;
      }
    }

    // A rate applied to a different base, or a rate FactLot was not given.
    if (rate && fb) {
      const [r, field] = rate;
      if (r > 0) {
        for (const [label, base] of bases[k] ?? []) {
          if (
            all((y) => close(at(ot, y), round(-r * at(base, y), 2), at(tol, y)))
          ) {
            add(
              "rate_base",
              `The other ${TITLE[k]} equals −${fmtNum(r)} × FactLot's ${label} in every compared year; FactLot charges ${field} on ${fb[0]}. The other model may apply the rate to ${label}: check its ${TITLE[k]} base.`,
            );
            return out;
          }
        }
      } else if (S.length) {
        const y = S[0] as number;
        const b = at(fb[2], y);
        add(
          "rate_not_entered",
          `FactLot's ${field} is 0, but the other model charges ${TITLE[k]} (${fmtMoney(at(ot, y))} in year ${y}${b !== 0 ? `, ${fmtPct(-at(ot, y) / b, 3)} of FactLot's ${fb[1]}` : ""}). Check whether the rate was entered in the FactLot input (dcf.${field}).`,
        );
        return out;
      }
    }

    // Only the year after the hold.
    if (n === N && n >= 2 && S.length === 1 && S[0] === N) {
      add(
        "exit_year_only",
        `Only year ${N} differs: the year after the hold, which FactLot projects only for the exit NOI (exit_noi_basis "${input0.exit_noi_basis}"${input0.exit_noi_basis === "trailing" ? ", so it does not change the FactLot value" : ""}). Check how the other model projects that year (rollovers in it, growth) and which year's NOI it capitalizes.`,
      );
      return out;
    }

    // One year earlier or later.
    if (n >= 3) {
      const later =
        range(2, n).every((y) => close(at(ot, y), at(fl, y - 1), at(tol, y))) &&
        range(2, n).some((y) => Math.abs(at(fl, y - 1)) > at(tol, y));
      const earlier =
        range(1, n - 1).every((y) =>
          close(at(ot, y), at(fl, y + 1), at(tol, y)),
        ) && range(1, n - 1).some((y) => Math.abs(at(fl, y + 1)) > at(tol, y));
      if (later || earlier) {
        const when =
          k === "tenant_improvements" || k === "leasing_commissions"
            ? "in the month the rollover lease starts"
            : "as monthly amounts summed into analysis years of 12 months from analysis month 1";
        add(
          "one_year_shift",
          `The other amounts equal FactLot's one year ${later ? "later" : "earlier"} (other year y = FactLot year y ${later ? "−" : "+"} 1): a timing difference. Check when the other model books this line (FactLot: ${when}) and whether its year 1 starts with the same month as FactLot's analysis month 1, or labels its year columns by a different start or end date.`,
        );
        return out;
      }
    }

    // Differences confined to rollover years.
    if (
      S.length > 0 &&
      S.every((y) => rollover.has(y)) &&
      (S.length < n ||
        k === "tenant_improvements" ||
        k === "leasing_commissions")
    ) {
      if (k === "tenant_improvements") {
        add(
          "leasing_cost_basis",
          `Tenant improvements differ in rollover ${yearsText(S)}. FactLot pays TI when the rollover lease starts: (p × ti_psf_renewal + (1 − p) × ti_psf_new) × area, grown at market_rent_growth_rate to the start year. Check the other model's TI per SF, renewal blend, growth and timing.`,
        );
        return out;
      }
      if (k === "leasing_commissions") {
        add(
          "leasing_cost_basis",
          `Leasing commissions differ in rollover ${yearsText(S)}. FactLot pays them when the rollover lease starts, as (p × lc_rate_renewal + (1 − p) × lc_rate_new) × the base rent over the whole new term after free rent. Check the other model's commission base (term, free rent, escalations), rates and timing.`,
        );
        return out;
      }
      if (k !== "operating_expenses" && k !== "capital_reserves") {
        const frac = fractional.filter((f) => S.includes(f.y));
        add(
          "rollover_convention",
          `Differences fall only in ${yearsText(S)}, years with a lease rollover (downtime, a new lease's first month, or its free rent). FactLot keeps blended downtime and free rent fractional, as part months (calc.dcf_pro_forma@2: 0.45 months of downtime means the first month collects 55%); a model that rounds them to whole months (as calc.dcf_pro_forma@1 did), or applies downtime, free rent or the renewal blend differently, differs only in these years.${frac.length ? ` Fractional terms in those years: ${frac.map((f) => f.text).join("; ")}.` : " No rollover in those years has fractional downtime or free rent, so check the downtime, free rent, renewal rent and renewal probability the other model applies."}`,
        );
        return out;
      }
    }

    const nonzero = all((y) => Math.abs(at(fl, y)) > at(tol, y));
    // Nothing on the other side.
    if (nonzero && all((y) => at(ot, y) === 0)) {
      add(
        "zero_in_other",
        "The other export shows 0 in every compared year where FactLot has an amount: the other model may not include this line, or the label maps to an empty row. Check the mapping and whether the item is modelled elsewhere.",
      );
      return out;
    }
    // Cents.
    const worst = Math.max(...S.map((y) => Math.abs(at(d, y))));
    if (worst <= 0.12 * leaseCount) {
      add(
        "rounding",
        `Differences are at most ${fmtMoney(worst)} a year, within cent rounding of monthly amounts for ${leaseCount} ${leaseCount === 1 ? "lease" : "leases"}: FactLot rounds each annual line to the cent, not each month. Raise tolerance.absolute if that is the only difference.`,
      );
      return out;
    }
    // A constant factor that compounds: a growth rate.
    if (n >= 3 && nonzero && at(ot, 1) !== 0) {
      const k1 = at(ot, 1) / at(fl, 1);
      const g = at(ot, 2) / at(fl, 2) / k1;
      if (
        Math.abs(g - 1) > 1e-5 &&
        all((y) =>
          close(
            at(ot, y),
            at(fl, y) * k1 * powInt(g, y - 1),
            Math.max(at(tol, y), 1e-6 * Math.abs(at(ot, y))),
          ),
        )
      ) {
        const which = rentLines.has(k)
          ? `market rent growth (FactLot: ${fmtPct(input0.market_rent_growth_rate, 3)})`
          : `expense growth (FactLot: ${fmtPct(input0.expense_growth_rate, 3)})`;
        add(
          "growth_rate",
          `The gap compounds: other ≈ FactLot × ${fmtNum(k1)} × ${fmtNum(g)}^(y − 1), consistent with growth about ${fmtPct(Math.abs(g - 1), 3)} a year ${g > 1 ? "higher" : "lower"} for this line in the other model. Check ${which} and the year growth starts.`,
        );
        return out;
      }
    }
    // A constant factor: a rate, base or area.
    if (n >= 2 && nonzero && S.length === n && at(ot, 1) !== 0) {
      const k1 = at(ot, 1) / at(fl, 1);
      if (
        Math.abs(k1 - 1) > 1e-5 &&
        all((y) =>
          close(
            at(ot, y),
            at(fl, y) * k1,
            Math.max(at(tol, y), 1e-6 * Math.abs(at(ot, y))),
          ),
        )
      ) {
        add(
          "constant_ratio",
          `The other amounts are ${fmtNum(k1)} × FactLot's in every compared year: consistent with a different rate, base or area (FactLot's building area is ${dcf.building_area_sf} SF). Check the inputs behind this line.`,
        );
        return out;
      }
    }
    // A constant amount.
    if (
      n >= 2 &&
      S.length === n &&
      all((y) => close(at(d, y), at(d, 1), at(tol, y)))
    ) {
      add(
        "constant_offset",
        `The difference (FactLot − other) is ${fmtMoney(at(d, 1))} in every compared year: consistent with a fixed annual amount on one side only (a non-recoverable expense, a reserve, or another line folded into this one).`,
      );
      return out;
    }
    return out;
  };

  const lines: ReconcileDcfLine[] = [];
  let cells = 0;
  let outside = 0;
  for (const k of DCF_LINES) {
    const c = compared.get(k);
    if (!c) continue;
    if (c.bad.length) c.out.likely_causes = causesFor(c);
    cells += c.fl.length;
    outside += c.bad.length;
    lines.push(c.out);
  }
  const differingLines = lines
    .filter((l) => !l.all_within_tolerance)
    .map((l) => l.line);

  // --- sale, value and IRR
  const totals: ReconcileTotal[] = [];
  const o = input.other;
  type Alt = { what: string; run: DcfProForma };
  let alts: Alt[] | null = null;
  const altRuns = (): Alt[] => {
    if (alts) return alts;
    alts = [];
    const flipTiming =
      input0.timing === "mid_year" ? "end_of_year" : "mid_year";
    alts.push({
      what: "timing",
      run: dcfProForma({ ...input0, timing: flipTiming }).value,
    });
    const flipBasis =
      input0.exit_noi_basis === "forward" ? "trailing" : "forward";
    alts.push({
      what: "exit_noi_basis",
      run: dcfProForma({ ...input0, exit_noi_basis: flipBasis }).value,
    });
    if (input0.selling_cost_rate > 0)
      alts.push({
        what: "selling_cost_rate",
        run: dcfProForma({ ...input0, selling_cost_rate: 0 }).value,
      });
    return alts;
  };
  const altFor = (what: string): DcfProForma | undefined =>
    altRuns().find((a) => a.what === what)?.run;
  const basisText = (b: string): string =>
    b === "trailing"
      ? `year ${H}'s NOI (the last hold year)`
      : `year ${N}'s NOI (the year after the hold)`;
  const otherBasis =
    input0.exit_noi_basis === "forward" ? "trailing" : "forward";
  const money = (
    item: ReconcileTotal["item"],
    fl: number,
    ot: number,
  ): ReconcileTotal => {
    const other = round(ot, 2);
    const diff = round(fl - other, 2);
    return {
      item,
      factlot: fl,
      other,
      difference: diff,
      within_tolerance: Math.abs(diff) <= tolOf(other),
      likely_causes: [],
    };
  };
  const cause = (c: string, hypothesis: string): LikelyCause => ({
    cause: c,
    years: [],
    hypothesis,
  });
  const linesNote = differingLines.length
    ? `Annual lines differ (${listOf(differingLines)}); the sale and value follow them: resolve those first.`
    : "";

  if (o.gross_sale_price !== undefined) {
    const r = money(
      "gross_sale_price",
      dcf.exit.gross_sale_price,
      o.gross_sale_price,
    );
    if (!r.within_tolerance) {
      const alt = altFor("exit_noi_basis") as DcfProForma;
      if (
        Math.abs(round(alt.exit.gross_sale_price - r.other, 2)) <=
        tolOf(r.other)
      )
        r.likely_causes.push(
          cause(
            "exit_noi_basis",
            `The other gross sale price equals FactLot's with exit_noi_basis "${otherBasis}" (${fmtMoney(alt.exit.gross_sale_price)}): the other model may capitalize ${basisText(otherBasis)}; FactLot input: "${input0.exit_noi_basis}", ${basisText(input0.exit_noi_basis)}.`,
          ),
        );
      else if (r.other !== 0)
        r.likely_causes.push(
          cause(
            "exit_cap_or_noi",
            `The other gross sale price implies a cap rate of ${fmtPct(dcf.exit.noi / r.other, 3)} on FactLot's exit NOI of ${fmtMoney(dcf.exit.noi)}; FactLot's exit_cap_rate is ${fmtPct(input0.exit_cap_rate, 3)}. Check the exit cap rate and which year's NOI the other model capitalizes.${linesNote ? ` ${linesNote}` : ""}`,
          ),
        );
    }
    totals.push(r);
  }
  if (o.net_sale_proceeds !== undefined) {
    const r = money(
      "net_sale_proceeds",
      dcf.exit.net_sale_proceeds,
      o.net_sale_proceeds,
    );
    if (!r.within_tolerance) {
      const gsp = o.gross_sale_price;
      const alt = altFor("selling_cost_rate");
      if (gsp !== undefined && gsp !== 0) {
        const implied = 1 - o.net_sale_proceeds / gsp;
        if (Math.abs(implied - input0.selling_cost_rate) > 1e-6)
          r.likely_causes.push(
            cause(
              "selling_costs",
              `The other net sale proceeds imply selling costs of ${fmtPct(implied, 3)} of its gross sale price; FactLot's selling_cost_rate is ${fmtPct(input0.selling_cost_rate, 3)}. Check the selling-cost rate and what it applies to.`,
            ),
          );
        else
          r.likely_causes.push(
            cause(
              "carried_from_other_lines",
              "The selling-cost rate agrees; the net proceeds follow the gross sale price, which differs.",
            ),
          );
      } else if (
        alt &&
        Math.abs(round(alt.exit.net_sale_proceeds - r.other, 2)) <=
          tolOf(r.other)
      )
        r.likely_causes.push(
          cause(
            "selling_costs",
            `The other net sale proceeds equal FactLot's gross sale price with no selling costs (${fmtMoney(alt.exit.net_sale_proceeds)}); FactLot's selling_cost_rate is ${fmtPct(input0.selling_cost_rate, 3)}. Check whether the other model deducts selling costs.`,
          ),
        );
    }
    totals.push(r);
  }
  let valueDiffers = false;
  if (o.value !== undefined) {
    const r = money("value", dcf.value, o.value);
    if (!r.within_tolerance) {
      valueDiffers = true;
      let found = false;
      for (const a of altRuns()) {
        if (Math.abs(round(a.run.value - r.other, 2)) > tolOf(r.other))
          continue;
        found = true;
        if (a.what === "timing") {
          const alt = a.run.timing;
          r.likely_causes.push(
            cause(
              "discount_timing",
              `The other value equals FactLot's value rerun with timing "${alt}" (${fmtMoney(a.run.value)}): the other model may discount operating cash flows ${alt === "mid_year" ? "at mid-year, (1 + r)^(y − 0.5)" : "at the end of each year, (1 + r)^y"}; FactLot input: "${input0.timing}". FactLot always discounts the sale at the end of year ${H}.`,
            ),
          );
        } else if (a.what === "exit_noi_basis")
          r.likely_causes.push(
            cause(
              "exit_noi_basis",
              `The other value equals FactLot's value rerun with exit_noi_basis "${otherBasis}" (${fmtMoney(a.run.value)}): the other model may capitalize ${basisText(otherBasis)}; FactLot input: "${input0.exit_noi_basis}".`,
            ),
          );
        else
          r.likely_causes.push(
            cause(
              "selling_costs",
              `The other value equals FactLot's value rerun with no selling costs (${fmtMoney(a.run.value)}); FactLot's selling_cost_rate is ${fmtPct(input0.selling_cost_rate, 3)}. Check whether the other model deducts selling costs from the sale.`,
            ),
          );
      }
      if (!found)
        r.likely_causes.push(
          differingLines.length
            ? cause("carried_from_other_lines", linesNote)
            : cause(
                "valuation_convention",
                `Every compared annual line agrees, so the value difference comes from the sale or the discounting: check the exit cap rate and NOI basis (FactLot: ${fmtPct(input0.exit_cap_rate, 3)} on ${basisText(input0.exit_noi_basis)}, ${fmtMoney(dcf.exit.noi)}), selling costs, the discount rate (${fmtPct(input0.discount_rate, 3)}) and its timing ("${input0.timing}"; the sale at the end of year ${H}), and whether the other model discounts monthly.`,
              ),
        );
    }
    totals.push(r);
  }
  if (o.unlevered_irr !== undefined) {
    if (dcf.unlevered_irr === null)
      t.warn(
        "other.unlevered_irr is not compared: FactLot computes the unlevered IRR only when dcf.purchase_price is given.",
      );
    else {
      const diff = round(dcf.unlevered_irr - o.unlevered_irr, 6);
      const r: ReconcileTotal = {
        item: "unlevered_irr",
        factlot: dcf.unlevered_irr,
        other: o.unlevered_irr,
        difference: diff,
        within_tolerance: Math.abs(diff) <= input.tolerance.irr,
        likely_causes: [],
      };
      if (!r.within_tolerance)
        r.likely_causes.push(
          valueDiffers || differingLines.length
            ? cause(
                "carried_from_other_lines",
                "The cash flows or the value differ too; the IRR follows them: resolve those first.",
              )
            : cause(
                "irr_convention",
                `The compared cash flows and value agree, but the IRR differs: FactLot's unlevered IRR is annual and end of year (Excel IRR) on [−price, CF_1, …, CF_${H} + net sale]${input0.timing === "mid_year" ? ", even with timing mid_year" : ""}. A monthly or mid-year IRR, or a price that includes closing costs, differs. Check the other model's IRR settings.`,
              ),
        );
      totals.push(r);
    }
  }

  const totalsOk = totals.every((x) => x.within_tolerance);
  const allOk = cells > 0 && outside === 0 && totalsOk;
  t.step("Cells compared", cells, `${lines.length} lines × up to ${N} years`);
  t.step("Cells outside tolerance", outside);
  t.step(
    "Likely causes",
    "patterns tested on each differing line, in this order, the first match reported: opposite sign; differences carried from the lines a subtotal foots from, or from the base of a rate; management fee inside operating expenses; a rate on a different base, or not entered; only the year after the hold; a one-year shift; only rollover years (downtime, free rent, TI and commissions); zero in the other export; cent rounding; a compounding factor (growth); a constant factor; a constant amount. Sale, value and IRR: FactLot rerun with the other discount timing, the other exit NOI basis, or no selling costs.",
  );
  if (cells === 0)
    t.warn(
      "No annual line was compared: map at least one label in other.lines to a FactLot line.",
    );
  t.warn(
    "Likely causes are hypotheses drawn from FactLot's own documented conventions, not findings about the other system: confirm each in that system's settings before relying on it. A tie-out shows where two models agree on these inputs; it does not show that either is right, and FactLot does not claim parity with ARGUS, Yardi or any other system.",
  );

  return t.result("calc.reconcile_dcf", 1, {
    system,
    hold_years: H,
    all_within_tolerance: allOk,
    cells_compared: cells,
    cells_outside_tolerance: outside,
    lines,
    totals,
    mapping: entries.map((e) => ({
      label: e.label,
      line: e.line,
      source: e.source,
      sign_flipped: e.factor === -1,
    })),
    unmapped_labels: unmapped,
    ignored_labels: ignored,
    factlot_lines_not_compared: notCompared,
    factlot_dcf: {
      formula: `${dcfRun.formula.id}@${dcfRun.formula.version}`,
      value: dcf.value,
      unlevered_irr: dcf.unlevered_irr,
      exit: dcf.exit,
      warnings: dcfRun.warnings,
    },
  });
}
