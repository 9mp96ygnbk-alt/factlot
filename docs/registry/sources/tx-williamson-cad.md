# Williamson County, Texas: WCAD open data portal (`tx-williamson-cad`)

Review record for data policy §5. Reviewed 2026-11-03. **Verified**: public Socrata datasets, no
account or agreement; the platform's own terms were not read as text (same caveat as the
Comptroller portal, backlog A11). County FIPS 48491; account system `wcad_property_id` (WCAD's
integer property id). Config `registry/sources/tx/tx-williamson-cad.json`; adapter
`python/src/factlot/registry/adapters/tx_williamson.py`; tests
`python/tests/test_adapter_tx_williamson.py`.

## Publisher and URLs

- Publisher: Williamson Central Appraisal District (Georgetown, TX). WCAD's site (`wcad.org`, Maps &
  Records) says "GIS data is now available for download. Data types include tables and .SHP files",
  pointing to the open-data portal <https://data.wcad.org/> (Socrata, Tyler Technologies; 97 assets
  in the catalog on 2026-11-03: appraisal tables, owner and sale tables, building permits, GIS
  shapefiles, stories).
- Catalog: <https://api.us.socrata.com/api/catalog/v1?domains=data.wcad.org&limit=100>. Datasets
  used (`https://data.wcad.org/resource/<id>.csv?…`):
  - `2huh-jk3y` Improvement Real Property - Certified (updated 2026-11-01): 195,281 rows overall.
  - `absk-uy9g` PropOwner (updated 2026-11-02): 326,008 rows, 94 columns. WCAD's own description:
    "crs_wcad_propownerinfo table for CRR".
    Others catalogued and **not** used: Property Cama - Certified (`xrxg-afjm`, 131 columns, no
    state code), Property Characteristics (`cvyp-ab5t`, state code `fsptb` is filled for
    residential only: 3 `F1`), Final Values, Asmt, Land (`bens-i2m7`, `fstatecode` per land
    segment), Sale history, Owner (`bbia-wsxs`), Building Permits, the Parcels shapefile.
- Files (config): the improvement query `…/resource/2huh-jk3y.csv?$select=propertyid,fsptb,
fdescription,fimptype,vtsgimp_comtotbldarea,feffyear,vtsgimp_sequencenumber&$where=fsptb in
('F1','F2','B1','B2','B3','B4')&$order=propertyid,vtsgimp_sequencenumber&$limit=60000` and seven PropOwner
  pages `…/resource/absk-uy9g.csv?$select=<18 columns>&$order=:id&$limit=50000&$offset=<0..300000>`
  (about 330 bytes a row, 16 MB a page, 115 MB for the set: full loads are meant for GitHub's
  network).
- Archived by the collector: the improvement file, 844,813 bytes (Last-Modified 2026-11-01 14:39:45 GMT), document
  `fl:document:sha256-75d5ed79c6e9abb73887fcd9b3b9a0bdede0c86430f17e52ae741199891e392a`.
  For the sample, the full PropOwner set was **not** downloaded: instead 30 queries of 400
  `propertyid`s each (the 11,758 properties of the improvement file) were archived by the collector
  (`$where=propertyid in(…)`, 100–120 KB each, 3.5 MB in all), which gives the same rows as the
  full pages for the in-scope properties.

## Terms, license, robots

- Terms: none stated by WCAD for the data; no dataset has a license, attribution or category
  field (`licenseId` null on `absk-uy9g`). The portal footer links Terms of Service and Privacy
  Policy of Tyler Technologies (`tylertech.com/terms`, `/privacy`), which govern use of the website;
  they were not read as text. Public record under Tex. Gov't Code ch. 552.
- License: public record; none stated. AI use: not addressed. Redistribution: not addressed.
- robots.txt (`data.wcad.org`): `Crawl-delay: 1` (the collector's 2 s interval is longer); disallows
  `/browse?…&q=` style query strings, `/OData.svc/`, `/api/odata/`, `/login`, `/tiles/`; `/resource/`
  and `/api/views/` are allowed. `api.us.socrata.com` is the platform's shared catalog host.

## What the datasets contain

**Improvement Real Property - Certified**: one row per improvement (`propertyid`, `fsptb` the
state code of the improvement, `fimptype` `C`/`R`/`I`/`M`/`H`, `vtsgimp_comtotbldarea` the area in
square feet, `feffyear` effective year, `fdescription`). State codes (rows, 2026-11-03): `A1`
208,627, `A8` 12,176, **`F1` 10,591**, `E1` 5,492, `A2` 3,249, **`B2` 2,125**, `A5` 2,003, `O1` 1,975,
`XV` 1,810, `D2` 1,399, `E2` 796, **`B1` 753**, `A9` 714, `M1` 629, `A3` 578, `E3` 412, **`F2` 385**,
**`B4` 233**, `A7` 206, `E5` 136, **`F3` 61** and a tail. The requested codes (`F1`, `F2`, `B1`–`B4`)
return 14,087 rows for 11,758 properties. `F3` (61 rows) and `C5` are not requested and not mapped.

**PropOwner**: one row per property and owner. Columns used: `propertyid`, `tax_year` (2027 on the
rows read), `quickrefid` (`R…`), `propertynumber`, `situsaddress` (`11496 CHANDLER RD, TAYLOR, TX  76574`,
double space before the ZIP), `acres`, `propertytypecode` (`RES`, `COM`, `C1`–`C6`, `CA`, `L`, `LTR*`,
`M`, `N`, `BPP1`–`BPP9`; of 150 sampled in-scope properties 14% are typed `RES`, 2% `L`, so WCAD's
class does not decide scope), `totallandmktvalue`, `totalimpmktvalue`, `totalpropmktvalue`,
`totalassessedvalue`, `totalsqftlivingarea` (not used), `primaryowner` (1 primary, 0 other;
325,335 and 673 rows), `fullname`, `mailingaddress` (two lines), `issecured` (0 on all 326,008
rows), `dba`, `datadate`.

Category: the property's improvements decide it (F2 over F1 over B). Area is the sum of the
in-scope improvements' areas. No year built (`feffyear` is the effective year only). Appraised value
is `totalassessedvalue` (the appraised value after the Tax Code caps).

## Gates

- **Platform terms.** A person should read Tyler's terms for the Socrata portal and the WCAD open
  data page, and record the result (backlog A11). Nothing else gates the download.

## Real run

Collector `snapshot` (1 improvement file + 30 PropOwner queries, 31 archived, 4,342,014 bytes)
then `tx_williamson.build` into a scratch registry (about 3 s):

- Improvement rows 14,087; properties 11,758; PropOwner rows found for **11,699 properties**
  (59 in-scope properties have no PropOwner row, so no situs or owner is available for them: they
  may be accounts of owners with a §25.025 election, which the dataset appears to omit; not
  confirmed).
- **Parcels kept: 11,699**: F1 8,734, B 2,720 (`B2` 2,105, `B1` 389, `B4` 226 as the main local
  codes), F2 245. Local codes: `F1` 8,730, `B2` 2,105, `B1` 389, `F2` 228, `B4` 226, `F1,F2` 17,
  `B2,F1` 2, `B1,F1` 1.
- Owner names present on 11,699; situs on 11,699; building area on 11,168; confidential
  (`issecured`) 0. Facts written: 114,318. Owners that are organisations stored as owner of record: **8,151**; persons and
  withheld not stored: 3,548.

## Known gaps

- No year built. The commercial segment dataset (`wwak-u4ps`, `fActYear`) has it and could be
  joined later.
- Duplexes (`B2`) typed `RES` by WCAD are in scope because the state code decides; they need the
  full PropOwner pages, not a filter on property type.
- `F3` improvements (61 rows) are not read (WCAD reports them under F1, unconfirmed).
- A property with several owners is reported under its primary owner; ownership percentage is
  not read.
- PropOwner pages are not a complete roll for the adapter, so nothing is retired between loads.
