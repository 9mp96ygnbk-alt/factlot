import { z } from "zod";

import { camReconciliation } from "./cam.ts";
import type { CamReconciliation, CamReconciliationInput } from "./cam.ts";
import {
  CamReconciliationBatchInput,
  camBatchTenantInput,
  camReconciliationBatch,
} from "./cam_batch.ts";
import {
  CalcInputError,
  Money,
  NonNegMoney,
  Share,
  Trace,
  fmtMoney,
  fmtNum,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { ReconcileTolerance, normalizeLabel } from "./reconcile_dcf.ts";
import type { LikelyCause } from "./reconcile_dcf.ts";

const Label = z.string().min(1).max(200);

const OtherCamTenant = z.object({
  tenant: Label.describe(
    "Tenant as the other system names it; matched to cam.tenants[].name exactly, else ignoring case and punctuation.",
  ),
  pool: Label.optional().describe(
    'The other system\'s expense pool for this row, e.g. "CAM" (echoed; reconcile one pool per call).',
  ),
  pro_rata_share: Share.optional().describe(
    "The other system's pro rata share for the tenant, 0 < share ≤ 1.",
  ),
  gross_up_applied: z
    .boolean()
    .optional()
    .describe(
      "Whether the other system grossed up variable expenses for this tenant.",
    ),
  grossed_up_expenses: NonNegMoney.optional().describe(
    "The other system's pool after gross-up (the building amount before the tenant's share), USD.",
  ),
  cap_applied: z
    .boolean()
    .optional()
    .describe("Whether a cap reduced the other system's charge."),
  cap_limit: NonNegMoney.optional().describe(
    "The other system's cap limit on the tenant's controllable share, USD.",
  ),
  cap_reduction: NonNegMoney.optional().describe(
    "Amount the cap removed in the other system, USD.",
  ),
  admin_fee_applied: z
    .boolean()
    .optional()
    .describe("Whether the other system charged an admin fee."),
  admin_fee: NonNegMoney.optional().describe(
    "The other system's admin or management fee for the tenant, USD.",
  ),
  structure_deduction: NonNegMoney.optional().describe(
    "The other system's base-year or expense-stop deduction, USD.",
  ),
  billed_amount: NonNegMoney.describe(
    "What the other system billed the tenant for the year before estimates (FactLot's tenant_charge), USD.",
  ),
  estimates_paid: NonNegMoney.optional().describe(
    "Estimates (prior billings) the other system credits for the year, USD.",
  ),
  balance_due: Money.optional().describe(
    "The other system's balance due (negative for a credit), USD.",
  ),
});

export const ReconcileCamInput = z
  .object({
    cam: CamReconciliationBatchInput.describe(
      "The FactLot CAM input for one expense pool, exactly as calc_cam_reconciliation_batch takes it (the same pool, shares and lease terms you entered in the other system).",
    ),
    other: z
      .object({
        system: Label.default("other system").describe(
          'Name of the system or file the results come from, echoed in the result, e.g. "Yardi CAM recon export" (free text).',
        ),
        pool: Label.optional().describe(
          'The pool these results are for, e.g. "CAM", echoed in the result.',
        ),
        tenants: z
          .array(OtherCamTenant)
          .min(1)
          .max(500)
          .describe(
            "The other system's per-tenant results for this pool. Give whatever it reports; billed_amount is required.",
          ),
      })
      .describe("What the other system reported for the same pool and year."),
    tolerance: ReconcileTolerance.extend({
      share: z
        .number()
        .finite()
        .min(0)
        .lt(1)
        .default(0.000001)
        .describe(
          "Largest pro rata share difference still counted as agreeing (default 0.000001).",
        ),
    })
      .default({ absolute: 1, relative: 0, share: 0.000001 })
      .describe(
        "When two amounts agree: |FactLot − other| ≤ max(absolute, relative × |other|); shares within share. Default: 1.00 USD, 0, and 0.000001.",
      ),
  })
  .superRefine((v, ctx) => {
    const seen = new Map<string, number>();
    v.other.tenants.forEach((x, i) => {
      const j = seen.get(x.tenant);
      if (j !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["other", "tenants", i, "tenant"],
          message: `"${x.tenant}" repeats row ${j} (reconcile one pool per call)`,
        });
      else seen.set(x.tenant, i);
    });
  });
export type ReconcileCamInput = z.input<typeof ReconcileCamInput>;

export interface ReconcileCamLine {
  line: string;
  factlot: number | boolean | null;
  other: number | boolean;
  /** FactLot − other (cents; shares to 6 decimals); null for true/false lines or a missing FactLot amount. */
  difference: number | null;
  within_tolerance: boolean;
}

export interface ReconcileCamTenant {
  tenant: string;
  other_tenant: string;
  pool: string | null;
  lines: ReconcileCamLine[];
  all_within_tolerance: boolean;
  likely_causes: LikelyCause[];
}

export interface ReconcileCam {
  system: string;
  pool: string | null;
  year: number;
  all_within_tolerance: boolean;
  tenants_compared: number;
  tenants_within_tolerance: number;
  cells_compared: number;
  cells_outside_tolerance: number;
  tenants: ReconcileCamTenant[];
  factlot_tenants_not_in_other: string[];
  other_tenants_not_matched: string[];
  total_billed: { factlot: number; other: number; difference: number };
  building_causes: LikelyCause[];
  factlot_cam: {
    formula: string;
    total_tenant_charges: number;
    warnings: string[];
  };
}

type Single = z.output<typeof CamReconciliationInput>;

/** Expense names usually uncontrollable under a CAM cap. */
const UNCONTROLLABLE = /tax|insurance|utilit/i;
type OtherRow = z.output<typeof OtherCamTenant>;

/** The other system's money fields, compared in this order, and FactLot's field for each. */
const MONEY: [keyof OtherRow, keyof CamReconciliation][] = [
  ["grossed_up_expenses", "grossed_up_expenses"],
  ["cap_limit", "cap_limit"],
  ["cap_reduction", "cap_reduction"],
  ["admin_fee", "admin_fee"],
  ["structure_deduction", "structure_deduction"],
  ["billed_amount", "tenant_charge"],
  ["estimates_paid", "estimates_paid"],
  ["balance_due", "balance_due"],
];

/**
 * Tie FactLot's CAM reconciliation out against another system's per-tenant results: runs
 * calc_cam_reconciliation_batch, matches tenants, compares share, gross-up, cap, admin fee,
 * deductions, billed amount, estimates and balance within a tolerance, and names likely causes
 * by rerunning FactLot with the convention the other system may use, as hypotheses to check.
 */
export function reconcileCam(raw: ReconcileCamInput): CalcResult<ReconcileCam> {
  const input = parseInput(ReconcileCamInput, raw);
  const t = new Trace();
  const batch = camReconciliationBatch(input.cam);
  const cam = input.cam;
  const tolAbs = input.tolerance.absolute;
  const tolRel = input.tolerance.relative;
  const tolOf = (other: number): number =>
    Math.max(tolAbs, tolRel * Math.abs(other));
  const system = input.other.system;
  const pool = input.other.pool ?? null;
  // Expense lines whose controllable flag was left to its default (true).
  const rawExpenses = (raw as { cam: { expenses: Record<string, unknown>[] } })
    .cam.expenses;
  const defaulted = new Set<number>();
  rawExpenses.forEach((e, i) => {
    if (e.controllable === undefined) defaulted.add(i);
  });

  t.step("Other system", system);
  if (pool !== null) t.step("Pool", pool);
  t.step(
    "FactLot total tenant charges",
    batch.value.building.total_tenant_charges,
    `calc.cam_reconciliation_batch@${batch.formula.version} on the cam input, ${batch.value.tenants.length} tenants`,
    "USD",
  );

  // --- match rows to FactLot tenants: exact name, else one name that reads the same
  const names = cam.tenants.map((x) => x.name);
  const byNorm = new Map<string, number[]>();
  names.forEach((nm, i) => {
    const k = normalizeLabel(nm);
    byNorm.set(k, [...(byNorm.get(k) ?? []), i]);
  });
  const taken = new Set<number>();
  const pairs: { i: number; row: OtherRow }[] = [];
  const unmatched: string[] = [];
  for (const row of input.other.tenants) {
    let i = names.indexOf(row.tenant);
    if (i < 0) {
      const hits = byNorm.get(normalizeLabel(row.tenant)) ?? [];
      i = hits.length === 1 ? (hits[0] as number) : -1;
    }
    if (i < 0 || taken.has(i)) {
      unmatched.push(row.tenant);
      continue;
    }
    taken.add(i);
    pairs.push({ i, row });
  }
  const missing = names.filter((_, i) => !taken.has(i));
  t.step(
    "Tenants matched",
    pairs.length,
    `${input.other.tenants.length} rows from the other system, ${names.length} FactLot tenants`,
  );
  t.step(
    "Difference",
    "FactLot − other, rounded to the cent (shares to 6 decimals)",
    `agrees when |difference| ≤ max(${fmtMoney(tolAbs)}, ${fmtNum(tolRel)} × |other|); shares within ${fmtNum(input.tolerance.share)}; true/false lines when equal`,
  );

  const run = (x: Single): CamReconciliation | null => {
    try {
      return camReconciliation(x).value;
    } catch (err) {
      if (err instanceof CalcInputError) return null;
      throw err;
    }
  };

  const tenants: ReconcileCamTenant[] = [];
  let cells = 0;
  let outside = 0;
  const shareRatios: number[] = [];
  let billedFl = 0;
  let billedOt = 0;
  for (const { i, row } of pairs) {
    const v = (
      batch.value.tenants[i] as { statement: { value: CamReconciliation } }
    ).statement.value;
    const one = camBatchTenantInput(cam, i);
    const lines: ReconcileCamLine[] = [];
    const money = (fl: number | null, ot: number): ReconcileCamLine => {
      if (fl === null)
        return {
          line: "",
          factlot: null,
          other: ot,
          difference: null,
          within_tolerance: false,
        };
      const diff = round(fl - ot, 2);
      return {
        line: "",
        factlot: fl,
        other: ot,
        difference: diff,
        within_tolerance: Math.abs(diff) <= tolOf(ot),
      };
    };
    const flag = (line: string, fl: boolean, ot: boolean): void => {
      lines.push({
        line,
        factlot: fl,
        other: ot,
        difference: null,
        within_tolerance: fl === ot,
      });
    };
    let shareDiffers = false;
    if (row.pro_rata_share !== undefined) {
      const diff = round(one.pro_rata_share - row.pro_rata_share, 6);
      const ok = Math.abs(diff) <= input.tolerance.share;
      shareDiffers = !ok;
      if (!ok) shareRatios.push(one.pro_rata_share / row.pro_rata_share);
      lines.push({
        line: "pro_rata_share",
        factlot: one.pro_rata_share,
        other: row.pro_rata_share,
        difference: diff,
        within_tolerance: ok,
      });
    }
    if (row.gross_up_applied !== undefined)
      flag(
        "gross_up_applied",
        v.grossed_up_expenses > v.recoverable_expenses,
        row.gross_up_applied,
      );
    if (row.cap_applied !== undefined)
      flag("cap_applied", v.cap_reduction > 0, row.cap_applied);
    if (row.admin_fee_applied !== undefined)
      flag("admin_fee_applied", v.admin_fee > 0, row.admin_fee_applied);
    for (const [key, fk] of MONEY) {
      const ot = row[key];
      if (typeof ot !== "number") continue;
      const fl = v[fk] as number | null;
      lines.push({
        ...money(fl, ot),
        line: fk === "tenant_charge" ? "billed_amount" : fk,
      });
    }
    billedFl += v.tenant_charge;
    billedOt += row.billed_amount;
    const bad = lines.filter((l) => !l.within_tolerance);
    cells += lines.length;
    outside += bad.length;

    // --- likely causes
    const causes: LikelyCause[] = [];
    const add = (cause: string, hypothesis: string): void => {
      causes.push({ cause, years: [], hypothesis });
    };
    const matches = (alt: CamReconciliation | null): boolean => {
      if (!alt) return false;
      for (const [key, fk] of MONEY) {
        if (key === "estimates_paid" || key === "balance_due") continue;
        const ot = row[key];
        if (typeof ot !== "number") continue;
        const fl = alt[fk] as number | null;
        if (fl === null || Math.abs(round(fl - ot, 2)) > tolOf(ot))
          return false;
      }
      return true;
    };
    const amountsDiffer = bad.some(
      (l) =>
        l.line !== "estimates_paid" &&
        l.line !== "balance_due" &&
        l.line !== "pro_rata_share",
    );
    if (shareDiffers && row.pro_rata_share !== undefined) {
      const os = row.pro_rata_share;
      const alt = run({ ...one, pro_rata_share: os });
      add(
        "pro_rata_denominator",
        `The other system's share is ${fmtNum(os)}, FactLot's is ${fmtNum(one.pro_rata_share)} (ratio ${fmtNum(one.pro_rata_share / os)}): the pro-rata denominator or the tenant's area differs (for example leasable versus leased area, or a pool that leaves some tenants out). FactLot uses the pro_rata_share you passed.${alt && matches(alt) ? ` With the other share FactLot's charge is ${fmtMoney(alt.tenant_charge)}, which matches.` : ""}`,
      );
    } else if (amountsDiffer) {
      const alts: [string, Single, string][] = [];
      const cap = one.cap;
      const fee = one.admin_fee;
      if (cap) {
        // Lines left to the default controllable: true; first those named like taxes, insurance or
        // utilities, then all of them.
        const left = one.expenses
          .map((_, j) => j)
          .filter(
            (j) =>
              defaulted.has(j) &&
              (one.expenses[j] as Single["expenses"][number]).recoverable &&
              (one.expenses[j] as Single["expenses"][number]).controllable,
          );
        const named = left.filter((j) =>
          UNCONTROLLABLE.test(
            (one.expenses[j] as { category: string }).category,
          ),
        );
        const sets =
          named.length && named.length < left.length ? [named, left] : [left];
        for (const flip of sets)
          if (flip.length)
            alts.push([
              "controllable_default",
              {
                ...one,
                expenses: one.expenses.map((e, j) =>
                  flip.includes(j) ? { ...e, controllable: false } : e,
                ),
              },
              `with ${flip.map((j) => (one.expenses[j] as { category: string }).category).join(", ")} uncontrollable`,
            ]);
        if (
          cap.method !== "year_over_year" &&
          cap.years_elapsed !== undefined
        ) {
          const n = cap.years_elapsed;
          for (const n2 of [n + 1, n - 1])
            if (n2 >= 0)
              alts.push([
                "cap_base_year",
                { ...one, cap: { ...cap, years_elapsed: n2 } },
                `with cap.years_elapsed ${n2} instead of ${n}`,
              ]);
          const m2 =
            cap.method === "compounding_from_base"
              ? "simple_from_base"
              : "compounding_from_base";
          alts.push([
            "cap_method",
            { ...one, cap: { ...cap, method: m2 } },
            `with cap.method "${m2}" instead of "${cap.method}"`,
          ]);
        }
      }
      const gu = one.gross_up;
      if (gu) {
        for (const t2 of [0.95, 1])
          if (t2 !== gu.target_occupancy)
            alts.push([
              "gross_up_target",
              { ...one, gross_up: { ...gu, target_occupancy: t2 } },
              `with gross_up.target_occupancy ${fmtNum(t2)} instead of ${fmtNum(gu.target_occupancy)}`,
            ]);
        const { gross_up: _drop, ...noGrossUp } = one;
        void _drop;
        alts.push(["gross_up_missing", noGrossUp, "without gross-up"]);
      }
      if (fee && cap) {
        const before = fee.applied === "before_cap";
        for (const [applied, capped] of [
          [!before, fee.capped],
          [before, !fee.capped],
          [!before, !fee.capped],
        ] as [boolean, boolean][]) {
          const a2 = applied ? "before_cap" : "after_cap";
          alts.push([
            "admin_fee_cap_order",
            { ...one, admin_fee: { ...fee, applied: a2, capped } },
            `with the admin fee computed ${applied ? "before" : "after"} the cap and ${capped ? "counted within" : "added outside"} it (FactLot input: ${before ? "before" : "after"} the cap, ${fee.capped ? "within" : "outside"} it)`,
          ]);
        }
      }
      if (fee) {
        const off = one.expenses.filter(
          (e) => e.recoverable && !e.controllable && e.admin_fee_applies,
        );
        if (off.length)
          alts.push([
            "admin_fee_base",
            {
              ...one,
              expenses: one.expenses.map((e) =>
                e.recoverable && !e.controllable && e.admin_fee_applies
                  ? { ...e, admin_fee_applies: false }
                  : e,
              ),
            },
            `with no admin fee on the uncontrollable lines ${off.map((e) => e.category).join(", ")}`,
          ]);
      }
      const why: Record<string, string> = {
        controllable_default:
          "these lines were left to the default controllable: true, so FactLot caps them; the other system may not (taxes, insurance and utilities usually are not capped). Set controllable on every line as the lease says.",
        cap_base_year:
          "the other system may count the cap from a different base year. Check the cap's base year and years_elapsed.",
        cap_method:
          "the other system may compound the cap differently. Map the lease's cap language to one method explicitly.",
        gross_up_target:
          "check the gross-up occupancy in the lease and in the other system.",
        gross_up_missing:
          "the other system may not gross up variable expenses for this pool or this tenant.",
        admin_fee_cap_order:
          "the other system may charge the fee on the capped or the uncapped amount differently. Confirm the lease's order of operations.",
        admin_fee_base:
          "the other system may leave them out of the fee base (set admin_fee_applies false on those lines, or use admin_fee_excluded_categories for this tenant).",
      };
      for (const [id, x, text] of alts) {
        const alt = run(x);
        if (!matches(alt)) continue;
        add(
          id,
          `The other results match FactLot rerun ${text} (charge ${fmtMoney((alt as CamReconciliation).tenant_charge)}): ${why[id] as string}`,
        );
      }
    }
    if (
      row.estimates_paid !== undefined &&
      Math.abs(round(v.estimates_paid - row.estimates_paid, 2)) >
        tolOf(row.estimates_paid)
    )
      add(
        "estimates_paid",
        `The other system credits ${fmtMoney(row.estimates_paid)} of estimates paid, FactLot was given ${fmtMoney(v.estimates_paid)}: the balance due differs by that amount even where the charge agrees.`,
      );

    tenants.push({
      tenant: names[i] as string,
      other_tenant: row.tenant,
      pool: row.pool ?? pool,
      lines,
      all_within_tolerance: bad.length === 0,
      likely_causes: bad.length ? causes : [],
    });
  }

  // --- the building: one denominator for everyone
  const building: LikelyCause[] = [];
  if (shareRatios.length >= 2) {
    const k = shareRatios[0] as number;
    if (shareRatios.every((r) => Math.abs(r / k - 1) <= 1e-4))
      building.push({
        cause: "pro_rata_denominator",
        years: [],
        hypothesis: `Every differing share is ${fmtNum(k)} × the other system's: one denominator differs for the whole pool (the other system divides by an area ${fmtNum(k)} × FactLot's). Check which area each system divides by: leasable, leased or occupied, and whether some tenants are left out of the pool.`,
      });
  }

  const within = tenants.filter((x) => x.all_within_tolerance).length;
  t.step("Cells compared", cells);
  t.step("Cells outside tolerance", outside);
  t.step(
    "Likely causes",
    "for each tenant that differs: a different pro rata share; otherwise FactLot rerun with lines left to the default controllable: true set uncontrollable, the cap's years_elapsed ± 1, the other cap method, the other gross-up target or none, the admin fee before or after and within or outside the cap, and no fee on uncontrollable lines; every rerun whose amounts all agree is reported. Estimates paid are compared on their own.",
  );
  if (missing.length)
    t.warn(
      `FactLot tenants with no row from the other system: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ` and ${missing.length - 20} more` : ""}.`,
    );
  if (unmatched.length)
    t.warn(
      `Rows from the other system that match no FactLot tenant (or match one already taken): ${unmatched.slice(0, 20).join(", ")}${unmatched.length > 20 ? ` and ${unmatched.length - 20} more` : ""}.`,
    );
  t.warn(
    "Likely causes are hypotheses drawn from FactLot's own documented CAM conventions, not findings about the other system: confirm each in that system's setup and the lease before relying on it. FactLot does not claim parity with Yardi or any other system.",
  );

  return t.result("calc.reconcile_cam", 1, {
    system,
    pool,
    year: cam.year,
    all_within_tolerance:
      pairs.length > 0 &&
      outside === 0 &&
      missing.length === 0 &&
      unmatched.length === 0,
    tenants_compared: pairs.length,
    tenants_within_tolerance: within,
    cells_compared: cells,
    cells_outside_tolerance: outside,
    tenants,
    factlot_tenants_not_in_other: missing,
    other_tenants_not_matched: unmatched,
    total_billed: {
      factlot: round(billedFl, 2),
      other: round(billedOt, 2),
      difference: round(round(billedFl, 2) - round(billedOt, 2), 2),
    },
    building_causes: building,
    factlot_cam: {
      formula: `${batch.formula.id}@${batch.formula.version}`,
      total_tenant_charges: batch.value.building.total_tenant_charges,
      warnings: batch.warnings,
    },
  });
}
