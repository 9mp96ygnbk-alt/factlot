/**
 * Structural limits on tool arguments, checked before schema validation on every surface
 * (MCP, REST, the Python SDK's run_tool). Agents can send arbitrary JSON; these bounds keep a
 * single call from costing unbounded memory or CPU before the per-field caps in each input
 * schema apply. The Python SDK enforces the same numbers in the same order
 * (`factlot._core.input_shape_issue`), so both report the same error.
 */
export const INPUT_LIMITS = {
  /** Deepest nesting of objects and arrays; the arguments object itself is level 1. */
  maxDepth: 32,
  /** Values of any kind (objects, arrays, scalars) in one call's arguments. */
  maxNodes: 200_000,
  /** Items in any one array. Input schemas set lower caps where a field needs one. */
  maxArrayItems: 10_000,
  /** Characters in any one string (UTF-16 code units in TypeScript, code points in Python). */
  maxStringLength: 16 * 1024 * 1024,
  /** Validation issues returned with one error; the count of the rest is in the message. */
  maxIssues: 20,
} as const;

export interface ShapeLimits {
  maxDepth: number;
  maxNodes: number;
  maxArrayItems: number;
  maxStringLength: number;
}

export interface ShapeIssue {
  path: string;
  message: string;
}

/**
 * The first structural limit `value` breaks, or undefined. Iterative (no recursion), visits
 * object keys in sorted order and array items in order, and stops at the first problem.
 */
export function inputShapeIssue(
  value: unknown,
  limits: ShapeLimits = INPUT_LIMITS,
): ShapeIssue | undefined {
  const stack: [unknown, string, number][] = [[value, "", 1]];
  let nodes = 0;
  while (stack.length > 0) {
    const [v, path, depth] = stack.pop() as [unknown, string, number];
    nodes += 1;
    if (nodes > limits.maxNodes)
      return { path: "", message: `more than ${limits.maxNodes} values` };
    if (typeof v === "string") {
      if (v.length > limits.maxStringLength)
        return {
          path,
          message: `string longer than ${limits.maxStringLength} characters`,
        };
      continue;
    }
    if (typeof v !== "object" || v === null) continue;
    if (depth > limits.maxDepth)
      return { path, message: `nested deeper than ${limits.maxDepth} levels` };
    const join = (k: string | number): string =>
      path ? `${path}.${k}` : String(k);
    if (Array.isArray(v)) {
      if (v.length > limits.maxArrayItems)
        return { path, message: `more than ${limits.maxArrayItems} items` };
      for (let i = v.length - 1; i >= 0; i--)
        stack.push([v[i], join(i), depth + 1]);
      continue;
    }
    const keys = Object.keys(v).sort();
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i] as string;
      stack.push([(v as Record<string, unknown>)[k], join(k), depth + 1]);
    }
  }
  return undefined;
}

// --- unknown fields -------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

export interface UnknownField {
  path: string;
  message: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = cur;
    }
  }
  return row[b.length]!;
}

export function suggest(key: string, known: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const k of known) {
    const d = editDistance(key.toLowerCase(), k.toLowerCase());
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(key.length / 3))
    ? best
    : undefined;
}

/** Branches of a union (oneOf/anyOf) that can describe an object value. */
function objectBranches(schema: JsonSchema): JsonSchema[] {
  const union = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined;
  if (!union) return schema.properties ? [schema] : [];
  return union.flatMap(objectBranches);
}

/**
 * Fields in `value` that the tool's input schema does not define, with the nearest known name.
 * Validation would otherwise drop them silently, and a misspelled optional field
 * ("controlable", "abated_month") changes the answer without any sign.
 * Must match `unknown_fields` in python/src/factlot/tools.py.
 */
export function unknownFields(
  schema: JsonSchema,
  value: unknown,
  path = "",
): UnknownField[] {
  if (Array.isArray(value)) {
    const items = schema.items as JsonSchema | undefined;
    if (!items || typeof items !== "object") return [];
    return value.flatMap((v, i) =>
      unknownFields(items, v, path ? `${path}.${i}` : String(i)),
    );
  }
  if (!isPlainObject(value)) return [];
  const branches = objectBranches(schema);
  if (branches.length === 0) return [];
  // In a union, a field is unknown only if no branch defines it.
  const known = new Set<string>();
  let open = false;
  for (const b of branches) {
    for (const k of Object.keys(b.properties as JsonSchema)) known.add(k);
    if (
      b.additionalProperties !== undefined &&
      b.additionalProperties !== false
    )
      open = true;
  }
  const out: UnknownField[] = [];
  for (const [k, v] of Object.entries(value)) {
    const at = path ? `${path}.${k}` : k;
    if (!known.has(k)) {
      if (open) continue;
      const near = suggest(k, [...known]);
      out.push({
        path: at,
        message: `unknown field${near ? ` (did you mean "${near}"?)` : ""}; known fields here: ${[...known].join(", ")}`,
      });
      continue;
    }
    // A nested value is fine if any branch that defines the field accepts it; otherwise report
    // the branch with the fewest problems.
    let fewest: UnknownField[] | undefined;
    for (const b of branches) {
      const sub = (b.properties as Record<string, JsonSchema>)[k];
      if (!sub) continue;
      const found = unknownFields(sub, v, at);
      if (!fewest || found.length < fewest.length) fewest = found;
      if (found.length === 0) break;
    }
    if (fewest) out.push(...fewest);
  }
  return out;
}

// --- whole-number percents ----------------------------------------------------------------------

/** Rate fields: a decimal fraction (0.065 for 6.5%), including IRR hurdles (until_irr). */
const RATE_KEY = /^(?:rate|rate_annual|.+_rate|.+_rate_annual|until_irr)$/;
/** Share and ratio fields that are also decimal fractions (0.25 for 25%). */
const SHARE_KEY =
  /^(?:share|.+_share|ltv|.+_ltv|(?:.+_)?occupancy(?:_.+)?|(?:.+_)?debt_yield|.+_pct)$/;
/** A minimum DSCR is a coverage ratio (1.25 for 1.25x), not a decimal fraction. */
const DSCR_KEY = "min_dscr";
const DSCR_MAX = 10;

/** `pass` for a whole-number percent: 6.5 becomes 0.065. */
const asDecimal = (v: number): number => v / 100;

/**
 * One policy for whole-number percents, shared by every surface: a rate field (RATE_KEY) above
 * 1 in absolute value, or a min_dscr above 10, is a unit slip (8 for 8%, 130 for 1.3x), and the
 * tool rejects it instead of computing 800%. Returns the hint that names the likely value, or
 * undefined when the field is fine. Share and ratio fields (SHARE_KEY) are bounded by each
 * tool's schema; the hint is added when that bound rejects them (withRateHints).
 */
function unitSlip(
  key: string,
  v: number,
): { rejectMessage?: string; hint?: string } {
  if (RATE_KEY.test(key) && Math.abs(v) > 1) {
    const hint = `rates are decimals: pass ${asDecimal(v)} for ${v}%`;
    return {
      rejectMessage: `must be a decimal between -1 and 1 but is ${v} (${hint})`,
      hint: ` (${hint})`,
    };
  }
  if (key === DSCR_KEY && v > DSCR_MAX)
    return {
      rejectMessage: `must be at most ${DSCR_MAX} but is ${v} (DSCR is a ratio: pass ${asDecimal(v)} for ${asDecimal(v)}x coverage)`,
    };
  if (SHARE_KEY.test(key) && v > 1)
    return {
      hint: ` (shares and ratios are decimals: pass ${asDecimal(v)} for ${v}%)`,
    };
  return {};
}

/**
 * Tools the whole-number-percent rejection covers: every calculator, and lease_comp_validate
 * (its comp carries an escalation rate and it derives a net effective rent). A new calc_ tool
 * inherits the check. Other tools take free-form fact values and judge them themselves.
 * Must match `applies_unit_policy` in python/src/factlot/tools.py.
 */
export function appliesUnitPolicy(toolName: string): boolean {
  return toolName.startsWith("calc_") || toolName === "lease_comp_validate";
}

/**
 * Every rate field above 1 (or min_dscr above 10) anywhere in the arguments, as input issues.
 * Must match `unit_slip_issues` in python/src/factlot/tools.py.
 */
export function unitSlipIssues(
  value: unknown,
  path = "",
): { path: string; message: string }[] {
  if (Array.isArray(value))
    return value.flatMap((v, i) =>
      unitSlipIssues(v, path ? `${path}.${i}` : String(i)),
    );
  if (!isPlainObject(value)) return [];
  const out: { path: string; message: string }[] = [];
  for (const [k, v] of Object.entries(value)) {
    const at = path ? `${path}.${k}` : k;
    if (typeof v === "number") {
      const slip = unitSlip(k, v).rejectMessage;
      if (slip !== undefined) out.push({ path: at, message: slip });
    } else out.push(...unitSlipIssues(v, at));
  }
  return out;
}

/** The value at a dotted issue path ("escalation.rate", "leases.0.rate") in the raw arguments. */
function valueAt(args: unknown, path: string): unknown {
  let v: unknown = args;
  for (const part of path.split(".")) {
    if (Array.isArray(v)) v = v[Number(part)];
    else if (isPlainObject(v)) v = v[part];
    else return undefined;
  }
  return v;
}

/**
 * Adds a hint to issues on rate, share and ratio fields whose value is above 1: the usual cause
 * is a whole-number percent. Must match `rate_hints` in python/src/factlot/tools.py.
 */
export function withRateHints<T extends { path: string; message: string }>(
  args: unknown,
  issues: T[],
): T[] {
  return issues.map((i) => {
    const key = i.path.split(".").pop() ?? "";
    const v = valueAt(args, i.path);
    const hint = typeof v === "number" ? unitSlip(key, v).hint : undefined;
    return hint === undefined ? i : { ...i, message: i.message + hint };
  });
}
