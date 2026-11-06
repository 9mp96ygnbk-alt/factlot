# wa-pierce-assessor: Tier 1 audit, 2026-11-06

**Promotion bar: pass.** Audited is not complete. The Data Mart does not publish a commercial-parcel total. The scratch registry holds the non-exempt real-property accounts whose county use code the adapter maps to multifamily, commercial or industrial. Exempt accounts with those use codes, and every other use code, are out.

Lane A6. County FIPS **53053** (Washington 53). Evidence JSON: [wa-pierce-assessor-audit.json](wa-pierce-assessor-audit.json). Scratch database was kept outside the repository and is not committed.

## County count

| FIPS  | Parcels kept |     B |    F1 |  F2 | Snapshot as of | Age on 2026-11-06 |
| ----- | -----------: | ----: | ----: | --: | -------------- | ----------------: |
| 53053 |       12,530 | 2,288 | 9,745 | 497 | 2026-11-06     |            0 days |

The category counts match the 2026-11-03 record. The extract does not. `tax_account.zip` is sha256 `a3193ad97e345bdfe00987cf968a53ccfbcdd6dceec650cb2817e719b4eee7b0`, 9,135,364 bytes, `Last-Modified` Fri, 06 Nov 2026 09:01:31 GMT. The record's file was `2a5d532998f4b078…`, as-of 2026-10-30, 354,188 rows. This extract has 354,193 rows. The five added rows are out of scope. The record's audit note carries as-of 2026-11-06.

## Publisher land-use map

Pierce County's four-digit present-use code. The first two digits follow the Washington standard land use code (WAC 458-53-030), not a Texas property-class crosswalk. The adapter (`category` in `wa_pierce`) then drops accounts that are not `REAL` and accounts whose exemption type is a public body, tribe or non-profit. Counts below are from this extract, before that exemption screen and after it:

| Publisher codes                                                                                                                                                                                                             | FactLot      | Accounts before the exemption screen |  Kept |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -----------------------------------: | ----: |
| `1305`–`1308` multi-family, 5 or more units, including subsidized and high-rise                                                                                                                                             | B            |                                2,504 | 2,288 |
| `1600` hotels/motels; `50xx` non-residential condominiums except `5030` and `5050`; `51xx`–`59xx` trade; `61xx`–`66xx` and `69xx` services except `6242` and `6910`; `72xx`–`75xx` assembly, amusement, recreation, resorts | F1           |                               10,451 | 9,745 |
| `21xx`–`35xx` and `39xx` manufacturing                                                                                                                                                                                      | F2           |                                  532 |   497 |
| `11xx`, `12xx`, `14xx`, `15xx`, `17xx`–`18xx`, `41xx`–`49xx`, `67xx`, `68xx`, `71xx`, `76xx`, `8xxx`, `9xxx`, and the excluded codes above                                                                                  | out of scope |                  the rest of 354,193 |     0 |

`local_use_code` keeps the four-digit code. The tables have no owner name. The only name field is Business Name on `appraisal_account`, and it is not read.

## Commercial-universe denominator

The publisher does not publish a commercial or industrial parcel count. The Data Downloads page lists table names, file sizes and one extract date. It does not list a parcel total.

What was counted from the 2026-11-06 `tax_account` extract:

- All accounts: **354,193** (REAL 329,800, PERS 10,271, MOBIL 11,624, STRUC 2,498).
- REAL accounts whose use code is in the map above, before the exemption screen: **13,487**.
- After the exemption screen, loaded: **12,530**. The other 957 of those 13,487 carry a full exemption (municipal, non-profit, tribal, county, state, school, or the other prefixes the adapter lists) and are not kept.

A published commercial-universe denominator, as a figure the county states, is unavailable. 12,530 is the whole non-exempt subset of that use-code map, not a sample of it, and not the whole county.

The downloads page disclaimer is unchanged in substance from the record (warranty disclaimer, informational use). The county copyright page is still client-rendered and was not read. That unread page is the same open item the record already states. It is not a new restriction found in the files or on the downloads page, so the load was not stopped. No owner names are in the tables.

## Freshness

The Data Mart page `downloads.cfm`, read 2026-11-06, shows **Date Extracted 11/06/2026** on `tax_account`, `appraisal_account`, `improvement` and `improvement_builtas`. `--as-of 2026-11-06` is that date. Current tax year on every `tax_account` row is 2027. Companion zips were loaded (land area, building area, year built) and their `Last-Modified` values are also 2026-11-06. Age 0 days, inside 400.

## Fill rates

From the audit, over 12,530 current parcels:

| Field                     | Parcels | Present |
| ------------------------- | ------: | ------: |
| APN                       |  12,530 |    100% |
| State category            |  12,530 |    100% |
| Situs address             |  12,530 |    100% |
| Market value              |  12,528 |  99.98% |
| Appraised (taxable) value |  12,506 |  99.81% |
| Land area                 |  12,525 |  99.96% |
| Building area             |  10,230 |  81.64% |
| Year built                |  10,229 |  81.64% |
| Tax year                  |  12,530 |    100% |
| Owner of record           |       0 |      0% |

Organisation owners stored: 0. Person-like owner facts: 0. Facts written: 120,668, the same count as the record, on a newer extract. No implausible values.

## Promotion bar

| Check                                                                              | Result                                                                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Re-read yields exactly the parcels the registry holds                              | Pass. `read_roll` on `tax_account.zip` yields 12,530 in-scope ids, identical to the registry.                      |
| Audit violations                                                                   | Pass. 0.                                                                                                           |
| Person-like owner facts                                                            | Pass. 0.                                                                                                           |
| Per-county count matches the record, or the record is corrected with the new as-of | Pass. Count 12,530 matches. as-of corrected from 2026-10-30 to 2026-11-06, the extract date on the downloads page. |
| as-of within 400 days                                                              | Pass. 0 days.                                                                                                      |

`--reread` reports `no adapter registered for this source` because the audit module's adapter list does not include `wa_pierce`. The comparison above called `wa_pierce.read_roll` on the archived zip. The audit re-reads the snapshot file only. Companion tables add area and year built; they do not add parcels.
