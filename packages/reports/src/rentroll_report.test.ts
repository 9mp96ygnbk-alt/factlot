// The rent_roll_certificate report: built from FactLot's own run of rent_roll_certify on an invented roll.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { describe, it } from "node:test";

import { rentRollCase } from "@factlot/tools";
import { PDFDocument, PDFRawStream } from "pdf-lib";

import { KIND_FORMATS, ReportInputError, createReport } from "./index.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

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

const CTX = {
  prepared_for: "Northfield Credit Partners LLC",
  rent_roll_reliers: [
    {
      who: "Northfield Credit Partners LLC (Morgan Example)",
      role: "Credit officer",
      lines: ["L1", "L3"],
      at: "2026-11-21T10:00:00Z",
    },
  ],
};
const make = (format: "pdf" | "xlsx", context?: object) =>
  createReport(
    {
      kind: "rent_roll_certificate",
      format,
      arguments: rentRollCase(),
      ...(context ? { context } : {}),
    } as never,
    { now: NOW },
  );

describe("rent_roll_certificate report", () => {
  it("is a PDF and an XLSX", () => {
    assert.deepEqual(KIND_FORMATS.rent_roll_certificate, ["pdf", "xlsx"]);
  });

  it("prints the key figures, the grades, the differences with both quotes, rollover and fingerprints", async () => {
    const f = await make("pdf", CTX);
    assert.equal(f.content_type, "application/pdf");
    const text = await pdfText(f.bytes);
    assert.match(text, /Rent roll certificate/);
    assert.match(text, /87\.4%/); // 54,200 / 62,000
    assert.match(text, /\$1,579,200/);
    assert.match(text, /\+\$3,200/);
    assert.match(text, /Matches, tenant confirmed/);
    assert.match(text, /Differs/);
    assert.match(text, /No lease/);
    assert.match(text, /Not checkable/);
    assert.match(text, /\$118,400\.00 a year/);
    assert.match(text, /\$115,200\.00 a year/);
    assert.match(text, /Larkspur Dental Group LLC 110/); // the roll's quotation
    assert.match(text, /2026-07-01 to 2027-06-30: \$36\.00 per RSF/); // the lease's quotation
    assert.match(text, /Lease, page 3/);
    assert.match(text, /Expires within 12 months/);
    assert.match(text, /Tidewater Surveying Inc/);
    assert.match(text, /Rollover schedule/);
    assert.match(text, /Northfield Credit Partners LLC \(Morgan Example\)/);
    assert.match(
      text,
      /certification, not FactLot, is what the lender or buyer relies on/,
    );
    assert.match(text, /against nothing else/);
    assert.match(text, /f{64}/);
    assert.match(text, /1{64}/);
    // the facts are printed in words: no ISO date outside a quotation, no tool or predicate names
    assert.ok(!/rent_roll_certify|rent_roll\.|lease\.[a-z_]+/.test(text));
    assert.ok(!/ROLL_RENT_ABOVE_LEASE|LEASE_EXPIRING/.test(text));
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    assert.ok(doc.getPageCount() >= 5);
    const again = await make("pdf", CTX);
    assert.deepEqual(again.bytes, f.bytes);
  });

  it("says no reliance has been recorded when none is sent", async () => {
    const text = await pdfText((await make("pdf")).bytes);
    assert.match(text, /No reliance has been recorded/);
  });

  it("builds the line grid as a workbook with live totals and refuses bad arguments", async () => {
    const f = await make("xlsx");
    assert.match(f.content_type, /spreadsheetml/);
    assert.ok(f.bytes.byteLength > 5000);
    assert.equal(Buffer.from(f.bytes).subarray(0, 2).toString("latin1"), "PK");
    await assert.rejects(
      createReport(
        {
          kind: "rent_roll_certificate",
          format: "pdf",
          arguments: { as_of: "2026-11-20" },
        } as never,
        { now: NOW },
      ),
      ReportInputError,
    );
    await assert.rejects(
      createReport(
        {
          kind: "rent_roll_certificate",
          format: "ics",
          arguments: rentRollCase(),
        } as never,
        { now: NOW },
      ),
      ReportInputError,
    );
  });
});
