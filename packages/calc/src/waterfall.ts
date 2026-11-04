import { z } from "zod";

import {
  CalcInputError,
  Trace,
  fmtMoney,
  fmtPct,
  nthRoot,
  parseInput,
  round,
} from "./core.ts";
import type { CalcResult } from "./core.ts";
import { irr } from "./finance.ts";

export const MAX_WATERFALL_PERIODS = 600;

export const EquityWaterfallInput = z
  .object({
    cash_flows: z
      .array(z.number().finite())
      .min(2)
      .max(MAX_WATERFALL_PERIODS)
      .describe(
        `Project-level equity cash flows at t = 0, 1, 2, … periods: negative = capital contributed by the investors, positive = cash available to distribute. At most ${MAX_WATERFALL_PERIODS}.`,
      ),
    periods_per_year: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(1)
      .describe(
        "Cash-flow periods per year: 1 annual, 4 quarterly, 12 monthly. Sets the pref accrual per period and annualizes the IRRs.",
      ),
    lp_share: z
      .number()
      .finite()
      .gt(0)
      .max(1)
      .describe(
        "Share of every contribution funded by the LP, e.g. 0.9; the GP co-invests the rest (1 for no GP capital). Capital, pref, and the non-promote part of every split are shared in this ratio.",
      ),
    pref: z
      .object({
        rate_annual: z
          .number()
          .finite()
          .gt(0)
          .lt(1)
          .describe("Preferred return, annual, e.g. 0.08."),
        compounding: z
          .enum(["compound", "simple"])
          .default("compound")
          .describe(
            '"compound": unpaid pref earns pref, at the effective periodic rate (1 + rate)^(1 ÷ periods_per_year) − 1, so a fully paid pref is an IRR of rate on the capital. "simple": each period accrues unreturned capital × rate ÷ periods_per_year, and unpaid pref earns nothing.',
          ),
      })
      .optional()
      .describe(
        "Preferred return on unreturned capital, paid to all investors pro rata to capital. Omit for none.",
      ),
    distribution_order: z
      .enum(["pref_then_capital", "capital_then_pref"])
      .default("pref_then_capital")
      .describe(
        "Which comes first from each distribution: accrued pref, then return of capital (the usual order), or capital first.",
      ),
    catch_up: z
      .object({
        gp_share: z
          .number()
          .finite()
          .gt(0)
          .max(1)
          .describe(
            "Share of each catch-up dollar paid to the GP as promote, e.g. 1 for a full catch-up or 0.5 for a 50% catch-up; the rest goes to the investors pro rata.",
          ),
        target_promote: z
          .number()
          .finite()
          .gt(0)
          .lt(1)
          .describe(
            "Catch-up continues until the GP's promote is this share of all profit distributed so far (everything other than return of capital), e.g. 0.2. Must be below gp_share.",
          ),
      })
      .optional()
      .describe(
        "GP catch-up after the pref and return of capital. Omit for none.",
      ),
    tiers: z
      .array(
        z.object({
          until_irr: z
            .number()
            .finite()
            .gt(0)
            .lt(10)
            .describe(
              "LP IRR hurdle (annual, as calc_irr annualizes) that ends this tier, e.g. 0.12.",
            ),
          promote: z
            .number()
            .finite()
            .min(0)
            .lt(1)
            .describe(
              "Share of each dollar in this tier paid to the GP as promote, e.g. 0.2 for an 80/20 split; the rest goes to the investors pro rata to capital.",
            ),
        }),
      )
      .max(10)
      .default([])
      .describe(
        "IRR-hurdle tiers after the catch-up, in increasing until_irr order: each distributes with its promote until the LP's IRR reaches until_irr.",
      ),
    residual_promote: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .default(0)
      .describe(
        "GP promote share of everything after the last tier, e.g. 0.3 for a 70/30 split.",
      ),
  })
  .superRefine((v, ctx) => {
    if (!v.cash_flows.some((c) => c < 0))
      ctx.addIssue({
        code: "custom",
        path: ["cash_flows"],
        message: "needs at least one negative cash flow (a contribution)",
      });
    const tiers = v.tiers ?? [];
    for (let i = 1; i < tiers.length; i++)
      if ((tiers[i]?.until_irr ?? 0) <= (tiers[i - 1]?.until_irr ?? 0))
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "until_irr"],
          message: "tiers must be in strictly increasing until_irr order",
        });
    if (v.catch_up && v.catch_up.gp_share <= v.catch_up.target_promote)
      ctx.addIssue({
        code: "custom",
        path: ["catch_up", "target_promote"],
        message: "must be below catch_up.gp_share",
      });
  });
export type EquityWaterfallInput = z.input<typeof EquityWaterfallInput>;

export interface WaterfallPeriod {
  period: number;
  cash_flow: number;
  lp_contribution: number;
  gp_contribution: number;
  pref: number;
  return_of_capital: number;
  catch_up: number;
  /** Amount distributed in each IRR tier, in tier order. */
  tiers: number[];
  residual: number;
  lp_distribution: number;
  gp_distribution: number;
  /** Part of gp_distribution that is promote (the rest is the GP's pro rata share as co-investor). */
  gp_promote: number;
  lp_net: number;
  gp_net: number;
}

export interface WaterfallParty {
  contributions: number;
  distributions: number;
  profit: number;
  /** Distributions ÷ contributions; null without contributions. */
  multiple: number | null;
  /** Annualized IRR of the net cash flows; null when it does not exist. */
  irr: number | null;
}

export interface EquityWaterfall {
  periods: WaterfallPeriod[];
  lp: WaterfallParty;
  gp: WaterfallParty & { promote: number };
  project_irr: number | null;
  /** Capital not returned by the last period (all investors). */
  unreturned_capital: number;
  /** Pref accrued and not paid by the last period (all investors). */
  unpaid_pref: number;
}

/** IRR (annualized) of a period series, or null when calc.irr finds none. */
function irrOrNull(
  flows: number[],
  p: number,
  t: Trace,
  who: string,
): number | null {
  try {
    const r = irr({ cash_flows: flows, periods_per_year: p });
    for (const w of r.warnings) t.warn(`${who}: ${w}`);
    return r.value.irr_annual;
  } catch (e) {
    if (!(e instanceof CalcInputError)) throw e;
    return null;
  }
}

/** Effective periodic rate for an annual rate: (1 + r)^(1/p) − 1 (r itself when p = 1). */
function periodic(rate: number, p: number): number {
  return p === 1 ? rate : nthRoot(1 + rate, p) - 1;
}

/**
 * LP/GP distribution waterfall: pref (compounding or simple) and return of capital pro rata to
 * capital, an optional GP catch-up, IRR-hurdle tiers with promote splits measured on the LP's
 * cash flows, and a residual split; per-period distributions that foot to the cent.
 */
export function equityWaterfall(
  raw: EquityWaterfallInput,
): CalcResult<EquityWaterfall> {
  const input = parseInput(EquityWaterfallInput, raw);
  const t = new Trace();
  const p = input.periods_per_year;
  const s = input.lp_share;
  const pref = input.pref;
  const cu = input.catch_up;
  const tiers = input.tiers;
  const prefRate = pref ? periodic(pref.rate_annual, p) : 0;
  const hurdleRates = tiers.map((x) => periodic(x.until_irr, p));

  t.step(
    "Investors",
    `LP ${fmtPct(s, 4)} / GP ${fmtPct(1 - s, 4)} of every contribution; capital, pref, and the non-promote part of every split go pro rata to capital`,
  );
  if (pref)
    t.step(
      "Pref",
      pref.compounding === "compound"
        ? `${fmtPct(pref.rate_annual, 4)} compounding: unpaid pref and capital accrue ${round(prefRate, 10)} a period ((1 + rate)^(1/${p}) − 1)`
        : `${fmtPct(pref.rate_annual, 4)} simple: unreturned capital × ${pref.rate_annual} ÷ ${p} a period; unpaid pref earns nothing`,
      "accrues from the period after each contribution, on balances after the previous period's flows",
    );
  t.step(
    "Order of distributions",
    [
      ...(pref
        ? input.distribution_order === "pref_then_capital"
          ? ["accrued pref", "return of capital"]
          : ["return of capital", "accrued pref"]
        : ["return of capital"]),
      ...(cu
        ? [
            `catch-up (${fmtPct(cu.gp_share, 2)} to GP until the promote is ${fmtPct(cu.target_promote, 2)} of profit)`,
          ]
        : []),
      ...tiers.map(
        (x) =>
          `${fmtPct(1 - x.promote, 2)}/${fmtPct(x.promote, 2)} until the LP IRR is ${fmtPct(x.until_irr, 2)}`,
      ),
      `${fmtPct(1 - input.residual_promote, 2)}/${fmtPct(input.residual_promote, 2)} thereafter`,
    ].join(" → "),
  );
  if (tiers.length > 0)
    t.step(
      "IRR hurdles",
      "each tier tracks an LP balance that grows at the hurdle's effective periodic rate ((1 + hurdle)^(1/periods_per_year) − 1), rises with LP contributions and falls with every LP distribution; the tier ends when the balance reaches zero, which is when the LP IRR (calc_irr annualization) reaches the hurdle",
    );

  let capital = 0;
  let unpaid = 0;
  const balances = tiers.map(() => 0);
  let promoteTotal = 0;
  let profitTotal = 0;
  const periods: WaterfallPeriod[] = [];
  let lpContribSum = 0;
  let gpContribSum = 0;
  let lpDistSum = 0;
  let gpDistSum = 0;
  let promoteSum = 0;
  const lpNet: number[] = [];
  const gpNet: number[] = [];

  input.cash_flows.forEach((cf, k) => {
    if (k > 0) {
      if (pref)
        unpaid +=
          pref.compounding === "compound"
            ? (capital + unpaid) * prefRate
            : (capital * pref.rate_annual) / p;
      for (let i = 0; i < balances.length; i++)
        balances[i] =
          (balances[i] as number) * (1 + (hurdleRates[i] as number));
    }
    let lpC = 0;
    let gpC = 0;
    const parts = new Array<number>(tiers.length + 4).fill(0); // pref, capital, catch-up, tiers…, residual
    let lpD = 0;
    let promote = 0;
    const payLp = (amount: number): void => {
      lpD += amount;
      for (let i = 0; i < balances.length; i++)
        balances[i] = (balances[i] as number) - amount;
    };
    if (cf < 0) {
      const x = -cf;
      capital += x;
      lpC = round(x * s, 2);
      gpC = round(x - lpC, 2);
      for (let i = 0; i < balances.length; i++)
        balances[i] = (balances[i] as number) + x * s;
    } else if (cf > 0) {
      let d = cf;
      const payPref = (): void => {
        if (!pref || d <= 0) return;
        const x = Math.min(d, unpaid);
        unpaid -= x;
        profitTotal += x;
        parts[0] = x;
        payLp(x * s);
        d -= x;
      };
      const payCapital = (): void => {
        if (d <= 0) return;
        const x = Math.min(d, capital);
        capital -= x;
        parts[1] = x;
        payLp(x * s);
        d -= x;
      };
      if (input.distribution_order === "pref_then_capital") {
        payPref();
        payCapital();
      } else {
        payCapital();
        payPref();
      }
      if (cu && d > 0) {
        const need =
          (cu.target_promote * profitTotal - promoteTotal) /
          (cu.gp_share - cu.target_promote);
        const x = Math.max(0, Math.min(d, need));
        if (x > 0) {
          promote += cu.gp_share * x;
          promoteTotal += cu.gp_share * x;
          profitTotal += x;
          parts[2] = x;
          payLp((1 - cu.gp_share) * x * s);
          d -= x;
        }
      }
      tiers.forEach((tier, i) => {
        const b = balances[i] as number;
        if (d <= 0 || b <= 0) return;
        const lpPerDollar = (1 - tier.promote) * s;
        const x = Math.min(d, b / lpPerDollar);
        promote += tier.promote * x;
        promoteTotal += tier.promote * x;
        profitTotal += x;
        parts[3 + i] = x;
        payLp(x * lpPerDollar);
        d -= x;
      });
      if (d > 0) {
        const x = d;
        promote += input.residual_promote * x;
        promoteTotal += input.residual_promote * x;
        profitTotal += x;
        parts[3 + tiers.length] = x;
        payLp((1 - input.residual_promote) * x * s);
        d = 0;
      }
    }
    // Cents that foot: the LP's share is rounded and the GP takes the rest of the cash flow;
    // each tier column is rounded and the last tier paid takes the rest.
    const rounded = parts.map((x) => round(x, 2));
    let lastPaid = -1;
    parts.forEach((x, i) => {
      if (x > 0) lastPaid = i;
    });
    if (lastPaid >= 0) {
      let others = 0;
      rounded.forEach((x, i) => {
        if (i !== lastPaid) others += x;
      });
      rounded[lastPaid] = round(cf - others, 2);
    }
    const lpDist = cf > 0 ? round(lpD, 2) : 0;
    const gpDist = cf > 0 ? round(cf - lpDist, 2) : 0;
    const gpPromote = cf > 0 ? round(promote, 2) : 0;
    periods.push({
      period: k,
      cash_flow: cf,
      lp_contribution: lpC,
      gp_contribution: gpC,
      pref: rounded[0] as number,
      return_of_capital: rounded[1] as number,
      catch_up: rounded[2] as number,
      tiers: rounded.slice(3, 3 + tiers.length),
      residual: rounded[3 + tiers.length] as number,
      lp_distribution: lpDist,
      gp_distribution: gpDist,
      gp_promote: gpPromote,
      lp_net: round(lpDist - lpC, 2),
      gp_net: round(gpDist - gpC, 2),
    });
    lpContribSum = round(lpContribSum + lpC, 2);
    gpContribSum = round(gpContribSum + gpC, 2);
    lpDistSum = round(lpDistSum + lpDist, 2);
    gpDistSum = round(gpDistSum + gpDist, 2);
    promoteSum = round(promoteSum + gpPromote, 2);
    lpNet.push(round(lpDist - lpC, 2));
    gpNet.push(round(gpDist - gpC, 2));
  });

  t.step(
    "Rounding",
    "every period's LP distribution is rounded to the cent and the GP receives the rest of the cash flow; tier columns are rounded and the last tier paid in the period takes the rest, so each row foots; totals are row sums",
  );
  const party = (
    contrib: number,
    dist: number,
    net: number[],
    who: string,
  ): WaterfallParty => ({
    contributions: contrib,
    distributions: dist,
    profit: round(dist - contrib, 2),
    multiple: contrib > 0 ? round(dist / contrib, 4) : null,
    irr: contrib > 0 ? irrOrNull(net, p, t, who) : null,
  });
  const lp = party(lpContribSum, lpDistSum, lpNet, "LP IRR");
  const gp = {
    ...party(gpContribSum, gpDistSum, gpNet, "GP IRR"),
    promote: promoteSum,
  };
  const projectIrr = irrOrNull(input.cash_flows, p, t, "Project IRR");
  t.step(
    "LP",
    `${fmtMoney(lp.contributions)} in, ${fmtMoney(lp.distributions)} out`,
    lp.irr === null
      ? "no IRR"
      : `IRR ${fmtPct(lp.irr, 3)}, multiple ${lp.multiple}x`,
  );
  t.step(
    "GP",
    `${fmtMoney(gp.contributions)} in, ${fmtMoney(gp.distributions)} out, of which ${fmtMoney(gp.promote)} promote`,
    gp.irr === null
      ? "no IRR"
      : `IRR ${fmtPct(gp.irr, 3)}, multiple ${gp.multiple}x`,
  );
  if (projectIrr !== null)
    t.step("Project IRR", projectIrr, "IRR of cash_flows before the waterfall");

  const unreturned = round(capital, 2);
  const unpaidPref = round(unpaid, 2);
  if (unreturned > 0)
    t.warn(
      `${fmtMoney(unreturned)} of contributed capital is not returned by the last period.`,
    );
  if (unpaidPref > 0)
    t.warn(
      `${fmtMoney(unpaidPref)} of accrued pref is unpaid at the last period.`,
    );
  if (pref)
    tiers.forEach((x) => {
      if (x.until_irr <= pref.rate_annual)
        t.warn(
          `Tier hurdle ${fmtPct(x.until_irr, 2)} is not above the ${fmtPct(pref.rate_annual, 2)} pref, so it can be reached before or while the pref is paid.`,
        );
    });
  if (cu) {
    if (!pref)
      t.warn(
        "A catch-up without a pref catches up on profit from the first dollar after capital; check the agreement.",
      );
    const next = tiers[0]?.promote ?? input.residual_promote;
    if (next !== cu.target_promote)
      t.warn(
        `The catch-up target (${fmtPct(cu.target_promote, 2)} of profit) differs from the promote of the split that follows it (${fmtPct(next, 2)}).`,
      );
  }
  if (s === 1)
    t.warn("The GP contributes no capital, so the GP has no IRR or multiple.");
  t.warn(
    "Waterfall conventions to confirm against the operating agreement: hurdles are measured on the LP's cash flows with end-of-period timing and effective periodic compounding; the GP's co-investment shares pref, capital and splits pari passu with the LP; the catch-up target is a share of all profit (pref included); distributions are not clawed back.",
  );

  return t.result("calc.equity_waterfall", 1, {
    periods,
    lp,
    gp,
    project_irr: projectIrr,
    unreturned_capital: unreturned,
    unpaid_pref: unpaidPref,
  });
}
