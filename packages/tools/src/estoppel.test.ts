// estoppel_prepare: the statements a tenant certifies, prepared from verified lease facts. Every
// party, building and figure is invented; the expected figures are worked by hand in the comments.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ExchangeItem, FactPackageSendInput } from "./exchange.ts";
import { estoppelSummary, runTool, runWithExchangeCaller } from "./index.ts";

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

function args(extra: Json = {}, facts: Json[] = leaseFacts()): Json {
  return {
    lease_facts: facts,
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
    ...extra,
  };
}
function run(a: Json = args()): Json {
  const o = runTool("estoppel_prepare", a);
  assert.ok(o.ok, JSON.stringify(o));
  return o.result as Json;
}
const st = (r: Json, code: string): Json =>
  (r.statements as Json[]).find((s) => s.code === code)!;
const flagCodes = (s: Json): string[] =>
  (s.flags as Json[]).map((f) => String(f.code));

test("a full lease with one amendment: statements, figures and sources", () => {
  const r = run();
  const t = r.totals as Json;
  assert.equal(t.conflicts, 0);
  assert.equal(t.gaps, 0);
  // Lease statements from the lease facts, tenant statements without a source.
  for (const s of r.statements as Json[]) {
    if (s.basis === "tenant") {
      assert.deepEqual(s.fact_ids, [], `${String(s.code)} has no lease source`);
      assert.deepEqual(s.sources, []);
      assert.equal(s.status, "tenant_to_confirm");
    } else {
      assert.ok((s.sources as Json[]).length > 0, String(s.code));
      for (const src of s.sources as Json[]) {
        assert.ok(String(src.quote).length > 0);
        assert.equal(typeof src.page, "number");
        assert.match(String(src.sha256), /^[ab]{64}$/);
      }
    }
  }
  // Expiration: the amendment's date controls; the original sentence is shown as superseded.
  const exp = st(r, "EXPIRATION");
  assert.equal(exp.value, "2033-06-30");
  assert.match(String(exp.text), /June 30, 2033/);
  assert.deepEqual(
    (exp.sources as Json[]).map((s) => [s.fact_id, s.role]),
    [
      ["flf_exp_new", "lease"],
      ["flf_exp_old", "superseded"],
    ],
  );
  assert.ok(flagCodes(exp).includes("AMENDED"));
  // Rent as of 2026-11-20: step 2026-07-01 to 2027-06-30 at $32.78 x 8,400 SF = $275,352.00 a year, $22,946.00 a month.
  const rent = st(r, "BASE_RENT");
  assert.equal(rent.value, 275352);
  assert.match(
    String(rent.text),
    /\$275,352\.00 \(\$32\.78 per rentable square foot\), payable at \$22,946\.00 per month/,
  );
  // Next step 2027-07-01 at $33.76 x 8,400 = $283,584.00 a year, $23,632.00 a month.
  const next = st(r, "NEXT_RENT_STEP");
  assert.equal(next.value, 283584);
  assert.match(String(next.text), /July 1, 2027.*\$283,584\.00.*\$23,632\.00/);
  // Between the original schedule (ends 2028-06-30) and the amendment's (starts 2028-07-01) nothing is missing.
  assert.ok(!flagCodes(rent).includes("RENT_SCHEDULE_GAP"));
  assert.equal((r.key_figures as Json).annual_base_rent, 275352);
  assert.equal((r.key_figures as Json).monthly_base_rent, 22946);
  assert.equal((r.key_figures as Json).security_deposit, 30000);
  // Lease documents: the lease and one amendment, both with fingerprints.
  const docs = r.documents as Json[];
  assert.deepEqual(
    docs.map((d) => d.role),
    ["original", "amendment"],
  );
  assert.equal(docs[1]!.effective_date, "2026-01-01");
  assert.match(
    String(st(r, "LEASE_DOCUMENTS").text),
    /Amendment No\. 1, effective January 1, 2026/,
  );
  // The options, TI and free rent are stated from the lease.
  assert.match(
    String(st(r, "OPTION_RENEWAL").text),
    /one option to extend the term for 60 months on 12 months' notice at 95% of Fair Market Rent/,
  );
  assert.equal(st(r, "TI_ALLOWANCE").value, 168000);
  assert.match(String(st(r, "FREE_RENT").text), /3 months of abated base rent/);
  // The tenant-only statements that refer to others name them.
  assert.match(String(st(r, "LANDLORD_OBLIGATIONS").text), /statement \d+/);
  assert.match(
    String(st(r, "OPTIONS_COMPLETE").text),
    /other than those stated in statement \d+/,
  );
});

test("rent paid through: the landlord's date is shown as the landlord's; without it the tenant states it", () => {
  const without = run();
  const a = st(without, "RENT_PAID_THROUGH");
  assert.equal(a.needs_tenant_value, true);
  assert.equal(a.value, "To be stated by the tenant");
  const items = without.package_items as Json[];
  assert.equal(items.find((i) => i.key === a.key)!.needs_tenant_value, true);
  const withDate = run(
    args({
      landlord_records: {
        rent_paid_through: "2026-11-30",
        security_deposit_held: 31000,
      },
    }),
  );
  const b = st(withDate, "RENT_PAID_THROUGH");
  assert.equal(b.needs_tenant_value, false);
  assert.equal(b.value, "2026-11-30");
  assert.deepEqual(b.sources, []);
  // The ledger's deposit differs from the lease's: flagged, never settled by the tool.
  assert.ok(
    flagCodes(st(withDate, "SECURITY_DEPOSIT_PAID")).includes(
      "DEPOSIT_LEDGER_DIFFERS",
    ),
  );
});

test("gaps: a term no fact supplies is a gap, never a guess", () => {
  const facts = leaseFacts().filter(
    (f) =>
      ![
        "lease.security_deposit",
        "lease.rentable_area_sf",
        "lease.renewal_option",
        "lease.ti_allowance",
        "lease.free_rent",
      ].includes(String(f.predicate)),
  );
  const r = run(args({}, facts));
  assert.equal(st(r, "SECURITY_DEPOSIT").status, "gap");
  assert.equal(st(r, "SECURITY_DEPOSIT").sendable, false);
  assert.equal(st(r, "PREMISES").status, "gap");
  // Without the area, rent is the rate per square foot only, with a gap flag.
  const rent = st(r, "BASE_RENT");
  assert.equal(rent.unit, "USD per SF per year");
  assert.equal(rent.value, 32.78);
  assert.ok(flagCodes(rent).includes("MISSING_LEASE_FACT"));
  const predicates = (r.gaps as Json[]).map((g) => g.predicate);
  for (const p of [
    "lease.security_deposit",
    "lease.rentable_area_sf",
    "lease.renewal_option",
    "lease.ti_allowance",
    "lease.free_rent",
  ])
    assert.ok(predicates.includes(p), p);
  // No option facts: the tenant statement says so and warns the person to check.
  assert.ok(flagCodes(st(r, "OPTIONS_COMPLETE")).includes("NO_OPTION_FACTS"));
  const keys = (r.package_items as Json[]).map((i) => i.key);
  assert.ok(!keys.includes(String(st(r, "SECURITY_DEPOSIT").key)));
  assert.equal((r.statements_withheld as Json[]).length, 2);
  assert.equal((r.totals as Json).gaps, 2);
});

test("conflict: lease and amendment disagree with no supersession; the statement is withheld", () => {
  const facts = leaseFacts();
  const amend = facts.find((f) => f.id === "flf_exp_new")!;
  delete amend.supersedes;
  const r = run(args({}, facts));
  const exp = st(r, "EXPIRATION");
  assert.equal(exp.status, "conflict");
  assert.equal(exp.sendable, false);
  assert.ok((exp.sources as Json[]).some((s) => s.role === "conflicting"));
  assert.equal((r.conflicts as Json[]).length, 1);
  assert.ok(!(r.package_items as Json[]).some((i) => i.key === exp.key));
});

test("an amendment that takes effect after as_of is pending and not used", () => {
  const r = run(args({ as_of: "2025-11-20" }));
  assert.equal(st(r, "EXPIRATION").value, "2028-06-30");
  assert.match(
    (r.warnings as string[]).join(" "),
    /take effect after the as-of date \(January 1, 2026\)/,
  );
  // The pending amendment's schedule is not used: the lease's own step for 2025-11-20 applies, 31.83.
  assert.equal(st(r, "BASE_RENT").value, 267372);
  assert.equal((r.documents as Json[]).length, 1);
  assert.ok(flagCodes(st(r, "EXPIRATION")).length === 0);
});

test("the schedule must cover as_of: otherwise no rent is stated", () => {
  const r = run(args({ as_of: "2034-01-01" }));
  const rent = st(r, "BASE_RENT");
  assert.equal(rent.status, "gap");
  assert.ok(flagCodes(rent).includes("RENT_SCHEDULE_DOES_NOT_COVER_AS_OF"));
  assert.equal(st(r, "NEXT_RENT_STEP").status, "gap");
  assert.ok(flagCodes(st(r, "EXPIRATION")).includes("TERM_EXPIRED"));
});

test("a hole in the rent schedule and a schedule that ends early are flagged", () => {
  const facts = leaseFacts().filter((f) => f.id !== "flf_rent_new");
  const r = run(args({}, facts));
  assert.ok(flagCodes(st(r, "BASE_RENT")).includes("RENT_SCHEDULE_ENDS_EARLY"));
  const holes = leaseFacts();
  const sched = holes.find((f) => f.id === "flf_rent_old")!;
  sched.value = [
    { from: "2023-07-01", to: "2024-06-30", annual_rent_psf: 30 },
    { from: "2025-07-01", to: "2026-06-30", annual_rent_psf: 31.83 },
    { from: "2026-07-01", to: "2027-06-30", annual_rent_psf: 32.78 },
  ];
  (sched.provenance as { sources: Json[] }).sources[0]!.quote =
    "July 1, 2023 to June 30, 2024: $30.00 per RSF; July 1, 2025 to June 30, 2026: $31.83 per RSF; July 1, 2026 to June 30, 2027: $32.78 per RSF";
  const r2 = run(args({}, holes));
  assert.ok(flagCodes(st(r2, "BASE_RENT")).includes("RENT_SCHEDULE_GAP"));
});

test("two current rent schedules that overlap with different rents conflict", () => {
  const facts = leaseFacts();
  delete facts.find((f) => f.id === "flf_rent_new")!.supersedes;
  const amend = facts.find((f) => f.id === "flf_rent_new")!;
  amend.value = [{ from: "2026-07-01", to: "2027-06-30", annual_rent_psf: 40 }];
  (amend.provenance as { sources: Json[] }).sources[0]!.quote =
    "July 1, 2026 to June 30, 2027: $40.00 per RSF";
  const r = run(args({}, facts));
  assert.equal(st(r, "BASE_RENT").status, "conflict");
  assert.equal(st(r, "NEXT_RENT_STEP").status, "conflict");
});

test("party names that differ from the lease are flagged", () => {
  const r = run(
    args({
      parties: {
        tenant: { organisation: "Birchwood Data Inc" },
        landlord: { organisation: "Alder Court Holdings LLC" },
      },
    }),
  );
  assert.ok(
    flagCodes(st(r, "LEASE_DOCUMENTS")).includes("TENANT_NAME_DIFFERS"),
  );
  assert.ok(
    !flagCodes(st(r, "LEASE_DOCUMENTS")).includes("LANDLORD_NAME_DIFFERS"),
  );
});

test("an option whose notice date has passed is flagged", () => {
  const facts = leaseFacts();
  facts.push(
    fact(
      "lease.renewal_notice_deadline",
      "2026-06-30",
      "the exercise notice must be received no later than June 30, 2026",
      { id: "flf_renew_dl", page: 6 },
    ),
  );
  const r = run(args({}, facts));
  assert.ok(
    flagCodes(st(r, "OPTION_RENEWAL")).includes("OPTION_NOTICE_DATE_PASSED"),
  );
  assert.match(
    String(st(r, "OPTION_RENEWAL").text),
    /Notice must be given by June 30, 2026/,
  );
});

test("package_items match fact_package_send's schema; every statement is state_ours; facts are listed once", () => {
  const r = run();
  const items = r.package_items as Json[];
  assert.equal(items.length, (r.totals as Json).sendable);
  for (const it of items) {
    const p = ExchangeItem.safeParse(it);
    assert.ok(p.success, JSON.stringify(it) + JSON.stringify(p.error?.issues));
    assert.equal(it.position, "state_ours");
  }
  const tenantItems = items.filter((i) => i.tenant_to_confirm === true);
  assert.ok(tenantItems.length >= 8);
  for (const it of tenantItems) assert.deepEqual(it.fact_ids, []);
  const ids = r.package_facts as string[];
  assert.equal(new Set(ids).size, ids.length);
  for (const it of items)
    for (const f of it.fact_ids as string[]) assert.ok(ids.includes(f));
  // The send schema accepts kind estoppel.
  assert.ok(FactPackageSendInput.shape.kind.safeParse("estoppel").success);
});

test("deterministic: the same facts give the same statements; fact order does not change them", () => {
  assert.deepEqual(run(), run());
  const reversed = leaseFacts().reverse();
  const a = run(args({}, reversed));
  const b = run();
  assert.deepEqual(
    (a.statements as Json[]).map((s) => s.text),
    (b.statements as Json[]).map((s) => s.text),
  );
});

test("refusals: a fact with no quote, a non-lease fact and a duplicate id are refused", () => {
  const bad = leaseFacts();
  (bad[0]!.provenance as { sources: Json[] }).sources[0]!.quote = "";
  assert.equal(runTool("estoppel_prepare", args({}, bad)).ok, false);
  const wrong = leaseFacts();
  wrong.push(
    fact("statement.total", { amount: 5 }, "Synthetic clause stating total"),
  );
  assert.equal(runTool("estoppel_prepare", args({}, wrong)).ok, false);
  const dup = leaseFacts();
  dup[1]!.id = dup[0]!.id;
  assert.equal(runTool("estoppel_prepare", args({}, dup)).ok, false);
  const same = runTool(
    "estoppel_prepare",
    args({
      parties: {
        tenant: { organisation: "X Co" },
        landlord: { organisation: "x co" },
      },
    }),
  );
  assert.equal(same.ok, false);
  const badValue = leaseFacts();
  badValue[5]!.value = -5;
  assert.equal(runTool("estoppel_prepare", args({}, badValue)).ok, false);
});

test("plan rule: a caller without a paid plan gets counts, titles, gaps and conflicts only", () => {
  const full = run();
  let limited!: Json;
  runWithExchangeCaller({ fullAudit: false }, () => {
    limited = run();
  });
  assert.equal(limited.limited, true);
  assert.equal(limited.estoppel_available, "pro");
  assert.deepEqual(limited, estoppelSummary(full));
  const text = JSON.stringify(limited);
  assert.ok(!text.includes("Fair Market Rent"));
  assert.ok(!text.includes("sha256"));
  assert.ok(!("package_items" in limited));
  assert.equal(
    ((limited.summary as Json).statements as Json[]).length,
    (full.statements as unknown[]).length,
  );
  // Paid, or a local call: the whole answer.
  runWithExchangeCaller({ fullAudit: true }, () => {
    assert.deepEqual(run(), full);
  });
});
