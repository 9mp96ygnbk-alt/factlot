# il-will-parcels: Will County, Illinois (FIPS 17197) tax map parcels

Review date: 2026-11-03. Verdict: **gated: terms (redistribution barred without explicit permission) and no owner, class or value in the free layer; `verified: false`; no adapter.**
Config: [`registry/sources/il/il-will-parcels.json`](../../../registry/sources/il/il-will-parcels.json).

## Publisher and URLs

- Will County GIS Department with the County Clerk Tax Extension; assessments by the Supervisor of Assessments (Joliet). Data page: <https://willcounty.gov/County-Offices/Administration/GIS-Division/Data/Vector> (shapefile downloads; not fetched).
  Property search: <https://www.willcountysoa.com/PropertySearchPortal> (search by sale date and amount, subdivision, owner name, property class; no bulk export found).
- Service: `https://gis.willcountyillinois.com/server/rest/services/Basemap/Parcels_20/MapServer/0` ("Parcels_20", 276,644 parcels, `maxRecordCount` 2000; no robots.txt).

## Terms, license, robots

- **Terms (item description).** "Under no circumstances may the data be redistributed or made available over a network without explicit permission from the Will County GIS Department. It is required that the Will County GIS Department be cited in any
  products generated from the data. The following source citation must be included: "Source Will County Tax Map Parcels" For custom requests a client must submit a written request stating the intended applications for the data to the Will County GIS Department.
  When the request is granted, data may be used only for the purposes explicitly stated in the written request." AI use is not addressed.

## What the file contains

Fields: `PIN`, `ParcelID`, `PREVIOUS_PIN`, `SUBTYPE` and edit-tracking fields. **No owner, class, address or value.** A parcel layer alone cannot be scoped to B, F1 or F2.

## Gates

A person must write to the GIS Department (`gis@willcountyillinois.com`) for permission to redistribute, and to the Supervisor of Assessments for an assessment roll file with PIN, class, owner and values, asking for the file's cost and terms.

## Real run

None. No adapter.

## Known gaps

No source of owners or class found. Illinois entity data: `il-sos-entities` (Tier 1, blocked).
