# co-elpaso-assessor: El Paso County, Colorado (FIPS 08041)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/co/co-elpaso-assessor.json`](../../../registry/sources/co/co-elpaso-assessor.json). **Gated on terms; no
adapter.** Tier 2, west region ([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: El Paso County Assessor's Office (Colorado Springs). Page: <https://assessor.elpasoco.com/assessordata/>:
  "In the process of fulfilling Statutory duties to discover, list, classify and value property, the Assessor's Office
  collects and maintains a variety of data to use in determining property values. The Assessor data below is provided as a
  public courtesy. All reasonable efforts have been made to ensure the data's accuracy. However, the data should be considered
  only as "best information available."" It also offers monthly sales workbooks (Agricultural, Vacant Land, Residential Land,
  Farm/Ranch, Manufacturing, Commercial, Multi Family, Single Family, Mobile Home) and the certified-value letters.
- Parcel file: "This parcel data-set represents the primary data for each real property parcel in El Paso County to include
  Ownership, Land Use, Improvement Use, and Value. The data-set is updated weekly with the file creation date included as one of
  the file's fields." Current link at review:
  <https://epc-assets.elpasoco.com/wp-content/uploads/sites/4/Data/EPC-Parcel-Data-20261027.zip> (the file name carries the date, so
  the collector finds it by a link pattern on the page). Layout PDF: <https://assessor.elpasoco.com/wp-content/uploads/Data/EPC-Parcel-Layout.pdf>.

## Terms, license, robots

- No license, terms of use or redistribution/AI-use statement on the data page beyond the "public courtesy" paragraph above.
  Assessor records are public under the Colorado Open Records Act (C.R.S. 24-72-201 et seq.).
- The County's General Disclaimer (<https://www.elpasoco.com/general-disclaimer/>) covers the web site and its "data links": no warranty;
  "Copyright ... All content included on this site, such as text, graphics, logos, button icons, images, audio clips, digital
  downloads, data compilations, and software, is the property of El Paso County, Colorado or its content suppliers and is
  protected by United States and international copyright laws." That sentence is the unresolved point: it is a general copyright
  claim over "digital downloads" and "data compilations" with no permission statement for reuse (contrast Denver's explicit CC BY 3.0 in
  [co-denver-assessor.md](co-denver-assessor.md)).
- robots.txt: `assessor.elpasoco.com` and `www.elpasoco.com` (Yoast defaults) allow everything; `epc-assets.elpasoco.com/robots.txt`
  answers HTTP 403 (no rules readable); the file host answered the download.

## What the file contains

`EPC-Parcel-Data-20261027.zip`: 20,348,962 bytes (`Last-Modified` 2026-10-28), one member `EPC Parcel Data.txt` (120,470,661 bytes),
tab-delimited, Latin-1, header row, 278,232 data lines (278,178 with the expected 41 fields and 54 with a different count,
probably embedded tabs in free text). Header at review: `LastUpdate, PARCEL, LOCATION, LOCATIONZIP, PLATNUM, PARTIALLEGAL, SchoolDist, ZONING, MARKETVALUE,
ASSESSEDVALUE_NONSCHOOL, ASSESSEDVALUE_SCHOOL, LANDCODE, LANDCODEDESCR, Acreage, IMPCOUNT, IMPSTATECODE, IMPSTATEDESCR, IMPLOCALCODE,
IMPLOCALDESCR, YearBlt, UNITS, RESSTYLE, Rooms, Beds, Baths, TotalFinishedArea, TotalBSMT, FinishedBSMT, IMPSQFT, SALEDATE, SALEPRICE,
AsrSaleCmnt, OWNER1, OWNER2, OWNER3, MAILADR, MAILCITY, MAILSTATE, MAILZIPCODE, MAILINTLPROBADR, assignedto`. The layout PDF differs a little
(it lists `CmntyArea`, `ASSESSEDVALUE`, `sdate`, `sprice`, `nprop`; the file has the names above).

**Owner names are present** (`OWNER1`-`OWNER3`, 32 characters each, so long names are truncated) with the mailing address. `LANDCODE` and
`IMPSTATECODE` are the Colorado Division of Property Taxation abstract subclass codes with the County's descriptions: they are the
same codes as Denver's (`co_denver.py` maps them): 1120/1125 and 1220/1225 multi-units (4-8, 9 and up), 2112-2145 and 2212-2245
commercial, 3112/3115/3130 and 3215/3230 industrial, 9xxx exempt.

## Gates

Terms. The download needs no account, click-through, fee or CAPTCHA. A person must:

1. Ask the Assessor's Office (719-520-6600, asrweb@elpasoco.com) for written confirmation that the weekly parcel file may be redistributed
   as open data (or decide that the CORA public-record status of the underlying facts is enough despite the General Disclaimer's
   copyright sentence).
2. Confirm C.R.S. 24-72-205.5 (a statement of purpose is required for records requested to be used for direct solicitation) does not
   apply to an unrequested download.
3. Once cleared: set `verified` true, run `snapshot` (20 MB), and write the adapter. It is a copy of `co_denver.py` with a tab-delimited reader,
   `PARCEL` as the key, `OWNER1` as owner (placeholders and confidentiality flags to be checked in the data), `IMPSQFT`, `YearBlt`, `Acreage` and
   `MARKETVALUE`; the layout is known from this review.

## Real run

None (gated; no adapter). The file was downloaded once for the review (20 MB, two connection resets, resumed with `Range`) and read
locally. Using the Denver mapping on the real file (counts only, not loaded into a registry):

- 278,178 regular rows. In scope by `IMPSTATECODE`, else `LANDCODE`: **10,140 parcels**, F1 7,719, B 2,220, F2 201.
- Owner of record on those: 7,650 organisations by the registry's name test, 2,490 natural persons or other (which the registry would not store).

## Known gaps

- 54 rows have a different field count and would be skipped (or repaired) by an adapter.
- Owner names are truncated at 32 characters; entity linking by exact name will miss long names.
- No assessment year column (the file date, `LastUpdate`, is the as-of date).
- Land and improvement area for commercial parcels are `Acreage` and `IMPSQFT` (primary building only).
