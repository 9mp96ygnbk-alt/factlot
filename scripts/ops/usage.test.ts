import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { jsonOf, namespaceId } from "./usage.mjs";
import {
  buildReport,
  formatReport,
  parseRecords,
  shiftDay,
  windowDays,
} from "./usage-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const records = () =>
  parseRecords(
    readdirSync(fixtures).map((f) => readFileSync(join(fixtures, f), "utf8")),
  );

test("the window is yesterday and the seven complete days ending with it", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  const w = windowDays("2026-11-12");
  assert.equal(w.yesterday, "2026-11-11");
  assert.deepEqual(w.week, [
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
  ]);
});

test("fixture data: sums over isolates and days, per surface, tool, region and tier", () => {
  const r = buildReport(records(), "2026-11-12");
  const y = r.yesterday_summary!;
  const w = r.week_summary!;
  assert.deepEqual(y.days, ["2026-11-11"]);
  assert.deepEqual(w.days, ["2026-11-08", "2026-11-10", "2026-11-11"]);
  assert.equal(y.requests.by_surface["mcp"], 123);
  assert.equal(w.requests.by_surface["mcp"], 186);
  assert.equal(y.requests.site_pages["/texas/*"], 66);
  assert.equal(y.requests.site_pages["/pricing"], 30);
  assert.equal(y.lookups.total, 130);
  assert.equal(y.lookups.by_region["us-48"], 111);
  assert.equal(y.lookups.by_tool["registry_search"], 14);
  assert.equal(w.lookups.by_region["us-48"], 144);
  assert.equal(y.quota_exhausted["keyless"], 4);
  assert.deepEqual(y.plan_required, { batch: 3, dated: 2, model_tool: 1 });
  assert.equal(y.history_notes, 52);
  assert.equal(y.checkout_starts_by_interval["pro/year"], 1);
  assert.equal(w.checkout_starts_by_interval["team/month"], 1);
  assert.equal(y.checkout_completions["pro/page"], 1);
  assert.equal(y.reports["created"], 3);
  assert.equal(y.model_calls["doc_extract_lease/ok"], 2);
  // distinct callers merge across isolates: the same Pro key in two isolates is one key
  assert.equal(y.distinct_callers["pro"], 1);
  assert.equal(y.distinct_callers["team"], 1);
  assert.equal(y.active_paid_keys, 2);
  assert.ok(Math.abs(y.distinct_callers["keyless"]! - 45) <= 4);
  assert.ok(w.distinct_callers["keyless"]! > y.distinct_callers["keyless"]!);
});

test("the text report has both columns and says what a missing day is", () => {
  const text = formatReport(buildReport(records(), "2026-11-12"));
  assert.match(text, /yesterday 2026-11-11\s+7 days to 2026-11-11/);
  assert.match(text, /Requests\s+925\s+1118/);
  assert.match(
    text,
    /Days with data in the 7-day window: 3 of 7 \(no data: 2026-11-05/,
  );
  assert.match(text, /Pro key\s+1\s+1/);
  // a day with no record prints "no data", never 0
  const later = formatReport(buildReport(records(), "2026-11-13"));
  assert.match(later, /Requests\s+no data\s+1118/);
  assert.match(later, /history notes served[^\n]*no data/i);
  assert.doesNotMatch(later, /\s0\s+\d+\s*$/m); // no zero in the yesterday column
});

test("no records at all: every figure is no data and the notice names the switch", () => {
  const text = formatReport(buildReport([], "2026-11-12"));
  assert.match(text, /No usage records for these days/);
  assert.match(text, /USAGE_COUNTERS_ENABLED/);
  assert.doesNotMatch(text, /\b0\b\s*$/m);
  const json = buildReport([], "2026-11-12");
  assert.equal(json.yesterday_summary, undefined);
  assert.equal(json.week_summary, undefined);
});

test("records that are not usage records are ignored", () => {
  const good = readFileSync(join(fixtures, readdirSync(fixtures)[0]!), "utf8");
  const parsed = parseRecords([
    good,
    "not json",
    "{}",
    JSON.stringify({ v: 2, day: "2026-11-11", counters: {} }),
    JSON.stringify({
      v: 1,
      day: "2026-11-11",
      counters: {},
      callers: { pro: "short" },
    }),
  ]);
  assert.equal(parsed.length, 2);
  assert.deepEqual((parsed[1] as { callers: unknown }).callers, {});
});

test("wrangler output with warnings first still parses; the namespace id comes from wrangler.jsonc", () => {
  assert.deepEqual(jsonOf('\u001b[33mwarning\u001b[0m\n[ { "name": "a" } ]'), [
    { name: "a" },
  ]);
  assert.deepEqual(jsonOf('{"k":"v"}'), { k: "v" });
  const config = readFileSync(
    join(here, "../../deploy/cloudflare/wrangler.jsonc"),
    "utf8",
  );
  assert.match(namespaceId(config) ?? "", /^[0-9a-f]{32}$/);
});

test("fixtures hold no personal data", () => {
  for (const f of readdirSync(fixtures)) {
    const text = readFileSync(join(fixtures, f), "utf8");
    assert.doesNotMatch(text, /@|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|fl_live_/);
  }
});
