// The expense_audit report: built from FactLot's own run of audit_expense_statement on invented facts.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { describe, it } from "node:test";

import { runTool } from "@factlot/tools";
import { PDFDocument, PDFRawStream } from "pdf-lib";

import { KIND_FORMATS, ReportInputError, createReport } from "./index.ts";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
type Json = Record<string, unknown>;
const DOC = "fl:document:sha256-" + "b".repeat(64);

let n = 0;
function fact(
  predicate: string,
  value: unknown,
  quote: string,
  page = 1,
): Json {
  return {
    id: `flf_r${++n}`,
    subject: "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4",
    predicate,
    value,
    as_of: "2026-03-01",
    provenance: {
      method: "extracted",
      sources: [{ document_id: DOC, page, quote }],
    },
  };
}

function args(): Json {
  n = 0;
  const lease_facts = [
    fact("lease.pro_rata_share", 0.08, "Tenant's Proportionate Share is 8.00%"),
    fact(
      "lease.cam_cap",
      { method: "compounding_from_base", rate: 0.05 },
      "Controllable Operating Expenses shall not increase by more than five percent (5%) per year, on a cumulative and compounding basis",
      4,
    ),
    fact(
      "lease.cam_admin_fee",
      {
        rate: 0.1,
        base: "actual",
        excluded_from_base: ["real estate taxes", "insurance"],
      },
      "Landlord may charge an administrative fee of 10% of Operating Expenses, excluding real estate taxes and insurance",
      5,
    ),
    fact(
      "lease.audit_right",
      {
        window_days: 120,
        starts_from: "statement_receipt",
        notice_form: "written notice by certified mail",
      },
      "Tenant may audit within 120 days after receipt of the statement by written notice sent by certified mail",
      6,
    ),
  ];
  const line = (label: string, amount: number, controllable: boolean) =>
    fact(
      "statement.line",
      { label, amount, controllable },
      `${label} ${amount.toLocaleString("en-US")}`,
      2,
    );
  const statement_facts = [
    fact(
      "statement.period",
      { year: 2025, statement_date: "2026-03-01", received_date: "2026-03-10" },
      "Statement dated March 1, 2026, received March 10, 2026",
      1,
    ),
    fact("statement.share_applied", { share: 0.08 }, "Tenant's share 8.00%", 2),
    fact(
      "statement.admin_fee",
      { rate: 0.1, base_amount: 68000, amount: 6800 },
      "Administrative fee 10% of 68,000 = 6,800",
      2,
    ),
    fact(
      "statement.cap_reference",
      { year: 2022, amount: 24000 },
      "Base year controllable share 24,000",
      3,
    ),
    fact("statement.cap_applied", { limit: null }, "No cap applied", 2),
    line("Real estate taxes", 400000, false),
    line("Insurance", 100000, false),
    line("Janitorial", 150000, true),
    line("Repairs and maintenance", 120000, true),
    line("Landscaping", 80000, true),
  ];
  return { lease_facts, statement_facts, as_of: "2026-04-01" };
}

/** The text drawn on each page (pdf-lib writes standard-font text as hex WinAnsi strings). */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let text = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let data: Buffer;
    try {
      data = obj.dict.toString().includes("FlateDecode")
        ? inflateSync(obj.contents)
        : Buffer.from(obj.contents);
    } catch {
      continue;
    }
    for (const m of data.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g))
      text += Buffer.from(m[1]!, "hex").toString("latin1") + "\n";
  }
  return text.replace(/\s+/g, " ");
}

describe("expense_audit report", () => {
  it("is a PDF only", () => {
    assert.deepEqual(KIND_FORMATS.expense_audit, ["pdf"]);
  });

  it("prints the summary, each finding with its quote and page, the deadline and what did not run", async () => {
    const a = args();
    const f = await createReport(
      {
        kind: "expense_audit",
        format: "pdf",
        arguments: a,
        context: { prepared_for: "Birchwood Analytics Inc" },
      },
      { now: NOW },
    );
    assert.match(f.filename, /^factlot-[a-z0-9-]+-2026-11-07\.pdf$/);
    assert.equal(f.content_type, "application/pdf");
    const text = await pdfText(f.bytes);
    assert.match(text, /Operating expense statement audit/);
    assert.match(text, /Expense statement audit, 2025/);
    assert.match(text, /Prepared for Birchwood Analytics Inc/);
    // the two figures a reader compares are comparable totals: the fee the landlord's base
    // gives ($6,800.00) and the lease's ($2,800.00), and the difference is theirs ($4,000.00)
    assert.match(text, /\$6,800\.00/);
    assert.match(text, /\$2,800\.00/);
    assert.match(text, /\$4,000\.00/);
    assert.match(text, /\$217\.00/);
    // dates as a person reads them, never ISO
    assert.match(text, /July 8, 2026/);
    assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(text), "no ISO date is printed");
    assert.match(text, /certified mail/);
    assert.match(text, /Lease, page 5/);
    assert.match(text, /five percent \(5%\) per year/);
    assert.match(text, /Checks not performed/);
    assert.match(text, /Basis of preparation/);
    // plain words in the basis of preparation, no internal wording
    assert.ok(!/audit_expense_statement|arguments sent|Computed:/.test(text));
    assert.match(text, /the same facts always give the same findings/);
    assert.match(text, /listed as not performed rather than guessed/);
    // the Sources table names terms in words, not dotted predicates
    assert.match(text, /Administrative fee/);
    assert.ok(!/lease\.cam_admin_fee|statement\.line/.test(text));
    assert.match(text, /Important information/);
    assert.match(text, /Page 2 of \d+/);
    // the footer: one line, no URL
    assert.match(
      text,
      /Prepared from the documents supplied\. Not legal advice\. FactLot /,
    );
    assert.ok(!/https?:\/\/|factlot\.com/.test(text), "no URL anywhere");
    // fact ids are in the Sources appendix only, never in the body before it
    const at = text.indexOf("Sources");
    assert.ok(at > 0);
    assert.ok(!/flf_/.test(text.slice(0, text.lastIndexOf("Sources"))));
    assert.match(text.slice(text.lastIndexOf("Sources")), /flf_r\d+/);
    // no identifier codes in the body
    assert.ok(!/CAP_EXCEEDED|FEE_ON_EXCLUDED_LINES/.test(text));
    // standard fonts only; deterministic
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    assert.ok(doc.getPageCount() >= 3);
    const again = await createReport(
      {
        kind: "expense_audit",
        format: "pdf",
        arguments: a,
        context: { prepared_for: "Birchwood Analytics Inc" },
      },
      { now: NOW },
    );
    assert.deepEqual(again.bytes, f.bytes);
    // the run is FactLot's: a result sent with the request is compared, never used
    const out = runTool("audit_expense_statement", a);
    assert.ok(out.ok);
  });

  it("needs the tool's arguments and refuses what the tool refuses", async () => {
    await assert.rejects(
      createReport({ kind: "expense_audit", format: "pdf" }, { now: NOW }),
      (e: unknown) =>
        e instanceof ReportInputError && e.code === "ArgumentsRequired",
    );
    await assert.rejects(
      createReport(
        { kind: "expense_audit", format: "xlsx", arguments: args() },
        { now: NOW },
      ),
      (e: unknown) => e instanceof ReportInputError,
    );
    const bad = args();
    (
      (bad.lease_facts as Json[])[0]!.provenance as { sources: unknown[] }
    ).sources = [];
    await assert.rejects(
      createReport(
        { kind: "expense_audit", format: "pdf", arguments: bad },
        { now: NOW },
      ),
      (e: unknown) =>
        e instanceof ReportInputError && e.code === "ArgumentsError",
    );
  });

  it("never leaves a heading alone at the foot of a page, and never draws outside the margins", async () => {
    // a case with many findings so the layout has to break pages
    const a = args();
    n += 100;
    const sf = a.statement_facts as Json[];
    const idx = (p: string) => sf.findIndex((x) => x.predicate === p);
    sf[idx("statement.share_applied")] = fact(
      "statement.share_applied",
      { share: 0.09 },
      "Tenant's share 9.00%",
      2,
    );
    const long = "The landlord states the amount in a long sentence. ".repeat(
      6,
    );
    sf.push(
      fact(
        "statement.line",
        { label: "Janitorial", amount: 150000, controllable: true },
        `Janitorial 150,000 ${long}`,
        2,
      ),
      fact(
        "statement.line",
        { label: "Advertising", amount: 20000, controllable: true },
        `Advertising 20,000 ${long}`,
        2,
      ),
    );
    (a.lease_facts as Json[]).push(
      fact(
        "lease.cam_exclusion",
        { category: "advertising" },
        "Operating Expenses exclude advertising costs",
        3,
      ),
    );
    const f = await createReport(
      { kind: "expense_audit", format: "pdf", arguments: a },
      { now: NOW },
    );
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    // each page's content stream, in page order (registered in page order)
    const streams: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const ops = inflateSync(obj.contents).toString("latin1");
      if (ops.includes(" Tf ")) streams.push(ops);
    }
    assert.equal(streams.length, doc.getPageCount());
    assert.ok(streams.length >= 4);
    for (const [i, ops] of streams.entries()) {
      const texts = [
        ...ops.matchAll(
          /\/(F\d) ([\d.]+) Tf ([\d.]+) ([\d.]+) Td <([0-9A-Fa-f]*)> Tj/g,
        ),
      ].map((m) => ({
        font: m[1]!,
        size: Number(m[2]),
        x: Number(m[3]),
        y: Number(m[4]),
        text: Buffer.from(m[5]!, "hex").toString("latin1"),
      }));
      // body text only: above the footer line (y > 61.2) and below the running header
      const body = texts.filter((t) => t.y > 61.2 + 4 && t.y < 792 - 0.9 * 72);
      for (const t of body) {
        assert.ok(
          t.x >= 0.95 * 72 - 0.01,
          `page ${i + 1}: text left of the margin`,
        );
        assert.ok(t.y >= 61.2, `page ${i + 1}: text below the bottom margin`);
      }
      // the lowest body text is not a section heading (Times bold 13.5) or a subheading (10.5)
      const lowest = body.reduce((m, t) => (t.y < m.y ? t : m), body[0]!);
      assert.ok(
        !(
          lowest.font === "F4" &&
          (lowest.size === 13.5 || lowest.size === 10.5)
        ),
        `page ${i + 1} ends on a heading: ${lowest.text}`,
      );
    }
  });
  it("prints whether the figures were computed by FactLot and unchanged since, only when known", async () => {
    const make = (context?: object) =>
      createReport(
        {
          kind: "expense_audit",
          format: "pdf",
          arguments: args(),
          ...(context ? { context } : {}),
        },
        { now: NOW },
      );
    const att = await pdfText(
      (
        await make({
          package_attestation: {
            status: "attested",
            tool: "audit_expense_statement",
            key_id: "k1",
          },
        })
      ).bytes,
    );
    assert.match(att, /Verification of the figures/);
    assert.match(att, /Computed by FactLot and unchanged since/);
    const no = await pdfText(
      (await make({ package_attestation: { status: "unattested" } })).bytes,
    );
    assert.match(no, /Not verified/);
    assert.ok(
      !/Verification of the figures/.test(await pdfText((await make()).bytes)),
    );
  });
});
