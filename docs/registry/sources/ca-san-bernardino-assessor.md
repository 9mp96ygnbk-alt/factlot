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

### Terms read 2026-11-03 (gates pass)

Assessor Property Data Files, <https://arc.sbcounty.gov/property-information/> (read 2026-11-02, NOTES.md). The page states: "Names and address information protected per California Government Code Section 7928.205." Limitation of liability:

> Data provided by the San Bernardino County Assessor's Office is maintained for internal use only in the determination of property value for the purpose of taxation. While the office strives to maintain the accuracy of the content of its data files, it makes no claims, promises, or guarantees about the accuracy, completeness, or adequacy of the contents of the files. The County of San Bernardino assumes no responsibility arising from use of this information. No warranty of any kind, expressed or implied, including but not limited to, the implied warranties of merchantability and fitness for particular purposes is made.

<https://main.sbcounty.gov/policy/> (read 2026-11-02) showed headings only, including "Information Disclaimer," and no licence text. AI use is not addressed.

Office address, <https://arc.sbcounty.gov/san-bernardino-assessor-district-office/> (read 2026-11-03): "222 W. Hospitality Lane", "3rd Floor", "San Bernardino, CA 92415", phone 909.386.8870. No email address is printed on that page.

Gov. Code § 7922.530(a) and Rev. & Tax. Code §§ 408 and 408.3 (read 2026-11-02, NOTES.md; <https://leginfo.legislature.ca.gov>). Section 408.3(a): "property characteristics information maintained by the assessor is a public record and shall be open to public inspection." Section 408(a) withholds records "not required by law to be kept or prepared by the assessor". Commercial use: silent. Redistribution: silent. Gov. Code § 7921.000 is NOT CONFIRMED. Founder URL, HTTP 403 on 2026-11-03: <https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=7921.000.> The text of § 7928.205 was not read.

The liability paragraph does not grant redistribution. "maintained for internal use only" is a use sentence inside a warranty disclaimer, and it is unresolved. The name-and-address line is a withholding, not a licence to republish the other fields. Leave the source unverified until the Assessor answers `ca-san-bernardino-assessor-letter.md`.

## Real run

None. A collector snapshot run stalled: the server delivered about 3 MB of the first file and then sent
nothing, on a connection shared with about twenty other collectors. No rows were read; there is no snapshot id.
Re-run `python -m factlot.collector snapshot --config registry/sources/ca/ca-san-bernardino-assessor.json
--out collected --include-unverified` when the network is free.

## Known gaps

No adapter or tests; use-code mapping from Appendix B not built; whether the annual file blanks the name/situs
columns is unknown; no situs means no address matching.
