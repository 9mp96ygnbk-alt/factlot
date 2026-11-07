// @factlot/reports: input checks, every kind × format as a valid file, determinism, bundle size.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

import { runTool } from "@factlot/tools";
import { build } from "esbuild";
import { PDFDocument, PDFRawStream } from "pdf-lib";

import { fold } from "./ics.ts";
import { pct, usd, num } from "./format.ts";
import {
  KIND_FORMATS,
  REPORT_KINDS,
  ReportInputError,
  TX_DISCLAIMER,
  createReport,
  unzip,
  type ReportKind,
} from "./index.ts";

const VECTORS = new URL("../../../spec/vectors/", import.meta.url);
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

type Json = Record<string, unknown>;

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
  it("prints the tool's numbers exactly", () => {
    assert.equal(pct(0.1554), "15.54%");
    assert.equal(pct(0.07388606), "7.388606%");
    assert.equal(pct(-0.061033), "-6.1033%");
    assert.equal(pct(1.25), "125%");
    assert.equal(usd(-130000), "-$130,000.00");
    assert.equal(usd(1989999.5), "$1,989,999.50");
    assert.equal(num(1e-7), "0.0000001");
    assert.equal(num(23874596.957531843), "23,874,596.957531843");
  });
});

describe("input checks", () => {
  for (const s of SAMPLES)
    it(`${s.tool}: every successful vector case passes, with and without arguments`, async () => {
      const name = s.tool.replace(/^calc_/, "");
      const all =
        s.tool === "doc_abstract_lease" ? abstractCases : calcCases(name);
      assert.ok(all.length > 0);
      for (const args of all) {
        const input = resultOf(s.tool, args);
        const a = await createReport(
          { kind: s.kind, format: "pdf", input },
          { now: NOW },
        );
        assert.equal(a.check, "checked");
        const b = await createReport(
          { kind: s.kind, format: "pdf", input, arguments: args },
          { now: NOW },
        );
        assert.equal(b.check, "recomputed");
      }
    });

  const tx = SAMPLES[0]!;
  const txResult = () =>
    structuredClone(resultOf(tx.tool, tx.args)) as {
      value: Json;
      formula: Json;
      steps: unknown[];
    };

  it("arguments alone: FactLot computes the result", async () => {
    const f = await createReport(
      { kind: "debt_sizing", format: "pdf", arguments: SAMPLES[4]!.args },
      { now: NOW },
    );
    assert.equal(f.check, "computed");
    assert.equal(f.source, "calc_debt_sizing@3");
  });

  it("a hand-edited figure is refused", async () => {
    const r = txResult();
    r.value.median_adjusted_value =
      (r.value.median_adjusted_value as number) - 1000;
    await rejects(
      { kind: "tx_unequal_appraisal", format: "pdf", input: r },
      "NotAToolResult",
      /median_adjusted_value/,
    );
    const d = structuredClone(
      resultOf("calc_dcf_pro_forma", SAMPLES[7]!.args),
    ) as { value: Json };
    d.value.value = (d.value.value as number) * 1.1;
    await rejects(
      { kind: "dcf_summary", format: "xlsx", input: d },
      "NotAToolResult",
      /value\.value/,
    );
    const c = structuredClone(
      resultOf("calc_cam_reconciliation", SAMPLES[2]!.args),
    ) as { value: Json };
    c.value.balance_due = 1;
    await rejects(
      { kind: "cam_reconciliation", format: "pdf", input: c },
      "NotAToolResult",
      /balance_due/,
    );
  });

  it("an unknown field, a wrong formula or another tool's result is refused", async () => {
    const r = txResult();
    (r.value as Json).recommendation = "protest";
    await rejects(
      { kind: "tx_unequal_appraisal", format: "pdf", input: r },
      "NotAToolResult",
    );
    const v = txResult();
    v.formula.version = 99;
    await rejects(
      { kind: "tx_unequal_appraisal", format: "pdf", input: v },
      "FormulaVersion",
    );
    await rejects(
      {
        kind: "debt_sizing",
        format: "pdf",
        input: resultOf("calc_dcf_pro_forma", SAMPLES[7]!.args),
      },
      "NotAToolResult",
    );
    await rejects(
      { kind: "debt_sizing", format: "pdf", input: { value: { max_loan: 1 } } },
      "NotAToolResult",
    );
  });

  it("a result that does not match its arguments is refused", async () => {
    const args = structuredClone(SAMPLES[4]!.args);
    const input = resultOf("calc_debt_sizing", args);
    (args as Json).noi = (args.noi as number) + 1;
    await rejects(
      { kind: "debt_sizing", format: "pdf", input, arguments: args },
      "ResultMismatch",
    );
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
      "InputError",
      /input/,
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
    for (const k of REPORT_KINDS.filter((k) => k !== "critical_dates"))
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
        const footer = `Generated by FactLot 0.4.0 on 2026-11-07 12:00:00 UTC from ${f.source}; numbers are the tool's results; see https://factlot.com/terms`;
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
              "Generated by FactLot 0.4.0 on 2026-11-07 12:00:00 UTC",
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
              l.startsWith("PRODID:-//FactLot//Reports 0.4.0//EN"),
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
        input: r,
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
    for (const args of [s.args, undefined]) {
      const f = await createReport(
        {
          kind: "tx_unequal_appraisal",
          format: "xlsx",
          input: r,
          ...(args ? { arguments: args } : {}),
        },
        { now: NOW },
      );
      const x = await readXlsx(f.bytes);
      assert.deepEqual(x.sheets, [
        "ReadMe",
        "Reconcile",
        "Grid",
        "Steps",
        "Law",
      ]);
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
        input: r,
        context: { title: "Suite 400, 100 Main" },
      },
      { now: NOW },
    );
    const lines = readIcs(f.bytes);
    const events = lines.filter((l) => l === "BEGIN:VEVENT").length;
    const windows = r.value.renewal_terms.filter((t) => t.window_opens).length;
    assert.equal(events, r.value.events.length + windows);
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
      lines.some((l) => l.startsWith("SUMMARY:Suite 400\\, 100 Main:")),
      "commas escaped",
    );
    assert.ok(lines.includes(`DTSTAMP:20261107T120000Z`));
  });

  it("is deterministic: the same request at the same time gives the same bytes", async () => {
    for (const s of SAMPLES)
      for (const format of KIND_FORMATS[s.kind]) {
        const req = { kind: s.kind, format, input: resultOf(s.tool, s.args) };
        const a = await createReport(req, { now: NOW });
        const b = await createReport(req, { now: NOW });
        assert.deepEqual(a.bytes, b.bytes, `${s.tool} ${format}`);
      }
  });

  it("supplied text never becomes a formula and odd characters are written safely", async () => {
    const title = '=HYPERLINK("http://x","y") & <b> "Café" — 5 ≤ 6 中';
    const s = SAMPLES[4]!;
    const input = resultOf(s.tool, s.args);
    const x = await readXlsx(
      (
        await createReport(
          { kind: "debt_sizing", format: "xlsx", input, context: { title } },
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
          { kind: "debt_sizing", format: "pdf", input, context: { title } },
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
        const req = {
          kind: s.kind,
          format: i % 2 ? "pdf" : "xlsx",
          input: resultOf(s.tool, s.args),
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
