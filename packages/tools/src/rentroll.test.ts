// rent_roll_certify: a commercial rent roll graded line by line against the leases. Every party,
// building and figure is invented; the expected figures are worked by hand in the comments.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ExchangeItem, FactPackageSendInput } from "./exchange.ts";
import {
  RENT_ROLL_GRADES,
  rentRollCase,
  rentRollSummary,
  runTool,
  runWithExchangeCaller,
  documentId,
  type FreeDocumentHost,
} from "./index.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function run(input: Json = rentRollCase()): Json {
  const o = runTool("rent_roll_certify", input);
  assert.ok(o.ok, o.ok ? "" : JSON.stringify(o.error));
  return o.result as Json;
}
const line = (r: Json, id: string): Json =>
  (r.lines as Json[]).find((l) => l.line_id === id)!;
const check = (l: Json, field: string): Json =>
  (l.checks as Json[]).find((c) => c.field === field)!;

test("grades: each line of the invented roll gets the grade worked out by hand", () => {
  const r = run();
  const g = (id: string) => line(r, id).grade;
  assert.equal(g("L1"), "matches_lease_confirmed_by_tenant"); // estoppel agreed premises, expiration, base rent
  assert.equal(g("L2"), "differs"); // roll $118,400 a year, lease 3,200 SF x $36 = $115,200
  assert.equal(g("L3"), "matches_lease"); // 11,000 SF x $31 = $341,000
  assert.equal(g("L4"), "no_lease_supplied");
  assert.equal(g("L5"), "differs"); // expiration 2030-09-30 on the roll, 2029-09-30 in the lease
  assert.equal(g("L6"), "not_checkable"); // the lease facts hold no rent schedule
  for (const id of ["L7", "L8", "L9", "L10"])
    assert.equal(g(id), "matches_lease");
  assert.equal(line(r, "V1").grade, null);
  assert.deepEqual(r.totals.grades, {
    matches_lease: 5,
    matches_lease_confirmed_by_tenant: 1,
    differs: 2,
    no_lease_supplied: 1,
    not_checkable: 1,
  });
  assert.equal(r.totals.reliance_possible, 6);
  for (const x of r.lines as Json[])
    assert.ok(
      x.grade === null ||
        (RENT_ROLL_GRADES as readonly string[]).includes(x.grade),
    );
});

test("a difference carries both figures, the dollar difference and both quotes", () => {
  const r = run();
  const l2 = line(r, "L2");
  const c = check(l2, "rent_annual");
  assert.equal(c.status, "differs");
  assert.equal(c.roll_value, 118400);
  assert.equal(c.against_value, 115200);
  assert.equal(c.difference, 3200);
  assert.match(c.roll_source.quote, /Larkspur Dental Group LLC/);
  assert.match(
    c.lease_source.quote,
    /2026-07-01 to 2027-06-30: \$36\.00 per RSF/,
  );
  assert.equal(c.lease_source.page, 3);
  assert.match(c.roll_source.sha256, /^f{64}$/);
  // per month and per SF: 3,200 x 36 / 12 = 9,600; 37 against 36
  assert.equal(check(l2, "rent_monthly").against_value, 9600);
  assert.equal(check(l2, "rent_psf").difference, 1);
  const l5 = check(line(r, "L5"), "expiration");
  assert.equal(l5.difference, 365); // 2029-09-30 to 2030-09-30, no leap day between
});

test("totals: area, occupancy, rent as stated against as the leases yield, worked by hand", () => {
  const r = run();
  // occupied 8,400+3,200+11,000+1,800+9,600+4,500+6,250+2,750+3,800+2,900 = 54,200; building 62,000
  assert.equal(r.area.occupied_sf, 54200);
  assert.equal(r.area.vacant_sf, 7800);
  assert.equal(r.key_figures.occupancy, 0.8742); // 54,200 / 62,000
  // stated: 277,200+118,400+341,000+75,600+307,200+189,000+212,500+99,000+114,000+113,100
  assert.equal(r.base_rent.stated_total, 1847000);
  // leases yield on the 8 lines with a worked lease rent (L4 has no lease, L6 no schedule)
  assert.equal(r.base_rent.per_leases, 1579200);
  assert.equal(r.base_rent.stated_on_lines_with_lease_rent, 1582400);
  assert.equal(r.base_rent.difference, 3200);
  assert.equal(r.base_rent.stated_without_lease_rent, 264600); // 75,600 + 189,000
});

test("WALT is calc.walt on the roll's expirations, by area and by rent, checked independently", () => {
  const r = run();
  const days = (a: string, b: string) =>
    Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const rows = (r.lines as Json[]).filter((l) => l.occupancy === "occupied");
  let num = 0;
  let den = 0;
  let numR = 0;
  let denR = 0;
  for (const l of rows) {
    const y = days(r.as_of, l.roll.lease_expiration_date) / 365.25;
    num += l.roll.area_sf * y;
    den += l.roll.area_sf;
    numR += l.roll.annual_base_rent * y;
    denR += l.roll.annual_base_rent;
  }
  assert.ok(
    Math.abs(r.walt.weighted_by_area_on_roll.years - num / den) < 0.00006,
  );
  assert.ok(
    Math.abs(r.walt.weighted_by_rent_on_roll.years - numR / denR) < 0.00006,
  );
  assert.equal(r.walt.formula.id, "calc.walt");
  assert.equal(r.key_figures.walt_years, r.walt.weighted_by_area_on_roll.years);
  assert.ok(r.walt.weighted_by_area_on_roll.steps.length >= 2);
});

test("rollover by year and top-tenant concentration", () => {
  const r = run();
  const row = (y: number) => (r.rollover as Json[]).find((x) => x.year === y)!;
  assert.equal(row(2027).leases, 1);
  assert.equal(row(2027).annual_base_rent, 341000);
  assert.equal(row(2030).leases, 3); // L5, L6, L8
  assert.equal(row(2030).area_sf, 16850);
  assert.equal(row(2030).annual_base_rent, 595200);
  assert.equal(
    (r.rollover as Json[]).reduce((s, x) => s + x.leases, 0),
    10,
  );
  const top = r.concentration.top_tenants as [Json, ...Json[]];
  assert.equal(top[0].tenant, "Quillfeather Legal Partners");
  assert.equal(top[0].share_of_stated_rent, 0.1846); // 341,000 / 1,847,000
  assert.equal(r.concentration.top_1_share, 0.1846);
  assert.equal(top.length, 5);
});

test("flags: expiring within 12 months, no lease, lease with no roll line, rent above the lease", () => {
  const r = run();
  const codes = (r.flags as Json[]).map((f) => `${f.code}:${f.line_id}`);
  assert.ok(codes.includes("LEASE_EXPIRING_WITHIN_12_MONTHS:L3"));
  assert.ok(codes.includes("LEASE_EXPIRING_WITHIN_12_MONTHS:L9"));
  assert.ok(!codes.includes("LEASE_EXPIRING_WITHIN_12_MONTHS:L1"));
  assert.ok(codes.includes("NO_LEASE_SUPPLIED:L4"));
  assert.ok(codes.includes("ROLL_RENT_ABOVE_LEASE:L2"));
  assert.ok(codes.includes("LEASE_WITHOUT_ROLL_LINE:null"));
  assert.equal(r.totals.leases_without_roll_line, 1);
});

test("estoppel: a disputed statement makes the line differ; a different date or a missing statement is not a confirmation", () => {
  const disputed = rentRollCase() as Json;
  const e = disputed.leases[0].estoppel;
  e.statements[3] = {
    key: "S06",
    code: "BASE_RENT",
    decision: "disputed",
    tenants_own_version: "$32.00 per RSF",
  };
  const r = run(disputed);
  const l1 = line(r, "L1");
  assert.equal(l1.grade, "differs");
  const c = (l1.checks as Json[]).find((x) => x.against === "estoppel")!;
  assert.equal(c.against_value, "$32.00 per RSF");
  assert.equal(c.estoppel.decision, "disputed");
  assert.ok((r.flags as Json[]).some((f) => f.code === "ESTOPPEL_DISPUTED"));

  const later = rentRollCase() as Json;
  later.leases[0].estoppel.as_of = "2027-01-01"; // later than the roll
  assert.equal(line(run(later), "L1").grade, "matches_lease");
  const earlier = rentRollCase() as Json;
  earlier.leases[0].estoppel.as_of = "2026-08-01"; // same rent step as the roll
  assert.equal(
    line(run(earlier), "L1").grade,
    "matches_lease_confirmed_by_tenant",
  );
  const stepped = rentRollCase() as Json;
  stepped.leases[0].estoppel.as_of = "2026-03-01"; // before the 2026-07-01 step: another rent
  const rs = run(stepped);
  assert.equal(line(rs, "L1").grade, "matches_lease");
  assert.ok(
    (rs.flags as Json[]).some((f) => f.code === "ESTOPPEL_DATE_DIFFERS"),
  );
  const partial = rentRollCase() as Json;
  partial.leases[0].estoppel.statements.pop(); // no base rent answer
  assert.equal(line(run(partial), "L1").grade, "matches_lease");
});

test("not checkable: the reason is given, and a field no lease fact covers is never assumed", () => {
  const r = run();
  const l6 = line(r, "L6");
  assert.equal(l6.grade, "not_checkable");
  assert.match(
    l6.reasons[0],
    /base rent was not checked: the lease facts supplied do not state the base rent schedule/,
  );
  assert.equal(check(l6, "rent_annual").status, "not_checked");
  // L1's roll states a deposit, an option and recoveries; the lease facts cover the first two only
  const l1 = line(r, "L1");
  assert.equal(check(l1, "deposit").status, "match");
  assert.equal(check(l1, "renewal").status, "match");
  assert.equal(check(l1, "recoveries").status, "not_checked");
  // L7 has a base year on the roll and in the lease
  assert.equal(check(line(r, "L7"), "recoveries").status, "match");
  // a roll line that states no rent at all cannot be matched
  const bare = rentRollCase() as Json;
  bare.roll_lines[2].facts = bare.roll_lines[2].facts.filter(
    (f: Json) => !/base_rent/.test(f.predicate),
  );
  const rb = run(bare);
  assert.equal(line(rb, "L3").grade, "not_checkable");
  assert.match(
    line(rb, "L3").reasons.join(" "),
    /roll does not state base rent/,
  );
});

test("rounding tolerance: within a dollar is a match within rounding, beyond it differs", () => {
  const c = rentRollCase() as Json;
  const f = c.roll_lines[2].facts.find(
    (x: Json) => x.predicate === "rent_roll.base_rent_annual",
  );
  f.value = 341000.6; // quote still shows 341,000.00: change the quote to carry it
  f.provenance.sources[0].quote = f.provenance.sources[0].quote.replace(
    "341,000.00",
    "341,000.60",
  );
  const r = run(c);
  const ch = check(line(r, "L3"), "rent_annual");
  assert.equal(ch.status, "match");
  assert.equal(ch.within_rounding, true);
  assert.equal(ch.difference, 0.6);
  f.value = 341002;
  f.provenance.sources[0].quote = f.provenance.sources[0].quote.replace(
    "341,000.60",
    "341,002.00",
  );
  assert.equal(line(run(c), "L3").grade, "differs");
});

test("the roll's own arithmetic: monthly rent times 12 against annual rent", () => {
  const c = rentRollCase() as Json;
  const l = c.roll_lines[2];
  const m = l.facts.find(
    (x: Json) => x.predicate === "rent_roll.base_rent_monthly",
  );
  m.value = 27000;
  m.provenance.sources[0].quote = m.provenance.sources[0].quote.replace(
    "28,416.67",
    "27,000.00",
  );
  const r = run(c);
  assert.ok(
    (r.flags as Json[]).some(
      (f) => f.code === "ROLL_RENT_INTERNAL" && f.line_id === "L3",
    ),
  );
  assert.equal(line(r, "L3").grade, "differs");
});

test("lease facts that disagree with no supersession: that field is not checked, and flagged", () => {
  const c = rentRollCase() as Json;
  const lf = c.leases[2].facts as Json[];
  const e = lf.find((x) => x.predicate === "lease.expiration_date")!;
  lf.push({
    ...JSON.parse(JSON.stringify(e)),
    id: "flf_dup_exp",
    value: "2028-02-28",
    provenance: {
      method: "extracted",
      sources: [
        {
          ...e.provenance.sources[0],
          quote: "The Term shall expire on 2028-02-28.",
        },
      ],
    },
  });
  const r = run(c);
  const l3 = line(r, "L3");
  assert.equal(l3.grade, "not_checkable");
  assert.ok(
    (r.flags as Json[]).some(
      (f) => f.code === "LEASE_FACTS_CONFLICT" && f.line_id === "L3",
    ),
  );
  // an amendment that supersedes the first settles it
  (lf[lf.length - 1] as Json).supersedes = [e.id];
  assert.equal(
    check(line(run(c), "L3"), "expiration").against_value,
    "2028-02-28",
  );
});

test("matching leases to lines: by line_id, else by tenant name; ambiguity is flagged, never guessed", () => {
  const c = rentRollCase() as Json;
  delete c.leases[2].line_id; // Quillfeather: matched by name
  assert.equal(line(run(c), "L3").grade, "matches_lease");
  c.roll_lines.push({
    line_id: "L11",
    facts: JSON.parse(JSON.stringify(c.roll_lines[2].facts)).map(
      (f: Json, i: number) => ({ ...f, id: `x${i}` }),
    ),
  });
  const r = run(c);
  assert.ok(
    (r.flags as Json[]).some(
      (f) =>
        f.code === "LEASE_WITHOUT_ROLL_LINE" &&
        /matches 2 roll lines/.test(f.message),
    ),
  );
  assert.equal(line(r, "L3").grade, "no_lease_supplied");
});

test("vacant and building area: vacant area is the building area less occupied area, and a difference is flagged", () => {
  const c = rentRollCase() as Json;
  c.building_area_sf = 63000;
  const r = run(c);
  assert.equal(r.area.vacant_sf, 8800);
  assert.ok((r.flags as Json[]).some((f) => f.code === "VACANT_AREA_DIFFERS"));
  delete c.building_area_sf;
  const r2 = run(c);
  assert.equal(r2.area.vacant_basis, "vacant lines on the roll");
  assert.equal(r2.key_figures.occupancy, 0.8742);
  c.roll_lines.pop();
  const r3 = run(c);
  assert.equal(r3.key_figures.occupancy, null);
  assert.ok(
    (r3.warnings as string[]).some((w) => /occupancy is not given/.test(w)),
  );
});

test("package_items match fact_package_send's schema; facts are listed once; reliance flags follow the grades", () => {
  const r = run();
  const items = r.package_items as Json[];
  assert.equal(items.length, 10); // the vacant line is not sent
  for (const it of items) {
    assert.ok(
      ExchangeItem.safeParse(it).success,
      JSON.stringify(ExchangeItem.safeParse(it)),
    );
    assert.equal(it.position, "state_ours");
    assert.ok(it.fact_ids.length >= 1 && it.fact_ids.length <= 20);
  }
  const l2 = items.find((i) => i.key === "L2")!;
  assert.equal(l2.grade, "differs");
  assert.equal(l2.their_value, 115200);
  assert.ok(
    l2.differences.some(
      (d: Json) => d.field === "rent_annual" && d.difference === 3200,
    ),
  );
  const l1 = items.find((i) => i.key === "L1")!;
  assert.equal(l1.estoppel_package_id, "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(l1.estoppel_statements, ["S03", "S04", "S05", "S06"]);
  assert.equal(
    new Set(r.package_facts).size,
    (r.package_facts as string[]).length,
  );
  const ids = new Set(r.package_facts as string[]);
  for (const it of items) for (const f of it.fact_ids) assert.ok(ids.has(f));
  // an item of kind rent_roll without a grade is refused by the send tool
  const sendish = FactPackageSendInput.safeParse({
    kind: "rent_roll",
    items,
    package: {},
    title: "t",
    subject: { label: "x" },
    from: { organisation: "a", person: "b" },
    to: { organisation: "c" },
    approved_by: "p",
    approval_confirmed: true,
  });
  assert.ok(sendish.success);
});

test("plan rule: a caller without a paid plan gets totals, key figures, counts and flags only", () => {
  const limited = runWithExchangeCaller({ fullAudit: false }, () => run());
  assert.equal(limited.limited, true);
  assert.equal(limited.lines, undefined);
  assert.equal(limited.package_items, undefined);
  assert.equal(
    limited.summary.key_figures.annual_base_rent_per_leases,
    1579200,
  );
  assert.equal(limited.summary.totals.grades.differs, 2);
  assert.ok(limited.rent_roll_withheld.length >= 4);
  assert.match(limited.rent_roll_note, /pricing/);
  const full = run();
  assert.equal(full.limited, undefined);
  assert.deepEqual((rentRollSummary(full) as Json).summary.totals, full.totals);
});

test("deterministic: the same facts give the same answer, whatever the order of the leases and the facts", () => {
  const a = run();
  const c = rentRollCase() as Json;
  c.leases.reverse();
  for (const l of c.leases) l.facts.reverse();
  for (const l of c.roll_lines) l.facts.reverse();
  const b = run(c);
  const strip = (r: Json) =>
    (r.lines as Json[]).map((l) => [l.line_id, l.grade, l.rent_difference]);
  assert.deepEqual(strip(b), strip(a));
  assert.deepEqual(b.base_rent, a.base_rent);
  assert.deepEqual(b.rollover, a.rollover);
  assert.equal(JSON.stringify(run()), JSON.stringify(a));
});

test("refusals: no quote, a second fact for one field, a duplicate id, two leases for one line, a wrong predicate", () => {
  const issues = (c: Json): string[] => {
    const o = runTool("rent_roll_certify", c);
    assert.equal(o.ok, false);
    return o.ok ? [] : o.error.issues.map((i) => `${i.path}: ${i.message}`);
  };
  let c = rentRollCase() as Json;
  c.roll_lines[0].facts[0].provenance.sources[0].quote = "";
  assert.ok(issues(c).some((m) => /^roll_lines\.0\.facts\.0/.test(m)));
  c = rentRollCase() as Json;
  c.roll_lines[0].facts.push({
    ...JSON.parse(JSON.stringify(c.roll_lines[0].facts[1])),
    id: "flf_new",
  });
  assert.ok(issues(c).some((m) => /two facts for rent_roll\.suite/.test(m)));
  c = rentRollCase() as Json;
  c.roll_lines[1].facts[0].id = c.roll_lines[0].facts[0].id;
  assert.ok(issues(c).some((m) => /duplicate fact id/.test(m)));
  c = rentRollCase() as Json;
  c.leases[1].line_id = "L1";
  assert.ok(issues(c).some((m) => /two leases name roll line L1/.test(m)));
  c = rentRollCase() as Json;
  c.roll_lines[0].facts[0].predicate = "lease.tenant";
  assert.ok(issues(c).some((m) => /is not a rent_roll fact/.test(m)));
  c = rentRollCase() as Json;
  c.roll_lines[1].line_id = "L1";
  assert.ok(issues(c).some((m) => /duplicate line id/.test(m)));
  c = rentRollCase() as Json;
  c.parties.relying_party.organisation = "alder court holdings llc";
  assert.ok(issues(c).some((m) => /different organisation/.test(m)));
});

// --- sending the certified roll ------------------------------------------------------------------

test("fact_package_send kind rent_roll: items, estoppel links and relying parties go to the Record; refusals", async () => {
  const { configureExchange, runToolAsync } = await import("./index.ts");
  const c = rentRollCase() as Json;
  const r = run(c);
  const all = new Map<string, Json>();
  for (const l of c.roll_lines as Json[])
    for (const f of l.facts) all.set(f.id, f);
  for (const l of c.leases as Json[]) for (const f of l.facts) all.set(f.id, f);
  const facts = (r.package_facts as string[]).map((id) => all.get(id)!);
  const made = runTool("fact_package_create", {
    facts,
    title: "Rent roll",
    created_at: "2026-11-20T12:00:00Z",
  });
  assert.ok(made.ok, JSON.stringify(made));
  const pkg = (made.result as { package: Json }).package;
  const calls: Json[] = [];
  configureExchange({
    url: "http://exchange.test/x",
    siteUrl: "http://site.test",
    fetch: (async (_u: string, init: { body: string }) => {
      const b = JSON.parse(init.body) as Json;
      calls.push(b);
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: "00000000-0000-4000-8000-0000000000aa",
            digest: "d",
            package_root: "r",
            status: "confirmed",
            sandbox: true,
            test_mode_reason: "x",
            owner_token: "o".repeat(20),
            counterparty_token: "c".repeat(20),
            reliances_recorded: [],
            relier_tokens: [{ label: "Second lender", token: "t".repeat(20) }],
          },
        }),
      );
    }) as unknown as typeof fetch,
  });
  const base = {
    package: pkg,
    kind: "rent_roll",
    title: "Rent roll, Alder Court",
    subject: { label: "Alder Court Office Building" },
    from: { organisation: "Alder Court Holdings LLC", person: "Dana Example" },
    to: { organisation: "Northfield Credit Partners LLC" },
    items: r.package_items,
    calculation: r.package_calculation,
    relying_parties: ["Second lender"],
    estoppel_links: [
      "https://cre-record.vercel.app/#/r/00000000-0000-4000-8000-000000000001/" +
        "a".repeat(20),
    ],
    approved_by: "Dana Example",
    approval_confirmed: true,
  };
  const ok = await runToolAsync("fact_package_send", base);
  assert.ok(ok.ok, JSON.stringify(ok));
  const out = ok.result as Json;
  assert.equal((out.links_for_relying_parties as Json[]).length, 1);
  assert.deepEqual((out.recorded as Json).items_awaiting_answer, []);
  assert.match(String(out.note), /lender or buyer/);
  const sent = calls[0]!;
  assert.deepEqual(sent.linked_estoppels, [
    { id: "00000000-0000-4000-8000-000000000001", token: "a".repeat(20) },
  ]);
  assert.deepEqual(sent.relying_parties, ["Second lender"]);

  const refuse = async (mutate: (x: Json) => void, re: RegExp) => {
    const x = JSON.parse(JSON.stringify(base)) as Json;
    x.package = pkg;
    mutate(x);
    const o = await runToolAsync("fact_package_send", x);
    assert.equal(o.ok, false);
    assert.match(JSON.stringify(o.ok ? {} : o.error), re);
  };
  await refuse(
    (x) => delete (x.items as Json[])[0]!.grade,
    /give the line's grade/,
  );
  await refuse((x) => delete x.estoppel_links, /status link of that estoppel/);
  await refuse(
    (x) => ((x.items as Json[])[1]!.text = "t"),
    /for kind estoppel only/,
  );
  await refuse(
    (x) => ((x.items as Json[])[2]!.estoppel_package_id = "x"),
    /only a line graded confirmed/,
  );
  await refuse(
    (x) => (x.kind = "fact_confirmation"),
    /for kind rent_roll only/,
  );
  await refuse(
    (x) => ((x.items as Json[])[3]!.position = "accept_theirs"),
    /state_ours/,
  );
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
  const a = rentRollCase();
  const whole = runWithExchangeCaller(
    { fullAudit: false, freeDocument: host },
    () => run(a),
  );
  const local = run(a);
  // the whole answer, plus a plain statement that it was the one free document
  const { free_document: note, ...rest } = whole;
  assert.deepEqual(rest, local);
  assert.equal(note.free_document, true);
  assert.match(note.note, /one free full document/);
  assert.match(note.note, /Pro or Team/);
  assert.match(note.note, /pricing/);
  // the id the host saw is the hash of the whole answer, the same one report_create computes
  assert.equal(used[0], `rent_roll_certify:${documentId(local)}`);
  const summary = runWithExchangeCaller(
    { fullAudit: false, freeDocument: host },
    () => run(a),
  );
  assert.equal(summary.limited, true);
  assert.equal(summary.free_document.free_document, false);
  assert.match(summary.free_document.note, /already used/);
  // the host is not asked when the caller is paid or local
  const n = used.length;
  runWithExchangeCaller({ fullAudit: true, freeDocument: host }, () => run(a));
  run(a);
  assert.equal(used.length, n);
});
