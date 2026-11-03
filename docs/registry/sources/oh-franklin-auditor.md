# oh-franklin-auditor: Franklin County, Ohio (Columbus; FIPS 39049) Auditor Parcel CSV

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/oh/oh-franklin-auditor.json`](../../../registry/sources/oh/oh-franklin-auditor.json).
Adapter: `factlot.registry.adapters.oh_franklin` (account system `franklin_parcel_id`, e.g. `010-000005`).

**Status: `verified: false`.** The Auditor offers free direct downloads of the full parcel file (owner names, class, land use, values), with no licence
or terms. The real run is on a ranged sample of the file, not the whole file (262 MB).

## Publisher and URLs

- Publisher: Franklin County Auditor's Office (373 S. High St., Columbus; Auditor `AuditorStinziano@franklincountyohio.gov`, 614-525-4663).
- Page: <https://auditor.franklincountyohio.gov/Auditor/FTP> ("Welcome to the FTP Direct Download"). Files: the open IIS directory
  <https://apps.franklincountyauditor.com/> with `Contour_Shapefiles`, `DXF_Files`, `GIS_Shapefiles` (Current_Extracts, updated weeknights), `Outside_User_Files`
  (2015-2026; monthly Appraisal and Tax Accounting sets) and `Parcel_CSV` (1997-2025 folders).
- File used: `https://apps.franklincountyauditor.com/Parcel_CSV/2025/07/Parcel.csv` (HEAD 200, `application/octet-stream`, 262,544,041 bytes, Last-Modified 2026-10-28,
  `accept-ranges: bytes`; the year/month folder is older than the file date). Larger sets not downloaded: 2026-10-15 Appraisal `Tab-Delimited.zip` 78,307,764 bytes,
  `Excel.zip` 253,820,469 bytes, `Parcel.xlsx` 44,455,136 bytes.
- Field documentation (read): <https://auditor.franklincountyohio.gov/files/assets/auditor/v/1/documents/parcel-csv-description-of-fields.pdf>; label-name workbooks for the
  Outside User Files on the same page. The Auditor's Open Data portal is <https://auditor-fca.opendata.arcgis.com> (not read).

## Terms, license, robots

- **Terms.** None stated for the downloads. The Auditor's Disclaimer page (<https://auditor.franklincountyohio.gov/Auditor/Disclaimer>) says materials "are provided 'as is' with no warranties of
  any kind" and disclaims liability; the footer reads "© 2026 Franklin County Auditor's Office". No click-through, account or fee sits in front of the directory. Records are public under Ohio R.C. 149.43.
- **robots.txt.** `auditor.franklincountyohio.gov`: a list of disallowed announcement pages only. `apps.franklincountyauditor.com`: none (404). The FTP page and the file are allowed.

## What the file contains

`Parcel.csv`: UTF-8 with BOM, 67 columns, fully quoted text, unquoted numbers, one row per parcel (all classes). Header: `PARCEL ID, AEXMLND, AEXMBLD, AEXMTOT, APPRLND, APPRBLD, APPRTOT,
AUDMAP, AUDRTG, LANDUSE, CAUV, SCHOOL, MAILAD1-4, TRANDT, TRANYR, NAME1-3, OWNER_ADD1-2, NBRHD, FLOOD, PCLASS, NOCARDS, ACREA, PRICE, ANN_TAX, STHNUM, STCONT, STHSFX, STDIRE,
STNAME, STSFX, STADDR, USPS_CITY, STATE, ZIPCODE, DESCR1-3, TAXDESI, VALID, AREA_A, DWELTYP, ROOMS, BATHS, HBATHS, BEDRMS, AIRCOND, CINBRHD, COND, FIREPLC, GRADE, HEIGHT, NOSTORY, YEARBLT,
PROPTYP, WALL, TIFMLND, TIFMBLD, POINT_X, POINT_Y, HOMSTD, BANKCODE`.

| `PCLASS` (Auditor) | Meaning                                                                                                                  | FactLot              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| C                  | Commercial; with `LANDUSE` 401, 402, 403 (Ohio Adm. Code 5703-25-10: apartments of 4-19, 20-39, 40 or more rental units) | F1; apartments **B** |
| I                  | Industrial                                                                                                               | F2                   |
| R, E, F, M, U      | Residential, exempt, agricultural, mineral, utility                                                                      | out of scope         |

Owner of record = `NAME1` (`NAME2`, `NAME3` co-owners and care-of are not used); `OWNER_ADD1`/`OWNER_ADD2` the owner's address; `MAILAD1-4` the tax-bill address, often a mortgage servicer
(`CORELOGIC`), not used. `APPRTOT` appraised value (taxable parcels), `AEXMTOT` (exempt); `ANN_TAX` is the taxable value despite its name; `AREA_A` primary area (sf); `ACREA` acres (0 when
unknown); `YEARBLT` a year, `OLD` or `E 99`. No confidentiality flag, no roll year.

## Gates

A person must decide whether free downloads published with no terms may be redistributed (see Terms), or ask the Auditor to confirm. Full loads need the whole 262 MB `Parcel.csv`, which runs later from GitHub's network.

## Real run

On the sample only (ranged request, first 3,000,001 bytes of `Parcel.csv`, cut at the last complete row: 2,999,743 bytes, sha256 `2d9b1c04…390ccc`, not archived by the collector, 5,719 rows, district 010 onward),
`oh_franklin.build(..., full_roll=False)` into a scratch registry (0.3 s):

- Rows read: 5,719; kept **1,268**: B 390, F1 768, F2 110 (PCLASS: R 4,019; C 1,158; E 421; I 110; blank 7; Z 4).
- Facts written: 8,664. Organisation owners: 1,001; natural persons or blank owners not stored: 267.

## Known gaps

- Only the first 3 MB (5.7 % of the rows) was read; counts are a sample, not the county.
- No roll year, no market value (appraised value only). The monthly Outside User Files hold sales, land, buildings and tax detail; not read.
- Whether the current file is 2025 or 2026 vintage: the folder says 2025/07 and the file date is 2026-10-28.
