/**
 * iCalendar (RFC 5545) text: all-day events with optional display alarms. Lines end in CRLF and
 * are folded at 75 octets (never inside a UTF-8 sequence); TEXT values escape backslash,
 * semicolon, comma and newlines; control characters and bidirectional controls are removed.
 */
import { stripControls } from "./format.ts";

export interface IcsAlarm {
  /** Days before the event's start. */
  daysBefore: number;
  description: string;
}

export interface IcsEvent {
  uid: string;
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day (inclusive), YYYY-MM-DD; the start day when omitted. */
  end?: string;
  summary: string;
  description?: string;
  categories?: string[];
  alarms?: IcsAlarm[];
}

export interface IcsCalendar {
  prodId: string;
  name: string;
  description?: string;
  /** UTC time stamped on every event (DTSTAMP). */
  stamp: Date;
  events: IcsEvent[];
}

export function escapeText(s: string): string {
  return stripControls(s)
    .replace(/\t/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold one content line to 75 octets per physical line (RFC 5545 §3.1). */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let octets = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (octets + n > limit) {
      out.push(cur);
      cur = "";
      octets = 0;
    }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const day = (iso: string) => iso.replace(/-/g, "");

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function stampText(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

export function calendar(cal: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${cal.prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(cal.name)}`,
  ];
  if (cal.description)
    lines.push(`X-WR-CALDESC:${escapeText(cal.description)}`);
  const stamp = stampText(cal.stamp);
  for (const e of cal.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(e.start)}`,
      `DTEND;VALUE=DATE:${day(nextDay(e.end ?? e.start))}`,
      `SUMMARY:${escapeText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.categories?.length)
      lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
    lines.push("TRANSP:TRANSPARENT");
    for (const a of e.alarms ?? [])
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `TRIGGER;RELATED=START:-P${a.daysBefore}D`,
        `DESCRIPTION:${escapeText(a.description)}`,
        "END:VALARM",
      );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
