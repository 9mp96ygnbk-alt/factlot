# El Paso County, Texas: El Paso CAD (`tx-elpaso-cad`)

Review record for data policy §5. Reviewed 2026-11-03. **Not verified: gated on terms.** The
district publishes bulk files, but its Website Acceptable Use Policy prohibits bots and "AI training
data collection" without written authorization, while also telling bulk users to use the published
export files; a person has to decide. No file was downloaded and no adapter was written. County FIPS 48141. Config `registry/sources/tx/tx-elpaso-cad.json` (`verified: false`).

## Publisher and URLs

- Publisher: El Paso Central Appraisal District, 5801 Trowbridge Dr., El Paso, TX 79925.
- Page: <https://epcad.org/OpenGovernment> ("Open Government": Records Request, Public Data Access,
  CAD Reports, CAMA Datasets Downloads, GIS Data; the page text was read by the collector on 2026-11-03.
  Plain `curl` receives a Cloudflare managed challenge and another fetch tool HTTP 403; the
  collector's identified client is served normally. Nothing was done to get past the challenge.)
- Files listed (sizes from `Range: bytes=0-0` requests through the collector; nothing was downloaded):
  - `https://export.epcad.org/datasets/2026_Certified_Export_Files.zip` — 408,260,829 bytes, 2026-10-13
    (also `2025_Certified_Export_Files.zip`), in the True Automation "Appraisal Export Layout 8.0.34";
    `Appraisal%20Export%20Layout%20-%208.0.34.zip` (92,947 bytes, 2026-06-17), `Owner%20Agent%20Export%20Layout%20-%208.0.34.zip`.
  - `APPRAISAL_ROLL.zip` (122,338,947 bytes), `REAL_ESTATE.zip` (168,080,334), `PERSONAL_PROPERTY.zip`
    ("the current year's appraisal roll, real estate, and personal property data ... intended for
    development use only", 2026-10-13); `2026_Codes.zip`, `2026_Listings.zip` (codes and listings).
  - Weekly Property Search dumps (updated Sundays) on `propertysearch.blob.core.windows.net/abepublicfiles/`:
    `Properties2027Dump.zip` (21,830,459 bytes, 2026-11-01), `Owners2027Dump.zip` (15,301,442),
    `Deeds`, `Improvements2027`, `Lands2027`, `Rolls2027`, `TaxJurisdictions2027`, `Values2027`; "delimited
    Flat Files(txt) ... intended for development use only", column delimiter `~`, schema in `Schemas.txt`
    (3,365 bytes, dated 2016-03-11).
  - GIS: `https://blob.epcad.org/gis/parcels2026.zip` (86,532,772 bytes, "parcels with attribute data and
    TIF Codes (No Value Info)").
  - Notices of Appraised Value archive (needs 100 GB to unpack): not relevant.

## Terms, license, robots

- Disclaimer on the page: "All information contained herein, is considered in the public domain and is
  distributed without warranty of any kind"; the district may restrict or discontinue any part at any
  time.
- **Website Acceptable Use Policy** (<https://epcad.org/AcceptableUsePolicy>, read 2026-11-03):
  §1.2 "Website visitors may not use automated tools, bots, crawlers, scrapers, spiders, or similar
  technologies to access, collect, extract, harvest, or copy content, data, metadata, or other
  information from the Service without prior written authorization." and "Unauthorized automated
  access, including data mining, web scraping, content aggregation, AI training data collection,
  automated querying, or bulk extraction of information, is prohibited." §2.2: "Users requiring data
  for large-scale analysis, integration, application development, research, or other bulk-use purposes
  should utilize the official datasets and export files made available through the Open Government
  page whenever practicable. Use of these published datasets is strongly encouraged as an
  alternative to repetitive automated access of Property Search and Property Services
  applications." §3.1: EPCAD may rate-limit or block IPs.
- robots.txt (`epcad.org`): generic agents `Content-Signal: search=yes,ai-train=no,use=reference`, `Allow: /`,
  with `Disallow` for `/Account`, `/Error`, `/signalr`, `/Search`, `/Property/`, `/Kiosk/`, `/Iaao/`; a
  list of about 30 named crawlers (AI and others) is disallowed entirely (the FactLot bot is not named).
  The registry does not train models on source data.
- License: public record ("public domain" per the disclaimer). AI use: restricted as above.
  Redistribution: not addressed beyond "public domain".

## Gates

- **Terms.** Whether the weekly download of the official export files is permitted automated access is
  ambiguous: §2.2 invites bulk use of those files, §1.2 forbids bots and AI training collection without
  written authorization. **One action for a person:** decide that the published bulk files fall under §2.2,
  or (safer) ask EPCAD (general line 915-780-2131, or the webmaster address on the site) for written
  authorization to download the export files with an identified collector; record the answer in the
  config and set `verified` to `true`. The collector's identified user agent and 2 s spacing already
  meet §2.1.
- A Public Information Act request is the fallback (`Records Request` form on the Open Government page).

## Real run

None: nothing was downloaded. The certified export is in the Legacy 8.0.x True Automation family
(fixed-width text files; layout sheet per file), as are Travis's (8.0.33) and Tarrant's; the `tx_travis` adapter
will probably read it with its column positions checked against the 8.0.34 layout workbook
(unconfirmed). The `Properties`/`Owners` dumps (tilde-delimited) are smaller (37 MB together) and
carry a schema file, so they are the likelier first load once the gate is cleared.

## Known gaps

Everything: no source is loaded for El Paso County; its commercial parcel count is unknown.
