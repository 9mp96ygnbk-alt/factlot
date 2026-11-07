# Texas protest season: comparable-property fields, 2027 roll timing, Tarrant signals

Source documentation for the Texas appraisal-roll fields behind the unequal-appraisal tools
(`registry_tx_equity_candidates` and its value history): what each district publishes, which
columns feed which facts, and when the 2027 rolls appear as the publishers state it. Every
publisher page cited below was read on 2026-11-06 unless another date is given; anything not
established from the publisher's own page is marked **unconfirmed**.

FactLot is software. It is not a property tax consultant under Texas Occupations Code chapter 1152,
does not prepare, file or advise on protests, and does not represent owners before an appraisal
review board. If you provide property tax services to others for compensation, your own
registration obligations apply.

## 1. Neighborhood code and building class

Two string predicates (see [`docs/fact-model.md`](../../../docs/fact-model.md)):

- `parcel.neighborhood_code`: the district's own neighborhood or market-area code, as written.
- `parcel.building_class`: the district's building class code for the main improvement, as
  written. Where a district also publishes a quality code, the quality is not recorded.

Blank values, and a district's own blank marker (DCAD's `UNASSIGNED`), write no fact. Nothing is
inferred or filled in.

The columns were read from the districts' published files (headers and sample rows) and checked
against the layout documents the districts ship with them.

| District | `parcel.neighborhood_code`                                                                                             | `parcel.building_class`                                                                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harris   | `real_acct.txt` `Neighborhood_Code` (`5900.05`)                                                                        | `Real_building_land.zip`: `structure` (construction class `A`/`B`/`C`/`D`/`S`/…, `desc_r_04_building_class.txt`) of the account's largest section (`im_sq_ft`) in `building_other.txt`, else in `building_res.txt`. Quality `qa_cd` not recorded. Loaded as its own registry source, `tx-harris-cad-buildings`, so the fact cites that file. |
| Dallas   | `ACCOUNT_INFO.CSV`: `IMA` ("Improved Market Area Identifier (Commercial Only)") on `COM` accounts, `NBHD_CD` on others | `ACCOUNT_APPRL_YEAR.CSV` `BLDG_CLASS_CD` ("Primary building class description": `OFFICE BUILDING`, or a numeric residential class such as `14`). `COM_DETAIL.CSV` `PROPERTY_QUAL_DESC` (quality) and `CONSTR_TYP_DESC` not recorded.                                                                                                         |
| Travis   | `PROP.TXT` `hood_cd` (columns 1686–1695)                                                                               | `IMP_DET.TXT` `imprv_det_class_cd` (columns 76–85) of the largest floor detail, else the largest detail of any type. No separate quality code in the export.                                                                                                                                                                                 |
| Collin   | none: `AD_Public` has no neighborhood or market-area column (`abs_subdv_cd` is the subdivision)                        | `class_cd` ("CCAD Improvement Classification Code (internal CAD use)": `RE1`, `MM2`)                                                                                                                                                                                                                                                         |
| Tarrant  | not loaded (see below)                                                                                                 | not loaded                                                                                                                                                                                                                                                                                                                                   |

### Counts in the 2026 files

"Parcels" are the commercial-scope parcels FactLot loads from each file (the same totals as the
loaded registry, except Travis: 30,551 here from the certified supplement 0 file).

| District | File (downloaded 2026-11-02)                                                      | Parcels | With `neighborhood_code` | Distinct codes | With `building_class` | Distinct classes |
| -------- | --------------------------------------------------------------------------------- | ------: | -----------------------: | -------------: | --------------------: | ---------------: |
| Harris   | `Real_acct_owner.zip` (2026, last modified 2026-11-01) + `Real_building_land.zip` |  87,717 |                   87,713 |          1,982 |                75,601 |                8 |
| Dallas   | `DCAD2026_CURRENT.ZIP` (files dated 2026-10-12)                                   |  59,645 |                   49,510 |            977 |                59,643 |              112 |
| Travis   | `2026 Certified Appraisal Export Supp 0_07182026.zip`                             |  30,551 |                   30,435 |            238 |                30,054 |               53 |
| Collin   | `LiteDatabaseCurrent.zip` (2026-11-02)                                            |  18,035 |                        0 |              — |                17,125 |              199 |

Notes on the counts:

- Harris: 4 accounts carry `Neighborhood_Code` `0.00`, which `real_neighborhood_code.txt` does not
  list, so they get no fact. Building class: `C` 24,455, `S` 20,050, `D` 18,933, `R` 10,646,
  `B` 656, `M` 476, `A` 271, `T` 114; 10,623 of the 75,601 come from `building_res.txt`
  (accounts with no classed commercial row). 12,116 parcels have no classed building row.
- Dallas: 31,737 commercial-division accounts get their `IMA` and 17,773 residential-division
  ones their `NBHD_CD`; the 10,126 commercial accounts with only a land market area (`LMA`) get no
  neighborhood fact. Building class is a description on commercial accounts (`STORAGE WAREHOUSE`
  6,031, `OFFICE BUILDING` 3,592) and a number on residential ones (`14` 4,202, `12` 3,627).
- Travis: codes such as `CEN` 2,445, `SW` 1,802, `CBD` 934; classes such as `R5` 10,102, `C` 6,973, `S` 3,047, `D` 3,015, `WW` 1,719. A bare
  `*` class (20 properties) is skipped.
- Collin: classes such as `R04TDE` 2,667, `OM3` 1,344, `OS3` 1,327, `MA3` 739.

Denton, Williamson and Fort Bend are not covered by this table.

### Tarrant: where the fields are published

The file FactLot reads for Tarrant, `PropertyData(Delimited).ZIP`, has 58 columns and carries
neither field. The district's True Prodigy extract `000_Tarrant_All_Taxing_Units.zip` (downloaded
2026-11-02, 741,667,771 bytes; layout `TP_Legacy8.0.32-AppraisalExportLayout.xlsx` inside it)
does: `hood_cd` at columns 1686–1695 of `2026-10-30_2026_APPRAISAL_INFO.TXT` (sample values
`1H040N`, `3H020A`) and `Imprv_det_class_cd` at 76–85 of `..._APPRAISAL_IMPROVEMENT_DETAIL.TXT`;
its `prop_id` equals PropertyData's `Account_Num`. `APPRAISAL_INFO.TXT` is 14,009,929,130 bytes
uncompressed. Tarrant County is not served by the hosted registry while the publisher's terms for
AI use are unclear (section 3).

## 2. Preliminary 2027 rolls and value history

### What each district publishes

| District   | Spring preliminary export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Prior-year exports                                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harris     | Yes, in the year folder `download.hcad.org/data/CAMA/<year>/` under the same file names: HCAD's page script (`hcad.org/cpresources/db22ae8f/js/HcadPdata.js`) labels a year "Preliminary Values" until `get-certification-flag?t=<year>` returns `certflg` `Y`. On 2026-11-06 `t=2026` returned `certflg` `Y` (last updated November 01, 2026), `t=2027` returned `N`, and `get-property-downloads?t=2027&c=CAMA&s=Real%20Property` returned `null` (no 2027 files yet). The month the 2027 files appear is **unconfirmed** (the downloads page renders client-side and states no schedule). | Yes: `get-tax-years` lists 2026 back to at least 2007; `get-property-downloads?t=2024&...` lists `data/CAMA/2024/Real_acct_owner.zip` and the rest. `real_acct.txt` also carries `prior_tot_appr_val` and `prior_tot_mkt_val` (not read). |
| Dallas     | No file is labelled preliminary. `www.dallascad.org/DataProducts.aspx` lists "2027 Data Files (Most Current Ownership)" (`DCAD2027_CURRENT.zip`) and per-year "Annual Appraisal Notice Data" files (`MAIL1_APPRAISAL_NOTICE_DATA_2026.zip` real property, `MAIL2_` BPP, `MAIL3_`). `www.dallascad.org/Calendar.aspx`: first real-property notices mailed April 15, 2026. Whether `DCAD2027_CURRENT.zip` fills with 2027 values in spring is **unconfirmed**; the copy downloaded on 2026-11-02 lists all 60,208 in-scope accounts with tax year 2027 and every value `.00`.                  | Yes: `DCAD2025_CURRENT.ZIP` … `DCAD2022_CURRENT.zip` (certified with supplements) and `DCAD2025_CERTIFIED_07242025.zip` … `DCAD2022_CERTIFIED_07252022.ZIP` (at certification), same `ViewPDFs.aspx?type=3&id=…` links.                   |
| Tarrant    | None listed on `www.tad.org/resources/data-downloads`: "2026 True Prodigy Data Extract - Revised Weekly" and "Property Data 2026 Data - Revised TBD" (files labelled Certified). Whether `PropertyData(Delimited).ZIP` switches to preliminary values in spring is **unconfirmed**.                                                                                                                                                                                                                                                                                                          | Yes: `PropertyData_<year>(Certified).ZIP` and `_R_`, `_C_`, `_P_`, `_M_` variants for 2021–2025 under `/content/data-download/`, plus supplemental and exemption files.                                                                   |
| Travis     | None listed now on `traviscad.org/publicinformation`. File names are dated (`2026 Certified Appraisal Export Supp 0_07182026.zip`, `travis_SUPP 335_2026_WEBSITE EXPORT_Renamed.zip`), so a spring export would be a new URL. Whether TCAD posts one is **unconfirmed**.                                                                                                                                                                                                                                                                                                                     | Appraisal exports: none listed. Only the yearly EARS submissions (`227EARS090425.zip` 2025, …).                                                                                                                                           |
| Collin     | `collincad.org/category/appraisal-data-exports/`: the Access export carries "certified value and preliminary values (when available)" and "will be retired soon", pointing to data.texas.gov. Socrata dataset `nne4-8riu` "Collin CAD Appraisal Data - Preliminary" (updated daily; 2026-11-05) already holds tax year 2027 rows with the 2027 value columns empty.                                                                                                                                                                                                                          | On data.texas.gov, not collincad.org: `5tkr-3759` (2026), `vffy-snc6` (2025), `6dqt-e958` (2024), `khef-anha` (2023), `vtby-uz4n` (2022), `cwex-zmku` (2021), `hkzz-rrn8` (2020).                                                         |
| Denton     | DCAD's own pages are **unconfirmed**: `www.dentoncad.com` resets TLS and `http://www.dentoncad.com/` serves a registrar parking page ("Domain registration has expired"). The county GIS layer FactLot reads (`gis.dentoncounty.gov/.../Parcels_FC/MapServer/0`) reports `pYear` 2027 on all 382,843 features already; whether its values are 2027 preliminary or 2026 values carried forward is **unconfirmed** (no layer description).                                                                                                                                                     | **Unconfirmed** (the Data Extracts page could not be reached).                                                                                                                                                                            |
| Williamson | Separate fixed-ID Socrata datasets on data.wcad.org, already holding tax year 2027: `w6ik-bzmf` "Final Values - Preliminary" ("updated weekly beginning April 1st", 375,088 rows), `553d-hn26` "Property - Preliminary", `nncq-auvt` "Improvement Real Property - Preliminary", `t9au-8afa` "Imp Seg Commercial - Preliminary". The PropOwner dataset `absk-uy9g` FactLot reads already states `tax_year` 2027.                                                                                                                                                                              | None at account level: each dataset holds one year. `2a8c-uwfx` "Final Values - Certified" still held 2025 on 2026-11-06.                                                                                                                 |
| Fort Bend  | `www.fbcad.org/certified-and-supplements-reports/`: preliminary Orion exports every 2–3 weeks from late March to mid-June, each at a new dated URL (`wp-content/uploads/2026/04/2026_04_21_0828-Orion-2026-Preliminary-Export-Redacted.zip`, …; 2026: 03-27, 04-21, 05-03, 05-18, 06-01, 06-15).                                                                                                                                                                                                                                                                                             | Yes: 2025, 2024 and 2023 certified exports (re-uploaded August 2026, e.g. `2026/08/2026_08_17_1646-Orion-2025-Certified-Export-Redacted-1.zip`), their supplements and preliminaries.                                                     |

### Capped appraised value (Dallas, Fort Bend)

- **Dallas** — yes. `ACCOUNT_APPRL_YEAR.CSV` has `HMSTD_CAP_VAL` ("Capped total value of account"
  in `TABLES AND FIELD NAMES.xlsx`, shipped in the zip) next to `TOT_VAL`. In `DCAD2026_CURRENT.ZIP`
  it is filled on all 59,645 in-scope accounts and differs from `TOT_VAL` on 11,765 of them (about
  a fifth; for example `B12` duplexes). FactLot does not load it.
- **Fort Bend** — no separate appraised-value column, but the owner record carries the cap
  adjustments: `HSCapAdj` ("Homestead Cap Adjustment for this owner") and `CBLCapAdj` ("Circuit
  Breaker Limitation Cap Adjustment for this owner", the §23.231 cap), per the `Orion Appraisal
Export Layout.xlsx` shipped in the zip; the entity record has per-unit `MarketValue` and
  `AssessedValue`. FactLot reads none of them. In Supplement 4
  (`2026_10_23_1427-Orion-2026-Supplement-4-Export-_Redacted.zip`, 1,959,232 bytes, read
  2026-11-06), 14 of the 120 in-scope (F1, F2, B) accounts have a non-zero `CBLCapAdj` and none a
  `HSCapAdj`. Market value minus those adjustments would be the capped value; FactLot does not
  derive it (it would be a computed, not a stated, figure). §23.231(k) says the section expires
  December 31, 2026, and its §42.26(d) reference drops out on 2027-01-01, so 2027 commercial rows
  would carry no `CBLCapAdj` and appraised and market value would coincide (**unconfirmed** until
  2027 files exist).

### How tax years are kept apart

Each tax year's roll is its own registry source. The tax year a source was first loaded for keeps
the plain source id (2026 for six districts; 2027 for Denton and Williamson, whose files already
stated 2027 when they were first loaded on 2026-11-03); any other year is `<source_id>-<year>`
(`tx-dallas-cad-2027`, `tx-harris-cad-buildings-2027`). Within one tax year a newer file replaces
the older one and retires what it no longer lists, so the certified 2027 roll replaces the 2027
preliminary; a file for the next tax year does not retire this year's facts. A Dallas `TOT_VAL`
of 0 is not written as a market value (every in-scope 2026 value is positive; every 2027 one in
the November 2026 file is 0).

What this means for readers:

- A parcel can have current facts from two tax years (2026 certified and 2027 preliminary).
  `registry_get` returns the newest fact per predicate, so `parcel.tax_year` can be 2027 while
  `parcel.market_value` is still the 2026 figure when the 2027 file has no value yet. The
  `value_history` of a parcel lists market and appraised value by tax year, each cited to that
  year's roll.
- A year's facts stay current as that year's roll after the next year is loaded, so the value
  history keeps both years.

## 3. Tarrant robots.txt and terms

`https://www.tad.org/robots.txt`, read 2026-11-06. The section for all agents, which covers the
collector (`FactLotRegistryBot`), is:

```
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /
```

followed later by a second `User-agent: *` with an empty `Disallow:`. A Cloudflare-managed block
disallows named crawlers (among them `ClaudeBot`, `anthropic-ai`, `Claude-Web`, `GPTBot`,
`CCBot`, `Google-Extended`); FactLot's bot is not named. The file's preamble says access is on the
condition of abiding by the signals, and defines them: `search` (an index and short excerpts, "not
… AI-generated search summaries"), `ai-input` (inputting content into AI models, "retrieval
augmented generation, grounding"), `ai-train` (training or fine-tuning) and `use` ("immediate,
reference, or full"); a signal the operator leaves out "neither grants nor restricts". It calls
the restrictions express reservations of rights under Article 4 of EU Directive 2019/790.

The data-downloads page (`https://www.tad.org/resources/data-downloads`) states no licence, terms
or disclaimer for the files and links no terms page (only the Public Information Act request form).

Would serving Tarrant data be consistent with them? The use in question is serving roll values to
agents as cited facts for comparable-property lookups: retrieval, not training.

- `ai-train=no`: consistent. FactLot does not train or fine-tune models on the data.
- `ai-input`: not stated. This use is exactly what the file defines as `ai-input` (content put into
  a model for grounding or RAG). By the file's own rule an absent signal neither grants nor
  restricts, so it is neither permitted nor forbidden by the signals.
- `use=reference`: the file lists the values but does not define them. If "reference" means the
  content may be consulted and cited rather than reproduced in full, cited per-parcel facts fit it;
  serving many comps in bulk is less clearly "reference". **Unclear.**

Finding: not inconsistent with any stated directive, but not affirmatively allowed either
(`ai-input` is silent and `use=reference` is undefined).

Status: Tarrant County is not served by the hosted registry while the publisher's terms for AI use
are unclear. This applies to every hosted tool, and `registry_tx_equity_candidates` refuses Tarrant
parcels on every server. It stays so until the district states in writing whether reference use by
AI agents is permitted.
