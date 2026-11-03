# tn-shelby-assessor: Shelby County (Memphis), Tennessee certified parcels

Reviewed 2026-11-03. Status: **not verified (gated: host blocks automated clients; terms unread)**; no adapter.
FIPS 47157. Config: [`registry/sources/tn/tn-shelby-assessor.json`](../../../registry/sources/tn/tn-shelby-assessor.json).

## Publisher and URLs

- Shelby County Assessor of Property (GIS manager credited on the layer). Official site
  `https://www.assessor.shelbycountytn.gov` (403 to the collector, including `/robots.txt`); GIS page
  `https://www.assessor.shelbycountytn.gov/gis`. (`shelbycountyassessor.org`, which appears in search results, is not
  the county's site: it shows a sponsored-search overlay and was not used.)
- County open-data portal `https://data.shelbycountytn.gov`: every page answers 403 with a Cloudflare "Attention
  Required" challenge. Its `robots.txt` (readable) is Cloudflare-managed: `Content-Signal: search=yes,ai-train=no,
use=reference`, then a list of named AI crawlers, disallowed.
- Reachable: ArcGIS Server layer `https://scgis.shelbycountytn.gov/serverhigh/rest/services/Parcel/CERTParcel/MapServer/0`
  ("Shelby County Assessor of Property Parcels", "Certified parcel data and related tables"; copyright line
  "Shelby County Assessor of Property, Memphis, TN"). It answers queries from curl, but the collector's
  `discover` could not connect (Python's TLS refused the server: `UNSAFE_LEGACY_RENEGOTIATION_DISABLED`), and the
  host's `/robots.txt` returned 504.
- The Tennessee Comptroller's statewide parcel download excludes Shelby (see [southeast.md](../tier2/southeast.md)).

## Terms, license, robots

Not read: no page stating terms for the Assessor's data could be fetched. The layer carries no licence field.
Records are public under the Tennessee Public Records Act (T.C.A. 10-7-503). AI use: the county portal's content
signal says `ai-train=no`; for the Assessor's layer unknown. Because the layer is served from a host with no
readable terms and the county's own pages block the collector, nothing was downloaded beyond a count, a field
list and group-by statistics.

## What the file would contain

353,334 parcels on 2026-11-03 (`TAXYR` 2026). Fields: `PARID`, `OWNER` (40 characters), `OWNER_EXT`, owner mailing
parts (`OWN_ADRNO`, `OWN_ADRSTR` ..., `OWN_ADDR1`-`3`, `OWN_CITY`, `OWN_STATE`, `OWN_ZIP`), `PAR_ADDR1` (situs), `PAR_ZIP`,
`MUNI`, `CLASS`, `LANDUSE`, `LUC`, `LIVUNIT`, `ZONING`, `NBHD`, `Latitude`, `Longitude`. Owner names are present. No
value, area or year built. `CLASS` counts: `R` 308,788, `C` 21,747, `I` 4,109, `E` 15,892, `F` 2,791. `LUC` (land-use
code) sits under each class. `LANDUSE` is a text category that splits the commercial classes cleanly (group-by counts
on 2026-11-03): class `C`: MULTI-FAMILY 7,917, COMMERCIAL 6,317, OFFICE 2,893, VACANT 2,495, PARKING 929,
INSTITUTIONAL 460, SINGLE-FAMILY 314, INDUSTRIAL 237, COMMON AREA LAND 140, RECREATION/OPEN SPACE 44; class `I`:
INDUSTRIAL 2,636, VACANT 929, PARKING 330, COMMERCIAL 155, OFFICE 50. MULTI-FAMILY also appears in class `R` (8,990
parcels, presumably two- to four-family) and `E` (512), so a mapping of `B` = class `C` + MULTI-FAMILY, `F1` = class
`C` COMMERCIAL/OFFICE/PARKING, `F2` = INDUSTRIAL would put about 7,900 apartment-type, 9,200 commercial and office (10,100 with parking) and 2,900
industrial rows in scope (estimate; the `LUC` numeric code table, e.g. 059 = MULTI-FAMILY, 034 = COMMERCIAL, is not
published where the collector could read it, and multi-family in class `C` may include condominium units).

## Gates

- **Host blocks automated clients, and terms unread (a person).** Ask the Shelby County Assessor of Property (GIS)
  for the licence terms and a bulk certified-roll extract with values, class and land-use codes; or ask for the
  collector's user agent to be allowed on `assessor.shelbycountytn.gov`/`data.shelbycountytn.gov`. The county
  should also be asked to fix its TLS renegotiation setting if the ArcGIS Server route is to be used.

## Real run

Not run (counts above are service statistics).

## Known gaps

No values, building area or year built in the layer. The apartment/commercial split rests on the `LANDUSE` text, which a person should confirm with the Assessor.
