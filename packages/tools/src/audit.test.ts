// audit_expense_statement: every finding code with a case that triggers it and one that does not,
// three complete invented cases (clean, fee-base and cap errors, missing lease terms), and the
// refusals. Every party, building and number is invented; the expected figures are worked by hand
// in the comments.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  documentId,
  type FreeDocumentHost,
  auditSummary,
  runTool,
  runWithExchangeCaller,
} from "./index.ts";
import { checkAttested } from "./attestation.testkit.test.ts";
import { FactPackageSendInput } from "./exchange.ts";

type Json = Record<string, unknown>;
type Case = {
  lease: Record<string, unknown>;
  lines: Json[];
  st: Record<string, unknown>;
  separately?: Json[];
  prior?: Json[];
  priorPeriod?: Json;
};

const DOC = "fl:document:sha256-" + "a".repeat(64);
const SUBJECT = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4";

/** A quote that states the value, for the predicates fact_validate checks against the quote. */
function quoteFor(n: number, predicate: string, value: unknown): string {
  if (predicate === "lease.pro_rata_share")
    return `Tenant's Proportionate Share is ${((value as number) * 100).toFixed(2)}%`;
  if (predicate === "lease.cam_cap")
    return "Controllable Operating Expenses shall not increase by more than five percent (5%) per year, on a cumulative and compounding basis";
  if (predicate === "lease.operating_expense_base_year")
    return `the Base Year shall be calendar year ${value}`;
  return `Synthetic clause stating ${predicate} number ${n}`;
}

function fact(n: number, predicate: string, value: unknown, page = 1): Json {
  return {
    id: `flf_t${n}`,
    subject: SUBJECT,
    predicate,
    value,
    as_of: "2026-03-01",
    provenance: {
      method: "extracted",
      sources: [
        {
          document_id: DOC,
          page,
          quote: quoteFor(n, predicate, value),
        },
      ],
    },
  };
}

/** The invented building: Alder Court (landlord Alder Court Holdings LLC, tenant Birchwood Analytics Inc). */
function cleanCase(): Case {
  return {
    lease: {
      "lease.pro_rata_share": 0.08,
      "lease.cam_cap": { method: "compounding_from_base", rate: 0.05 },
      "lease.cam_admin_fee": {
        rate: 0.1,
        base: "actual",
        excluded_from_base: ["real estate taxes", "insurance"],
      },
      "lease.cam_exclusion": [{ category: "advertising" }],
      "lease.capex_treatment": {
        keywords: ["roof", "replacement"],
        recoverable: "excluded",
      },
      "lease.cam_gross_up": {
        target_occupancy: 0.95,
        applies_to: "variable_expenses",
      },
      "lease.audit_right": {
        window_days: 120,
        starts_from: "statement_receipt",
        notice_form:
          "written notice to Landlord's notice address by certified mail",
        cost_shift_threshold: { type: "percent_of_billed", value: 0.03 },
      },
    },
    lines: [
      {
        label: "Real estate taxes",
        amount: 400000,
        controllable: false,
        variable: false,
      },
      {
        label: "Insurance",
        amount: 100000,
        controllable: false,
        variable: false,
      },
      {
        label: "Janitorial",
        amount: 150000,
        controllable: true,
        variable: true,
      },
      {
        label: "Repairs and maintenance",
        amount: 120000,
        controllable: true,
        variable: false,
      },
      {
        label: "Landscaping",
        amount: 80000,
        controllable: true,
        variable: false,
      },
    ],
    st: {
      "statement.period": {
        year: 2025,
        statement_date: "2026-03-01",
        received_date: "2026-03-10",
      },
      "statement.share_applied": { share: 0.08 },
      "statement.total": { amount: 850000 },
      "statement.admin_fee": { rate: 0.1, base_amount: 28000, amount: 2800 },
      "statement.cap_reference": { year: 2022, amount: 24000 },
      "statement.cap_applied": { limit: 27783 },
      "statement.tenant_charge": { amount: 70583 },
      "statement.estimates_credited": { amount: 66000 },
      "statement.estimates_paid": { amount: 66000 },
      "statement.balance_claimed": { amount: 4583 },
    },
  };
}

/** The statement with a fee-base error and a cap error (the second complete case). */
function flawedCase(): Case {
  const c = cleanCase();
  c.st["statement.cap_applied"] = { limit: null };
  c.st["statement.admin_fee"] = { rate: 0.1, base_amount: 68000, amount: 6800 };
  c.st["statement.tenant_charge"] = { amount: 74800 };
  c.st["statement.balance_claimed"] = { amount: 8800 };
  return c;
}

function build(c: Case, extra: Json = {}): Json {
  let n = 0;
  const lease_facts: Json[] = [];
  for (const [p, v] of Object.entries(c.lease)) {
    if (p === "lease.cam_exclusion")
      for (const e of v as unknown[]) lease_facts.push(fact(++n, p, e));
    else lease_facts.push(fact(++n, p, v));
  }
  const statement_facts: Json[] = [];
  for (const [p, v] of Object.entries(c.st))
    statement_facts.push(fact(++n, p, v, 2));
  for (const l of c.lines)
    statement_facts.push(fact(++n, "statement.line", l, 2));
  for (const s of c.separately ?? [])
    statement_facts.push(fact(++n, "statement.separately_billed", s, 3));
  const args: Json = {
    lease_facts,
    statement_facts,
    as_of: "2026-04-01",
    ...extra,
  };
  if (c.prior)
    args.prior_statement_facts = [
      ...(c.priorPeriod
        ? [fact(++n, "statement.period", c.priorPeriod, 2)]
        : []),
      ...c.prior.map((l) => fact(++n, "statement.line", l, 2)),
    ];
  return args;
}

function run(c: Case, extra: Json = {}): Json {
  const o = runTool("audit_expense_statement", build(c, extra));
  assert.ok(o.ok, JSON.stringify(o));
  return o.result as Json;
}
const codes = (r: Json) => (r.findings as Json[]).map((f) => f.code);
const find = (r: Json, code: string) =>
  (r.findings as Json[]).find((f) => f.code === code);
const checkOf = (r: Json, name: string) =>
  (r.checks as Json[]).find((c) => c.check === name)!;

test("a clean statement has no findings, a deadline, and says what did not run", () => {
  const r = run(cleanCase());
  assert.deepEqual(codes(r), []);
  assert.equal((r.totals as Json).finding_count, 0);
  assert.equal((r.totals as Json).total_difference, 0);
  // 2026-03-10 + 120 days = 2026-07-08; 98 days after 2026-04-01.
  const d = (r.deadlines as Json[])[0]!;
  assert.equal(d.last_day, "2026-07-08");
  assert.equal(d.days_remaining, 98);
  assert.equal(d.status, "open");
  assert.match(String(d.notice_form), /certified mail/);
  const notRun = (r.checks_not_run as Json[]).map((x) => x.check);
  assert.ok(notRun.includes("base_year_or_stop"));
  assert.ok(notRun.includes("year_over_year"));
  assert.equal(checkOf(r, "management_fee").status, "ran");
  assert.equal(checkOf(r, "cap").status, "ran");
  // every line goes out as accept_theirs
  const items = r.package_items as Json[];
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => i.position === "accept_theirs"));
  assert.equal((r.cost_shifting as Json).crosses_on_firm_findings, false);
});

test("a fee-base error and a cap error: figures worked by hand", () => {
  const r = run(flawedCase());
  // Fee: the base is 8% x 850,000 = 68,000 (every line); the lease allows 8% x 350,000 = 28,000
  // (taxes and insurance are excluded from the fee base): excess 40,000 x 10% = 4,000.
  const fee = find(r, "FEE_ON_EXCLUDED_LINES")!;
  assert.equal(fee.difference, 4000);
  // The two figures are comparable totals: the fee on the landlord's base (10% x 68,000) and on
  // the lease's base (10% x 28,000); the difference is theirs.
  assert.equal(fee.landlord_figure, 6800);
  assert.equal(fee.lease_figure, 2800);
  assert.equal(fee.landlord_label, "Fee on the landlord's base");
  assert.equal(fee.lease_label, "Fee on the lease's base");
  assert.equal(fee.class, "depends_on_reading");
  // Cap: 24,000 x 1.05^3 = 27,783.00; billed 8% x 350,000 = 28,000; difference 217.00.
  const cap = find(r, "CAP_EXCEEDED")!;
  assert.equal(cap.landlord_figure, 28000);
  assert.equal(cap.lease_figure, 27783);
  assert.equal(cap.difference, 217);
  assert.equal(cap.class, "follows_from_terms");
  assert.deepEqual(codes(r).sort(), ["CAP_EXCEEDED", "FEE_ON_EXCLUDED_LINES"]);
  const t = r.totals as Json;
  assert.equal(t.firm_difference, 217);
  assert.equal(t.total_difference, 4217);
  // 3% of 74,800 = 2,244: crossed once the fee-base reading holds, not on the firm finding alone.
  const cs = r.cost_shifting as Json;
  assert.equal(cs.threshold_amount, 2244);
  assert.equal(cs.crosses_on_firm_findings, false);
  assert.equal(cs.crosses_if_readings_hold, true);
  // every finding cites a lease fact with its quote and page
  for (const f of r.findings as Json[]) {
    assert.ok((f.lease_fact_ids as string[]).length > 0);
    const lease = (f.sources as Json[]).filter((s) => s.side === "lease");
    assert.ok(lease.length > 0 && lease.every((s) => s.quote && s.page));
  }
  // items: findings as state_ours with the landlord's figure, untouched lines as accept_theirs
  const items = r.package_items as Json[];
  const ours = items.filter((i) => i.position === "state_ours");
  assert.equal(ours.length, 2);
  assert.equal(
    ours.find((i) => i.key === "CAP_EXCEEDED.1")!.their_value,
    28000,
  );
  // the cap finding flags the controllable lines; the fee finding flags the taxes and insurance lines
  // the fee finding flags the taxes and insurance lines; the cap finding the three controllable lines: none is accepted
  assert.equal(items.filter((i) => i.position === "accept_theirs").length, 0);
  // deterministic
  assert.deepEqual(run(flawedCase()), r);
});

test("a statement whose lease terms are missing lists the checks it could not run", () => {
  const c = flawedCase();
  delete c.lease["lease.cam_cap"];
  delete c.lease["lease.cam_admin_fee"];
  delete c.lease["lease.audit_right"];
  const r = run(c);
  assert.deepEqual(codes(r), []);
  const reason = (n: string) => String(checkOf(r, n).reason);
  assert.equal(checkOf(r, "cap").status, "not_run");
  assert.match(reason("cap"), /lease\.cam_cap/);
  assert.equal(checkOf(r, "management_fee").status, "not_run");
  assert.match(reason("management_fee"), /lease\.cam_admin_fee/);
  assert.equal(checkOf(r, "deadlines").status, "not_run");
  assert.match(reason("deadlines"), /lease\.audit_right/);
  assert.equal(checkOf(r, "cost_shifting").status, "not_run");
  assert.deepEqual(r.deadlines, []);
});

test("no lease pro-rata share: nothing is produced and every check says why", () => {
  const c = flawedCase();
  delete c.lease["lease.pro_rata_share"];
  const r = run(c);
  assert.deepEqual(codes(r), []);
  assert.match(String(checkOf(r, "cap").reason), /lease\.pro_rata_share/);
});

test("refusals: invalid facts, no source, duplicates, wrong side, bad values", () => {
  const ok = build(cleanCase());
  const bad = (patch: (a: Json) => void) => {
    const a = JSON.parse(JSON.stringify(ok)) as Json;
    patch(a);
    const o = runTool("audit_expense_statement", a);
    assert.equal(o.ok, false);
    return o;
  };
  const leaseFacts = (a: Json) => a.lease_facts as Json[];
  const stFacts = (a: Json) => a.statement_facts as Json[];
  bad((a) => delete (leaseFacts(a)[0]!.provenance as Json).sources);
  bad(
    (a) => ((leaseFacts(a)[0]!.provenance as { sources: Json[] }).sources = []),
  );
  bad(
    (a) =>
      ((leaseFacts(a)[0]!.provenance as { sources: Json[] }).sources[0]!.quote =
        ""),
  );
  bad((a) => (leaseFacts(a)[0]!.value = 7));
  bad((a) => stFacts(a).push(leaseFacts(a)[0]!));
  bad((a) => leaseFacts(a).push({ ...leaseFacts(a)[0]!, id: "flf_dupe" }));
  bad((a) => (stFacts(a)[0]!.predicate = "lease.pro_rata_share"));
  bad((a) => (a.as_of = "April 1"));
  const o = bad((a) => leaseFacts(a).push({ nonsense: true }));
  assert.equal((o as { error: { error: string } }).error.error, "InputError");
});

// ---- 1. management or admin fee -------------------------------------------------------------

test("FEE_RATE_ABOVE_CAP: 12% billed, 10% allowed", () => {
  const c = cleanCase();
  c.st["statement.admin_fee"] = {
    rate: 0.12,
    base_amount: 28000,
    amount: 3360,
  };
  const f = find(run(c), "FEE_RATE_ABOVE_CAP")!;
  assert.equal(f.landlord_figure, 3360);
  assert.equal(f.lease_figure, 2800);
  assert.equal(f.difference, 560);
  assert.equal(find(run(cleanCase()), "FEE_RATE_ABOVE_CAP"), undefined);
});

test("FEE_ON_GROSSED_UP_BASE: lease says actual, fee base is grossed up", () => {
  const c = cleanCase();
  // janitorial grossed 150,000 -> 158,333.33; base 8% x (all clean lines grossed) = 8% x 358,333.33 = 28,666.67
  (c.lines[2] as Json).grossed_up_amount = 158333.33;
  c.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 28666.67,
    amount: 2866.67,
  };
  const f = find(run(c), "FEE_ON_GROSSED_UP_BASE")!;
  // excess 28,666.67 - 28,000 = 666.67 x 10% = 66.667 -> 66.67
  assert.equal(f.difference, 66.67);
  assert.equal(find(run(cleanCase()), "FEE_ON_GROSSED_UP_BASE"), undefined);
});

test("FEE_BASE_UNRECONCILED: a base that matches no set of lines", () => {
  const c = cleanCase();
  c.st["statement.admin_fee"] = { rate: 0.1, base_amount: 31000, amount: 3100 };
  const f = find(run(c), "FEE_BASE_UNRECONCILED")!;
  assert.equal(f.difference, 300);
  assert.equal(f.class, "depends_on_reading");
});

// ---- 2. cap ---------------------------------------------------------------------------------

test("CAP_METHOD_AMBIGUOUS: figure under each method, least difference reported", () => {
  const c = flawedCase();
  delete c.lease["lease.cam_cap"];
  c.lease["lease.cam_cap_rate"] = { rate: 0.05 };
  const f = find(run(c), "CAP_METHOD_AMBIGUOUS")!;
  // limits: compounding 27,783.00; simple 24,000 x 1.15 = 27,600; year over year 24,000 x 1.05 = 25,200.
  // billed 28,000. Most landlord-friendly cap 27,783 -> difference at least 217.
  assert.equal(f.difference, 217);
  assert.equal(f.class, "depends_on_reading");
  const steps = (f.steps as string[]).join("\n");
  assert.match(steps, /compounding_from_base[^\n]*\$27,783\.00/);
  assert.match(steps, /simple_from_base[^\n]*\$27,600\.00/);
  assert.match(steps, /year_over_year[^\n]*\$25,200\.00/);
  assert.equal(find(run(cleanCase()), "CAP_METHOD_AMBIGUOUS"), undefined);
});

test("cap: a line without a controllable flag stops the check and names it", () => {
  const c = flawedCase();
  delete (c.lines[3] as Json).controllable;
  const r = run(c);
  assert.equal(find(r, "CAP_EXCEEDED"), undefined);
  assert.match(String(checkOf(r, "cap").reason), /Repairs and maintenance/);
});

// ---- 3. capital items -----------------------------------------------------------------------

test("CAPEX_BILLED_AS_OPERATING: the lease excludes capital items", () => {
  const c = cleanCase();
  c.lines.push({
    label: "Roof replacement, north wing",
    amount: 50000,
    controllable: false,
    variable: false,
  });
  c.st["statement.total"] = { amount: 900000 };
  const f = find(run(c), "CAPEX_BILLED_AS_OPERATING")!;
  assert.equal(f.difference, 4000); // 8% x 50,000
  assert.equal(find(run(cleanCase()), "CAPEX_BILLED_AS_OPERATING"), undefined);
});

test("CAPEX_BILLED_AS_OPERATING and CAPEX_AMORTIZATION: the lease amortizes over 10 years at 6%", () => {
  const c = cleanCase();
  c.lease["lease.capex_treatment"] = {
    keywords: ["roof"],
    recoverable: "amortized",
    amortization_years: 10,
    interest_rate: 0.06,
  };
  c.lines.push({
    label: "Roof work",
    amount: 50000,
    controllable: false,
    variable: false,
  });
  c.st["statement.total"] = { amount: 900000 };
  const lump = find(run(c), "CAPEX_BILLED_AS_OPERATING")!;
  // level payment factor 0.06 / (1 - 1.06^-10) = 0.135868; 50,000 x 0.135868 = 6,793.40; 8% x (50,000 - 6,793.40) = 3,456.53
  assert.equal(lump.lease_figure, 543.47);
  assert.equal(lump.difference, 3456.53);
  const d = cleanCase();
  d.lease["lease.capex_treatment"] = c.lease["lease.capex_treatment"];
  d.lines.push({
    label: "Roof work",
    amount: 9000,
    controllable: false,
    variable: false,
    amortization: { cost: 50000, years: 5, rate: 0.06 },
  });
  d.st["statement.total"] = { amount: 859000 };
  const am = find(run(d), "CAPEX_AMORTIZATION")!;
  // lease annual 6,793.40; billed 9,000; 8% x 2,206.60 = 176.53
  assert.equal(am.difference, 176.53);
});

test("capital items: a straight-line schedule with interest is not approximated", () => {
  const c = cleanCase();
  c.lease["lease.capex_treatment"] = {
    keywords: ["roof"],
    recoverable: "amortized",
    amortization_years: 10,
    interest_rate: 0.06,
    method: "straight_line",
  };
  const r = run(c);
  assert.equal(checkOf(r, "capital_items").status, "not_run");
});

// ---- 4. gross-up ----------------------------------------------------------------------------

test("GROSSUP_ON_FIXED_EXPENSE", () => {
  const c = cleanCase();
  (c.lines[3] as Json).grossed_up_amount = 126000; // repairs are fixed (variable false)
  const f = find(run(c), "GROSSUP_ON_FIXED_EXPENSE")!;
  assert.equal(f.difference, 480); // 8% x 6,000
  assert.equal(find(run(cleanCase()), "GROSSUP_ON_FIXED_EXPENSE"), undefined);
});

test("GROSSUP_WRONG_OCCUPANCY: grossed to 100%, lease says 95%, actual 80%", () => {
  const c = cleanCase();
  c.st["statement.gross_up"] = { actual_occupancy: 0.8, target_occupancy: 1 };
  const f = find(run(c), "GROSSUP_WRONG_OCCUPANCY")!;
  // janitorial 150,000: landlord 150,000 x 1/0.8 = 187,500; lease 150,000 x 0.95/0.8 = 178,125; excess 9,375 x 8% = 750
  assert.equal(f.difference, 750);
  const ok = cleanCase();
  ok.st["statement.gross_up"] = {
    actual_occupancy: 0.8,
    target_occupancy: 0.95,
  };
  assert.equal(find(run(ok), "GROSSUP_WRONG_OCCUPANCY"), undefined);
});

test("GROSSUP_BASE_YEAR_INCONSISTENT: a question with no figure", () => {
  const c = cleanCase();
  c.lease["lease.cam_gross_up"] = {
    target_occupancy: 0.95,
    applies_to: "variable_expenses",
    base_year_grossed_up: true,
  };
  c.st["statement.gross_up"] = {
    actual_occupancy: 0.95,
    target_occupancy: 0.95,
  };
  c.st["statement.base_year_applied"] = {
    base_year: 2022,
    deduction: 0,
    grossed_up: false,
  };
  const f = find(run(c), "GROSSUP_BASE_YEAR_INCONSISTENT")!;
  assert.equal(f.class, "question_to_ask");
  assert.equal(f.difference, null);
});

// ---- 5. share -------------------------------------------------------------------------------

test("SHARE_DIFFERS: 8.5% applied, lease 8%; denominator named", () => {
  const c = cleanCase();
  c.lease["lease.pro_rata_basis"] = { tenant_sf: 8000, building_sf: 100000 };
  c.st["statement.share_applied"] = { share: 0.085, building_sf: 94000 };
  const f = find(run(c), "SHARE_DIFFERS")!;
  assert.equal(f.difference, 4250); // 0.5% x 850,000
  assert.match((f.steps as string[]).join(" "), /94000 SF/);
  assert.equal(find(run(cleanCase()), "SHARE_DIFFERS"), undefined);
});

// ---- 6. excluded categories -----------------------------------------------------------------

test("EXCLUDED_CATEGORY_BILLED", () => {
  const c = cleanCase();
  c.lines.push({
    label: "Advertising and promotion",
    amount: 25000,
    controllable: true,
    variable: false,
  });
  c.st["statement.total"] = { amount: 875000 };
  const f = find(run(c), "EXCLUDED_CATEGORY_BILLED")!;
  assert.equal(f.difference, 2000);
  assert.equal(find(run(cleanCase()), "EXCLUDED_CATEGORY_BILLED"), undefined);
});

// ---- 7. duplicates --------------------------------------------------------------------------

test("DUPLICATE_LINE and DUPLICATE_OF_SEPARATE_BILL", () => {
  const c = cleanCase();
  c.lines.push({
    label: "janitorial",
    amount: 150000,
    controllable: true,
    variable: true,
  });
  c.st["statement.total"] = { amount: 1000000 };
  assert.equal(find(run(c), "DUPLICATE_LINE")!.difference, 12000);
  const d = cleanCase();
  d.separately = [{ label: "Landscaping", amount: 6400 }];
  const f = find(run(d), "DUPLICATE_OF_SEPARATE_BILL")!;
  assert.equal(f.difference, 6400); // min(8% x 80,000 = 6,400, 6,400)
  assert.equal(find(run(cleanCase()), "DUPLICATE_LINE"), undefined);
  assert.equal(find(run(cleanCase()), "DUPLICATE_OF_SEPARATE_BILL"), undefined);
});

// ---- 8. base year or stop -------------------------------------------------------------------

test("BASE_YEAR_DIFFERS with and without the base-year total; BASE_YEAR_DEDUCTION; STOP_DIFFERS", () => {
  const c = cleanCase();
  c.lease["lease.operating_expense_base_year"] = 2023;
  c.st["statement.base_year_applied"] = { base_year: 2024, deduction: 50000 };
  assert.equal(find(run(c), "BASE_YEAR_DIFFERS")!.difference, null);
  c.st["statement.base_year_total"] = { year: 2023, amount: 700000 };
  const f = find(run(c), "BASE_YEAR_DIFFERS")!;
  assert.equal(f.difference, 6000); // 8% x 700,000 = 56,000 - 50,000
  const d = cleanCase();
  d.lease["lease.operating_expense_base_year"] = 2023;
  d.st["statement.base_year_applied"] = { base_year: 2023, deduction: 50000 };
  d.st["statement.base_year_total"] = { year: 2023, amount: 700000 };
  assert.equal(find(run(d), "BASE_YEAR_DEDUCTION")!.difference, 6000);
  d.st["statement.base_year_applied"] = { base_year: 2023, deduction: 56000 };
  assert.equal(find(run(d), "BASE_YEAR_DEDUCTION"), undefined);
  const e = cleanCase();
  e.lease["lease.expense_stop"] = { amount: 700000 };
  e.st["statement.base_year_applied"] = {
    stop_amount: 600000,
    deduction: 48000,
  };
  assert.equal(find(run(e), "STOP_DIFFERS")!.difference, 8000);
  e.st["statement.base_year_applied"] = {
    stop_amount: 700000,
    deduction: 56000,
  };
  assert.equal(find(run(e), "STOP_DIFFERS"), undefined);
});

// ---- 9. arithmetic --------------------------------------------------------------------------

test("ARITH_*: lines vs total, estimates, balance, fee", () => {
  const c = cleanCase();
  c.st["statement.total"] = { amount: 860000 };
  assert.equal(find(run(c), "ARITH_LINES_VS_TOTAL")!.difference, 800); // 8% x 10,000
  const d = cleanCase();
  d.st["statement.estimates_credited"] = { amount: 64000 };
  assert.equal(find(run(d), "ARITH_ESTIMATES")!.difference, 2000);
  const e = cleanCase();
  e.st["statement.balance_claimed"] = { amount: 5000 };
  assert.equal(find(run(e), "ARITH_BALANCE")!.difference, 417);
  const f = cleanCase();
  f.st["statement.admin_fee"] = { rate: 0.1, base_amount: 28000, amount: 3000 };
  assert.equal(find(run(f), "ARITH_FEE")!.difference, 200);
  const r = run(cleanCase());
  for (const k of [
    "ARITH_LINES_VS_TOTAL",
    "ARITH_ESTIMATES",
    "ARITH_BALANCE",
    "ARITH_FEE",
  ])
    assert.equal(find(r, k), undefined);
});

// ---- 10. year over year ---------------------------------------------------------------------

test("YOY_RISE: a question, never an overcharge, and the threshold is an input", () => {
  const c = cleanCase();
  c.priorPeriod = {
    year: 2024,
    statement_date: "2025-03-01",
    received_date: "2025-03-10",
  };
  c.prior = [
    { label: "Janitorial", amount: 140000 },
    { label: "Landscaping", amount: 60000 },
    { label: "Insurance", amount: 99000 },
  ];
  const r = run(c);
  // landscaping 60,000 -> 80,000 = +33.33%; janitorial +7.14% and insurance +1.01% are under 10%
  const ys = (r.findings as Json[]).filter((f) => f.code === "YOY_RISE");
  assert.equal(ys.length, 1);
  assert.equal(ys[0]!.difference, null);
  assert.equal(ys[0]!.class, "question_to_ask");
  assert.ok(
    !/overcharge/i.test(String(ys[0]!.title).replace("not an overcharge", "")),
  );
  assert.deepEqual(r.questions_not_sent, ["YOY_RISE.1"]);
  assert.equal((r.totals as Json).total_difference, 0);
  const strict = (run(c, { yoy_threshold: 0.05 }).findings as Json[]).filter(
    (f) => f.code === "YOY_RISE",
  );
  assert.equal(strict.length, 2);
  assert.equal(find(run(cleanCase()), "YOY_RISE"), undefined);
});

// ---- 11 and 12. deadlines and cost shifting -------------------------------------------------

test("the deadline passes, counts from the statement date when the lease says so", () => {
  const c = cleanCase();
  const r = run(c, { as_of: "2026-08-01" });
  const d = (r.deadlines as Json[])[0]!;
  assert.equal(d.status, "passed");
  assert.equal(d.days_remaining, -24);
  c.lease["lease.audit_right"] = {
    window_days: 60,
    starts_from: "statement_date",
    notice_form: "written notice",
  };
  const r2 = run(c);
  assert.equal((r2.deadlines as Json[])[0]!.last_day, "2026-04-30");
  assert.equal(checkOf(r2, "cost_shifting").status, "not_run");
});

test("cost shifting by an amount, crossed on firm findings", () => {
  const c = flawedCase();
  c.lease["lease.audit_right"] = {
    window_days: 120,
    starts_from: "statement_receipt",
    notice_form: "written notice",
    cost_shift_threshold: { type: "amount", value: 200 },
  };
  const cs = run(c).cost_shifting as Json;
  assert.equal(cs.threshold_amount, 200);
  assert.equal(cs.crosses_on_firm_findings, true);
});

// ---- the summary ----------------------------------------------------------------------------

test("hosted summary: count, total, deadlines and checks not run; nothing else", () => {
  const args = build(flawedCase());
  const o = runWithExchangeCaller({ fullAudit: false }, () =>
    runTool("audit_expense_statement", args),
  );
  assert.ok(o.ok);
  const r = o.result as Json;
  assert.equal(r.limited, true);
  assert.equal(r.audit_available, "pro");
  const s = r.summary as Json;
  assert.equal(s.finding_count, 2);
  assert.equal(s.total_difference, 4217);
  assert.equal(r.findings, undefined);
  assert.equal(r.package_items, undefined);
  assert.match(String(r.audit_note), /Pro and Team/);
  const text = JSON.stringify(r);
  assert.ok(!text.includes("Proportionate Share"), "no quote leaks");
  assert.ok(!text.includes("CAP_EXCEEDED"), "no finding code leaks");
  // locally, and for a caller the host says is paid, the whole answer
  const local = runTool("audit_expense_statement", args);
  assert.ok(local.ok && (local.result as Json).limited === undefined);
  const paid = runWithExchangeCaller({ fullAudit: true }, () =>
    runTool("audit_expense_statement", args),
  );
  assert.ok(paid.ok && (paid.result as Json).findings !== undefined);
  assert.deepEqual(auditSummary(local.result as Json), r);
});

test("package_items go to fact_package_send as they are: its schema accepts every item", () => {
  const r = run(flawedCase());
  const items = r.package_items as Json[];
  assert.ok(items.length >= 2);
  const parsed = FactPackageSendInput.shape.items.safeParse(items);
  assert.ok(
    parsed.success,
    JSON.stringify(parsed.success ? "" : parsed.error.issues),
  );
});

test("a finding's two figures are comparable: the difference is their difference", () => {
  // every code but the ones whose figures are credits (deductions, estimates, a balance)
  const credit = /^(STOP|BASE_YEAR|ARITH_ESTIMATES|ARITH_BALANCE)/;
  for (const c of [flawedCase()]) {
    const r = run(c);
    for (const f of r.findings as Json[]) {
      if (credit.test(String(f.code)) || f.difference === null) continue;
      assert.equal(
        Math.round(
          ((f.landlord_figure as number) - (f.lease_figure as number)) * 100,
        ),
        Math.round((f.difference as number) * 100),
        String(f.code),
      );
    }
  }
});

// ---- the first full document free (hosted, free_document.ts) --------------------------------

test("free document: a limited caller the host entitles gets the whole answer once, flagged; later the summary", () => {
  const used: string[] = [];
  const host: FreeDocumentHost = {
    use(tool, id) {
      used.push(`${tool}:${id}`);
      return used.length === 1
        ? { granted: true, covers_until: "2026-11-21T00:00:00.000Z" }
        : {
            granted: false,
            used_at: "2026-11-20T00:00:00.000Z",
            used_tool: tool,
          };
    },
  };
  const runAudit = (a: Json) => {
    const o = runTool("audit_expense_statement", a);
    assert.ok(o.ok);
    return o.result as Json;
  };
  const a = build(flawedCase());
  const whole = runWithExchangeCaller(
    { fullAudit: false, freeDocument: host },
    () => runAudit(a),
  );
  const local = runAudit(a);
  // the whole answer, plus a plain statement that it was the one free document
  const { free_document: note, ...rest } = whole;
  assert.deepEqual(rest, local);
  const nt = note as Json;
  assert.equal(nt.free_document, true);
  assert.match(String(nt.note), /one free full document/);
  assert.match(String(nt.note), /Pro or Team/);
  assert.match(String(nt.note), /pricing/);
  // the id the host saw is the hash of the whole answer, the same one report_create computes
  assert.equal(used[0], `audit_expense_statement:${documentId(local)}`);
  const summary = runWithExchangeCaller(
    { fullAudit: false, freeDocument: host },
    () => runAudit(a),
  );
  assert.equal(summary.limited, true);
  assert.equal((summary.free_document as Json).free_document, false);
  assert.match(String((summary.free_document as Json).note), /already used/);
  // the host is not asked when the caller is paid or local
  const n = used.length;
  runWithExchangeCaller({ fullAudit: true, freeDocument: host }, () =>
    runAudit(a),
  );
  runAudit(a);
  assert.equal(used.length, n);
});

test("the hosted service attests the audit result; every tamper is refused", async () => {
  const r = await checkAttested("audit_expense_statement", build(flawedCase()));
  // The audit returns no calculation, so the attestation covers the items and the facts only.
  assert.equal((r.attestation as Json).calculation_digest, null);
  assert.ok((r.package_items as Json[]).length > 0);
});

// ---- a statement entered as the landlord prints it ---------------------------------------------
// A printed statement lists building-level lines, then a management fee computed on the building's
// subtotal, then a total that includes the fee. The invented Alder Court statement, as printed:
//   lines 400,000 + 100,000 + 150,000 + 120,000 + 80,000 = 850,000 (building level)
//   fee 10% x (850,000 less taxes 400,000 and insurance 100,000) = 10% x 350,000 = 35,000
//   total 850,000 + 35,000 = 885,000
//   tenant (8%): 8% x 885,000 = 70,800 = 68,000 of lines + 2,800 of fee.
// The lease allows exactly that (10% on actual expenses, taxes and insurance out of the fee base),
// so nothing is wrong and the audit must report no finding and 0.00 of differences. No cap is
// given, so the charge is the whole 70,800. Every figure below is worked by hand.

function printedClean(): Case {
  const c = cleanCase();
  delete c.lease["lease.cam_cap"];
  delete c.st["statement.cap_reference"];
  delete c.st["statement.cap_applied"];
  c.st["statement.total"] = { amount: 885000 };
  c.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 350000,
    amount: 35000,
  };
  c.st["statement.tenant_charge"] = { amount: 70800 };
  c.st["statement.estimates_credited"] = { amount: 66000 };
  c.st["statement.estimates_paid"] = { amount: 66000 };
  c.st["statement.balance_claimed"] = { amount: 4800 };
  return c;
}
const totalsOf = (r: Json) => r.totals as Json;
const warningsOf = (r: Json) => (r.warnings ?? []) as string[];

test("printed statement: a clean $70,800 statement reports no finding and $0.00 of differences", () => {
  const r = run(printedClean());
  assert.deepEqual(codes(r), []);
  assert.equal(totalsOf(r).finding_count, 0);
  assert.equal(totalsOf(r).firm_difference, 0);
  assert.equal(totalsOf(r).difference_with_readings, 0);
  assert.equal(totalsOf(r).total_difference, 0);
  assert.equal(totalsOf(r).exceeds_tenant_charge, false);
  // every line goes out as accept_theirs: nothing is disputed
  const items = r.package_items as Json[];
  assert.ok(items.every((i) => i.position === "accept_theirs"));
  assert.equal(checkOf(r, "management_fee").status, "ran");
  assert.equal(checkOf(r, "arithmetic").status, "ran");
  // The level the fee was read at is said, never silent.
  const lv = r.levels as Json;
  assert.equal(lv["statement.admin_fee"], "building");
  assert.equal(lv["statement.admin_fee.basis"], "inferred");
  assert.equal(lv["statement.total.includes_fee"], true);
  assert.ok(warningsOf(r).some((w) => w.startsWith("FEE_LEVEL_INFERRED")));
  // The free summary says the same: no finding, 0.00.
  const s = auditSummary(r).summary as Json;
  assert.equal(s.finding_count, 0);
  assert.equal(s.total_difference, 0);
  assert.deepEqual(run(printedClean()), r);
});

test("printed statement: the levels stated on the facts give the same answer and no warning", () => {
  const c = printedClean();
  c.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 350000,
    amount: 35000,
    level: "building",
  };
  c.st["statement.total"] = { amount: 885000, includes_fee: true };
  const r = run(c);
  assert.deepEqual(codes(r), []);
  assert.equal(totalsOf(r).total_difference, 0);
  assert.equal((r.levels as Json)["statement.admin_fee.basis"], "stated");
  assert.equal(
    (r.levels as Json)["statement.total.includes_fee.basis"],
    "stated",
  );
  assert.deepEqual(warningsOf(r), []);
});

test("printed statement: one real overcharge reports exactly its amount", () => {
  // Fee charged on every line: base 850,000, fee 85,000, total 935,000, tenant 8% x 935,000 = 74,800.
  // Lease base 350,000. Building-level excess 10% x 500,000 = 50,000; to the tenant 8% x 50,000 = 4,000.
  const c = printedClean();
  c.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 850000,
    amount: 85000,
  };
  c.st["statement.total"] = { amount: 935000 };
  c.st["statement.tenant_charge"] = { amount: 74800 };
  c.st["statement.balance_claimed"] = { amount: 8800 };
  const r = run(c);
  assert.deepEqual(codes(r), ["FEE_ON_EXCLUDED_LINES"]);
  const fee = find(r, "FEE_ON_EXCLUDED_LINES")!;
  assert.equal(fee.landlord_figure, 6800);
  assert.equal(fee.lease_figure, 2800);
  assert.equal(fee.difference, 4000);
  assert.equal(totalsOf(r).total_difference, 4000);
  assert.equal(totalsOf(r).exceeds_tenant_charge, false);
  // A total misadded by 10,000 (895,000 printed, 885,000 due): 8% x 10,000 = 800, and nothing else.
  const g = printedClean();
  g.st["statement.total"] = { amount: 895000 };
  const rg = run(g);
  assert.deepEqual(codes(rg), ["ARITH_LINES_VS_TOTAL"]);
  assert.equal(find(rg, "ARITH_LINES_VS_TOTAL")!.difference, 800);
  assert.equal(totalsOf(rg).total_difference, 800);
  // 12% billed on the building base, stated level: 2% x 350,000 = 7,000; to the tenant 560.
  const h = printedClean();
  h.st["statement.admin_fee"] = {
    rate: 0.12,
    base_amount: 350000,
    amount: 42000,
    level: "building",
  };
  h.st["statement.total"] = { amount: 892000, includes_fee: true };
  const rh = run(h);
  assert.deepEqual(codes(rh), ["FEE_RATE_ABOVE_CAP"]);
  assert.equal(find(rh, "FEE_RATE_ABOVE_CAP")!.difference, 560);
  // A fee misadded at building level (36,000 billed, 10% x 350,000 = 35,000): 8% x 1,000 = 80.
  const k = printedClean();
  k.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 350000,
    amount: 36000,
    level: "building",
  };
  k.st["statement.total"] = { amount: 886000, includes_fee: true };
  const rk = run(k);
  assert.deepEqual(codes(rk), ["ARITH_FEE"]);
  assert.equal(find(rk, "ARITH_FEE")!.difference, 80);
  // Stated as the lines only, a printed 885,000 is a 35,000 gap: the caller said so, 8% = 2,800.
  const m = printedClean();
  m.st["statement.total"] = { amount: 885000, includes_fee: false };
  assert.equal(find(run(m), "ARITH_LINES_VS_TOTAL")!.difference, 2800);
});

test("printed statement with gross-up: clean, a fee on the grossed-up base, and a wrong occupancy", () => {
  // Actual occupancy 80%, the lease and the statement gross variable lines up to 95%. Janitorial is
  // the one variable line: 150,000 x 0.95 / 0.80 = 178,125. Lease fee base: actual, 350,000.
  const clean = printedClean();
  clean.st["statement.gross_up"] = {
    actual_occupancy: 0.8,
    target_occupancy: 0.95,
  };
  clean.lines[2] = { ...clean.lines[2]!, grossed_up_amount: 178125 };
  const r = run(clean);
  assert.deepEqual(codes(r), []);
  assert.equal(totalsOf(r).total_difference, 0);
  // Fee on the grossed-up base: 350,000 + 28,125 = 378,125; fee 37,812.50; total 887,812.50.
  // Excess at building level 10% x 28,125 = 2,812.50; to the tenant 8% = 225.00.
  const g = printedClean();
  g.st["statement.gross_up"] = {
    actual_occupancy: 0.8,
    target_occupancy: 0.95,
  };
  g.lines[2] = { ...g.lines[2]!, grossed_up_amount: 178125 };
  g.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 378125,
    amount: 37812.5,
  };
  g.st["statement.total"] = { amount: 887812.5 };
  const rg = run(g);
  assert.deepEqual(codes(rg), ["FEE_ON_GROSSED_UP_BASE"]);
  const f = find(rg, "FEE_ON_GROSSED_UP_BASE")!;
  assert.equal(f.landlord_figure, 3025);
  assert.equal(f.lease_figure, 2800);
  assert.equal(f.difference, 225);
  assert.equal(totalsOf(rg).total_difference, 225);
  // Grossed up to 100% instead of 95%: 150,000 / 0.80 = 187,500 against 178,125, excess 9,375;
  // to the tenant 8% x 9,375 = 750.00. The building-level fee is right, so that is all.
  const w = printedClean();
  w.st["statement.gross_up"] = { actual_occupancy: 0.8, target_occupancy: 1 };
  const rw = run(w);
  assert.deepEqual(codes(rw), ["GROSSUP_WRONG_OCCUPANCY"]);
  assert.equal(find(rw, "GROSSUP_WRONG_OCCUPANCY")!.difference, 750);
  assert.equal(totalsOf(rw).total_difference, 750);
});

test("printed statement with a cap and with a base year", () => {
  // Cap: 24,000 in 2022, 5% compounding: 24,000 x 1.05^3 = 27,783.00. Controllable lines billed
  // 8% x 350,000 = 28,000. Applied: no finding (the charge is 70,800 - 217 = 70,583).
  const cap = printedClean();
  cap.lease["lease.cam_cap"] = { method: "compounding_from_base", rate: 0.05 };
  cap.st["statement.cap_reference"] = { year: 2022, amount: 24000 };
  cap.st["statement.cap_applied"] = { limit: 27783 };
  cap.st["statement.tenant_charge"] = { amount: 70583 };
  cap.st["statement.balance_claimed"] = { amount: 4583 };
  const rc = run(cap);
  assert.deepEqual(codes(rc), []);
  assert.equal(totalsOf(rc).total_difference, 0);
  // Not applied: 28,000 - 27,783 = 217.00, and nothing else.
  const nc = printedClean();
  nc.lease["lease.cam_cap"] = { method: "compounding_from_base", rate: 0.05 };
  nc.st["statement.cap_reference"] = { year: 2022, amount: 24000 };
  nc.st["statement.cap_applied"] = { limit: null };
  const rn = run(nc);
  assert.deepEqual(codes(rn), ["CAP_EXCEEDED"]);
  assert.equal(find(rn, "CAP_EXCEEDED")!.difference, 217);
  assert.equal(totalsOf(rn).total_difference, 217);
  // Base year 2022, building total 800,000: deduction 8% x 800,000 = 64,000. Charge 70,800 - 64,000
  // = 6,800. Deducted right: no finding. Deducted 60,000: 4,000 short, and nothing else.
  const by = printedClean();
  by.lease["lease.operating_expense_base_year"] = 2022;
  by.st["statement.base_year_total"] = { year: 2022, amount: 800000 };
  by.st["statement.base_year_applied"] = { base_year: 2022, deduction: 64000 };
  by.st["statement.tenant_charge"] = { amount: 6800 };
  by.st["statement.estimates_credited"] = { amount: 6000 };
  by.st["statement.estimates_paid"] = { amount: 6000 };
  by.st["statement.balance_claimed"] = { amount: 800 };
  const rb = run(by);
  assert.deepEqual(codes(rb), []);
  assert.equal(totalsOf(rb).total_difference, 0);
  by.st["statement.base_year_applied"] = { base_year: 2022, deduction: 60000 };
  by.st["statement.tenant_charge"] = { amount: 10800 };
  by.st["statement.balance_claimed"] = { amount: 4800 };
  const rb2 = run(by);
  assert.deepEqual(codes(rb2), ["BASE_YEAR_DEDUCTION"]);
  assert.equal(find(rb2, "BASE_YEAR_DEDUCTION")!.difference, 4000);
  assert.equal(totalsOf(rb2).total_difference, 4000);
});

test("printed statement: the tenant-level convention still reads as before", () => {
  const r = run(flawedCase());
  assert.equal((r.levels as Json)["statement.admin_fee"], "tenant");
  assert.equal(find(r, "FEE_ON_EXCLUDED_LINES")!.difference, 4000);
  assert.equal(totalsOf(r).total_difference, 4217);
  assert.deepEqual(warningsOf(r), []);
});

test("guard: differences above the tenant's whole charge are warned, in the answer and the summary", () => {
  // A building-level base stated as tenant-level: the audit does as told and says it cannot be
  // right. 10% x (850,000 - 28,000) = 82,200 against a charge of 70,583.
  const c = cleanCase();
  c.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 850000,
    amount: 85000,
    level: "tenant",
  };
  const r = run(c);
  assert.equal(totalsOf(r).total_difference, 82200);
  assert.equal(totalsOf(r).exceeds_tenant_charge, true);
  assert.ok(
    warningsOf(r).some((w) => w.startsWith("TOTAL_EXCEEDS_TENANT_CHARGE")),
  );
  const s = auditSummary(r).summary as Json;
  assert.ok(
    (s.warnings as string[]).some((w) =>
      w.startsWith("TOTAL_EXCEEDS_TENANT_CHARGE"),
    ),
  );
});

test("portfolio: a clean printed statement adds 0.00; one real overcharge adds exactly its amount", () => {
  const loc = (label: string, c: Case) => {
    const { as_of: _a, ...rest } = build(c);
    void _a;
    return { label, landlord: "Alder Court Holdings LLC", ...rest };
  };
  const over = printedClean();
  over.st["statement.admin_fee"] = {
    rate: 0.1,
    base_amount: 850000,
    amount: 85000,
  };
  over.st["statement.total"] = { amount: 935000 };
  over.st["statement.tenant_charge"] = { amount: 74800 };
  over.st["statement.balance_claimed"] = { amount: 8800 };
  const o = runTool("audit_expense_portfolio", {
    as_of: "2026-04-01",
    audits: [
      loc("Alder Court, Suite 200", printedClean()),
      loc("Alder Court, Suite 300", over),
    ],
  });
  assert.ok(o.ok, JSON.stringify(o));
  const p = o.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [a, b] = p.locations;
  assert.equal(a.summary.finding_count, 0);
  assert.equal(a.summary.dollars_at_stake.total_difference, 0);
  assert.equal(b.summary.finding_count, 1);
  assert.equal(b.summary.dollars_at_stake.total_difference, 4000);
  assert.equal(p.portfolio.total_difference, 4000);
  assert.equal(p.portfolio.finding_count, 1);
  // A clean portfolio of printed statements: 0.00.
  const z = runTool("audit_expense_portfolio", {
    as_of: "2026-04-01",
    audits: [
      loc("Alder Court, Suite 200", printedClean()),
      loc("Alder Court, Suite 210", printedClean()),
    ],
  });
  assert.ok(z.ok, JSON.stringify(z));
  const zr = z.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(zr.portfolio.total_difference, 0);
  assert.equal(zr.portfolio.finding_count, 0);
});
