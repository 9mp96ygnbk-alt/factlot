/**
 * property_sheet: one page for one parcel, laid out from the hosted registry's registry_get answer
 * as the caller's plan returns it. The host looks the parcel up for the caller (gated and metered
 * like any registry_get of theirs) and hands the answer over; this file prints what that answer
 * holds and nothing else. A free caller's answer keeps the current roll year only, and the sheet
 * cuts it again so it can never show more than the API would.
 *
 * Owners: the registry keeps owners of record only for organisations. An owner written like a
 * person's estate or trust is not printed (the host says so, by the property pages' rule), and the
 * linked entity is then left out too. Only the entity's name, status and registry number are read.
 *
 * Texas parcels get the next general protest deadline from rules_tx_property_tax_protest_deadline,
 * labelled as the general rule: an account's own deadline depends on its notice date.
 */
import { texasToday } from "@factlot/calc";
import { countyName, ownerNamesAPerson, runTool } from "@factlot/tools";

import type { Block, Raw, ReportDoc } from "../doc.ts";
import { PARCEL_URN } from "../validate.ts";
import { subtitle, type KindInput } from "./common.ts";
import { TX_DISCLAIMER, rightsText } from "./tx.ts";

/** Where the plans are (the Worker's GATING_PRICING_URL; a Worker test pins the two together). */
export const SHEET_PRICING_URL = "https://factlot.com/pricing/";

/** Where a person named in a record, or a wrong record, is reported (the Worker's CONTACT; a test pins them). */
export const SHEET_CONTACT = "contact@factlot.com";
/** The property pages' removal and correction line, word for word. */
export const SHEET_CONTACT_LINE = `If a record names you as a person, or is wrong, email ${SHEET_CONTACT} and we will remove or correct it.`;
/** What every value on a sheet is (the property pages' first sentence, word for word). */
export const SHEET_FACTS =
  "A record shown here is a public-record fact as its publisher released it.";
/**
 * The boundary a sheet outside Texas prints: the property pages' sentences word for word. A Texas sheet
 * prints SHEET_FACTS, the Texas disclaimer and SHEET_CONTACT_LINE.
 */
export const SHEET_BOUNDARY = `${SHEET_FACTS} It is not an appraisal or an opinion of value, not legal or tax advice, and not a substitute for checking the source. ${SHEET_CONTACT_LINE}`;
/** Said when the registry links an entity whose details the sheet does not print. */
export const ENTITY_NOT_PRINTED =
  "The registry links this owner to a registered entity; its details are not printed on this sheet.";

/** Places whose hosted source publishes no owner names (the /try/ page and the market pages say the same). */
const NO_OWNER_REGIONS = [
  /^us-06037$/,
  /^us-06075$/,
  /^us-24\d{3}$/,
  /^us-49\d{3}$/,
];

export const OWNER_NOT_PUBLISHED =
  "This source does not publish owner names, so the record has no owner of record.";
export const OWNER_NOT_ORGANISATION =
  "The record has no owner of record: the registry keeps owners only when they are organisations, so the owner is not an organisation or the source left it blank.";
export const OWNER_PERSON_STYLE =
  "Not printed: the owner of record is written like a person's estate or trust, and this sheet never prints a person's name.";

export type SheetPlan = "free" | "pro" | "team";

/** What the host looked up for the sheet. */
export interface RegistryLookup {
  /** registry_get's answer for the parcel, as the caller's plan returns it. */
  record: unknown;
  plan: SheetPlan;
  /**
   * The linked entity's registry_get record, when the host read it and the property pages' rule lets
   * its facts be shown (its sources may be republished). Only its name, status and registry number
   * are printed, and none of them when its name reads like a person's.
   */
  entity?: unknown;
}

interface Rights {
  license?: string;
  attribution?: string;
  redistribution?: string;
  ai_use?: string;
}
interface FactSource {
  document_id?: string;
  title?: string;
  uri?: string;
  retrieved_at?: string;
}
interface Fact {
  id?: string;
  predicate: string;
  value: unknown;
  as_of?: string;
  unit?: string;
  provenance?: { sources?: FactSource[] };
  rights?: Rights;
}
interface Citation {
  fact_id?: string;
  document_id?: string;
  as_of?: string;
}
interface ValueEntry {
  tax_year?: number | null;
  market_value?: number | null;
  appraised_value?: number | null;
  as_of?: string;
  citations?: Record<string, Citation | null | undefined>;
}
interface ParcelRecord {
  urn: string;
  kind?: string;
  label?: string;
  facts?: Fact[];
  relationships?: Record<string, unknown>[];
  value_history?: ValueEntry[];
  warnings?: unknown[];
  history?: Fact[];
  history_withheld?: { tax_years?: number[] };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The record, checked to be the parcel asked for (anything else is a fault, not the caller's). */
export function parcelRecord(record: unknown, urn: string): ParcelRecord {
  if (!isObj(record) || record.urn !== urn)
    throw new Error("property_sheet: the registry answer is not this parcel");
  if (record.kind !== undefined && record.kind !== "parcel")
    throw new Error("property_sheet: the registry answer is not a parcel");
  return {
    ...(record as unknown as ParcelRecord),
    facts: Array.isArray(record.facts) ? (record.facts as Fact[]) : [],
    history: Array.isArray(record.history) ? (record.history as Fact[]) : [],
  };
}

/** The value_history entries of the newest tax year (the first entry when none has a year). */
export function currentYearEntries(vh: ValueEntry[]): ValueEntry[] {
  if (vh.length === 0) return [];
  const years = vh
    .map((e) => e?.tax_year)
    .filter((y): y is number => typeof y === "number");
  if (years.length === 0) return vh.slice(0, 1);
  const current = Math.max(...years);
  return vh.filter((e) => e?.tax_year === current);
}

const fact = (rec: ParcelRecord, predicate: string): Fact | undefined =>
  (rec.facts ?? []).find((f) => f?.predicate === predicate);

const text = (f: Fact | undefined): string | null =>
  f && (typeof f.value === "string" || typeof f.value === "number")
    ? String(f.value).trim() || null
    : null;

function yearsInWords(years: number[]): string {
  const n = years.length;
  const asc = [...years].sort((x, y) => x - y);
  const contiguous = asc.every(
    (y, i) => i === 0 || y === (asc[i - 1] ?? Number.NaN) + 1,
  );
  const label = `${n} earlier roll ${n === 1 ? "year" : "years"}`;
  if (n === 1) return `${label}, ${asc[0]}`;
  if (contiguous && n > 2) return `${label}, ${asc[0]} to ${asc[n - 1]}`;
  if (n === 2) return `${label}, ${asc[0]} and ${asc[1]}`;
  return `${label}, ${asc.slice(0, -1).join(", ")} and ${asc[n - 1]}`;
}

const int = new Intl.NumberFormat("en-US");

/** The next general protest deadline for a Texas parcel, from the rule (null when it does not run). */
export function texasDeadline(
  now: number,
  run: typeof runTool = runTool,
): {
  tax_year: number;
  deadline: string;
  moved: boolean;
  citations: string[];
  disclaimer: string;
  rule: string;
} | null {
  const today = texasToday(new Date(now));
  const year = Number(today.slice(0, 4));
  const out = run("rules_tx_property_tax_protest_deadline", {
    tax_year: year,
    as_of: today,
  });
  if (!out.ok) return null;
  const v = (
    out.result as {
      value: {
        status: string;
        deadline: string;
        unadjusted_deadline: string;
        next_season: { tax_year: number; deadline: string } | null;
        disclaimer: string;
        rule: {
          id: string;
          version: number;
          citations: { law: string }[];
        };
      };
    }
  ).value;
  // A passed season with no next one gives no date to print: the sheet then has no deadline line.
  if (v.status === "passed" && v.next_season === null) return null;
  const passed = v.status === "passed";
  const taxYear = passed ? v.next_season!.tax_year : year;
  const deadline = passed ? v.next_season!.deadline : v.deadline;
  return {
    tax_year: taxYear,
    deadline,
    moved: deadline !== `${taxYear}-05-15`,
    citations: v.rule.citations.map((c) => c.law),
    disclaimer: v.disclaimer,
    rule: `${v.rule.id}@${v.rule.version}`,
  };
}

/**
 * The sources behind what the sheet prints, one row per publisher and terms: a parcel with eleven
 * roll years cites eleven files from one appraisal district, and they share one row (each value
 * keeps its own file's as-of date beside it).
 */
interface SourceGroup {
  n: number;
  publisher: string;
  files: Set<string>;
  uris: Set<string>;
  as_of: Set<string>;
  rights: Rights | undefined;
}

/** "a", "a and b", or "first … last (n)" for a longer sorted list. */
function span(xs: Iterable<string>, what: string): string {
  const v = [...new Set(xs)].sort();
  if (v.length <= 2) return v.join(" and ");
  return `${v.length} ${what}, ${v[0]} to ${v[v.length - 1]}`;
}

export function propertySheetDoc(k: KindInput): ReportDoc {
  const lookup = k.checked.result as RegistryLookup;
  const urn = (k.checked.args as { urn: string }).urn;
  const rec = parcelRecord(lookup.record, urn);
  const region = PARCEL_URN.exec(urn)?.[1] ?? "";
  const fips = region.replace(/^us-/, "");
  const free = lookup.plan === "free";

  // Sources, numbered in the order the sheet first cites them. The record's facts name each
  // file's title and rights; a paid caller's answer also carries `history` (every snapshot's
  // facts), which describes the earlier roll years' files. Nothing from history is printed but
  // that description.
  const groups = new Map<string, SourceGroup>();
  const docGroup = new Map<string, SourceGroup>();
  const byFact = new Map<string, Fact>();
  const byDoc = new Map<string, Fact>();
  for (const f of [...(rec.facts ?? []), ...(rec.history ?? [])]) {
    if (!f || typeof f !== "object") continue;
    if (f.id && !byFact.has(f.id)) byFact.set(f.id, f);
    for (const s of f.provenance?.sources ?? [])
      if (s.document_id && !byDoc.has(s.document_id))
        byDoc.set(s.document_id, f);
  }
  const cite = (
    documentId: string | undefined,
    asOf: string | undefined,
    holder?: Fact,
  ): string => {
    if (!documentId) return "";
    let g = docGroup.get(documentId);
    if (!g) {
      const f = holder?.provenance?.sources?.some(
        (x) => x.document_id === documentId,
      )
        ? holder
        : byDoc.get(documentId);
      const src = f?.provenance?.sources?.find(
        (x) => x.document_id === documentId,
      );
      const title = src?.title ?? `Document ${documentId}`;
      const cut = title.indexOf(": ");
      const publisher = cut > 0 ? title.slice(0, cut) : title;
      const rights = f?.rights;
      const key = [
        rights?.redistribution ?? "",
        rights?.ai_use ?? "",
        publisher,
        rights?.license ?? "",
        rights?.attribution ?? "",
      ].join("\u0000");
      g = groups.get(key);
      if (!g) {
        g = {
          n: groups.size + 1,
          publisher,
          files: new Set(),
          uris: new Set(),
          as_of: new Set(),
          rights,
        };
        groups.set(key, g);
      }
      if (cut > 0) g.files.add(title.slice(cut + 2));
      if (typeof src?.uri === "string" && /^https?:\/\//.test(src.uri))
        g.uris.add(src.uri);
      docGroup.set(documentId, g);
    }
    if (asOf) g.as_of.add(asOf);
    return `[${g.n}]${asOf ? ` ${asOf}` : ""}`;
  };
  const factCite = (f: Fact): string =>
    (f.provenance?.sources ?? [])
      .map((s) => cite(s.document_id, f.as_of, f))
      .filter(Boolean)
      .join("; ");

  const address = text(fact(rec, "parcel.situs_address"));
  const apnFact = fact(rec, "parcel.apn");
  const apn = text(apnFact);
  const county = countyName(fips);
  const place = county ? `${county} (FIPS ${fips})` : `FIPS ${fips}`;

  // --- the parcel --------------------------------------------------------------------------------
  const idRows: Raw[][] = [];
  const addressFact = fact(rec, "parcel.situs_address");
  idRows.push([
    "Address (as published)",
    address ?? "not in the record",
    addressFact ? factCite(addressFact) : "",
  ]);
  idRows.push(["FactLot ID", urn, ""]);
  idRows.push([
    "Account or parcel no.",
    apn ?? "not in the record",
    apnFact ? factCite(apnFact) : "",
  ]);
  idRows.push(["County", place, ""]);

  // --- owner -------------------------------------------------------------------------------------
  const ownerFact = fact(rec, "ownership.owner_of_record");
  const ownerValue = text(ownerFact);
  const ownerRows: Raw[][] = [];
  const ownerNotes: string[] = [];
  // The property pages' person rule, applied here too, so no build of the sheet prints one.
  const personStyle = ownerValue !== null && ownerNamesAPerson(ownerValue);
  if (ownerValue && ownerFact && !personStyle) {
    ownerRows.push(["Owner of record", ownerValue, factCite(ownerFact)]);
    const link = (rec.relationships ?? []).find(
      (r) =>
        r?.type === "owns" &&
        r.to_urn === urn &&
        typeof r.from_urn === "string" &&
        r.from_urn.startsWith("fl:entity:"),
    );
    if (link) {
      const entityUrn = link.from_urn as string;
      const method = typeof link.method === "string" ? link.method : null;
      const conf =
        typeof link.confidence === "number" ? String(link.confidence) : null;
      const entity =
        isObj(lookup.entity) && lookup.entity.urn === entityUrn
          ? (lookup.entity as unknown as ParcelRecord)
          : null;
      const efact = (p: string) =>
        entity ? fact({ ...entity, facts: entity.facts ?? [] }, p) : undefined;
      const name = efact("entity.legal_name");
      const status = efact("entity.status");
      const number = efact("entity.registry_number");
      const jurisdiction =
        /^fl:entity:([a-z0-9-]+):/.exec(entityUrn)?.[1] ?? "";
      const nameText = text(name);
      if (!entity || !nameText || ownerNamesAPerson(nameText))
        ownerNotes.push(ENTITY_NOT_PRINTED);
      else {
        ownerRows.push([
          `Registered entity, the registry's match${method || conf ? ` (${[method ?? "", conf ? `confidence ${conf}` : ""].filter(Boolean).join(", ")})` : ""}`,
          nameText,
          name ? factCite(name) : "",
        ]);
        if (text(status))
          ownerRows.push(["Entity status", text(status), factCite(status!)]);
        if (text(number))
          ownerRows.push([
            `Registry number (${jurisdiction.replace(/^us-/, "").toUpperCase()})`,
            text(number),
            factCite(number!),
          ]);
      }
    }
  } else if (personStyle) ownerNotes.push(OWNER_PERSON_STYLE);
  else
    ownerNotes.push(
      NO_OWNER_REGIONS.some((r) => r.test(region))
        ? OWNER_NOT_PUBLISHED
        : OWNER_NOT_ORGANISATION,
    );

  // --- values by roll year -----------------------------------------------------------------------
  const all = Array.isArray(rec.value_history) ? rec.value_history : [];
  // A free caller's answer is already cut to the current roll year; cut again so the sheet can
  // never show more than the API would.
  const shown = free ? currentYearEntries(all) : all;
  const shownYears = new Set(shown.map((e) => e.tax_year));
  const cutHere = [
    ...new Set(
      all
        .map((e) => e.tax_year)
        .filter(
          (y): y is number => typeof y === "number" && !shownYears.has(y),
        ),
    ),
  ];
  const withheld = [
    ...new Set([...(rec.history_withheld?.tax_years ?? []), ...cutHere]),
  ].sort((a, b) => b - a);
  const valueRows: Raw[][] = [];
  const valueCite = (
    e: ValueEntry,
    field: "market_value" | "appraised_value",
  ) => {
    const c = e.citations?.[field];
    if (!c) return "";
    const holder = c.fact_id ? byFact.get(c.fact_id) : undefined;
    return cite(c.document_id, c.as_of ?? e.as_of, holder);
  };
  for (const e of shown) {
    const mv = typeof e.market_value === "number" ? e.market_value : null;
    const av = typeof e.appraised_value === "number" ? e.appraised_value : null;
    if (mv === null && av === null) continue;
    const refs = [
      mv !== null ? valueCite(e, "market_value") : "",
      av !== null ? valueCite(e, "appraised_value") : "",
    ].filter(Boolean);
    valueRows.push([
      typeof e.tax_year === "number" ? e.tax_year : "not stated",
      mv ?? "not published",
      av ?? "not published",
      [...new Set(refs)].join("; "),
    ]);
  }
  if (valueRows.length === 0) {
    // No value_history: the current value facts, as the property pages do.
    const mvf = fact(rec, "parcel.market_value");
    const avf = fact(rec, "parcel.appraised_value");
    const year = fact(rec, "parcel.tax_year")?.value;
    const num = (f: Fact | undefined) =>
      f && typeof f.value === "number" ? f.value : null;
    if (num(mvf) !== null || num(avf) !== null)
      valueRows.push([
        typeof year === "number" ? year : "not stated",
        num(mvf) ?? "not published",
        num(avf) ?? "not published",
        [
          ...new Set(
            [mvf, avf].filter((f): f is Fact => num(f) !== null).map(factCite),
          ),
        ].join("; "),
      ]);
  }
  const valuesNote = free
    ? withheld.length
      ? `Free tier: the current roll year only. ${yearsInWords(withheld)}, ${withheld.length === 1 ? "is" : "are"} available with a Pro or Team key: ${SHEET_PRICING_URL}`
      : `Free tier: the current roll year only. The registry holds no earlier roll year for this parcel; a Pro or Team key shows every year held (${SHEET_PRICING_URL}).`
    : `Every roll year the registry holds for this parcel, newest first, as the ${lookup.plan === "team" ? "Team" : "Pro"} plan returns it.`;

  // --- building and land ------------------------------------------------------------------------
  const area = (f: Fact) =>
    typeof f.value === "number"
      ? `${int.format(Math.round(f.value))} ${f.unit === "sf" || !f.unit ? "sq ft" : f.unit}`
      : String(f.value);
  const factRows: Raw[][] = [];
  for (const [p, label, fmt] of [
    ["parcel.improvement_area_sf", "Building area", area],
    ["parcel.year_built", "Year built", (f: Fact) => String(f.value)],
    ["parcel.building_class", "Building class", (f: Fact) => String(f.value)],
    [
      "parcel.state_property_category",
      "State category code",
      (f: Fact) => String(f.value),
    ],
    ["parcel.local_use_code", "Local use code", (f: Fact) => String(f.value)],
    ["parcel.num_floors", "Floors", (f: Fact) => String(f.value)],
    ["parcel.land_area_sf", "Land area", area],
  ] as const) {
    const f = fact(rec, p);
    if (f && f.value !== null && f.value !== undefined && f.value !== "")
      factRows.push([label, fmt(f), factCite(f)]);
  }

  // --- blocks ------------------------------------------------------------------------------------
  // One page: in the PDF the fact tables put two facts side by side; the workbook lists them.
  const factTable = (title: string, rows: Raw[][]): Block[] => {
    const one = [
      { header: title, fmt: "text" as const, width: 1.5 },
      { header: "", fmt: "text" as const, width: 2.2 },
      { header: "Source, as of", fmt: "text" as const, width: 1 },
    ];
    const paired: Raw[][] = [];
    for (let i = 0; i < rows.length; i += 2)
      paired.push([...rows[i]!, ...(rows[i + 1] ?? ["", "", ""])]);
    return [
      {
        t: "table",
        only: "pdf",
        size: 7,
        columns: [
          { header: title, fmt: "text", width: 1.2 },
          { header: "", fmt: "text", width: 1.55 },
          { header: "Source, as of", fmt: "text", width: 0.75 },
          { header: "", fmt: "text", width: 1.2 },
          { header: "", fmt: "text", width: 1.55 },
          { header: "Source, as of", fmt: "text", width: 0.75 },
        ],
        rows: paired,
      },
      { t: "table", only: "xlsx", columns: one, rows },
    ];
  };
  const blocks: Block[] = [
    {
      t: "notice",
      text: region.startsWith("us-48")
        ? `${SHEET_FACTS} ${TX_DISCLAIMER} ${SHEET_CONTACT_LINE}`
        : SHEET_BOUNDARY,
    },
    ...factTable("Parcel", [...idRows, ...factRows]),
  ];
  if (factRows.length === 0)
    blocks.push({
      t: "para",
      size: 7.5,
      grey: true,
      text: "The record holds no building or land fact for this parcel.",
    });
  if (ownerRows.length) blocks.push(...factTable("Owner", ownerRows));
  for (const n of ownerNotes)
    blocks.push({ t: "para", size: 7.5, text: `Owner of record: ${n}` });

  blocks.push({ t: "subheading", text: "Values by roll year" });
  const valueColumns = [
    { header: "Roll year", fmt: "plain" as const, width: 0.6 },
    { header: "Market value", fmt: "usd" as const, width: 1.15 },
    { header: "Appraised value", fmt: "usd" as const, width: 1.15 },
    { header: "Source, as of", fmt: "text" as const, width: 0.9 },
  ];
  if (valueRows.length > 4) {
    // Many years: two columns of years in the PDF, newest first down the left, then the right.
    const half = Math.ceil(valueRows.length / 2);
    blocks.push(
      {
        t: "table",
        only: "pdf",
        size: 7,
        columns: [...valueColumns, ...valueColumns],
        rows: valueRows
          .slice(0, half)
          .map((r, i) => [...r, ...(valueRows[half + i] ?? ["", "", "", ""])]),
      },
      { t: "table", only: "xlsx", columns: valueColumns, rows: valueRows },
    );
  } else if (valueRows.length)
    blocks.push({
      t: "table",
      size: 7,
      columns: valueColumns,
      rows: valueRows,
    });
  else
    blocks.push({
      t: "para",
      size: 7.5,
      text: "The record holds no roll value for this parcel.",
    });
  blocks.push({ t: "para", size: 7.5, text: valuesNote, grey: true });

  if (region.startsWith("us-48")) {
    const d = texasDeadline(k.p.generatedAt.getTime());
    if (d) {
      blocks.push({
        t: "subheading",
        text: "Texas protest deadline: the general rule",
      });
      blocks.push({
        t: "para",
        size: 7.5,
        text: `Next general protest deadline: ${d.deadline} (tax year ${d.tax_year}). The general rule: May 15, or the 30th day after the notice of appraised value is delivered if that is later (${d.citations[0]})${d.moved ? `, moved to the next business day (${d.citations[1] ?? "Tex. Tax Code §1.06"})` : ""}. It is not this account's deadline: notice dates differ per account, so confirm the date on the notice and with the appraisal district.`,
      });
    }
  }

  const warnings = (rec.warnings ?? []).filter(
    (w): w is string => typeof w === "string" && w.trim() !== "",
  );
  for (const w of warnings)
    blocks.push({
      t: "para",
      size: 7.5,
      grey: true,
      text: `Registry note: ${w}`,
    });

  blocks.push({ t: "subheading", text: "Sources" });
  const sourceRows: Raw[][] = [...groups.values()].map((g) => {
    return [
      `[${g.n}]`,
      [
        g.publisher,
        g.files.size ? `: ${span(g.files, "files")}` : "",
        g.uris.size ? ` ${[...g.uris].sort().join(" ")}` : "",
      ].join(""),
      span(g.as_of, "dates") || "not stated",
      rightsText(g.rights as Record<string, string | undefined> | undefined),
    ];
  });
  blocks.push(
    sourceRows.length
      ? {
          t: "table",
          size: 7,
          columns: [
            { header: "", fmt: "text", width: 0.3 },
            { header: "Publisher and file", fmt: "text", width: 2.5 },
            { header: "As of", fmt: "text", width: 1 },
            {
              header: "Rights as the publisher states them",
              fmt: "text",
              width: 2.1,
            },
          ],
          rows: sourceRows,
        }
      : { t: "para", size: 7.5, text: "The record cites no source document." },
  );
  const title = address ?? (apn ? `Parcel ${apn}` : urn);
  return {
    title,
    subtitle: subtitle(
      ["Property sheet", county ?? `FIPS ${fips}`, `FactLot ID ${urn}`],
      k.ctx,
    ),
    blocks,
    readme: [
      "One parcel's public record from FactLot's hosted registry (registry_get), as the caller's plan returns it: address, IDs, owner of record when the registry holds one, values by roll year, building and land facts, and every source with its as-of date and licence or attribution.",
    ],
  };
}

/** The filename subject: the publisher's parcel number, else the FactLot ID's own part. */
export function sheetSubject(k: {
  checked: { args?: unknown; result: unknown };
}): string {
  const urn = (k.checked.args as { urn: string }).urn;
  const rec = (k.checked.result as RegistryLookup | undefined)?.record;
  const apn = isObj(rec)
    ? text(
        ((rec.facts as Fact[] | undefined) ?? []).find(
          (f) => f?.predicate === "parcel.apn",
        ),
      )
    : null;
  return apn ?? urn.split(":").pop() ?? "parcel";
}
