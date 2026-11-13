// property_sheet: one page for one parcel, from the registry answer the host hands over.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

import { PDFDocument, PDFRawStream } from "pdf-lib";

import { runTool } from "@factlot/tools";

import { texasDeadline } from "./kinds/sheet.ts";
import {
  ENTITY_NOT_PRINTED,
  SHEET_CONTACT_LINE,
  OWNER_NOT_ORGANISATION,
  OWNER_NOT_PUBLISHED,
  OWNER_PERSON_STYLE,
  ReportInputError,
  SHEET_BOUNDARY,
  SHEET_FACTS,
  TX_DISCLAIMER,
  attachRegistry,
  createReport,
  prepareReport,
  registryUrn,
  unzip,
  type RegistryLookup,
} from "./index.ts";

/** 2026-11-12 18:00 UTC: after the 2026 deadline, so the rule gives tax year 2027's. */
const NOW = Date.UTC(2026, 10, 12, 18, 0, 0);

const URN = "fl:parcel:us-48201:0010010000001";
const ENTITY = "fl:entity:us-tx:32001234567";
const DOC = "fld_harris2026";
const DOC_OLD = "fld_harris2025";
const DOC_ENT = "fld_txsos";

const rights = {
  ai_use: "unknown",
  redistribution: "unknown",
  license: "Public record; no licence stated by the publisher",
};
const src = (doc: string, title: string) => ({
  document_id: doc,
  title,
  uri: "https://hcad.org/pdata/",
  retrieved_at: "2026-11-08",
  section: "row 0010010000001",
});
const f = (
  id: string,
  predicate: string,
  value: unknown,
  doc = DOC,
  asOf = "2026-07-25",
  unit?: string,
) => ({
  id,
  subject: URN,
  predicate,
  value,
  as_of: asOf,
  ...(unit ? { unit } : {}),
  provenance: {
    method: "extracted",
    sources: [
      src(
        doc,
        doc === DOC_ENT
          ? "Texas Comptroller: Franchise tax permit holders"
          : "Harris Central Appraisal District: Real property roll 2026",
      ),
    ],
  },
  rights,
});

/** Values a free caller must never see on a sheet. */
const EARLIER = [7_777_777, 7_676_767, 6_666_666, 6_565_656];

function record(over: Record<string, unknown> = {}) {
  return {
    urn: URN,
    kind: "parcel",
    short: "flp_x",
    label: "1000 LOUISIANA ST HOUSTON TX 77002",
    status: "current",
    facts: [
      f("f1", "parcel.situs_address", "1000 LOUISIANA ST HOUSTON TX 77002"),
      f("f2", "parcel.apn", "0010010000001"),
      f("f3", "parcel.market_value", 10_101_010, DOC, "2026-07-25", "USD"),
      f("f4", "parcel.appraised_value", 10_202_020, DOC, "2026-07-25", "USD"),
      f("f5", "parcel.tax_year", 2026),
      f("f6", "parcel.improvement_area_sf", 1_250_000, DOC, "2026-07-25", "sf"),
      f("f7", "parcel.year_built", 1983),
      f("f8", "parcel.state_property_category", "F1"),
      f("f9", "parcel.land_area_sf", 52_000, DOC, "2026-07-25", "sf"),
      f("f10", "ownership.owner_of_record", "LOUISIANA TOWER HOLDINGS LLC"),
    ],
    relationships: [
      {
        from_urn: ENTITY,
        type: "owns",
        to_urn: URN,
        as_of: "2026-07-25",
        method: "inferred",
        confidence: 0.9,
        basis: "name match",
        document_id: DOC,
      },
    ],
    crosswalk: [],
    building: null,
    value_history: [
      {
        tax_year: 2026,
        market_value: 10_101_010,
        appraised_value: 10_202_020,
        as_of: "2026-07-25",
        citations: {
          market_value: {
            fact_id: "f3",
            document_id: DOC,
            as_of: "2026-07-25",
          },
          appraised_value: {
            fact_id: "f4",
            document_id: DOC,
            as_of: "2026-07-25",
          },
        },
      },
      {
        tax_year: 2025,
        market_value: EARLIER[0],
        appraised_value: EARLIER[1],
        as_of: "2025-07-25",
        citations: {
          market_value: {
            fact_id: "o1",
            document_id: DOC_OLD,
            as_of: "2025-07-25",
          },
          appraised_value: {
            fact_id: "o2",
            document_id: DOC_OLD,
            as_of: "2025-07-25",
          },
        },
      },
      {
        tax_year: 2024,
        market_value: EARLIER[2],
        appraised_value: EARLIER[3],
        as_of: "2024-07-25",
        citations: {
          market_value: {
            fact_id: "o3",
            document_id: DOC_OLD,
            as_of: "2024-07-25",
          },
          appraised_value: {
            fact_id: "o4",
            document_id: DOC_OLD,
            as_of: "2024-07-25",
          },
        },
      },
    ],
    warnings: [],
    ...over,
  };
}

const entity = {
  urn: ENTITY,
  kind: "entity",
  label: "LOUISIANA TOWER HOLDINGS LLC",
  status: "current",
  facts: [
    {
      ...f(
        "e1",
        "entity.legal_name",
        "LOUISIANA TOWER HOLDINGS LLC",
        DOC_ENT,
        "2026-11-01",
      ),
      subject: ENTITY,
    },
    {
      ...f("e2", "entity.status", "Active", DOC_ENT, "2026-11-01"),
      subject: ENTITY,
    },
    {
      ...f(
        "e3",
        "entity.registry_number",
        "32001234567",
        DOC_ENT,
        "2026-11-01",
      ),
      subject: ENTITY,
    },
    {
      ...f(
        "e4",
        "entity.mailing_address",
        "PO BOX 1 HOUSTON TX",
        DOC_ENT,
        "2026-11-01",
      ),
      subject: ENTITY,
    },
  ],
  relationships: [],
  crosswalk: [],
  warnings: [],
};

/** The free answer as the Worker's gating leaves it (gating.ts limitHistory). */
function freeRecord() {
  const r = record();
  return {
    ...r,
    value_history: [r.value_history[0]],
    history_available: "pro",
    history_withheld: { tax_years: [2025, 2024], count: 2 },
    history_note:
      "2 earlier roll years, 2024 and 2025, are available with a Pro or Team key: https://factlot.com/pricing/",
  };
}

const request = (format: "pdf" | "xlsx" | "ics" = "pdf", over = {}) => ({
  kind: "property_sheet",
  format,
  arguments: { urn: URN },
  ...over,
});

async function readPdf(bytes: Uint8Array) {
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
  return { pages: doc.getPageCount(), text };
}

async function xlsxText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  return [...files.values()].map((d) => new TextDecoder().decode(d)).join("\n");
}

/** PDF text with line breaks folded, for phrase checks across wrapped lines. */
const flat = (t: string) => t.replace(/\s+/g, " ");

describe("property_sheet", () => {
  it("free: one page, the current roll year only, the earlier years named with the pricing link", async () => {
    const lookup: RegistryLookup = {
      record: freeRecord(),
      plan: "free",
      entity,
    };
    const file = await createReport(request(), { now: NOW, registry: lookup });
    assert.equal(file.content_type, "application/pdf");
    assert.equal(file.source, "registry_get");
    assert.match(
      file.filename,
      /^factlot-property-sheet-0010010000001-2026-11-12\.pdf$/,
    );
    const pdf = await readPdf(file.bytes);
    assert.equal(pdf.pages, 1, "one page");
    const t = flat(pdf.text);
    for (const want of [
      "1000 LOUISIANA ST HOUSTON TX 77002",
      URN,
      "0010010000001",
      "Harris County (FIPS 48201)",
      "LOUISIANA TOWER HOLDINGS LLC",
      "the registry's match (inferred, confidence 0.9)",
      "Active",
      "32001234567",
      "$10,101,010.00",
      "$10,202,020.00",
      "2026",
      "2 earlier roll years, 2024 and 2025, are available with a Pro or Team key: https://factlot.com/pricing/",
      "1,250,000 sq ft",
      "1983",
      "F1",
      "52,000 sq ft",
      "Next general protest deadline: 2027-05-17 (tax year 2027)",
      "Tex. Tax Code §41.44(a)(1)",
      "It is not this account's deadline",
      "Harris Central Appraisal District",
      "Texas Comptroller",
      "Public record; no licence stated by the publisher",
      SHEET_FACTS,
      TX_DISCLAIMER,
    ])
      assert.ok(t.includes(want), `has ${want}`);
    for (const v of EARLIER) {
      const shown = `$${v.toLocaleString("en-US")}`;
      assert.ok(!t.includes(shown), `free sheet leaks ${shown}`);
    }
    assert.ok(!t.includes("2025-07-25") && !t.includes("2024-07-25"));
    assert.ok(!t.includes("PO BOX"), "no entity mailing address");
  });

  it("free: cuts to the current roll year even when handed every year (never more than the API)", async () => {
    const file = await createReport(request("xlsx"), {
      now: NOW,
      registry: { record: record(), plan: "free" },
    });
    const x = await xlsxText(file.bytes);
    for (const v of EARLIER) assert.ok(!x.includes(String(v)), `leaks ${v}`);
    assert.ok(x.includes("10101010"));
    assert.ok(
      x.includes(
        "2 earlier roll years, 2024 and 2025, are available with a Pro or Team key: https://factlot.com/pricing/",
      ),
    );
    const pdf = await createReport(request(), {
      now: NOW,
      registry: { record: record(), plan: "free" },
    });
    const t = flat((await readPdf(pdf.bytes)).text);
    for (const v of EARLIER)
      assert.ok(!t.includes(`$${v.toLocaleString("en-US")}`));
  });

  it("Pro: every roll year held, newest first, each with its source file's as-of date", async () => {
    const file = await createReport(request(), {
      now: NOW,
      registry: { record: record(), plan: "pro", entity },
    });
    const pdf = await readPdf(file.bytes);
    assert.equal(pdf.pages, 1);
    const t = flat(pdf.text);
    for (const v of EARLIER)
      assert.ok(t.includes(`$${v.toLocaleString("en-US")}`), `has ${v}`);
    assert.ok(t.includes("2025-07-25") && t.includes("2024-07-25"));
    assert.ok(t.includes("Every roll year the registry holds for this parcel"));
    assert.ok(!t.includes("Free tier"));
    assert.ok(t.indexOf("$10,101,010.00") < t.indexOf("$7,777,777.00"));
  });

  it("Pro: eleven roll years, a registry note and three sources still fit one page", async () => {
    const r = record({
      warnings: [
        "This parcel record has no improvement facts (parcel.improvement_area_sf, parcel.year_built), so its values may be for the land only: it may be vacant land, the source may not publish building facts for it, or the building may be assessed on another account.",
      ],
    });
    r.facts.push(
      f("f11", "parcel.local_use_code", "4300", DOC),
      f("f12", "parcel.building_class", "A", DOC),
      f("f13", "parcel.num_floors", 36, DOC),
    );
    // Each roll year is its own file; a paid answer's history describes the earlier ones.
    const docOf = (i: number) => (i === 0 ? DOC : `fld_harris${2026 - i}`);
    const history = Array.from({ length: 11 }, (_, i) => ({
      ...f(
        `m${i}`,
        "parcel.market_value",
        10_000_000 - i * 100_000,
        docOf(i),
        `${2026 - i}-07-25`,
        "USD",
      ),
      provenance: {
        method: "extracted",
        sources: [
          src(
            docOf(i),
            `Harris Central Appraisal District: Real property roll ${2026 - i}`,
          ),
        ],
      },
    }));
    const withHistory = { ...r, history };
    withHistory.value_history = Array.from({ length: 11 }, (_, i) => ({
      tax_year: 2026 - i,
      market_value: 10_000_000 - i * 100_000,
      appraised_value: 9_900_000 - i * 100_000,
      as_of: `${2026 - i}-07-25`,
      citations: {
        market_value: {
          fact_id: `m${i}`,
          document_id: docOf(i),
          as_of: `${2026 - i}-07-25`,
        },
        appraised_value: {
          fact_id: `a${i}`,
          document_id: docOf(i),
          as_of: `${2026 - i}-07-25`,
        },
      },
    }));
    const file = await createReport(request(), {
      now: NOW,
      registry: { record: withHistory, plan: "team", entity },
    });
    const pdf = await readPdf(file.bytes);
    assert.equal(pdf.pages, 1);
    const t = flat(pdf.text);
    assert.ok(t.includes("2016") && t.includes("$9,000,000.00"));
    // The eleven roll files share one source row; each value keeps its own file's date.
    assert.ok(t.includes("Harris Central Appraisal District: 11 files"), t);
    assert.ok(t.includes("[1] 2016-07-25"));
    assert.ok(!t.includes("[3]"), "two source rows");
    assert.ok(t.includes("as the Team plan returns it"));
    assert.ok(t.includes("laid out by code with no model"));
  });

  it("owner wording: not published, not an organisation, or written like a person's trust", async () => {
    const noOwner = (urn: string) => {
      const r = record({ urn });
      return {
        ...r,
        facts: r.facts
          .filter((x) => x.predicate !== "ownership.owner_of_record")
          .map((x) => ({ ...x, subject: urn })),
        relationships: [],
      };
    };
    const la = "fl:parcel:us-06037:5151015013";
    const sheet = async (rec: unknown, urn: string) =>
      flat(
        (
          await readPdf(
            (
              await createReport(
                { ...request(), arguments: { urn } },
                {
                  now: NOW,
                  registry: {
                    record: rec,
                    plan: "free",
                    entity,
                  },
                },
              )
            ).bytes,
          )
        ).text,
      );
    const laSheet = await sheet(noOwner(la), la);
    assert.ok(laSheet.includes(OWNER_NOT_PUBLISHED));
    assert.ok(laSheet.includes(SHEET_BOUNDARY), "the boundary outside Texas");
    assert.ok(laSheet.includes("Los Angeles County (FIPS 06037)"));
    assert.ok(
      (await sheet(noOwner(URN), URN)).includes(OWNER_NOT_ORGANISATION),
    );
    const trust = record();
    trust.facts = trust.facts.map((x) =>
      x.predicate === "ownership.owner_of_record"
        ? { ...x, value: "SMITH FAMILY TRUST DTD 1999" }
        : x,
    );
    // The rule runs inside the sheet itself: no flag from the host is needed.
    const t = await sheet(trust, URN);
    assert.ok(t.includes(OWNER_PERSON_STYLE));
    assert.ok(!t.includes("SMITH"), "the owner's name is not printed");
    assert.ok(!t.includes("LOUISIANA TOWER HOLDINGS"), "nor the linked entity");
    // Outside Texas: no deadline section.
    assert.ok(!(await sheet(noOwner(la), la)).includes("protest deadline"));
  });

  it("takes a parcel URN and nothing else: no input, no context, no other argument", async () => {
    const reg = { record: record(), plan: "free" as const };
    for (const [req, code, path] of [
      [
        request("pdf", { arguments: { urn: "1000 Louisiana St" } }),
        "ArgumentsError",
        "arguments.urn",
      ],
      [
        request("pdf", { arguments: { urn: "fl:entity:us-tx:1" } }),
        "ArgumentsError",
        "arguments.urn",
      ],
      [
        request("pdf", { arguments: { urn: URN, as_of: "2024-01-01" } }),
        "ArgumentsError",
        "arguments",
      ],
      [
        request("pdf", { arguments: undefined }),
        "ArgumentsRequired",
        "arguments.urn",
      ],
      [request("pdf", { input: record() }), "InputError", "input"],
      [
        request("pdf", { context: { prepared_for: "Jane Doe" } }),
        "InputError",
        "context",
      ],
      [request("ics"), "InputError", "format"],
    ] as const) {
      await assert.rejects(
        createReport(req, { now: NOW, registry: reg }),
        (err: unknown) => {
          assert.ok(err instanceof ReportInputError, String(err));
          assert.equal(err.code, code, err.message);
          assert.ok(
            err.issues.some((i) => i.path === path),
            JSON.stringify(err.issues),
          );
          return true;
        },
      );
    }
    // Without the host's lookup the package refuses (it never reads a registry).
    await assert.rejects(createReport(request(), { now: NOW }), /hosted API/);
  });

  it("prepares without the answer, names the parcel, and refuses an answer for another parcel", () => {
    const p = prepareReport(request(), { now: NOW });
    assert.equal(registryUrn(p), URN);
    assert.throws(() =>
      attachRegistry(p, {
        record: record({ urn: "fl:parcel:us-48201:other" }),
        plan: "free",
      }),
    );
    assert.equal(
      registryUrn(
        prepareReport(
          {
            kind: "tx_protest_deadline",
            format: "pdf",
            arguments: { tax_year: 2027 },
          },
          { now: NOW },
        ),
      ),
      undefined,
    );
  });

  it("rights: printed as the other reports print them, and sources with different terms never share a row", async () => {
    const r = record();
    // The same publisher, two files with different recorded terms.
    r.facts = r.facts.map((x) =>
      x.predicate === "parcel.year_built"
        ? {
            ...x,
            provenance: {
              method: "extracted",
              sources: [
                src(
                  "fld_other",
                  "Harris Central Appraisal District: Building file 2026",
                ),
              ],
            },
            rights: {
              ai_use: "permitted",
              redistribution: "attribution_required",
              license: "CC BY 4.0",
              attribution: "Harris Central Appraisal District",
            },
          }
        : x,
    );
    const t = flat(
      (
        await readPdf(
          (
            await createReport(request(), {
              now: NOW,
              registry: { record: r, plan: "free" },
            })
          ).bytes,
        )
      ).text,
    );
    assert.ok(
      t.includes("rights not stated by the publisher: relay to the recipient"),
    );
    assert.ok(
      t.includes("AI use: permitted; redistribution: attribution_required"),
    );
    assert.ok(
      t.includes("[2] 1983") || t.includes("[2] 2026-07-25"),
      "a row of its own",
    );
    assert.ok(!/\bunknown\b/.test(t), "no raw unknown");
  });

  it("boundary: the pages' sentences and the removal and correction line; Texas keeps its disclaimer", async () => {
    const pdfText = async (urn: string) => {
      const r = record({ urn });
      r.facts = r.facts.map((x) => ({ ...x, subject: urn }));
      return flat(
        (
          await readPdf(
            (
              await createReport(
                { ...request(), arguments: { urn } },
                { now: NOW, registry: { record: r, plan: "free" } },
              )
            ).bytes,
          )
        ).text,
      );
    };
    const dc = await pdfText("fl:parcel:us-11001:0376-0068");
    assert.ok(dc.includes(SHEET_BOUNDARY));
    assert.ok(
      dc.includes("not a substitute for checking the source") &&
        dc.includes(SHEET_CONTACT_LINE),
    );
    const tx = await pdfText(URN);
    assert.ok(
      tx.includes(`${SHEET_FACTS} ${TX_DISCLAIMER} ${SHEET_CONTACT_LINE}`),
    );
  });

  it("the entity: not printed when the host withheld it, or when its name reads like a person's", async () => {
    const pdf = async (ent: unknown) =>
      flat(
        (
          await readPdf(
            (
              await createReport(request(), {
                now: NOW,
                registry: { record: record(), plan: "free", entity: ent },
              })
            ).bytes,
          )
        ).text,
      );
    const none = await pdf(undefined);
    assert.ok(none.includes("LOUISIANA TOWER HOLDINGS LLC"), "the owner stays");
    assert.ok(none.includes(ENTITY_NOT_PRINTED));
    assert.ok(!none.includes("32001234567") && !none.includes("Active"));
    const person = structuredClone(entity);
    person.facts[0]!.value = "DOE JOHN TR";
    const p = await pdf(person);
    assert.ok(p.includes(ENTITY_NOT_PRINTED) && !p.includes("DOE JOHN"));
  });

  it("deadline: a passed season with no next one prints no date", () => {
    const passedNoNext: typeof runTool = (name, args) => {
      const out = runTool(name, args);
      assert.ok(out.ok);
      const r = structuredClone(out.result) as {
        value: Record<string, unknown>;
      };
      r.value.status = "passed";
      r.value.next_season = null;
      return { ok: true, result: r } as ReturnType<typeof runTool>;
    };
    assert.equal(texasDeadline(NOW, passedNoNext), null);
    assert.ok(texasDeadline(NOW)?.deadline.startsWith("2027-"));
  });

  it("worst case: many registry notes and long source URLs fit two pages with nothing cut", async () => {
    const long = `https://example.org/${"roll-files/".repeat(30)}real_acct.zip`;
    const notes = Array.from(
      { length: 8 },
      (_, i) =>
        `Registry note ${i + 1}: parcel.land_area_sf is 0: a land area must be positive, so the source's value is not usable; the building may be assessed on another account at the same address.`,
    );
    const r = record({ warnings: notes });
    r.facts = r.facts.map((x) => ({
      ...x,
      provenance: {
        method: "extracted",
        sources: [{ ...x.provenance.sources[0]!, uri: long }],
      },
    }));
    const file = await createReport(request(), {
      now: NOW,
      registry: { record: r, plan: "pro", entity },
    });
    const pdf = await readPdf(file.bytes);
    assert.ok(pdf.pages <= 2, `${pdf.pages} pages`);
    const squeezed = pdf.text.replace(/\s+/g, "");
    assert.ok(squeezed.includes(long), "the URL in full");
    for (const n of notes)
      assert.ok(squeezed.includes(n.replace(/\s+/g, "")), n);
    assert.ok(!pdf.text.includes("characters"), "no cut-text note");
  });

  it("is the same bytes for the same answer and time", async () => {
    const opts = {
      now: NOW,
      registry: { record: freeRecord(), plan: "free" as const },
    };
    const a = await createReport(request("xlsx"), opts);
    const b = await createReport(request("xlsx"), opts);
    assert.deepEqual(a.bytes, b.bytes);
  });
});
