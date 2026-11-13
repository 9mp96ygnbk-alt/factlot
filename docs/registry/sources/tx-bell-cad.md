# Bell County, Texas: Bell CAD certified exports (`tx-bell-cad`)

Review record for data policy §5. Reviewed 2026-11-12. **Verified**: the files are public downloads on the
district's own site with no terms, click-through or login; a real run was made on the archived files. County FIPS
48027; account system `bellcad_prop_id` (the district's property ID). Adapter
`python/src/factlot/registry/adapters/tx_bell.py` (2026 extract read by `tx_tab_extract.py`, earlier PACS rolls by
`tx_pacs34.py`), tests `python/tests/test_adapter_tx_bell.py`. Config `registry/sources/tx/tx-bell-cad.json`.

## Publisher and URLs

- Publisher: Tax Appraisal District of Bell County (Belton, TX; offices in Killeen and Temple).
- Landing page: <https://bellcad.org/data-portal/> ("Data Portal"), read on 2026-11-12 by the collector's
  identified client (`FactLotRegistryBot`, contact address in the user agent), one request every 3 s.
- Files used (sizes and Last-Modified confirmed by HEAD on 2026-11-12, unchanged from the collector's archive of
  2026-11-08), all under `https://bellcad.org/wp-content/uploads/`:
  - `2019/06/2026-Bell-County-Certified-Export-3.zip`: 161,166,338 bytes, Last-Modified 2026-10-01, document
    `fl:document:sha256-3ae115e731ac4e4ba03bc2217c38fbc58e820d8b8231ce9316085a0ba660a9ec`. Listed as "2026 Bell
    County Certified Export". The current roll.
  - `2025/07/2025-Bell-County-Certified-Export.7z`: 58,643,753 bytes, Last-Modified 2025-07-22, document
    `fl:document:sha256-487ebdbe225342adf2c12db8206e2629f516e1dc629a9277cebb75351338099e`. Value history 2025.
  - `2024/07/BellCAD-Certified-Appraisal-Export-2024.rar`: 59,851,955 bytes, Last-Modified 2024-07-23, document
    `fl:document:sha256-7418870a81394f38352446f4dd6a1de888458a00d21d9b0967b38bbb2515c65a`. Value history 2024.
  - `2026/02/Appraisal-Export-Layout-8.0.33.xlsx`: 96,688 bytes, the PACS layout, labelled on the page "Files
    Created Prior to 5/1/2026" and "After 5/1/2026, see file description".
- Also on the page, not used: the 2025 export as of supplement 60 (`.rar`, 74,153,878 bytes), the 2024 export as of
  supplement 52 (`.zip`, 134,810,798 bytes), condensed Excel rolls for 2024 to 2026 and the 2027 preliminary,
  the 2026 preliminary export, collections and delinquent rolls, a mortgage export and shapefiles. No roll before
  2024 is posted.

## Terms, license, robots

- Terms: none. The data portal states no terms of use, licence, disclaimer or condition on the files, has no
  click-through and needs no login; the page footer reads only "© 2026 Copyright Tax Appraisal District of Bell
  County - Official Site". Public record under Tex. Gov't Code ch. 552.
- License: public record; none stated. AI use: not addressed by the publisher. Redistribution: not addressed;
  public record.
- robots.txt (`bellcad.org`, 2026-11-12): `User-agent: *`, `Disallow: /wp-admin/`, `Allow: /wp-admin/admin-ajax.php`
  and a sitemap line. No `Content-Signal` and no named crawler rules.

## What the files contain

The district changed appraisal systems in 2026. The 2026 certified export is a zip of tab-delimited text files
(`external*.tab`, header row, Latin-1, no quoting) in a folder `2026 Bell County Certified Export/`, with no
published layout; the columns are documented in `tx_tab_extract.py` from the file itself. Only
`externalnal.tab` (167,084 rows, 108 columns, one row per account) and `externalacreage.tab` are read.
`externalowner.tab`, `externalsale.tab` (grantor and grantee), `externallegal.tab`, the exemption, date, building
and business personal property files are not opened. `PARCEL USE CD` holds the district's state code; the file has
no Comptroller (PTD) column, so the adapter maps the code with the district's own table as published in the 2025
certified PACS export (`APPRAISAL_STATE_CODE.TXT`). `NBHD CD` is a neighborhood code (378 distinct values in scope,
such as `RBA01MPNT`), written as `parcel.neighborhood_code`. There is no building-class column in that file.

The 2025 and 2024 exports are PACS exports (header "8.0.0.30", 9,247-character property records). For value history
only the account, year, market and appraised value of each account the 2026 roll holds are read; owners and
addresses are never read. The 2026 `PARCEL ID` is the PACS `prop_id`: 13,096 of the 13,685 commercial accounts of
2026 are commercial accounts of the 2025 roll too.

## Real run (2026-11-12)

```
python -m factlot.registry.adapters.tx_bell 2026-Bell-County-Certified-Export-3.zip tx-bell.db --as-of 2026-10-01 --tax-year 2026
python -m factlot.registry.adapters.tx_bell 2025-Bell-County-Certified-Export.7z tx-bell.db --as-of 2025-07-22 --history-only 2025
python -m factlot.registry.adapters.tx_bell BellCAD-Certified-Appraisal-Export-2024.rar tx-bell.db --as-of 2024-07-21 --history-only 2024
```

- 2026: 167,084 rows read; 19 rows with the wrong number of columns left out; 559 rows with a code the table does
  not list (exempt sub-codes, blank). Kept **13,685** commercial parcels: B 8,052 (`B1` 684, `B2` 7,368), F1 5,535
  (`F1` 5,529, `F3` 6), F2 98. Facts written 158,084. Every parcel has a situs address, neighborhood code, market
  and appraised value and tax year 2026; year built 13,400, building (heated) area 10,783, land area 10,686.
- Owners: 7,221 organisation owners of record stored (6,514 with a mailing address); 6,464 natural persons or
  withheld owners not stored. The one `CONFIDENTIAL OWNER` row in the file is not in the commercial scope.
- Value history: 2025 values for 13,573 parcels and 2024 values for 13,232 (sources `tx-bell-cad-2025`,
  `tx-bell-cad-2024`); 13,231 parcels carry all three years. Market values 2026 over 2025: median ratio 1.0, 13,275
  of 13,573 within a factor of three.
- Gates on the standalone file: `maintain --purge-persons` removed nothing (0 owner facts, 0 mailing facts);
  `privacy_scan` 0 person-owner facts and 0 personal-style mailing addresses; `audit` 0 violations, two warnings
  (the 2024 and 2025 snapshots are older than a year, as history is).

## Known gaps

- The 2026 extract has no published layout; column meanings are read from the headers and checked against the
  2025 PACS roll (same accounts, codes and labels). `BLDG HEAT AREA` is heated area, so an unheated warehouse or
  shell can carry no building area (2,902 parcels without one).
- No building class, and no situs ZIP, in the 2026 extract.
- Prior years before 2024 are not posted.
- Owner links to the Comptroller's entities are made when the file is merged into the Texas registry file, not in
  the standalone file.
