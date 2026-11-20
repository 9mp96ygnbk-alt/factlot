/**
 * rent_roll_certificate: the rent roll certification rent_roll_certify produced, laid out in the
 * institutional style (institutional.ts). PDF, and an XLSX of the line grid. The certifying party's
 * certification, not FactLot, is what a lender or buyer relies on.
 */
import { Workbook } from "../xlsx.ts";
import { longDate, longDates, num, pct, usd } from "../format.ts";
import { InstitutionalWriter, type Cell } from "../institutional.ts";

import type { KindInput } from "./common.ts";

type Json = Record<string, unknown>;

export const RENT_ROLL_NOTICE =
  "The certifying party's certification, not FactLot, is what the lender or buyer relies on. FactLot checked the rent roll against the lease documents (and any tenant estoppel answers) supplied, and against nothing else. These are facts and arithmetic, not legal, appraisal or lending advice.";

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : String(v ?? "");
const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const sf = (x: number | null): string => (x === null ? "" : num(x));
const money = (x: number | null): string => (x === null ? "" : usd(x));
const sha8 = (id: unknown): string => {
  const m = /sha256-([0-9a-f]{8})/.exec(str(id));
  return m ? m[1]! : "";
};
const sha64 = (id: unknown, sha: unknown): string => {
  if (typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha)) return sha;
  const m = /sha256-([0-9a-f]{64})/.exec(str(id));
  return m ? m[1]! : "";
};
/** A sentence of a flag or reason: dates as a person reads them. */
const prose = (s: string): string => cap(longDates(s));

const GRADE_SHORT: Record<string, string> = {
  matches_lease: "Matches lease",
  matches_lease_confirmed_by_tenant: "Matches, tenant confirmed",
  differs: "Differs",
  no_lease_supplied: "No lease",
  not_checkable: "Not checkable",
};
const GRADE_ORDER = [
  "matches_lease_confirmed_by_tenant",
  "matches_lease",
  "differs",
  "not_checkable",
  "no_lease_supplied",
];

/** A compared value as a person reads it. */
function shown(v: unknown, unit: unknown): string {
  if (v === null || v === undefined) return "";
  const u = str(unit);
  if (typeof v === "number") {
    if (u === "USD per year" || u === "USD" || u === "USD per month")
      return (
        usd(v) +
        (u === "USD per year"
          ? " a year"
          : u === "USD per month"
            ? " a month"
            : "")
      );
    if (u === "USD per SF per year") return `${usd(v)} per SF`;
    if (u === "SF") return `${num(v)} SF`;
    if (u === "months") return `${num(v)} months`;
    return num(v);
  }
  return u === "date" ? longDate(str(v)) : cap(str(v));
}
function diffShown(c: Json): string {
  const d = n(c.difference);
  if (d === null) return "";
  const u = str(c.difference_unit);
  const sign = d > 0 ? "+" : d < 0 ? "-" : "";
  const a = Math.abs(d);
  if (u === "days") return d === 0 ? "" : `${sign}${num(a)} days`;
  if (u.startsWith("USD per SF")) return d === 0 ? "" : `${sign}${usd(a)}`;
  if (u.startsWith("USD")) return d === 0 ? "" : `${sign}${usd(a)}`;
  if (u === "SF") return d === 0 ? "" : `${sign}${num(a)} SF`;
  if (u === "months") return d === 0 ? "" : `${sign}${num(a)} months`;
  return "";
}

const lineName = (l: Json): string =>
  `${l.suite ? `Suite ${str(l.suite)}` : str(l.line_id)}${l.tenant ? `, ${str(l.tenant)}` : ""}`;

export async function rentRollPdf(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as Json;
  const parties = r.parties as Json;
  const certifier = parties.certifier as Json;
  const relying = parties.relying_party as Json | undefined;
  const lines = arr(r.lines);
  const occ = lines.filter((l) => l.occupancy === "occupied");
  const figs = r.key_figures as Json;
  const area = r.area as Json;
  const rent = r.base_rent as Json;
  const totals = r.totals as Json;
  const grades = totals.grades as Record<string, number>;
  const walt = r.walt as Json;
  const asOf = longDate(str(r.as_of));
  const property = str(r.property);
  const certName = str(certifier.organisation);
  const preparedFor =
    k.ctx.prepared_for ?? (relying ? str(relying.organisation) : undefined);
  const reliers = k.ctx.rent_roll_reliers ?? [];
  const docTitle = (r.roll_document as Json | undefined)?.title;

  const w = await InstitutionalWriter.create({
    title: "Rent roll certificate",
    subject: `Rent roll certificate, ${property}, ${asOf}`,
    brand: "FactLot",
    mastheadRight: `Rent roll certificate  ·  ${asOf}`,
    runningHeader: `Rent roll certificate  ·  ${property}`,
    footer: `Prepared from the documents supplied. Not legal, appraisal or lending advice. FactLot ${k.p.version}.`,
    producer: `FactLot ${k.p.version} reports`,
    keywords: k.p.keywords,
    created: k.p.generatedAt,
  });

  // ---- page 1 -----------------------------------------------------------------------------------
  w.titleBlock({
    title: "Rent roll certificate",
    line: `${property}  ·  certified by ${certName}`,
    preparedFor,
    asOf,
  });
  const occupancy = n(figs.occupancy);
  const waltYears = n(figs.walt_years);
  const diff = n(figs.difference_from_roll) ?? 0;
  const cells: Cell[] = [
    {
      figure: occupancy === null ? "Not given" : pct(occupancy, 1),
      label: "Occupancy by area",
    },
    {
      figure: usd(n(figs.annual_base_rent_per_leases) ?? 0).replace(
        /\.00$/,
        "",
      ),
      label: "Annual base rent per the leases",
    },
    {
      figure:
        diff === 0
          ? "$0"
          : `${diff > 0 ? "+" : "-"}${usd(Math.abs(diff)).replace(/\.00$/, "")}`,
      label: "Roll above (+) or below (-) the leases",
    },
    {
      figure:
        waltYears === null ? "Not given" : `${waltYears.toFixed(1)} years`,
      label: "WALT, weighted by area",
    },
  ];
  w.band(cells, { figureSize: 19, accent: true });

  w.section("Summary", 110);
  const statedBy = (g: string): number =>
    occ
      .filter((l) => l.grade === g)
      .reduce((s, l) => s + (n((l.roll as Json).annual_base_rent) ?? 0), 0);
  const statedAll = n(rent.stated_total) ?? 0;
  const summaryRows = GRADE_ORDER.filter((g) => (grades[g] ?? 0) > 0).map(
    (g) => [
      GRADE_SHORT[g]!,
      String(grades[g]),
      usd(statedBy(g)),
      statedAll > 0 ? pct(statedBy(g) / statedAll, 1) : "",
    ],
  );
  summaryRows.push([
    "All occupied lines",
    String(totals.occupied_lines),
    usd(statedAll),
    statedAll > 0 ? "100.0%" : "",
  ]);
  w.dataTable(
    [
      { header: "Grade", width: 44 },
      { header: "Lines", width: 12, align: "right" },
      { header: "Annual base rent per the roll", width: 30, align: "right" },
      { header: "Share", width: 14, align: "right" },
    ],
    summaryRows,
    { bold: new Set([summaryRows.length - 1]), size: 8.75 },
  );
  w.space(6);
  const relyN = n(totals.reliance_possible) ?? 0;
  w.note(
    "How to read this certificate",
    `${RENT_ROLL_NOTICE} A line is graded as matching only when its tenant, area, expiration and current base rent were each compared with the lease and agree; a figure no lease fact covers is shown as not checked, never assumed. ${relyN} of ${totals.occupied_lines} occupied lines are graded as matching. A lender or buyer can record reliance only on those lines.`,
  );

  // ---- the certification ------------------------------------------------------------------------
  w.section("Parties and roll", 110);
  const defs: [string, string][] = [
    ["Property", property],
    ["As of", asOf],
    ["Certified by", `${certName} (${str(certifier.role)})`],
  ];
  if (relying)
    defs.push(["For", `${str(relying.organisation)} (${str(relying.role)})`]);
  if (docTitle) defs.push(["Rent roll", str(docTitle)]);
  defs.push([
    "Lines",
    `${totals.lines} (${totals.occupied_lines} occupied, ${totals.vacant_lines} vacant)`,
  ]);
  defs.push(["Leases supplied", String(totals.leases_supplied)]);
  w.definitions(defs, 100);

  // ---- the lines ------------------------------------------------------------------------------------
  w.section("Rent roll lines", 120);
  const rows: string[][] = lines.map((l) => {
    const ro = l.roll as Json;
    const le = l.lease as Json;
    const d = n(l.rent_difference);
    return [
      String(l.number),
      str(l.suite ?? ""),
      l.occupancy === "vacant" ? "Vacant" : str(l.tenant),
      sf(n(ro.area_sf)),
      money(n(ro.annual_base_rent)),
      money(n(le.annual_base_rent)),
      d === null
        ? ""
        : d === 0
          ? "0.00"
          : `${d > 0 ? "+" : "-"}${usd(Math.abs(d))}`,
      ro.lease_expiration_date ? longDate(str(ro.lease_expiration_date)) : "",
      l.occupancy === "vacant" ? "Not graded" : GRADE_SHORT[str(l.grade)]!,
    ];
  });
  rows.push([
    "",
    "",
    "Total, occupied lines",
    sf(n(area.occupied_sf)),
    usd(statedAll),
    "",
    "",
    "",
    "",
  ]);
  w.dataTable(
    [
      { header: "No.", width: 4, align: "right" },
      { header: "Suite", width: 5 },
      { header: "Tenant", width: 17 },
      { header: "Area (SF)", width: 8, align: "right" },
      { header: "Annual rent per roll", width: 11, align: "right" },
      { header: "Annual rent per lease", width: 11, align: "right" },
      { header: "Roll less lease", width: 9, align: "right" },
      { header: "Expires", width: 11 },
      { header: "Grade", width: 11 },
    ],
    rows,
    { size: 8, bold: new Set([rows.length - 1]) },
  );
  w.space(4);
  w.para(
    "Annual rent per lease is the lease's current rent step times the lease's rentable area, worked from the quoted schedule. It is blank where no lease was supplied or the lease facts do not give the rent, so it has no total here: the next section compares the roll with the leases on the lines that have one.",
    { size: 8, leading: 11.5, color: "slate" },
  );

  // ---- totals ---------------------------------------------------------------------------------------
  w.section("Rent, area and lease term", 150);
  w.subhead("Annual base rent, as stated and as the leases yield", 80);
  w.dataTable(
    [
      { header: "", width: 70 },
      { header: "Per year", width: 30, align: "right" },
    ],
    [
      ["Stated on the roll, all occupied lines", usd(statedAll)],
      [
        `Stated on the roll, the ${rent.lines_with_lease_rent} lines whose lease gives the rent`,
        usd(n(rent.stated_on_lines_with_lease_rent) ?? 0),
      ],
      ["Yielded by those leases", usd(n(rent.per_leases) ?? 0)],
      [
        "Roll above (+) or below (-) the leases",
        `${diff > 0 ? "+" : diff < 0 ? "-" : ""}${usd(Math.abs(diff))}`,
      ],
      [
        `Stated on the roll with no lease rent to compare (${rent.lines_without_lease_rent} lines)`,
        usd(n(rent.stated_without_lease_rent) ?? 0),
      ],
    ],
    { bold: new Set([3]), size: 8.75 },
  );
  w.subhead("Area", 70);
  const area2: string[][] = [
    ["Occupied", `${num(n(area.occupied_sf) ?? 0)} SF`],
    [
      `Vacant${area.vacant_basis ? ` (${str(area.vacant_basis)})` : ""}`,
      area.vacant_sf === null
        ? "Not given"
        : `${num(n(area.vacant_sf) ?? 0)} SF`,
    ],
    ["Occupancy", occupancy === null ? "Not given" : pct(occupancy, 2)],
  ];
  w.dataTable(
    [
      { header: "", width: 70 },
      { header: "", width: 30, align: "right" },
    ],
    area2,
    { headerless: true },
  );
  w.subhead("Weighted average lease term (WALT)", 80);
  const wa = walt.weighted_by_area_on_roll as Json | null;
  const wr = walt.weighted_by_rent_on_roll as Json | null;
  const wl = walt.weighted_by_area_per_leases as Json | null;
  const yrs = (x: Json | null): string =>
    x ? `${(n(x.years) ?? 0).toFixed(2)} years` : "Not given";
  w.dataTable(
    [
      { header: "", width: 70 },
      { header: "", width: 30, align: "right" },
    ],
    [
      ["By area, on the expirations the roll states", yrs(wa)],
      ["By annual base rent, on the roll", yrs(wr)],
      ["By area, on the expirations in the leases supplied", yrs(wl)],
    ],
    { headerless: true },
  );
  w.para(
    "Remaining term is measured from the as-of date in actual days divided by 365.25; a lease already expired counts as zero. Weights are the area (or annual base rent) on the roll, and in the last line the lease's area.",
    { size: 8, leading: 11.5, color: "slate" },
  );

  // ---- differences ------------------------------------------------------------------------------------
  const differing = lines.filter((l) => l.grade === "differs");
  w.section("Differences from the leases", 120);
  if (differing.length === 0)
    w.para("No line differs from its lease on a field that was compared.", {
      color: "slate",
    });
  for (const l of differing) {
    const cs = arr(l.checks).filter((c) => c.status === "differs");
    w.subhead(`${l.number}. ${lineName(l)}`, 80);
    w.dataTable(
      [
        { header: "Field", width: 24 },
        { header: "Roll", width: 22, align: "right" },
        { header: "Compared with", width: 24, align: "right" },
        { header: "Difference", width: 14, align: "right" },
        { header: "Source", width: 16 },
      ],
      cs.map((c) => [
        str(c.label),
        shown(c.roll_value, c.unit),
        shown(c.against_value, c.unit),
        diffShown(c),
        c.against === "estoppel"
          ? "Tenant's answer"
          : c.against === "roll"
            ? "The roll"
            : "Lease",
      ]),
      { size: 8.25 },
    );
    const seen = new Set<string>();
    const once = (s: Json): boolean => {
      const key = `${str(s.document_id)}|${str(s.page)}|${str(s.quote)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    for (const c of cs) {
      const rs = c.roll_source as Json | null;
      const ls = c.lease_source as Json | null;
      if (rs && once(rs)) {
        w.quote(
          str(rs.quote),
          `Rent roll, page ${n(rs.page) ?? ""}${sha8(rs.document_id) ? ` · document ${sha8(rs.document_id)}` : ""}`,
        );
      }
      if (ls && once(ls)) {
        w.quote(
          str(ls.quote),
          `Lease, page ${n(ls.page) ?? ""}${sha8(ls.document_id) ? ` · document ${sha8(ls.document_id)}` : ""}`,
        );
      }
      if (c.reason)
        w.para(prose(str(c.reason)) + ".", {
          size: 8.25,
          leading: 12,
          color: "slate",
          after: 3,
        });
    }
  }

  // ---- lines not checked ----------------------------------------------------------------------------------
  const unchecked = lines.filter(
    (l) => l.grade === "no_lease_supplied" || l.grade === "not_checkable",
  );
  if (unchecked.length) {
    w.section("Lines not checked", 80);
    w.dataTable(
      [
        { header: "Line", width: 34 },
        { header: "Grade", width: 14 },
        { header: "Why", width: 52 },
      ],
      unchecked.map((l) => [
        `${l.number}. ${lineName(l)}`,
        GRADE_SHORT[str(l.grade)]!,
        prose((l.reasons as string[]).join("; ")),
      ]),
      { size: 8.25, padY: 3.5 },
    );
  }

  // ---- rollover and concentration ---------------------------------------------------------------------------
  w.section("Rollover schedule", 120);
  const roll = arr(r.rollover);
  w.dataTable(
    [
      { header: "Expiring in", width: 28 },
      { header: "Leases", width: 9, align: "right" },
      { header: "Area (SF)", width: 14, align: "right" },
      { header: "Share of occupied area", width: 14, align: "right" },
      { header: "Annual base rent", width: 19, align: "right" },
      { header: "Share of rent", width: 12, align: "right" },
    ],
    roll.map((x) => [
      str(x.period),
      String(x.leases),
      sf(n(x.area_sf)),
      n(x.share_of_occupied_area) === null
        ? ""
        : pct(n(x.share_of_occupied_area)!, 1),
      money(n(x.annual_base_rent)),
      n(x.share_of_stated_rent) === null
        ? ""
        : pct(n(x.share_of_stated_rent)!, 1),
    ]),
    { size: 8.5 },
  );
  w.space(4);
  w.para(
    "By the calendar year of the expiration the roll states, with the rent the roll states. Shares are of the occupied area and of the stated rent on all occupied lines.",
    { size: 8, leading: 11.5, color: "slate" },
  );
  const conc = r.concentration as Json;
  w.subhead("Largest tenants", 100);
  w.dataTable(
    [
      { header: "Tenant", width: 36 },
      { header: "Annual base rent", width: 20, align: "right" },
      { header: "Share of rent", width: 14, align: "right" },
      { header: "Area (SF)", width: 15, align: "right" },
      { header: "Share of area", width: 15, align: "right" },
    ],
    arr(conc.top_tenants).map((t) => [
      `${t.rank}. ${str(t.tenant)}`,
      money(n(t.annual_base_rent)),
      n(t.share_of_stated_rent) === null
        ? ""
        : pct(n(t.share_of_stated_rent)!, 1),
      sf(n(t.area_sf)),
      n(t.share_of_occupied_area) === null
        ? ""
        : pct(n(t.share_of_occupied_area)!, 1),
    ]),
    { size: 8.5 },
  );
  w.space(3);
  const share = (x: unknown): string =>
    n(x) === null ? "not given" : pct(n(x)!, 1);
  w.para(
    `The largest tenant is ${share(conc.top_1_share)} of the stated rent, the largest three ${share(conc.top_3_share)} and the largest five ${share(conc.top_5_share)}, across ${conc.tenants} tenants.`,
    { size: 8.5, leading: 12.5 },
  );

  // ---- flags ----------------------------------------------------------------------------------------------------
  const flags = arr(r.flags);
  w.section("Points to check", 80);
  if (flags.length === 0) w.para("Nothing was flagged.", { color: "slate" });
  else
    w.dataTable(
      [
        { header: "Point", width: 26 },
        { header: "What was found", width: 74 },
      ],
      flags.map((f) => [
        FLAG_TITLE[str(f.code)] ?? "Point to check",
        prose(str(f.message)) + (str(f.message).endsWith(".") ? "" : "."),
      ]),
      { size: 8.25, padY: 3.5 },
    );

  // ---- reliance ----------------------------------------------------------------------------------------------------
  w.section("Reliance recorded", 70);
  if (reliers.length === 0)
    w.para("No reliance has been recorded.", { color: "slate" });
  else
    w.dataTable(
      [
        { header: "Relying party", width: 40 },
        { header: "Role", width: 18 },
        { header: "Lines", width: 26 },
        { header: "Recorded", width: 16 },
      ],
      reliers.map((x) => [
        x.who,
        x.role ?? "",
        (x.lines ?? []).join(", "),
        x.at ? longDate(x.at.slice(0, 10)) : "",
      ]),
      { size: 8.25, padY: 3.5 },
    );

  // ---- back matter ------------------------------------------------------------------------------------------------------
  w.section("Basis of preparation", 60);
  const tol = r.tolerance as Json;
  w.para(
    `Each line of the rent roll rests on facts read from the rent roll document, and each lease figure on facts read from the lease documents, every fact carrying its verbatim quotation and page, checked by FactLot ${k.p.version}. The checks are fixed rules: the same facts always give the same grades. Dollar figures that differ by no more than ${usd(n(tol.annual_usd) ?? 1)} a year (one twelfth of that a month, ${usd(n(tol.psf) ?? 0.01)} per SF) are treated as agreeing within rounding. Where the roll states a figure the lease facts do not cover, it is shown as not checked. Where a tenant's estoppel answers were supplied, a line is shown as confirmed by the tenant only when the tenant agreed the premises, expiration and base rent statements; FactLot did not re-read the answers. Vacant space is as the roll states it and was not checked against any document. FactLot keeps facts, quotations, pages and document fingerprints, never the documents themselves.`,
    { size: 8, leading: 11.5 },
  );
  w.section("Important information", 50);
  w.para(
    `${RENT_ROLL_NOTICE} Confirm each line against the rent roll and the leases before relying on it, and take advice. A line graded as differing, with no lease or not checkable is not one a lender or buyer can record reliance on.`,
    { size: 8, leading: 11.5 },
  );

  // ---- sources ---------------------------------------------------------------------------------------------------------------
  w.section("Sources", 80);
  const srcRows: string[][] = [];
  const docs = new Map<string, string>();
  const seenFact = new Set<string>();
  for (const l of lines) {
    const groups = new Map<
      string,
      { doc: string; page: string; ids: string[] }
    >();
    const add = (s: Json | null, label: string): void => {
      if (!s || seenFact.has(str(s.fact_id))) return;
      seenFact.add(str(s.fact_id));
      const d = sha8(s.document_id);
      const key = `${label}|${d}|${n(s.page)}`;
      const g = groups.get(key) ?? {
        doc: `${label}${d ? ` · ${d}` : ""}`,
        page: String(n(s.page) ?? ""),
        ids: [],
      };
      g.ids.push(str(s.fact_id));
      groups.set(key, g);
      const sha = sha64(s.document_id, s.sha256);
      if (sha && !docs.has(sha))
        docs.set(
          sha,
          label === "Rent roll" ? "Rent roll" : `Lease, ${lineName(l)}`,
        );
    };
    for (const s of arr(l.roll_facts)) add(s, "Rent roll");
    for (const c of arr(l.checks)) add(c.lease_source as Json | null, "Lease");
    for (const g of groups.values())
      srcRows.push([g.doc, g.page, String(l.number), g.ids.join(", ")]);
  }
  w.dataTable(
    [
      { header: "Document", width: 22 },
      { header: "Page", width: 6, align: "right" },
      { header: "Line", width: 6, align: "right" },
      { header: "Fact ids", width: 66, mono: true },
    ],
    srcRows,
    { size: 7.75, padY: 3 },
  );
  w.section("Document fingerprints", 80);
  w.para(
    "SHA-256 of each document as supplied. Compare these with the documents you hold: a different file gives a different fingerprint.",
    { size: 8, leading: 11.5 },
  );
  w.dataTable(
    [
      { header: "Document", width: 34 },
      { header: "SHA-256", width: 66, mono: true },
    ],
    [...docs.entries()].map(([sha, label]) => [label, sha]),
    { size: 7.75, padY: 3.5 },
  );
  return w.bytes();
}

const FLAG_TITLE: Record<string, string> = {
  LEASE_EXPIRING_WITHIN_12_MONTHS: "Expires within 12 months",
  LEASE_EXPIRED: "Lease expired",
  NO_LEASE_SUPPLIED: "No lease supplied",
  LEASE_WITHOUT_ROLL_LINE: "Lease with no roll line",
  ROLL_RENT_ABOVE_LEASE: "Roll rent above the lease",
  ROLL_RENT_INTERNAL: "The roll's own arithmetic",
  DUPLICATE_SUITE: "Suite listed twice",
  VACANT_AREA_DIFFERS: "Vacant area differs",
  LEASE_FACTS_CONFLICT: "Lease facts disagree",
  LEASE_FACTS_PENDING: "Amendment not yet effective",
  ESTOPPEL_DISPUTED: "Tenant disputes",
  ESTOPPEL_DATE_DIFFERS: "Estoppel date differs",
};

/** The line grid as a workbook: one row per roll line, then the differences, rollover and flags. */
export async function rentRollXlsx(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as Json;
  const lines = arr(r.lines);
  const wb = new Workbook({
    title: `Rent roll certificate, ${str(r.property)}, ${longDate(str(r.as_of))}`,
    creator: `FactLot ${k.p.version}`,
    created: k.p.generatedAt.toISOString().replace(/\.\d+Z$/, "Z"),
    footer: k.p.footer,
  });
  const read = wb.sheet("Read_me");
  read.width(1, 110);
  read.put(1, 1, "Rent roll certificate", "title");
  read.put(2, 1, `${str(r.property)}, as of ${longDate(str(r.as_of))}`, "text");
  read.banner(4, 1, 1, RENT_ROLL_NOTICE, "note", 3);
  read.banner(
    5,
    1,
    1,
    "Sheets: Lines (one row per roll line with its grade), Differences (each field that differs, with both figures and the quotes), Rollover, Flags and Sources. The Lines totals are live formulas.",
    "note",
    2,
  );

  const g = wb.sheet("Lines");
  [6, 8, 30, 12, 16, 16, 16, 14, 14, 30, 40].forEach((x, i) =>
    g.width(i + 1, x),
  );
  g.put(1, 1, "Rent roll lines and grades", "title");
  [
    "No.",
    "Suite",
    "Tenant",
    "Area on roll (SF)",
    "Annual rent per roll",
    "Annual rent per lease",
    "Roll less lease",
    "Expiration per roll",
    "Expiration per lease",
    "Grade",
    "Why, if not a match",
  ].forEach((h, i) => g.put(3, i + 1, h, "header"));
  lines.forEach((l, i) => {
    const row = 4 + i;
    const ro = l.roll as Json;
    const le = l.lease as Json;
    g.put(row, 1, n(l.number) ?? 0, "int");
    g.put(row, 2, str(l.suite ?? ""), "text");
    g.put(row, 3, l.occupancy === "vacant" ? "Vacant" : str(l.tenant), "text");
    const a = n(ro.area_sf);
    if (a !== null) g.put(row, 4, a, "num4");
    const ra = n(ro.annual_base_rent);
    if (ra !== null) g.put(row, 5, ra, "money");
    const la = n(le.annual_base_rent);
    if (la !== null) g.put(row, 6, la, "money");
    if (ra !== null && la !== null)
      g.put(row, 7, { formula: `=E${row}-F${row}` }, "money");
    if (ro.lease_expiration_date)
      g.put(row, 8, str(ro.lease_expiration_date), "text");
    if (le.expiration_date) g.put(row, 9, str(le.expiration_date), "text");
    g.put(
      row,
      10,
      l.occupancy === "vacant" ? "Not graded" : GRADE_SHORT[str(l.grade)]!,
      "text",
    );
    g.put(row, 11, prose((l.reasons as string[]).join("; ")), "text");
  });
  const last = 3 + lines.length;
  const tot = last + 1;
  g.put(tot, 3, "Total (lease rent: lines that have one)", "total_text");
  g.put(tot, 4, { formula: `=SUM(D4:D${last})` }, "total_money");
  g.put(tot, 5, { formula: `=SUM(E4:E${last})` }, "total_money");
  g.put(tot, 6, { formula: `=SUM(F4:F${last})` }, "total_money");
  g.freeze = "D4";

  const d = wb.sheet("Differences");
  [6, 30, 28, 22, 22, 14, 60, 60].forEach((x, i) => d.width(i + 1, x));
  d.put(1, 1, "Fields that differ", "title");
  [
    "No.",
    "Line",
    "Field",
    "Roll",
    "Compared with",
    "Difference",
    "Roll quote (page)",
    "Compared quote (page)",
  ].forEach((h, i) => d.put(3, i + 1, h, "header"));
  let row = 4;
  for (const l of lines)
    for (const c of arr(l.checks).filter((x) => x.status === "differs")) {
      const rs = c.roll_source as Json | null;
      const ls = c.lease_source as Json | null;
      d.put(row, 1, n(l.number) ?? 0, "int");
      d.put(row, 2, lineName(l), "text");
      d.put(row, 3, str(c.label), "text");
      d.put(row, 4, shown(c.roll_value, c.unit), "text");
      d.put(row, 5, shown(c.against_value, c.unit), "text");
      d.put(row, 6, diffShown(c), "text");
      d.put(row, 7, rs ? `${str(rs.quote)} (page ${n(rs.page)})` : "", "text");
      d.put(row, 8, ls ? `${str(ls.quote)} (page ${n(ls.page)})` : "", "text");
      row++;
    }
  d.freeze = "A4";

  const ro = wb.sheet("Rollover");
  [30, 10, 14, 16, 18, 16].forEach((x, i) => ro.width(i + 1, x));
  ro.put(1, 1, "Rollover by year of expiration on the roll", "title");
  [
    "Expiring in",
    "Leases",
    "Area (SF)",
    "Share of occupied area",
    "Annual base rent",
    "Share of stated rent",
  ].forEach((h, i) => ro.put(3, i + 1, h, "header"));
  arr(r.rollover).forEach((x, i) => {
    ro.put(4 + i, 1, str(x.period), "text");
    ro.put(4 + i, 2, n(x.leases) ?? 0, "int");
    ro.put(4 + i, 3, n(x.area_sf) ?? 0, "num4");
    if (n(x.share_of_occupied_area) !== null)
      ro.put(4 + i, 4, n(x.share_of_occupied_area)!, "pct2");
    ro.put(4 + i, 5, n(x.annual_base_rent) ?? 0, "money");
    if (n(x.share_of_stated_rent) !== null)
      ro.put(4 + i, 6, n(x.share_of_stated_rent)!, "pct2");
  });

  const fl = wb.sheet("Flags");
  [34, 10, 120].forEach((x, i) => fl.width(i + 1, x));
  fl.put(1, 1, "Points to check", "title");
  ["Point", "Line", "What was found"].forEach((h, i) =>
    fl.put(3, i + 1, h, "header"),
  );
  arr(r.flags).forEach((f, i) => {
    fl.put(4 + i, 1, FLAG_TITLE[str(f.code)] ?? "Point to check", "text");
    fl.put(4 + i, 2, str(f.line_id ?? ""), "text");
    fl.put(4 + i, 3, prose(str(f.message)), "text");
  });

  const so = wb.sheet("Sources");
  [12, 8, 12, 14, 66, 70].forEach((x, i) => so.width(i + 1, x));
  so.put(1, 1, "Sources and document fingerprints", "title");
  ["Line", "Page", "Document", "Predicate", "Fact id", "SHA-256"].forEach(
    (h, i) => so.put(3, i + 1, h, "header"),
  );
  let sr = 4;
  const seen = new Set<string>();
  for (const l of lines) {
    const all = [
      ...arr(l.roll_facts),
      ...arr(l.checks)
        .map((c) => c.lease_source as Json | null)
        .filter((x): x is Json => x !== null),
    ];
    for (const s of all) {
      if (seen.has(str(s.fact_id))) continue;
      seen.add(str(s.fact_id));
      so.put(sr, 1, n(l.number) ?? 0, "int");
      so.put(sr, 2, n(s.page) ?? 0, "int");
      so.put(sr, 3, sha8(s.document_id), "text");
      so.put(sr, 4, str(s.predicate), "text");
      so.put(sr, 5, str(s.fact_id), "text");
      so.put(sr, 6, sha64(s.document_id, s.sha256), "text");
      sr++;
    }
  }
  return wb.bytes();
}
