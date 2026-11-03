# ok-tulsa-assessor: Tulsa County, Oklahoma Assessor parcels (INCOG)

Reviewed 2026-11-03. Status: **not verified (gated: terms not stated; records request offered)**; no adapter. FIPS 40143. Config: [`registry/sources/ok/ok-tulsa-assessor.json`](../../../registry/sources/ok/ok-tulsa-assessor.json).

## Publisher and URLs

- Tulsa County Assessor, `https://assessor.tulsacounty.org` (Property Search, Interactive Map, Resources: Download
  Forms, Open Records Request, "Public Data").
- Parcel layer hosted by INCOG (Indian Nations Council of Governments): "Tulsa County Parcels (INCOG)", ArcGIS
  item `6bba0af6689642dfaa884abcf3b3efe4` (owner account `gis_cbaok`; modified 2026-04-20), service
  `https://map11.incog.org/arcgis11wa/rest/services/Parcels_TulsaCo/FeatureServer/0` (284,813 parcels on 2026-11-03;
  `maxRecordCount` 2,000; copyright text on the layer "Tulsa County Assessor"). The Assessor's own ArcGIS server
  (`asps0305.tulsacounty.org`, "TCA_Mapping_Application/Parcels") did not resolve.
- The Assessor's "Public Data" page (`/Resources/PublicData`) lists only Ad Valorem tax guides (PDF); no data file.

## Terms, license, robots

- The INCOG layer has an empty `licenseInfo` and no description. The Assessor's site disclaimer: "The information
  must be accepted and used by the recipient with the understanding that the data was developed and collected only
  for the purpose of establishing Fair Cash Value (Market) for ad valorem taxation." Its Open Records Request form
  (`/Resources/DataRequest`) asks the purpose ("Commercial", "Personal", "Public Interest") and says "there may be a
  charge to recover the reasonable direct costs of record search and copying"; the Records Reproduction Policy
  (`/documents//info/RecordsReproductionPolicy/ReproductionPolicy.pdf`) was not read.
- Public records under the Oklahoma Open Records Act (51 O.S. 24A.1 et seq.). AI use: not addressed. Redistribution:
  unknown, so `verified: false`.
- robots.txt: `map11.incog.org` 404; `assessor.tulsacounty.org` 404 (no rules).

## What the file contains

Rich assessor attributes: `AccountNo` (`R99001900155010`), `ParcelNo`, `AcctType` (Residential 238,916; Commercial
18,840; Exempt 11,629; Exempt Com 4,431; Agricultural 4,495; blank 5,478; Comm Res 212; Partial Exempt 151; Comm Ag 67;
Exempt Res 539; Exempt Ag 55), `UseCode` (text such as `Retail`, `MHP`), `OccCode` (occupancy description such as
`Mobile Home Parks *CODE`), `PropertyType`, `Owner`, `Name1`, `Name2`, mailing `Address1`/`Address2`/`City`/`State`/
`ZIPCode`, `PropertyAddress`/`PropertyCity`/`PropertyZIP`, `YearBuilt`, `GrossSF`, `GrossAcre`, `UnitsTotal`,
`TotalImpValue`, `TotalLandValue`, `TotalAcctValue`, `TaxableValue`, `SaleDate`, `SalePrice`. Owner names are present
(natural persons appear). Once permitted the layer maps to `F1` (Commercial / `UseCode`), `F2` and `B` (apartment
occupancy, `UnitsTotal`); the `UseCode`/`OccCode` value tables were not downloaded (only the field list and a three-row
sample were read).

## Gates

- **Terms / records request (a person).** Submit the Assessor Record Request form (purpose Commercial) for the bulk
  property file, read the Records Reproduction Policy for fees, and ask in writing whether the INCOG layer may be
  republished as facts.

## Real run

Not run (counts above are service statistics).

## Known gaps

Everything beyond the field list: no download, use-code tables or category counts.
