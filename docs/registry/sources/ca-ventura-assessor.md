# ca-ventura-assessor — Ventura County, California (FIPS 06111)

Review record for the Assessor's roll data. **Result: gated (records request). The free parcel layer has
only APN and centroid; the item itself says assessor attribute data needs a public records request and a
signed public information agreement; the county's Assessor and GIS web hosts block automated clients.
`verified: false`, no adapter, no file archived.** Config: `registry/sources/ca/ca-ventura-assessor.json`.
Reviewed 2026-11-03.

## Publisher and URLs

- Publisher: Ventura County Assessor (https://assessor.venturacounty.gov) and Ventura County GIS (account
  `GISVentura` on ArcGIS Online).
- Free layer: item `e0721a09a7214788be60dc7f0834ea91` "Parcels Monthly" (snippet "Ventura County Assessor
  parcel data updated monthly", modified 2026-10-05, 384 MB), service
  `https://services2.arcgis.com/XJ5Tb7dTYtAMoyYT/arcgis/rest/services/Parcels_Quarterly/FeatureServer/0`
  (layer `vcparcels`, Query and Extract, `maxRecordCount` 2000, **268,134 features**). Fields: `OBJECTID`,
  `APN` (9 digits, `001001001`), `APN10`, `LAT`, `LON`, shape area and length. **No use code, situs, value or
  owner.**
- The item description (read 2026-11-03) says: "Parcel polygon data with parcel numbers and lat/lon centroid
  coordinates ... **Looking for Assessor attribute data?** You can obtain secured roll data from the Ventura
  County Assessor. You will need to make a public records request and fill out a public info agreement
  contract at https://assessor.venturacounty.gov/assessor-data/public-records-request/."
- Assessor pages: `.../assessor-data/roll-data/`, `.../assessor-data/public-records-request/`,
  `.../forms-notices/forms/agreement-contract` (a contract template revised 1/2025, per a search-engine
  summary). The Assessor's property search page says "If you need to access larger amounts of data or you need
  it in a specialized format please submit a Public Records Request" (same source).
- County GIS downloads at `https://maps.ventura.org/arcgis/rest/services/DataDownloads/...` (CSAs, sewer
  districts, address points and so on; no parcel-attribute service listed in the summaries).

## Terms, license, robots

- The free layer's `licenseInfo` is a disclaimer: the information "was created by the Ventura County
  Geographical Information System (GIS), which is designed and operated solely for the convenience of the
  County and related contract entities. Maps and data are to be used for reference purposes only." No grant of
  redistribution; AI use not addressed. The county's Address Points metadata (search-engine summary) says the
  data is not for redistribution.
- `assessor.venturacounty.gov` and `maps.ventura.org` (robots.txt included) answer **HTTP 403 "The requested
  URL was rejected"** (F5 firewall) to the collector's user agent. `services2.arcgis.com` REST was reachable.

## Gates (need a person)

1. **Public records request and public information agreement.** The founder submits the Assessor's public
   records request for the secured roll with use codes and signs the "public info agreement contract"
   (https://assessor.venturacounty.gov/assessor-data/public-records-request/, which the collector cannot read;
   telephone (805) 654-2181 per the summary), and asks whether the agreement allows republication of the facts.
   The agreement is an acceptance of terms and so is the founder's act.
2. Both county web hosts need a browser, not the collector.

## Real run

None. Layer fields, count and two sample rows read from the public REST endpoint. No registry built.

## Known gaps

- Price, layout and use-code table of the roll products are unknown.
- No county open-data portal for Ventura was found (the `data.venturacounty.gov` names do not resolve).
