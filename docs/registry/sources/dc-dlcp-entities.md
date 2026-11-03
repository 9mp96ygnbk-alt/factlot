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

## Real run (2026-11-02)

Sample loaded through the feature service (first 100,000 rows by OBJECTID requested; 77,444 rows
were on disk when the adapter ran), with the collector's user agent and a 2 s interval; the file
is in the scratchpad (`corporate_registration_sample.csv`), not in the repo.

- 77,444 rows read, 77,444 entities kept, 0 skipped; 327,197 facts; 16.3 s (including linking).
- Statuses in the sample: revoked 47,733; active in good standing 18,240; dissolved 5,042;
  withdrawn 4,817; merged 904; inactive/cancelled 404; terminated 107; domesticated 96.
- Owner linking against the OTR sample (11,607 organisation owners): 1,203 linked, 1 ambiguous,
  10,403 unmatched (a 15 % entity sample; expect far more with the full file).

## Known gaps

- Revoked and dissolved entities dominate the file; the adapter keeps them with their status so
  that historical owners of record still resolve.
- Foreign entities' home jurisdiction is not in the file.
- Names are stored as the registrar keeps them (upper case, suffix in its own column).
