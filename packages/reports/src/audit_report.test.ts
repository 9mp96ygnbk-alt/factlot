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
    assert.match(text, /Expense statement audit, 2025/);
    assert.match(text, /CAP_EXCEEDED\.1/);
    assert.match(text, /FEE_ON_EXCLUDED_LINES\.1/);
    assert.match(text, /\$217\.00/);
    assert.match(text, /\$4,000\.00/);
    assert.match(text, /2026-07-08/);
    assert.match(text, /certified mail/);
    assert.match(text, /page 4/);
    assert.match(text, /five percent \(5%\) per year/);
    assert.match(text, /Checks that could not run/);
    assert.match(text, /not legal conclusions/);
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
});
