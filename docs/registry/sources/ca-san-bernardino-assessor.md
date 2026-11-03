# San Bernardino County Assessor-Recorder-County Clerk (California, FIPS 06071): access review

**Verdict (reviewed 2026-11-02): free bulk secured-roll files exist, with owner names and every
address field withheld. `verified: false` only because no file has finished downloading yet. No
adapter written: the layout was read from the publisher's PDFs, not from a real file.** Config:
[`registry/sources/ca/ca-san-bernardino-assessor.json`](../../../registry/sources/ca/ca-san-bernardino-assessor.json).

## Publisher and URLs

- Publisher: San Bernardino County Assessor-Recorder-County Clerk (ARC), `arc.sbcounty.gov`.
- Page: <https://arc.sbcounty.gov/property-information/> ("Assessor Property Data Files"), plain links
  under `https://arc.sbcounty.gov/wp-content/uploads/sites/70/arcforms/`:
  - `npp.cdrom_.publicuc.sec_.a.zip` secured roll, annual (July 2026 roll; 23.4 MB, Last-Modified 2026-07-01)
  - `Secured-Roll.zip` secured roll, latest monthly (10/1/2026; 20.5 MB, Last-Modified 2026-10-02)
  - `25-26.zip` ... `17-18.zip` prior annual rolls
  - `PIMSPropertyCharacteristics_20260617_7928_205.zip` property characteristics (49.5 MB)
  - `npp_7928_205.cdrom_.zip` owner transfer file, plus monthly current/all owners
  - layouts: `NPP891-SecuredPublicRollWLegal.pdf`, `Secured-UnsecuredRollFileUpdatedMonthlyRecordLayout.pdf`,
    `Characteristic_Layout_Info_WithGovtCode.pdf`
- Also on the page: parcel maps (monthly zips), Assessor GIS dashboard, GIS shapefiles via the county
  GIS team (<https://open.sbcounty.gov/>), and third-party vendors for special queries.

## Terms, license, robots

- No fee, form, login or click-through for the files: they are ordinary links (sizes confirmed by HEAD, HTTP 200).
- County website policy (<https://main.sbcounty.gov/policy/>), operative sentence: "Information provided on
  this website is intended to allow the public immediate access to public information." No license, no AI-use
  or redistribution statement.
- Roll page, "Limitation of liability": "Data provided by the San Bernardino County Assessor's Office is
  maintained for internal use only in the determination of property value for the purpose of taxation."
  It then disclaims accuracy and warranties. I read this as a statement of purpose inside a disclaimer, not a
  use restriction, but it is the one sentence a person should confirm before the flag is flipped.
- "Names and address information protected per California Government Code Section 7928.205."
- `arc.sbcounty.gov/robots.txt`: generic agents disallow only `/wp-admin/` (except admin-ajax) and calendar
  query strings; SemrushBot is disallowed. Downloads are allowed. `main.sbcounty.gov` did not answer robots.txt.

## What the file contains (from the publisher's layouts; no file opened)

- Tilde (`~`) delimited, header row. Monthly file fields: `REPORT NBR`, `PARCEL` (book 4, page 3, line 2,
  type 1, suffix 3), `LAND TYPE`, `SIZE/RANGE`, `USE`, `LAND VALUE`, `IMPR VALUE`, `PERS PROP VALUE`,
  `EXEM VALUE`, `HOX INDICATOR`, `TRA`, `AREA ACRE`, `TAX STATUS`, `BASE YEAR`. **`NAME`, all `SITUS` fields,
  `MAIL ADDR`, `LEG1-4`, `DBA NAME` are marked HIDDEN.** The annual NPP891 layout (Roll Year 2026: 800,443
  secured and 74,177 tax-exempt records) adds district, responsible group, improvement penalty, exemptions,
  `Other Gross Leasable Area`, and still lists the name and situs fields; whether they are blank in the file is unconfirmed.
- Land Type (coarse zoning-style class): 01 Industrial, 02 Administrative/Professional, 03 Commercial,
  04 Public Facilities, 05 Single Family Residential, 06 Multi Family Residential, 07 Agricultural,
  08 Multiple Zonings, 09 Restricted.
- Use code: 4 characters, "several hundred different values; list is available on request" in the roll
  layout, but the **full table is Appendix B ("Property Use Codes") of the Property Characteristics layout**,
  e.g. `0610 SFR 5-14` / `0611 APT 5-14` (apartments 5-14 units), `0621 APT 15+`. A mapping to B/F1/F2 should
  be built from that appendix (not done).
- Property characteristics file: year built, units (`REC-OTHR-NBR-UNITS`, apartment unit counts), areas, lot size.
- Consequence: parcels would carry APN, use code, values, acreage, but **no situs address and no owner**.

## Gates (need a person)

None for access. Confirm the "internal use only" sentence (above) and decide whether a roll without situs
or owner is worth loading.

## Real run

None. A collector snapshot run stalled: the server delivered about 3 MB of the first file and then sent
nothing, on a connection shared with about twenty other collectors. No rows were read; there is no snapshot id.
Re-run `python -m factlot.collector snapshot --config registry/sources/ca/ca-san-bernardino-assessor.json
--out collected --include-unverified` when the network is free.

## Known gaps

No adapter or tests; use-code mapping from Appendix B not built; whether the annual file blanks the name/situs
columns is unknown; no situs means no address matching.
