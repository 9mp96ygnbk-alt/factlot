# pa-philadelphia-opa: Philadelphia Office of Property Assessment, "Properties"

Review record (data policy §5) for the City of Philadelphia's property assessment roll, published
on OpenDataPhilly. Philadelphia County, Pennsylvania (FIPS 42101). The machine-readable copy is
[`registry/sources/pa/pa-philadelphia-opa.json`](../../../registry/sources/pa/pa-philadelphia-opa.json);
the adapter is `python/src/factlot/registry/adapters/pa_philadelphia.py`; the account system is
`opa_account`.

**Status (reviewed 2026-11-02): `verified: false`.** The download is open (no account, login,
click-through, CAPTCHA, or fee) and the file was archived and loaded in a real run, but the City's
license reserves all rights in the database and states no redistribution right, so a person must
decide whether the registry may publish facts from it (see Gates).

## Publisher and URLs

- Publisher: City of Philadelphia, Office of Property Assessment (OPA), published by the City's
  Open Data Program (CityGeo) on OpenDataPhilly. Maintainer `maps@phila.gov`, data contact
  `opadata@phila.gov`.
- Dataset page (landing page): <https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/>
  ("Philadelphia Properties and Assessment History"). The catalog is a static site whose source
  is <https://github.com/opendataphilly/opendataphilly-jkan>.
- Confirmed bulk file (nightly rebuild):
  `https://opendata-downloads.s3.amazonaws.com/opa_properties_public.csv` (294,096,188 bytes on
  2026-11-02, `Last-Modified: Mon, 02 Nov 2026 11:46:36 GMT`).
- Same table, other forms (not archived): `opa_properties_public.gdb.zip` on the same bucket; the
  Carto SQL API `https://phl.carto.com/api/v2/sql?q=SELECT * FROM opa_properties_public`
  (GeoJSON/CSV/JSON; used in this review only for small `GROUP BY` queries on the code columns);
  the API explorer <https://cityofphiladelphia.github.io/carto-api-explorer/#opa_properties_public>.
- Companion dataset on the same page: `assessments.csv` (assessment history by year, table
  `assessments`), not loaded.
- Field definitions: <https://metadata.phila.gov/#home/datasetdetails/5543865f20583086178c4ee5/representationdetails/55d624fdad35c7e854cb21a4/>
  (a JavaScript application that did not render to text for the collector; the code tables below
  were read from the data's own description columns).

## Terms, license, robots

- OpenDataPhilly lists the dataset's license as "City of Philadelphia License", which its catalog
  (`_data/licenses.yml`) points at the City's metadata-catalog FAQ
  <https://metadata.phila.gov/#help/help-faqs/what-are-the-terms-of-use/>. That page (read
  2026-11-02 in a browser) and the dataset page both carry the same text. Operative sentences:
  "Browsing City data on this site, on opendataphilly.org, or on any other repository that includes
  data belonging to the City of Philadelphia constitutes acceptance of the license, the City's terms
  of use and your agreement to be bound by them." and "The City of Philadelphia reserves all rights
  in the database and any data contained therein, and the end user's use of the data does not
  constitute a transfer of, nor does the end user receive, any title or interest in the database or
  any other City data." The rest is an as-is, no-warranty, hold-harmless clause. The license neither
  grants nor forbids redistribution, and does not mention AI use.
- OpenDataPhilly's own terms (<https://opendataphilly.org/about/>, "Terms"): the creator retains
  any copyright; the user agrees to the creator's terms; no endorsement by trademark or logo; no
  liability. Nothing there restricts redistribution either.
- Assessment records are public records in Pennsylvania (Right-to-Know Law, 65 P.S. §67.101 et
  seq.); the City publishes them for reuse under an open data program established by executive
  order in 2012 (<https://www.phila.gov/programs/open-data-program/>).
- robots.txt: `opendataphilly.org` is `User-agent: * / Disallow:` (everything allowed).
  `phl.carto.com` disallows `/api/` only for named search-engine bots (Googlebot, Slurp, Yandex,
  msnbot, baiduspider); the FactLot bot is unrestricted. `opendata-downloads.s3.amazonaws.com`
  answers 403 for `/robots.txt` (no rules; the collector treats a 4xx as "no rules").
  `metadata.phila.gov` has no robots.txt (404).
- `www.phila.gov/terms-of-use/` exists but rendered no readable terms text to the collector (the
  page body is script-driven); the metadata-catalog FAQ is the City's own pointer for data terms.

## What the file contains

One UTF-8 CSV, header row, 78 columns, one row per OPA account: 583,722 rows (the Carto table
reports the same count on 2026-11-02), about 294 MB. The last column, `shape`, is the parcel
point as EWKT (`SRID=2272;POINT(...)`) and is ignored; the Carto export of the same table has
`the_geom`/`cartodb_id` columns instead, and the adapter reads either because it goes by column
name. Key columns:

| Column                                                                                                             | Used as                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parcel_number`                                                                                                    | `apn`, `account` (`opa_account`)           | 9 digits with leading zeros (`011422800`). `pin` is the City's 10-digit property index number (not used).                                                                                                                                                                                                                                                                                                         |
| `category_code`, `category_code_description`                                                                       | `state_category`, `local_use_code`         | OPA's property category; table below.                                                                                                                                                                                                                                                                                                                                                                             |
| `building_code`, `building_code_description`                                                                       | refines `state_category`; `local_use_code` | OPA building type (`CA0` APTS 5-50 UNITS MASONRY). `building_code_new` / `_description_new` is a newer numeric scheme, filled only for some rows (not used).                                                                                                                                                                                                                                                      |
| `location`, `unit`, `zip_code`                                                                                     | `situs_address`                            | `location` is the street line (`1312-14 S JUNIPER ST`); city and state are constant (`PHILADELPHIA PA`). ZIP+4 is sometimes written without a hyphen; the adapter inserts it.                                                                                                                                                                                                                                     |
| `owner_1`                                                                                                          | `owner_name`                               | Owner of record. `owner_2` is a co-owner or a continuation line (`JULIA P ZAGAR REVOCABLE TRUST`) and is not carried. No confidentiality flag; no placeholder owner name observed (the most common `owner_1` values are agencies and companies).                                                                                                                                                                  |
| `mailing_care_of`, `mailing_address_1`, `mailing_address_2`, `mailing_street`, `mailing_city_state`, `mailing_zip` | `owner_mailing_address`                    | Joined with commas in that order. `mailing_care_of` is a c/o line (a loan servicer or agent); `mailing_address_1` is an addressee line that usually repeats the owner's name (dropped then) or names the e-recording vendor (`SIMPLIFILE LC E-RECORDING`, kept as published); `mailing_address_2` was empty in the rows profiled. `mailing_zip` carries ZIP+4 with or without the hyphen; the adapter inserts it. |
| `market_value`                                                                                                     | `market_value`                             | The certified market value. `market_value_date` is empty on every row and the file names no tax year, so `tax_year` is left empty; `assessment_date` (a timestamp, e.g. 2026-04-29) is the date the value was set.                                                                                                                                                                                                |
| `total_area`                                                                                                       | `land_area_sf`                             | Land, square feet; 0 means no figure.                                                                                                                                                                                                                                                                                                                                                                             |
| `total_livable_area`                                                                                               | `improvement_area_sf`                      | Building, square feet; 0 means no figure.                                                                                                                                                                                                                                                                                                                                                                         |
| `year_built`, `year_built_estimate`                                                                                | `year_built`                               | `0000` means unknown; `year_built_estimate = Y` marks OPA's estimate (kept, flag not carried).                                                                                                                                                                                                                                                                                                                    |
| `exempt_building`, `exempt_land`, `taxable_*`, `sale_date`, `sale_price`, `zoning`, condition and room counts      | not used                                   | Sale prices are published (Pennsylvania records deed consideration) but the registry does not load them yet.                                                                                                                                                                                                                                                                                                      |

### Category codes (publisher's `category_code_description`, with row counts on 2026-11-02)

| OPA code | Description                   | Rows    | FactLot category                                    |
| -------- | ----------------------------- | ------- | --------------------------------------------------- |
| 1        | SINGLE FAMILY                 | 463,031 | out of scope                                        |
| 2        | MULTI FAMILY                  | 41,466  | **B**                                               |
| 3        | MIXED USE                     | 14,149  | **F1** (refined by building code)                   |
| 4        | COMMERCIAL                    | 12,503  | **F1** (refined by building code)                   |
| 5        | INDUSTRIAL                    | 3,834   | **F2**                                              |
| 6        | VACANT LAND                   | 39,575  | out of scope                                        |
| 7        | GARAGE - COMMERCIAL           | 130     | **F1** (refined)                                    |
| 8        | GARAGE - RESIDENTIAL          | 1,158   | out of scope                                        |
| 9        | HOTEL                         | 109     | **F1** (refined)                                    |
| 10       | OFFICES                       | 909     | **F1** (refined)                                    |
| 11       | SPECIAL PURPOSE               | 102     | out of scope (parks, playgrounds, clubs, utilities) |
| 12       | VACANT LAND - NON-RESIDENTIAL | 208     | out of scope                                        |
| 13       | VACANT LAND - RESIDENTIAL     | 2,332   | out of scope                                        |
| 14       | APARTMENTS > 4 UNITS          | 4,111   | **B**                                               |
| 15       | RETAIL                        | 75      | **F1** (refined)                                    |
| 16       | (no description)              | 30      | out of scope (unlabelled)                           |

Mapping rules (`pa_philadelphia.state_category`):

- The category code sets the FactLot category. OPA's category 2 MULTI FAMILY covers 2-4 unit
  buildings (`W30` APT 2-4 UNITS, `U50` ROW CONV/APT) as well as apartment houses; it is the
  publisher's multifamily class and maps to B whole, as Texas category B does.
- Within the commercial categories (3, 4, 7, 9, 10, 15) the building code refines the result:
  an industrial building type (`L` followed by a letter: `LA0` IND LOFT, `LB0` IND. LGHT MFG,
  `LC0` IND WAREHOUSE, `LD0` IND SHOP, `LE0` IND FACTORY, `LJ0` IND TRUCK TERM, `LR0` COLD
  STORAGE WHSE, `LU0` IND BLDG MINI WHSE, ...; and `7` / `7C1` INDUS CONDO) gives F2; an
  apartment-house type (`CA0` APTS 5-50 UNITS, `CB0` APTS 51-100 UNITS, `CC0` APTS 100+ UNITS)
  gives B. Office/store rows coded `L30`-`L58` (S/D OFF/STR, a digit second) stay F1.
- Categories 2, 14 and 5 are taken as published (a few rows carry other building codes).
- Vacant land is out of scope, as Texas C1 is, even where the building code says VACANT LAND
  COMMER (`SC`/`SD`) or INDUST (`SI`/`SJ`): 2,734 + 116 commercial and 1,337 + 357 industrial
  vacant lots in category 6 would come in if that decision changes (one line in `_CATEGORY`).
- `local_use_code` is `<category_code>/<building_code>` (`4/LC0`), or the category alone when the
  building code is blank.

## Gates (anything that needs a person)

- **License decision.** The City "reserves all rights in the database" and grants no explicit
  right to redistribute. The data policy requires a license that permits redistribution of the
  facts; public-record status argues for it, the rights reservation against. The founder should
  decide (or ask `opadata@phila.gov` / `maps@phila.gov`) before `verified` is set to true and the
  adapter's output is published. No account, login, click-through, CAPTCHA, fee, or records request
  stands in the way of the download itself; the terms are a browse-wrap notice.
- The field definitions on `metadata.phila.gov` are behind a JavaScript application; a person may
  want to read the data dictionary there to confirm the column notes above (the code tables here
  come from the data's own description columns, which is the publisher's text).

### Terms read 2026-11-03 (gates pass)

**Dataset page.** https://opendataphilly.org/datasets/philadelphia-properties-and-assessment-history/ — read 2026-11-03, HTTP 200. The page is titled "Philadelphia Properties and Assessment History". The saved HTML links https://opendata-downloads.s3.amazonaws.com/opa_properties_public.csv.

**City terms.** https://metadata.phila.gov/#help/help-faqs/what-are-the-terms-of-use/ — read 2026-11-02.

> Browsing City data on this site, on opendataphilly.org, or on any other repository that

> The City of Philadelphia reserves all rights in the database and any data contained therein,

> receive, any title or interest in the database or any other City data.

The same capture says browsing constitutes acceptance of the license. The sentences grant no redistribution right.

**OpenDataPhilly terms.** https://opendataphilly.org/about/ — read 2026-11-03, HTTP 200.

> The creator of the data sets, applications, and APIs retain any copyright or intellectual property restrictions they have placed on the data sets, applications, or APIs.

> By using data linked to on OpenDataPhilly, the user also agrees to any additional terms of use or conditions defined by the organization or individual who created the data set, application, or API.

**Office address.** Working notes, read 2026-11-02, https://www.phila.gov/departments/office-of-property-assessment/: "601 Walnut St., Suite 300 W., Philadelphia, PA 19106" and opadata@phila.gov. City Open Records Policy, https://www.phila.gov/open-records-policy/ — read 2026-11-03, HTTP 200. The Office of Property Assessment block lists "601 Walnut St, Ste 300 West, Philadelphia, PA 19106" and "RighttoKnowOPA@phila.gov". The Law Department Open Records Officer block lists "1515 Arch St., 15th Fl, Philadelphia, PA 19102" and "RightToKnowLaw@phila.gov".

**Statute.** Right-to-Know Law, Act 3 of 2008, https://www.legis.state.pa.us/WU01/LI/LI/US/PDF/2008/0/0003..PDF — fetched 2026-11-02; this lane read the text already saved with the repository and did not re-fetch it. Section 302(b) in that text:

> A local agency may not deny a requester

> access to a public record due to the intended use of the public

> record by the requester unless otherwise provided by law.

Section 703 in the working notes (read 2026-11-02): "A written request need not include any explanation of the requester's reason for" and "requesting or intended use of the records unless otherwise required by law." Section 701(a) in the notes: "record shall be accessible for inspection and duplication in accordance with this act. A record". Section 1308(2) in the saved text: "A requirement to disclose the purpose or motive in". The notes state: "Nothing in the act restricts commercial use or redistribution of records obtained under it."

The City terms reserve all rights in the database and do not grant redistribution. The sections of the Right-to-Know Law read here are silent on redistribution after the record is obtained, and section 302(b) says a local agency may not deny access because of intended use unless another law says so. Leave `verified` false. The founder signs and sends `pa-philadelphia-opa-letter.md`. This lane did not send it.

## Real run

Run of 2026-11-02 (23:36-01:58 UTC) on the real data, archived with the collector
(`python -m factlot.collector snapshot --include-unverified`, manifest in
`collected/pa-philadelphia-opa/manifest.jsonl`). The shared connection reached the S3 bucket at about
50 KB/s and the Carto API at about 25 KB/s, so the 294 MB full file (over 90 minutes) was not
downloaded; instead the in-scope rows were archived as a **sample equal to the full commercial scope**:
one Carto CSV export per in-scope `category_code`, with the three large categories paged in 3,000-row
chunks (`ORDER BY parcel_number LIMIT 3000 OFFSET n`) because Carto stalled or answered
`query_wait_timeout` (HTTP 400) on exports above about 3 MB. 30 files, 36,018,693 bytes, 77,286 rows,
which is exactly the sum of the Carto row counts for categories 2, 3, 4, 5, 7, 9, 10, 14 and 15. The
manifest also records the 9 failed attempts (one read timeout, eight HTTP 400). Each file was ingested
with `build(..., full_roll=False)` into one registry file (`python3 -I` on the scratchpad script).

| Count                                                    | Value                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Rows read (adapter, all 30 files)                        | 77,286                                                                                                                               |
| Parcels kept                                             | 77,286 (B 45,597; F1 27,586; F2 4,103); 0 out of scope (the sample is the in-scope subset), 0 invalid                                |
| By OPA category                                          | 2: 41,466; 3: 14,149; 4: 12,503; 5: 3,834; 7: 130; 9: 109; 10: 909; 14: 4,111; 15: 75                                                |
| Building-code refinements                                | category 4: 193 to F2, 15 to B; 3: 38 to F2, 4 to B; 10: 22 to F2, 1 to B; 15: 11 to F2; 7: 5 to F2                                  |
| Owner present / blank                                    | 77,282 / 4                                                                                                                           |
| Owners that are persons (not stored)                     | 50,079                                                                                                                               |
| Organisation owners stored (`ownership.owner_of_record`) | 27,203 (27,188 with a mailing address)                                                                                               |
| Facts written                                            | 670,006 (apn, situs, category, local_use_code, market_value: 77,286 each; land area 76,454; building area 76,709; year built 76,022) |
| Seconds                                                  | read 1.5 s; ingest 23.0 s (30 files)                                                                                                 |

Snapshot documents (one per archived file):

| File                                | Rows  | Document id                                                                           |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------- |
| `opa_properties_public_cat10.csv`   | 909   | `fl:document:sha256-b33304a5518b5c672e0374438cafe320fb662c0d470c9debce70bbe3c36fba67` |
| `opa_properties_public_cat14.csv`   | 4,111 | `fl:document:sha256-cf4b2354da8052af9916a8340d8ec1649a5c52d165903356cbe1c2fdb81471af` |
| `opa_properties_public_cat15.csv`   | 75    | `fl:document:sha256-99997769003f0bb0fe335bb00024f80de91985f37fc700b6db5bdb3e90a864b2` |
| `opa_properties_public_cat2_00.csv` | 3,000 | `fl:document:sha256-3a0d60fd3fa3367ffcb6045550e9a3f700b57bddf66630c9e0facfa5b9dd7305` |
| `opa_properties_public_cat2_01.csv` | 3,000 | `fl:document:sha256-6a7b9e4d2b6df1680a34ef34286f960267e71c52ddc9de2d444a8fd6c8e422f7` |
| `opa_properties_public_cat2_02.csv` | 3,000 | `fl:document:sha256-c6b3e1949fa1eac053ff7fe8461b4a5168ff6b002d75076ce0c8f55e0e203e19` |
| `opa_properties_public_cat2_03.csv` | 3,000 | `fl:document:sha256-0d56b0e852d5dd6312b753e57e2c703c05793852841db55d7b26c2a0b36caaf0` |
| `opa_properties_public_cat2_04.csv` | 3,000 | `fl:document:sha256-a268775fed28c0718e6386fecd839bd98f9b5ff56dcb428c8d16d00349aaed4b` |
| `opa_properties_public_cat2_05.csv` | 3,000 | `fl:document:sha256-3edfdd4731a5c4cabb308de36276f7b0bca5b06c5d89bf92332585f84603dcc4` |
| `opa_properties_public_cat2_06.csv` | 3,000 | `fl:document:sha256-565cd5016c1e371dc3bac2d106155595da9480ff4ce9464f5c67ea675297b45d` |
| `opa_properties_public_cat2_07.csv` | 3,000 | `fl:document:sha256-5e78dd985e9747e132b29c765bf3adb0368e4df8a3fa76850e33a318cc0a56d0` |
| `opa_properties_public_cat2_08.csv` | 3,000 | `fl:document:sha256-ca5f784e4c110eb9a649229e8271f6143ebe21b6fdd665bd1f26f9f2a6f5deb5` |
| `opa_properties_public_cat2_09.csv` | 3,000 | `fl:document:sha256-ef0fe68b91c081354e7066627da7e6db0a72630ce78955fe35bb1474f928a7e9` |
| `opa_properties_public_cat2_10.csv` | 3,000 | `fl:document:sha256-93f81e4b1881601278492458e02967f26ac22de490e8f307c7ddad703361f2fe` |
| `opa_properties_public_cat2_11.csv` | 3,000 | `fl:document:sha256-0e33a35479724895783e83e52783ec7f403e0555cb61f49169f077b14b53d78f` |
| `opa_properties_public_cat2_12.csv` | 3,000 | `fl:document:sha256-d498239da79b0edd13185bfc2992e7da69fed7cafb3396cf9e7e75aad0064e64` |
| `opa_properties_public_cat2_13.csv` | 2,466 | `fl:document:sha256-c1a1849506b64ad39f72d83cdc780d8309f3d56742058842a3114acf5d82db77` |
| `opa_properties_public_cat3_00.csv` | 3,000 | `fl:document:sha256-f548bba8f6a99a301e02b51b9b50b0e9ef436530f34d81ea626bfff72c39eb34` |
| `opa_properties_public_cat3_01.csv` | 3,000 | `fl:document:sha256-378cc04d6883e6e3a29d1d3b42d35b2a72893470e0f22849a4fd5a7485e8a514` |
| `opa_properties_public_cat3_02.csv` | 3,000 | `fl:document:sha256-0b301a3931d7eebe398fa8d1369b45edd81a588fafc7da936a42b1df4d4679a6` |
| `opa_properties_public_cat3_03.csv` | 3,000 | `fl:document:sha256-4489ce27ddbd9ef17e125e010c6c11835038d6c1c08a092e25002a6d5f1c9f2d` |
| `opa_properties_public_cat3_04.csv` | 2,149 | `fl:document:sha256-442c4c405d968516a854ff62eb1797e408450777616ae75db53f29303a4d9523` |
| `opa_properties_public_cat4_00.csv` | 3,000 | `fl:document:sha256-a4b6fdfba20630a2d03f6b15532d8050ba1e74e09aea480857ef48622e6b6a6a` |
| `opa_properties_public_cat4_01.csv` | 3,000 | `fl:document:sha256-fd09c27fbbc2c78126638b859632ca6ac560119bd6bad66bdc427a6bbd7c132b` |
| `opa_properties_public_cat4_02.csv` | 3,000 | `fl:document:sha256-28671f0951cf96901437fa06bc4a91a800c259a84841caf45891338be09fb541` |
| `opa_properties_public_cat4_03.csv` | 3,000 | `fl:document:sha256-6da50539a60fa10b1c121eda0a6186484ab11d2842b2c7f4ea487a6ab48f9037` |
| `opa_properties_public_cat4_04.csv` | 503   | `fl:document:sha256-b72b757fc4f0f9a3788879356410f6c72336f457190e5e9bee4da82f29815b4a` |
| `opa_properties_public_cat5.csv`    | 3,834 | `fl:document:sha256-de013cbb8ead625ca654cb2714626acf2b8397ab7e1523bada47a9154f70dcab` |
| `opa_properties_public_cat7.csv`    | 130   | `fl:document:sha256-a4ee2903288025b868091427330c2900270729f4d81a9954469d2f96a2ffca60` |
| `opa_properties_public_cat9.csv`    | 109   | `fl:document:sha256-12ac9c645b36e7010fcb75b2a639ebeddd553594c83d1b8b42d9c0857d07710c` |

The full-file run (`opa_properties_public.csv` from S3, `--as-of` its Last-Modified date) is still to
be done when the connection allows; the adapter and these counts apply unchanged, and the full file
adds the out-of-scope rows (expected 583,722 seen, about 77,300 kept).

## Known gaps

- No tax year in the file: `market_value_date` is empty on every row. The assessment history table
  (`assessments.csv`, columns `parcel_number`, `year`, `market_value`, `taxable_*`, `exempt_*`)
  would give values by year; not loaded.
- `owner_2` (co-owner or continuation line) is not carried; only `owner_1` is the owner of record.
- No confidentiality marker exists in the file, so `owner_confidential` is always false.
- Category 4 COMMERCIAL includes tax-exempt institutional buildings (houses of worship `W*0`,
  schools `V*0`, fire/police, libraries `Z*0`), which Texas CADs would code as category X. They are
  kept as F1 because that is the publisher's class; `exempt_building`/`exempt_land` identify them.
- Some rows in in-scope categories carry a vacant-land building code (`SR`, `SC`, `SI`: 1,025 in
  category 2, 311 in 14, about 60 in 4): the category is taken as published; `local_use_code`
  shows the conflict.
- `year_built` is kept even when `year_built_estimate = Y` (OPA's estimate, not a record).
- The S3 bucket serves the file without a content-type (`binary/octet-stream`) and rebuilds it
  nightly, so the collector's conditional request will re-download it on every run; archive weekly.
