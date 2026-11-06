// The holiday calendar calc_critical_dates rolls deadlines past, against the 2026 US federal
// holidays as OPM publishes them (July 4, 2026 is a Saturday: observed Friday, July 3).
import assert from "node:assert/strict";
import test from "node:test";

import { usFederalHolidays } from "./index.ts";

test("US federal holidays 2026, with the observed day", () => {
  assert.deepEqual([...usFederalHolidays(2026).keys()].sort(), [
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-07-04",
    "2026-09-07",
    "2026-10-12",
    "2026-11-11",
    "2026-11-26",
    "2026-12-25",
  ]);
  assert.equal(
    usFederalHolidays(2026).get("2026-07-03"),
    "Independence Day (observed)",
  );
  assert.equal(usFederalHolidays(2020).has("2020-06-19"), false);
});
