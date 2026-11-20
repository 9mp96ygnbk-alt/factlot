/**
 * expense_audit_portfolio: a tenant's audit of many landlord expense statements at once
 * (audit_expense_portfolio), in the institutional style (institutional.ts). PDF, and an XLSX with one
 * row per location and one row per finding.
 */
import { Workbook } from "../xlsx.ts";
import { usd } from "../format.ts";
import { InstitutionalWriter, type Cell } from "../institutional.ts";
import type { KindInput } from "./common.ts";
import {
  BASIS,
  SHORT_TITLE,
  big,
  cents,
  digest,
  longDate,
  plainNeeds,
  readable,
} from "./audit.ts";

type Json = Record<string, unknown>;

export const PORTFOLIO_NOTICE =
  "Each location was audited on its own with the same twelve checks: the landlord's statement is compared with what the lease terms supplied for that location yield, each term and statement figure carrying the quotation and page it was read from. A finding that follows from the lease states a difference worked from the quoted terms; a finding that depends on a reading, or a question to raise, is labelled so. None is a legal conclusion: confirm each against that location's lease and its amendments before relying on it. Totals add the locations' findings; they are not a recomputed charge.";

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : String(v ?? "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
const NO_LANDLORD = "Landlord not named";

function daysText(status: string, days: number): string {
  return status === "open"
    ? `open, ${plural(days, "day")} left`
    : `passed ${plural(-days, "day")} ago`;
}

export async function auditPortfolioPdf(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as Json;
  const p = r.portfolio as Json;
  const locations = arr(r.locations);
  const invalid = arr(r.locations_invalid);
  const asOf = longDate(str(r.as_of));
  const preparedFor = k.ctx.prepared_for;
  const subject = k.ctx.title;
  const audited = num(p.locations_audited) ?? 0;
  const years = [
    ...new Set(
      locations
        .map((l) => num(l.statement_year))
        .filter((y): y is number => y !== null),
    ),
  ].sort((a, b) => a - b);
  const yearText =
    years.length === 0
      ? "Statement year not given"
      : years.length === 1
        ? `Statement year ${years[0]}`
        : `Statement years ${years[0]} to ${years[years.length - 1]}`;

  const w = await InstitutionalWriter.create({
    title: "Operating expense statement audit, portfolio",
    subject: `Operating expense statement audit, ${plural(audited, "location")}, ${asOf}`,
    brand: "FactLot",
    mastheadRight: `Expense statement audit, portfolio  ·  ${asOf}`,
    runningHeader: `Expense statement audit, portfolio${preparedFor ? `  ·  ${preparedFor}` : ""}`,
    footer: `Prepared from the documents supplied. Not legal advice. FactLot ${k.p.version}.`,
    producer: `FactLot ${k.p.version} reports`,
    keywords: k.p.keywords,
    created: k.p.generatedAt,
  });

  // ---- page 1 ---------------------------------------------------------------------------------
  w.titleBlock({
    title: "Operating expense statement audit, portfolio",
    line: [`${plural(audited, "location")} audited`, yearText, subject]
      .filter(Boolean)
      .join("  ·  "),
    preparedFor,
    asOf,
  });
  const early = p.earliest_deadline as Json | null;
  const cells: Cell[] = [
    {
      figure: String(audited),
      label:
        invalid.length > 0
          ? `Locations audited (${invalid.length} not audited: see the last section)`
          : "Locations audited",
    },
    {
      figure: big(num(p.total_difference)),
      label: `Total at stake: ${big(num(p.firm_difference))} follows from the leases' terms`,
    },
    {
      figure: String(num(p.finding_count) ?? 0),
      label: (num(p.finding_count) ?? 0) === 1 ? "Finding" : "Findings",
    },
    early
      ? {
          figure: longDate(str(early.last_day)),
          label: `Earliest last day to dispute: ${str(early.label)} (${plural(num(early.days_remaining) ?? 0, "day")} left)`,
        }
      : {
          figure: "None open",
          label:
            (num(p.passed_deadlines) ?? 0) > 0
              ? `${plural(num(p.passed_deadlines) ?? 0, "deadline")} passed as of ${asOf}`
              : "No deadline could be computed",
        },
  ];
  w.band(cells, { figureSize: 21, accent: true });

  // ---- summary by landlord --------------------------------------------------------------------
  w.section("Summary by landlord", 100);
  const landlords = arr(r.by_landlord);
  w.dataTable(
    [
      { header: "Landlord", width: 150 },
      { header: "Locations", width: 54, align: "right" },
      { header: "Findings", width: 52, align: "right" },
      { header: "Follows from lease", width: 76, align: "right" },
      { header: "Depends on reading", width: 76, align: "right" },
      { header: "At stake", width: 70, align: "right" },
    ],
    [
      ...landlords.map((l) => [
        str(l.landlord_name),
        String(l.locations),
        String(l.findings),
        cents(num(l.firm_difference)),
        cents(num(l.readings_difference)),
        cents(num(l.total_difference)),
      ]),
      [
        "Total",
        String(audited),
        String(num(p.finding_count) ?? 0),
        cents(num(p.firm_difference)),
        cents(num(p.readings_difference)),
        cents(num(p.total_difference)),
      ],
    ],
    { bold: new Set([landlords.length]) },
  );
  w.note("How to read this report", PORTFOLIO_NOTICE);

  // ---- ranked locations -----------------------------------------------------------------------
  w.section("Locations ranked by dollars at stake", 100);
  const ranking = arr(r.ranking);
  w.dataTable(
    [
      { header: "No.", width: 24, align: "right" },
      { header: "Location", width: 150 },
      { header: "Landlord", width: 120 },
      { header: "Year", width: 34, align: "right" },
      { header: "Findings", width: 44, align: "right" },
      { header: "At stake", width: 70, align: "right" },
    ],
    ranking.map((x) => [
      String(x.rank),
      str(x.label),
      x.landlord === null ? NO_LANDLORD : str(x.landlord),
      x.statement_year === null ? "" : str(x.statement_year),
      String(x.finding_count),
      cents(num(x.total_difference)),
    ]),
  );

  // ---- deadlines ------------------------------------------------------------------------------
  w.section("Dispute deadlines, in date order", 90);
  const deadlines = arr(r.deadlines);
  if (deadlines.length === 0)
    w.para(
      "No deadline could be computed: no location supplied its lease's audit right.",
      { color: "slate" },
    );
  else
    w.dataTable(
      [
        { header: "Last day", width: 84 },
        { header: "Location", width: 140 },
        { header: "Status", width: 98 },
        { header: "Counted from", width: 112 },
        { header: "Window", width: 52, align: "right" },
      ],
      deadlines.map((d) => [
        longDate(str(d.last_day)),
        str(d.label),
        daysText(str(d.status), num(d.days_remaining) ?? 0),
        `${d.starts_from === "statement_receipt" ? "Received" : "Dated"} ${longDate(str(d.counted_from))}`,
        `${num(d.window_days) ?? 0} days`,
      ]),
    );
  const noDeadline = arr(r.locations_without_deadline as unknown as Json[]);
  if ((r.locations_without_deadline as unknown[] | undefined)?.length)
    w.para(
      `No deadline could be computed for ${(r.locations_without_deadline as string[]).join("; ")}: the lease's audit right was not supplied.`,
      { color: "slate", size: 8.5, leading: 12 },
    );
  void noDeadline;
  w.para(
    "Each deadline is counted from the dates on the statement as supplied. Confirm how each lease counts days and what counts as notice, and the form of notice each lease requires, before relying on a date.",
    { color: "slate", size: 8.5, leading: 12 },
  );

  // ---- repeated issues ------------------------------------------------------------------------
  w.section("Repeated issues", 90);
  const repeated = arr(r.repeated_issues);
  if (repeated.length === 0)
    w.para(
      "No check found an overcharge at more than one location. A question to raise is not counted here.",
    );
  else
    w.dataTable(
      [
        { header: "Check", width: 120 },
        { header: "Where", width: 150 },
        { header: "Locations", width: 52, align: "right" },
        { header: "Years", width: 62 },
        { header: "At stake", width: 66, align: "right" },
      ],
      repeated.map((x) => [
        str(x.check_name),
        x.scope === "landlord"
          ? `Same landlord: ${str(x.landlord)}`
          : "Across landlords",
        String(x.location_count),
        arr(x.statement_years as unknown as Json[]).length
          ? (x.statement_years as number[]).join(", ")
          : "",
        cents(num(x.dollars_at_stake)),
      ]),
    );

  // ---- totals by class and by check -----------------------------------------------------------
  const classCols = [
    { header: "Class", width: 250 },
    { header: "Findings", width: 60, align: "right" as const },
    { header: "Dollars at stake", width: 90, align: "right" as const },
  ];
  const classRows = arr(r.by_class).map((c) => [
    BASIS[str(c.class)] ?? str(c.class),
    String(c.findings),
    str(c.class) === "question_to_ask"
      ? "no figure"
      : cents(num(c.dollars_at_stake)),
  ]);
  const checkCols = [
    { header: "Check", width: 150 },
    { header: "Findings", width: 52, align: "right" as const },
    { header: "Locations with a finding", width: 90, align: "right" as const },
    {
      header: "Locations where it could not run",
      width: 96,
      align: "right" as const,
    },
    { header: "At stake", width: 70, align: "right" as const },
  ];
  const checkRows = arr(r.by_check).map((c) => [
    str(c.name),
    String(c.findings),
    String(c.locations_with_findings),
    String(c.locations_not_run),
    cents(num(c.dollars_at_stake)),
  ]);
  // One table pair, kept on one page.
  if (
    w.room <
    w.dataTableHeight(classCols, classRows, { padY: 3 }) +
      w.dataTableHeight(checkCols, checkRows, { padY: 2.5, size: 8.25 }) +
      50
  )
    w.pageBreak();
  w.section("Totals by finding class and by check", 100);
  w.dataTable(classCols, classRows, { padY: 3 });
  w.dataTable(checkCols, checkRows, { padY: 2.5, size: 8.25 });

  // ---- one short section per location ---------------------------------------------------------
  locations.forEach((l, i) => {
    const s = l.summary as Json;
    const dollars = s.dollars_at_stake as Json;
    const findings = arr(l.findings);
    const dls = arr(s.deadlines);
    const notRun = arr(s.checks_not_run);
    const year = num(l.statement_year);
    w.section(`${i + 1}. ${str(l.label)}`, 120);
    w.label(
      [
        l.landlord === null ? NO_LANDLORD : str(l.landlord),
        year === null ? "" : `Statement year ${year}`,
        `${plural(num(s.finding_count) ?? 0, "finding")}, ${cents(num(dollars.total_difference))} at stake`,
      ]
        .filter(Boolean)
        .join("  ·  "),
    );
    w.space(4);
    if (findings.length === 0)
      w.para(
        "No finding: every check that could run found the statement consistent with the lease terms supplied.",
        { after: 4 },
      );
    else
      w.dataTable(
        [
          { header: "Finding", width: 150 },
          { header: "Basis", width: 76 },
          { header: "Landlord's figure", width: 66, align: "right" },
          { header: "Lease yields", width: 66, align: "right" },
          { header: "Difference", width: 60, align: "right" },
          { header: "Lease page", width: 40, align: "right" },
        ],
        findings.map((f) => [
          SHORT_TITLE[str(f.code)] ?? readable(str(f.title)),
          BASIS[str(f.class)] ?? str(f.class),
          cents(num(f.landlord_figure)),
          cents(num(f.lease_figure)),
          cents(num(f.difference)),
          (f.lease_pages as number[]).join(", "),
        ]),
        { size: 8.25 },
      );
    const lines: [string, string][] = [];
    const d = dls[0];
    lines.push([
      "Last day to dispute",
      d
        ? `${longDate(str(d.last_day))} (${daysText(str(d.status), num(d.days_remaining) ?? 0)}); notice: ${readable(str(d.notice_form))}`
        : "not computed, because the lease's audit right was not supplied",
    ]);
    if (notRun.length)
      lines.push([
        "Not checked",
        notRun
          .map((c) => {
            const name =
              arr(r.by_check).find((x) => x.check === c.check)?.name ?? c.check;
            return `${str(name)}${str(c.status) === "partly_run" ? " (partly)" : ""}`;
          })
          .join("; "),
      ]);
    for (const [name, text] of lines)
      w.para(`${name}: ${text}`, { size: 8.5, leading: 12, after: 3 });
  });

  // ---- locations not audited ------------------------------------------------------------------
  w.section("Locations not audited", 70);
  if (invalid.length === 0)
    w.para("Every location submitted was audited.", { color: "slate" });
  else {
    w.para(
      "These locations were left out because their input did not pass validation. Nothing about them is in the totals.",
      { after: 4 },
    );
    w.dataTable(
      [
        { header: "Location", width: 110 },
        { header: "What to fix", width: 260 },
      ],
      invalid.map((x) => [
        x.label ? str(x.label) : `Entry ${(num(x.index) ?? 0) + 1}`,
        arr(x.issues)
          .slice(0, 3)
          .map((i) => `${str(i.path)}: ${readable(str(i.message))}`)
          .join(" | "),
      ]),
    );
  }

  // ---- checks not performed (rolled up) --------------------------------------------------------
  const rolled = new Map<
    string,
    { check: string; names: string[]; reason: string }
  >();
  for (const l of locations)
    for (const c of arr((l.summary as Json).checks_not_run)) {
      const key = `${str(c.check)}|${str(c.reason)}`;
      const e = rolled.get(key) ?? {
        check: str(c.check),
        names: [],
        reason: str(c.reason),
      };
      e.names.push(str(l.label));
      rolled.set(key, e);
    }
  w.section("Checks not performed", 70);
  if (rolled.size === 0)
    w.para("Every check ran at every location audited.", { color: "slate" });
  else
    w.dataTable(
      [
        { header: "Check", width: 100 },
        { header: "Locations", width: 100 },
        { header: "What the check needs", width: 170 },
      ],
      [...rolled.values()].map((e) => [
        str(arr(r.by_check).find((x) => x.check === e.check)?.name ?? e.check),
        e.names.length === locations.length
          ? `All ${locations.length}`
          : e.names.length <= 3
            ? e.names.join("; ")
            : `${e.names.length} of ${locations.length}`,
        plainNeeds(e.reason),
      ]),
    );

  // ---- basis, important information, sources ----------------------------------------------------
  w.section("Basis of preparation", 60);
  const callerText = k.ctx.title || k.ctx.prepared_for;
  w.para(
    `This report audits each location's landlord statement against the lease terms supplied for it, each term and each statement figure carrying the quotation and page it was read from. The checks are fixed rules, not estimates: the same facts always give the same findings. A check with no supporting lease term is listed as not performed rather than guessed. Every location is the same audit as a single expense statement audit; the portfolio adds them up. Prepared by FactLot ${k.p.version} on ${longDate(k.p.generatedAt.toISOString().slice(0, 10))} (UTC)${
      callerText
        ? "; the title, the prepared-for line, and the location and landlord names are as the caller supplied them"
        : "; the location and landlord names are as the caller supplied them"
    }.`,
    { size: 8, leading: 11.5 },
  );
  w.section("Important information", 50);
  w.para(
    "This report is prepared from the documents supplied and has not been checked against any other source. It is not legal advice and states no legal conclusion; a finding that depends on a reading of a lease, or a question to raise, is labelled as such. Confirm each finding against that location's lease and its amendments, and take advice before disputing a statement or giving notice. Deadlines are counted from the dates on the statements as supplied.",
    { size: 8, leading: 11.5 },
  );
  w.section("Sources", 80);
  const doc = (ids: unknown): string =>
    (Array.isArray(ids) ? (ids as string[]) : [])
      .map((x) => digest(x))
      .filter(Boolean)
      .join(", ");
  w.dataTable(
    [
      { header: "Location", width: 150 },
      { header: "Lease document", width: 70, mono: true },
      { header: "Statement document", width: 70, mono: true },
      { header: "Facts used", width: 50, align: "right" },
    ],
    locations.map((l) => {
      const s = l.sources as Json;
      return [
        str(l.label),
        doc(s.lease_documents),
        doc(s.statement_documents),
        String(s.facts_used),
      ];
    }),
  );
  w.para(
    "Documents are shown by the first eight characters of their SHA-256 digest. Each finding's lease and statement quotations, pages and fact identifiers are in the location's own expense statement audit.",
    { color: "slate", size: 8, leading: 11.5 },
  );
  return w.bytes();
}

// ---- workbook --------------------------------------------------------------------------------

export async function auditPortfolioXlsx(k: KindInput): Promise<Uint8Array> {
  const r = k.checked.result as Json;
  const p = r.portfolio as Json;
  const locations = arr(r.locations);
  const wb = new Workbook({
    title: `Expense statement audit, portfolio, ${longDate(str(r.as_of))}`,
    creator: `FactLot ${k.p.version}`,
    created: k.p.generatedAt.toISOString().replace(/\.\d+Z$/, "Z"),
    footer: k.p.footer,
  });
  const read = wb.sheet("Read_me");
  read.width(1, 110);
  read.put(1, 1, "Expense statement audit, portfolio", "title");
  read.put(
    2,
    1,
    `${plural(num(p.locations_audited) ?? 0, "location")} audited, as of ${longDate(str(r.as_of))}`,
    "text",
  );
  read.banner(4, 1, 1, PORTFOLIO_NOTICE, "note", 4);
  read.banner(
    5,
    1,
    1,
    "Sheets: Locations (one row per location), Findings (one row per finding), Landlords, Deadlines and Repeated_issues. The totals are live formulas over the rows.",
    "note",
    2,
  );

  const g = wb.sheet("Locations");
  [6, 34, 30, 10, 10, 10, 10, 16, 16, 16, 16, 18].forEach((x, i) =>
    g.width(i + 1, x),
  );
  g.put(1, 1, "Locations", "title");
  [
    "No.",
    "Location",
    "Landlord",
    "Year",
    "Findings",
    "Follows from lease",
    "Depends on reading",
    "Follows from lease ($)",
    "Depends on reading ($)",
    "At stake ($)",
    "Last day to dispute",
    "Days left (as of)",
  ].forEach((h, i) => g.put(3, i + 1, h, "header"));
  locations.forEach((l, i) => {
    const row = 4 + i;
    const s = l.summary as Json;
    const dl = s.dollars_at_stake as Json;
    const d = arr(s.deadlines)[0];
    g.put(row, 1, i + 1, "int");
    g.put(row, 2, str(l.label), "text");
    g.put(row, 3, l.landlord === null ? NO_LANDLORD : str(l.landlord), "text");
    if (num(l.statement_year) !== null)
      g.put(row, 4, num(l.statement_year)!, "int");
    g.put(row, 5, num(s.finding_count) ?? 0, "int");
    g.put(row, 6, num(s.follows_from_terms) ?? 0, "int");
    g.put(row, 7, num(s.depends_on_reading) ?? 0, "int");
    g.put(row, 8, num(dl.firm_difference) ?? 0, "money");
    g.put(row, 9, num(dl.readings_difference) ?? 0, "money");
    g.put(row, 10, { formula: `=H${row}+I${row}` }, "money");
    if (d) {
      g.put(row, 11, str(d.last_day), "text");
      g.put(row, 12, num(d.days_remaining) ?? 0, "int");
    }
  });
  const last = 3 + locations.length;
  const tot = last + 1;
  g.put(tot, 2, "Total", "total_text");
  for (const c of [5, 6, 7])
    g.put(
      tot,
      c,
      {
        formula: `=SUM(${"ABCDEFGHIJKL"[c - 1]}4:${"ABCDEFGHIJKL"[c - 1]}${last})`,
      },
      "total_text",
    );
  for (const c of [8, 9, 10])
    g.put(
      tot,
      c,
      {
        formula: `=SUM(${"ABCDEFGHIJKL"[c - 1]}4:${"ABCDEFGHIJKL"[c - 1]}${last})`,
      },
      "total_money",
    );
  g.freeze = "C4";

  const f = wb.sheet("Findings");
  [6, 34, 30, 10, 44, 20, 16, 16, 16, 14, 14].forEach((x, i) =>
    f.width(i + 1, x),
  );
  f.put(1, 1, "Findings", "title");
  [
    "No.",
    "Location",
    "Landlord",
    "Year",
    "Finding",
    "Basis",
    "Landlord's figure",
    "Lease yields",
    "Difference",
    "Lease page",
    "Statement page",
  ].forEach((h, i) => f.put(3, i + 1, h, "header"));
  let row = 4;
  let n = 0;
  for (const l of locations)
    for (const x of arr(l.findings)) {
      f.put(row, 1, ++n, "int");
      f.put(row, 2, str(l.label), "text");
      f.put(
        row,
        3,
        l.landlord === null ? NO_LANDLORD : str(l.landlord),
        "text",
      );
      if (num(l.statement_year) !== null)
        f.put(row, 4, num(l.statement_year)!, "int");
      f.put(row, 5, SHORT_TITLE[str(x.code)] ?? readable(str(x.title)), "text");
      f.put(row, 6, BASIS[str(x.class)] ?? str(x.class), "text");
      if (num(x.landlord_figure) !== null)
        f.put(row, 7, num(x.landlord_figure)!, "money");
      if (num(x.lease_figure) !== null)
        f.put(row, 8, num(x.lease_figure)!, "money");
      if (num(x.difference) !== null)
        f.put(row, 9, num(x.difference)!, "money");
      f.put(row, 10, (x.lease_pages as number[]).join(", "), "text");
      f.put(row, 11, (x.statement_pages as number[]).join(", "), "text");
      row++;
    }
  if (n > 0) {
    f.put(row, 5, "Total difference", "total_text");
    f.put(row, 9, { formula: `=SUM(I4:I${row - 1})` }, "total_money");
  }
  f.freeze = "C4";

  const ll = wb.sheet("Landlords");
  [34, 11, 11, 18, 18, 18].forEach((x, i) => ll.width(i + 1, x));
  ll.put(1, 1, "Totals by landlord", "title");
  [
    "Landlord",
    "Locations",
    "Findings",
    "Follows from lease ($)",
    "Depends on reading ($)",
    "At stake ($)",
  ].forEach((h, i) => ll.put(3, i + 1, h, "header"));
  const lds = arr(r.by_landlord);
  lds.forEach((x, i) => {
    ll.put(4 + i, 1, str(x.landlord_name), "text");
    ll.put(4 + i, 2, num(x.locations) ?? 0, "int");
    ll.put(4 + i, 3, num(x.findings) ?? 0, "int");
    ll.put(4 + i, 4, num(x.firm_difference) ?? 0, "money");
    ll.put(4 + i, 5, num(x.readings_difference) ?? 0, "money");
    ll.put(4 + i, 6, { formula: `=D${4 + i}+E${4 + i}` }, "money");
  });
  const lt = 4 + lds.length;
  ll.put(lt, 1, "Total", "total_text");
  for (const [c, L] of [
    [2, "B"],
    [3, "C"],
  ] as const)
    ll.put(lt, c, { formula: `=SUM(${L}4:${L}${lt - 1})` }, "total_text");
  for (const [c, L] of [
    [4, "D"],
    [5, "E"],
    [6, "F"],
  ] as const)
    ll.put(lt, c, { formula: `=SUM(${L}4:${L}${lt - 1})` }, "total_money");

  const dd = wb.sheet("Deadlines");
  [14, 34, 30, 12, 12, 16, 60].forEach((x, i) => dd.width(i + 1, x));
  dd.put(1, 1, "Dispute deadlines, in date order", "title");
  [
    "Last day",
    "Location",
    "Landlord",
    "Status",
    "Days left",
    "Window (days)",
    "Notice the lease requires",
  ].forEach((h, i) => dd.put(3, i + 1, h, "header"));
  arr(r.deadlines).forEach((d, i) => {
    dd.put(4 + i, 1, str(d.last_day), "text");
    dd.put(4 + i, 2, str(d.label), "text");
    dd.put(
      4 + i,
      3,
      d.landlord === null ? NO_LANDLORD : str(d.landlord),
      "text",
    );
    dd.put(4 + i, 4, str(d.status), "text");
    dd.put(4 + i, 5, num(d.days_remaining) ?? 0, "int");
    dd.put(4 + i, 6, num(d.window_days) ?? 0, "int");
    dd.put(4 + i, 7, readable(str(d.notice_form)), "text");
  });

  const ri = wb.sheet("Repeated_issues");
  [30, 14, 34, 11, 16, 16, 18].forEach((x, i) => ri.width(i + 1, x));
  ri.put(1, 1, "Repeated issues", "title");
  [
    "Check",
    "Scope",
    "Landlord",
    "Locations",
    "Statement years",
    "Findings",
    "At stake ($)",
  ].forEach((h, i) => ri.put(3, i + 1, h, "header"));
  arr(r.repeated_issues).forEach((x, i) => {
    ri.put(4 + i, 1, str(x.check_name), "text");
    ri.put(
      4 + i,
      2,
      x.scope === "landlord" ? "Same landlord" : "Across landlords",
      "text",
    );
    ri.put(4 + i, 3, x.landlord === null ? "" : str(x.landlord), "text");
    ri.put(4 + i, 4, num(x.location_count) ?? 0, "int");
    ri.put(4 + i, 5, (x.statement_years as number[]).join(", "), "text");
    ri.put(4 + i, 6, num(x.finding_count) ?? 0, "int");
    ri.put(4 + i, 7, num(x.dollars_at_stake) ?? 0, "money");
  });
  void usd;
  return wb.bytes();
}
