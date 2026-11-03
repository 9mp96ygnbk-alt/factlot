# wa-snohomish-assessor: Snohomish County, Washington (FIPS 53061)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/wa/wa-snohomish-assessor.json`](../../../registry/sources/wa/wa-snohomish-assessor.json). **Gated on
terms (an RCW 42.56.070 representation); nothing downloaded; no adapter.** Tier 2, west region
([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: Snohomish County Assessor's Office. Page: <https://www.snohomishcountywa.gov/6206/GIS-Open-Data> ("A variety of
  Assessor's Office data is available in electronic format for download from the Snohomish County Open Data Portal ...
  Selected extracts from our tabular data systems are available for free download. Assessment roll - CSV Version - Updated
  three times per week; Assessment roll - Microsoft Excel Version ...; Parcel Legal Descriptions (see Assessment Roll);
  Plat Listing by Name; Unrecorded Plats").
- Portal: <https://snohomish-county-open-data-portal-snoco-gis.hub.arcgis.com> (an ArcGIS Hub). Items found through the Hub's
  public search API (`/api/search/v1/collections/all/items?q=assessor%20roll`):
  - "Assessor Roll CSV Collection", id `ee76dfa5905947cc9af1605a25cf216a`, file `Assessor_Roll_csv.zip`, 33,407,634 bytes,
    modified 2026-11-02. Snippet: "CSV file contains five tables (MainData, NameAddr, SegMerge, Exemptions, and LegalDescr)
    that together comprise the primary export of Snohomish County Assessor's Assessment Data. The MainData table reports
    assessment data for which there is only single occurrence for each property ... related ... using one of two fields, PropId
    or parcel_number."
  - "Assessor Roll Microsoft Excel", id `62fda600cf1f4c6d8b8761fa044431f0`, modified 2026-11-02.
  - GIS layers "All Parcels (Past and Present)", "Current Parcels", "Parcel Centroids", "Recent Property Sales" (quarterly).

## Terms, license, robots

The item's Terms of Use and Data Disclaimer (read 2026-11-03 from the Hub item metadata, not accepted):

> Washington State Law, RCW 42.56.070(8) prohibits state and local agencies from providing access to lists of individuals
> intended for use for commercial purposes. A commercial purpose includes any business activity intended to generate profits.
> By proceeding and accessing this data, you agree and represent that you will not use any lists of individuals, or data from
> which such lists may be compiled, for any commercial purpose.

It also disclaims warranty and says the data are "for illustrative purposes only". No license, no redistribution or AI-use
statement. (Compare King County's gate in [wa-king-assessor.md](wa-king-assessor.md): there the acknowledgement is a checkbox on a form;
here it is a condition of access stated on the item.)

robots.txt: `snohomishcountywa.gov` disallows only admin and search paths and blocks Baiduspider and Yandex;
`snohomish-county-open-data-portal-snoco-gis.hub.arcgis.com` has `Crawl-delay: 60` and disallows `/sites/`, `/admin/`, `/sessions/`,
`/groups/`, `/people/`, `/workspace/` (the Hub search API and downloads are allowed).

## What the file contains

Only the item snippet was read (no table headers): MainData (one row per property), NameAddr (owners and addresses: this is
the owner table, with natural persons), SegMerge, Exemptions, LegalDescr. Property class, values and areas are therefore
expected in MainData, but their column names are unconfirmed. Nothing was downloaded.

## Gates

Terms. The download itself would need no account or fee, but by accessing it a person represents that no list of individuals
will be used commercially. The roll's NameAddr table is exactly such a list, and FactLot is a business. A person must either:

1. Decide that FactLot can truthfully make that representation (the registry drops natural-person names, but the downloaded file
   is still a list of individuals), then accept on FactLot's behalf and set `verified` true; or
2. Ask the Assessor's Office (3000 Rockefeller Avenue, Everett; 425-388-3433) for written permission or for a roll without
   NameAddr; or
3. Use the statewide layer ([wa-state-parcels.md](wa-state-parcels.md), also gated on terms), which has no owners, for land use
   and values (about 10,300 commercial, industrial and multi-family parcels by State land use code).

## Real run

None (gated).

## Known gaps

Layout, class codes and owner field names unconfirmed until a person accepts the terms and the file is read.
