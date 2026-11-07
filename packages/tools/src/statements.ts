/**
 * doc_spread_statement: the caller's agent proposes the line items of an operating statement
 * (T-12, budget, rent roll summary); FactLot checks each amount and label against its quote,
 * maps the label to the published chart of accounts (vocabularies.ts), and checks that the
 * statement's own subtotals and totals foot. python/src/factlot/statements.py is the same code;
 * spec/vectors/documents.json pins both. No model runs here.
 */
import { round } from "@factlot/calc";
import { z } from "zod";

import {
  DOC_LIMITS,
  DocumentInput,
  ToolInputError,
  capCharacters,
  characters,
  describeDocument,
  loadDocument,
} from "./documents.ts";
import type { Doc, Json } from "./documents.ts";
import { suggest } from "./limits.ts";
import {
  MIN_QUOTE_CHARS,
  NUMBER_TOKEN,
  decimalKey,
  locateQuote,
  missing,
  norm,
  showValue,
} from "./quotes.ts";
import { CHARTS, CHART_VERSION } from "./vocabularies.ts";
import type { Chart, ChartCategory, ChartTotal } from "./vocabularies.ts";
import { KeywordIndex, words } from "./words.ts";

export const STATEMENT_LINES = 1_000;

const Line = z.object({
  label: z
    .string()
    .min(1)
    .max(300)
    .describe(
      'The line\'s label exactly as the statement writes it, e.g. "Real Estate Taxes". It must appear in the quote.',
    ),
  amount: z
    .number()
    .describe(
      'The amount as a plain number (245000, not "$245K"). Write a deduction as the statement shows it; vacancy, concessions and other contra lines are always subtracted.',
    ),
  quote: z
    .string()
    .max(DOC_LIMITS.quoteCharacters)
    .describe(
      'Verbatim text from the page with the label and the amount, e.g. "Real Estate Taxes 245,000". A row shorter than 12 characters ("R&M 310,411") is accepted where it appears on the page as whole words.',
    ),
  page: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .describe("1-based page the quote is on."),
  category: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Your proposed category from the chart for property_type (spec/schemas/vocabularies/chart-of-accounts.json), e.g. real_estate_taxes, or a total such as net_operating_income for a total line. Without it, FactLot maps the label itself.",
    ),
  period: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Period column the amount is from, e.g. "T-12 Sep 2026" or "2025". Lines are spread per period. Default: the statement\'s period.',
    ),
  sums: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(STATEMENT_LINES - 1),
    )
    .min(1)
    .max(STATEMENT_LINES)
    .optional()
    .describe(
      'For a subtotal the statement prints ("Total Utilities"): the indexes (0-based) of the lines it adds up. FactLot checks that it foots.',
    ),
});
type LineIn = z.output<typeof Line>;

export const SpreadStatementInput = z.object({
  document: DocumentInput.describe("The statement's pages."),
  property_type: z
    .enum(["multifamily", "commercial", "hotel"])
    .describe(
      "Which chart of accounts to use: multifamily, commercial (office, retail, industrial), or hotel (USALI summary).",
    ),
  statement_type: z
    .enum([
      "t12",
      "operating_statement",
      "budget",
      "rent_roll_summary",
      "other",
    ])
    .optional()
    .describe("What the document is; echoed back."),
  period: z
    .string()
    .max(100)
    .optional()
    .describe("Default period label for lines that give none."),
  lines: z
    .array(Line)
    .min(1)
    .max(STATEMENT_LINES)
    .describe(
      "The statement's lines as you read them: every income, expense and capital line, the statement's own subtotals (with sums) and totals (with a total category), and statistics such as units or occupancy.",
    ),
  tolerance: z
    .number()
    .min(0)
    .max(1_000_000_000)
    .optional()
    .describe(
      "Largest difference, in the statement's units, at which a subtotal or total still foots. Default: 0.5 for each line added (rounding).",
    ),
});

// --- the chart --------------------------------------------------------------------------------

interface Prepared {
  chart: Chart;
  categories: Map<string, ChartCategory>;
  totals: Map<string, ChartTotal>;
  index: KeywordIndex;
}
const prepared = new Map<string, Prepared>();
function prepare(type: string): Prepared {
  let p = prepared.get(type);
  if (!p) {
    const chart = CHARTS[type]!;
    p = {
      chart,
      categories: new Map(chart.categories.map((c) => [c.id, c])),
      totals: new Map(chart.totals.map((t) => [t.id, t])),
      index: new KeywordIndex([
        ...chart.categories.map((c) => ({ key: c.id, keywords: c.keywords })),
        ...chart.totals.map((t) => ({ key: t.id, keywords: t.keywords })),
      ]),
    };
    prepared.set(type, p);
  }
  return p;
}

/** The categories (or totals) the label's longest keyword matches, in order of appearance. */
function dictionary(p: Prepared, label: string): string[] {
  const found = p.index.find(words(label));
  const longest = Math.max(0, ...found.map((m) => m.end - m.start));
  const out: string[] = [];
  for (const m of found)
    if (m.end - m.start === longest && !out.includes(m.key)) out.push(m.key);
  return out;
}

// --- signs --------------------------------------------------------------------------------------

const NEGATIVE_BEFORE = /(\( *\$? *|-\$?|\$-)$/;

/** True when every place the quote writes the amount, it writes it as negative: (1,200), -1,200, -$1,200. */
function writtenNegative(q: string, amount: number): boolean {
  const wanted = decimalKey(String(Math.abs(amount)));
  let seen = false;
  for (const m of q.matchAll(NUMBER_TOKEN)) {
    if (decimalKey(m[1]!.replaceAll(",", "").replace(/\.+$/, "")) !== wanted)
      continue;
    seen = true;
    if (!NEGATIVE_BEFORE.test(q.slice(0, m.index))) return false;
  }
  return seen;
}

// --- spreading ----------------------------------------------------------------------------------

interface Checked {
  index: number;
  line: LineIn;
  period: string;
  kind: "line" | "total" | "subtotal" | "memo" | "excluded";
  category?: ChartCategory;
  total?: ChartTotal;
  /** Signed amount as spread (a line) or as stated (a total or subtotal). */
  signed?: number;
  citation?: Json;
  reason?: string;
}

function cite(doc: Doc, page: number, q: string, line: LineIn): Json {
  // A short quote is located where it stands as whole words (locateQuote).
  const span = doc.text.span(page, q, [...q].length < MIN_QUOTE_CHARS);
  return {
    document_id: doc.id,
    ...(doc.title !== undefined ? { title: doc.title } : {}),
    page,
    quote: line.quote,
    ...(doc.ocr.has(page) ? { ocr: true } : {}),
    ...(span ? { span } : {}),
  };
}

export function spreadStatement(
  input: z.output<typeof SpreadStatementInput>,
): Json {
  capCharacters(characters(input.document.pages));
  const doc = loadDocument(input.document);
  const p = prepare(input.property_type);
  const exceptions: Json[] = [];
  const flag = (
    kind: string,
    message: string,
    at: { line?: number; period?: string | null },
    extra: Json = {},
  ): void => {
    exceptions.push({ ...at, kind, message, ...extra });
  };
  const lines = input.lines;
  const periodOf = (l: LineIn): string => l.period ?? input.period ?? "";
  const issues: { path: string; message: string }[] = [];
  lines.forEach((l, i) =>
    (l.sums ?? []).forEach((j, k) => {
      if (j >= lines.length || j === i)
        issues.push({
          path: `lines.${i}.sums.${k}`,
          message:
            j === i
              ? "a subtotal cannot add up itself"
              : `there is no line ${j}`,
        });
    }),
  );
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  // 1. Each line: the quote, the amount and the label, then its category.
  const checked: Checked[] = lines.map((line, i): Checked => {
    const base = { index: i, line, period: periodOf(line) };
    const at = { line: i };
    const loc = locateQuote(doc.text, line.quote, line.page, {
      shortWholeWords: true,
    });
    if (!loc.ok) {
      flag("quote", loc.reason, at);
      return { ...base, kind: "excluded", reason: loc.reason };
    }
    const q = loc.q;
    let category: ChartCategory | undefined;
    let total: ChartTotal | undefined;
    if (!line.sums) {
      const candidates = dictionary(p, line.label);
      if (line.category !== undefined) {
        category = p.categories.get(line.category);
        total = p.totals.get(line.category);
        if (!category && !total) {
          const near = suggest(line.category, [
            ...p.categories.keys(),
            ...p.totals.keys(),
          ]);
          flag(
            "unknown_category",
            `"${line.category}" is not in the ${input.property_type} chart${near ? ` (did you mean "${near}"?)` : ""}; the label was mapped instead`,
            at,
          );
        } else if (candidates.length && !candidates.includes(line.category))
          flag(
            "category_review",
            `the label maps to ${candidates.join(" or ")} in the chart, not ${line.category}; ${line.category} was used, review it`,
            at,
            { dictionary: candidates },
          );
      }
      if (!category && !total) {
        if (candidates.length !== 1) {
          const reason =
            candidates.length === 0
              ? "the label matches no category in the chart; give a category"
              : `the label could be ${candidates.join(" or ")}; give a category`;
          flag("unmapped", reason, at, {
            ...(candidates.length ? { dictionary: candidates } : {}),
          });
          return { ...base, kind: "excluded", reason };
        }
        category = p.categories.get(candidates[0]!);
        total = p.totals.get(candidates[0]!);
      }
    }
    const kindOfAmount = category?.ratio ? "ratio" : "number";
    if (missing(kindOfAmount, Math.abs(line.amount), q)) {
      const reason = `amount ${showValue(Math.abs(line.amount))} not found in quote`;
      flag("amount", reason, at);
      return { ...base, kind: "excluded", reason };
    }
    const label = norm(line.label);
    if (!q.includes(label)) {
      const reason = `label ${showValue(line.label)} not found in quote`;
      flag("label", reason, at);
      return { ...base, kind: "excluded", reason };
    }
    const citation = cite(doc, loc.page, q, line);
    if (loc.corrected)
      citation.note = `quote found on page ${loc.page}, not ${line.page}`;
    const negative = line.amount < 0 || writtenNegative(q, line.amount);
    const stated = negative ? -Math.abs(line.amount) : Math.abs(line.amount);
    if (line.sums)
      return { ...base, kind: "subtotal", signed: stated, citation };
    if (total)
      return { ...base, kind: "total", total, signed: stated, citation };
    const cat = category!;
    if (cat.section === "memo")
      return {
        ...base,
        kind: "memo",
        category: cat,
        signed: line.amount,
        citation,
      };
    let signed = stated;
    if (cat.contra) signed = -Math.abs(line.amount);
    else if (line.amount > 0 && negative)
      flag(
        "sign",
        `the quote writes ${showValue(line.amount)} as negative; it is spread as ${showValue(signed)}`,
        at,
      );
    else if (line.amount < 0 && !writtenNegative(q, line.amount))
      flag(
        "sign",
        `the amount is negative but the quote does not write it as negative (parentheses or a minus sign); check the sign`,
        at,
      );
    const first = words(line.label)[0];
    if (first === "total" || first === "subtotal")
      flag(
        "possible_subtotal",
        `"${line.label}" reads as a subtotal but is spread as a ${cat.id} line; if its parts are listed too, give it sums so it is not counted twice`,
        at,
      );
    return { ...base, kind: "line", category: cat, signed, citation };
  });

  // 2. Per period: sections, totals, the statement's own totals and subtotals.
  const periodKeys: string[] = [];
  for (const c of checked)
    if (!periodKeys.includes(c.period)) periodKeys.push(c.period);
  let allFoot = true;
  const periods = periodKeys.map((key) => {
    const label = key === "" ? null : key;
    const atOf = (line: number): { line: number; period?: string } => ({
      line,
      ...(label !== null ? { period: label } : {}),
    });
    const inPeriod = checked.filter((c) => c.period === key);
    // Lines left out of this period's spread: a total that does not foot names them.
    const left = inPeriod.filter((c) => c.kind === "excluded");
    const leftOut = left.length
      ? `; ${left.length === 1 ? "line" : "lines"} left out of the spread in this period: ${left
          .slice(0, 5)
          .map(
            (c) => `${c.index} (${c.line.label}, ${showValue(c.line.amount)})`,
          )
          .join(", ")}${left.length > 5 ? ` and ${left.length - 5} more` : ""}`
      : "";
    const sectionAmount = new Map<string, number>();
    const sectionLines = new Map<string, number>();
    const sections = p.chart.sections
      .filter((s) => s.id !== "memo")
      .map((s) => {
        const ls = inPeriod.filter(
          (c) => c.kind === "line" && c.category!.section === s.id,
        );
        let sum = 0;
        for (const c of ls) sum += c.signed!;
        const amount = round(sum);
        sectionAmount.set(s.id, amount);
        sectionLines.set(s.id, ls.length);
        return {
          id: s.id,
          label: s.label,
          amount,
          lines: ls.map((c) => c.index),
        };
      });
    const totalAmount = new Map<string, number>();
    const totalLines = new Map<string, number>();
    const totals = p.chart.totals.map((t) => {
      let sum = 0;
      let n = 0;
      for (const ref of t.sum) {
        const neg = ref.startsWith("-");
        const id = neg ? ref.slice(1) : ref;
        const v = sectionAmount.get(id) ?? totalAmount.get(id) ?? 0;
        sum += neg ? -v : v;
        n += sectionLines.get(id) ?? totalLines.get(id) ?? 0;
      }
      const amount = round(sum);
      totalAmount.set(t.id, amount);
      totalLines.set(t.id, n);
      const stated = inPeriod
        .filter((c) => c.kind === "total" && c.total!.id === t.id)
        .map((c) => {
          const tolerance = input.tolerance ?? 0.5 * n;
          const difference = round(c.signed! - amount);
          const foots = Math.abs(difference) <= tolerance;
          if (!foots) {
            allFoot = false;
            flag(
              "does_not_foot",
              `${c.line.label} is ${showValue(c.signed)} on the statement; the lines spread here give ${showValue(amount)} (difference ${showValue(difference)}, tolerance ${showValue(tolerance)})${leftOut}`,
              atOf(c.index),
            );
          }
          return {
            line: c.index,
            amount: c.signed,
            difference,
            tolerance,
            foots,
          };
        });
      return {
        id: t.id,
        label: t.label,
        amount,
        ...(stated.length ? { stated } : {}),
      };
    });
    const subtotals = inPeriod
      .filter((c) => c.kind === "subtotal")
      .map((c) => {
        const parts = c.line.sums!;
        let sum = 0;
        let n = 0;
        let usable = true;
        for (const j of parts) {
          const part = checked[j]!;
          if (
            part.period !== key ||
            !["line", "excluded"].includes(part.kind)
          ) {
            usable = false;
            flag(
              "sums",
              `line ${j} is ${part.period !== key ? "in another period" : `a ${part.kind}`}; a subtotal adds up lines of its own period`,
              atOf(c.index),
            );
            continue;
          }
          if (part.kind === "excluded") {
            flag(
              "subtotal_part_excluded",
              `line ${j} is not in the spread (${part.reason}); the subtotal is checked without it`,
              atOf(c.index),
            );
            continue;
          }
          sum += part.signed!;
          n++;
        }
        const computed = round(sum);
        const tolerance = input.tolerance ?? 0.5 * n;
        const difference = round(Math.abs(c.signed!) - Math.abs(computed));
        const foots = usable && Math.abs(difference) <= tolerance;
        if (usable && !foots) {
          allFoot = false;
          flag(
            "does_not_foot",
            `${c.line.label} is ${showValue(c.signed)} on the statement; lines ${parts.join(", ")} add up to ${showValue(computed)} (difference ${showValue(difference)} in size, tolerance ${showValue(tolerance)})`,
            atOf(c.index),
          );
        }
        if (!usable) allFoot = false;
        return {
          line: c.index,
          label: c.line.label,
          amount: c.signed,
          sums: parts,
          computed,
          difference,
          tolerance,
          foots,
        };
      });
    const memo = inPeriod
      .filter((c) => c.kind === "memo")
      .map((c) => ({
        line: c.index,
        category: c.category!.id,
        label: c.category!.label,
        value: c.signed,
      }));
    return {
      ...(label !== null ? { period: label } : {}),
      sections,
      totals,
      ...(subtotals.length ? { subtotals } : {}),
      ...(memo.length ? { memo } : {}),
    };
  });

  const out = checked.map((c) => {
    const status =
      c.kind === "line"
        ? "included"
        : c.kind === "excluded"
          ? "excluded"
          : c.kind;
    return {
      line: c.index,
      label: c.line.label,
      status,
      ...(c.period !== "" ? { period: c.period } : {}),
      ...(c.category
        ? { category: c.category.id, section: c.category.section }
        : {}),
      ...(c.total ? { category: c.total.id } : {}),
      amount: c.line.amount,
      ...(c.kind === "line" ? { spread_amount: c.signed } : {}),
      ...(c.citation ? { citation: c.citation } : {}),
      ...(c.reason ? { reason: c.reason } : {}),
    };
  });
  const count = (k: string): number => out.filter((l) => l.status === k).length;
  return {
    property_type: input.property_type,
    ...(input.statement_type ? { statement_type: input.statement_type } : {}),
    chart: `factlot.chart_of_accounts@${CHART_VERSION}`,
    document: describeDocument(doc),
    periods,
    lines: out,
    exceptions,
    summary: {
      lines: lines.length,
      included: count("included"),
      totals: count("total"),
      subtotals: count("subtotal"),
      memo: count("memo"),
      excluded: count("excluded"),
      exceptions: exceptions.length,
      foots: allFoot,
    },
  };
}
