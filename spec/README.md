# FactLot conformance vectors

Language-neutral test cases that every FactLot implementation (TypeScript, Python, and future SDKs)
must pass. They are the source of truth: if an implementation and a vector disagree, the
implementation is wrong, unless the vector is shown to be wrong. In that case, fix the vector and
bump the calculator's formula version.

Expected values are computed **independently of any FactLot implementation** (by hand, or in a
separate script using decimal arithmetic) and checked against the implementations.

## `vectors/calc/<name>.json`

```json
{
  "calculator": "calc.rent_schedule",
  "version": 1,
  "cases": [
    {
      "name": "…",
      "input": {
        "…": "snake_case input, exactly as the calculator accepts it"
      },
      "expect": { "value.total_rent_due": 1517740.8 },
      "tolerance": 1e-8
    },
    { "name": "…", "input": {}, "expect_error": true }
  ]
}
```

- `expect` maps dotted paths into the result to expected values. Array indexes are path
  segments, so `value.steps.3.monthly_rent` is the fourth step's monthly rent.
- Numbers compare exactly unless `tolerance` is given.
- `expect_error: true` means the implementation must reject the input with its input-error type.

## `vectors/id.json`

Each case names a function (`parcel`, `entity`, `document`, `building`, `space`, `normalize_apn`,
`normalize_apn_v1`, `normalize_suite`, `normalize_suite_v1`, `normalize_street`, `parse`), its
snake_case input, and either the expected `urn` and `short` values (or `value`) or `expect_error`.
For `document`, `input.text` is UTF-8 encoded before hashing. `version` is the ID spec version the
vectors pin (0.3); `normalize_suite_v1` pins suite rule 1 of spec 0.1 and `normalize_apn_v1` parcel
rule 1 of specs 0.1-0.2, kept so earlier space and parcel IDs can be recomputed. `normalize_apn`
takes an optional `county` (5-digit state and county FIPS) that selects a county APN format.
