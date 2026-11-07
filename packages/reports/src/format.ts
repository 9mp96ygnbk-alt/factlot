/**
 * How numbers, rates and dates are written in the documents. Every function writes the tool's
 * number exactly as returned (no rounding beyond the decimals the tool already rounded to), so a
 * reader can find each printed figure in the tool result.
 */

/** Decimal places a number has as written by JSON (0.1554 → 4, 1e-7 → 7). */
export function decimalsOf(x: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return 0;
  const s = String(Math.abs(x));
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(s);
  if (!m) return 0;
  const frac = (m[2] ?? "").length;
  const exp = Number(m[3] ?? 0);
  return Math.max(0, frac - exp);
}

/**
 * Text with control characters (C0 but tab, line feed and carriage return; DEL; C1) and the
 * bidirectional embedding, override and isolate controls (U+202A–U+202E, U+2066–U+2069)
 * removed, so supplied text cannot hide or reorder what a document shows.
 */
/* eslint-disable no-control-regex */
export function stripControls(s: string): string {
  return s.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
}
/* eslint-enable no-control-regex */

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Exact decimal text of x (no exponent), as JSON wrote it. */
export function plain(x: number): string {
  const s = String(Math.abs(x));
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  let out = s;
  if (m) {
    const digits = `${m[1]}${m[2] ?? ""}`;
    const point = (m[1] ?? "").length + Number(m[3]);
    out =
      point <= 0
        ? `0.${"0".repeat(-point)}${digits}`
        : point >= digits.length
          ? digits + "0".repeat(point - digits.length)
          : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return (x < 0 ? "-" : "") + out;
}

/** 1234567.5 → "1,234,567.50"; at least `minDp` decimals, more when the tool returned more. */
export function num(x: number, minDp = 0): string {
  const p = plain(x);
  const neg = p.startsWith("-");
  const [int = "0", frac = ""] = (neg ? p.slice(1) : p).split(".");
  const f = frac.padEnd(minDp, "0");
  return `${neg ? "-" : ""}${group(int)}${f ? `.${f}` : ""}`;
}

/** USD: "$1,234,567.50", "-$45,000.00". */
export function usd(x: number): string {
  const s = num(x, 2);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

/** A decimal rate as a percentage, exactly: 0.1554 → "15.54%", 0.07388606 → "7.388606%". */
export function pct(x: number): string {
  const p = plain(x);
  const neg = p.startsWith("-");
  const [int = "0", frac = ""] = (neg ? p.slice(1) : p).split(".");
  const digits = int + frac.padEnd(2, "0");
  const point = int.length + 2;
  let whole = digits.slice(0, point).replace(/^0+(?=\d)/, "");
  const rest = digits.slice(point).replace(/0+$/, "");
  if (whole === "") whole = "0";
  return `${neg ? "-" : ""}${group(whole)}${rest ? `.${rest}` : ""}%`;
}

/** A plain number with grouping (areas, counts). */
export function int(x: number): string {
  return num(x);
}

/** A ratio such as a DSCR: "1.25x". */
export function times(x: number): string {
  return `${num(x)}x`;
}

/** "2026-11-07 12:00:00 UTC". */
export function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}

/** Text for any JSON value in a table cell (objects as "key: value; ..."). */
export function jsonText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(jsonText).join("\n");
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k.replace(/_/g, " ")}: ${jsonText(x)}`)
    .join("; ");
}

/** "tx_unequal_appraisal" → "tx-unequal-appraisal"; free text → a short file-safe slug. */
export function slug(s: string, max = 40): string {
  return s
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}
