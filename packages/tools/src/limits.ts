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
