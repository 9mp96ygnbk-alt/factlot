/**
 * Text the caller supplies (a title, a prepared-for line, citation locators, comparable ids,
 * adjustment labels and reasons) is printed as theirs, never as FactLot's. A report states
 * arithmetic only, so caller text that reads as advice or a valuation is refused: the document
 * would otherwise carry it under FactLot's name. Names that merely contain such a word (Fort
 * Worth, an appraisal district, the appraisal review board) are not advice and pass.
 */
import { ReportInputError, type Issue, type ReportKind } from "./validate.ts";

/** Caps on caller text, in characters. */
export const TEXT_LIMITS = {
  title: 120,
  prepared_for: 120,
  reason: 200,
  locator: 200,
} as const;

const ADVICE =
  /\b(recommend\w*|should|protest\w*|worth\w*|appraisals?|opinion of value|market value is|sav(?:e[sd]?|ing|ings))\b/i;
/** Proper names that contain one of the words above; removed before the test. */
const NAMES =
  /\b(fort worth|appraisal districts?|appraisal review boards?)\b/gi;

/** The advice or valuation wording in `s`, if any. */
export function adviceIn(s: string): string | undefined {
  return ADVICE.exec(s.replace(NAMES, " "))?.[1];
}

type Field = { path: string; text: string; max?: number };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined =>
  typeof x === "string" ? x : undefined;

/** The caller's free text in a tx_unequal_appraisal request's arguments. */
function txArgFields(args: unknown): Field[] {
  if (!isObj(args)) return [];
  const out: Field[] = [];
  const subject = isObj(args.subject) ? args.subject : undefined;
  const sid = str(subject?.id);
  if (sid !== undefined) out.push({ path: "arguments.subject.id", text: sid });
  const cites = (c: unknown, at: string) => {
    const loc = isObj(c) ? str(c.locator) : undefined;
    if (loc !== undefined)
      out.push({
        path: `${at}.locator`,
        text: loc,
        max: TEXT_LIMITS.locator,
      });
  };
  cites(subject?.citation, "arguments.subject.citation");
  const comps = Array.isArray(args.comparables) ? args.comparables : [];
  comps.forEach((c, i) => {
    if (!isObj(c)) return;
    const at = `arguments.comparables.${i}`;
    const id = str(c.id);
    if (id !== undefined) out.push({ path: `${at}.id`, text: id });
    cites(c.citation, `${at}.citation`);
    const adj = Array.isArray(c.adjustments) ? c.adjustments : [];
    adj.forEach((a, j) => {
      if (!isObj(a)) return;
      const label = str(a.label);
      if (label !== undefined)
        out.push({ path: `${at}.adjustments.${j}.label`, text: label });
      const reason = str(a.reason);
      if (reason !== undefined)
        out.push({
          path: `${at}.adjustments.${j}.reason`,
          text: reason,
          max: TEXT_LIMITS.reason,
        });
    });
  });
  return out;
}

interface CitationLike {
  locator?: string | undefined;
}
interface ContextLike {
  title?: string | undefined;
  prepared_for?: string | undefined;
  subject_citation?: CitationLike | undefined;
  comparable_citations?: Record<string, CitationLike> | undefined;
}

/**
 * Refuse caller text over its cap (InputError) or with advice or valuation wording
 * (TextNotAllowed, naming the field). Lengths of title and prepared_for are capped by the
 * request schema; this checks the rest.
 */
export function checkCallerText(
  kind: ReportKind,
  ctx: ContextLike,
  args: unknown,
): void {
  const fields: Field[] = [];
  if (ctx.title !== undefined)
    fields.push({ path: "context.title", text: ctx.title });
  if (ctx.prepared_for !== undefined)
    fields.push({ path: "context.prepared_for", text: ctx.prepared_for });
  if (ctx.subject_citation?.locator !== undefined)
    fields.push({
      path: "context.subject_citation.locator",
      text: ctx.subject_citation.locator,
    });
  for (const [id, c] of Object.entries(ctx.comparable_citations ?? {})) {
    fields.push({ path: `context.comparable_citations.${id}`, text: id });
    if (c.locator !== undefined)
      fields.push({
        path: `context.comparable_citations.${id}.locator`,
        text: c.locator,
      });
  }
  if (kind === "tx_unequal_appraisal") fields.push(...txArgFields(args));

  const long: Issue[] = fields
    .filter((f) => f.max !== undefined && f.text.length > f.max)
    .map((f) => ({
      path: f.path,
      message: `at most ${f.max} characters (${f.text.length} sent)`,
    }));
  if (long.length)
    throw new ReportInputError(
      "InputError",
      `caller text over its length limit: ${long[0]!.path}`,
      long.slice(0, 20),
    );
  const advice: Issue[] = [];
  for (const f of fields) {
    const word = adviceIn(f.text);
    if (word)
      advice.push({
        path: f.path,
        message: `contains "${word}": caller text in a report may not give advice or a value`,
      });
  }
  if (advice.length)
    throw new ReportInputError(
      "TextNotAllowed",
      `${advice[0]!.path} reads as advice or a valuation (${advice[0]!.message.split(":")[0]}); a FactLot report states arithmetic only. Remove the wording and retry.`,
      advice.slice(0, 20),
    );
}
