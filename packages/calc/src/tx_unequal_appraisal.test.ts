// calc.tx_unequal_appraisal additions: label and address are echoed only, flags never change a number,
// and the new warnings are facts that appear only when their condition holds.
import assert from "node:assert/strict";
import test from "node:test";

import { CalcInputError, txUnequalAppraisal } from "./index.ts";
import type { TxUnequalAppraisalInput } from "./index.ts";

const base: TxUnequalAppraisalInput = {
  tax_year: 2027,
  subject: {
    id: "S",
    value: 1_000_000,
    value_basis: "appraised",
    improvement_area_sf: 10_000,
  },
  comparables: [
    {
      id: "A",
      value: 900_000,
      value_basis: "appraised",
      improvement_area_sf: 4_000,
    },
    { id: "B", value: 950_000, value_basis: "appraised" },
    {
      id: "C",
      value: 1_050_000,
      value_basis: "appraised",
      improvement_area_sf: 10_500,
      adjustments: [
        { label: "age", kind: "percent", value: -0.05, reason: "comp newer" },
      ],
    },
  ],
};

test("label and address are echoed and change no number, step or warning", () => {
  const plain = txUnequalAppraisal(base);
  const labelled = txUnequalAppraisal({
    ...base,
    subject: {
      ...base.subject,
      label: "1000 Louisiana St",
      address: "1000 Louisiana St, Houston, TX 77002",
    },
    comparables: base.comparables.map((c, i) => ({
      ...c,
      label: `Comp ${i + 1}`,
      address: `${i + 1} Main St`,
    })),
  });
  assert.equal(labelled.value.subject_label, "1000 Louisiana St");
  assert.equal(
    labelled.value.subject_address,
    "1000 Louisiana St, Houston, TX 77002",
  );
  assert.deepEqual(
    labelled.value.comparables.map((c) => [c.label, c.address]),
    [
      ["Comp 1", "1 Main St"],
      ["Comp 2", "2 Main St"],
      ["Comp 3", "3 Main St"],
    ],
  );
  assert.equal(plain.value.subject_label, null);
  assert.equal(plain.value.comparables[0]!.address, null);
  const strip = (r: typeof plain) => ({
    ...r,
    value: {
      ...r.value,
      subject_label: null,
      subject_address: null,
      comparables: r.value.comparables.map((c) => ({
        ...c,
        label: null,
        address: null,
      })),
    },
  });
  assert.deepEqual(strip(labelled), strip(plain));
});

test("flags are per comparable facts; the spread warning names the comparables", () => {
  const r = txUnequalAppraisal(base);
  assert.deepEqual(
    r.value.comparables.map((c) => c.flags.map((f) => f.code)),
    [["value_psf_above_2x"], ["missing_area"], []],
  );
  assert.equal(r.value.median_adjusted_value, 950_000);
  assert.ok(
    r.warnings.some((w) =>
      w.startsWith(
        'Values are compared whole (normalize_by "none"), and the improvement area of comparable A differs',
      ),
    ),
  );
  // Some adjustment given: no unadjusted-median warning.
  assert.ok(!r.warnings.some((w) => w.startsWith("No adjustments")));
  // Normalized by improvement area: no spread warning (B needs an area, so drop it).
  const n = txUnequalAppraisal({
    ...base,
    normalize_by: "improvement_area_sf",
    comparables: [
      base.comparables[0]!,
      base.comparables[2]!,
      { ...base.comparables[2]!, id: "D" },
    ],
  });
  assert.ok(!n.warnings.some((w) => w.startsWith("Values are compared whole")));
});

test("no adjustments at all: the warning quotes the statute's words", () => {
  const r = txUnequalAppraisal({
    ...base,
    comparables: base.comparables.map((c) => ({ ...c, adjustments: [] })),
  });
  assert.ok(
    r.warnings.includes(
      'No adjustments were supplied: the median is of unadjusted values. §41.43(b)(3) and §42.26(a)(3) refer to "the median appraised value of a reasonable number of comparable properties appropriately adjusted".',
    ),
  );
  for (const w of r.warnings)
    assert.doesNotMatch(w, /\b(should|recommend|you must)\b/i);
});

test("label over 80 and address over 120 characters, and other fields, are rejected", () => {
  assert.throws(
    () =>
      txUnequalAppraisal({
        ...base,
        subject: { ...base.subject, label: "x".repeat(81) },
      }),
    CalcInputError,
  );
  assert.throws(
    () =>
      txUnequalAppraisal({
        ...base,
        comparables: [
          { ...base.comparables[0]!, address: "x".repeat(121) },
          ...base.comparables.slice(1),
        ],
      }),
    CalcInputError,
  );
  assert.throws(
    () =>
      txUnequalAppraisal({
        ...base,
        comparables: [
          { ...base.comparables[0]!, situs_address: "1 Main" } as never,
          ...base.comparables.slice(1),
        ],
      }),
    CalcInputError,
  );
});
