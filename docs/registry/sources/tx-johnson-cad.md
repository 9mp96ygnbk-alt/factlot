# Johnson County, Texas: Johnson CAD certified data rolls (`tx-johnson-cad`)

Review record for data policy §5. Reviewed 2026-11-12. **Verified**: the roll files are public downloads on the
district's own site with no terms, click-through or login; a real run was made on the archived files. County FIPS
48251; account system `johnsoncad_account` (the district's account number, `R000000492`). Adapter
`python/src/factlot/registry/adapters/tx_johnson.py` (the 2025 and 2026 extracts are read by `tx_tab_extract.py`),
tests `python/tests/test_adapter_tx_johnson.py`. Config `registry/sources/tx/tx-johnson-cad.json`.

## Publisher and URLs

- Publisher: Central Appraisal District of Johnson County (Cleburne, TX).
- Landing page: <https://johnsoncad.com/downloads/> ("Downloads"), read on 2026-11-12 by the collector's
  identified client (`FactLotRegistryBot`, contact address in the user agent), one request every 3 s.
- Files used, all under `https://johnsoncad.com/wp-content/uploads/` (sizes and Last-Modified confirmed by HEAD on
  2026-11-12):
  - `2026/08/BATCH_896.all_.zip`: 45,043,599 bytes, Last-Modified 2026-08-10, listed as "2026 Certified Records",
    document `fl:document:sha256-9e35c2502d4c6b24fa0b803bf704771afe40b5247f4aebdea28a3a2e7140973b`. The current roll.
  - `2026/05/JCAD-2025-Certified-Data-2026-04-27.zip`: 42,105,479 bytes, Last-Modified 2026-05-07, listed as "JCAD
    2025 Certified Data", document
    `fl:document:sha256-caa5a90e4e2f6276a07a3f01691a7a6cd2223ea75ffa3ae7c32401b9f4a761bc`. Value history 2025.
  - `2025/06/2024-Certified-Data-Roll-1.zip`: 145,381,822 bytes, Last-Modified 2025-06-11, listed as "2024 Certified
    Records", document `fl:document:sha256-07a485a9cbe2b2f9799778be31d4c5e86f656a2cd05944434ed4cf4345da7e5d`. Value
    history 2024.
- Archived but not read: `2025/08/2025-Certified-Data-Roll.zip` (the earlier system's 2025 roll),
  `2025/06/2023-Certified-Data-Roll.zip`, `2026/05/2022-Certified-Data.zip`, `2026/05/2021-Certified-Data.zip`. Also on
  the page, not configured: preliminary, supplemental and business personal property files for 2021 to 2026, and a
  GIS shapefile.

## Terms, license, robots

- Terms: none on the roll files. The page describes each dataset ("The dataset includes property account information
  and values as certified by the Central Appraisal District of Johnson County in accordance with the Texas Property
  Tax Code") and states conditions only for the GIS shapefile ("Use of this data constitutes acceptance that the
  Central Appraisal District of Johnson County (JCAD) makes no warranty as to the accuracy or completeness of the
  data"), which is not used. No click-through, no login. The footer is a copyright line only. Public record under
  Tex. Gov't Code ch. 552.
- License: public record; none stated. AI use: not addressed by the publisher. Redistribution: not addressed;
  public record.
- robots.txt (`johnsoncad.com`, 2026-11-12): `User-agent: *`, `Disallow: /wp-admin/`,
  `Allow: /wp-admin/admin-ajax.php` and a sitemap line. No `Content-Signal` and no named crawler rules.

## What the files contain

The district moved to a new appraisal system in 2026. The 2026 certified roll and the 2025 re-export are the
tab-delimited `external*.tab` extract documented in `tx_tab_extract.py` (the same extract Bell CAD publishes, with
`ACCOUNT` as the key and two extra columns, `BUILDING PTD` and `LAND PTD`); only `externalnal.tab` and
`externalacreage.tab` are read. An account repeats once per building (111,072 rows for 108,508 accounts in 2026);
the first row is used and the earliest year built of the account's rows. `PARCEL USE CD` is the district's state
code, mapped with the district's own code names (its 2024 roll states them as `B2 - Real, Residential, Duplexes`,
`F1 - Real, Commercial`). `NBHD CD` is a map-area code (`126.0002`; 1,054 distinct values in scope), the value the
earlier rolls give as `CTM_NBHD_CDX`, written as `parcel.neighborhood_code`. No building class is read.

The 2024 roll is the earlier system's web extract; only `...WEBMAIN.CSV` is opened, and from it only
`APPRAISAL_YR`, `ACCOUNT_NUM`, `AAY_TOT_VAL` (market) and `AAY_APPR_VAL` (appraised). `ACCOUNT_NUM` equals the 2026
`ACCOUNT`.

## Real run (2026-11-12)

```
python -m factlot.registry.adapters.tx_johnson BATCH_896.all_.zip tx-johnson.db --as-of 2026-08-10 --tax-year 2026
python -m factlot.registry.adapters.tx_johnson JCAD-2025-Certified-Data-2026-04-27.zip tx-johnson.db --as-of 2026-04-27 --history-only 2025
python -m factlot.registry.adapters.tx_johnson 2024-Certified-Data-Roll-1.zip tx-johnson.db --as-of 2024-07-24 --history-only 2024
```

- 2026: kept **4,416** commercial parcels: B 1,109 (`B1` 212, `B2` 766, `B3` 27, `B4` 104), F1 2,869, F2 438.
  Facts written 52,836. Every parcel has market and appraised value and tax year 2026; situs 4,409, building
  (heated) area 4,113, year built 4,078, land area 3,882.
- Owners: 2,862 organisation owners of record stored (2,580 with a mailing address); 1,548 natural persons or
  withheld owners not stored. No owner reads `CONFIDENTIAL`.
- Value history: 2025 values for 4,355 parcels and 2024 values for 4,270 (sources `tx-johnson-cad-2025`,
  `tx-johnson-cad-2024`); 4,270 parcels carry all three years. Market values 2026 over 2025: median ratio 1.028,
  4,197 of 4,340 within a factor of three.
- Gates on the standalone file: `maintain --purge-persons` removed nothing; `privacy_scan` 0 person-owner facts and
  0 personal-style mailing addresses; `audit` 0 violations, one warning (the 2024 snapshot is older than a year, as
  history is).

## Known gaps

- The extract has no published layout; column meanings are read from the headers and checked against the 2024 roll
  (same accounts, codes, neighborhood codes and values).
- 2021 to 2023 are posted but not read: their CSV rolls (326 to 327 columns) do not split cleanly with a standard
  CSV reader, and the layout workbook in the 2023 zip has not been checked against them.
- A read of the site on 2026-11-07 recorded the district saying that online data during its 2026 system change
  "should be considered informational only"; the sentence was not on the downloads page on 2026-11-12.
- Owner links to the Comptroller's entities are made when the file is merged into the Texas registry file.
