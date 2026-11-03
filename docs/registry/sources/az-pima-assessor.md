# az-pima-assessor: Pima County, Arizona (FIPS 04019)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/az/az-pima-assessor.json`](../../../registry/sources/az/az-pima-assessor.json). **Gated on terms; no adapter.** Tier 2,
west region ([`../tier2/west.md`](../tier2/west.md)). Compare [az-maricopa-assessor.md](az-maricopa-assessor.md) (gated on A.R.S. 39-121.03).

## Publisher and URLs

- Publisher: Pima County Information Technology Department, Geographic Information Systems (GIS), with data from the Pima County Assessor.
  Open data portal: <https://gisopendata.pima.gov> (ArcGIS Hub; "Pima County Geospatial Data Portal"). GIS data products page:
  <https://www.pima.gov/acquire-gis-data> ("Search the Open Data Portal: find and download layers as CSV, Shapefile, GeoJSON, or KML").
- Layer: "Parcels - Regional" ("All tax parcels, common areas, and private roadway parcels in Pima County"), ArcGIS item
  `564d8eabf5c7450d9d20510cc8a7c6a2`, map service layer `https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/LandRecords/MapServer/12`,
  448,712 parcels, `maxRecordCount` 2000. Metadata: <https://gis.pima.gov/data/contents/metadet.cfm?name=paregion>.
- The Assessor's own site, `www.asr.pima.gov`, has parcel search only and no bulk files that were found.

## Terms, license, robots

- Item `licenseInfo` (read 2026-11-03): "GIS Data and Products Disclaimer: We give no warranty ... In particular, this Open Data version of the
  dataset is intended for use either as a Shapefile download, or as a service within a map or private application. It is not intended for use as
  a service within another public-facing application. Per A.R.S. 37-178: A public agency that shares geospatial data of which it is the
  custodian is not liable for errors, inaccuracies or omissions ..."
- ITD GIS Disclaimer & Use Restrictions (<https://www.pima.gov/itd-gis-disclaimer-use-restrictions>): "All information, web pages, data (including digital
  data), maps ... obtained by and prepared for and by the Pima County Geographic Information Systems (hereafter "Products") shall remain the property of
  Pima County." No permission statement for redistribution; no mention of A.R.S. 39-121.03.
- **Is it the same statute as Maricopa?** A.R.S. 39-121.03 is state law for every Arizona public body: a person who obtains a public record for a commercial
  purpose without stating it is liable for the commercial rate. Maricopa's Assessor publishes a Commercial Purpose Public Record Request form; Pima
  publishes no such form that was found, and its data page, license text and use restrictions do not mention the statute. The Pima-specific obstacles
  are the county's ownership claim and the "not for use as a service within another public-facing application" sentence, which an open registry API
  would break.
- robots.txt: `gisopendata.pima.gov` `Crawl-delay: 60`, disallows `/sites/`, `/admin/` and similar; `gis.pima.gov` disallows `/data/datalib/`, `/maps/detail.cfm`
  and similar; `gisdata.pima.gov` none (404); **`www.asr.pima.gov` `User-agent: * Disallow: /`** and also names several AI crawlers, so no automated access
  to the Assessor site was made.

## What the file contains

Only layer metadata, a 6-row sample and a group-by of `PARCEL_USE` were requested (no download). Fields: `PARCEL` (Pima parcel code, e.g. `10101003E`),
`ADDRESS_OL` (situs), `MAIL1`-`MAIL5` (owner of record on `MAIL1`, then the mailing address; e.g. `RSD WAYNETOWN LLC`, `PO BOX 1159`, `DEERFIELD IL`), `ZIP`,
`PARCEL_USE` (the Assessor's four-digit property use code; 4 digits with a leading zero, e.g. `0131`, `2140`), `TAXYR` (2026), `FCV` (full cash value), `LIMNET`
(limited property value), `LANDMEAS`/`LANDUNIT`, `GISACRES`, `LEGAL1`-`LEGAL5`, `TAXAREA`, `RECORDDATE`, `DOCKET`, `PC_RESTRIC`, shape fields. No building area,
no year built. Owner names are present (organisations and natural persons). The use-code definitions were not found, so the commercial scope cannot be applied.

## Gates

Terms and a missing code table. The download needs no account, click-through or fee. A person must:

1. Ask Pima County GIS (the contact form on the Acquire GIS Data page) whether the parcel layer with owner names may be redistributed in an open, public-facing registry
   (the item text says it may not be used as a service in a public-facing application) and who owns the Assessor-sourced attributes.
2. Ask the Assessor whether a commercial-purpose statement under A.R.S. 39-121.03 is required for a bulk use, and file it if so (as for Maricopa).
3. Obtain the Assessor's property use code table (`PARCEL_USE`) to map commercial, industrial and multi-family classes. 1,197 parcels have no code.

## Real run

None (gated; no adapter). Group-by of `PARCEL_USE` showed 623 distinct codes plus 1,197 parcels with none; the largest are `0131` (143,928, single-family) and `0141` (43,910).

## Known gaps

No building area or year built in this layer; only the Assessor's detail pages (interactive, robots-disallowed) have them.
