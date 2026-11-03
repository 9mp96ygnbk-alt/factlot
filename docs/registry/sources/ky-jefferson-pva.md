# ky-jefferson-pva: Jefferson County (Louisville), Kentucky parcels

Reviewed 2026-11-03. Status: **not verified (gated: purchase; the free layer has no owner or class)**; no adapter.
FIPS 21111. Config: [`registry/sources/ky/ky-jefferson-pva.json`](../../../registry/sources/ky/ky-jefferson-pva.json).

## Publisher and URLs

- Jefferson County Property Valuation Administrator (PVA), published through LOJIC (Louisville/Jefferson County
  Information Consortium) and the Louisville Metro Open Data portal.
- Dataset: "Jefferson County KY Parcels", ArcGIS Hub item `47085b87ac754d60942ea324a3b0f54f` on
  `data.louisvilleky.gov` ("Updated Daily: Parcels in Jefferson County, Kentucky ... maintained by the Jefferson
  County Property Administrator's Office. To get detailed parcel information, Contact the PVA. Use the LRSN field as
  the unique parcel identifier."). Service
  `https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1` (293,467 parcels on 2026-11-03;
  `maxRecordCount` 2,000). LOJIC metadata: `https://www.lojic.org/sites/default/files/metadata/pva_parcel.htm`.
- PVA online search: `https://jeffersonpva.ky.gov` (Property Search; FAQ "Why do I need to subscribe to the PVA?").
- Kentucky has no statewide parcel or assessment download: parcels are held by each county's PVA (a search of the
  Kentucky Geography Network and the Department of Revenue found only county services).

## Terms, license, robots

- Louisville Metro Open Data Platform Terms of Use and License (Hub page item `d71a5507a1d04a679c7c49861d52a9eb`):
  "Louisville Metro's open datasets are published with the Open Data Commons Public Domain Dedication and License
  (PDDL) ... You are free to: Share ... Create: produce works or sell services/products from the data ... Adapt ...
  There are no copyright or attribution requirements." Reuse that re-publishes a dataset must identify "the source,
  version, and modifications"; datasets are "provided for informational purposes"; the publishing entity may
  update or overwrite them without notice. The parcel item's own `licenseInfo` is a LOJIC limitation-of-liability
  notice ("make NO REPRESENTATIONS OF ANY KIND ...").
- AI use: not addressed. Redistribution of the free layer: permitted (PDDL).
- robots.txt: `data.louisvilleky.gov` `Crawl-delay: 60`, disallow `/sites/`, `/admin/`, `/sessions/`, `/groups/`,
  `/people/`, `/workspace/`; `gis.lojic.org` 404 (no rules); `www.lojic.org` standard Drupal rules.

## What the file contains

Layer fields: `PARCELID`, `PARCEL_TYPE`, `LRSN`, `PIN`, `GLOBALID`, shape area and length. **No owner, address, class,
use, value or area attribute.** A second layer in the service is rights of way. The PVA's free web search shows owner,
parcel ID, assessed value, acreage and neighborhood one parcel at a time; its subscription search adds the Owner,
Legal and Sales searches, mailing address, land and improvement values, property class, sales history with deed
references, photos and sketches, tax information and year built / square footage.

## Gates

- **Purchase (a person).** The commercial facts (owner, class, value) are in the PVA's subscription data. Ask the
  Jefferson County PVA whether a bulk assessment-roll extract can be licensed for republication of facts, or file an
  open records request (KRS 61.870 et seq.) for the roll; scraping the subscription search is not allowed.

## Real run

Not run. The PDDL layer yields no commercial fact by itself (no category), so it was not downloaded.

## Known gaps

The only join key to PVA data is `LRSN`/`PARCELID`/`PIN`; a later purchased roll can be joined on it.
