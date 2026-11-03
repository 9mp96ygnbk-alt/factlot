# Fort Bend County, Texas: FBCAD Orion appraisal export (`tx-fortbend-cad`)

Review record for data policy §5. Reviewed 2026-11-03. **Verified**, with one decision for a
person (the data-file indemnity clause; see Gates). The certified roll was read by ranged requests
because it is over the research limit of 50 MB; the supplement was archived whole by the
collector. County FIPS 48157; account system `fbcad_quickref` (FBCAD's `R`-number). Config
`registry/sources/tx/tx-fortbend-cad.json`; adapter
`python/src/factlot/registry/adapters/tx_fortbend.py`; tests `python/tests/test_adapter_tx_fortbend.py`.

## Publisher and URLs

- Publisher: Fort Bend Central Appraisal District (Richmond, TX).
- Landing page: <https://www.fbcad.org/certified-and-supplements-reports/> ("Prelim/Certified/
  Supplemental" under DATA; a WordPress page, read by the collector's `discover`: 156 links).
- Files in the config (`https://www.fbcad.org/wp-content/uploads/2026/…`):
  - `08/2026_07_07_1746-Orion-2026-Certified-Export-Redacted.zip` — 58,776,333 bytes, Last-Modified
    2026-08-21 (released 2026-07-07). **The complete certified roll.** Not archived whole here (over
    50 MB): its zip directory was read with a `Range` request and the property member (9,400,586
    bytes compressed, 92,125,102 bytes of text) and the first 9,000,000 compressed bytes of the
    owner member (50,252,161 bytes of text, cut at the last whole row) were fetched, 18.4 MB in all.
  - `10/2026_10_23_1427-Orion-2026-Supplement-4-Export-_Redacted.zip` — 1,959,232 bytes, Last-Modified
    2026-10-23 20:04 GMT, document
    `fl:document:sha256-b7b25d401181f67224f40d4f02c8b7c3c4cac488e7aebb55b577cbd8ebd17598`
    (archived by the collector). A supplement lists only the changed accounts.
- Listed on the page and **not** in the config: the October 2026 "Property Data Export"
  (`10/October2026-PropertyDataExport.zip`, 163,095,652 bytes) and `07/PropertyData-Post2026Cert-Redacted.zip`
  (162,617,179), whose layout was not read; the Residential Segments zip (67.8 MB) and Commercial
  Segments workbook (`10/WebsiteCommercialSegs-October.xlsx`, 20.2 MB), which hold building
  detail; certified mineral rolls (xlsx). Each month brings a new supplement file name, so re-run
  `discover`.
- Other routes: an ArcGIS Hub (`fbcad-open-data-hub-fortbend.hub.arcgis.com`) and GIS shapefile
  zips (`/gis-data/`), not read.

## Terms, license, robots

- Terms: the certified-and-supplements page states none. The only disclaimer is on the GIS data
  page, which refers to "the data files": they are provided only in certain formats and "as is"
  without warranty; "The user shall hold harmless, indemnify and defend the Fort Bend Central
  Appraisal District and their agents, officers, or employees from and against all losses, claims,
  demands, actions, payments or suits ... arising out of the request for or use of the data
  files". The same page quotes Tax Code §25.025 and says it is a Class B misdemeanor for a public
  entity to disclose the ownership or situs of a secured or confidential owner.
- License: public record (Tex. Gov't Code ch. 552); none stated. AI use: not addressed.
  Redistribution: not addressed; public record.
- robots.txt (`www.fbcad.org`): `User-agent: *`, `Disallow: /wp-admin/`, `Allow: /wp-admin/admin-ajax.php`;
  sitemap. The files sit under `/wp-content/uploads/`, which is allowed.

## What the files contain

Each zip holds a folder with six comma-delimited, double-quote-qualified text files (CRLF, UTF-8,
header row; the certified owner file starts with a byte-order mark and quotes every field), the
layout workbook `Orion Appraisal Export Layout.xlsx` (six sheets: Property, Owner, Exemption,
Entity, Mobile Home, Agent records, with field position, type and description) and a Grand Total
PDF (supplements). Certified roll member sizes (uncompressed): PropertyExport 92,125,102,
OwnerExport 131,743,369, EntityExport 645,950,862, ExemptionExport 18,410,616, MobileHomeExport
454,260, AgentExport 76,807. The export is the **redacted** one: the Owner layout's
`ConfidentialFlag`, `CAAgentID`, `ARBAgentID` and `EntityAgentID` columns are absent from the
header, and accounts of owners with a §25.025 election are not in it.

PropertyExport (24 columns, one row per property; 440,798 rows in the certified file: `R` real
387,745, `P` 29,834, `N` 14,979, `M` 4,512, `V` 3,728): `PropertyQuickRefID` (the account id,
first letter is the type), `PropertyNumber` (geographic id), `PropertyTypeCode` (real property: `RR`
286,414, `RX` 38,071, `RL` 33,089, `RD` 20,707, `RC` 8,011, `RM`, `RA`, `RI`, `RCT`, `RIT`),
`SitusStreetAddress`/`SitusCity`/`SitusState`/`SitusZip`, `Acres`, `StateCodeLand`, `StateCodeImp`
(the PTD codes of the first land segment and first improvement), `ChangeCode` (`A`/`M`/`D`; the
certified file has `M` 379,877 and `A` 7,868 on real property, supplement 4 has `D` on 704 of
4,837 rows), `TaxYear`, `SupplementNumber` (`CERT`, `SUPP 4`).
OwnerExport (43 columns, one row per owner): `OwnerName`, `OwnerAddress1–3`, `OwnerCity`,
`OwnerState`, `OwnerPostalCode`, `OwnershipPercentage`, and the owner's `ImpHSValue`, `ImpNHSValue`,
`LandHSValue`, `LandNHSValue`, `AgMktValue`, `AgUseValue`, `TimMktValue`, `TimUseValue`.

### State codes

`StateCodeImp` (else `StateCodeLand` when there is no improvement) is the account's code. Real
properties of the certified file by `StateCodeImp`: `A1` 278,816, none 82,414, `F1` 7,703, `A3`
4,455, `A2` 3,056, `M1` 1,823, `A4` 1,729, `XV` 1,645, `O` 1,279, `E1` 1,076, `D2` 812, `E2` 803,
`B2` 613, `F1H` 289, `B1` 233, `F2` 146, `F1M` 81, `B3` 61, `F1X` 12, `F1V` 1 and others. The
adapter maps `F1H`, `F1M`, `F1X`, `F1V` to F1 (the letter is FBCAD's own sub-class; its meaning was
not found) and keeps the district's code in `local_use_code`; `B1`–`B3` pass to the registry's B
rule; `F2` stays. Of the accounts with no improvement, 291 carry land code `F1` and 58 `F2`.

## Gates

- **The data-file indemnity clause.** The disclaimer asks the data-file user to hold harmless,
  indemnify and defend the district. It is a posted notice (no click-through, no account), but it
  is an undertaking by whoever uses the data. A person should decide whether FactLot accepts
  it. If not, set `verified` to `false` in the config and ask FBCAD under the Public Information Act.
- Nothing else gates the download.

## Real run

- Supplement 4, collector `snapshot` 2026-11-03 (1 file), `tx_fortbend.build(..., full_roll=False)`:
  4,837 property rows (`M` 4,129, `D` 704, `A` 4); **120 commercial parcels kept** (F1 112, B1 3, B2 3,
  F2 2), all with owner and values; facts 1,041; organisation owners 104; persons 16.
- Certified roll, property member whole and owner member prefix (the sample is a zip of the two
  extracts built in the scratchpad, `build(..., full_roll=False)`, 8.7 s): property rows read
  440,798; **9,698 commercial real properties**: F1 8,570 (`F1` 7,994, `F1H` 468, `F1M` 95, `F1X` 12,
  `F1V` 1), B 924 (`B2` 617, `B1` 245, `B3` 62), F2 204. Situs present 9,682. The owner prefix covers
  only the first third of the owner file (123,064 real-property owner rows of the file), so
  **owner names are present on 2,759 of the 9,698** (and values on 2,760); facts 61,894;
  organisation owners **2,060**; persons 699. The full file carries an owner row for every
  property; the parcel counts are the whole roll's and the owner counts are partial.
- The sample is not a collector snapshot (a ranged read), so no manifest document id exists for it.

## Known gaps

- No building area, year built or capped (appraised) value: the Orion export has none. The
  Commercial Segments workbook has building areas by segment and is not read.
- Land area only where `Acres` is filled (platted lots show none).
- `F1H`, `F1M`, `F1V`, `F1X` are mapped to F1 without the district's definition.
- 82,414 real properties have no improvement code and are classed by their land code; 8,011 are
  typed `RC` (commercial) by FBCAD, but the registry follows the state code.
- The "Property Data Export" zips (the October file is 163 MB) probably hold areas and values;
  their layout is unread.
