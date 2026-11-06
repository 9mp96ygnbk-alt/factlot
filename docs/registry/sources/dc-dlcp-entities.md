# District of Columbia: DLCP corporate registrations (`dc-dlcp-entities`)

Reviewed 2026-11-02. Registry jurisdiction `us-dc`. Adapter `factlot.registry.adapters.dc_dlcp_entities`
(`read_entities` → `EntityRecord`). Config `registry/sources/dc/dc-dlcp-entities.json`. **verified: true**.

## Publisher and URLs

Department of Licensing and Consumer Protection (DLCP), Business and Professional Licensing
Administration, Corporations Division (the Office of Corporate Registrar), republished daily on
Open Data DC as the dataset **Corporate Registration** (item `5238c4fd99c843a1bd7679a243747a8c`,
506,311 rows on 2026-11-02): "a snapshot of current data represented from the DLCP database of
business entities."

- Dataset page: `https://opendata.dc.gov/datasets/DCGIS::corporate-registration`
- Metadata API (collector landing page): `https://opendata.dc.gov/api/v3/datasets/5238c4fd99c843a1bd7679a243747a8c_0`
- Hub CSV export (confirmed by HEAD, 200 `text/csv`, redirects to `hub.arcgis.com`):
  `https://opendata.dc.gov/api/download/v1/items/5238c4fd99c843a1bd7679a243747a8c/csv?layers=0`
- Feature service: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/FeatureServer/0`
- Not used: **Basic Business Licenses** (item `85bf98d3915f412c8a4de706f2d13513`, 281,226 rows,
  CC-BY-4.0): licences (customer number, licence type and status, entity name and trade name,
  premise address with SSL), not entity registrations. It could later link licensed premises to
  SSLs.

## Terms, license, robots

Same as `dc-otr-real-property.md`: dataset license **CC-BY-4.0** ("This work is licensed under a
Creative Commons Attribution 4.0 International License"); the District data policy (Mayor's Order
2017-115 §X) states open data "are placed in the public domain" with "no restrictions on copying,
publishing, distributing, or using the data for a non-commercial or commercial purpose" and
attribution "not required, but is requested". AI use is not addressed. `opendata.dc.gov`
robots.txt: `Crawl-delay: 60`, API and download paths allowed. Attribution: District of Columbia
Department of Licensing and Consumer Protection, Open Data DC.

## What the file contains

One row per entity, 32 columns (publisher's spelling `BUSNIESS_ADDRESS_LINE1..4`):

| Column                                                                                        | Adapter use                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FILE_NUMBER` (`L00012345`, `C…`, `N…`, `P…`, `US-DC-FN…`)                                    | `registry_number`                                                                                                                                    |
| `BUSINESS_NAME`, `SUFFIX`                                                                     | `legal_name` (the suffix is appended when the name does not already end with it)                                                                     |
| `LOCALE` (`Domestic` / `Foreign`)                                                             | `state_of_formation` `DC` for domestic; unknown for foreign (the file has no home state)                                                             |
| `ENTITY_STATUS`                                                                               | `status` as a token: `active_in_good_standing`, `revoked`, `dissolved`, `withdrawn`, `merged`, `inactive_cancelled`, `terminated`, `domesticated`, … |
| `BUSNIESS_ADDRESS_LINE1..4`, `BUSINESS_CITY`, `BUSINESS_STATE`, `ZIPCODE`, `BUSINESS_COUNTRY` | `mailing_address` (country appended when not the US)                                                                                                 |
| `MODELTYPE`, `RA_*`, `EFFECTIVE_DATE`, report dates                                           | not used                                                                                                                                             |

There is no taxpayer number, so no `us-dc-taxpayer` crosswalk.

## Gates

None (no account, click-through, fee, or CAPTCHA). The Hub export streams slowly (see the OTR
record); the collector's first `snapshot` attempt is recorded in
`collected/dc-dlcp-entities/manifest.jsonl` as `error: The read operation timed out`.

### Platform terms read 2026-11-03

Terms and Conditions of Use for District Data, <https://dc.gov/page/terms-and-conditions-use-district-data> (HTTP 200, read 2026-11-03; reached from the Open Data DC footer, since <https://opendata.dc.gov/pages/terms-of-use> shows a sign-in message). Full notes: [`../requests/platform-terms/dc-district-data.md`](../requests/platform-terms/dc-district-data.md).

> Unless otherwise noted, the data on the Sites is public domain and made available with a Creative Commons CC0 1.0 Universal dedication.

> You can copy, modify, distribute, and perform the data, even for commercial purposes, all without asking permission.

Requested attribution: "Data retrieved from Open Data DC catalog (https://opendata.dc.gov)".

Read: no restriction on redistribution of catalog data, including commercial use. Logos and copyrighted or trademarked content are excluded. The dataset-level CC-BY-4.0 tag recorded above asks for attribution, which the registry already carries. The Hub host is Esri's; Esri's customer terms (E204/E300, [`../requests/platform-terms/esri-hub.md`](../requests/platform-terms/esri-hub.md)) bind the District as Esri's customer, not a downloader.

Esri / ArcGIS Hub. No separate public Hub terms page for downloaders was found. Esri's Master Agreement (E204CW, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-translations/english.pdf>) and Product-Specific Terms (E300, <https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf>) were read 2026-11-03 (HTTP 200, not accepted). Full notes: [`../requests/platform-terms/esri-hub.md`](../requests/platform-terms/esri-hub.md), [`esri-e204.md`](../requests/platform-terms/esri-e204.md), [`esri-e300.md`](../requests/platform-terms/esri-e300.md). E300 footnote 85:

> Software licenses and subscriptions included with ArcGIS Hub may only be used to support the community initiatives enabled by ArcGIS Hub.

Read: E204 and E300 bind Esri's customer (here, the publisher), not an anonymous downloader, and neither restricts redistribution of public records the publisher chooses to publish. The publisher's own terms recorded above still govern. Do not create an Esri account or accept either agreement to download a file.

## Real run (2026-11-03)

The full export was archived by the collector (`collected/dc-dlcp-entities/956587df9b128cef/Corporate_Registration.csv`, 163,355,532 bytes, document `fl:document:sha256-956587df9b128cef68d934a7e1f1d491624d7b3470a2e47e52b46c5c7ece036d`).
Command: `python -m factlot.registry.adapters.dc_dlcp_entities collected/dc-dlcp-entities/956587df9b128cef/Corporate_Registration.csv registry.db --as-of 2026-11-02`.

- Rows read 506,311; kept 506,311; invalid 0; distinct entities in the
  registry 506,305; facts written 2,140,408; 375 s.
- Archived by the weekly workflow dispatched for this source (run 41576886878, release
  `data-2026-11-03-41576886878`) because this connection dropped the Hub's transfer on every
  attempt; pulled into `collected/` with its manifest record.
- After the final linking pass over every loaded source, **7,919 of DC's 11,607 organisation owners of record resolve to a DLCP entity** by exact normalized name in a plausible jurisdiction (C23).

## Known gaps

- Revoked and dissolved entities dominate the file; the adapter keeps them with their status so
  that historical owners of record still resolve.
- Foreign entities' home jurisdiction is not in the file.
- Names are stored as the registrar keeps them (upper case, suffix in its own column).
