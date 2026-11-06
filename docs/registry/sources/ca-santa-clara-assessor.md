# ca-santa-clara-assessor — Santa Clara County, California (FIPS 06085)

Review record for the Assessor's secured roll. **Result: not obtainable without a purchase.
`verified: false`; no adapter written; nothing downloaded.** Config:
`registry/sources/ca/ca-santa-clara-assessor.json`. Reviewed 2026-11-02.

## Publisher and URLs

- Publisher: County of Santa Clara, Office of the Assessor. The site moved from
  `www.sccassessor.org` to https://asr.santaclaracounty.gov (the old host answers `301`).
- Bulk-data order pages: https://asr.santaclaracounty.gov/about-us/purchase-data/bulk-data ("Data File
  Order Form") and .../bulk-data-by-jurisdiction ("Subset Data Order Form", by city, school district or
  tax rate area). Order forms are PDFs (`Data File Order Form 2021.pdf`, a 2016 fee schedule and a 2016
  subset form were found through a search engine; the current versions were not readable).
- Contact on the forms: Public Service Unit, San Jose, 408-299-5500; payment by cheque payable to the
  Santa Clara County Assessor.
- County GIS hub (free): https://maps.santaclaracounty.gov/server/rest/services/opendata/SCCGISHUB/MapServer
  (ArcGIS Server; 120 layers; credits the Assessor, Planning, Parks and Technology Services).

## Terms, license, robots

- **Not read directly.** `asr.santaclaracounty.gov` and `www.sccassessor.org` return a Cloudflare
  "Attention Required" page to the collector's identified user agent and HTTP 403 to a plain fetch,
  including for `robots.txt`. Working around a bot challenge is outside the data policy (§1), so the
  order form, the fee schedule and any terms of use were **not** opened. The statements below come from
  search-engine summaries of those pages and are secondary evidence; a person must read the forms.
- Reported by those summaries: the bulk-data page says the county gives no warranty of accuracy and asks
  users to validate data before relying on it; the 2021 form says "Prices are subject to change each year
  without notice. Please call for latest order form"; the Assessor's web portal omits assessee names and
  offers view-and-print only.
- License, AI use, redistribution: **unknown** (no open-data licence; a purchase licence, if any, is in
  the order form). The county GIS hub layers carry only an "as is" disclaimer and the copyright line
  "County of Santa Clara"; no licence.
- robots.txt: unreadable (challenge page). The GIS host `maps.santaclaracounty.gov` has no robots.txt
  (404 from its Portal for ArcGIS).

## What the file contains

What the sold file contains, per the 2021 order form summary: the **Secured Assessment Roll** (back to 2004) with owner names, land and improvement values, exemptions and tax rate areas; the **Secured Master
File**, sold _with_ or _without Use Codes_; a **Property Situs File**; a **Legal Description File**; a key
change file; subsets by jurisdiction. The 2016 fee schedule listed the Secured Master File with Use Codes
(MF901) at $2,485 and without Use Codes (MF901B) at $495; a 2016 subset form priced current-master subsets
at $100 and $12 per thousand records. These are old and secondary: current prices must come from the
Assessor. Record layouts and the use-code table are not published on the order pages and were not found.

Use-code list: **not obtained** (it ships with the paid master file).

Free alternative reviewed: layer 116 **Parcels** of the county GIS hub (504,722 features, "as of FY 2025",
maximum 5,000 rows per query). Fields: `APN`, `TAX_RATE_AREA`, `SITUS_HOUSE_NUMBER`,
`SITUS_HOUSE_NUMBER_SUFFIX`, `SITUS_STREET_DIRECTION`, `SITUS_STREET_NAME`, `SITUS_STREET_TYPE`,
`SITUS_UNIT_NUMBER`, `SITUS_CITY_NAME`, `SITUS_STATE_CODE`, `SITUS_ZIP_CODE`, `NUMBER_OF_SITUS_ADDRESS`,
`AP_LP`, plus geometry. It has **no use code, no owner and no values**, so it cannot say which parcels are
commercial and yields no registry records. It could later give situs addresses for a parcel list from
another source; it is not catalogued as a source.

## Gates (need a person)

1. **Purchase.** The roll with Use Codes is a paid product; the price is on a dated form, to be confirmed
   by phone (408-299-5500).
2. **Order form and payment** by cheque, to the Public Service Unit. Not done in this review.
3. **Terms** of the order form: resale, redistribution and AI use are unread, including whether
   the registry may republish derived facts (class, situs, values) and whether owner names may be stored
   (the registry stores organisation names only).
4. **Alternative to purchase:** a California Public Records Act request for the roll; California Revenue
   and Taxation Code §408 and §408.3 govern what the Assessor must disclose and may charge. These were
   not researched in this pass.

### Terms read 2026-11-03

This memo is research, not legal advice.

No terms, price, layout, or address were readable. Each URL returned HTTP 403 (Cloudflare) and needs a person in a browser:

- https://asr.santaclaracounty.gov/about-us/purchase-data/bulk-data
- https://asr.santaclaracounty.gov/about-us/purchase-data/bulk-data-by-jurisdiction
- https://asr.santaclaracounty.gov/about-us/purchase-data/fee-schedule
- https://www.sccassessor.org/edocman/Data%20File%20Order%20Form%202021.pdf (final URL on this pass was https://asr.santaclaracounty.gov/ , HTTP 403)
- https://files.santaclaracounty.gov/exjcpb1531/2026-02/fy-2025-2026-countywide-master-fee-schedule.pdf?VersionId=JJDcTGki15sFK.2nqOtSbbYc05LtUa7j (HTTP 403)

Price per year: NOT CONFIRMED. Restrictive clause: NOT CONFIRMED. No search-indexed fee is quoted here.

**Statute.** Same capture as the other California assessors, read 2026-11-02, because leginfo returned HTTP 403 on 2026-11-03. Gov. Code § 7922.530(a) and Rev. & Tax. Code §§ 408(a) and 408.3(a)–(d), as captured, do not address commercial use or redistribution. Gov. Code § 7928.205 is NOT CONFIRMED. A county contract, if one exists, was not read and can still restrict the file.

Until the Assessor sends the current form, there is nothing to treat as a license and nothing to load.

## Real run

None. No file was downloaded and no adapter was written. `discover` on the order page was attempted and
the collector recorded `error: HTTP Error 403: Forbidden` (`collected/ca-santa-clara-assessor/discovered.json`).
`snapshot` skips the source because it is unverified.

## Known gaps

- Terms, current prices, field layout and use-code list are all unknown until the forms are obtained.
- Owner names are in the paid roll; the Assessor's public portal withholds them.
- If the roll is bought, the adapter should be `ca_santa_clara.py`, account system `scc_apn` (APN
  printed `123-45-678`), county FIPS `085`.
