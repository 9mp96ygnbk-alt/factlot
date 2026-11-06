# Harris calculator input audit

Status of this file: evidence and a file reservation. It does not add a calculator, ingest a roll, or certify Harris County. The diagnostic module named below is not in the tree yet. FactLot is reserving those new paths before they are edited. This file is the only change in its pull request.

A readiness diagnostic does not fill missing Harris data. Parcel counts, a clean audit, and a mapped column are not county-complete coverage, not a license to republish the roll, and not a hosted lookup. Source acquisition stays with its owner. HCAD bulk files and TxGIO parcels are not fetched here.

Inspection date: 2026-11-06, repository `main` at `b289a08`. Counts below are quoted from files already in the repo. No new official file was downloaded to write this page.

## What calculators exist

`packages/calc/src/index.ts` registers 26 calculators. The public site manifest (`site/_content/calculators/manifest.json`) publishes 8 of them as pages. None of those 8 is the Texas unequal-appraisal calculator. Site pages, `site/index.html`, coverage map data, and `llms` files are out of this lane.

Every calculator is a pure function of caller-supplied inputs. Nothing in `packages/calc/src` reads Harris County. The only code that already shapes appraisal-roll facts into `calc.tx_unequal_appraisal` inputs is `registry_tx_equity_candidates` in `packages/tools/src/registry.ts` (and its Python twin). That tool needs a registry database. `docs/registry/coverage.md` says the only published queryable registry is the DC sample, and the Harris row says "No: not hosted, not in a published sample". This lane does not open hosting and does not edit that tool.

## Harris facts the current adapter actually writes

Source of the mapping: `python/src/factlot/registry/adapters/tx_harris.py` and `Registry._ingest_parcels` in `python/src/factlot/registry/store.py`. Synthetic proof, not real parcels: `python/tests/test_adapters.py` (`Harris`). Those files are not edited by this lane.

Publisher: Harris Central Appraisal District. Page cited by the adapter: `https://hcad.org/pdata/pdata-property-downloads.html`. License stored on the source: public record under Tex. Gov't Code ch. 552; no license or terms of use stated. `ai_use` and `redistribution` are `unknown`. `terms_reviewed` is `2026-11-02`.

| HCAD field | Predicate stored | Unit | What the adapter does with a blank or zero |
| --- | --- | --- | --- |
| `yr` | `parcel.tax_year` | year | blank → no fact |
| `tot_appr_val` | `parcel.appraised_value` | USD | `_num`: a literal `0` is stored as 0. It is not treated as missing. |
| `tot_mkt_val` | `parcel.market_value` | USD | same as appraised |
| `bld_ar` | `parcel.improvement_area_sf` | sf | `_positive`: 0 or blank → no fact |
| `land_ar` | `parcel.land_area_sf` | sf | 0 or blank falls back to `acreage * 43560`, rounded to 2 decimals, when acreage is positive; otherwise no fact. The fact does not record which column was used. |
| `yr_impr` | `parcel.year_built` | year | 0 or blank → no fact |
| `state_class` | `parcel.state_property_category` | code | commercial scope is `is_commercial`: category B (any subclass, so Harris `B1`–`B4`) plus `F1` and `F2` |
| `Neighborhood_Code` | `parcel.neighborhood_code` | code | kept only when `real_neighborhood_code.txt` lists it. `0.00` is not a listed code and is dropped. |
| `site_addr_1/2/3` | `parcel.situs_address` | text | street required. This is the property address, not the mailing address. |
| `owners.txt` line 1 | `ownership.owner_of_record` | text | organisations only. `CURRENT OWNER` / `UNKNOWN` dropped. `CONFIDENTIAL…` sets withheld and stores no name. |
| `building_other.txt` / `building_res.txt` `structure` | `parcel.building_class` | code | separate source `tx-harris-cad-buildings`, file `Real_building_land.zip`. Class of the section with the largest `im_sq_ft`. `qa_cd` is not stored. `im_sq_ft` is not stored as area. |

`Market_Area_1`, `Market_Area_2`, and `econ_bld_class` are named in the adapter docstring as not read.

Not mapped, and not to be invented: taxable value, exemptions, §23.231 circuit-breaker status, taxing-unit list, tax rates, sales prices, rent, NOI, cap rate, and zoning. `docs/registry/texas-sources.md` lists `Real_jur_exempt.zip`, `Real_acct_ownership_history.zip`, `Code_description_real.zip`, `PP_files.zip`, and `Hearing_files.zip` beside the two files the adapter reads. This audit did not open those zips. A filename is not a column mapping. Do not treat `Real_jur_exempt.zip` as a tax-rate table.

`tot_appr_val` is the roll's appraised value. It is not taxable value after exemptions, not a sale price, and not NOI. `tot_mkt_val` is the roll's market value. It is not a transaction. `bld_ar` is the account's improvement area. It is not rentable area, not a sum of building-section `im_sq_ft`, and not land area.

## Measured fill, and what it does not mean

`docs/registry/quality/audit-2026-11-03/after-texas.json`, source `tx-harris-cad`, snapshot filename `Real_acct_owner.zip`, `as_of` `2026-11-01`, `retrieved_at` `2026-11-02T23:07:43+00:00`. The reread matched the registry: 87,717 distinct in-scope accounts, 87,717 parcel ids, no header-like APNs. That is the commercial extract the pipeline kept (B subclasses, F1, F2), not every Harris account and not a county census.

| Field | Present | Missing | Present share |
| --- | ---: | ---: | ---: |
| `parcel.tax_year` | 87,717 | 0 | 100% |
| `parcel.state_property_category` | 87,717 | 0 | 100% |
| `parcel.situs_address` | 87,717 | 0 | 100% |
| `parcel.appraised_value` | 87,462 | 255 | 99.71% |
| `parcel.market_value` | 87,462 | 255 | 99.71% |
| `parcel.land_area_sf` | 86,583 | 1,134 | 98.71% |
| `parcel.year_built` | 78,391 | 9,326 | 89.37% |
| `parcel.improvement_area_sf` | 75,796 | 11,921 | 86.41% |
| `ownership.owner_of_record` | 56,792 | 30,925 | 64.74% |

The same JSON does not report `parcel.neighborhood_code` or `parcel.building_class`. Absence from that field list is not a measured fill rate. `tx-harris-cad-buildings` is not a source in that file. Do not quote a building-class coverage percentage.

`docs/registry/quality/tier1-2026-11-03.md` records 0 hard audit violations for `tx-harris-cad` and one implausible-year-built warning. Zero violations means the audit's own checks passed on the loaded extract. It does not mean zoning, sales, exemptions, tax rates, or taxing units are present.

`docs/registry/coverage.md` Harris row still says as-of "not recorded in the record", zoning "not mapped", sales "not mapped", and queryable "No". That public row is the right description of what a user can query. The 2026-11-01 date above is the internal snapshot's `as_of`, not a claim that the public coverage page publishes Harris.

The same after-texas file, for context only, not as a next download:

| Source | Appraised present | Market present | Improvement area present | Tax year present | Note |
| --- | ---: | ---: | ---: | ---: | --- |
| `tx-travis-cad` | 30,555 / 30,555 | 30,555 / 30,555 | 29,150 / 30,555 (95.4%) | 30,555 / 30,555 | same predicate contract; still not queryable |
| `tx-collin-cad` | 17,795 / 18,035 (98.67%) | 17,795 / 18,035 | 17,125 / 18,035 (94.95%) | 17,795 / 18,035 | 240 accounts missing tax year must not be given a guessed year |
| `tx-dallas-cad` | 0 / 59,645 | 59,645 / 59,645 | 59,292 / 59,645 (99.41%) | 59,645 / 59,645 | no appraised value in the file. Market must not be relabeled appraised. |
| `tx-tarrant-ad` | 44,934 / 45,976 (97.73%) | 44,934 / 45,976 | 39,635 / 45,976 (86.21%) | 45,976 / 45,976 | `registry_tx_equity_candidates` already refuses to serve Tarrant until the district's AI-use signal allows it |

Denton, Fort Bend, and Williamson have commercial counts on the coverage page and are not in `after-texas.json`, so they have no field fill in this audit. Bexar, El Paso, Hidalgo, Montgomery, and `tx-txgio-parcels` are recorded as gated. Do not rank them calculator-ready and do not download them.

## Which calculator inputs Harris facts can support

`calc.tx_unequal_appraisal` (`packages/calc/src/tx_unequal_appraisal.ts`, version 1) is the only calculator whose required inputs overlap the mapped Harris predicates. Tex. Tax Code §41.43(b)(3) and §42.26(a)(3) compare the subject's roll value with the median of adjusted comparable roll values. The function does not choose comparables and does not invent adjustments. Its own text says it is evidence arithmetic, not an appraisal, not legal or tax advice, and not a protest recommendation.

| Input | Can a cited Harris fact supply it? |
| --- | --- |
| `tax_year` | Yes, from `parcel.tax_year` / HCAD `yr`, and only when that fact is present. The snapshot `as_of` is the file date, not a second tax year. |
| `subject.value` + `value_basis: "appraised"` | Only when `parcel.appraised_value` is finite and **greater than 0**. A stored 0 is not a value. If the fact is missing, do not substitute market value and do not write 0. |
| `subject.value` + `value_basis: "market"` | Only when the caller explicitly asks for market basis and `parcel.market_value` is finite and greater than 0. The statute's comparison is of appraised value. Market-only is a different basis and must be labeled market. |
| both values present | Do not pick silently. Report both. The appraised figure is the one that matches the statutory comparison; market stays visible and unused unless the caller selects it. |
| `subject.improvement_area_sf` | Only when the improvement-area fact is finite and greater than 0. 11,921 accounts in the extract have none. Those accounts cannot use `normalize_by: "improvement_area_sf"`. A whole-value comparison (`normalize_by: "none"`) can still be calculated if the caller supplies comparables. |
| `subject.land_area_sf` | Only when the land-area fact is finite and greater than 0. Do not copy it into the improvement-area field. Do not re-derive it from acreage inside the diagnostic: the stored fact does not say whether `land_ar` or the acreage fallback produced it. |
| `subject.county_fips` | The constant `201` for this source, used only for the calculator's other-county warning. It is not a taxing unit. |
| `subject.id` | The parcel URN only when the caller already has the account. The diagnostic does not mint IDs and does not resolve them against a database. |
| `comparables` (minimum 3) | No. The caller chooses them. `registry_tx_equity_candidates` can propose candidates only when a registry file is open and the subject has a positive improvement area, a category, and a tax year. That tool is not part of this module, and Harris is not hosted. |
| `adjustments` and reasons | No. The calculator requires the caller's reason. Empty adjustments are a caller choice, not an inferred grid. |
| `circuit_breaker_23_231` | No. The schema defaults the flag to `false`, which means "not subject", not "unknown". The diagnostic must omit the key. Passing the default would state a legal status the roll mapping does not support. §42.26(d) warnings depend on this flag and on tax year. |
| citation | Required on every filled field: source id `tx-harris-cad` (buildings: `tx-harris-cad-buildings`), filename, locator, tax year, and `as_of`. A field with no `as_of` or no source is uncited and is not "ready". |

`registry_tx_equity_candidates` prefers appraised value when both exist (`comparable()` in `packages/tools/src/registry.ts`). The new diagnostic must not copy that silent preference. It also refuses to return owner names. The diagnostic must reject `ownership.*`, owner name, and mailing address if a caller puts them in the packet, and must not echo them.

The other 25 calculators stay manual. Harris facts do not contain their inputs:

| Calculator | Required inputs Harris does not have |
| --- | --- |
| `rent_schedule`, `net_effective_rent`, `compare_proposals`, `renew_vs_relocate`, `walt`, `critical_dates` | lease dates, rent, area basis the lease uses, concessions |
| `multifamily_rent_roll` | unit rents, statuses, concessions |
| `percentage_rent` | tenant sales |
| `cam_reconciliation`, `cam_reconciliation_batch`, `reconcile_cam`, `capex_recovery` | expense pools, shares, caps, lease clauses |
| `debt_sizing` | NOI, interest rate, amortization, LTV/DSCR/debt-yield tests. Do not prefill `value` from `tot_appr_val`. That number is not an underwriting. |
| `direct_cap` | NOI and either cap rate or price. Do not prefill `price` from market or appraised value. Do not prefill `area_sf` from `bld_ar` (`area_sf` is rentable area). |
| `dcf_pro_forma`, `reconcile_dcf` | rent roll, market leasing, exit cap, discount rate |
| `lease_vs_own` | rent, financing, exit, and any tax assumptions |
| `hotel_metrics` | occupancy, ADR, departmental revenue |
| `npv`, `irr`, `amortization_schedule`, `prepayment_and_defeasance`, `equity_waterfall` | cash flows or loan terms |
| `lease_remeasurement_asc842` | remaining payments and discount rate |
| `exchange_1031` | relinquished and replacement prices, debt, dates |

There is no property-tax bill calculator. A bill needs every taxing unit that covers that account for one tax year, that year's adopted rate for each unit, and taxable value after exemptions that actually apply. A county-wide rate does not exist in the mapped fields. Unknown rate is not zero. Unknown exemption eligibility is not "no exemption".

Zoning is unmapped for every Harris account. The City of Houston does not use a conventional zoning ordinance. That city fact is not a finding that a parcel is unrestricted, and it is not true of every municipality in Harris County. A situs city of HOUSTON may be reported as a limitation note. It must not be stored as a zoning district.

## First slice

The useful slice is a pure readiness check for one caller-supplied fact card aimed at `calc.tx_unequal_appraisal`'s **subject** fields.

The caller passes facts they already hold, each with predicate, value, unit, source id, filename, locator, tax year, and `as_of`. The function returns:

- `filled`: subject fields that are cited and usable, with basis and unit spelled out
- `missing`: required or requested fields that are absent, zero, negative, non-numeric, or uncited, with a message that says what the caller must type
- `refused`: NOI, cap rate, rent, sale price, taxable value, tax rate, exemption eligibility, zoning district, owner name. Refusal text says the diagnostic did not look them up.
- `normalize_by`: which of `none`, `improvement_area_sf`, and `land_area_sf` the card can support
- `not_county_complete: true` always
- `queryable: false` for Harris until a coverage record says otherwise. This module does not read coverage files and does not flip that flag from a parcel count.

It does not return a value opinion, a median, a protest recommendation, or a loan amount. It does not fetch. It does not open a database.

Fallback: the existing calculator still runs on a fully manual input. Readiness does not block that path. It only stops uncited or missing roll fields from being presented as filled.

### Guards the tests must lock

Use synthetic cards only. The invented rows in `python/tests/test_adapters.py` show the shapes (account `0010010000001` and its neighbors). Do not copy real owner names into fixtures.

1. Missing appraised and missing market → `subject.value` is not filled. Message says both roll values are absent. No zero.
2. Appraised `0` or negative → not filled, even though the adapter's `_num` would store a numeric 0.
3. Market present, appraised absent → value not filled as appraised. Market reported only as `available_not_selected`.
4. Both present and positive → both reported; selected basis is appraised only when the caller set `prefer: "appraised"` or left the statutory default explicit in the result as `selected_because: "statutory_comparison_uses_appraised"`. Market is `not_used`. The result must not look like the market figure was unseen.
5. Improvement area missing or 0 → `normalize_by` cannot be `improvement_area_sf`. `none` stays available. Land area is not copied across.
6. Land area missing → `land_area_sf` normalization blocked. Improvement area is not copied across.
7. `Neighborhood_Code` `0.00` or blank → no neighborhood key.
8. Any `ownership.*`, owner name, or mailing address → rejected, omitted from the output.
9. `circuit_breaker_23_231` omitted, never defaulted to false.
10. Requests for tax rate, NOI, cap rate, sale price, rent, taxable value, exemption, or zoning → `refused`, with the reason.
11. Situs city HOUSTON → limitation note on zoning. No zoning predicate is filled. A different city does not become "zoned" either.
12. Missing `as_of`, source id, or tax year on a fact → that field is `uncited`, not `filled`.
13. `not_county_complete` is true when every subject field is filled.
14. Building class and `im_sq_ft` do not become `improvement_area_sf`.

Expected diagnostic objects are written by hand in `spec/vectors/harris_readiness.json`. They are statuses and messages, not valuations. Do not generate them by running the module.

## Exact new paths to reserve

These paths do not exist on `main` at `b289a08`. Do not edit them until this reservation is confirmed. Nothing else is created in the first implementation.

| Path | Role |
| --- | --- |
| `packages/calc/src/harris_readiness.ts` | Pure TypeScript diagnostic. No I/O. |
| `packages/calc/src/harris_readiness.test.ts` | Node test. Imports the module by relative path. |
| `python/src/factlot/harris_readiness.py` | Same behavior in Python. |
| `python/tests/test_harris_readiness.py` | `unittest` module. |
| `spec/vectors/harris_readiness.json` | Shared cases both tests read. |

Not inside `spec/vectors/calc/`. `packages/calc/src/vectors.test.ts` and `python/tests/test_vectors.py` load every `spec/vectors/calc/*.json` as a registered calculator. A file there would fail those tests and would register a formula this slice does not add.

Import paths after the files exist:

- TypeScript tests: `import { harrisReadiness } from "./harris_readiness.ts"`
- Python tests: `from factlot.harris_readiness import harris_readiness`

Targeted commands, and only these, when implementation is allowed:

```bash
node --experimental-strip-types --conditions=factlot-source --test packages/calc/src/harris_readiness.test.ts
cd python && PYTHONPATH=src python3 -m unittest tests.test_harris_readiness
```

Do not run `npm test`, `npm run check`, `npm run test:python`, or `npm run differential` for this slice.

### Existing files this slice does not edit

Wiring the module into a registry would touch files this agreement excludes. Leave them alone:

- `packages/calc/src/index.ts` (the `calculators` object)
- `packages/calc/src/tx_unequal_appraisal.ts` and every other calculator file
- `python/src/factlot/calc.py`
- `python/src/factlot/__init__.py` (explicit export list; a new submodule imports without it)
- `packages/tools/src/catalog.ts` and anything `npm run schemas` rewrites (`spec/schemas/**`, `python/src/factlot/schemas/**`)
- `packages/tools/src/registry.ts` and `registry_tx_equity_candidates`
- `python/src/factlot/registry/**`, `python/src/factlot/collector/**`, `scripts/registry/**`
- `registry/sources/**`, `docs/registry/sources/**`, `docs/registry/coverage.md`, `docs/registry/coverage-data.json`, `docs/registry/coverage-counties.json`, `docs/registry/coverage-matrix.md`, `docs/registry/coverage-matrix.json`, `docs/registry/quality/surge-2026-11/**`
- `site/**`, root `README.md`, `CHANGELOG.md`, `llms.txt`, `site/llms.txt`
- this audit, once the implementation starts, except to correct a stated path if the reservation changes

The first implementation's test may import `txUnequalAppraisal` / `tx_unequal_appraisal` and pass a hand-built manual comparable list plus a subject the diagnostic filled, and compare the median to a figure computed by hand in the vector file. That is a call, not an edit. If that import is rejected, the diagnostic tests stand on their own and calculator integration waits.

A later catalog tool (`harris_appraisal_readiness` in `packages/tools/src/catalog.ts`, then `npm run schemas`) is a separate reservation. It is not part of this slice.

## County expansion, after the Harris tests pass

One gate record per county, produced by the same function from a cited field card plus the measured fill the caller pastes from an audit JSON. The module does not download rolls and does not read the coverage generator.

A county is not `calculator_ready`. Allowed statuses are only `not_ready` and `cited_subject_fields_only`. `cited_subject_fields_only` requires all of:

- license review date present, and redistribution not treated as granted when it is `unknown`
- `queryable` left false unless the caller passes the published coverage flag (Harris today: false)
- measured present/missing counts for `parcel.tax_year`, `parcel.appraised_value`, `parcel.market_value`, and `parcel.improvement_area_sf`, each with the audit file name and `as_of`
- the Harris guard tests passing, including zero and missing cases
- no status derived from parcel count or from zero audit violations

Order, using only the after-texas measurements already quoted, and only for this same subject-field diagnostic:

1. Harris (`201`), this slice. Not county-complete.
2. Travis (`453`), same appraised-and-market contract, still not queryable. No new download.
3. Collin (`085`), same contract, but accounts missing `tax_year` stay uncited. No new download.
4. Dallas (`113`) only as a market-basis variant. Appraised coverage is 0. Do not relabel market as appraised.
5. Tarrant (`439`) is not next. The equity tool's Tarrant AI-use hold applies to serving that district's data to agents. This diagnostic must return `not_ready` for Tarrant even though the extract has values.

Do not start Denton, Fort Bend, Williamson, Bexar, El Paso, Hidalgo, Montgomery, or TxGIO. Their access is either unmeasured in `after-texas.json` or already recorded as gated.

## Next step for data this module cannot see

Acquisition is a different owner. This lane does not fetch.

1. Taxing units, exemptions, and any §23.231 flag. `Real_jur_exempt.zip` is named in `docs/registry/texas-sources.md` and is not read by `tx_harris.py`. The acquisition owner can review that file's layout and license under the existing public-record note. Until a cited predicate exists, readiness leaves exemptions and `circuit_breaker_23_231` missing. This page does not claim the zip contains those columns. It was not opened.
2. Tax rates. Not a column in the mapped account file. A rate is the adopted rate of each taxing unit for one tax year. The next lawful step is a source review of the units' own adopted-rate publications for the year on the account, by the acquisition owner. A county-wide substitute is not acceptable. Until then the diagnostic refuses a tax rate.
3. Sales. Unmapped. The next step is a source review. `parcel.market_value` must not be used as the sale price.
4. Zoning. Unmapped. City open-data portals are "not yet reviewed" in `docs/registry/texas-sources.md`. The next step is one reviewed municipal source per city. Houston's lack of conventional zoning must stay a city limitation, not a county zoning code.
5. Hosted lookup. Out of scope. Readiness stays `queryable: false` for Harris.

Until those facts exist as cited inputs, the honest product is: manual calculators still run, and the Harris diagnostic tells the caller which subject fields of the unequal-appraisal arithmetic are cited, which are missing, and which it refuses to guess.
