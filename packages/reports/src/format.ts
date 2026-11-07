/**
 * How numbers, rates and dates are written in the documents. One convention everywhere, PDF and
 * workbook alike:
 *
 * - money to the cent, the sign before the dollar sign: "-$25,000.00";
 * - rates as percentages to two decimals ("6.25%"), or four where a field is a fine rate (a
 *   periodic discount rate); ratios such as a DSCR to two decimals ("1.25x");
 * - audit-trail values and other plain numbers to 6 significant digits (whole numbers whole),
 *   with a note that the full precision is in the tool result;
 * - years, periods, months and counts without digit grouping ("2026", not "2,026").
 *
 * A workbook cell keeps the tool's full number; only its number format follows the convention.
 */
import { round } from "@factlot/calc";

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

/** x rounded (half away from zero) to exactly `dp` decimals, grouped; never "-0.00". */
export function fixed(x: number, dp: number): string {
  const s = num(round(x, dp), dp);
  return /^-[0.,]*$/.test(s) ? s.slice(1) : s;
}

/** USD to the cent: "$1,234,567.50", "-$45,000.00". */
export function usd(x: number): string {
  const s = fixed(x, 2);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

/** A decimal rate as a percentage to `dp` decimals: 0.1554 → "15.54%", 0.07388606 → "7.39%". */
export function pct(x: number, dp = 2): string {
  return `${fixed(round(x * 100, dp + 4), dp)}%`;
}

/**
 * A plain number to `digits` significant digits (whole numbers whole, grouped):
 * 0.07388606405116722 → "0.0738861", 23874596.957531843 → "23,874,597", 1.03 → "1.03".
 */
export function sig(x: number, digits = 6): string {
  if (!Number.isFinite(x) || Number.isInteger(x)) return num(x);
  const a = Math.abs(x);
  const dp =
    a >= 1
      ? Math.max(0, digits - String(Math.floor(a)).length)
      : Math.min(12, digits - 1 - Math.floor(Math.log10(a)));
  const s = num(round(x, dp));
  return /^-[0.,]*$/.test(s) ? s.slice(1) : s;
}

/** True when sig() shows fewer digits than the number has. */
export function isRounded(x: number, digits = 6): boolean {
  return sig(x, digits).replace(/,/g, "") !== plain(x);
}

/** Argument names whose whole-number values are years, periods, months or counts. */
const UNGROUPED =
  /(?:^|[._\]])(?:year|years|tax_year|fiscal_year|base_year|period|periods|month|months|term_months|hold_years|count|option|index|day|days|number|rank|page|document|sequence)$|_(?:year|years|months|days|count|periods|number)$|^(?:count|n)_/;

/** True for a field whose integer value is printed without digit grouping ("2026"). */
export function ungrouped(name: string): boolean {
  return UNGROUPED.test(name.replace(/\[\d+\]$/, ""));
}

/** A plain number with grouping (areas, counts). */
export function int(x: number): string {
  return num(x);
}

/** A ratio such as a DSCR, to two decimals: "1.25x". */
export function times(x: number): string {
  return `${fixed(x, 2)}x`;
}

/** Money amounts written inside a tool's text ("$-25,000.00") with the sign first ("-$25,000.00"). */
export function moneySign(s: string): string {
  return s.replace(/\$-(?=\d)/g, "-$");
}

/** Long decimals inside a tool's text rounded to 6 significant digits. */
export function roundInText(s: string): string {
  return moneySign(s).replace(/-?\d[\d,]*\.\d{7,}/g, (m) =>
    sig(Number(m.replace(/,/g, ""))),
  );
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
  if (typeof v === "number") return sig(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(jsonText).join("\n");
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k.replace(/_/g, " ")}: ${jsonText(x)}`)
    .join("; ");
}

/**
 * "tx_unequal_appraisal" → "tx-unequal-appraisal"; free text → a short file-safe slug, cut at a
 * word boundary (a single word longer than `max` is cut).
 */
export function slug(s: string, max = 40): string {
  const full = s
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (full.length <= max) return full;
  const cut = full.slice(0, max + 1);
  const at = cut.lastIndexOf("-");
  return (at > 0 ? cut.slice(0, at) : full.slice(0, max)).replace(/-+$/g, "");
}
