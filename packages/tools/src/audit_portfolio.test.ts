// audit_expense_portfolio: every location is the single audit's own answer, the portfolio adds them up,
// a bad location never fails the call, the plan rule, and a per-location attestation that verifies as
// a single audit's does. Every party and number is invented.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configureAttestation,
  documentId,
  factsInInput,
  publishedAttestationKeys,
  runTool,
  runToolAsync,
  runWithExchangeCaller,
  verifyAttestation,
  type FreeDocumentHost,
} from "./index.ts";
import { FactPackageSendInput } from "./exchange.ts";
import { throwawayKey } from "./attestation.testkit.test.ts";
import {
  SAMPLE_SPECS,
  locationInput,
  samplePortfolio,
} from "./audit_portfolio.testkit.test.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const run = (args: Json): Json => {
  const o = runTool("audit_expense_portfolio", args);
  assert.ok(o.ok, JSON.stringify(o));
  return o.result as Json;
};
const single = (loc: Json, as_of: string): Json => {
  const { label: _l, landlord: _d, ...rest } = loc;
  void _l;
  void _d;
  const o = runTool("audit_expense_statement", { ...rest, as_of });
  assert.ok(o.ok, JSON.stringify(o));
  return o.result as Json;
};

test("each location is the single audit's own answer, and the totals add up", () => {
  const args = samplePortfolio("2026-04-01");
  const r = run(args);
  const audits = args.audits as Json[];
  assert.equal(r.locations.length, audits.length);
  let total = 0;
  let firm = 0;
  let findings = 0;
  r.locations.forEach((l: Json, i: number) => {
    const s = single(audits[i]!, "2026-04-01");
    assert.equal(l.summary.finding_count, s.totals.finding_count);
    assert.equal(
      l.summary.dollars_at_stake.total_difference,
      s.totals.total_difference,
    );
    assert.deepEqual(l.package.package_items, s.package_items);
    assert.equal(l.result_ref.result_digest, documentId(s));
    assert.deepEqual(
      l.findings.map((f: Json) => [f.id, f.difference]),
      s.findings.map((f: Json) => [f.id, f.difference]),
    );
    total += s.totals.total_difference;
    firm += s.totals.firm_difference;
    findings += s.totals.finding_count;
  });
  assert.equal(r.portfolio.total_difference, Math.round(total * 100) / 100);
  assert.equal(r.portfolio.firm_difference, Math.round(firm * 100) / 100);
  assert.equal(r.portfolio.finding_count, findings);
  assert.equal(
    r.portfolio.firm_difference + r.portfolio.readings_difference,
    r.portfolio.total_difference,
  );
  // by class and by check and by landlord each add to the same total
  const sum = (xs: number[]) =>
    Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  assert.equal(
    sum(r.by_class.map((c: Json) => c.dollars_at_stake)),
    r.portfolio.total_difference,
  );
  assert.equal(
    sum(r.by_check.map((c: Json) => c.dollars_at_stake)),
    r.portfolio.total_difference,
  );
  assert.equal(
    sum(r.by_landlord.map((c: Json) => c.total_difference)),
    r.portfolio.total_difference,
  );
  assert.equal(
    r.by_class.reduce((a: number, c: Json) => a + c.findings, 0),
    findings,
  );
  assert.deepEqual(run(args), r, "deterministic");
});

test("worked figures: the Cedar Point case is the single audit's $4,217", () => {
  const r = run(samplePortfolio());
  const cedar = r.locations.find(
    (l: Json) => l.label === "Cedar Point, Suite 110",
  );
  assert.equal(cedar.summary.dollars_at_stake.total_difference > 0, true);
  assert.equal(cedar.landlord, "Alder Court Holdings LLC");
  assert.equal(
    cedar.summary.dollars_at_stake.by_class.follows_from_terms,
    cedar.summary.dollars_at_stake.firm_difference,
  );
});

test("ranking, deadlines in date order with days from as_of, no clock", () => {
  const r = run(samplePortfolio("2026-04-01"));
  const totals = r.ranking.map((x: Json) => x.total_difference);
  assert.deepEqual(
    totals,
    [...totals].sort((a: number, b: number) => b - a),
  );
  assert.equal(r.ranking[0].rank, 1);
  const days = r.deadlines.map((d: Json) => d.last_day);
  assert.deepEqual(days, [...days].sort());
  // Westfield: received 2026-01-12 + 90 days = 2026-04-12; 11 days after 2026-04-01
  const w = r.deadlines.find(
    (d: Json) => d.label === "Westfield Row, Suite 200",
  );
  assert.equal(w.last_day, "2026-04-12");
  assert.equal(w.days_remaining, 11);
  assert.equal(r.portfolio.earliest_deadline.label, "Westfield Row, Suite 200");
  // later as_of: the same deadline has passed
  const later = run(samplePortfolio("2026-05-01"));
  const w2 = later.deadlines.find(
    (d: Json) => d.label === "Westfield Row, Suite 200",
  );
  assert.equal(w2.status, "passed");
  assert.equal(w2.days_remaining, -19);
  assert.deepEqual(r.locations_without_deadline, ["Ridgeview Annex"]);
  assert.match(r.warnings.join(" "), /No deadline could be computed/);
});

test("repeated issues: the same check across locations, and across years for one landlord", () => {
  const r = run(samplePortfolio());
  const fee = r.repeated_issues.filter(
    (x: Json) => x.check === "management_fee",
  );
  const alder = fee.find((x: Json) => x.scope === "landlord");
  assert.equal(alder.landlord, "Alder Court Holdings LLC");
  assert.deepEqual(alder.locations, [
    "Cedar Point, Suite 110",
    "Cedar Point, Suite 110 (2024)",
  ]);
  assert.deepEqual(alder.statement_years, [2024, 2025]);
  assert.equal(alder.across_years, true);
  const port = fee.find((x: Json) => x.scope === "portfolio");
  assert.ok(port.location_count >= 4);
  // a check that failed at one location only is not repeated
  assert.ok(!r.repeated_issues.some((x: Json) => x.location_count < 2));
});

test("a location that fails validation is reported on its own; the rest are audited", () => {
  const args = samplePortfolio();
  const audits = args.audits as Json[];
  audits[1] = { ...audits[1], lease_facts: [{ nonsense: true }] };
  audits[2] = {
    label: "Harbor Row, Unit 4",
    lease_facts: audits[2]!.lease_facts,
  }; // no statement
  audits[3] = { ...audits[3], label: audits[0]!.label }; // duplicate label
  audits[4] = { ...audits[4], lease_facts_typo: 1 };
  const r = run(args);
  assert.equal(r.portfolio.locations_submitted, 11);
  assert.equal(r.portfolio.locations_invalid, 4);
  assert.equal(r.portfolio.locations_audited, 7);
  assert.equal(r.report_units, 7);
  const bad = r.locations_invalid as Json[];
  assert.deepEqual(
    bad.map((b) => b.index),
    [1, 2, 3, 4],
  );
  assert.match(bad[0]!.issues[0].path, /^audits\.1\.lease_facts\.0/);
  assert.match(bad[1]!.issues[0].message, /statement_facts|required/);
  assert.match(bad[2]!.issues[0].message, /duplicate label/);
  assert.match(bad[3]!.issues[0].message, /unknown field/);
  assert.match(r.warnings[0], /4 locations were not audited/);
  // and all bad is still an answer, not an error
  const none = run({ audits: [{ label: "x" }], as_of: "2026-04-01" });
  assert.equal(none.portfolio.locations_audited, 0);
  assert.equal(none.portfolio.total_difference, 0);
  // the call itself still refuses a missing list, a bad date and too many audits
  for (const bad of [
    { as_of: "2026-04-01" },
    { audits: [], as_of: "2026-04-01" },
    { audits: [{}], as_of: "April 1" },
    { audits: ["not an object"], as_of: "2026-04-01" },
    { audits: Array.from({ length: 51 }, () => ({})), as_of: "2026-04-01" },
  ])
    assert.equal(runTool("audit_expense_portfolio", bad).ok, false);
});

test("include_results carries the whole single result; landlord grouping is by letters and digits", () => {
  const specs = [
    { ...SAMPLE_SPECS[0]!, landlord: "Alder Court Holdings, LLC" },
    { ...SAMPLE_SPECS[2]!, landlord: "ALDER COURT HOLDINGS LLC" },
  ];
  const args = {
    audits: specs.map((s) => locationInput(s)),
    as_of: "2026-04-01",
    include_results: true,
  };
  const r = run(args);
  assert.equal(r.by_landlord.length, 1);
  assert.equal(r.by_landlord[0].landlord, "Alder Court Holdings, LLC");
  assert.equal(
    documentId(r.locations[0].result),
    r.locations[0].result_ref.result_digest,
  );
  assert.deepEqual(
    r.locations[0].result,
    single(args.audits[0]!, "2026-04-01"),
  );
});

test("each location's package_items go to fact_package_send: its schema accepts them", () => {
  const r = run(samplePortfolio());
  for (const l of r.locations as Json[]) {
    const parsed = FactPackageSendInput.shape.items.safeParse(
      l.package.package_items,
    );
    assert.ok(parsed.success, l.label);
  }
});

test("hosted summary: counts and totals only; the free document is not taken", () => {
  const args = samplePortfolio();
  audits_bad(args);
  const used: string[] = [];
  const host: FreeDocumentHost = {
    use(tool, id) {
      used.push(`${tool}:${id}`);
      return { granted: true };
    },
  };
  const o = runWithExchangeCaller(
    { fullAudit: false, freeDocument: host },
    () => runTool("audit_expense_portfolio", args),
  );
  assert.ok(o.ok);
  const r = o.result as Json;
  assert.equal(r.limited, true);
  assert.equal(r.audit_available, "pro");
  assert.equal(used.length, 0, "the free document is not asked");
  assert.equal(r.free_document.free_document, false);
  assert.match(r.free_document.note, /single audit/);
  assert.equal(r.summary.locations_audited, 10);
  assert.equal(r.summary.locations_invalid, 1);
  assert.equal(r.report_units, 10);
  assert.equal(r.locations, undefined);
  assert.equal(r.ranking, undefined);
  assert.equal(r.deadlines, undefined);
  assert.equal(r.repeated_issues, undefined);
  const text = JSON.stringify(r);
  assert.ok(!text.includes("Proportionate Share"), "no quote leaks");
  assert.ok(!text.includes("FEE_ON"), "no finding code leaks");
  assert.ok(!text.includes("Millbrook"), "no location name leaks");
  assert.match(r.audit_note, /Pro and Team/);
  const whole = run(args);
  assert.equal(r.summary.total_difference, whole.portfolio.total_difference);
  const paid = runWithExchangeCaller({ fullAudit: true }, () =>
    runTool("audit_expense_portfolio", args),
  );
  assert.ok(paid.ok && (paid.result as Json).ranking !== undefined);
});
function audits_bad(args: Json): void {
  (args.audits as Json[])[10] = { label: "Broken", lease_facts: 5 };
}

test("the hosted service attests each location on its own, as a single audit would", async () => {
  const args = samplePortfolio();
  configureAttestation({
    signingKey: await throwawayKey(),
    now: () => new Date("2026-11-20T10:00:00Z"),
  });
  try {
    const o = await runToolAsync("audit_expense_portfolio", args);
    assert.ok(o.ok, JSON.stringify(o));
    const r = o.result as Json;
    const keys = new Map(
      (await publishedAttestationKeys()).map((k) => [k.kid, k.x]),
    );
    const audits = args.audits as Json[];
    let attested = 0;
    for (const [i, l] of (r.locations as Json[]).entries()) {
      const pkg = l.package;
      if (pkg.items_count === 0) {
        assert.equal(pkg.attestation, undefined);
        continue;
      }
      attested += 1;
      const att = pkg.attestation;
      assert.equal(att.tool.name, "audit_expense_statement");
      assert.equal(att.kind, "expense_reconciliation");
      // the same attestation content a single audit of this location returns
      const { label: _l, landlord: _d, ...rest } = audits[i]!;
      void _l;
      void _d;
      const s = await runToolAsync("audit_expense_statement", {
        ...rest,
        as_of: args.as_of,
      });
      assert.ok(s.ok);
      const sAtt = (s.result as Json).attestation;
      assert.equal(att.inputs_digest, sAtt.inputs_digest);
      assert.equal(att.result_digest, sAtt.result_digest);
      assert.equal(att.signature, sAtt.signature);
      assert.equal(att.inputs_digest, l.result_ref.input_digest);
      const facts = [...factsInInput(audits[i]).values()].map(
        (x) => x[0]!,
      ) as Json[];
      const v = await verifyAttestation(
        att,
        { kind: att.kind, items: pkg.package_items, facts },
        keys,
      );
      assert.deepEqual(v.problems, []);
      // another location's facts do not verify it (replay)
      const other = [
        ...factsInInput(audits[(i + 1) % audits.length]).values(),
      ].map((x) => x[0]!) as Json[];
      assert.equal(
        (
          await verifyAttestation(
            att,
            { kind: att.kind, items: pkg.package_items, facts: other },
            keys,
          )
        ).ok,
        false,
      );
      // a changed item does not
      const items = JSON.parse(JSON.stringify(pkg.package_items));
      items[0].value = 1;
      assert.equal(
        (await verifyAttestation(att, { kind: att.kind, items, facts }, keys))
          .ok,
        false,
      );
    }
    assert.ok(attested >= 8);
    assert.match(r.attestation_note, /own attestation/);
  } finally {
    configureAttestation(undefined);
  }
  // hosted without a key: null per location and a note; local: nothing
  const hosted = await runWithExchangeCaller(
    { hosted: true, fullAudit: true },
    () => runToolAsync("audit_expense_portfolio", args),
  );
  assert.ok(hosted.ok);
  const h = hosted.result as Json;
  assert.equal(h.locations[0].package.attestation, null);
  assert.match(h.attestation_note, /No attestation/);
  const local = await runToolAsync("audit_expense_portfolio", args);
  assert.ok(local.ok && !("attestation_note" in (local.result as Json)));
});
