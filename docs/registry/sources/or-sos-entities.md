# or-sos-entities: Oregon Secretary of State, Corporation Division, "Active Businesses - ALL" (data.oregon.gov dataset tckn-sxa6)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/or/or-sos-entities.json`](../../../registry/sources/or/or-sos-entities.json). **Gated on terms; no adapter.** Tier 2, west region
([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: Oregon Secretary of State, Corporation Division (agency name on the dataset), on Oregon's Open Data Portal (Socrata).
  Dataset: <https://data.oregon.gov/d/tckn-sxa6> ("All Active businesses - Principal Place of Business address, Mailing address, Registered Agent, Authorized
  Representative"), category business, tag "business registry", provenance "official", published, data publishing frequency weekly; rows updated
  2026-10-27 (the dataset's `rowsUpdatedAt`).
- Files: CSV at <https://data.oregon.gov/api/views/tckn-sxa6/rows.csv?accessType=DOWNLOAD> (`Content-Disposition: Active_Businesses_-_ALL.csv`) or the
  resource API <https://data.oregon.gov/resource/tckn-sxa6.csv?$limit=20000>. A sibling dataset "Active Businesses - County Data" and monthly "New Business
  List" datasets exist; the Secretary of State also posts a monthly "Business Report" PDF.

## Terms, license, robots

- No license field on the dataset (Socrata `licenseId` and `license` are empty; no attribution). The portal footer cites ORS 276A.368 and links
  Terms of Service and Privacy Policy; the Terms of Service story (`/stories/s/Terms-of-Use/4t68-3hzv`) redirects to a sign-in page, so the terms were not read and no
  account was created.
- No Secretary of State page was found that states terms for the open dataset or describes a paid bulk product (the SOS site has product pages for
  searches; none was located by the review).
- robots.txt (`data.oregon.gov`): `Crawl-delay: 1`, disallows `/api/odata/` and `/api/collocate*`; `/api/views/` and `/resource/` are allowed.

## What the file contains

One row per (entity, association). Columns: `registry_number`, `business_name`, `entity_type`, `registry_date`, `associated_name_type` (PRINCIPAL PLACE OF
BUSINESS, MAILING ADDRESS, REGISTERED AGENT, AUTHORIZED REPRESENTATIVE), `first_name`, `middle_name`, `last_name`, `suffix` (filled for agents and authorized
representatives, mostly natural persons), `not_of_record_entity`, `entity_of_record_reg_number`, `entity_of_record_name`, `address`, `address_continued`, `city`,
`state`, `zip`, `jurisdiction` (state or country of formation), `business_details` (a link to the SOS search page). Only **active** entities are included; there
is no status column. In the first 20,000 rows (6,746 distinct entities): PRINCIPAL PLACE OF BUSINESS 6,738, REGISTERED AGENT 6,556, MAILING ADDRESS 6,491,
AUTHORIZED REPRESENTATIVE 215; entity types DOMESTIC NONPROFIT CORPORATION 11,807 rows, DOMESTIC BUSINESS CORPORATION 5,896, FOREIGN BUSINESS CORPORATION 834,
ASSUMED BUSINESS NAME 429, DOMESTIC LIMITED LIABILITY COMPANY 139 and others; jurisdiction OR 18,860, DE 305, WA 157, CA 147. (The sample is ordered by
registry date, oldest first, so it is mostly old nonprofits; its mix is not the whole file's.) Third-party sources put the file at about 520,000 active entities.

An adapter would take the PRINCIPAL PLACE OF BUSINESS row (else MAILING ADDRESS) as the entity's address, `registry_number` as the number, `jurisdiction` as the state of
formation, and ignore the agent and representative rows (natural persons); status would be `active` for every row.

## Gates

Terms. The download needs no account or fee, but no license is stated and the portal's terms were not readable without signing in. A person must read the Terms of
Service (sign in at data.oregon.gov with a personal account, which the collector never does) or ask the Corporation Division (503-986-2200) for a written statement
that the weekly Active Businesses file may be redistributed, then set `verified` true; the adapter (about 100 lines, modelled on `co_sos_entities.py`) can be written from the
layout above and a full file.

## Real run

None (gated). For the review: the 20,000-row sample (6.7 MB) and, by mistake of the test command, the first 43.5 MB of the full CSV stream, which was cut off after 90 s;
neither was kept in the repository.

## Known gaps

Active entities only (dissolved entities that still own parcels will not link); rows are per association, so deduplication by `registry_number` is needed; the DNS name
`data.oregon.gov` failed to resolve from the review machine for part of the session and then resolved.
