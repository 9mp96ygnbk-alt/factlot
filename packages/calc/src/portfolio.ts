import { z } from "zod";

import { CalcInputError, IsoDate, Trace, parseInput, round } from "./core.ts";
import type { CalcResult } from "./core.ts";
import { daysBetween } from "./dates.ts";

export const WaltInput = z.object({
  as_of: IsoDate,
  weight_by: z.enum(["area", "rent"]).default("area"),
  leases: z
    .array(
      z.object({
        id: z.string().optional(),
        expiration_date: IsoDate,
        area_sf: z.number().positive().optional(),
        annual_rent: z.number().positive().optional(),
      }),
    )
    .min(1),
});
export type WaltInput = z.input<typeof WaltInput>;

export interface Walt {
  walt_years: number;
  total_weight: number;
  expired_count: number;
}

/**
 * Weighted average lease term remaining, in years (actual days ÷ 365.25).
 * Leases already expired at `as_of` contribute zero remaining term but keep their weight.
 */
export function walt(raw: WaltInput): CalcResult<Walt> {
  const input = parseInput(WaltInput, raw);
  const t = new Trace();
  const key = input.weight_by === "area" ? "area_sf" : "annual_rent";
  let weighted = 0;
  let total = 0;
  let expired = 0;
  input.leases.forEach((l, i) => {
    const w = l[key];
    if (w === undefined)
      throw new CalcInputError(
        `leases.${i}.${key} is required when weight_by is ${input.weight_by}`,
      );
    const years = Math.max(
      0,
      daysBetween(input.as_of, l.expiration_date) / 365.25,
    );
    if (years === 0) expired++;
    weighted += w * years;
    total += w;
  });
  t.step("Total weight", round(total, 2), `Σ ${key}`);
  const result = t.step(
    "WALT",
    round(weighted / total, 4),
    `Σ(${key} × years remaining) ÷ Σ ${key}`,
    "years",
  );
  if (expired)
    t.warn(
      `${expired} lease(s) expired on or before ${input.as_of}; counted as 0 years remaining.`,
    );
  return t.result("calc.walt", 1, {
    walt_years: result,
    total_weight: round(total, 2),
    expired_count: expired,
  });
}
