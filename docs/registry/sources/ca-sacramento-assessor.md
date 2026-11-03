# ca-sacramento-assessor — Sacramento County, California (FIPS 06067)

Review record for the Sacramento County GIS "Parcels" layer, which carries the Assessor's land-use class.
**Result: verified (open licence). Loaded for real: 20,053 commercial, industrial and multifamily parcels with
situs, county land-use class and lot size. The layer has no assessed values and no owner names.** Config:
`registry/sources/ca/ca-sacramento-assessor.json`. Adapter: `python/src/factlot/registry/adapters/ca_sacramento.py`
(account system `sacramento_apn`). Tests: `python/tests/test_adapter_ca_sacramento.py`. Reviewed 2026-11-03.

## Publisher and URLs

- Publisher: Sacramento County GIS (ArcGIS account `SCGISAdmin`), on the "Sacramento County GIS Open Data Site",
  https://data.saccounty.gov (ArcGIS Hub; not Socrata).
- Item `8d011b99aebc46d48060b2e5bdd7f4a0` "Parcels" (tags Sacramento County, Property, Parcels; access public;
  created 2017-09, modified 2026-11-01; 466 MB with geometry), feature layer
  `https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Parcels/FeatureServer/0` (Query and Extract,
  `maxRecordCount` 2000, **502,447 parcels**).
- Download: Hub API `https://data.saccounty.gov/api/download/v1/items/8d011b99aebc46d48060b2e5bdd7f4a0/csv?layers=0&where=<filter>`
  answers `302` to `https://services1.arcgis.com/.../Parcels/FeatureServer/replicafilescache/Parcels_<n>.csv`. The
  `where` clause is honoured (field names, not aliases). A filter not yet cached is built on request; the collector
  recorded it as `not_ready` and the second `snapshot` run fetched it. The unfiltered export was not requested (the
  item is 466 MB with geometry, far over this brief's 50 MB limit); three class filters are in `files` (below).
- Related county layers, same licence, not used: "Apartments" (`f57203d580a64429ade7428d22d4fadb`, 1,698 landmark
  polygons with a name and description), "Mobile Home Parks", "Zoning", "General Plan".
- The Assessor (https://assessor.saccounty.gov) publishes no bulk file but its fee schedule
  (https://assessor.saccounty.gov/us/en/fee-schedule.html, Board of Supervisors Resolution 23-0860, 2023-10-24)
  says: "To receive an electronic version of the Secured and/or Unsecured Assessment Roll at no charge please
  e-mail us at assessor@saccounty.gov"; CD copies cost $0.25; the "Change in Ownership - 2 Year Transfer List" is
  free; and "The general public has access to any data included on the Assessment Roll."

## Terms, license, robots

- Licence: the item's `licenseInfo` shows the CC0 badge image (`cc-zero.png`) and says "This work is licensed
  under a Creative Commons Public Domain Dedication License", linking to
  https://creativecommons.org/publicdomain/zero/1.0/ . The badge's outer link points at the CC-BY 4.0 page, and
  the Hub search record reports `license: CC-BY-4.0` for the same item (and for the county's other layers). Both
  CC0 and CC-BY permit copying, adaptation and redistribution, so the source is `verified: true`; the config
  gives attribution ("Sacramento County GIS, Parcels") anyway, which satisfies either reading.
- AI use: not addressed (neither licence restricts it). Redistribution: permitted. The item description is empty
  and carries no extra terms. The Assessor's fee-schedule disclaimer ("Assessor's data is compiled and intended
  for assessment purposes only ... provided 'as is'") applies to the Assessor's own products, not this layer.
- robots.txt: `data.saccounty.gov`: `User-agent: * / Crawl-delay: 60 / Disallow: /sites/ /admin/ /sessions/ /groups/
/people/ /workspace/`. The download API path is allowed; the collector honoured the 60-second delay (about 8
  minutes for two landing pages and three files plus a retry). `services1.arcgis.com` REST was queried for the
  layout and class counts only.

## What the file contains

One row per parcel (UTF-8 with BOM, CRLF, quoted fields), header of the publisher's field **aliases**:

`OBJECTID, APN, Lot Size, Neighborhood Code, Jurisdiction, Street Number, Street Name, City, Zip, Tax Rate Area,
Subdivision, Lot, Landuse, Landuse General, Landuse Specific, Landuse Detail, Landuse Use, Landuse Secondary Use,
Level, Type, Shape__Area, Shape__Length`

| Column(s)                                                                                | Use                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `APN` (14 digits `00100110010000`)                                                       | `apn`; `account` is `001-0011-001-0000`                                                                                        |
| `Landuse` (six characters, `CBB00E`)                                                     | `local_use_code`                                                                                                               |
| `Landuse General` / `Specific` / `Detail`                                                | the county's classification → category                                                                                         |
| `Landuse Use`                                                                            | "Most probable use" (472,324 parcels) or a status ("Economically ready for development", "Under improvement", ...); not mapped |
| `Street Number`, `Street Name` (unit text included), `City`, `Zip`                       | situs → `600 N 10TH ST, SACRAMENTO, CA 95811`                                                                                  |
| `Lot Size`                                                                               | square feet (median ratio to polygon area 1.00); 0 for condominium sub-parcels → no area                                       |
| `Type` (`LND` 483,647; `SUB` 16,136; `R` 1,352; `UCI` 866; `COM` 395; `TSP` 51), `Level` | parcel type; not mapped. `COM` and the common-area classes are excluded by class                                               |
| `Jurisdiction`, `Tax Rate Area`, `Neighborhood Code`, `Subdivision`, `Lot`, shape        | not mapped                                                                                                                     |

**No assessed values, no owner name or mailing address, no year built, no building area.**

### Class counts and mapping

Counts are `LU_GENERAL` totals for the whole layer (queried 2026-11-03): Residential 447,610; Vacant 19,089;
Miscellaneous 12,385; Retail / Commercial 6,825; Office 4,300; Industrial 4,879; Public / Utilities 1,639;
Agricultural 2,681; Care / Health 503; Church / Welfare 1,235; Recreational 422; blank 879. The publisher posts
no class table; the mapping is by the descriptive class text:

- **B**: Residential / `Low Rise Apartment` (3,542) and `High Rise Apartment` (122). The county files two-, three-
  and four-family parcels under their own classes (`Two Family`, `Three Family`, `Four Family`), so "Apartment"
  is read as five or more units; the county's own definition was not found (see Known gaps).
- **F1**: Retail / Commercial (all specifics except `Common Area`, `Nursery`, `Advertising`); Office (all except
  `Common Area`); Residential / `Hotel` (105), `Motel` (80), `Mobile Home Park` (164); Care / Health: `Acute Care
Hospital`, `Skilled Nursing Facility`, `Retirement Home`; Recreational: `Theater`, `Bowling`, `Skating`, `Golf
Course`, `Marina`, `Race Track`, `Sport Court / Field / Stadium`, and `Private Club` with detail `Health Spa`.
- **F2**: Industrial (all except `Common Area`, `Mining`, `Airport (Private)`, `Railroad Spur`).
- Out of scope: single-family, two- to four-family, mobile homes on lots, rooming and boarding houses, bed and
  breakfasts, residential care facilities, day nurseries, cemeteries, church and welfare, public and utilities,
  agricultural, vacant, miscellaneous, and every common-area class.

## Gates

None for loading: no account, agreement, fee or request is needed. Optional, for assessed values: a person e-mails
`assessor@saccounty.gov` for the free electronic secured roll (the Assessor's fee schedule offers it "at no
charge"; owner names would be in it and are only for natural-person screening, never stored). Not done.

## Real run (2026-11-03, collector run from this machine, archive in the session scratchpad, not committed)

Three class-filtered CSV exports archived by the collector (`python -m factlot.collector snapshot`), then loaded
into a scratch registry with `python -m factlot.registry.adapters.ca_sacramento ... --as-of 2026-11-01` (2.9 s):

| Export (`where`)                                                                                                                  | Bytes     | Snapshot document id                                                                  | Rows read / parcels kept |
| --------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `LU_GENERAL IN ('Retail / Commercial','Office','Industrial')`                                                                     | 3,158,262 | `fl:document:sha256-f5eae423cfcf6ac481f7afd0118504d5671579e0ddf2a1391db7d99da1436253` | 16,004 / 15,637          |
| `LU_GENERAL = 'Residential' AND LU_SPECIF IN ('Low Rise Apartment', 'High Rise Apartment', 'Hotel', 'Motel', 'Mobile Home Park')` | 752,896   | `fl:document:sha256-aab0eafb2b4c28b5c2cb1ed9bc0088309218232130c750ee93f6b9dc77f7b466` | 4,013 / 4,013            |
| `LU_GENERAL IN ('Care / Health','Recreational')`                                                                                  | 177,629   | `fl:document:sha256-8ecb4cc96dcce4eec70b2d0746d4cdcd7c9827a547729071b387a6108584ccbf` | 925 / 403                |

Totals: **20,053 parcels, 99,110 facts**, 0 invalid, 0 out of scope at ingest, 0 retired; **owner names: 0**
(`owners_person_or_withheld` 0, no organisation owner facts). By category: **B 3,664; F1 11,764; F2 4,625**. Facts per
parcel: APN and local use code 20,053; category 20,053; situs 20,032 (21 parcels without a street name); land area
18,919 (condominium sub-parcels have none). No value, year-built or area facts exist.

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `ca-sacramento-assessor__f5eae423cfcf6ac4__csv` (3,158,262 bytes): `fl:document:sha256-f5eae423cfcf6ac481f7afd0118504d5671579e0ddf2a1391db7d99da1436253`
- `ca-sacramento-assessor__aab0eafb2b4c28b5__csv` (752,896 bytes): `fl:document:sha256-aab0eafb2b4c28b5c2cb1ed9bc0088309218232130c750ee93f6b9dc77f7b466`
- `ca-sacramento-assessor__8ecb4cc96dcce4ee__csv` (177,629 bytes): `fl:document:sha256-8ecb4cc96dcce4eec70b2d0746d4cdcd7c9827a547729071b387a6108584ccbf`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ca_sacramento <retail-office-industrial csv> <apartment-hotel csv> <care-recreational csv> registry.db --as-of 2026-11-01 --retrieved-at <manifest checked_at>
```

- Rows read: 20,942 data rows in the three exports (16,004 + 4,013 + 925).
- Parcels kept: **20,053** distinct commercial parcels (`B` 3,664, `F1` 11,764, `F2` 4,625).
- Facts written: 99,110. Seconds: 6.4. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 0; natural persons or withheld owners not stored (names not kept): 0.
- Ownership links to registered entities after `link_owners()`: 0 (the only entity registry in the scratch file is `ct-sos-entities`).

## Known gaps

- No assessed values, no owner names (so no organisation owner links), no year built, no building area: the Assessor's
  electronic roll (free by e-mail) would add values.
- The class table is not posted; "Low Rise Apartment" being five or more units is an inference from the county's
  separate two- to four-family classes. Ask Sacramento County GIS (through the data.saccounty.gov contact page) to confirm.
- The Hub export carries no roll year; `as-of` is the item's modified date (2026-11-01) and `tax_year` is empty.
- `Landuse Use` flags a few thousand parcels as under improvement or unfinished; they are kept by class.
