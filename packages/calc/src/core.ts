import { z } from "zod";

/** One line of a calculation's audit trail. */
export interface Step {
  label: string;
  value: number | string;
  /** Human-readable formula, with inputs substituted where practical. */
  formula?: string;
  unit?: string;
}

/**
 * Every calculator returns the answer *and* how it was reached, so an agent can
 * cite the method and a human can check it without re-deriving anything.
 */
export interface CalcResult<T> {
  value: T;
  /** Stable formula identity. A version bump means results may differ for the same input. */
  formula: { id: string; version: number };
  steps: Step[];
  /** Assumptions the caller should surface to a human. */
  warnings: string[];
}

export class CalcInputError extends Error {
  override name = "CalcInputError";
  readonly issues: { path: string; message: string }[];

  constructor(
    message: string,
    issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.issues = issues;
  }
}

export class Trace {
  readonly steps: Step[] = [];
  readonly warnings: string[] = [];

  /** Record a step and return its value, so traces read inline with the math. */
  step<V extends number | string>(
    label: string,
    value: V,
    formula?: string,
    unit?: string,
  ): V {
    const s: Step = { label, value };
    if (formula !== undefined) s.formula = formula;
    if (unit !== undefined) s.unit = unit;
    this.steps.push(s);
    return value;
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  result<T>(id: string, version: number, value: T): CalcResult<T> {
    return {
      value,
      formula: { id, version },
      steps: this.steps,
      warnings: this.warnings,
    };
  }
}

/**
 * Round half away from zero to `dp` decimals, using decimal-string shifting so that
 * values like 1.005 round as a human expects (1.01), not as binary floats do (1.00).
 */
export function round(x: number, dp = 2): number {
  if (!Number.isFinite(x))
    throw new CalcInputError(`cannot round non-finite value ${x}`);
  const sign = x < 0 ? -1 : 1;
  const abs = String(Math.abs(x));
  // Exponent-shifting only works on plain decimal strings; tiny/huge values use plain math.
  const shifted = abs.includes("e")
    ? Math.round(Math.abs(x) * 10 ** dp)
    : Math.round(Number(`${abs}e${dp}`));
  return sign * Number(`${shifted}e-${dp}`) || 0;
}

/** Parse input with a zod schema, converting failures into a CalcInputError agents can act on. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  throw new CalcInputError(
    `invalid input: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`,
    issues,
  );
}

export const IsoDate = z.iso.date();
export const Money = z.number().finite();
export const NonNegMoney = z.number().finite().nonnegative();
export const Rate = z.number().finite().gt(-1).lt(10);
export const Share = z.number().gt(0).lte(1);

export function fmtMoney(x: number): string {
  return `$${round(x, 2).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(x: number, dp = 2): string {
  return `${round(x * 100, dp)}%`;
}
