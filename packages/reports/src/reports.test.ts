// @factlot/reports: input checks, every kind × format as a valid file, determinism, bundle size.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

import { TX_EQUITY_RULE, TX_EQUITY_STEPS, runTool } from "@factlot/tools";
import { build } from "esbuild";
import { PDFDocument, PDFRawStream } from "pdf-lib";

import { fold } from "./ics.ts";
import { adviceIn } from "./text.ts";
import { TX_SOFTWARE } from "./kinds/protest.ts";
import {
  RIGHTS_UNKNOWN,
  RULE_NOTE,
  RULE_NOTE_NARROWED,
  SENT_FIELDS_HEADING,
  SOURCE_NOT_SENT,
} from "./kinds/tx.ts";
import { round } from "@factlot/calc";
import { txDoc } from "./kinds/tx.ts";
import { MAX_CELL_CHARS, MAX_PDF_LINES, PdfWriter } from "./pdf.ts";
import { Workbook, fx } from "./xlsx.ts";
import { num, pct, roundInText, sig, times, ungrouped, usd } from "./format.ts";
import {
  KIND_FORMATS,
  REPORT_KINDS,
  ReportInputError,
  TX_DISCLAIMER,
  createReport,
  subjectSlug,
  unzip,
  type ReportKind,
} from "./index.ts";

const VECTORS = new URL("../../../spec/vectors/", import.meta.url);
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

type Json = Record<string, unknown>;

/**
 * The rule vectors a report builds from: each case with as_of (the generation day, 2026-11-07,
 * when the case has none) and, for a batch, every item answered.
 */
function ruleCases(name: string): Json[] {
  const d = JSON.parse(
    readFileSync(new URL(`rules/${name}.json`, VECTORS), "utf8"),
  ) as { cases: { input: Json }[] };
  return d.cases
    .map((c) => ({ as_of: "2026-11-07", ...c.input }))
    .filter((i) => {
      const out = runTool(`rules_${name}`, i);
      const results =
        (out.ok &&
          (out.result as { value: { results?: Json[] } }).value.results) ||
        [];
      return out.ok && !results.some((r) => "error" in r);
    });
}

function calcCases(name: string): Json[] {
  const d = JSON.parse(
    readFileSync(new URL(`calc/${name}.json`, VECTORS), "utf8"),
  ) as {
    cases: { input: Json }[];
  };
  return d.cases
    .map((c) => c.input)
    .filter((i) => runTool(`calc_${name}`, i).ok);
}

const docs = JSON.parse(
  readFileSync(new URL("documents.json", VECTORS), "utf8"),
) as {
  documents: Record<string, string[]>;
  cases: { tool: string; arguments: unknown }[];
};
const resolvePages = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(resolvePages)
    : v && typeof v === "object"
      ? typeof (v as Json).$pages === "string"
        ? docs.documents[(v as Json).$pages as string]
        : Object.fromEntries(
            Object.entries(v).map(([k, x]) => [k, resolvePages(x)]),
          )
      : v;
const abstractCases = docs.cases
  .filter((c) => c.tool === "doc_abstract_lease")
  .map((c) => resolvePages(c.arguments) as Json)
  .filter((a) => runTool("doc_abstract_lease", a).ok);

/** The richest successful vector input of each tool. */
const largest = (xs: Json[]) =>
  [...xs].sort(
    (a, b) => JSON.stringify(b).length - JSON.stringify(a).length,
  )[0]!;

const SAMPLES: { kind: ReportKind; tool: string; args: Json }[] = [
  {
    kind: "tx_unequal_appraisal",
    tool: "calc_tx_unequal_appraisal",
    args: largest(calcCases("tx_unequal_appraisal")),
  },
  {
    kind: "lease_abstract",
    tool: "doc_abstract_lease",
    args: abstractCases[0]!,
  },
  {
    kind: "cam_reconciliation",
    tool: "calc_cam_reconciliation",
    args: largest(calcCases("cam_reconciliation")),
  },
  {
    kind: "cam_reconciliation",
    tool: "calc_cam_reconciliation_batch",
    args: largest(calcCases("cam_reconciliation_batch")),
  },
  {
    kind: "debt_sizing",
    tool: "calc_debt_sizing",
    args: largest(calcCases("debt_sizing")),
  },
  {
    kind: "asc842_schedule",
    tool: "calc_lease_remeasurement_asc842",
    args: largest(calcCases("lease_remeasurement_asc842")),
  },
  {
    kind: "compare_proposals",
    tool: "calc_compare_proposals",
    args: largest(calcCases("compare_proposals")),
  },
  {
    kind: "dcf_summary",
    tool: "calc_dcf_pro_forma",
    args: largest(calcCases("dcf_pro_forma")),
  },
  {
    kind: "critical_dates",
    tool: "calc_critical_dates",
    args: largest(calcCases("critical_dates")),
  },
  {
    kind: "tx_protest_deadline",
    tool: "rules_tx_property_tax_protest_deadline",
    args: { tax_year: 2027, notice_delivered_date: "2027-04-28" },
  },
  {
    kind: "tx_protest_deadline",
    tool: "rules_tx_property_tax_protest_deadline_batch",
    args: {
      items: [
        { id: "HCAD 0412340010025", tax_year: 2027 },
        { id: "TAD 41234567", tax_year: 2026 },
      ],
    },
  },
];

const resultOf = (tool: string, args: unknown): Json => {
  const out = runTool(tool, args);
  assert.ok(out.ok, `${tool} runs`);
  return out.result as Json;
};

async function rejects(
  req: unknown,
  code: string,
  path?: RegExp,
): Promise<ReportInputError> {
  try {
    await createReport(req, { now: NOW });
  } catch (err) {
    assert.ok(
      err instanceof ReportInputError,
      `a ReportInputError, got ${String(err)}`,
    );
    assert.equal(err.code, code, err.message);
    if (path)
      assert.ok(
        err.issues.some((i) => path.test(i.path)),
        JSON.stringify(err.issues),
      );
    return err;
  }
  assert.fail(`expected ${code}`);
}

// --- file readers -------------------------------------------------------------------------------

/** Well-formed XML: balanced tags, quoted attributes, known entities. Throws otherwise. */
function assertWellFormed(xml: string, name: string): void {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stack: string[] = [];
  const re =
    /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<!\[CDATA\[[\s\S]*?\]\]>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => {
    assert.ok(
      !/[<>]/.test(t),
      `${name}: stray angle bracket in ${t.slice(0, 40)}`,
    );
    for (const e of t.match(/&[^;]*;?/g) ?? [])
      assert.ok(
        /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);$/.test(e),
        `${name}: bad entity ${e}`,
      );
  };
  while ((m = re.exec(body))) {
    text(body.slice(last, m.index));
    last = re.lastIndex;
    if (m[0].startsWith("<![CDATA[")) continue;
    for (const e of (m[3] ?? "").match(/&[^;]*;?/g) ?? [])
      assert.ok(
        /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);$/.test(e),
        `${name}: bad entity ${e}`,
      );
    if (m[1])
      assert.equal(
        stack.pop(),
        m[2],
        `${name}: </${m[2]}> closes the wrong element`,
      );
    else if (!m[4]) stack.push(m[2]!);
  }
  text(body.slice(last));
  assert.equal(stack.length, 0, `${name}: unclosed ${stack.join(", ")}`);
}

interface Xlsx {
  sheets: string[];
  /** Cell text or value by sheet name and A1 address. */
  cell(sheet: string, a1: string): string | undefined;
  /** Every cell's value on a sheet. */
  values(sheet: string): string[];
  xml: Map<string, string>;
}

async function readXlsx(bytes: Uint8Array): Promise<Xlsx> {
  const files = await unzip(bytes);
  const xml = new Map<string, string>();
  for (const [name, data] of files) {
    const text = new TextDecoder().decode(data);
    assertWellFormed(text, name);
    xml.set(name, text);
  }
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/styles.xml",
    "xl/_rels/workbook.xml.rels",
  ])
    assert.ok(xml.has(part), `has ${part}`);
  const sheets = [
    ...xml.get("xl/workbook.xml")!.matchAll(/<sheet name="([^"]+)"/g),
  ].map((m) => m[1]!);
  const cells = (sheet: string) => {
    const i = sheets.indexOf(sheet);
    assert.ok(i >= 0, `sheet ${sheet}`);
    const out = new Map<string, string>();
    for (const m of xml
      .get(`xl/worksheets/sheet${i + 1}.xml`)!
      .matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const inner = m[2] ?? "";
      const v =
        /<v>([^<]*)<\/v>/.exec(inner)?.[1] ??
        /<t[^>]*>([^<]*)<\/t>/.exec(inner)?.[1];
      if (v !== undefined)
        out.set(
          m[1]!,
          v
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"'),
        );
    }
    return out;
  };
  return {
    sheets,
    xml,
    cell: (sheet, a1) => cells(sheet).get(a1),
    values: (sheet) => [...cells(sheet).values()],
  };
}

/** The text drawn on each page (pdf-lib writes standard-font text as hex WinAnsi strings). */
async function readPdf(
  bytes: Uint8Array,
): Promise<{ pages: number; text: string; title?: string }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let text = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.toString();
    let data: Buffer;
    try {
      data = filter.includes("FlateDecode")
        ? inflateSync(obj.contents)
        : Buffer.from(obj.contents);
    } catch {
      continue;
    }
    for (const m of data.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g))
      text += Buffer.from(m[1]!, "hex").toString("latin1") + "\n";
  }
  return { pages: doc.getPageCount(), text, title: doc.getTitle() };
}

/** RFC 5545 line rules; returns the unfolded content lines. */
function readIcs(bytes: Uint8Array): string[] {
  const raw = new TextDecoder().decode(bytes);
  assert.ok(raw.endsWith("\r\n"), "ends with CRLF");
  assert.ok(!/[^\r]\n/.test(raw), "every line ends in CRLF");
  for (const line of raw.split("\r\n"))
    assert.ok(
      new TextEncoder().encode(line).length <= 75,
      `line over 75 octets: ${line}`,
    );
  const lines = raw.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
  const stack: string[] = [];
  for (const l of lines) {
    if (l.startsWith("BEGIN:")) stack.push(l.slice(6));
    if (l.startsWith("END:")) assert.equal(stack.pop(), l.slice(4));
  }
  assert.equal(stack.length, 0);
  return lines;
}

// --- tests --------------------------------------------------------------------------------------

describe("format", () => {
  it("one convention: money to the cent with the sign first, percentages to 2 decimals, steps to 6 significant digits", () => {
    assert.equal(pct(0.1554), "15.54%");
    assert.equal(pct(0.07388606), "7.39%");
    assert.equal(pct(0.07388606, 4), "7.3886%");
    assert.equal(pct(-0.061033), "-6.10%");
    assert.equal(pct(1.25), "125.00%");
    assert.equal(pct(0.532), "53.20%");
    assert.equal(usd(-130000), "-$130,000.00");
    assert.equal(usd(1989999.5), "$1,989,999.50");
    assert.equal(usd(-0.001), "$0.00");
    assert.equal(times(1.2501), "1.25x");
    assert.equal(num(1e-7), "0.0000001");
    assert.equal(num(23874596.957531843), "23,874,596.957531843");
    assert.equal(sig(0.07388606405116722), "0.0738861");
    assert.equal(sig(23874596.957531843), "23,874,597");
    assert.equal(sig(1.03), "1.03");
    assert.equal(sig(2026), "2,026");
    assert.equal(
      roundInText(
        "$4,531,482.41 + $-25,000.00 amount adjustments × 0.07388606405116722",
      ),
      "$4,531,482.41 + -$25,000.00 amount adjustments × 0.0738861",
    );
    for (const name of [
      "tax_year",
      "year",
      "fiscal_year",
      "periods",
      "term_months",
      "hold_years",
      "renewal_option.count",
      "payments[3].period",
    ])
      assert.ok(ungrouped(name), name);
    for (const name of ["noi", "value", "area_sf", "amount"])
      assert.ok(!ungrouped(name), name);
  });
});

describe("input checks", () => {
  for (const s of SAMPLES)
    it(`${s.tool}: every successful vector case builds from FactLot's run; a result alone is ${s.kind === "lease_abstract" ? "accepted as supplied" : "refused"}`, async () => {
      const name = s.tool.replace(/^(calc|rules)_/, "");
      const all =
        s.tool === "doc_abstract_lease"
          ? abstractCases
          : s.tool.startsWith("rules_")
            ? ruleCases(name)
            : calcCases(name);
      assert.ok(all.length > 0);
      for (const args of all) {
        const input = resultOf(s.tool, args);
        const a = await createReport(
          { kind: s.kind, format: "pdf", arguments: args },
          { now: NOW },
        );
        assert.equal(a.check, "computed");
        assert.equal(a.result_mismatch, undefined);
        const b = await createReport(
          { kind: s.kind, format: "pdf", input, arguments: args },
          { now: NOW },
        );
        assert.equal(b.check, "computed");
        assert.equal(b.result_mismatch, false);
        if (s.kind === "lease_abstract")
          assert.equal(
            (
              await createReport(
                { kind: s.kind, format: "pdf", input },
                { now: NOW },
              )
            ).check,
            "supplied",
          );
        else
          await rejects(
            { kind: s.kind, format: "pdf", input },
            "ArgumentsRequired",
            /^arguments$/,
          );
      }
    });

  const tx = SAMPLES[0]!;
  const txResult = () =>
    structuredClone(resultOf(tx.tool, tx.args)) as {
      value: Json;
      formula: Json;
      steps: unknown[];
      warnings: string[];
    };

  it("arguments alone: FactLot computes the result", async () => {
    const f = await createReport(
      { kind: "debt_sizing", format: "pdf", arguments: SAMPLES[4]!.args },
      { now: NOW },
    );
    assert.equal(f.check, "computed");
    assert.equal(f.source, "calc_debt_sizing@3");
  });

  it("a tampered result sent with the arguments is never used: the document has FactLot's figures and result_mismatch is true", async () => {
    const r = txResult();
    const median = r.value.median_adjusted_value as number;
    // A coherent fabrication: the subject tripled, with the figures that follow from it.
    r.value.subject_value = (r.value.subject_value as number) * 3;
    r.value.subject_minus_median = (r.value.subject_value as number) - median;
    r.warnings = ["FactLot recommends you protest."];
    const f = await createReport(
      {
        kind: "tx_unequal_appraisal",
        format: "pdf",
        input: r,
        arguments: tx.args,
      },
      { now: NOW },
    );
    assert.equal(f.check, "computed");
    assert.equal(f.result_mismatch, true);
    const flat = (await readPdf(f.bytes)).text.replace(/\s+/g, " ");
    const real = resultOf(tx.tool, tx.args) as {
      value: { subject_value: number };
    };
    assert.ok(
      flat.includes(usd(real.value.subject_value)),
      "FactLot's subject value",
    );
    assert.ok(
      !flat.includes(usd(r.value.subject_value as number)),
      "not the tampered one",
    );
    assert.ok(!flat.includes("recommends"), "not the tampered warning");
    assert.ok(flat.includes("it differs from this run and was not used"));
    const d = structuredClone(
      resultOf("calc_dcf_pro_forma", SAMPLES[7]!.args),
    ) as {
      value: Json;
    };
    d.value.unlevered_irr = 0.4242;
    const x = await createReport(
      {
        kind: "dcf_summary",
        format: "xlsx",
        input: d,
        arguments: SAMPLES[7]!.args,
      },
      { now: NOW },
    );
    assert.equal(x.result_mismatch, true);
    const all = [...(await readXlsx(x.bytes)).xml.values()].join("");
    assert.ok(
      !all.includes("0.4242"),
      "the tampered IRR is not in the workbook",
    );
  });

  it("lease_abstract: a supplied result with an unknown field or edited counts is refused", async () => {
    const r = structuredClone(
      resultOf("doc_abstract_lease", abstractCases[0]!),
    ) as {
      summary: Json;
    } & Json;
    (r as Json).recommendation = "renew";
    await rejects(
      { kind: "lease_abstract", format: "pdf", input: r },
      "NotAToolResult",
    );
    const c = structuredClone(
      resultOf("doc_abstract_lease", abstractCases[0]!),
    ) as {
      summary: { fields: number };
    };
    c.summary.fields += 1;
    await rejects(
      { kind: "lease_abstract", format: "pdf", input: c },
      "NotAToolResult",
      /summary\.fields/,
    );
  });

  it("lease_abstract: every page says where the values came from, never that the numbers are the tool's results", async () => {
    const args = abstractCases[0]!;
    const input = resultOf("doc_abstract_lease", args);
    for (const [req, label] of [
      [
        { input },
        "Abstract values as supplied by the caller; FactLot did not recompute them.",
      ],
      [
        { arguments: args },
        "Abstract values as supplied by the caller and checked against the lease text sent.",
      ],
    ] as const) {
      const pdf = await createReport(
        { kind: "lease_abstract", format: "pdf", ...req },
        { now: NOW },
      );
      const p = await readPdf(pdf.bytes);
      const flat = p.text.replace(/\s+/g, " ");
      assert.ok(
        flat.split(label).length - 1 >= p.pages,
        `label on each of ${p.pages} pages`,
      );
      assert.ok(!flat.includes("numbers are the tool's results"));
      const xl = await createReport(
        { kind: "lease_abstract", format: "xlsx", ...req },
        { now: NOW },
      );
      const x = await readXlsx(xl.bytes);
      const all = [...x.xml.values()].join("");
      assert.ok(!all.includes("numbers are the tool"));
      for (const [name, xml] of x.xml)
        if (name.startsWith("xl/worksheets/"))
          assert.ok(xml.includes(`&amp;8${label}`), `${name} print footer`);
    }
  });

  it("a result that does not match its arguments is flagged, not used", async () => {
    const args = structuredClone(SAMPLES[4]!.args);
    const input = resultOf("calc_debt_sizing", args);
    (args as Json).noi = (args.noi as number) + 1;
    const f = await createReport(
      { kind: "debt_sizing", format: "pdf", input, arguments: args },
      { now: NOW },
    );
    assert.equal(f.result_mismatch, true);
    await rejects(
      { kind: "debt_sizing", format: "pdf", arguments: { noi: -1 } },
      "ArgumentsError",
      /^arguments\./,
    );
  });

  it("request shape, kind and format", async () => {
    await rejects(
      { kind: "nope", format: "pdf", input: {} },
      "InputError",
      /kind/,
    );
    await rejects(
      { kind: "debt_sizing", format: "ics", input: {} },
      "InputError",
      /format/,
    );
    await rejects(
      { kind: "debt_sizing", format: "pdf" },
      "ArgumentsRequired",
      /arguments/,
    );
    await rejects(
      { kind: "lease_abstract", format: "pdf" },
      "InputError",
      /arguments/,
    );
    await rejects(
      { kind: "debt_sizing", format: "pdf", input: {}, extra: 1 },
      "InputError",
    );
    await rejects(
      { kind: "debt_sizing", format: "pdf", input: {}, context: { title: "" } },
      "InputError",
      /context/,
    );
    assert.deepEqual(KIND_FORMATS.critical_dates, ["xlsx", "pdf", "ics"]);
    assert.deepEqual(KIND_FORMATS.tx_protest_deadline, ["ics", "pdf"]);
    for (const k of REPORT_KINDS.filter(
      (k) => k !== "critical_dates" && k !== "tx_protest_deadline",
    ))
      assert.ok(!KIND_FORMATS[k].includes("ics"));
  });
});

describe("documents", () => {
  for (const s of SAMPLES)
    for (const format of KIND_FORMATS[s.kind])
      it(`${s.tool} → ${format}`, async () => {
        const input = resultOf(s.tool, s.args);
        const f = await createReport(
          { kind: s.kind, format, input, arguments: s.args },
          { now: NOW },
        );
        assert.equal(f.filename.endsWith(`.${format}`), true);
        assert.match(
          f.filename,
          /^factlot-[a-z0-9-]+-2026-11-07\.(xlsx|pdf|ics)$/,
        );
        const footer =
          s.kind === "lease_abstract"
            ? `Abstract values as supplied by the caller and checked against the lease text sent. Generated by FactLot 0.5.0 on 2026-11-07 12:00:00 UTC from ${f.source}`
            : `Generated by FactLot 0.5.0 on 2026-11-07 12:00:00 UTC from ${f.source}; numbers are the tool's results; see https://factlot.com/terms`;
        if (format === "xlsx") {
          const x = await readXlsx(f.bytes);
          assert.ok(x.sheets.includes("ReadMe"));
          assert.ok(
            [...x.xml.values()].some((t) =>
              t.includes(footer.replace(/'/g, "'")),
            ),
            "footer in the workbook",
          );
          // Every live check agrees with FactLot.
          for (const sheet of x.sheets.filter(
            (n) => n === "Reconcile" || n === "Checks",
          )) {
            const statuses = x
              .values(sheet)
              .filter((v) => v === "match" || v === "DIFFERENT");
            assert.ok(statuses.length > 0, `${sheet} has checks`);
            assert.ok(
              statuses.every((v) => v === "match"),
              `${sheet}: ${statuses.join(",")}`,
            );
          }
        } else if (format === "pdf") {
          const p = await readPdf(f.bytes);
          assert.ok(p.pages >= 1);
          assert.ok(
            p.text.includes(
              "Generated by FactLot 0.5.0 on 2026-11-07 12:00:00 UTC",
            ),
            "footer",
          );
          assert.ok(p.text.includes("https://factlot.com/terms"), "terms link");
          assert.ok(p.title && p.title.length > 3, "title metadata");
        } else {
          const lines = readIcs(f.bytes);
          assert.ok(
            lines.includes("BEGIN:VCALENDAR") && lines.includes("VERSION:2.0"),
          );
          assert.ok(
            lines.some((l) =>
              l.startsWith("PRODID:-//FactLot//Reports 0.5.0//EN"),
            ),
          );
        }
      });

  it("tx_unequal_appraisal: the evidence packet carries the figures, citations, statutes and disclaimer, and no recommendation", async () => {
    const s = SAMPLES[0]!;
    const r = resultOf(s.tool, s.args) as {
      value: {
        median_adjusted_value: number;
        subject_minus_median: number;
        subject_minus_median_pct: number;
        comparables: { adjusted_value: number; id: string | null }[];
        law: { section: string }[];
      };
    };
    const f = await createReport(
      {
        kind: "tx_unequal_appraisal",
        format: "pdf",
        arguments: s.args,
        context: {
          subject_citation: {
            document_id: "fl:document:sha256-abc",
            locator: "account 0042",
          },
        },
      },
      { now: NOW },
    );
    const { text } = await readPdf(f.bytes);
    const flat = text.replace(/\n/g, " ");
    assert.ok(flat.includes(usd(r.value.median_adjusted_value)), "median");
    assert.ok(flat.includes(usd(r.value.subject_minus_median)), "difference");
    assert.ok(
      flat.includes(pct(r.value.subject_minus_median_pct)),
      "difference as a share",
    );
    for (const c of r.value.comparables)
      assert.ok(flat.includes(usd(c.adjusted_value)), `adjusted ${c.id}`);
    for (const l of r.value.law)
      assert.ok(flat.includes(l.section.replace("§", "§").split(" ")[0]!));
    assert.ok(flat.includes("account 0042"), "supplied citation");
    // The disclaimer, word for word (wrapping splits lines, so compare without whitespace).
    const squash = (t: string) => t.replace(/\s+/g, "");
    assert.ok(squash(flat).includes(squash(TX_DISCLAIMER)), "disclaimer");
    assert.ok(
      !/\brecommend|\bshould protest|\byou should\b/i.test(flat),
      "no recommendation",
    );
  });

  it("tx_unequal_appraisal: the workbook mirrors the reconciliation example, with live formulas and evidence columns", async () => {
    const s = SAMPLES[0]!;
    const r = resultOf(s.tool, s.args) as {
      value: { median_adjusted_value: number };
    };
    {
      const f = await createReport(
        { kind: "tx_unequal_appraisal", format: "xlsx", arguments: s.args },
        { now: NOW },
      );
      const x = await readXlsx(f.bytes);
      assert.deepEqual(x.sheets, [
        "ReadMe",
        "Reconcile",
        "Grid",
        "Steps",
        "Law",
        "Provenance",
        "Inputs",
      ]);
      const prov = x.values("Provenance");
      assert.ok(
        prov.some((v) =>
          v.startsWith(
            "Computed: FactLot ran calc_tx_unequal_appraisal on the arguments",
          ),
        ),
        "the input check",
      );
      assert.ok(
        prov.includes("calc_tx_unequal_appraisal@1"),
        "tool and formula",
      );
      const grid = x.xml.get(
        `xl/worksheets/sheet${x.sheets.indexOf("Grid") + 1}.xml`,
      )!;
      assert.match(
        grid,
        /<f>ROUND\(MEDIAN\(Grid!\$[A-Z]+\$9:\$[A-Z]+\$\d+\),2\)<\/f><v>([\d.]+)<\/v>/,
      );
      const cached = /<f>ROUND\(MEDIAN\([^<]+\),2\)<\/f><v>([\d.]+)<\/v>/.exec(
        grid,
      )![1];
      assert.equal(Number(cached), r.value.median_adjusted_value);
      for (const h of [
        "Source document ID",
        "Locator in source",
        "As of",
        "Fact ID",
      ])
        assert.ok(x.values("Grid").includes(h), h);
      assert.ok(
        x
          .values("ReadMe")
          .some((v) =>
            v.includes(
              "reconciled to calc_tx_unequal_appraisal with zero difference",
            ),
          ),
      );
      assert.equal(x.cell("Reconcile", "C4"), "0", "rows that differ");
    }
  });

  it("tx_unequal_appraisal: candidate fields and the candidate rule from registry_tx_equity_candidates, in the packet and the workbook", async () => {
    const sample = SAMPLES[0]!;
    // The sample with registry ids and improvement areas on the subject and its first comparable.
    const args = structuredClone(sample.args) as {
      subject: { id?: string; value: number; improvement_area_sf?: number };
      comparables: {
        id?: string;
        value: number;
        improvement_area_sf?: number;
      }[];
    };
    args.subject.id = "fl:parcel:us-48997:1000001";
    args.subject.improvement_area_sf = 50000;
    args.comparables[0]!.id = "fl:parcel:us-48997:1000002";
    args.comparables[0]!.improvement_area_sf = 48000;
    const s = { ...sample, args: args as unknown as Json };
    assert.ok(runTool(s.tool, s.args).ok, "the sample still runs");
    const subjectRow = {
      id: args.subject.id,
      apn: "SUBJ-0001",
      state_property_category: "F1",
      building_class: "OFFICE BUILDING (MID-RISE)",
      local_use_code: "C2,F1",
      improvement_area_sf: 50000,
      land_area_sf: 120000,
      year_built: 2005,
      value: args.subject.value,
      value_basis: "market",
      value_per_sf: 999999, // the caller's figure is never printed
    };
    const compRow = {
      id: args.comparables[0]!.id,
      apn: "COMP-0002",
      state_property_category: "F1",
      building_class: null,
      local_use_code: "4600",
      improvement_area_sf: 48000,
      value: args.comparables[0]!.value,
      value_basis: "market",
      citation: { document_id: "fl:document:sha256-x" },
    };
    const candidates = [subjectRow, compRow];
    const selection_rule = {
      tax_year: 2026,
      state_property_category: "F1",
      area_band: { share: 0.35, min_sf: 32500, max_sf: 67500 },
      year_band: { years: 15, min: 1990, max: 2020 },
      min_matches: 10,
      limit: 50,
      narrowing: [
        {
          parameter: "same_local_use_code",
          applied: true,
          value: "4300",
          text: "only parcels whose local use code is exactly the subject's (4300)",
        },
      ],
      steps: [
        { step: TX_EQUITY_STEPS.base, left: 9 },
        { step: TX_EQUITY_STEPS.area, left: 8 },
        { step: TX_EQUITY_STEPS.year, left: 7 },
        { step: TX_EQUITY_STEPS.same_local_use_code, left: 4 },
      ],
      tiers: [
        {
          tier: "neighborhood",
          key: "N100",
          applied: true,
          matched: 1,
          returned: 1,
        },
        { tier: "zip", key: "77001", applied: true, matched: 2, returned: 2 },
        { tier: "county", key: "997", applied: true, matched: 1, returned: 1 },
      ],
      widened_to_county: true,
      matched: 4,
      returned: 4,
    };
    const context = { candidates, selection_rule };
    const pdfOf = (ctx: Json) =>
      createReport(
        {
          kind: "tx_unequal_appraisal",
          format: "pdf",
          arguments: s.args,
          context: ctx,
        },
        { now: NOW },
      );
    const squash = (t: string) => t.replace(/\s+/g, "");
    const flat = squash((await readPdf((await pdfOf(context)).bytes)).text);
    for (const t of [
      SENT_FIELDS_HEADING,
      "SUBJ-0001",
      "COMP-0002",
      "OFFICE BUILDING (MID-RISE)",
      "C2,F1",
      usd(round(args.subject.value / 50000, 2)),
      usd(round(args.comparables[0]!.value / 48000, 2)),
      "Candidate rule as applied",
      RULE_NOTE_NARROWED,
      TX_EQUITY_RULE,
      TX_EQUITY_STEPS.same_local_use_code,
      "applied: 4300",
    ])
      assert.ok(flat.includes(squash(t)), t);
    assert.ok(
      !flat.includes("999,999"),
      "the caller's value per SF is not printed",
    );
    assert.ok(flat.includes("notsent"), "a comparable with no row sent");
    // Without a narrowing applied, the rule note is the default one.
    const plain = squash(
      (
        await readPdf(
          (
            await pdfOf({
              selection_rule: { ...selection_rule, narrowing: [] },
            })
          ).bytes,
        )
      ).text,
    );
    assert.ok(
      plain.includes(squash(RULE_NOTE)) &&
        !plain.includes(squash(RULE_NOTE_NARROWED)),
    );
    const x = await readXlsx(
      (
        await createReport(
          {
            kind: "tx_unequal_appraisal",
            format: "xlsx",
            arguments: s.args,
            context,
          },
          { now: NOW },
        )
      ).bytes,
    );
    assert.deepEqual(x.sheets, [
      "ReadMe",
      "Reconcile",
      "Grid",
      "Sent_candidate_fields",
      "Steps",
      "Law",
      "Provenance",
      "Inputs",
    ]);
    const sheet = x.values("Sent_candidate_fields");
    for (const t of [
      "SUBJ-0001",
      "COMP-0002",
      SENT_FIELDS_HEADING,
      TX_EQUITY_RULE,
    ])
      assert.ok(sheet.includes(t), t);
    assert.equal(x.cell("Reconcile", "C4"), "0", "still reconciles");
    const req = (ctx: Json) => ({
      kind: "tx_unequal_appraisal",
      format: "pdf",
      arguments: s.args,
      context: ctx,
    });
    // A value or area that is not the calculation's, or a row that is not in it, is refused, naming the field.
    await rejects(
      req({ candidates: [{ ...compRow, value: 1 }] }),
      "InputError",
      /^context\.candidates\.0\.value$/,
    );
    await rejects(
      req({ candidates: [{ ...compRow, improvement_area_sf: 47000 }] }),
      "InputError",
      /^context\.candidates\.0\.improvement_area_sf$/,
    );
    await rejects(
      req({ candidates: [{ ...compRow, id: "fl:parcel:us-48997:1000099" }] }),
      "InputError",
      /^context\.candidates\.0\.id$/,
    );
    await rejects(
      req({ candidates: [compRow, compRow] }),
      "InputError",
      /^context\.candidates\.1\.id$/,
    );
    await rejects(
      req({ candidates: [{ ...compRow, improvement_area_sf: -5 }] }),
      "InputError",
    );
    await rejects(
      req({ candidates: [{ ...compRow, apn: "A1<script>" }] }),
      "InputError",
    );
    // Codes are caller text; a step the tool does not name is refused.
    await rejects(
      req({ candidates: [{ ...compRow, local_use_code: "you should file" }] }),
      "TextNotAllowed",
      /^context\.candidates\.0\.local_use_code$/,
    );
    await rejects(
      req({
        selection_rule: {
          steps: [{ step: "comparables FactLot chose", left: 3 }],
        },
      }),
      "InputError",
    );
  });

  it("critical_dates ICS: an event per date, the notice window, and a reminder 30 days before each notice event", async () => {
    const s = SAMPLES[8]!;
    const r = resultOf(s.tool, s.args) as {
      value: {
        events: { kind: string }[];
        renewal_terms: { window_opens?: string }[];
      };
    };
    const f = await createReport(
      {
        kind: "critical_dates",
        format: "ics",
        arguments: s.args,
        context: { title: "Suite 400, 100 Main" },
        include_past: true,
      },
      { now: NOW },
    );
    const lines = readIcs(f.bytes);
    const events = lines.filter((l) => l === "BEGIN:VEVENT").length;
    const windows = r.value.renewal_terms.filter((t) => t.window_opens).length;
    // A window is one multi-day event: its single-day "window opens" date is not repeated.
    const opens = r.value.events.filter(
      (e) => e.kind === "renewal_window_opens",
    ).length;
    assert.equal(events, r.value.events.length + windows - opens);
    const deadlines = r.value.events.filter((e) =>
      /deadline/.test(e.kind),
    ).length;
    assert.equal(
      lines.filter((l) => l === "TRIGGER;RELATED=START:-P30D").length,
      deadlines + windows,
    );
    const uids = lines.filter((l) => l.startsWith("UID:"));
    assert.equal(new Set(uids).size, uids.length, "unique UIDs");
    assert.ok(
      lines.every(
        (l) => !l.startsWith("DTSTART") || /^DTSTART;VALUE=DATE:\d{8}$/.test(l),
      ),
    );
    assert.ok(
      lines.includes("X-WR-CALNAME:Suite 400\\, 100 Main"),
      "commas escaped",
    );
    assert.ok(
      lines.every((l) => !l.startsWith("SUMMARY:Suite 400")),
      "the calendar name is not repeated in each summary",
    );
    assert.ok(lines.includes(`DTSTAMP:20261107T120000Z`));
  });

  it("is deterministic: the same request at the same time gives the same bytes", async () => {
    for (const s of SAMPLES)
      for (const format of KIND_FORMATS[s.kind]) {
        const req = { kind: s.kind, format, arguments: s.args };
        const a = await createReport(req, { now: NOW });
        const b = await createReport(req, { now: NOW });
        assert.deepEqual(a.bytes, b.bytes, `${s.tool} ${format}`);
      }
  });

  it("supplied text never becomes a formula and odd characters are written safely", async () => {
    const title = '=HYPERLINK("http://x","y") & <b> "Café" — 5 ≤ 6 中';
    const s = SAMPLES[4]!;
    const x = await readXlsx(
      (
        await createReport(
          {
            kind: "debt_sizing",
            format: "xlsx",
            arguments: s.args,
            context: { title },
          },
          { now: NOW },
        )
      ).bytes,
    );
    const all = [...x.xml.values()].join("");
    assert.ok(!all.includes("<f>HYPERLINK"), "no formula from text");
    assert.ok(
      all.includes(
        "=HYPERLINK(&quot;http://x&quot;,&quot;y&quot;) &amp; &lt;b&gt;",
      ),
    );
    const p = await readPdf(
      (
        await createReport(
          {
            kind: "debt_sizing",
            format: "pdf",
            arguments: s.args,
            context: { title },
          },
          { now: NOW },
        )
      ).bytes,
    );
    assert.ok(p.text.includes("Café"), "Latin-1 kept");
    assert.ok(
      p.text.includes("5 <= 6 ?"),
      "math sign spelled out, CJK replaced",
    );
  });

  it("lease_abstract workbook: numeric values are numbers, not text", async () => {
    const found = abstractCases
      .map((a) => ({
        a,
        r: resultOf("doc_abstract_lease", a) as {
          fields: { predicate: string; value: unknown }[];
        },
      }))
      .flatMap(({ a, r }) =>
        r.fields
          .filter((f) => typeof f.value === "number")
          .map((f) => ({ a, value: f.value as number })),
      );
    assert.ok(found.length > 0, "a vector with a numeric term");
    const { a, value } = found[0]!;
    const x = await readXlsx(
      (
        await createReport(
          { kind: "lease_abstract", format: "xlsx", arguments: a },
          { now: NOW },
        )
      ).bytes,
    );
    const terms = x.xml.get(
      `xl/worksheets/sheet${x.sheets.indexOf("Terms") + 1}.xml`,
    )!;
    assert.match(
      terms,
      new RegExp(`<c r="B\\d+" s="\\d+"><v>${String(value)}</v></c>`),
    );
  });

  it("ICS: two deadlines with the same label get distinct UIDs", async () => {
    const args = structuredClone(SAMPLES[8]!.args) as Json;
    args.other_deadlines = [
      { label: "ROFO response", date: "2027-03-01" },
      { label: "ROFO response", date: "2028-03-01" },
    ];
    const lines = readIcs(
      (
        await createReport(
          { kind: "critical_dates", format: "ics", arguments: args },
          { now: NOW },
        )
      ).bytes,
    );
    const uids = lines.filter((l) => l.startsWith("UID:"));
    assert.ok(uids.length >= 2);
    assert.equal(new Set(uids).size, uids.length);
  });

  it("control characters and bidirectional overrides never reach a document", async () => {
    const bad = "A\u0007B\u202eC\u2066D\u0000E\u009bF";
    const ics = new TextDecoder().decode(
      (
        await createReport(
          {
            kind: "critical_dates",
            format: "ics",
            arguments: SAMPLES[8]!.args,
            context: { title: `X;Y,Z\\W\n${bad}` },
          },
          { now: NOW },
        )
      ).bytes,
    );
    assert.ok(
      ics.replace(/\r\n /g, "").includes("X\\;Y\\,Z\\\\W\\nABCDEF"),
      "escaped and stripped",
    );
    const tx = structuredClone(SAMPLES[0]!.args) as {
      comparables: { adjustments?: Json[] }[];
    };
    tx.comparables[0]!.adjustments = [
      { label: "size", kind: "amount", value: 100, reason: `r ${bad}` },
    ];
    for (const format of ["pdf", "xlsx"] as const) {
      const f = await createReport(
        {
          kind: "tx_unequal_appraisal",
          format,
          arguments: tx,
          context: { prepared_for: bad },
        },
        { now: NOW },
      );
      const text =
        format === "pdf"
          ? (await readPdf(f.bytes)).text
          : [...(await readXlsx(f.bytes)).xml.values()].join("");
      assert.ok(text.includes("ABCDEF"), format);
      /* eslint-disable no-control-regex */
      assert.ok(
        !/[\u0000-\u0008\u0080-\u009f\u202a-\u202e\u2066-\u2069]/.test(text),
        format,
      );
      /* eslint-enable no-control-regex */
    }
  });

  it("ICS folding never splits a UTF-8 character", () => {
    const line = `DESCRIPTION:${"é".repeat(100)}`;
    const folded = fold(line).split("\r\n");
    for (const l of folded) assert.ok(new TextEncoder().encode(l).length <= 75);
    assert.equal(folded.map((l, i) => (i ? l.slice(1) : l)).join(""), line);
  });

  it("CPU: a document builds in well under the Worker budget (p95 over 20 runs, generous bound for CI)", async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++)
      for (const s of SAMPLES) {
        const formats = KIND_FORMATS[s.kind];
        const req = {
          kind: s.kind,
          format: formats[i % formats.length],
          arguments: s.args,
        };
        const t = performance.now();
        await createReport(req, { now: NOW });
        times.push(performance.now() - t);
      }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    assert.ok(p95 < 250, `p95 ${p95.toFixed(1)} ms`);
  });
});

describe("caller text", () => {
  const tx = SAMPLES[0]!;
  const req = (over: Json = {}, args: Json = tx.args) => ({
    kind: "tx_unequal_appraisal",
    format: "pdf",
    arguments: args,
    ...over,
  });

  it("refuses advice or valuation wording, naming the field (TextNotAllowed)", async () => {
    // The reviewer's context (adv.ts), less the control characters.
    await rejects(
      req({
        context: { title: "Market value $1,000,000 - protest recommended" },
      }),
      "TextNotAllowed",
      /^context\.title$/,
    );
    await rejects(
      req({ context: { prepared_for: "Owner: you should file" } }),
      "TextNotAllowed",
      /^context\.prepared_for$/,
    );
    await rejects(
      req({
        context: {
          subject_citation: { locator: "ARB will reduce it; you should file" },
        },
      }),
      "TextNotAllowed",
      /^context\.subject_citation\.locator$/,
    );
    for (const phrase of [
      "we recommend this",
      "it should be lower",
      "grounds to protest",
      "worth $1",
      "our appraisal says so",
      "our opinion of value",
      "the market value is $2",
      "you save $500",
      "tax savings",
    ]) {
      const args = structuredClone(tx.args) as {
        comparables: { id?: string; adjustments?: Json[] }[];
      };
      args.comparables[1]!.adjustments = [
        { label: "size", kind: "amount", value: 100, reason: phrase },
      ];
      const err = await rejects(
        req({}, args as unknown as Json),
        "TextNotAllowed",
      );
      assert.equal(
        err.issues[0]!.path,
        "arguments.comparables.1.adjustments.0.reason",
        phrase,
      );
    }
    const ids = structuredClone(tx.args) as { comparables: { id?: string }[] };
    ids.comparables[0]!.id = "Should win";
    await rejects(
      req({}, ids as unknown as Json),
      "TextNotAllowed",
      /comparables\.0\.id$/,
    );
  });

  it("passes names that contain such a word, and plain text", async () => {
    const f = await createReport(
      req({
        context: {
          title: "Fort Worth office, tax year 2027",
          prepared_for: "Asset management",
          subject_citation: {
            locator: "Tarrant Appraisal District, account 0042",
          },
        },
      }),
      { now: NOW },
    );
    const flat = (await readPdf(f.bytes)).text.replace(/\s+/g, " ");
    assert.ok(
      flat.includes("Title and prepared-for line supplied by the caller"),
    );
    assert.ok(flat.includes("Citations (supplied by the caller)"));
    assert.ok(
      flat.includes("Adjustments and reasons (supplied by the caller)"),
    );
  });

  it("caps caller text: title and prepared_for 120, reasons and locators 200", async () => {
    await rejects(
      req({ context: { title: "T".repeat(121) } }),
      "InputError",
      /context/,
    );
    await rejects(
      req({ context: { prepared_for: "P".repeat(121) } }),
      "InputError",
      /context/,
    );
    await rejects(
      req({ context: { subject_citation: { locator: "L".repeat(201) } } }),
      "InputError",
      /context/,
    );
    const args = structuredClone(tx.args) as {
      comparables: { adjustments?: Json[]; citation?: Json }[];
    };
    args.comparables[0]!.adjustments = [
      { label: "size", kind: "amount", value: 100, reason: "R".repeat(201) },
    ];
    await rejects(
      req({}, args as unknown as Json),
      "InputError",
      /^arguments\.comparables\.0\.adjustments\.0\.reason$/,
    );
    const loc = structuredClone(tx.args) as {
      comparables: { citation?: Json }[];
    };
    loc.comparables[0]!.citation = { locator: "L".repeat(201) };
    await rejects(
      req({}, loc as unknown as Json),
      "InputError",
      /^arguments\.comparables\.0\.citation\.locator$/,
    );
  });
});

describe("size limits", () => {
  const tx = SAMPLES[0]!;
  /** The tx sample with n comparables of a adjustments each, every text at its cap. */
  const many = (n: number, a: number, spaced = false): Json => {
    const args = structuredClone(tx.args) as { comparables: Json[] };
    const base = args.comparables[0]!;
    args.comparables = Array.from({ length: n }, (_, i) => ({
      ...structuredClone(base),
      id: `C${i}`.padEnd(200, "X"),
      citation: {
        document_id: "D".repeat(200),
        locator: (spaced ? "page " : "L").repeat(200).slice(0, 200),
      },
      adjustments: Array.from({ length: a }, (_, j) => ({
        label: `adj${j}`,
        kind: "amount",
        value: 10 * j,
        reason: (spaced ? "reason " : "R").repeat(200).slice(0, 200),
      })),
    }));
    return args as unknown as Json;
  };

  it("the Texas PDF takes at most 60 comparables of 10 adjustments; above, 413 TooLarge naming the xlsx", async () => {
    for (const [n, a, path] of [
      [61, 1, /^arguments\.comparables$/],
      [10, 11, /^arguments\.comparables\.0\.adjustments$/],
    ] as const) {
      const err = await rejects(
        { kind: "tx_unequal_appraisal", format: "pdf", arguments: many(n, a) },
        "TooLarge",
        path,
      );
      assert.match(err.next ?? "", /"format": "xlsx"/);
    }
  });

  it("the largest Texas PDF allowed (60 × 10, every text at its cap) builds in well under a second", async () => {
    for (const spaced of [false, true]) {
      const t = performance.now();
      const f = await createReport(
        {
          kind: "tx_unequal_appraisal",
          format: "pdf",
          arguments: many(60, 10, spaced),
        },
        { now: NOW },
      );
      const ms = performance.now() - t;
      assert.ok(ms < 3_000, `${ms.toFixed(0)} ms`);
      assert.ok((await readPdf(f.bytes)).pages > 5);
    }
  });

  it("the Texas workbook takes the tool's full set: 200 comparables", async () => {
    const f = await createReport(
      {
        kind: "tx_unequal_appraisal",
        format: "xlsx",
        arguments: many(200, 3, true),
      },
      { now: NOW },
    );
    const x = await readXlsx(f.bytes);
    assert.equal(x.cell("Reconcile", "C4"), "0", "rows that differ");
  });
});

describe("workbook formulas", () => {
  it("a division by zero is #DIV/0! in the cell and in what reads it, as in Excel; nothing throws", async () => {
    const wb = new Workbook({
      title: "t",
      creator: "c",
      created: "2026-11-07T12:00:00Z",
    });
    const sh = wb.sheet("S");
    const zero = sh.put(1, 1, 0);
    const v = sh.put(1, 2, 10);
    const q = sh.put(2, 1, fx(`=ROUND(${v}/${zero},2)`));
    sh.put(2, 2, fx(`=${q}+1`));
    sh.put(2, 3, fx(`=SUM(S!$A$2:$B$2)`));
    sh.put(2, 4, fx(`=IF(${q}=0,"match","DIFFERENT")`));
    sh.put(2, 5, fx(`=COUNTIF(S!$A$2:$B$2,"match")`));
    sh.put(2, 6, fx(`=${v}*"text"`));
    sh.put(2, 7, fx(`=ROUND(${v}/4,2)`));
    const x = await readXlsx(await wb.bytes());
    const xml = x.xml.get("xl/worksheets/sheet1.xml")!;
    for (const a of ["A2", "B2", "C2", "D2"])
      assert.match(
        xml,
        new RegExp(`<c r="${a}" s="\\d+" t="e"><f>[^<]+</f><v>#DIV/0!</v>`),
        a,
      );
    assert.equal(x.cell("S", "E2"), "0", "COUNTIF skips errors");
    assert.match(xml, /<c r="F2" s="\d+" t="e"><f>[^<]+<\/f><v>#VALUE!<\/v>/);
    assert.equal(x.cell("S", "G2"), "2.5");
  });

  it("a supplied result with a zero area cannot reach the workbook (the reviewer's crash)", async () => {
    const d = structuredClone(
      resultOf("calc_dcf_pro_forma", SAMPLES[7]!.args),
    ) as { value: Json };
    d.value.building_area_sf = 0;
    await rejects(
      { kind: "dcf_summary", format: "xlsx", input: d },
      "ArgumentsRequired",
    );
    const f = await createReport(
      {
        kind: "dcf_summary",
        format: "xlsx",
        input: d,
        arguments: SAMPLES[7]!.args,
      },
      { now: NOW },
    );
    assert.equal(f.result_mismatch, true);
  });
});

describe("PDF text limits", () => {
  const writer = () =>
    PdfWriter.create({
      title: "t",
      subject: "s",
      header: "h",
      footer: "f",
      producer: "p",
      keywords: [],
      created: new Date(NOW),
    });

  it("wraps in one pass: a long unbroken token and long paragraphs take milliseconds", async () => {
    const w = await writer();
    for (const text of [
      "W".repeat(4_000),
      "W".repeat(20_000),
      "W".repeat(MAX_CELL_CHARS),
      `${"word ".repeat(400)}${"x".repeat(1_900)}`,
    ]) {
      const t = performance.now();
      const lines = w.wrap(text, 7, 60);
      const ms = performance.now() - t;
      assert.ok(ms < 100, `${text.length} chars: ${ms.toFixed(1)} ms`);
      assert.ok(lines.length > 1);
    }
  });

  it("breaks a word longer than the line by characters, and keeps every character", async () => {
    const w = await writer();
    const lines = w.wrap(`ab ${"W".repeat(300)} cd`, 9, 100);
    assert.equal(lines.join("").replace(/ /g, ""), `ab${"W".repeat(300)}cd`);
    assert.ok(lines.length > 3);
  });

  it(`cuts text over ${MAX_CELL_CHARS} characters with an ellipsis and a note`, async () => {
    const w = await writer();
    const text = w.wrap("A".repeat(5_000), 9, 10_000).join("");
    assert.ok(text.startsWith("A".repeat(MAX_CELL_CHARS)));
    assert.ok(!text.includes("A".repeat(MAX_CELL_CHARS + 1)));
    assert.match(
      text,
      /\[cut: 5,000 characters in all; the PDF shows the first 2,000\]$/,
    );
  });

  it(`refuses a document that would draw over ${MAX_PDF_LINES} lines (TooLarge)`, async () => {
    const w = await writer();
    const t = performance.now();
    assert.throws(
      () => {
        for (let i = 0; i < MAX_PDF_LINES + 10; i++) w.para("x");
      },
      (e: unknown) => e instanceof ReportInputError && e.code === "TooLarge",
    );
    assert.ok(performance.now() - t < 5_000);
  });
});

describe("bundle", () => {
  it("adds under 1 MB to a Worker that already holds the tools (pdf-lib and this package, minified)", async () => {
    const out = await build({
      entryPoints: [new URL("./index.ts", import.meta.url).pathname],
      bundle: true,
      minify: true,
      write: false,
      format: "esm",
      platform: "neutral",
      conditions: ["factlot-source", "worker", "browser"],
      mainFields: ["module", "main"],
      external: ["@factlot/calc", "@factlot/tools", "zod"],
      logLevel: "silent",
    });
    const bytes = out.outputFiles[0]!.contents.byteLength;
    assert.ok(bytes < 1_000_000, `${bytes} bytes`);
  });
});

// --- QA pass, 2026-11-07 -------------------------------------------------------------------------

/** The QA pass's critical-dates request (mcp.call.req.json): a following-day roll, US holidays. */
const QA_DATES = {
  kind: "critical_dates",
  format: "ics",
  context: {
    title: "Suite 400 lease critical dates",
    prepared_for: "Westchase Tower lease admin",
  },
  arguments: {
    commencement_date: "2026-03-01",
    expiration_date: "2031-06-30",
    as_of: "2026-11-07",
    renewal_option: {
      count: 2,
      term_months: 60,
      notice_window: { earliest_months_before: 18, latest_months_before: 12 },
    },
    termination_options: [
      {
        effective_date: "2029-06-30",
        notice_months: 9,
        label: "Early termination right",
      },
    ],
    expansion_option_deadline: "2027-09-30",
    other_deadlines: [
      {
        label: "Estoppel certificate due",
        from_date: "2026-11-01",
        days_after: 30,
      },
      { label: "Insurance renewal", date: "2027-03-01" },
    ],
    business_day_roll: "following",
    holidays: "us_federal",
  },
};

/** Each VEVENT's unfolded properties (the first of each name) and its alarm triggers. */
function icsEvents(
  lines: string[],
): { props: Map<string, string>; triggers: string[] }[] {
  const out: { props: Map<string, string>; triggers: string[] }[] = [];
  let cur: { props: Map<string, string>; triggers: string[] } | undefined;
  let inAlarm = false;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") cur = { props: new Map(), triggers: [] };
    else if (l === "END:VEVENT") {
      out.push(cur!);
      cur = undefined;
    } else if (l === "BEGIN:VALARM") inAlarm = true;
    else if (l === "END:VALARM") inAlarm = false;
    else if (cur && l.startsWith("TRIGGER")) cur.triggers.push(l);
    else if (cur && !inAlarm) {
      const i = l.indexOf(":");
      const key = l.slice(0, i);
      if (!cur.props.has(key)) cur.props.set(key, l.slice(i + 1));
    }
  }
  return out;
}

describe("QA fixes", () => {
  it("D4 ICS: a deadline rolled later is dated on its contractual day, with the roll and the tool's warning in the description", async () => {
    const f = await createReport(QA_DATES, { now: NOW });
    const events = icsEvents(readIcs(f.bytes));
    const find = (label: RegExp) => {
      const e = events.find((x) => label.test(x.props.get("SUMMARY") ?? ""));
      assert.ok(e, String(label));
      return e;
    };
    const unescape = (t: string) =>
      t.replace(/\\n/g, "\n").replace(/\\([,;\\])/g, "$1");

    const renewal = find(/Renewal option 1: last day to give notice/);
    assert.equal(renewal.props.get("DTSTART;VALUE=DATE"), "20300630");
    const d = unescape(renewal.props.get("DESCRIPTION")!);
    assert.match(d, /Dated on 2030-06-30/);
    assert.match(d, /gives 2030-07-01/);
    assert.match(
      d,
      /Only a lease clause that extends a deadline falling on a non-business day allows that/,
      "the tool's warning is carried",
    );

    const term = find(/Early termination right: last day to give notice/);
    assert.equal(term.props.get("DTSTART;VALUE=DATE"), "20280930");
    assert.match(
      unescape(term.props.get("DESCRIPTION")!),
      /from 2028-09-30 to 2028-10-02/,
    );

    // The renewal window ends on the contractual last day too (DTEND is exclusive).
    const window = find(/Renewal option 1 notice window/);
    assert.equal(window.props.get("DTEND;VALUE=DATE"), "20300701");

    // Under 30 days away: a reminder an hour after generation as well as the -P30D one.
    const estoppel = find(/Estoppel certificate due/);
    assert.deepEqual(estoppel.triggers, [
      "TRIGGER;RELATED=START:-P30D",
      "TRIGGER;VALUE=DATE-TIME:20261107T130000Z",
    ]);
    assert.deepEqual(find(/Insurance renewal/).triggers, [
      "TRIGGER;RELATED=START:-P30D",
    ]);

    // UIDs: unique, and the same when the calendar is generated again later.
    const uids = events.map((e) => e.props.get("UID"));
    assert.equal(new Set(uids).size, uids.length);
    const again = icsEvents(
      readIcs((await createReport(QA_DATES, { now: NOW + 3_600_000 })).bytes),
    ).map((e) => e.props.get("UID"));
    assert.deepEqual(new Set(again), new Set(uids));
  });

  it("D3 advice filter: phrases are refused, names and statutory terms pass (table)", async () => {
    const refused: [string, string][] = [
      ["You should file by May 15", "You should"],
      ["We recommend a hearing", "We recommend"],
      ["Protest recommended", "recommended"],
      ["This one will win", "will win"],
      ["Worth $4.2M at most", "Worth $"],
      ["The subject is worth less", "is worth"],
      ["Our opinion of value", "opinion of value"],
      ["Per our appraisal", "our appraisal"],
      ["Appraised at $3,900,000 last year", "Appraised at $3"],
      ["Protest your value today", "Protest your"],
      ["You can save thousands", "You can save"],
      ["Savings of $12,000", "Savings of"],
      ["it should be lower", "should"],
    ];
    for (const [text, phrase] of refused)
      assert.equal(adviceIn(text), phrase, text);
    const allowed = [
      "Worthington Plaza",
      "Worth Avenue",
      "First Savings Bank",
      "Protestant Church",
      "Saved by the Bell",
      "Appraisal notice 2026",
      "Unequal appraisal workbook",
      "Protest packet 2026",
      "100 Worthington Dr",
      "unequal appraisal",
      "Harris Central Appraisal District",
      "appraisal review board hearing",
      "notice of appraised value",
      "appraisal roll 2026",
      "protest deadline May 15",
      "protest hearing exhibits",
      "2026 tax protest",
      "Fort Worth office",
      "value as appraised at the hearing",
    ];
    for (const text of allowed) assert.equal(adviceIn(text), undefined, text);

    // End to end: a comparable id and titles that tripped the old filter now build.
    const args = structuredClone(SAMPLES[0]!.args) as {
      comparables: { id?: string }[];
    };
    args.comparables[0]!.id = "100 Worthington Dr";
    await createReport(
      {
        kind: "tx_unequal_appraisal",
        format: "pdf",
        arguments: args,
        context: {
          title: "Protest packet 2026",
          prepared_for: "First Savings Bank",
        },
      },
      { now: NOW },
    );
    const err = await rejects(
      {
        kind: "tx_unequal_appraisal",
        format: "pdf",
        arguments: SAMPLES[0]!.args,
        context: { title: "Worthington Plaza: you should file" },
      },
      "TextNotAllowed",
      /^context\.title$/,
    );
    assert.match(err.message, /"you should"/);
  });

  it("D1/D2 tx workbook: the disclaimer is a merged row of set height, only the header and id column are frozen, and the caller's title and prepared-for line are printed", async () => {
    const f = await createReport(
      {
        kind: "tx_unequal_appraisal",
        format: "xlsx",
        arguments: SAMPLES[0]!.args,
        context: { title: "Oak Plaza 2026", prepared_for: "Asset management" },
      },
      { now: NOW },
    );
    const x = await readXlsx(f.bytes);
    const grid = x.xml.get(
      `xl/worksheets/sheet${x.sheets.indexOf("Grid") + 1}.xml`,
    )!;
    const ht = /<row r="2" ht="([\d.]+)" customHeight="1">/.exec(grid);
    assert.ok(ht, "row 2 has an explicit height");
    assert.ok(Number(ht[1]) <= 62, `row 2 is ${ht[1]} pt`);
    assert.match(grid, /<mergeCell ref="A2:[A-Z]+2"\/>/);
    assert.match(grid, /<pane xSplit="1" ySplit="8" topLeftCell="B9"/);
    for (const sheet of ["ReadMe", "Grid"]) {
      const vals = x.values(sheet).join("\n");
      assert.match(vals, /Title \(supplied by the caller\): Oak Plaza 2026/);
      assert.match(
        vals,
        /Prepared for \(supplied by the caller\): Asset management/,
      );
    }
    // Both disclaimer sentences survive on the Grid and the ReadMe.
    for (const sheet of ["ReadMe", "Grid"]) {
      const vals = x.values(sheet).join(" ");
      assert.match(vals, /not a substitute for the advice of an attorney/);
      assert.match(vals, /not an appraisal or an opinion of value/);
      assert.match(vals, /1103\.003\(1\)/);
    }
  });

  it("D5 a wide table goes on a landscape page and no number is broken across lines", async () => {
    const args = {
      noi: 2205000,
      value: 36000000,
      rate_annual: 0.0625,
      amortization_years: 30,
      max_ltv: 0.7,
      min_dscr: 1.25,
      min_debt_yield: 0.085,
      round_down_to: 1000,
      existing_loan_balance: 21500000,
      stress: {
        noi_shocks: [-0.1, -0.2],
        rate_shocks: [0.01, 0.02],
        value_shocks: [-0.1],
      },
    };
    const r = resultOf("calc_debt_sizing", args) as {
      value: { stress: { max_loan: number; annual_debt_service: number }[] };
    };
    const f = await createReport(
      { kind: "debt_sizing", format: "pdf", arguments: args },
      { now: NOW },
    );
    const doc = await PDFDocument.load(f.bytes);
    const sizes = doc.getPages().map((p) => p.getSize());
    assert.ok(
      sizes.some((s) => s.width > s.height),
      "a landscape page for the stress table",
    );
    assert.ok(
      sizes.some((s) => s.width < s.height),
      "portrait pages too",
    );
    const lines = (await readPdf(f.bytes)).text.split("\n");
    for (const s of r.value.stress) {
      assert.ok(lines.includes(usd(s.max_loan)), usd(s.max_loan));
      assert.ok(
        lines.includes(usd(s.annual_debt_service)),
        usd(s.annual_debt_service),
      );
    }
  });

  it("D18 ICS: short summaries, no single-day duplicate of a window, past dates left out unless include_past", async () => {
    const lines = readIcs((await createReport(QA_DATES, { now: NOW })).bytes);
    const summaries = lines.filter((l) => l.startsWith("SUMMARY:"));
    assert.ok(
      summaries.every((l) => !l.includes("Suite 400 lease critical dates")),
      "no calendar-name prefix",
    );
    assert.ok(lines.includes("X-WR-CALNAME:Suite 400 lease critical dates"));
    assert.ok(
      !summaries.some((l) => /notice window opens/.test(l)),
      "the window event is not repeated as a single day",
    );
    assert.ok(
      !summaries.some((l) => /Commencement date/.test(l)),
      "2026-03-01 is before the generation day",
    );
    assert.ok(lines.some((l) => /left out \(send include_past/.test(l)));
    const all = readIcs(
      (await createReport({ ...QA_DATES, include_past: true }, { now: NOW }))
        .bytes,
    );
    assert.ok(all.some((l) => l === "SUMMARY:Commencement date"));
  });

  it("D7/D8/D9 PDF: years ungrouped, money sign first, rounded audit trail with its note, statute URLs are links", async () => {
    const s = SAMPLES[0]!;
    const f = await createReport(
      { kind: "tx_unequal_appraisal", format: "pdf", arguments: s.args },
      { now: NOW },
    );
    const { text } = await readPdf(f.bytes);
    const year = (s.args as { tax_year: number }).tax_year;
    assert.ok(!text.includes(num(year)), `no ${num(year)}`);
    assert.ok(!/\$-\d/.test(text), "no $-");
    assert.ok(!/\d\.\d{7,}/.test(text), "no raw floats");
    const raw = Buffer.from(f.bytes).toString("latin1");
    assert.match(raw, /\/Subtype \/Link/);
    assert.match(raw, /\/URI \(https:\/\/statutes\.capitol\.texas\.gov/);
    // DCF: a long audit trail with long decimals is rounded and says where the full precision is.
    const dcf = SAMPLES.find((x) => x.kind === "dcf_summary")!;
    const d = (
      await readPdf(
        (
          await createReport(
            { kind: "dcf_summary", format: "pdf", arguments: dcf.args },
            { now: NOW },
          )
        ).bytes,
      )
    ).text;
    assert.ok(!/\d\.\d{7,}/.test(d), "no raw floats in the DCF PDF");
  });

  it("D11/D13/D14 Texas: $/SF parity, normalizing area, statutes restated, disclaimer on the cover and every footer only", async () => {
    const s = SAMPLES[0]!;
    const r = resultOf(s.tool, s.args) as {
      value: { normalize_by: string };
      warnings: string[];
    };
    const x = await readXlsx(
      (
        await createReport(
          { kind: "tx_unequal_appraisal", format: "xlsx", arguments: s.args },
          { now: NOW },
        )
      ).bytes,
    );
    if (r.value.normalize_by !== "none") {
      assert.ok(x.values("Grid").includes("Adjusted $/SF"));
      assert.ok(x.values("Reconcile").some((v) => v.endsWith("adjusted $/SF")));
    }
    assert.equal(x.cell("Reconcile", "C4"), "0", "rows that differ");
    assert.ok(x.values("Law").includes("Source (URL)"));
    assert.ok(!x.values("Law").includes("Text"));
    if (!r.warnings.length) {
      const g = x.values("Grid");
      assert.equal(g[g.indexOf("FactLot warnings") + 1], "none");
    }
    const f = await createReport(
      { kind: "tx_unequal_appraisal", format: "pdf", arguments: s.args },
      { now: NOW },
    );
    const { text, pages } = await readPdf(f.bytes);
    const flat = text.replace(/\s+/g, " ");
    assert.match(flat, /Source \(URL\)/);
    assert.match(flat, /not subject to Occupations Code ch\. 1103/);
    assert.match(flat, /text in effect from 2027-01-01/);
    if (r.value.normalize_by !== "none")
      assert.match(flat, /the normalizing area/);
    const squash = text.replace(/\s+/g, "");
    const count =
      squash.split("notasubstitutefortheadviceofanattorney").length - 1;
    assert.equal(count, pages + 1, "cover once, then each page's footer");
  });

  it("D11 Texas: a label and address are printed next to the id when present", async () => {
    const s = SAMPLES[0]!;
    const result = structuredClone(resultOf(s.tool, s.args)) as {
      value: { comparables: Record<string, unknown>[] };
    };
    result.value.comparables[0]!.label = "Oak Plaza";
    result.value.comparables[0]!.address = "100 Main St";
    const doc = txDoc({
      checked: {
        tool: s.tool,
        result,
        check: "computed",
        args: s.args,
      },
      ctx: {},
      p: {
        footer: "f",
        version: "0",
        toolRef: "t",
        generatedAt: new Date(NOW),
        header: "h",
        keywords: [],
      },
    });
    const cells = doc.blocks
      .flatMap((b) => (b.t === "table" ? b.rows.flat() : []))
      .map(String);
    assert.ok(cells.some((c) => c.endsWith("(Oak Plaza, 100 Main St)")));
    // Without them nothing changes.
    const plain = txDoc({
      checked: {
        tool: s.tool,
        result: resultOf(s.tool, s.args),
        check: "computed",
        args: s.args,
      },
      ctx: {},
      p: {
        footer: "f",
        version: "0",
        toolRef: "t",
        generatedAt: new Date(NOW),
        header: "h",
        keywords: [],
      },
    });
    assert.ok(
      !plain.blocks
        .flatMap((b) => (b.t === "table" ? b.rows.flat() : []))
        .some((c) => String(c).includes("(Oak")),
    );
  });

  it("D12 lease abstract workbook: no Steps sheet named, 'supplied' wording, no package version, dates as dates", async () => {
    const s = SAMPLES[1]!;
    const f = await createReport(
      { kind: "lease_abstract", format: "xlsx", arguments: s.args },
      { now: NOW },
    );
    assert.equal(f.source, "doc_abstract_lease");
    const x = await readXlsx(f.bytes);
    if (!x.sheets.includes("Steps"))
      assert.ok(!x.values("ReadMe").some((v) => v.startsWith("Steps:")));
    const report = x.values("Report");
    assert.ok(report.some((v) => v.startsWith("Checked: FactLot ran")));
    assert.ok(
      !report.some((v) =>
        /every figure in this document is from that run/.test(v),
      ),
    );
    const terms = x.xml.get(
      `xl/worksheets/sheet${x.sheets.indexOf("Terms") + 1}.xml`,
    )!;
    const iso =
      /<c r="B\d+"[^>]*t="inlineStr"><is><t[^>]*>\d{4}-\d{2}-\d{2}<\/t>/;
    assert.ok(
      !iso.test(terms),
      "no ISO date stored as text in the Value column",
    );
  });

  it("D14 proposals: one neutral ranking word, commissions and downtime as sent", async () => {
    const s = SAMPLES.find((x) => x.kind === "compare_proposals")!;
    const { text } = await readPdf(
      (
        await createReport(
          { kind: "compare_proposals", format: "pdf", arguments: s.args },
          { now: NOW },
        )
      ).bytes,
    );
    assert.ok(!/\bBest\b/.test(text), "never 'Best'");
    const flat = text.replace(/\s+/g, " ");
    assert.match(flat, /Leasing commissions/);
    assert.match(flat, /Downtime \(months\)/);
  });

  it("D16 filenames cut at word boundaries and drop a year the date repeats", async () => {
    const f = await createReport(
      {
        kind: "tx_unequal_appraisal",
        format: "pdf",
        arguments: SAMPLES[0]!.args,
        context: { title: "Harris appraisal district evidence, tax year 2026" },
      },
      { now: NOW },
    );
    assert.equal(
      f.filename,
      "factlot-tx-unequal-appraisal-harris-appraisal-district-evidence-2026-11-07.pdf",
    );
    assert.equal(
      subjectSlug(
        "Suite 210 CAM reconciliation 2025, Westchase",
        "cam_reconciliation",
        "2026-11-07",
      ),
      "suite-210-2025-westchase",
    );
  });

  it("D17 validation: missing says missing, non-object arguments name 'arguments', a wrong format lists the formats", async () => {
    const miss = await rejects(
      { kind: "debt_sizing" },
      "InputError",
      /^format$/,
    );
    assert.match(
      miss.issues.find((i) => i.path === "format")!.message,
      /^missing/,
    );
    assert.match(miss.message, /missing format/);
    assert.match(miss.next ?? "", /docs\/reports\.md#what-a-report-accepts/);
    assert.match(miss.next ?? "", /calc_debt_sizing/);
    const args = await rejects(
      { kind: "debt_sizing", format: "pdf", arguments: 7 },
      "ArgumentsError",
    );
    assert.equal(args.issues[0]!.path, "arguments");
    assert.match(args.next ?? "", /v1\/tools/);
    const absent = await rejects(
      { kind: "debt_sizing", format: "pdf", arguments: { value: 1 } },
      "ArgumentsError",
    );
    assert.ok(
      absent.issues.some((i) => /^missing/.test(i.message)),
      JSON.stringify(absent.issues),
    );
    const fmt = await rejects(
      { kind: "debt_sizing", format: "ics", arguments: {} },
      "InputError",
      /^format$/,
    );
    assert.match(fmt.next ?? "", /"xlsx", "pdf"/);
  });

  it("D6 live formulas: DCF subtotals and the CAM charge tie out to FactLot's figures on every vector", async () => {
    const cases: [ReportKind, Json][] = [
      ...calcCases("dcf_pro_forma").map((a): [ReportKind, Json] => [
        "dcf_summary",
        a,
      ]),
      ...calcCases("cam_reconciliation").map((a): [ReportKind, Json] => [
        "cam_reconciliation",
        a,
      ]),
    ];
    assert.ok(cases.length > 2);
    for (const [kind, args] of cases) {
      const x = await readXlsx(
        (
          await createReport(
            { kind, format: "xlsx", arguments: args },
            { now: NOW },
          )
        ).bytes,
      );
      const status = x
        .values("Checks")
        .filter((v) => v === "match" || v === "DIFFERENT");
      assert.ok(status.length > 0, kind);
      assert.ok(
        status.every((v) => v === "match"),
        `${kind}: ${JSON.stringify(args).slice(0, 80)}`,
      );
      if (kind === "dcf_summary") {
        const cf = x.xml.get(
          `xl/worksheets/sheet${x.sheets.indexOf("CashFlows") + 1}.xml`,
        )!;
        assert.match(cf, /<f>ROUND\(B\d+\+B\d+\+B\d+,2\)<\/f>/);
      }
    }
  });

  it("D15 PDF Inputs: a long list is one row with a count; the workbook keeps every value", async () => {
    const s = SAMPLES.find((x) => x.kind === "compare_proposals")!;
    const args = structuredClone(s.args) as {
      proposals: { schedule: { abated_months?: number[] } }[];
    };
    args.proposals[0]!.schedule.abated_months = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const req = { kind: "compare_proposals", arguments: args };
    const pdf = (
      await readPdf(
        (await createReport({ ...req, format: "pdf" }, { now: NOW })).bytes,
      )
    ).text.replace(/\s+/g, " ");
    assert.match(pdf, /abated_months \(9 values\)/);
    assert.ok(!pdf.includes("abated_months[8]"));
    const x = await readXlsx(
      (await createReport({ ...req, format: "xlsx" }, { now: NOW })).bytes,
    );
    assert.ok(
      x.values("Inputs").includes("proposals[0].schedule.abated_months[8]"),
    );
  });
});

// --- tx_protest_deadline -------------------------------------------------------------------------

interface IcsEv {
  uid: string;
  start: string;
  summary: string;
  description: string;
  triggers: string[];
}

const unescapeIcs = (v: string) =>
  v.replace(/\\(n|,|;|\\)/g, (_, c: string) => (c === "n" ? "\n" : c));

/** The events of a calendar, with their text unescaped. */
function protestEvents(lines: string[]): IcsEv[] {
  const out: IcsEv[] = [];
  let cur: IcsEv | undefined;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT")
      cur = { uid: "", start: "", summary: "", description: "", triggers: [] };
    else if (l === "END:VEVENT" && cur) {
      out.push(cur);
      cur = undefined;
    } else if (cur) {
      const at = l.indexOf(":");
      const [name, value] = [l.slice(0, at), l.slice(at + 1)];
      if (name === "UID") cur.uid = value;
      else if (name === "DTSTART;VALUE=DATE") cur.start = value;
      else if (name === "SUMMARY") cur.summary = unescapeIcs(value);
      else if (name === "DESCRIPTION" && !cur.description)
        cur.description = unescapeIcs(value);
      else if (name.startsWith("TRIGGER")) cur.triggers.push(l);
    }
  }
  return out;
}

const PROTEST = (args: unknown, over: Json = {}) => ({
  kind: "tx_protest_deadline",
  format: "ics",
  arguments: args,
  ...over,
});
/** 2027-05-01 15:00 UTC: tax year 2027's deadline is open, 16 days away. */
const MAY_1 = Date.UTC(2027, 4, 1, 15, 0, 0);

async function protestCal(req: unknown, now = NOW) {
  const f = await createReport(req, { now });
  const lines = readIcs(f.bytes);
  return { f, lines, events: protestEvents(lines) };
}

describe("tx_protest_deadline", () => {
  it("one notice: the statutory deadline and the conservative file-by date, short summaries, the rule's facts in each description", async () => {
    const { f, lines, events } = await protestCal(
      PROTEST({ tax_year: 2027 }),
      MAY_1,
    );
    assert.equal(f.source, "rules_tx_property_tax_protest_deadline@2");
    assert.equal(f.content_type, "text/calendar; charset=utf-8");
    assert.ok(lines.includes("X-WR-CALNAME:Texas protest deadlines"));
    assert.deepEqual(
      events.map((e) => [e.summary, e.start]),
      [
        ["Texas protest filing deadline, tax year 2027", "20270517"],
        ["Conservative file-by date, tax year 2027", "20270514"],
      ],
    );
    const [deadline, fileBy] = events as [IcsEv, IcsEv];
    // The rule's facts: basis, the §1.06 move, status and days remaining as of generation.
    assert.match(deadline.description, /Basis: May 15 of the tax year/);
    assert.match(deadline.description, /2027-05-15 \(Saturday\)/);
    assert.match(
      deadline.description,
      /As of 2027-05-01: status open; 16 days to the deadline\./,
    );
    assert.match(
      deadline.description,
      /§41\.44\(a\)\(1\) \(the later of May 15/,
    );
    assert.match(
      deadline.description,
      /No notice delivery date given: if the notice was delivered after April 15/,
      "the rule's warning",
    );
    assert.match(deadline.description, /does not cover late protests/);
    assert.match(deadline.description, /§41\.44\(b\)-\(c-3\) and §25\.25/);
    assert.match(
      fileBy.description,
      /Earlier than the statutory deadline 2027-05-17/,
    );
    assert.match(fileBy.description, /2027-05-15 is a Saturday/);
    for (const e of events) {
      assert.ok(e.description.includes(TX_DISCLAIMER), "disclaimer");
      assert.ok(e.description.includes(TX_SOFTWARE), "ch. 1152 sentence");
      assert.match(
        e.description,
        /not a substitute for the advice of an attorney/,
      );
      assert.match(
        e.description,
        /not an appraisal or an opinion of value \(Tex\. Occ\. Code §1103\.003\(1\)\)/i,
      );
      assert.match(e.description, /It does not say whether to protest\./);
      assert.ok(
        !/\.\n\nAs of/.test(e.description),
        "no blank line inside a section",
      );
      assert.match(
        e.description,
        /dates are the rule's results; see https:\/\/factlot\.com\/terms$/,
      );
      // No advice: the whole description passes the caller-text filter, statute terms included.
      assert.equal(adviceIn(e.description), undefined, e.description);
      assert.ok(!/you should|recommend|protest your/i.test(e.description));
    }
    assert.ok(!/you should|recommend|protest your/i.test(lines.join("\n")));
  });

  it("alarms: 30 and 7 days before the file-by date, plus one an hour after generation when it is under 30 days away", async () => {
    const near = await protestCal(PROTEST({ tax_year: 2027 }), MAY_1);
    const [deadline, fileBy] = near.events as [IcsEv, IcsEv];
    assert.deepEqual(
      deadline.triggers,
      [],
      "the reminders are on the file-by date",
    );
    assert.deepEqual(fileBy.triggers, [
      "TRIGGER;RELATED=START:-P30D",
      "TRIGGER;RELATED=START:-P7D",
      "TRIGGER;VALUE=DATE-TIME:20270501T160000Z",
    ]);
    assert.ok(
      near.lines.includes(
        "DESCRIPTION:In 13 days: conservative file-by date for the Texas protest\\, tax year 2027\\, is 2027-05-14 (statutory deadline 2027-05-17)",
      ),
    );
    const far = await protestCal(PROTEST({ tax_year: 2027 }), NOW);
    assert.deepEqual(far.events[1]!.triggers, [
      "TRIGGER;RELATED=START:-P30D",
      "TRIGGER;RELATED=START:-P7D",
    ]);
    // A file-by date already behind (the weekend before a Monday deadline): the reminder moves to the deadline.
    const weekend = await protestCal(
      PROTEST({ tax_year: 2027 }),
      Date.UTC(2027, 4, 15, 15),
    );
    assert.deepEqual(
      weekend.events.map((e) => e.summary),
      ["Texas protest filing deadline, tax year 2027"],
    );
    assert.ok(
      weekend.events[0]!.triggers.includes(
        "TRIGGER;VALUE=DATE-TIME:20270515T160000Z",
      ),
    );
    assert.ok(
      weekend.lines.some((l) => /1 date before 2027-05-15 is left out/.test(l)),
    );
  });

  it("a passed tax year: next season's pair instead, with the passed year said in each description; include_past keeps the passed pair", async () => {
    const { lines, events } = await protestCal(PROTEST({ tax_year: 2026 }));
    assert.deepEqual(
      events.map((e) => [e.summary, e.start]),
      [
        ["Texas protest filing deadline, tax year 2027", "20270517"],
        ["Conservative file-by date, tax year 2027", "20270514"],
      ],
    );
    for (const e of events) {
      assert.match(
        e.description,
        /Tax year 2026: its deadline 2026-05-15 passed \(status passed as of 2026-11-07\)\. These dates are the rule's next_season for tax year 2027\./,
      );
      assert.match(
        e.description,
        /next_season is computed with no notice delivery date/,
      );
    }
    assert.ok(
      lines.some((l) => /requested tax year's deadline has passed/.test(l)),
    );
    const all = await protestCal(
      PROTEST({ tax_year: 2026 }, { include_past: true }),
    );
    assert.deepEqual(
      all.events.map((e) => [e.summary, e.start, e.triggers.length]),
      [
        ["Texas protest filing deadline, tax year 2026", "20260515", 0],
        ["Conservative file-by date, tax year 2026", "20260515", 0],
        ["Texas protest filing deadline, tax year 2027", "20270517", 0],
        ["Conservative file-by date, tax year 2027", "20270514", 2],
      ],
    );
    assert.match(
      all.events[0]!.description,
      /This deadline passed: status passed as of 2026-11-07\./,
    );
    assert.match(
      all.events[1]!.description,
      /The same day as the statutory deadline: 2026-05-15 is a business day/,
    );
  });

  it("a portfolio (batch): one calendar, each event labelled by the item's id, the notice date as the basis", async () => {
    const items = [
      {
        id: "HCAD 0412340010025",
        tax_year: 2027,
        notice_delivered_date: "2027-04-28",
      },
      { id: "TAD 41234567", tax_year: 2027 },
      { id: "DCAD 00000776533000000", tax_year: 2026 },
    ];
    const { f, lines, events } = await protestCal(
      PROTEST({ items }, { context: { title: "Gulf Coast portfolio 2027" } }),
    );
    assert.equal(f.source, "rules_tx_property_tax_protest_deadline_batch@1");
    assert.ok(lines.includes("X-WR-CALNAME:Gulf Coast portfolio 2027"));
    assert.deepEqual(
      events.map((e) => [e.summary, e.start]),
      [
        [
          "Texas protest filing deadline, tax year 2027 (HCAD 0412340010025)",
          "20270528",
        ],
        [
          "Conservative file-by date, tax year 2027 (HCAD 0412340010025)",
          "20270528",
        ],
        [
          "Texas protest filing deadline, tax year 2027 (TAD 41234567)",
          "20270517",
        ],
        ["Conservative file-by date, tax year 2027 (TAD 41234567)", "20270514"],
        [
          "Texas protest filing deadline, tax year 2027 (DCAD 00000776533000000)",
          "20270517",
        ],
        [
          "Conservative file-by date, tax year 2027 (DCAD 00000776533000000)",
          "20270514",
        ],
      ],
    );
    assert.match(
      events[0]!.description,
      /the 30th day after the notice of appraised value was delivered \(2027-04-28\)/,
    );
    assert.match(
      events[2]!.description,
      /No notice delivery date given/,
      "the item's own warning",
    );
    assert.ok(
      !events[0]!.description.includes("No notice delivery date given"),
    );
    assert.match(
      events[4]!.description,
      /Tax year 2026: its deadline 2026-05-15 passed/,
    );
    for (const e of events) {
      assert.ok(e.description.includes(TX_DISCLAIMER));
      assert.ok(e.description.includes(TX_SOFTWARE));
      assert.equal(adviceIn(e.description), undefined);
      assert.ok(
        !/\n\nAs of/.test(e.description),
        "no blank line where a fact is absent",
      );
    }
    const uids = events.map((e) => e.uid);
    assert.equal(new Set(uids).size, uids.length, "unique UIDs");
  });

  it("UIDs are stable per (notice, tax year, event): the same on another day, in another order, after a date changes", async () => {
    const items = [
      { id: "A-1", tax_year: 2027 },
      { id: "B-2", tax_year: 2027 },
    ];
    const byKey = (evs: IcsEv[]) =>
      Object.fromEntries(evs.map((e) => [e.summary, e.uid]));
    const a = byKey((await protestCal(PROTEST({ items }))).events);
    const b = byKey(
      (
        await protestCal(
          PROTEST({
            items: [
              { id: "B-2", tax_year: 2027 },
              {
                id: "A-1",
                tax_year: 2027,
                notice_delivered_date: "2027-05-03",
              },
            ],
          }),
          MAY_1,
        )
      ).events,
    );
    assert.deepEqual(b, a, "a later notice date moves the event, not its UID");
    // A passed year's next season has the UIDs a calendar for that year has.
    const next = byKey(
      (await protestCal(PROTEST({ items: [{ id: "A-1", tax_year: 2026 }] })))
        .events,
    );
    assert.equal(
      next["Texas protest filing deadline, tax year 2027 (A-1)"],
      a["Texas protest filing deadline, tax year 2027 (A-1)"],
    );
    const single = async (args: Json, now = NOW) =>
      (
        await protestCal(
          PROTEST(args, { context: { title: "HCAD 0412340010025" } }),
          now,
        )
      ).events.map((e) => e.uid);
    assert.deepEqual(
      await single({ tax_year: 2027 }),
      await single(
        { tax_year: 2027, notice_delivered_date: "2027-05-01" },
        MAY_1,
      ),
    );
    assert.notDeepEqual(
      await single({ tax_year: 2027 }),
      await single({ tax_year: 2028 }),
    );
  });

  it("validation: 400 with issues and next; a batch item the rule cannot answer is refused, never left out", async () => {
    const e1 = await rejects(
      PROTEST({ tax_year: 1999 }),
      "ArgumentsError",
      /^arguments\.tax_year$/,
    );
    assert.match(e1.next ?? "", /rules_tx_property_tax_protest_deadline/);
    const e2 = await rejects(
      PROTEST({ tax_year: 2027, notice_delivered_date: "2026-04-01" }),
      "ArgumentsError",
    );
    assert.ok(e2.issues.length > 0);
    await rejects(
      PROTEST({ tax_year: 2027, county: "201" }),
      "ArgumentsError",
      /county/,
    );
    await rejects(PROTEST(undefined), "ArgumentsRequired", /^arguments$/);
    const e3 = await rejects(
      {
        kind: "tx_protest_deadline",
        format: "xlsx",
        arguments: { tax_year: 2027 },
      },
      "InputError",
      /^format$/,
    );
    assert.match(e3.next ?? "", /"ics", "pdf"/);
    const e4 = await rejects(
      PROTEST({
        items: [
          { id: "A", tax_year: 2027 },
          { id: "B", tax_year: 1999 },
        ],
      }),
      "ArgumentsError",
      /^arguments\.items\.1\.tax_year$/,
    );
    assert.match(e4.next ?? "", /_batch/);
    await rejects(
      PROTEST({
        items: [{ id: "Owner A: you should protest", tax_year: 2027 }],
      }),
      "TextNotAllowed",
      /^arguments\.items\.0\.id$/,
    );
  });

  it("PDF: a one-page deadline sheet with both disclaimers, the ch. 1152 sentence and the rule's dates", async () => {
    const f = await createReport(
      {
        kind: "tx_protest_deadline",
        format: "pdf",
        arguments: { tax_year: 2027 },
      },
      { now: MAY_1 },
    );
    const p = await readPdf(f.bytes);
    const text = p.text.replace(/\s+/g, " ");
    // The sheet is the first page; the audit trail, inputs and provenance follow.
    assert.ok(p.pages <= 2, `${p.pages} pages`);
    assert.ok(text.includes("2027-05-17") && text.includes("2027-05-14"));
    assert.ok(text.includes("not a substitute for the advice of an attorney"));
    assert.ok(text.includes("§1103.003(1)"));
    assert.ok(text.includes("chapter 1152"));
    assert.ok(!/you should|recommend|protest your/i.test(text));
  });

  it("the advice filter takes the Texas disclaimer and the statute terms, and still refuses a valuation", () => {
    assert.equal(adviceIn(TX_DISCLAIMER), undefined);
    assert.equal(adviceIn(TX_SOFTWARE), undefined);
    for (const ok of [
      "Texas protest filing deadline, tax year 2027",
      "protest with the appraisal review board",
      "notice of appraised value",
      "Conservative file-by date",
    ])
      assert.equal(adviceIn(ok), undefined, ok);
    assert.equal(adviceIn("our opinion of value is $4M"), "opinion of value");
    assert.equal(adviceIn("an opinion of value"), "opinion of value");
  });
});

// --- Texas packet: sources and rights ------------------------------------------------------------

const DOC_ROLL =
  "fl:document:sha256-1d126a7c278cfd3998a899c06b8eea84cb0621ea1a1ef56a6c1bbb7ef616f0ff";
const DOC_BLDG = `fl:document:sha256-${"ab".repeat(32)}`;
const DOC_OTHER = `fl:document:sha256-${"cd".repeat(32)}`;
const comp = (id: string, value: number, area: number, citation?: Json) => ({
  id,
  county_fips: "201",
  value,
  value_basis: "appraised",
  improvement_area_sf: area,
  ...(citation ? { citation } : {}),
});
/** A registry-built packet (the QA request's shape): citations on some comparables, sources with rights. */
const TX_CITED = {
  kind: "tx_unequal_appraisal",
  context: {
    title: "HCAD 0412340010025, tax year 2026",
    sources: [
      {
        document_id: DOC_ROLL,
        source_id: "tx-hcad-roll",
        title: "Harris Central Appraisal District: Real property roll 2026",
        uri: "https://hcad.org/pdata/",
        retrieved_at: "2026-11-01T00:00:00Z",
        as_of: "2026-04-15",
        rights: {
          ai_use: "permitted",
          redistribution: "attribution_required",
          license: "Texas Public Information Act",
          attribution: "Harris Central Appraisal District",
        },
      },
      {
        document_id: DOC_BLDG,
        source_id: "tx-hcad-bldg",
        title: "Harris Central Appraisal District: Building file 2026",
        uri: "https://hcad.org/bldg/",
        as_of: "2026-04-16",
        rights: {
          ai_use: "unknown",
          redistribution: "unknown",
          license: null,
          attribution: null,
        },
      },
    ],
  },
  arguments: {
    tax_year: 2026,
    subject: {
      id: "HCAD 0412340010025",
      county_fips: "201",
      value: 4850000,
      value_basis: "appraised",
      improvement_area_sf: 42500,
    },
    normalize_by: "improvement_area_sf",
    comparables: [
      comp("HCAD 0412340010031", 4120000, 39800, {
        document_id: DOC_ROLL,
        locator: "account 0412340010031",
        as_of: "2026-04-15",
      }),
      comp("HCAD 0412340020012", 3650000, 36200, {
        document_id: DOC_ROLL,
        as_of: "2026-04-15",
      }),
      comp("HCAD 0412350030007", 5300000, 47000, {
        document_id: DOC_BLDG,
        as_of: "2026-04-16",
      }),
      comp("HCAD 0412350040019", 4410000, 41000, {
        document_id: DOC_OTHER,
        as_of: "2026-04-15",
      }),
      comp("HCAD 0412360050003", 3980000, 38500, { fact_id: "fl:fact:x1" }),
      comp("HCAD 0412360060021", 4675000, 43100),
    ],
  },
};

describe("Texas packet: sources and rights", () => {
  it("PDF: after the grid, each cited source with its as-of date, URL and rights; unknown rights said so; every comparable kept", async () => {
    const f = await createReport({ ...TX_CITED, format: "pdf" }, { now: NOW });
    const text = (await readPdf(f.bytes)).text.replace(/\s+/g, " ");
    const at = (x: string) => {
      const i = text.indexOf(x);
      assert.ok(i >= 0, x);
      return i;
    };
    assert.ok(at("Comparables grid") < at("Sources and rights"));
    assert.ok(at("Sources and rights") < at("Adjustments and reasons"));
    // A URL wraps in its narrow column: look for it with the line breaks taken out.
    const joined = text.replace(/ /g, "");
    for (const url of ["https://hcad.org/pdata/", "https://hcad.org/bldg/"])
      assert.ok(joined.includes(url), url);
    for (const x of [
      "Real property roll 2026",
      "2026-04-15",
      "2026-04-16",
      "AI use: permitted;",
      "attribution_required;",
      "Texas Public Information Act",
      RIGHTS_UNKNOWN,
      "Cited without a source document ID: HCAD 0412360050003.",
      "No citation given (kept in the grid): HCAD 0412360060021.",
    ])
      at(x);
    for (const c of TX_CITED.arguments.comparables)
      assert.ok(
        text.split(c.id).length - 1 >= 3,
        `${c.id} in the grid, the adjusted list and the citations`,
      );
    assert.ok(!/you should|recommend|protest your/i.test(text));
  });

  it("workbook: the Provenance sheet has the same block, rights word for word", async () => {
    const x = await readXlsx(
      (await createReport({ ...TX_CITED, format: "xlsx" }, { now: NOW })).bytes,
    );
    const prov = x.values("Provenance");
    assert.ok(prov.includes("Sources and rights"));
    assert.ok(
      prov.includes(
        "AI use: permitted; redistribution: attribution_required; license: Texas Public Information Act; attribution: Harris Central Appraisal District",
      ),
    );
    assert.ok(prov.includes(RIGHTS_UNKNOWN));
    assert.ok(
      prov.includes(SOURCE_NOT_SENT),
      "a cited document without a sources entry",
    );
    assert.ok(prov.includes("https://hcad.org/bldg/"));
    assert.ok(prov.includes(DOC_OTHER));
    assert.ok(
      prov.includes("HCAD 0412340010031, HCAD 0412340020012"),
      "one row per source, naming what cites it",
    );
    assert.equal(
      prov.filter((v) => v.startsWith("fl:document:")).length,
      3,
      "each distinct source once",
    );
    const grid = x.values("Grid");
    for (const c of TX_CITED.arguments.comparables)
      assert.ok(grid.includes(c.id), c.id);
  });

  it("one right unknown: the other is printed as stated; no sources sent: each cited document says so", async () => {
    assert.equal(
      (await import("./kinds/tx.ts")).rightsText({
        ai_use: "permitted",
        redistribution: "unknown",
      }),
      `AI use: permitted; redistribution: ${RIGHTS_UNKNOWN}`,
    );
    const x = await readXlsx(
      (
        await createReport(
          {
            ...TX_CITED,
            format: "xlsx",
            context: { title: TX_CITED.context.title },
          },
          { now: NOW },
        )
      ).bytes,
    );
    assert.equal(
      x.values("Provenance").filter((v) => v === SOURCE_NOT_SENT).length,
      3,
    );
  });

  it("context.sources is checked: a URL must be http(s), and advice wording is refused like other caller text", async () => {
    const src = TX_CITED.context.sources[0]!;
    await rejects(
      {
        ...TX_CITED,
        format: "pdf",
        context: { sources: [{ ...src, uri: "javascript:alert(1)" }] },
      },
      "InputError",
      /^context\.sources\.0\.uri$/,
    );
    await rejects(
      {
        ...TX_CITED,
        format: "pdf",
        context: {
          sources: [
            {
              ...src,
              rights: {
                ...src.rights,
                license: "you should protest your value",
              },
            },
          ],
        },
      },
      "TextNotAllowed",
      /^context\.sources\.0\.rights\.license$/,
    );
  });
});
