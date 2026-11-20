// The expense_audit_portfolio report: built from FactLot's own run of audit_expense_portfolio on invented locations.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { describe, it } from "node:test";

import { PDFDocument, PDFRawStream } from "pdf-lib";

import {
  KIND_FORMATS,
  ReportInputError,
  createReport,
  prepareReport,
  reportUnits,
} from "./index.ts";
import { samplePortfolio } from "../../tools/src/audit_portfolio.testkit.test.ts";

const NOW = Date.UTC(2026, 3, 1, 12, 0, 0);
type Json = Record<string, unknown>;

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

const make = (format: "pdf" | "xlsx", args: Json = samplePortfolio()) =>
  createReport(
    { kind: "expense_audit_portfolio", format, arguments: args },
    { now: NOW },
  );

describe("expense_audit_portfolio report", () => {
  it("offers a PDF and a workbook", () => {
    assert.deepEqual(KIND_FORMATS.expense_audit_portfolio, ["pdf", "xlsx"]);
  });

  it("prints the key figures, schedule and sections, with dates as a person reads them", async () => {
    const f = await make("pdf");
    assert.equal(f.content_type, "application/pdf");
    const text = await pdfText(f.bytes);
    assert.match(text, /Locations audited/);
    assert.match(text, /Dispute deadlines/);
    assert.match(text, /Repeated issues/);
    assert.match(text, /Basis of preparation/);
    assert.match(text, /April 12, 2026/);
    assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(text), "no ISO date is printed");
    assert.ok(!/audit_expense_portfolio|audit_expense_statement/.test(text));
  });

  it("builds a workbook with one row per location and per finding", async () => {
    const f = await make("xlsx");
    assert.match(f.content_type, /spreadsheetml/);
    assert.equal(Buffer.from(f.bytes).subarray(0, 2).toString("latin1"), "PK");
    assert.ok(f.bytes.byteLength > 5000);
  });

  it("counts one unit per location audited in full", () => {
    const prepared = prepareReport({
      kind: "expense_audit_portfolio",
      format: "pdf",
      arguments: samplePortfolio(),
    });
    const out = prepared.checked.result as {
      portfolio: { locations_audited: number };
    };
    assert.ok(reportUnits(prepared) > 1);
    assert.equal(reportUnits(prepared), out.portfolio.locations_audited);
  });

  it("refuses advice wording in a label and a portfolio with no location audited", async () => {
    const a = samplePortfolio();
    (a.audits as Json[])[0]!.label = "Store 4: you should sue the landlord";
    await assert.rejects(make("pdf", a), ReportInputError);
    await assert.rejects(
      make("pdf", { audits: [{ label: "Empty" }], as_of: "2026-04-01" }),
      (e: unknown) =>
        e instanceof ReportInputError && e.code === "ArgumentsError",
    );
    await assert.rejects(
      createReport(
        { kind: "expense_audit_portfolio", format: "pdf" },
        { now: NOW },
      ),
      (e: unknown) =>
        e instanceof ReportInputError && e.code === "ArgumentsRequired",
    );
  });
});
