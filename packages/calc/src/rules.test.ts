// The Texas protest deadline's status fields: as_of, its default (texasToday), and the batch form.
import assert from "node:assert/strict";
import test from "node:test";

import {
  TX_PROTEST_DEADLINE_NOT_COVERED,
  TX_PROTEST_NEXT_SEASON_NOTE,
  texasToday,
  txProtestDeadline,
  txProtestDeadlineBatch,
} from "./index.ts";

const NO_NOTICE =
  "No notice delivery date given: if the notice was delivered after April 15, the deadline is later than May 15.";

test("texasToday: US Central time, daylight saving from the second Sunday of March to the first Sunday of November", () => {
  // Standard time (UTC−6): 05:59 UTC is still the previous day, 06:00 UTC is the new day.
  assert.equal(texasToday(new Date("2026-01-15T05:59:00Z")), "2026-01-14");
  assert.equal(texasToday(new Date("2026-01-15T06:00:00Z")), "2026-01-15");
  // Daylight time (UTC−5) from 2026-03-08 08:00 UTC to 2026-11-01 07:00 UTC.
  assert.equal(texasToday(new Date("2026-05-16T04:59:00Z")), "2026-05-15");
  assert.equal(texasToday(new Date("2026-05-16T05:00:00Z")), "2026-05-16");
  assert.equal(texasToday(new Date("2026-03-08T07:59:00Z")), "2026-03-08"); // 01:59 CST
  assert.equal(texasToday(new Date("2026-03-09T04:30:00Z")), "2026-03-08"); // 23:30 CDT
  assert.equal(texasToday(new Date("2026-11-01T06:30:00Z")), "2026-11-01"); // 01:30 CDT
  assert.equal(texasToday(new Date("2026-11-02T05:30:00Z")), "2026-11-01"); // 23:30 CST
  // New Year's Eve in Texas while it is already January 1 in UTC.
  assert.equal(texasToday(new Date("2027-01-01T03:00:00Z")), "2026-12-31");
});

test("as_of defaults to texasToday() and is echoed with its own step", () => {
  const today = texasToday();
  const r = txProtestDeadline({ tax_year: 2026 });
  assert.equal(r.value.as_of, today);
  assert.deepEqual(
    r.value,
    txProtestDeadline({ tax_year: 2026, as_of: today }).value,
  );
  assert.equal(
    r.steps.find((s) => s.label === "As of")?.formula,
    "current date in US Central time (as_of not given)",
  );
});

test("each status, and the deadline dates do not depend on as_of", () => {
  const at = (as_of: string) =>
    txProtestDeadline({ tax_year: 2026, as_of }).value;
  for (const as_of of ["2025-12-31", "2026-01-01", "2026-05-15", "2026-05-16"])
    assert.equal(at(as_of).deadline, "2026-05-15", as_of);
  assert.equal(at("2025-12-31").status, "not_yet_open");
  assert.equal(at("2025-12-31").days_remaining, 135);
  assert.equal(at("2026-01-01").status, "open");
  assert.equal(at("2026-05-15").status, "open");
  assert.equal(at("2026-05-15").days_remaining, 0);
  const passed = at("2026-05-16");
  assert.equal(passed.status, "passed");
  assert.equal(passed.days_remaining, null);
  assert.deepEqual(passed.next_season, {
    tax_year: 2027,
    deadline: "2027-05-17",
    conservative_file_by: "2027-05-14",
    basis: "may_15",
  });
  assert.deepEqual(passed.notes, [
    TX_PROTEST_DEADLINE_NOT_COVERED,
    TX_PROTEST_NEXT_SEASON_NOTE,
  ]);
  assert.equal(at("2026-05-15").next_season, null);
  assert.deepEqual(at("2026-05-15").notes, [TX_PROTEST_DEADLINE_NOT_COVERED]);
});

test("the April 15 warning appears only while the deadline is open or not yet open", () => {
  const w = (as_of: string) =>
    txProtestDeadline({ tax_year: 2026, as_of }).warnings;
  assert.deepEqual(w("2025-11-07"), [NO_NOTICE]);
  assert.deepEqual(w("2026-04-01"), [NO_NOTICE]);
  assert.deepEqual(w("2026-11-07"), []);
});

test("notes are plain facts: no advice wording", () => {
  for (const n of [
    TX_PROTEST_DEADLINE_NOT_COVERED,
    TX_PROTEST_NEXT_SEASON_NOTE,
  ]) {
    assert.doesNotMatch(n, /\b(you|should|can still|recommend)\b/i);
  }
  assert.match(TX_PROTEST_DEADLINE_NOT_COVERED, /^The rule does not cover/);
  assert.match(TX_PROTEST_DEADLINE_NOT_COVERED, /see Tax Code §41\.44\(b\)/);
  assert.match(TX_PROTEST_DEADLINE_NOT_COVERED, /§25\.25/);
});

test("batch: one as_of for every item, statuses counted, items equal the single rule", () => {
  const items = [
    { id: "open", tax_year: 2026, notice_delivered_date: "2026-05-20" },
    { id: "later", tax_year: 2027 },
    { id: "past", tax_year: 2025 },
  ];
  const r = txProtestDeadlineBatch({ items, as_of: "2026-06-10" });
  assert.equal(r.value.as_of, "2026-06-10");
  assert.deepEqual(r.value.summary.by_status, {
    open: 1,
    passed: 1,
    not_yet_open: 1,
  });
  for (const [i, item] of items.entries()) {
    const single = txProtestDeadline({ ...item, as_of: "2026-06-10" });
    const {
      rule: _r,
      disclaimer: _d,
      notes: _n,
      as_of: _a,
      ...fields
    } = single.value;
    void [_r, _d, _n, _a];
    assert.deepEqual(r.value.results[i], {
      id: item.id,
      ...fields,
      warnings: single.warnings,
    });
  }
  assert.deepEqual(r.value.notes, [
    TX_PROTEST_DEADLINE_NOT_COVERED,
    TX_PROTEST_NEXT_SEASON_NOTE,
  ]);
  // Without as_of: today in US Central time, once for the batch.
  const d = txProtestDeadlineBatch({ items });
  assert.equal(d.value.as_of, texasToday());
});
