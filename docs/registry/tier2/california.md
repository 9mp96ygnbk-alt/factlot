# Tier 2: California (Sacramento, Contra Costa, Fresno, Kern, Ventura, San Joaquin, San Mateo)

Researched 2026-11-03. Method: [README.md](README.md#method).
Tier 1 California ([sources/README.md](../sources/README.md)) learned that Los Angeles and San Francisco publish rolls
without owner names and Orange, San Diego and Santa Clara sell them. The seven Tier 2 counties repeat that: **no free
file carries an owner-of-record name** (Fresno states it omitted assessee names under Gov. Code § 6254.21), and only
two of the seven publish a free file with a use class, so a roll without owners but with situs, class and values is
the best on offer.

## Counties

| County (rank)     | Source id                  | Status                                                                                                                              | Licence                                                                                                                 | Owner names                                              | Sample counts                                                                                                                                   | What clearing the gate needs                                                                                                                                                                      |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sacramento (23)   | `ca-sacramento-assessor`   | **verified**; adapter `ca_sacramento`; layer has class and lot size, no values (values are free by e-mail request)                  | CC0 public-domain dedication (item licenseInfo; Hub record tags CC-BY-4.0)                                              | no                                                       | Real run: 20,053 parcels kept (B 3,664; F1 11,764; F2 4,625), 99,110 facts, 0 owner names; 3 exports, 4.1 MB; snapshot ids in the review record | None to load. Optional: e-mail `assessor@saccounty.gov` for the free electronic secured roll (adds assessed values).                                                                              |
| Contra Costa (41) | `ca-contra-costa-assessor` | none usable: free monthly parcel file has APN and situs only, no use code; Assessor site blocks automated clients                   | None (liability disclaimer only)                                                                                        | no                                                       | 387,936 parcels in the 42 MB file (387,593 distinct APNs); 0 commercial identifiable                                                            | Ask the Assessor (`contracosta.ca.gov/assessor`, open in a browser) for the secured roll or property characteristics with use codes, its price, and whether republication is allowed.             |
| Fresno (48)       | `ca-fresno-assessor`       | gated: purchase (free roll is a values-only PDF; use codes are in the paid file)                                                    | None on the free PDF; Assessor sells the roll                                                                           | no (omitted in free files; paid roll has them)           | 0 loaded; free 2025 roll PDF 17 MB read for layout; 309,837 assessable parcels                                                                  | Mail a written request and cheque to Fresno County Assessor, Attn Data Sales, P.O. Box 1146, Fresno CA 93715 for Property Characteristics ($15,491.85) and Secured Roll ($48.70).                 |
| Kern (62)         | `ca-kern-assessor`         | gated: host blocks automated clients (`kerncounty.com` returns 403) and purchase; only a partial 37,628-parcel Shafter copy is free | Kern GEONET disclaimer on the Shafter copy (indemnity; disclaimer must travel with copies); county data sold            | no (sold file has them)                                  | 0 loaded; Shafter copy 37,628 parcels with `USE_CODE`                                                                                           | In a browser, get the Assessor-Recorder GIS data price and order form (`.../assessor-recorder/property/mapping-gis/gis-data`), order the parcel database with use codes, ask about republication. |
| Ventura (77)      | `ca-ventura-assessor`      | gated: records request (+ signed public information agreement); Assessor and GIS hosts block automated clients                      | None (reference-only disclaimer); layer has APN and centroid only                                                       | no                                                       | 0 loaded; free layer 268,134 parcels (APN only)                                                                                                 | Submit the Assessor's public records request for the secured roll and sign the public info agreement (`assessor.venturacounty.gov/assessor-data/public-records-request/`).                        |
| San Joaquin (80)  | `ca-san-joaquin-assessor`  | gated: terms (a complete free roll exists but states no licence; county terms need written authorization for reuse)                 | None stated (CKAN "No License Provided"); county GIS terms: indemnity, reuse by others only if "authorized, in writing" | no (mailing address and a care-of line only; not stored) | 0 loaded; layer 253,428 parcels: 219,197 residential, 9,171 commercial, 3,821 industrial, 1,222 parcels of 5+ units (use codes 41-48)           | Ask the county (Assessor or Public Works GIS) in writing to authorize copying and redistributing the Open Data "Parcels" layer; then set `verified` and add the adapter (layout mapped).          |
| San Mateo (93)    | `ca-san-mateo-assessor`    | gated: purchase (open parcel layer is public domain but has no use code or values)                                                  | Public domain (parcel layer); roll sold at $305 per file                                                                | no (sold roll has them)                                  | 0 loaded; open layer: situs and land area only (rows updated 2024-08-14)                                                                        | E-mail `Secured-Support@smcacre.gov` to order the Secured Assessment Roll Master ($305) and Property Characteristics ($305); ask about republication.                                             |

Review records: [Sacramento](../sources/ca-sacramento-assessor.md), [Contra Costa](../sources/ca-contra-costa-assessor.md),
[Fresno](../sources/ca-fresno-assessor.md), [Kern](../sources/ca-kern-assessor.md),
[Ventura](../sources/ca-ventura-assessor.md), [San Joaquin](../sources/ca-san-joaquin-assessor.md),
[San Mateo](../sources/ca-san-mateo-assessor.md). Configs: `registry/sources/ca/<source id>.json`.

## Patterns worth knowing

- **ArcGIS Hub download API with `where`** (Sacramento, as in Tier 1 Los Angeles) lets the collector fetch only the
  commercial classes; the first request for a new filter answers `302` to a cached CSV or (when the export is still
  being built) is recorded as `not_ready` — run `snapshot` again.
- **Two of seven counties publish a free class field** (Sacramento's land-use class; San Joaquin's use code). The
  other five publish parcels without any class, so commercial scope needs a purchase or records request.
- **Four county web hosts block automated clients** (Kern, Ventura Assessor, Ventura GIS, Contra Costa Assessor):
  their pages need a person's browser; their REST or file hosts (`gis.cccounty.us`, `services*.arcgis.com`) did not.
- **Fees seen**: San Mateo $305 per file; Fresno $15,491.85 for property characteristics; Sacramento's secured
  roll is free by e-mail; Contra Costa, Kern and Ventura prices were not readable.

## Entity registries for California

California Secretary of State business entities: already reviewed in Tier 1
([ca-sos-entities](../sources/ca-sos-entities.md)): no free bulk file; bulk order behind a bizfile Online account,
`verified: false`. Nothing in this region changes that; owner resolution for these seven counties waits on
(a) the paid roll files above and (b) the SOS bulk order. Because every free California roll lacks owner names, the
registry cannot link these parcels to entities until the paid rolls (which carry the assessee) are bought.
