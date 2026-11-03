# ok-oklahoma-assessor: Oklahoma County, Oklahoma Assessor tax parcels

Reviewed 2026-11-03. Status: **not verified (gated: terms not stated; records request offered)**; no adapter. FIPS 40109. Config: [`registry/sources/ok/ok-oklahoma-assessor.json`](../../../registry/sources/ok/ok-oklahoma-assessor.json).

## Publisher and URLs

- Oklahoma County Assessor (Larry Stein), `https://www.oklahomacounty.org/elected-offices/assessor`; GIS Hub
  `https://ok-county-gis-hub-ok-co.hub.arcgis.com` (site item `e928c64767b94644a91e26775acac694`; its pages say
  "Click the link to download Tax Parcel Data!" with cards for Tax Parcels, Assessment Rolls, Current Assessed Value,
  Current Market Value).
- Dataset: "Tax Parcels Public", ArcGIS item `244ff1c03cf34c459092e10142b13b01` (owner account `artimcon`; item
  modified 2025-03-13), service
  `https://services8.arcgis.com/euhkr1dAJeQBIjV0/arcgis/rest/services/TaxParcelsPublics_view/FeatureServer/0`
  (337,709 rows on 2026-11-03; `maxRecordCount` 2,000).
- Paid bulk roll: the Assessor's "Records Reproduction Policy" (posted 2012-02-06) sells the "Complete Assessment
  Roll", "Ownership File" and "Comparable Sales File" (comma-delimited ASCII on USB drive or by upload; record layouts
  as PDF), $50 for the roll and for the ownership file per a search listing of the policy page, on two weeks' written notice.

## Terms, license, robots

- The Hub dataset has an empty `licenseInfo` and no terms page. The Assessor's page and policy state fees and formats
  and say nothing about republication. Records are public under the Oklahoma Open Records Act (51 O.S. 24A.1 et seq.).
- AI use: not addressed. Redistribution: unknown. Because nothing states that the layer may be republished, it is
  `verified: false`.
- robots.txt: the Hub host `Crawl-delay: 60` (disallow `/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`,
  `/workspace/`); `www.oklahomacounty.org` standard DNN rules; `services8.arcgis.com` not read.

## What the file contains

Fields: `propertyid`, `accountno` (`R189751050`), `accttype`, `mapnumber`, `taxdistrict`, `PARCELNB`, `name1`-`name3`
(owner names; natural persons appear), `mailingaddress1`, `city`, `state`, `zipcode`, `parentaccount`, `currentmarket`,
`currentassessed`, `currenttaxable`, `netassessed`, `landvalue`, `subname`, `legal`, `location` (situs, e.g.
`19615 LUTHERAN RD OKLAHOMA CITY`), `locationcity`, `acres`, `width`, `depth`, `nbhd`, `econarea`, `saledate`,
`SalePrice`, `pin`, `SalesValidity`. `accttype` counts: Residential 296,507; Commercial 16,738; Exempt 12,442;
Industrial 6,554; Agricultural 3,151; blank 1,304; Public Servi 553; Comm Res 276; Partial Exem 184. There is no
use code and no building area or year built: Oklahoma classes apartments with commercial, so a mapping from
`accttype` could give `F1` (Commercial) and `F2` (Industrial) only; `B` would need the Assessment Roll's use detail.

## Gates

- **Terms / records request (a person).** Ask the Oklahoma County Assessor in writing whether the "Tax Parcels
  Public" layer and the Assessment Roll may be republished as facts; or buy the Complete Assessment Roll (policy fee
  $50, confirm the current fee; two weeks' written notice) and read its layout PDF, which should carry use codes.

## Real run

Not run (counts above are service statistics).

## Known gaps

No use code, building area or year built in the free layer; `accttype` is a tax class.
