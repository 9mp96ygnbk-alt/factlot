/**
 * An invented rent roll with its leases, for tests, the sample report and the docs. Every
 * organisation, building and figure is made up. Expected results are worked by hand in the tests.
 */
type Json = Record<string, unknown>;

export const ROLL_DOC = "fl:document:sha256-" + "f".repeat(64);
const SUBJECT = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4";
export const leaseDoc = (i: number): string =>
  "fl:document:sha256-" + "0123456789abcdef"[i % 16]!.repeat(64);

interface Spec {
  id: string;
  tenant: string;
  suite: string;
  area: number;
  start: string;
  exp: string;
  monthly?: number;
  annual?: number;
  psf?: number;
  /** What the lease says, when it differs from the roll or is partly missing. */
  lease?:
    | false
    | {
        exp?: string;
        area?: number;
        psfNow?: number | null;
        tenant?: string;
        deposit?: number;
        renewal?: { count: number; term_months: number };
        freeMonths?: number;
      };
  deposit?: number;
  nextStep?: { date: string; annual_rent_psf: number };
  renewal?: { count: number; term_months: number };
  freeOutstanding?: number;
  recoveries?: { structure: string; base_year?: number };
  estoppel?: boolean;
}

const NOW_STEP_FROM = "2026-07-01";
const NOW_STEP_TO = "2027-06-30";

const SPECS: Spec[] = [
  {
    id: "L1",
    tenant: "Birchwood Analytics Inc",
    suite: "210",
    area: 8400,
    start: "2023-07-01",
    exp: "2033-06-30",
    monthly: 23100,
    annual: 277200,
    psf: 33,
    deposit: 46200,
    nextStep: { date: "2027-07-01", annual_rent_psf: 34 },
    renewal: { count: 2, term_months: 60 },
    recoveries: { structure: "nnn" },
    lease: {
      psfNow: 33,
      deposit: 46200,
      renewal: { count: 2, term_months: 60 },
    },
    estoppel: true,
  },
  {
    id: "L2",
    tenant: "Larkspur Dental Group LLC",
    suite: "110",
    area: 3200,
    start: "2022-04-01",
    exp: "2029-03-31",
    monthly: 9866.67,
    annual: 118400,
    psf: 37,
    lease: { psfNow: 36 },
  },
  {
    id: "L3",
    tenant: "Quillfeather Legal Partners",
    suite: "300",
    area: 11000,
    start: "2021-03-01",
    exp: "2027-02-28",
    monthly: 28416.67,
    annual: 341000,
    psf: 31,
    lease: { psfNow: 31 },
  },
  {
    id: "L4",
    tenant: "Meridian Fox Coffee Co",
    suite: "100",
    area: 1800,
    start: "2024-01-01",
    exp: "2029-12-31",
    monthly: 6300,
    annual: 75600,
    psf: 42,
    lease: false,
  },
  {
    id: "L5",
    tenant: "Tamarack Engineering Inc",
    suite: "400",
    area: 9600,
    start: "2019-10-01",
    exp: "2030-09-30",
    monthly: 25600,
    annual: 307200,
    psf: 32,
    lease: { exp: "2029-09-30", psfNow: 32 },
  },
  {
    id: "L6",
    tenant: "Northgate Pediatrics PA",
    suite: "120",
    area: 4500,
    start: "2020-06-01",
    exp: "2030-05-31",
    monthly: 15750,
    annual: 189000,
    psf: 42,
    lease: { psfNow: null },
  },
  {
    id: "L7",
    tenant: "Ironbridge Staffing LLC",
    suite: "220",
    area: 6250,
    start: "2023-01-01",
    exp: "2028-12-31",
    monthly: 17708.33,
    annual: 212500,
    psf: 34,
    deposit: 35416.66,
    renewal: { count: 1, term_months: 36 },
    recoveries: { structure: "base_year", base_year: 2023 },
    lease: {
      psfNow: 34,
      deposit: 35416.66,
      renewal: { count: 1, term_months: 36 },
    },
  },
  {
    id: "L8",
    tenant: "Willowmere Financial Planning LLC",
    suite: "310",
    area: 2750,
    start: "2025-09-01",
    exp: "2030-08-31",
    monthly: 8250,
    annual: 99000,
    psf: 36,
    freeOutstanding: 2,
    lease: { psfNow: 36, freeMonths: 3 },
  },
  {
    id: "L9",
    tenant: "Ostrander Print & Signs Inc",
    suite: "130",
    area: 3800,
    start: "2021-01-01",
    exp: "2026-12-31",
    monthly: 9500,
    annual: 114000,
    psf: 30,
    lease: { psfNow: 30 },
  },
  {
    id: "L10",
    tenant: "Halcyon Yoga Studio LLC",
    suite: "140",
    area: 2900,
    start: "2024-05-01",
    exp: "2031-04-30",
    monthly: 9425,
    annual: 113100,
    psf: 39,
    lease: { psfNow: 39 },
  },
];

let n = 0;
function fact(
  predicate: string,
  value: unknown,
  quote: string,
  doc: string,
  page = 1,
): Json {
  n += 1;
  return {
    id: `flf_rr${n}`,
    subject: SUBJECT,
    predicate,
    value,
    as_of: "2026-11-20",
    provenance: {
      method: "extracted",
      sources: [{ document_id: doc, page, quote }],
    },
  };
}

const usd = (x: number): string =>
  x.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function rentRollCase(opts: { estoppel?: boolean } = {}): Json {
  n = 0;
  const roll_lines: Json[] = [];
  const leases: Json[] = [];
  SPECS.forEach((s, i) => {
    const row = `${s.tenant}  ${s.suite}  ${s.area.toLocaleString("en-US")}  ${s.start}  ${s.exp}  ${usd(s.monthly!)}  ${usd(s.annual!)}  ${usd(s.psf!)}`;
    const page = i < 6 ? 1 : 2;
    const f = (p: string, v: unknown): Json =>
      fact(`rent_roll.${p}`, v, row, ROLL_DOC, page);
    const facts: Json[] = [
      f("tenant_name", s.tenant),
      f("suite", s.suite),
      f("rentable_area_sf", s.area),
      f("lease_start_date", s.start),
      f("lease_expiration_date", s.exp),
      f("base_rent_monthly", s.monthly),
      f("base_rent_annual", s.annual),
      f("base_rent_psf", s.psf),
    ];
    if (s.deposit !== undefined) facts.push(f("security_deposit", s.deposit));
    if (s.nextStep)
      facts.push(
        f("next_rent_step", {
          date: s.nextStep.date,
          annual_rent_psf: s.nextStep.annual_rent_psf,
        }),
      );
    if (s.renewal) facts.push(f("renewal_option", s.renewal));
    if (s.freeOutstanding !== undefined)
      facts.push(f("free_rent_outstanding", { months: s.freeOutstanding }));
    if (s.recoveries) facts.push(f("recoveries", s.recoveries));
    roll_lines.push({ line_id: s.id, facts });
    if (s.lease === false) return;
    const L = s.lease ?? {};
    const doc = leaseDoc(i + 1);
    const lf = (p: string, v: unknown, q: string, pg = 1): Json =>
      fact(`lease.${p}`, v, q, doc, pg);
    const exp = L.exp ?? s.exp;
    const area = L.area ?? s.area;
    const lfacts: Json[] = [
      lf(
        "tenant",
        L.tenant ?? s.tenant,
        `and ${L.tenant ?? s.tenant} (“Tenant”)`,
      ),
      lf("commencement_date", s.start, `The Commencement Date is ${s.start}.`),
      lf("expiration_date", exp, `The Term shall expire on ${exp}.`, 2),
      lf(
        "rentable_area_sf",
        area,
        `containing approximately ${area.toLocaleString("en-US")} rentable square feet`,
      ),
    ];
    if (L.psfNow !== null) {
      const sched: { from: string; to: string; annual_rent_psf: number }[] = [
        {
          from: NOW_STEP_FROM,
          to: NOW_STEP_TO,
          annual_rent_psf: L.psfNow ?? s.psf!,
        },
      ];
      if (s.nextStep)
        sched.push({
          from: s.nextStep.date,
          to: "2028-06-30",
          annual_rent_psf: s.nextStep.annual_rent_psf,
        });
      lfacts.push(
        lf(
          "base_rent_schedule",
          sched,
          sched
            .map(
              (x) =>
                `${x.from} to ${x.to}: $${x.annual_rent_psf.toFixed(2)} per RSF`,
            )
            .join("; "),
          3,
        ),
      );
    }
    if (L.deposit !== undefined)
      lfacts.push(
        lf(
          "security_deposit",
          L.deposit,
          `Tenant shall deposit $${usd(L.deposit)} as security`,
          4,
        ),
      );
    if (L.renewal)
      lfacts.push(
        lf(
          "renewal_option",
          { ...L.renewal, notice_months: 12 },
          `Tenant has ${L.renewal.count} option(s) to extend for ${L.renewal.term_months} months on 12 months notice`,
          6,
        ),
      );
    if (L.freeMonths !== undefined)
      lfacts.push(
        lf(
          "free_rent",
          { months: L.freeMonths, applies_to: "base_rent" },
          `Base Rent is abated for ${L.freeMonths} months`,
          3,
        ),
      );
    if (s.recoveries?.structure === "base_year") {
      lfacts.push(
        lf(
          "recovery_structure",
          { structure: "base_year" },
          "Tenant pays its share of increases over the Base Year",
          5,
        ),
      );
      lfacts.push(
        lf(
          "operating_expense_base_year",
          s.recoveries.base_year,
          `The Base Year is calendar year ${s.recoveries.base_year}`,
          5,
        ),
      );
    }
    const entry: Json = { line_id: s.id, facts: lfacts };
    if (s.estoppel && opts.estoppel !== false)
      entry.estoppel = {
        package_id: "00000000-0000-4000-8000-000000000001",
        as_of: "2026-11-20",
        statements: [
          { key: "S03", code: "COMMENCEMENT", decision: "agreed" },
          { key: "S04", code: "EXPIRATION", decision: "agreed" },
          { key: "S05", code: "PREMISES", decision: "agreed" },
          { key: "S06", code: "BASE_RENT", decision: "agreed" },
        ],
      };
    leases.push(entry);
  });
  // A lease supplied with no roll line.
  leases.push({
    label: "Tidewater Surveying Inc",
    facts: [
      fact(
        "lease.tenant",
        "Tidewater Surveying Inc",
        "and Tidewater Surveying Inc (“Tenant”)",
        leaseDoc(12),
      ),
      fact(
        "lease.expiration_date",
        "2028-03-31",
        "The Term shall expire on 2028-03-31.",
        leaseDoc(12),
        2,
      ),
    ],
  });
  // The vacant line.
  const vrow = "Vacant  500  7,800";
  roll_lines.push({
    line_id: "V1",
    occupancy: "vacant",
    facts: [
      fact("rent_roll.suite", "500", vrow, ROLL_DOC, 2),
      fact("rent_roll.rentable_area_sf", 7800, vrow, ROLL_DOC, 2),
    ],
  });
  return {
    property: { label: "Alder Court Office Building, Alder Street" },
    as_of: "2026-11-20",
    parties: {
      certifier: { organisation: "Alder Court Holdings LLC", role: "borrower" },
      relying_party: {
        organisation: "Northfield Credit Partners LLC",
        role: "lender",
      },
    },
    roll_document: { title: "Rent roll as of November 20, 2026" },
    building_area_sf: 62000,
    roll_lines,
    leases,
  };
}
