import { z } from "zod";

import {
  CalcInputError,
  Trace,
  fmtPct,
  parseInput,
  powInt,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";

const CashFlows = z
  .array(z.number().finite())
  .min(2)
  .describe(
    "Periodic cash flows at t = 0, 1, 2, …; negative for outflows (e.g. purchase price at t = 0).",
  );

export const NpvInput = z.object({
  /** Cash flows at t = 0, 1, 2, ... periods. */
  cash_flows: CashFlows,
  rate: z.number().finite().gt(-1).describe("Discount rate per period."),
});
export type NpvInput = z.input<typeof NpvInput>;

function npvAt(flows: number[], r: number): number {
  return flows.reduce((acc, cf, t) => acc + cf / powInt(1 + r, t), 0);
}

export function npv(raw: NpvInput): CalcResult<{ npv: number }> {
  const input = parseInput(NpvInput, raw);
  const t = new Trace();
  const v = t.step(
    "NPV",
    round(npvAt(input.cash_flows, input.rate), 2),
    `Σ CF_t ÷ (1 + ${input.rate})^t`,
  );
  return t.result("calc.npv", 1, { npv: v });
}

export const IrrInput = z.object({
  cash_flows: CashFlows,
  periods_per_year: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe("Periods per year, to annualize (12 for monthly flows)."),
});
export type IrrInput = z.input<typeof IrrInput>;

/**
 * IRR, solved deterministically: scan per-period rates from -99.99% to 1000% for
 * sign changes in NPV, bisect each bracket to 1e-12, and return the root nearest
 * zero. When cash flows have several IRRs, all roots found are reported.
 */
export function irr(
  raw: IrrInput,
): CalcResult<{ irr_periodic: number; irr_annual: number; roots: number[] }> {
  const input = parseInput(IrrInput, raw);
  const t = new Trace();
  const flows = input.cash_flows;
  if (!flows.some((c) => c > 0) || !flows.some((c) => c < 0)) {
    throw new CalcInputError(
      "IRR needs at least one positive and one negative cash flow",
    );
  }

  const grid = [-0.9999];
  for (let i = -99; i <= 1000; i++) grid.push(i / 100);
  const roots: number[] = [];
  for (let i = 1; i < grid.length; i++) {
    let lo = grid[i - 1] as number;
    let hi = grid[i] as number;
    let fLo = npvAt(flows, lo);
    const fHi = npvAt(flows, hi);
    if (fLo === 0) {
      roots.push(lo);
      continue;
    }
    if (Math.sign(fLo) === Math.sign(fHi)) continue;
    for (let k = 0; k < 200 && hi - lo > 1e-12; k++) {
      const mid = (lo + hi) / 2;
      const fMid = npvAt(flows, mid);
      if (Math.sign(fMid) === Math.sign(fLo)) {
        lo = mid;
        fLo = fMid;
      } else {
        hi = mid;
      }
    }
    roots.push(round((lo + hi) / 2, 10));
  }
  const unique = [...new Set(roots)];
  if (unique.length === 0)
    throw new CalcInputError(
      "no IRR found between -99.99% and 1000% per period",
    );
  const periodic = unique.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  if (unique.length > 1) {
    t.warn(
      `Multiple IRRs exist (${unique.map((r) => fmtPct(r, 4)).join(", ")}); returned the one nearest 0%.`,
    );
  }
  const annual = powInt(1 + periodic, input.periods_per_year) - 1;
  t.step(
    "Periodic IRR",
    round(periodic, 8),
    "r such that Σ CF_t ÷ (1 + r)^t = 0",
  );
  t.step(
    "Annualized IRR",
    round(annual, 8),
    `(1 + r)^${input.periods_per_year} − 1 = ${fmtPct(annual, 3)}`,
  );
  return t.result("calc.irr", 1, {
    irr_periodic: round(periodic, 8),
    irr_annual: round(annual, 8),
    roots: unique.map((r) => round(r, 8)),
  });
}
