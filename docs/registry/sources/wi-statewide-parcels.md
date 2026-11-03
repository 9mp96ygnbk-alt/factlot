# wi-statewide-parcels: Wisconsin Statewide Parcel Map Initiative (V12), all counties incl. Milwaukee (FIPS 55079)

Reviewed 2026-11-03. Machine-readable copy: [`registry/sources/wi/wi-statewide-parcels.json`](../../../registry/sources/wi/wi-statewide-parcels.json).
Adapter: `factlot.registry.adapters.wi_statewide` (account system `wi_parcelid`, the county's parcel id).

**Status: `verified: true`.** One review clears all 72 Wisconsin counties: the State Cartographer's Office and the
Department of Administration aggregate every county's parcel and tax-roll data once a year. The publisher states no
licence, only that the data is "free"; the registry treats that as no restriction (see Terms). Milwaukee County is
the Tier 2 county; the same query with another `CONAME` loads any other county.

## Publisher and URLs

- Publisher: Wisconsin State Cartographer's Office (UW-Madison) and the Wisconsin Department of Administration,
  Wisconsin Land Information Program (WLIP), under 2013 Wisconsin Act 20. Contacts: `help@sco.wisc.edu`, `wlip@wisconsin.gov`.
- Data page: <https://www.sco.wisc.edu/parcels/data/> (V12 released 2026-06-30; V13 tentatively 2027-06-30). Project
  page: <https://doa.wi.gov/Pages/LocalGovtsGrants/Parcel-Initiative.aspx>.
- Statewide file geodatabase (not used): `https://web.s3.wisc.edu/parcels/v12_parcels/V12.0.0_Wisconsin_Parcels_2026_10.3_Compressed.zip`
  (HEAD 200, 515,810,191 bytes, Last-Modified 2026-06-30, `accept-ranges: bytes`) and the 759,926,092-byte uncompressed
  zip. Both exceed the 50 MB research limit and need GDAL or ArcGIS to read. County shapefile/gdb downloads also exist.
- Schema: <https://www.sco.wisc.edu/parcels/data/assets/V12/V12_Wisconsin_Statewide_Parcels_Schema_Documentation.pdf>
  (1.7 MB, read in full).
- Live service used: `https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0`
  (ArcGIS Online item `2386813b23ea4e51a009f7d1d6b76e02`; layer `V1200_WisconsinParcels_2026`; 3,574,646 parcels;
  `maxRecordCount` 2000; JSON, GeoJSON and PBF output).

## Terms, license, robots

- **Terms.** No licence or terms of use. The data page: "This data is provided free of charge, however, if you use
  Wisconsin's parcel data, we ask that you please complete the parcel feedback form, to tell us how/why you use the data."
  The ArcGIS item's `licenseInfo`: "This data free for public consumption as of: 06/30/2026". The data-access modal says
  only: "No warranty, expressed or implied, is made regarding accuracy, completeness, or legality of the information
  herein." Nothing addresses redistribution or AI use. The feedback form is a request, not a condition; a courtesy
  attribution is carried in the Source record.
- **Why verified.** The data is a statutory statewide aggregation of public records, offered free to the public with no
  restriction stated. This is the same footing as `mn-hennepin-assessor` (public government data, disclaimer only). If a
  person wants an express statement, ask WLIP (`wlip@wisconsin.gov`); this is a confirmation, not a gate.
- **robots.txt.** `www.sco.wisc.edu`: `User-agent: *` with `Disallow: /wp-admin/` and `/wp-login.php` only. `web.s3.wisc.edu`:
  none (S3 `NoSuchBucket` 404). `services3.arcgis.com`: none. `discover` reported the data page `ok`.

## What the file contains

One feature per parcel; the service is queried with `returnGeometry=false`, `orderByFields=OBJECTID`,
`resultOffset`/`resultRecordCount=2000` and the `outFields` listed in the config. Columns read (schema documentation):
`STATEID`, `PARCELID`, `TAXPARCELID`, `TAXROLLYEAR`, `OWNERNME1`, `OWNERNME2`, `PSTLADRESS` (owner mailing address, one line),
`SITEADRESS`, `PLACENAME`, `ZIPCODE`, `CNTASSDVALUE`, `LNDVALUE`, `IMPVALUE`, `ESTFMKVALUE`, `PROPCLASS`, `AUXCLASS`,
`ASSDACRES`, `DEEDACRES`, `GISACRES`, `CONAME`, `LOADDATE`, `PARCELFIPS` (3-digit county FIPS), `PARCELSRC`.

| `PROPCLASS` (Wis. Stat. 70.32(2)(a)) | Meaning                                                                               | FactLot      |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------ |
| `2`                                  | Commercial (market value basis)                                                       | F1           |
| `3`                                  | Manufacturing                                                                         | F2           |
| `1`, `4`, `5`, `5M`, `6`, `7`        | Residential, agricultural, undeveloped, agricultural forest, productive forest, other | out of scope |
| blank (+ `AUXCLASS` X1-X4, W1-W9)    | Tax-exempt or managed-forest parcels                                                  | out of scope |

A parcel with several classes lists them comma separated (`1,2`); it is commercial when `2` is among them. **Wisconsin has no
multifamily class**: apartment buildings are class 2, so they load as F1 and cannot be told from other commercial property
(no unit counts in the layer). The publisher's code is kept in `local_use_code`.

Owner names: present for most counties. Kenosha County redacts 100 % (`NOT AVAILABLE`); Barron, Brown, Columbia, Crawford, Dane
(11.43 %), Manitowoc, Sheboygan and Vilas redact in part. The adapter maps `NOT AVAILABLE` to `owner_confidential`. Milwaukee
County's names are cut to about 28 characters (`WASTE MANAGEMENT OF WISCONSI`). `ESTFMKVALUE` is the estimated fair market
value; `CNTASSDVALUE` the total assessed value; the roll year is `TAXROLLYEAR` (2025 for most counties in V12).

## Gates

None for the data. Only a courtesy: the publisher asks users to fill in its feedback form (<https://www.sco.wisc.edu/parcels/data/>).

## Real run

Milwaukee County (`CONAME='MILWAUKEE'`, `PROPCLASS` containing 2 or 3), collector `snapshot` of 9 pages on 2026-11-03
(9,080,974 bytes; first page `fl:document:sha256-34c856ac2bda2291cba9496d81d613d3b07cccfc1b4f85eeb12bdc58565ef740`; all pages in
`collected/wi-statewide-parcels/manifest.jsonl`), then `wi_statewide.build` into a scratch registry (4.4 s):

- Rows read: 16,582 features (the county has 280,676 parcels; 15,728 class 2, 854 class 3). Parcels kept: **16,580** (two
  repeated parcel ids dropped): F1 15,726, F2 854. B: 0 (no multifamily class).
- Facts written: 155,905. Owner-of-record facts (organisations): 11,770 (9,266 of them an LLC); natural persons or withheld owners
  not stored: 4,810.
- Fact counts: situs 16,551; market value 16,536; assessed value 16,465; land area 16,574; owner mailing address 11,689.

## Known gaps

- Only Milwaukee County was archived; the other 71 counties are the same query with another `CONAME` (185,994 commercial or
  manufacturing parcels statewide).
- No building area or year built in the layer. Apartments cannot be separated from commercial (see above).
- `owner_of_record` names are as the county supplies them (truncated in Milwaukee). A parcel id repeated within a county (two in Milwaukee) keeps its first row.
- V12 is the 2025 roll in most counties; refresh yearly after the June release.
- The Wisconsin DFI corporate file is sold (`wi-dfi-entities`), so Milwaukee owners link to entities only after that purchase.
