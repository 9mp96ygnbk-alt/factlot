// Invented portfolios for the audit_expense_portfolio tests, the report tests and the sample report
// (no tests of its own). Every company, building and number is invented.
type Json = Record<string, unknown>;

const SUBJECT = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4";

function quoteFor(n: number, predicate: string, value: unknown): string {
  if (predicate === "lease.pro_rata_share")
    return `Tenant's Proportionate Share is ${((value as number) * 100).toFixed(2)}%`;
  if (predicate === "lease.cam_cap")
    return "Controllable Operating Expenses shall not increase by more than five percent (5%) per year, on a cumulative and compounding basis";
  if (predicate === "lease.operating_expense_base_year")
    return `the Base Year shall be calendar year ${value}`;
  return `Synthetic clause stating ${predicate} number ${n}`;
}

export interface Spec {
  label: string;
  landlord?: string;
  year?: number;
  /** Document digest letter (hex digit) so each location has its own documents. */
  doc: string;
  share?: number;
  scale?: number;
  feeBase?: boolean; // fee charged on every line (fee-base error)
  cap?: boolean; // cap exceeded
  share_wrong?: boolean; // statement applies a different share
  excluded?: boolean; // advertising billed
  received?: string;
  noAuditRight?: boolean;
  window?: number;
}

/** The facts of one invented location (landlord and tenant are invented). */
export function locationInput(s: Spec, asOf = "2026-11-20"): Json {
  const scale = s.scale ?? 1;
  const share = s.share ?? 0.08;
  const year = s.year ?? 2025;
  const doc = (side: string) =>
    `fl:document:sha256-${((side === "l" ? "a" : "b") + s.doc).repeat(32).slice(0, 64)}`;
  let n = 0;
  const f = (predicate: string, value: unknown, side: "l" | "s", page = 1) => ({
    id: `flf_${s.doc}${++n}`,
    subject: SUBJECT,
    predicate,
    value,
    as_of: "2026-03-01",
    provenance: {
      method: "extracted",
      sources: [
        { document_id: doc(side), page, quote: quoteFor(n, predicate, value) },
      ],
    },
  });
  const lines: Json[] = [
    {
      label: "Real estate taxes",
      amount: 400000 * scale,
      controllable: false,
      variable: false,
    },
    {
      label: "Insurance",
      amount: 100000 * scale,
      controllable: false,
      variable: false,
    },
    {
      label: "Janitorial",
      amount: 150000 * scale,
      controllable: true,
      variable: true,
    },
    {
      label: "Repairs and maintenance",
      amount: 120000 * scale,
      controllable: true,
      variable: false,
    },
    {
      label: "Landscaping",
      amount: 80000 * scale,
      controllable: true,
      variable: false,
    },
  ];
  if (s.excluded)
    lines.push({
      label: "Advertising and promotion",
      amount: 20000 * scale,
      controllable: true,
      variable: false,
    });
  const total = lines.reduce((a, l) => a + (l.amount as number), 0);
  const ctl = lines
    .filter((l) => l.controllable)
    .reduce((a, l) => a + (l.amount as number), 0);
  const nonFee = 500000 * scale;
  const feeBase = s.feeBase ? share * total : share * (total - nonFee);
  const ref = 24000 * scale;
  const capLimit = Math.round(ref * 1.05 ** 3 * 100) / 100;
  const billedCtl = share * ctl;
  const applied = s.cap ? null : capLimit;
  const feeAmt = Math.round(feeBase * 0.1 * 100) / 100;
  const charge = Math.round((share * total + feeAmt) * 100) / 100;
  const lease: [string, unknown][] = [
    ["lease.pro_rata_share", share],
    ["lease.cam_cap", { method: "compounding_from_base", rate: 0.05 }],
    [
      "lease.cam_admin_fee",
      {
        rate: 0.1,
        base: "actual",
        excluded_from_base: ["real estate taxes", "insurance"],
      },
    ],
    ["lease.cam_exclusion", { category: "advertising" }],
    [
      "lease.capex_treatment",
      { keywords: ["roof", "replacement"], recoverable: "excluded" },
    ],
  ];
  if (!s.noAuditRight)
    lease.push([
      "lease.audit_right",
      {
        window_days: s.window ?? 120,
        starts_from: "statement_receipt",
        notice_form:
          "written notice to Landlord's notice address by certified mail",
        cost_shift_threshold: { type: "percent_of_billed", value: 0.03 },
      },
    ]);
  const lease_facts = lease.map(([p, v]) => f(p, v, "l"));
  void billedCtl;
  const statement_facts = [
    f(
      "statement.period",
      {
        year,
        statement_date: "2026-03-01",
        received_date: s.received ?? "2026-03-10",
      },
      "s",
      2,
    ),
    f(
      "statement.share_applied",
      { share: s.share_wrong ? share + 0.005 : share },
      "s",
      2,
    ),
    f("statement.total", { amount: total }, "s", 2),
    f(
      "statement.admin_fee",
      {
        rate: 0.1,
        base_amount: Math.round(feeBase * 100) / 100,
        amount: feeAmt,
      },
      "s",
      2,
    ),
    f("statement.cap_reference", { year: year - 3, amount: ref }, "s", 2),
    f("statement.cap_applied", { limit: applied }, "s", 2),
    f("statement.tenant_charge", { amount: charge }, "s", 2),
    ...lines.map((l) => f("statement.line", l, "s", 2)),
  ];
  const out: Json = { label: s.label, lease_facts, statement_facts };
  if (s.landlord) out.landlord = s.landlord;
  void asOf;
  return out;
}

/** Eleven invented locations across four invented landlords (the sample report). */
export const SAMPLE_SPECS: Spec[] = [
  {
    label: "Cedar Point, Suite 110",
    landlord: "Alder Court Holdings LLC",
    doc: "1",
    feeBase: true,
    cap: true,
  },
  {
    label: "Cedar Point, Suite 110 (2024)",
    landlord: "Alder Court Holdings LLC",
    doc: "2",
    year: 2024,
    feeBase: true,
    received: "2025-03-14",
  },
  {
    label: "Harbor Row, Unit 4",
    landlord: "Alder Court Holdings LLC",
    doc: "3",
    cap: true,
    scale: 1.4,
  },
  {
    label: "Millbrook Plaza, Bay 12",
    landlord: "Northgate Property Partners",
    doc: "4",
    excluded: true,
    share_wrong: true,
  },
  {
    label: "Millbrook Plaza, Bay 14",
    landlord: "Northgate Property Partners",
    doc: "5",
    excluded: true,
    scale: 0.8,
  },
  {
    label: "Stonebridge Center, Floor 3",
    landlord: "Stonebridge Realty Trust",
    doc: "6",
    feeBase: true,
    scale: 2,
    share: 0.05,
    received: "2026-02-02",
    window: 90,
  },
  {
    label: "Tamarack Commons, Space 7",
    landlord: "Tamarack Commons Associates",
    doc: "7",
    scale: 0.6,
  },
  {
    label: "Westfield Row, Suite 200",
    landlord: "Northgate Property Partners",
    doc: "8",
    cap: true,
    received: "2026-01-12",
    window: 90,
  },
  {
    label: "Fairhaven Square, Unit 9",
    landlord: "Stonebridge Realty Trust",
    doc: "9",
    scale: 1.2,
  },
  { label: "Linden Park, Suite 3", doc: "a", feeBase: true, scale: 0.7 },
  {
    label: "Ridgeview Annex",
    landlord: "Tamarack Commons Associates",
    doc: "b",
    noAuditRight: true,
    share_wrong: true,
  },
];

export function samplePortfolio(asOf = "2026-04-01"): Json {
  return { audits: SAMPLE_SPECS.map((s) => locationInput(s)), as_of: asOf };
}
