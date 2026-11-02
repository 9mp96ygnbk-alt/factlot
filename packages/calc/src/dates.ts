/** Calendar arithmetic on ISO `YYYY-MM-DD` dates, in UTC, with no time-of-day. */

const MS_PER_DAY = 86_400_000;

function toUtc(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`expected YYYY-MM-DD, got "${iso}"`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== iso)
    throw new RangeError(`invalid date "${iso}"`);
  return d;
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Add calendar months, clamping to month end: 2026-01-31 + 1 month = 2026-02-28.
 * Day-of-month is always taken from `iso`, so repeated calls from a fixed anchor never drift.
 */
export function addMonths(iso: string, months: number): string {
  const d = toUtc(iso);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month0 = total - year * 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(year, month0));
  return fromUtc(new Date(Date.UTC(year, month0, day)));
}

export function addDays(iso: string, days: number): string {
  return fromUtc(new Date(toUtc(iso).getTime() + days * MS_PER_DAY));
}

/** Whole days from `a` to `b` (negative if `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / MS_PER_DAY);
}
