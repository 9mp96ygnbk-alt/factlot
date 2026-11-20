// The estoppel_certificate report: built from FactLot's own run of estoppel_prepare on invented facts.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { describe, it } from "node:test";

import { PDFDocument, PDFRawStream } from "pdf-lib";

import { KIND_FORMATS, ReportInputError, createReport } from "./index.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
type Json = Record<string, unknown>;

const DOC_A = "fl:document:sha256-" + "a".repeat(64);
const DOC_B = "fl:document:sha256-" + "b".repeat(64);
const SUBJECT = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4";

let n = 0;
function fact(
  predicate: string,
  value: unknown,
  quote: string,
  opts: {
    doc?: string;
    page?: number;
    valid_from?: string;
    supersedes?: string[];
    id?: string;
  } = {},
): Json {
  n += 1;
  return {
    id: opts.id ?? `flf_e${n}`,
    subject: SUBJECT,
    predicate,
    value,
    as_of: "2026-03-01",
    ...(opts.valid_from ? { valid_from: opts.valid_from } : {}),
    ...(opts.supersedes ? { supersedes: opts.supersedes } : {}),
    provenance: {
      method: "extracted",
      sources: [
        { document_id: opts.doc ?? DOC_A, page: opts.page ?? 1, quote },
      ],
    },
  };
}

/** The invented lease: Alder Court Holdings LLC lets Suite 210 to Birchwood Analytics Inc; one amendment extends the term. */
function leaseFacts(): Json[] {
  n = 0;
  return [
    fact(
      "lease.landlord",
      "Alder Court Holdings LLC",
      "entered into by Alder Court Holdings LLC (“Landlord”)",
      { id: "flf_landlord" },
    ),
    fact(
      "lease.tenant",
      "Birchwood Analytics Inc",
      "and Birchwood Analytics Inc (“Tenant”)",
      { id: "flf_tenant" },
    ),
    fact(
      "lease.commencement_date",
      "2023-07-01",
      "The Commencement Date is July 1, 2023.",
      { id: "flf_comm" },
    ),
    fact(
      "lease.expiration_date",
      "2028-06-30",
      "The Term shall expire on June 30, 2028.",
      { id: "flf_exp_old", page: 2 },
    ),
    fact(
      "lease.expiration_date",
      "2033-06-30",
      "The Term shall expire on June 30, 2033.",
      {
        id: "flf_exp_new",
        doc: DOC_B,
        valid_from: "2026-01-01",
        supersedes: ["flf_exp_old"],
      },
    ),
    fact(
      "lease.rentable_area_sf",
      8400,
      "containing approximately 8,400 rentable square feet",
      { id: "flf_area" },
    ),
    fact(
      "lease.base_rent_schedule",
      [
        { from: "2023-07-01", to: "2024-06-30", annual_rent_psf: 30 },
        { from: "2024-07-01", to: "2025-06-30", annual_rent_psf: 30.9 },
        { from: "2025-07-01", to: "2026-06-30", annual_rent_psf: 31.83 },
        { from: "2026-07-01", to: "2027-06-30", annual_rent_psf: 32.78 },
        { from: "2027-07-01", to: "2028-06-30", annual_rent_psf: 33.76 },
      ],
      "July 1, 2023 to June 30, 2024: $30.00 per RSF; July 1, 2024 to June 30, 2025: $30.90 per RSF; July 1, 2025 to June 30, 2026: $31.83 per RSF; July 1, 2026 to June 30, 2027: $32.78 per RSF; July 1, 2027 to June 30, 2028: $33.76 per RSF",
      { id: "flf_rent_old", page: 3 },
    ),
    fact(
      "lease.base_rent_schedule",
      [{ from: "2028-07-01", to: "2033-06-30", annual_rent_psf: 36 }],
      "July 1, 2028 to June 30, 2033: $36.00 per RSF",
      {
        id: "flf_rent_new",
        doc: DOC_B,
        valid_from: "2026-01-01",
        supersedes: ["flf_rent_old"],
      },
    ),
    fact("lease.security_deposit", 30000, "a security deposit of $30,000.00", {
      id: "flf_dep",
      page: 4,
    }),
    fact(
      "lease.free_rent",
      { months: 3, applies_to: "base_rent" },
      "Base Rent shall be abated for the first three (3) months of the Term",
      { id: "flf_free", page: 3 },
    ),
    fact(
      "lease.ti_allowance",
      168000,
      "Landlord shall provide a tenant improvement allowance of $168,000.00",
      { id: "flf_ti", page: 5 },
    ),
    fact(
      "lease.renewal_option",
      {
        count: 1,
        term_months: 60,
        notice_months: 12,
        rent: "95% of Fair Market Rent",
      },
      "Tenant shall have one (1) option to extend the Term for sixty (60) months by notice given not less than twelve (12) months before expiration, at 95% of Fair Market Rent",
      { id: "flf_renew", page: 6 },
    ),
  ];
}

function args(): Json {
  return {
    lease_facts: leaseFacts(),
    parties: {
      tenant: { organisation: "Birchwood Analytics Inc" },
      landlord: { organisation: "Alder Court Holdings LLC" },
      requested_by: {
        organisation: "Northfield Credit Partners LLC",
        role: "lender",
      },
    },
    premises: { label: "Alder Court, Suite 210" },
    as_of: "2026-11-20",
  };
}
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
  estoppel_answers: [
    {
      key: "S03",
      decision: "agreed" as const,
      by: "Tenant officer",
      at: "2026-11-25T10:00:00Z",
    },
    {
      key: "S06",
      decision: "disputed" as const,
      note: "Current rent differs",
      tenants_own_version: "$270,000.00 a year",
      by: "Tenant officer",
      at: "2026-11-25T10:05:00Z",
    },
  ],
  estoppel_reliers: [
    {
      who: "Northfield Credit Partners LLC (lender)",
      role: "lender",
      statements: ["S03"],
      at: "2026-11-26T09:00:00Z",
    },
  ],
};

describe("estoppel_certificate report", () => {
  it("is a PDF only", () => {
    assert.deepEqual(KIND_FORMATS.estoppel_certificate, ["pdf"]);
  });

  it("prints the statements with quotes and pages, the tenant's answers, signature and fingerprints", async () => {
    const a = args();
    const f = await createReport(
      {
        kind: "estoppel_certificate",
        format: "pdf",
        arguments: a,
        context: CTX,
      },
      { now: NOW },
    );
    assert.equal(f.content_type, "application/pdf");
    const text = await pdfText(f.bytes);
    assert.match(text, /Tenant estoppel certificate/);
    assert.match(text, /\$275,352\.00/);
    assert.match(text, /June 30, 2033/);
    assert.match(text, /Superseded, page 2/);
    assert.match(text, /Tenant agrees/);
    assert.match(text, /Tenant disputes/);
    assert.match(text, /\$270,000\.00 a year/);
    assert.match(text, /Awaiting the tenant/);
    assert.match(text, /Northfield Credit Partners LLC \(lender\)/);
    assert.match(text, /not FactLot/);
    assert.match(text, /a{64}/);
    assert.match(text, /b{64}/);
    assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(text), "no ISO date is printed");
    const doc = await PDFDocument.load(f.bytes, { updateMetadata: false });
    assert.ok(doc.getPageCount() >= 4);
    const again = await createReport(
      {
        kind: "estoppel_certificate",
        format: "pdf",
        arguments: a,
        context: CTX,
      },
      { now: NOW },
    );
    assert.deepEqual(again.bytes, f.bytes);
  });

  it("prints the signed-electronically line, the signature record and the content fingerprint", async () => {
    const hash = "c".repeat(64);
    const f = await createReport(
      {
        kind: "estoppel_certificate",
        format: "pdf",
        arguments: args(),
        context: {
          ...CTX,
          estoppel_reliers: [
            {
              ...CTX.estoppel_reliers[0]!,
              statements_disputed: ["S06"],
            },
          ],
          estoppel_signature: {
            signed: true,
            signer_name: "Tess Tenant",
            signer_title: "Vice President, Finance",
            signer_organisation: "Birchwood Analytics Inc",
            signed_at: "2026-11-25T10:07:00.000Z",
            consent_version: "estoppel-consent-test.1",
            consent_text:
              "By ticking this box I confirm that:\n(1) I am authorised to sign.",
            content_sha256: hash,
            content_check: "unchanged" as const,
          },
        },
      },
      { now: NOW },
    );
    const text = await pdfText(f.bytes);
    assert.match(
      text,
      /Signed electronically by Tess Tenant, Vice President, Finance, November 25, 2026/,
    );
    assert.match(text, /Electronic signature record/);
    assert.match(text, /estoppel-consent-test\.1/);
    assert.match(text, /c{64}/);
    assert.match(text, /unchanged since signing/);
    assert.match(text, /acknowledged by this party: S06/);
    assert.ok(!/Signature, for/.test(text), "no blank signature lines");
  });

  it("builds without answers and refuses other formats and bad arguments", async () => {
    const f = await createReport(
      { kind: "estoppel_certificate", format: "pdf", arguments: args() },
      { now: NOW },
    );
    assert.match(
      await pdfText(f.bytes),
      /No answer from the tenant is recorded here yet/,
    );
    await assert.rejects(
      createReport(
        { kind: "estoppel_certificate", format: "xlsx", arguments: args() },
        { now: NOW },
      ),
      ReportInputError,
    );
    await assert.rejects(
      createReport(
        {
          kind: "estoppel_certificate",
          format: "pdf",
          arguments: { as_of: "2026-11-20" },
        },
        { now: NOW },
      ),
      ReportInputError,
    );
  });
});
