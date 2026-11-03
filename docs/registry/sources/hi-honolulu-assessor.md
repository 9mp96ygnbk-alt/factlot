# hi-honolulu-assessor: City and County of Honolulu, Hawaii (FIPS 15003)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/hi/hi-honolulu-assessor.json`](../../../registry/sources/hi/hi-honolulu-assessor.json). **Gated on terms and on a missing class code; no
adapter.** Tier 2, west region ([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: City and County of Honolulu, Honolulu Land Information System (HoLIS, Department of Planning and Permitting). The assessment and ownership tables are
  "downloaded from BFS Real Property Assessment on a weekly schedule" (item text), i.e. the Department of Budget and Fiscal Services, Real Property Assessment
  Division, which is the assessor.
- Where it was found: the State of Hawaii's parcel metadata (Oahu parcels, `geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/11`) says the latest Oahu
  parcel layer with all City attributes is on the HoLIS open data site and that assessed value and ownership are "in tables available for download" there. The Hub the
  state names (`honolulu-ccnl.opendata.arcgis.com`) answers "Site does not exist"; the tables are live ArcGIS Online items owned by `honolulugis`.
- Tables: feature service `https://services.arcgis.com/tNJpAOha4mODLkXz/arcgis/rest/services/CadastralTables/FeatureServer` (item `ea6585c432404e80b6bd37cd3c9c1489`,
  modified 2025-11-26), layers: `5` OWNALL (588,562 rows), `6` OWNDAT, `7` OWNERTYPE, `8` OWNMLT, `9` ASMTGIS (325,559 rows), `10` ASMTPITT, `11` LEGDAT, `13` FACILITIES
  (205,295 rows), `14` SEPARATIONS. Tax parcel polygons: `.../Cadastral_2020/FeatureServer/1` (171,982 parcels; TMK, area, no owner or class).
  `maxRecordCount` 2000; formats JSON, GeoJSON, PBF.

## Terms, license, robots

- Item `licenseInfo` (OWNALL, 2025-08-29): "Information contained in these files is derived from public records that are constantly undergoing change. The City and County
  of Honolulu does not guarantee the positional or thematic accuracy of the data. These files and the features therein are not legal representations and do not replace a
  site survey. Any implied warranties ... shall be expressly excluded. ... Please report any discrepancies or errors to gis@honolulu.gov." A disclaimer only: no license, no
  redistribution or AI-use statement. Hawaii's public records law is HRS ch. 92F.
- robots.txt: the HoLIS Hub has none (site does not exist); `services.arcgis.com` none.

## What the file contains

- OWNALL (the `ownall` view of "all owners listed in the deed for the parcel"): `jur, tmk, suffix, parid, taxyr (2027), own1, own2, pctowned, owntype1-4, grpflag, ownseq, owntble,
ownfld, paddr1-3`. `parid` = TMK (8 digits) + suffix (4 digits), e.g. `910770810000`; `tmk` links to the parcel layer. Many `own1` values are natural persons
  (`ANTONIO-REYES,ANELA`) and trusts (`EDLIN-YAWATA,FAMILY TR`). Owner names are present, with the mailing address.
- ASMTGIS: `parid, tmk, suffix, seq, taxyr (2026 in every row), buildingvalue, buildingexemption, landvalue, landexemption, tnettaxval, taxratecode, ovrclass, pittsqft, pittacre`.
  **`taxratecode` and `ovrclass` are blank in all 325,559 rows**: the tables carry no tax class or use code.
- LEGDAT: `totacres`, `totsqft` (land area). FACILITIES (from the Department of Planning and Permitting, not the assessor): per building, `facilitycode` (a building type such
  as "04 - Apartment" 6,076, "31 - Retail" 4,049, "21 - Office" 1,396, "41 - Production/Storage/Distribution/Repair" 2,998, "11 - Hotel" 138, "01 - Single-Family Dwelling" 166,012),
  `yearbuilt`, `totfloorarea`, `dwellcount`, keyed by `poi` and `separationid`; it joins to a parcel through SEPARATIONS, which was not worked out.

## Gates

1. Terms: no license; a person must ask gis@honolulu.gov (the item's contact) and the Real Property Assessment Division whether the weekly tables may be redistributed.
2. Scope: without a class code the commercial parcels cannot be selected from the assessor tables. A person should ask the Real Property Assessment Division for its
   tax class (Residential, Hotel/Resort, Commercial, Industrial, ...) by TMK; or accept an approximation from FACILITIES building types joined through SEPARATIONS.

## Real run

None (gated). Layer metadata, a few sample rows and group-by statistics only.

## Known gaps

TMK condominium units (suffix 00xx) are separate accounts. The tables are 2026/2027 mixed (`taxyr` differs between OWNALL and ASMTGIS).
