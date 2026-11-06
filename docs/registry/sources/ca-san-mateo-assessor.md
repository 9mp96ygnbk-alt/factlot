# ca-san-mateo-assessor — San Mateo County, California (FIPS 06081)

Review record for the Assessor-County Clerk-Recorder and Elections office (ACRE). **Result: gated
(purchase). The open-data parcel layer is public domain but has no use code or values, so the commercial
scope cannot be derived; the roll and property characteristics are sold for $305 each. `verified: false`, no
adapter, nothing archived.** Config: `registry/sources/ca/ca-san-mateo-assessor.json`. Reviewed 2026-11-03.

## Publisher and URLs

- Open data portal: https://data.smcgov.org (Socrata). Dataset `nr6j-72z7` "Parcels" ("Active Parcels for the
  County of San Mateo"; category Government; tags parcel, parcels, apn; rows updated 2024-08-14). Catalog search
  of the portal for "assessor", "parcel" and "property" finds only this layer, a Williamson Act layer and
  planning layers.
- Assessor: https://smcacre.gov/assessor (assessor@smcacre.gov; "Assessor Data Inquiries:
  Secured-Support@smcacre.gov"; 555 County Center, 3rd Floor, Redwood City). Fee page
  https://smcacre.gov/assessor/assessment-data-fees (read 2026-11-03):

  | Product                                                                                                                | Fee     |
  | ---------------------------------------------------------------------------------------------------------------------- | ------- |
  | Secured Assessment Roll Master, vertical pipe delimited CSV                                                            | $305.00 |
  | Unsecured Assessment Roll Master, Excel and CSV                                                                        | $305.00 |
  | Secured or Unsecured Print Roll File, PDF                                                                              | $120.00 |
  | Assessor's Map photocopy                                                                                               | $2.00   |
  | Property Characteristics (residential, apartment, condominium, mobile home, hotel/motel, industrial, or office/retail) | $305.00 |
  | Property Sales History                                                                                                 | $305.00 |
  | Secured Master File (Current Working Roll), pipe delimited CSV                                                         | $305.00 |

  The office says the Assessor roll has "approximately 237,000 assessments each year" (221,000 units on the
  secured roll).

## Terms, license, robots

- Parcel layer: Socrata `licenseId` `PUBLIC_DOMAIN` ("Public Domain"). Redistribution permitted; AI use not
  addressed (a public-domain dedication places no limit).
- The purchased roll: no terms or order form were found on the fee page; whether the county allows
  republication of purchased data is not stated. Not requested.
- robots.txt: `data.smcgov.org` `Crawl-delay: 1` with only browse-query paths disallowed; `smcacre.gov` is a
  Drupal site that disallows internal paths (`/core/`, `/profiles/`...) only. The collector's 2-second spacing
  was kept.

## What the open layer contains

Socrata `nr6j-72z7`, columns: `objectid`, `apn` (9 digits, `011171400`), `situs_addr` (`1207 EDGEWOOD WAY`),
`property_review` (URL), situs parts (`situs_no1`, `situs_no2`, `situsfraction`, `situsdirection`,
`situs_street`, `situs_type`, `situs_box`, `situs_city`, `situs_state`), `uninc` ("Incorporated" or not),
`spacenumber`, `assessor_map` (URL to a scanned map), `landarea` (square feet as text), `county`, `shape`
(polygon in WKT). **No use code, no values, no owner.** A three-row sample was read; the full table was not
downloaded.

## Gates (need a person)

1. **Purchase.** The **Secured Assessment Roll Master ($305)** and **Property Characteristics ($305)** (use
   codes and building facts) are ordered by e-mail to Secured-Support@smcacre.gov; whether the files may be
   republished is not stated. The county's payment and delivery route is not published on the fee page.
2. Optional: the free parcel layer alone adds situs and land area but, with no use code, would create no
   commercial records.

## Real run

None. No file was archived and no registry built.

## Known gaps

- The layout, use-code table and terms of the paid files.
- The layer's last row update is 2024-08-14, so it may lag the roll.
