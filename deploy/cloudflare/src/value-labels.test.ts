// A free caller gets the current roll year only (gating.ts limitHistory). The labels the registry puts on each
// value-history entry (fields.ts labelValueHistory) must not bring an earlier year's file or date back with it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  labelValueHistory,
  type ValueFile,
} from "../../../packages/tools/src/fields.ts";

import { limitHistory } from "./gating.ts";

const FILES: Record<string, ValueFile> = {
  "doc-2026": {
    source_id: "tx-x-cad",
    filename: "2026%20Certified.zip",
    as_of: "2026-11-02",
    read_on: "2026-11-02",
  },
  "doc-2025": {
    source_id: "tx-x-cad-2025",
    filename: "x_2025.zip",
    as_of: "2026-11-01",
    read_on: "2026-11-01",
  },
  "doc-2022": {
    source_id: "tx-x-cad-2022",
    filename: "Real_acct_owner_2022.zip",
    as_of: "2026-10-09",
    read_on: "2026-10-12",
  },
};

const entry = (year: number, doc: string, value: number) => ({
  tax_year: year,
  market_value: value,
  appraised_value: null,
  as_of: FILES[doc]!.as_of,
  citations: {
    market_value: {
      fact_id: `f-${year}`,
      document_id: doc,
      locator: "account 1",
      as_of: FILES[doc]!.as_of,
    },
    appraised_value: null,
  },
});

describe("value-history labels and the free view", () => {
  it("the current-year entry a free caller keeps names no file, date or year of an earlier entry", () => {
    const labelled = labelValueHistory(
      [
        entry(2026, "doc-2026", 3),
        entry(2025, "doc-2025", 2),
        entry(2022, "doc-2022", 1),
      ],
      (d) => FILES[d],
    );
    const free = limitHistory({
      urn: "fl:parcel:us-48999:1",
      value_history: labelled,
    }) as { value_history: Record<string, unknown>[] };
    assert.equal(free.value_history.length, 1);
    const kept = JSON.stringify(free.value_history[0]);
    for (const leak of [
      "2026-11-01",
      "2026-10-09",
      "2026-10-12",
      "x_2025",
      "Real_acct_owner_2022",
      "2025",
      "2022",
      "2023",
      "2024",
    ])
      assert.ok(!kept.includes(leak), `${leak} in ${kept}`);
    // The earlier entries carry their own notes (the gap, the late file), which the free view drops with them.
    assert.ok(
      (labelled[2]!.notes as string[]).some((n) => n.includes("2023 to 2024")),
    );
  });
});
