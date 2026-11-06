# ca-kern-assessor — Kern County, California (FIPS 06029)

Review record for the Assessor-Recorder's parcel and roll data. **Result: gated. The Assessor sells its
GIS database (parcels with use codes, assessee names and assessed values); the county's web host blocks
automated clients, so its terms and price list could not be read by the collector; the only free copy is a
partial City of Shafter re-host under an indemnity disclaimer. `verified: false`, no adapter, no file
archived.** Config: `registry/sources/ca/ca-kern-assessor.json`. Reviewed 2026-11-03.

## Publisher and URLs

- Publisher: Kern County Assessor-Recorder, Mapping and GIS.
  https://www.kerncounty.com/government/departments/assessor-recorder/property/mapping-gis (overview of the
  data sets and how to buy them), `.../mapping-gis/gis-data`, `.../property/assessor-use-codes` (use-code
  list), `.../assessor-recorder/forms`. All answered **HTTP 403 "Access Denied"** (Akamai error reference)
  to the collector's user agent on 2026-11-03, `robots.txt` included. What follows about those pages comes
  from search-engine summaries and is marked as such.
- Per those summaries: the GIS database "includes" parcel numbers, assessor map books, tax rate areas,
  owner/assessee names, use codes and assessed values; GIS maps and data are offered "as is" for convenience
  with hardcopy Assessor Maps remaining official; the use-code page says the Assessor does not guarantee the
  accuracy of use codes and that categorising properties by use code is not mandated by California law. Price
  and order form: not seen.
- **Free partial copy**: ArcGIS item `b5758bf53b3d40bd824eb606057f7389` "Parcels Public" (owner
  `jdelgadillo_shafter`, i.e. the City of Shafter; item modified 2023-09-21; 56 MB), service
  `https://services2.arcgis.com/LukbLC9Gps89zZa7/ArcGIS/rest/services/Parcels_Public/FeatureServer/1`
  (Query, Extract; `maxRecordCount` 2000). **37,628 features only** (the Shafter area), against a county of
  roughly 420,000 parcels. Credits: "Kern County Assessor's Office, Mapping Section; Kern Council of
  Governments; Merced County Association of Governments; City of Bakersfield, IT Division, GIS Services;
  City of Shafter, IT Department, GIS Division."
- Another hosted copy named `Kern_Parcels` (`services1.arcgis.com/8CpMUd3fdw6aXef7`) answered "Invalid URL"
  and was not examined.

## Terms, license, robots

- The Shafter copy's `licenseInfo` is the **Kern GEONET data-sharing disclaimer**: data "as is", the recipient
  "will forever waive" claims, must defend and indemnify "the Data Providers", and "will provide no copy or
  partial copy of any data to any other party ... without disclosing that the copy or partial copy was
  obtained from the Data Providers and without attaching the Disclaimer of Liability and Warranties
  paragraph." It is a recipient agreement, not an open licence; redistribution is conditional. AI use not
  addressed.
- `kerncounty.com`: robots.txt itself returns 403 (host blocks automated clients). `services2.arcgis.com`
  has no robots.txt restrictions for the REST query that was used.

## What the free copy contains (layout only; 3 sample rows read)

`APN` (8), `APN9` (9, with check digit; the documented join key to the separate tax-roll tables), `APN_LABEL`
(`026-010-04`), `ATN`, `ADDR_SITUS` (`655 N SHAFTER AV, SHAFTER`; blank on unaddressed land), `LEGAL_TYPE`,
`LEGAL_DESC`, `SHAPE_SQFT`, `SHAPE_ACRE`, `SUP_DIST`, `TRA`, `ROLL`, `ROLL_TYPE`, **`USE_CODE`** (four
characters, `4120`, `3105`) and **`USE_CODE_DESC`** (`Almond`, `Contractor,Oilfield`), `LAND_VAL`, `MIN_VAL`,
`IMP_VAL`, `OIFIX_VAL`, `PP_VAL`, `EX_TYPE`, `EX_VAL`, `NET_VAL`, `PROP8`, `BASEYR_VAL`, `ACRES`, `AG_PRES`,
`CITRUS_AC`. No owner name. The layer's description says the secured-roll tax data are in "separate database
tables" joined on `APN9`, which the Assessor holds.

## Gates (need a person)

1. **Host blocks automated clients and the data is sold.** The price and order form are on
   https://www.kerncounty.com/government/departments/assessor-recorder/property/mapping-gis/gis-data, which
   needs a browser. The GIS parcel database with use codes and assessed values is a purchase (owner names are
   in it; natural persons are never stored), and whether the county permits republication of the facts is
   not stated.
2. The Shafter copy is not a substitute: partial (37,628 parcels), three years old, indemnity terms.

## Real run

None. Layout read from the public REST endpoint (field list, count 37,628, three rows). No registry built.

## Known gaps

- Everything about price, terms and the sold file's layout (county site not readable by the collector).
- Kern's own use-code table (`assessor-use-codes` page) was not read.
