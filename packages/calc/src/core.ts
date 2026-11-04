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
 * b^n for integer n by exponentiation by squaring. Uses only IEEE-754 multiplication and
 * division, which are correctly rounded in every language, so results are bit-identical
 * across SDKs and platforms (unlike libm/V8 \`pow\`, which may differ in the last place).
 */
export function powInt(base: number, n: number): number {
  if (!Number.isInteger(n))
    throw new CalcInputError(`powInt requires an integer exponent, got ${n}`);
  if (n < 0) return 1 / powInt(base, -n);
  let result = 1;
  let x = base;
  let e = n;
  while (e > 0) {
    if (e % 2 === 1) result *= x;
    x *= x;
    e = Math.floor(e / 2);
  }
  return result;
}

/**
 * The positive n-th root of c > 0 by Newton's method, using only IEEE-754 +, −, ×, ÷ and
 * `powInt`, so every SDK lands on the same bits. Iteration starts at or above the root and
 * stops at the first step that fails to decrease, which is the floating-point fixed point.
 */
export function nthRoot(c: number, n: number): number {
  if (!(c > 0) || !Number.isInteger(n) || n < 1)
    throw new CalcInputError(
      `nthRoot requires c > 0 and integer n ≥ 1, got ${c}, ${n}`,
    );
  let x = c >= 1 ? c : 1;
  for (let i = 0; i < 200; i++) {
    const next = x - (powInt(x, n) - c) / (n * powInt(x, n - 1));
    if (!(next < x)) break;
    x = next;
  }
  return x;
}

/** Significant digits kept before rounding, as spreadsheets do, to strip binary noise. */
export const ROUNDING_SIGNIFICANT_DIGITS = 15;

/**
 * Reduce x to 15 significant digits (ties away from zero), identically in every SDK. Use it
 * before a floor or comparison so binary noise does not decide the result:
 * 0.57 × 10,000,000 = 5699999.999999999 → 5700000.
 */
export function reduceNoise(x: number): number {
  if (!Number.isFinite(x))
    throw new CalcInputError(`cannot reduce non-finite value ${x}`);
  return Number(x.toPrecision(ROUNDING_SIGNIFICANT_DIGITS));
}

/** Expand a JS exponent-form number string ("1.5e-7", "2e+21") to plain decimal. */
function toPlainDecimal(s: string): string {
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = `${m[1]}${m[2] ?? ""}`;
  const point = (m[1] ?? "").length + Number(m[3]);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Add one to a non-negative integer held as a digit string. */
function incrementDigits(d: string): string {
  const out = d.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== "9") {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
    out[i] = "0";
  }
  return `1${out.join("")}`;
}

/**
 * Round the way a person with a spreadsheet expects, identically in every FactLot SDK:
 *
 * 1. reduce |x| to 15 significant digits (correctly rounded, ties up), which removes
 *    binary floating-point noise: 95.58 × 245051 ÷ 12 = 1951831.2149999999 → 1951831.21500000;
 * 2. round that decimal half away from zero to `dp` places: → 1951831.22.
 */
export function round(x: number, dp = 2): number {
  if (!Number.isFinite(x))
    throw new CalcInputError(`cannot round non-finite value ${x}`);
  const negative = x < 0;
  const plain = toPlainDecimal(
    Math.abs(x).toPrecision(ROUNDING_SIGNIFICANT_DIGITS),
  );
  const [int = "0", frac = ""] = plain.split(".");
  let result: number;
  if (frac.length <= dp) {
    result = Number(plain);
  } else {
    let digits = int + frac.slice(0, dp);
    if ((frac[dp] ?? "0") >= "5") digits = incrementDigits(digits);
    result =
      dp > 0
        ? Number(`${digits.slice(0, -dp) || "0"}.${digits.slice(-dp)}`)
        : Number(digits);
  }
  return negative && result !== 0 ? -result : result;
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

export const IsoDate = z.iso.date({
  message: "expected a valid YYYY-MM-DD date",
});
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

/**
 * A number written into a step's formula text: rounded with `round` to at most `dp` decimal
 * places (6 by default), so an input such as 0.07310737913780618 reads 0.073107. Only the text is
 * rounded; step values and results never are (`fmt_num` in Python writes the same text).
 */
export function fmtNum(x: number, dp = 6): string {
  return String(round(x, dp));
}
