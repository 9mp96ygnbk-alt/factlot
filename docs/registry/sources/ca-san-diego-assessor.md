# San Diego County Assessor/Recorder/County Clerk (California, FIPS 06073): access review

**Verdict (reviewed 2026-11-02): no bulk roll product from the office; a free parcel layer with
assessor attributes exists but sits behind an end-user agreement a person must read and accept.
`verified: false`. No adapter written, nothing bulk-downloaded.** Config:
[`registry/sources/ca/ca-san-diego-assessor.json`](../../../registry/sources/ca/ca-san-diego-assessor.json)
(`files` is empty).

## Publisher and URLs

- Publisher of the roll: San Diego County Assessor/Recorder/County Clerk (ARCC), `www.sdarcc.gov`
  (Assessor and Recorder/County Clerk combined; Jordan Z. Marks).
- Property information: <https://www.sdarcc.gov/content/arcc/home/divisions/assessor/property-records.html>
- Assessor fee schedule: <https://www.sdarcc.gov/content/arcc/home/wantto/assessor-fee-schedule.html>
- Per-parcel roll search: <https://sdarcc.gov/content/arcc/home/divisions/assessor/secured-assessment-roll-search.html>
- Vendor handoff: ParcelQuest ("PQ Lite"), disclosure at
  <https://www.sdarcc.gov/content/arcc/home/divisions/assessor/parcel-quest-disclaimer.html>.
- County Auditor tax roll files: <https://www.sandiegocounty.gov/auditor/trdf.html> ($86 per file,
  tax-bill data, a different office; not reviewed further).
- Parcel layer publisher: SanGIS (the city/county GIS joint powers authority),
  <https://www.sangis.org>; hosted REST service `https://geo.sandag.org/server/rest/services/Hosted/`
  (`Parcels`, `Parcels_North`, `Parcels_South`, `Parcels_East`).

## Terms, license, robots

- **Access note.** `www.sdarcc.gov`, `www.sandiegocounty.gov`, `gis-public.sandiegocounty.gov` and
  `rdw.sandag.org` close the connection (empty reply) when the request carries the collector's
  user agent. The same pages load in the browser pane. The data policy forbids spoofing identity or
  working around blocks, so ARCC pages were read in the browser pane for review only; robots.txt
  for those hosts could not be fetched. (One plain `curl` request to `sdarcc.gov/robots.txt` without
  the collector's user agent returned 200; it was a mistake and was not repeated.)
- ARCC property information page: "Online: Assessor Parcel Numbers, Property Characteristics, and
  Assessor Maps are available online through ParcelQuest." "By Phone: Property ownership and address
  information are provided over the phone." The page lists no bulk file and no data order form.
- Assessor fee schedule (the full list): real estate document copies $2.00 first page and $0.05
  after; certification $1.00; screen print $1.00 per page; Assessor parcel map $2.00; **property
  characteristic $1.00 per parcel**; map copy over 11x17 $13.00; building records no fee at this time.
  No electronic roll or data-file line.
- Per-parcel search page: "property ownership information cannot be provided on the internet in
  accordance with California Government Code section 6254.21."
- ARCC's parcel-map FAQ: more than 29,128 Assessor's maps showing almost 1,001,029 parcels.
- **SanGIS parcel layer.** Item description (SanGIS "PARCELS" metadata, 2015 edition): "This layer
  contains only those attributes from the Assessor's Master Property Record (MPR) or Parcel
  Assessment Record (PAR) that have been authorized for release to the public by the
  Assessor/Recorder/County Clerk's (ARCC) Office." Use limitation: refer to the SanGIS GIS data
  end-user agreement and disclaimer (`sangis.org/Legal_Notice.htm`, which returned 404 to the
  collector and was not read). Search results for the SanGIS Data Warehouse say a user first agrees
  to that end-user agreement before downloading, and that owner-level parcel files need a login; the
  hosted REST item has no license text. `geo.sandag.org` serves no robots.txt (404, so allowed).
  `sangis.org` and its Hub set `Crawl-delay: 60`.

## What the file contains (SanGIS parcel layer, from the service's field list; not downloaded)

Hosted layer fields (confirmed from the service JSON): `apn`, `apn_8`, `parcelid`, `situs_street`,
`situs_suffix`, `situs_pre_dir`, `situs_post_dir`, `situs_address` (house number), `situs_fraction`,
`situs_suite`, `situs_community`, `situs_juris`, `situs_zip`, `legldesc`, `asr_land`, `asr_impr`,
`asr_total`, `acreage`, `taxstat`, `ownerocc`, `tranum`, `nucleus_use_cd` (3-character use code,
"225 types" per the metadata), `asr_landuse` (older, 91 generalized types), `nucleus_zone_cd`,
`asr_zone`, `unitqty`, `year_effective`, `total_lvg_area`, `usable_sq_feet`, `bedrooms`, `baths`,
`qual_class_shape`, `doctype`, `docnmbr`, `docdate`, and geometry. **There is no owner-name field.**
Feature counts from the service: `Parcels` 1,089,056 (North 496,166, South 552,954, East 95,796).
Three sample rows (metadata queries) showed values such as `nucleus_use_cd` `111`, `asr_landuse` `11`,
`unitqty` `1`. The metadata warns that use and zoning fields "are not regularly maintained" and
should be used "as an approximate guide". The code-to-description table for `nucleus_use_cd` was not
found, so no category mapping was written.

## Gates (need a person)

1. **ARCC bulk data**: none sold. Property characteristics are $1.00 per parcel at the counter;
   bulk is routed to ParcelQuest (paid). Contact: Assessor Public Information, (619) 236-3771,
   ARCCHELP@sdcounty.ca.gov.
2. **SanGIS end-user agreement**: a person must read the SanGIS Legal Notice and the data-warehouse
   disclaimer, decide whether they permit redistribution and AI use, and (if the download path
   requires it) accept them. The collector never accepts terms, so the unauthenticated REST layer
   was left alone beyond metadata, three sample rows and feature counts (about nine small requests
   to `geo.sandag.org`).
3. Nothing was purchased and no account was created.

### Terms read 2026-11-03 (gates pass)

This memo is research, not legal advice; the founder holds no attorney or real estate license.

**Fee schedule.** https://www.sdarcc.gov/content/dam/arcc/assessor/forms/other-assessor-forms/PUB%20INFO%20FEE%20SCHEDULE.pdf , read 2026-11-03. Address: San Diego County Assessor, Public Information, 1600 Pacific Highway, Suite 103, San Diego, CA 92101, (619) 236-3771.

> Property Characteristic                             $ 1.00 per parcel

That line is a counter copy, not a bulk file. No bulk-roll price is on the schedule. Building records: "No fee at this time." Email on the property page: ARCCHELP@sdcounty.ca.gov. https://www.sdarcc.gov/content/arcc/home/divisions/assessor/property-records.html , read 2026-11-03.

> Are street addresses and ownership shown on Assessor's maps?
> No.

**ParcelQuest county disclaimer.** https://www.sdarcc.gov/content/arcc/home/divisions/assessor/parcel-quest-disclaimer.html , read 2026-11-03.

> Customers may conduct up to 25 searches in any
>   30-day period free of charge.
> Searches in excess of that threshold may require a subscription to
>   ParcelQuest’s data services.

Continue URL https://assr.parcelquest.com/impl/sdxassr redirected to the same ParcelQuest Lite agreement quoted for Orange County. "I Accept" was not clicked. The agreement prohibits publishing the Content. The Lite page's own limit (50 searches and 25 maps per month) does not match the county's 25-searches-in-30-days sentence. Subscription dollars: NOT CONFIRMED.

**SanGIS.** Price list, effective September 1, 2022, https://gis.sangis.org/Documents/services/PriceList.pdf , read 2026-11-03.

> Every three months SanGIS creates an 8GB Flash Drive containing the most requested public layers in ready
> to use shape file format (not zipped) for $75.

$75 x 4 = $300 per year if the drive is bought each quarter. Custom extracts are $100 an hour with a $100 minimum. No use or resale clause is in the price list. It is not the assessor roll. These URLs were not usable: https://www.sangis.org/ (JS shell), https://www.sangis.org/pages/download-data (JS shell), https://www.sangis.org/Legal_Notice.htm (HTTP 404, 0 bytes), https://sangis.org/privacy.html (HTTP 404, 0 bytes). The founder should open the legal-notice URL.

**Statute.** NOTES.md, read 2026-11-02. Same silence on commercial use and redistribution as the other California assessor notes. Gov. Code § 7928.205 is NOT CONFIRMED.

No ARCC bulk license was read, so there is no file to treat as cleared for the registry. ParcelQuest Content is restricted. Draft: `../requests/orders/ca-san-diego-assessor-order-draft.md`.

## Real run

None. No file was downloaded, so there are no row counts and no snapshot.

## Known gaps

- Terms for the SanGIS layer unread; use-code table for `nucleus_use_cd` not obtained.
- The layer is a SanGIS compilation of Assessor attributes, not the secured-roll tape: it has no
  owners, no tax-roll year field, and its values are the assessor values as of SanGIS's last load.
- The REST service holds one county-wide table; a filtered pull by use code (as the Los Angeles
  adapter does) would take about 20 pages of 2,000 rows once the terms are cleared.
