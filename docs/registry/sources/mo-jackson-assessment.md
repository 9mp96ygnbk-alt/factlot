# mo-jackson-assessment: Jackson County, Missouri (FIPS 29095) Assessment Department real property data

Review date: 2026-11-03. Verdict: **gated: records request. No bulk file or open layer found; `verified: false`; no adapter.**
Config: [`registry/sources/mo/mo-jackson-assessment.json`](../../../registry/sources/mo/mo-jackson-assessment.json).

## Publisher and URLs

- Jackson County, Missouri Assessment Department: <https://www.jacksongov.org/Government/Departments/Assessment> and Real Property Accounts <https://www.jacksongov.org/Government/Departments/Assessment/Real-Property-Accounts>.
- Property portal <https://publicaccess.jacksongov.org/> (search by address or parcel id; the county's news release says it is not an official or certified source); Real Estate Sales Search (Certificates of Value since 2007);
  parcel viewer <https://jcgis.jacksongov.org/parcelviewer> (timed out twice for the collector after 45 s; its notice says the information is provided "pursuant to Section 610.011, RSMo"); an Open Records Request online portal on the county's Online Forms page.
- `jacksongov.org/robots.txt` disallows only named content pages.

## Terms, license, robots

No licence, terms of use or bulk-data page found. Missouri records are public under the Sunshine Law (RSMo ch. 610). Commercial resellers list about 312,000 parcels (not used).

## What the file contains

No file.

## Gates

A person must submit an Open Records Request through the county's online portal for the real property assessment file in electronic form (parcel number, owner of record, mailing address, situs, class, land use, assessed and appraised values, acreage, building area, year built), ask for the cost estimate before agreeing to pay,
and record the response. Use the pattern in [public-information-requests.md](../public-information-requests.md).

## Real run

None. No adapter.

## Known gaps

Kansas City, Missouri open data (data.kcmo.org) was not checked for a parcel layer; whether the parcel viewer's server offers a public REST layer (it did not answer). Missouri entity data: `mo-sos-entities`.
