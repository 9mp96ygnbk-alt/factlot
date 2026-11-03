# il-cook-assessor: Cook County, Illinois (FIPS 17031) Assessor open data

Reviewed 2026-11-02. Machine-readable copy: [`registry/sources/il/il-cook-assessor.json`](../../../registry/sources/il/il-cook-assessor.json).
Adapter: `factlot.registry.adapters.il_cook` (account system `cook_pin`, the 14-digit Parcel Index Number).

**Status: `verified: false`.** The endpoints are confirmed by real (sampled) downloads and the mapping is
built and tested, but no license is attached to the datasets and the portal's Terms of Use link leads to the
County website terms, which claim copyright over site content. A person must decide whether public
record status is enough, or ask the Assessor's Office for a license statement (see Gates).

## Publisher and URLs

- Publisher: Cook County Assessor's Office (CCAO), Data Department. Portal: Cook County Open Data,
  `datacatalog.cookcountyil.gov` (Socrata / Tyler Data & Insights). Source system: iasWorld.
- Assessor's open-data overview: <https://datacatalog.cookcountyil.gov/stories/s/gzdr-q7c4> (a client-rendered
  "story"; its text was not readable by the collector).
- Datasets used (metadata at `https://datacatalog.cookcountyil.gov/api/views/<id>.json`; each says
  attribution "Cook County Assessor's Office", license: none, publishing frequency bi-weekly unless noted):

  | id          | Dataset                              | Rows (2026-11-02)                   | Used for                                      |
  | ----------- | ------------------------------------ | ----------------------------------- | --------------------------------------------- |
  | `pabr-t5kh` | Assessor - Parcel Universe (Current) | 1,864,469 PINs, tax year 2026       | the list of parcels, class, township          |
  | `uzyt-m557` | Assessor - Assessed Values           | one row per PIN and year, 1999–2026 | assessed values (mailed, certified, board)    |
  | `3723-97qp` | Assessor - Parcel Addresses          | one row per PIN and year, 1999–2026 | situs, taxpayer mailing name, owner of record |
  | `csik-bsws` | Assessor - Commercial Valuation Data | 109,409 rows, 2021–2025 (annual)    | land sf, building sf, year built              |

- Files the collector archives (SODA `/resource/<id>.csv`, which honours SoQL; the `v3/views/<id>/export.csv`
  endpoint ignores `$where` and formats money as `$2,287`, so it is not used):
  1. `resource/pabr-t5kh.csv?$select=pin,pin10,year,class,triad_name,township_code,township_name,nbhd_code,zip_code&$where=starts_with(class,'3') OR … '5' … '6' … '7' … '8' … '9'&$limit=500000`
  2. `resource/uzyt-m557.csv?$select=pin,year,class,township_code,mailed_tot,certified_tot,board_tot&$where=year=2026 AND (starts_with(class,'3') OR … '9')&$limit=500000`
  3. `resource/3723-97qp.csv?$where=year=2026 AND (starts_with(pin,'1603') OR '1612' OR '1705' OR '1707' OR '1708' OR '1709' OR '2919')&$limit=200000` — **a sample** (see below)
  4. `resource/csik-bsws.csv?$select=keypin,pins,year,township,class_es,address,property_type_use,bldgsf,gross_building_area,landsf,yearbuilt&$limit=500000`

  Update `year=2026` in files 2 and 3 when the next tax year appears in the Parcel Universe.

- **Throughput and the address sample.** Without an app token (which needs a portal account, so the
  collector has none) the portal streams the two 50-million-row datasets at about 100–500 rows per
  second, whatever the filter (`year=2026`, a PIN prefix, no filter, `$order=:id` were all tried; a
  300-PIN `pin in (…)` query took 13 s). The filtered universe (116,495 rows) and values (same PINs, 7
  columns) files download in minutes, but the Parcel Addresses dataset has no class column, and all
  1.86 M rows of 2026 would take hours. File 3 is therefore a sample: tax year 2026 for seven PIN
  areas chosen for their density of in-scope parcels in the universe — 17-07 and 17-08 (Near West Side
  and West Loop), 17-09 (Near North and River North), 17-05 (Goose Island and the north branch), 16-03
  and 16-12 (north-west side industrial corridors), 29-19 (south suburban industrial) — by the universe's
  counts about 49,100 address rows covering 7,555 in-scope PINs (the file itself was not yet downloaded;
  see Real run). Parcels outside the sample get PIN, class, township and value but
  no situs or owner. To cover the county, either ask the Assessor's Office whether a class-filtered
  export or an app token for the registry is possible, or run the download over several nights.
- Other Assessor datasets seen and not used: Parcel Sales `wvhk-k5uv` (buyer/seller names, prices;
  Illinois discloses sale prices through the MyDec transfer declaration), Property Tax-Exempt Parcels
  `vgzx-68gb` (owner names of exempt parcels), Residential Single and Multi-Family Improvement
  Characteristics `x54s-btds` (class 2 only: six units or fewer, out of scope), Residential Condominium
  Unit Characteristics `3r7i-mrz4`, Appeals, Permits, Parcel Proximity, Parcel Universe (Historical) `nj4t-kc8j`.

## Terms, license, robots

- **Terms of Use.** The portal's footer "Terms of Use" link is <https://www.cookcountyil.gov/terms-use>
  ("Terms and Conditions of Use" for the County websites). Operative sentences: section 2, "NO WARRANTY,
  EXPRESSED OR IMPLIED, IS MADE REGARDING ACCURACY, ADEQUACY, COMPLETENESS, LEGALITY, RELIABILITY OR
  USEFULNESS OF ANY INFORMATION POSTED ON THE COUNTY WEBSITES"; section 7, "By use of this system and any
  data contained therein, you agree that your use shall conform to all applicable laws and regulations
  and you shall not violate the rights of any third parties"; section 10, "The content of County websites
  is copyrighted and may contain some third party content that is used with permission of the third
  party. Users are notified, therefore, that one should presume the need to obtain permission from the
  copyright holder before reproducing or otherwise using images/graphics from this website." Nothing in
  the terms grants a license to the datasets, and nothing forbids automated access or AI use.
- **License.** None: the portal's license field is empty on all four datasets (`"license": null` in the
  view metadata; the catalog shows "See Terms of Use" only on other departments' datasets). Some archived
  Assessor datasets from 2022 carry "Creative Commons 1.0 Universal (Public Domain Dedication)" or
  "Public Domain", which shows the office has used CC0 before, but the current datasets do not. The data
  is public record under the Illinois Freedom of Information Act (5 ILCS 140) and the assessment books are
  public under the Property Tax Code (35 ILCS 200/9-20 and 9-25); facts are not copyrightable. Whether that
  is enough against section 10 of the website terms is the founder's call.
- **AI use:** not addressed. **Redistribution:** not addressed; public record.
- **Platform terms.** The portal HTML embeds Socrata's 2011 "Customer Terms of Use", which bind the
  government customer, not readers. Tyler's platform terms were not reviewed (same open item as the Texas
  Comptroller source, backlog A11).
- **robots.txt** (`datacatalog.cookcountyil.gov/robots.txt`): `User-agent: *`, `Crawl-delay: 1`, and
  `Disallow` for `/browse?…&q=`, `…&category=` and similar search and facet pages, `/OData.svc/`,
  `/api/odata/`, `/tiles/`, `/login`. The `/api/views/<id>.json` metadata pages and `/resource/<id>.csv`
  are allowed. The collector's 2-second interval exceeds the crawl delay. `www.cookcountyil.gov/robots.txt`
  disallows only `/web.config` and `/admin/`; the terms page was read once.

## What the files contain

Layout confirmed on the 2026-11-02 downloads. All four are header-row, quoted CSV, UTF-8, LF line
endings, one row per record; money and areas are decimals with one place (`345709.0`); PINs are
14-digit strings (zero-padded in the CSV, but tools that parse them as numbers lose leading zeros, so
the adapter re-pads).

- **Parcel Universe (Current)** `pabr-t5kh.csv`: `pin`, `pin10`, `year` (2026), `class`, `triad_name`,
  `township_code`, `township_name`, `nbhd_code`, `zip_code`. The full dataset has about 130 columns
  (`tax_code`, `lon`/`lat`, census geographies, taxing districts, flood and noise data); only these are
  archived. The adapter keeps every PIN whose class is in scope.
- **Assessed Values** `uzyt-m557.csv`: the dataset has `pin`, `year`, `class`, `township_code`,
  `township_name`, `nbhd`, then `mailed_`, `certified_`, `board_` × `bldg`, `land`, `tot`, `hie`
  (home-improvement exemption), and `row_id`; the archive keeps `pin`, `year`, `class`, `township_code`
  and the three `_tot` columns. The custom metadata says "Values are assessed, not market." Stages: _mailed_ is the
  Assessor's first notice, _certified_ follows the Assessor's appeals, _board_ follows the Board of
  Review. On 2026-11-02 tax year 2026 had 1,823,397 mailed, 787,990 certified and 0 board values
  (2025 is complete at all three stages). The adapter records the most final stage published
  (board, else certified, else mailed) in `appraised_value` and leaves `market_value` empty: by the Cook
  County Code of Ordinances (sec. 74-64) class 3, 4, 9 and the incentive classes are assessed at 10% of
  market value and class 5 at 25%, so a consumer can derive an estimate, but the publisher does not
  state one here. The Commercial Valuation Data's `finalmarketvalue` exists only for a township's
  reassessment year and was not used.
- **Parcel Addresses** `3723-97qp.csv`: `pin`, `pin10`, `year`, `prop_address_full`,
  `prop_address_city_name`, `prop_address_state`, `prop_address_zipcode_1`, `mail_address_name`,
  `mail_address_full`, `mail_address_city_name`, `mail_address_state`, `mail_address_zipcode_1`,
  `owner_address_name`, `owner_address_full`, `owner_address_city_name`, `owner_address_state`,
  `owner_address_zipcode_1`, `row_id` (all archived, for the sampled PIN areas). For 2026: 1,864,469 rows, 1,859,757 with a situs, 1,864,330 with
  an owner name, 1,761,664 with a taxpayer mailing name. The dataset description says owner name and
  address "is, to our knowledge, only intermittently updated in the ias source data"; names are
  truncated to about 22 characters (`CHICAGO TITLE LAND TRU`). The adapter takes the owner of record
  (`owner_address_*`), not the taxpayer, and treats `UNKNOWN`, `CURRENT OWNER`, `OWNER OF RECORD`,
  `TAXPAYER OF`, `TAXPAYER`, `OCCUPANT` as placeholders. There is no confidentiality flag; Illinois has no
  equivalent of Texas Tax Code §25.025 in this file, so `owner_confidential` is always false.
- **Commercial Valuation Data** `csik-bsws.csv`: `keypin`, `pins` (`01-01-100-084-0000`, several
  comma-separated for a multi-parcel property), `year` (the reassessment year: 2021 and 2024 City of
  Chicago, 2022 and 2025 south suburbs, 2023 north suburbs), `township`, `class_es` (`5-17`, several for
  mixed properties), `address`, `property_type_use`, `bldgsf`, `gross_building_area`, `landsf`,
  `yearbuilt`. The adapter attaches `landsf`, `bldgsf` (else `gross_building_area`) and `yearbuilt` to a
  PIN only from single-PIN rows (a multi-PIN row describes the whole property), newest year first; zeros
  and blanks are not figures.

### Class codes

Source: the Assessor's class code list, `classcode.pdf`
(<https://prodassets.cookcountyassessoril.gov/s3fs-public/form_documents/classcode.pdf>, linked from
the datasets' descriptions) and its machine-readable copy `ccao.class_dict.csv` in the office's
`ccao-data/data-architecture` repository (`dbt/seeds/ccao/`), which gives each code's major class and
description (253 codes). The Parcel Universe writes the code without a hyphen (`517`); the valuation
workbooks write `5-17`. `local_use_code` keeps the universe's form.

| Major class (publisher)                                  | Codes                                                                                          | FactLot |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------- |
| 1 Vacant                                                 | 100, 190                                                                                       | –       |
| 2 Residential (six units or fewer)                       | 200–299, OA2                                                                                   | –       |
| 3 Multi-Family (seven units or more)                     | 300, 301, 313, 314, 315, 318, 390, 391, 396, 397, 399                                          | B       |
| 4 Not For Profit                                         | 400–499                                                                                        | –       |
| 5A Commercial                                            | 500, 501, 516, 517, 522, 523, 526–533, 535, 590, 591, 592, 597, 599; OA5 (omitted assessment)  | F1      |
| 5B Industrial                                            | 550, 580, 581, 583, 587, 589, 593                                                              | F2      |
| 6A/6B Industrial Incentive, 6C Industrial Brownfield     | 637–693 (with A/B suffixes)                                                                    | F2      |
| 7A/7B Commercial Incentive                               | 700–799 (with A/B suffixes)                                                                    | F1      |
| 8 Commercial/Industrial Incentive, industrial codes      | 850 industrial incentive land, 880, 881, 883, 887, 889, 890, 893 (with suffixes)               | F2      |
| 8 Commercial/Industrial Incentive, commercial codes      | 800, 801, 816–835, 891 office, 892, 897, 899 commercial/industrial condominium (with suffixes) | F1      |
| 9 Class 3 Multi-Family Residential Real Estate Incentive | 900, 901, 913, 914, 915, 918, 959, 990, 991, 996, 997                                          | B       |
| EX Exempt, RR Railroad                                   |                                                                                                | –       |

Counts in the 2026 Parcel Universe by first character of class: 1: 61,252; 2: 1,587,697; 3: 19,851;
4: 500; 5: 91,172; 6: 2,308; 7: 362; 8: 1,906; 9: 896; E: 93,478; R: 5,047. The archived universe is
therefore 116,495 PINs. Class 2 includes 2-11 and 2-12 (two- to six-unit apartment buildings), which
the brief leaves out of scope.

## Gates (anything that needs a person)

- **License decision.** No open-data license is attached to the datasets, and the County website terms
  (section 10) claim copyright over site content. Options: treat public record status as sufficient
  (as for the Texas CADs) or ask the Assessor's Data Department for a license statement (the office has
  published under CC0 before). Until then `verified: false`, and the collector only archives this source
  with `--include-unverified`, which is how the real run below was made.
- Tyler/Socrata platform terms: same open item as the Texas Comptroller source (backlog A11).
- No account, login, click-through, CAPTCHA, fee or records request is needed for the downloads.

## Real run

The full collector run was **not completed**: it was started on 2026-11-03 01:30 UTC over a shared
connection saturated by other collectors; the universe fetch (file 1) ended after 12 minutes with
"The read operation timed out" (the manifest records it), and the coordinator took over the download.
`collected/il-cook-assessor/manifest.jsonl` holds that attempt; re-run
`python -m factlot.collector snapshot --config registry/sources/il/il-cook-assessor.json --out collected --include-unverified`
on a free connection (expect about 5 min for the universe, 5 min for the values, 10 min for the
commercial valuation file and 6 min for the address sample at the rates measured).

**Sample run (real files, fetched by hand during the review, not by the collector):** three CSVs from
the same `/resource` endpoints, truncated by a 20–40 s time limit, so each is the first rows the
portal streamed:

- `pabr-t5kh-sample.csv` — `$select=pin,class,township_code&$where=starts_with(class,'5')`: 90,073 class-5
  PINs (2.5 MB; `fl:document:sha256-6d7eec0240a39acdda22d07fdaa0a654e5ab16110df1572eb5301d3bf0623821`).
  No `year`, so no `tax_year` facts.
- `3723-97qp-sample.csv` — 2026 address rows for the first 300 of those PINs (`pin in (…)`;
  `fl:document:sha256-cb44f453ef844e134a24bc4c4e9862bb29a68ded94bc5166e64191a9170df82f`).
- `csik-bsws-sample.csv` — the first 3,815 Commercial Valuation rows
  (`fl:document:sha256-ca54366b110380a8bdc3ff05473528da1b31a2a625bfe3c77f80893a2a1b0fa6`).
- No Assessed Values file, so no `appraised_value` facts.

`python -m factlot.registry.adapters.il_cook <sample dir> sample.db --as-of 2026-11-02 --partial`:
90,073 rows read, 90,073 kept (66,626 F1, 23,447 F2; no class 3 in this sample), 0 invalid,
277,997 facts, 298 situs addresses, 77 organisation owners of record, 211 owners that were persons,
placeholders or names without an entity token (the 22-character truncation cuts off `LLC` and `INC`
on long names, so these are undercounted), 2,503 year-built, 2,480 building-area and 2,343 land-area
facts from single-PIN valuation rows, in 8.9 s. The registry's facts cite the universe sample's
document id; the sample registry is in the review scratchpad, not in the repo.

## Known gaps

- **No market value.** Cook County publishes assessed values (10% or 25% of market by ordinance); the
  registry stores them in `appraised_value` and leaves `market_value` empty.
- **Tax year 2026 is in progress**: on 2026-11-02 about 41,000 of the 1.86 M parcels had no 2026 value
  at any stage (none in the scope counts above are affected differently), and no Board of Review values
  exist yet. Re-run after each bi-weekly refresh; the year in the URLs must be advanced each tax year.
- **Area and year built only for parcels in the Commercial Valuation Data**: single-PIN rows of the
  2021–2025 workbooks (reassessed townships), so vacant land, condominium units, many class 3 buildings,
  and multi-PIN properties have none. The Assessor publishes no building-characteristics dataset for
  classes 3 and 5.
- **Owner names are truncated** to about 22 characters by iasWorld and "only intermittently updated"
  (publisher's note), so entity matching will under-link; the taxpayer mailing name (`mail_address_name`)
  is a second signal the adapter does not store. Parcel Sales (`wvhk-k5uv`) carries full buyer names and
  could be a later source for owner refreshes.
- **PIN granularity.** Condominium units are separate PINs (class 599 commercial condominium, 399 rental
  condominium); a building is not one record.
- The Parcel Universe and Parcel Addresses are joined on PIN for the same year; the Commercial Valuation
  Data is joined on PIN across years (characteristics are slow-changing, but a demolished or rebuilt
  property keeps its last workbook figures until the township is reassessed).
