# fl-miamidade-commercial: Miami-Dade County "Commercial Property" layer

Review record for the FactLot Registry source `fl-miamidade-commercial` (Miami-Dade County, FIPS 12086).
Config: [`registry/sources/fl/fl-miamidade-commercial.json`](../../../registry/sources/fl/fl-miamidade-commercial.json).
Reviewed 2026-11-06. **`verified: false`.** No adapter. No features were queried, and nothing was loaded.

This record is not an audit and it is not a completeness claim. There is no scratch registry and no
audit JSON.

## Why it stops here

The item's `licenseInfo` is only an "as is" disclaimer. It grants no licence to copy, redistribute,
or reuse the data, and it does not mention AI. That is not free use. A person has to decide
whether a public feature service published with that disclaimer can be redistributed. Until then
the source stays `verified: false` and is not collected.

## Publisher and URLs

- Publisher, from the item's `accessInformation`: Miami-Dade County ITD - Geospatial Infrastructure
  Support Group. The item `owner` is `MDPublisher`.
- Item read: <https://www.arcgis.com/sharing/rest/content/items/fb8303c577c24ea386a91be7329842be?f=json>
  (id `fb8303c577c24ea386a91be7329842be`, title "Commercial Property", type Feature Service,
  `access` `public`). Read 2026-11-06 (response `date: Fri, 06 Nov 2026 22:55:41 GMT`).
- Service named by the item's `url`, and by this lane:
  <https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/CommercialProperty_gdb/FeatureServer>.
  Layer 0 metadata was also read:
  <https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/CommercialProperty_gdb/FeatureServer/0?f=json>.
  No feature query was sent (`returnCountOnly`, `outFields`, or an export).

Item `snippet` and `description`, verbatim (`<br />` breaks written as line breaks):

> A point feature class of Commercial Business locations within Miami-Dade County.

> Updated: Annually

> The data was created using:
> Projected Coordinate System: WGS_1984_Web_Mercator_Auxiliary_Sphere
> Projection: Mercator_Auxiliary_Sphere

The description's words are "Commercial Business locations", and the layer geometry is
`esriGeometryPoint`. This is not a parcel polygon roll.

## Licence and disclaimer, quoted verbatim

Item `licenseInfo`, read 2026-11-06 at the item URL above. This is the whole field:

> Miami-Dade County provides this data for use "as is". The areas depicted by this map/data are approximate, and are not accurate to surveying or engineering standards. The maps/data shown here are for illustration purposes only and are not suitable for site-specific decision making. Information found here should not be used for making financial or any other commitments. Miami-Dade County provides this information with the understanding that it is not guaranteed to be accurate, correct or complete and conclusions drawn from such information are the sole responsibility of the user. While every effort has been made to ensure the accuracy, correctness and timeliness of materials presented, Miami-Dade County assumes no responsibility for errors or omissions, even if Miami-Dade County is advised of the possibility of such damage.

The service root and layer 0 both return an empty `copyrightText` and an empty `serviceDescription`
(service) or `description` (layer). No other licence text was on those two JSON documents.
`accessInformation` is "Miami-Dade County ITD - Geospatial Infrastructure Support Group".

AI use: not addressed. Redistribution: not granted by the text above.

## robots.txt

Read 2026-11-06:

- <https://www.arcgis.com/robots.txt>: HTTP 200. Body is `User-agent: *` and
  `Sitemap: http://static.arcgis.com/sitemap.xml`. No `Disallow`.
- <https://services.arcgis.com/robots.txt>: HTTP 403, body `Invalid URL`. No rules were readable.
  Only the service and layer metadata documents above were requested from that host.

## What the layer metadata says

Layer 0 name `CommercialProperty`, geometry `esriGeometryPoint`. Fields, names and aliases as
published. No field has a coded-value domain. No feature values were read, so no business name,
phone number, or address from this layer is in this record.

| Name      | Type                  | Alias     |
| --------- | --------------------- | --------- |
| OBJECTID  | esriFieldTypeOID      | OBJECTID  |
| PPFOLIO   | esriFieldTypeString   | PPFOLIO   |
| FOLIO     | esriFieldTypeString   | FOLIO     |
| BUSNAME1  | esriFieldTypeString   | BUSNAME1  |
| BUSNAME2  | esriFieldTypeString   | BUSNAME2  |
| ADDRESS   | esriFieldTypeString   | ADDRESS   |
| UNIT      | esriFieldTypeString   | UNIT      |
| ZIPCODE   | esriFieldTypeInteger  | ZIPCODE   |
| PHONE     | esriFieldTypeString   | PHONE     |
| NUMOFUNIT | esriFieldTypeInteger  | NUMOFUNIT |
| USECODE   | esriFieldTypeString   | USECODE   |
| CODE      | esriFieldTypeString   | CODE      |
| OCLNUM    | esriFieldTypeString   | OCLNUM    |
| BUSCODE   | esriFieldTypeString   | BUSCODE   |
| BUSDESC   | esriFieldTypeString   | BUSDESC   |
| LAT       | esriFieldTypeDouble   | LAT       |
| LON       | esriFieldTypeDouble   | LON       |
| POINT_X   | esriFieldTypeDouble   | POINT_X   |
| POINT_Y   | esriFieldTypeDouble   | POINT_Y   |
| GlobalID  | esriFieldTypeGlobalID | GlobalID  |

`USECODE`, `CODE`, and `BUSCODE` are present. The metadata does not define them and does not say
they are Florida Department of Revenue use codes. No commercial or industrial crosswalk was made.
A later adapter, and only after a person clears the licence, has to map those codes from a
published Florida code list and has to write that map down as a Florida commercial and industrial
classification. It must not reuse the Texas category letters B, F1, and F2 as a nationwide
crosswalk. `BUSNAME1`, `BUSNAME2`, and `PHONE` can name a natural person; values were not read
and must not be stored as person names.

## Commercial-universe denominator

Unavailable. The item and the layer metadata do not publish a feature count or a commercial or
industrial parcel count. The item `size` is 66,912,256 bytes, which is not a count of places.
No count query was run. The layer is business-location points, not a county parcel roll, so a
feature count, even if one were published, would not be a parcel denominator.

## Freshness

Separate from any loaded as-of, because nothing was loaded. The publisher's own fields disagree,
and none of them was treated as a certified as-of:

- Description: "Updated: Annually".
- Item `modified`: 1789046437000, which is 2026-09-10T13:20:37Z. Item `created`: 1528202505000,
  which is 2018-06-05T12:41:45Z. `modified` is the item record, not a statement that the features
  were edited that day.
- Layer `editingInfo.dataLastEditDate`: 1658805525696, which is 2022-07-26T03:18:45.696Z.
- Layer `editingInfo.lastEditDate` and `schemaLastEditDate`: 1680710958559, which is
  2023-04-05T16:09:18.559Z.

The data-last-edit timestamp, 2022-07-26, is more than 400 days before the read date 2026-11-06.
That is freshness evidence only. It is not an audited as-of, and it is not a completeness claim.

## Gate

A person has to decide whether the "as is" disclaimer above is enough to keep and redistribute
facts from this layer. It states no licence. Do not query or export features, and do not set
`verified` to true, until that decision. The stale `dataLastEditDate` is a second, separate
reason not to treat the layer as current.
