# ca-fresno-assessor — Fresno County, California (FIPS 06019)

Review record for the Assessor's roll products. **Result: the free "Secured Roll File" is a PDF with values
but no use code and no situs, and the county GIS parcels have no use code; use codes exist only in a paid
file. Status: gated (purchase), `verified: false`, no adapter.** Config:
`registry/sources/ca/ca-fresno-assessor.json`. Reviewed 2026-11-03.

## Publisher and URLs

- Publisher: Fresno County Assessor. Page: https://www.fresnocountyca.gov/Departments/Assessor/Assessment-Roll
  ("Assessment Roll"; secured roll and situs file "updated once a year in July").
- **Data for Sale** (price list read 2026-11-03):

  | File                                                             | Format          | Cost            |
  | ---------------------------------------------------------------- | --------------- | --------------- |
  | Quarterly Sales                                                  | Text, CSV, PDF  | $25.10          |
  | Secured Assessment Roll including owners' names as of Jan. 1     | Text, CSV, PDF  | $48.70          |
  | Current Ownership Name and Mailing Address (monthly)             | Text or CSV/PDF | $30.94 / $54.94 |
  | Additional Owners on Most Current (monthly)                      | Text or CSV     | $24.00          |
  | Situs Index                                                      | Text, CSV, PDF  | $29.21          |
  | Unsecured Assessment Roll                                        | Text, CSV, PDF  | $29.68          |
  | **Property Characteristics** ($0.05 per parcel; 309,837 parcels) | Text or CSV     | **$15,491.85**  |
  | Tax Area Master                                                  | Text or CSV     | $33.64          |

  Notes from the page: "We do not sell pieces of files such as a range of APNs ... specific cities ...
  properties with certain characteristics". To buy: a written request naming the files and format, a contact
  name, phone and e-mail, "A check or money order payable to 'Fresno County Treasurer'"; address "Fresno County
  Assessor, Attention: Data Sales, P.O. Box 1146, Fresno, CA 93715"; "Data will be sent after payment has been
  received"; files are not e-mailed (CD, flash drive, FTP or the county's Dropbox).

- **Free to Download**: Secured Roll File 2026 (PDF, 53 MB), 2025 (17 MB), 2024, 2023, 2022 at
  `https://www.fresnocountyca.gov/files/sharedassets/county/v/<n>/assessor-recorder/files-for-sale/free_to_download/roll<year>.pdf`
  (2026 is version 1, 2025 is version 2). The page says: "To comply with the Act [Gov. Code § 6254.21], we have
  omitted the Assessee's name from all files posted in the 'Free to Download' section."
- Record layouts of the paid files are published as PDFs next to the price list
  (`.../files-for-sale/schema-for-property-characteristics-report.pdf` etc.).
- County GIS: "County of Fresno Data Sharing" hub (https://datasharing-cofgisonline.hub.arcgis.com) lists
  `REGIONAL_PARCELS_VW` (item `599a17ca02fe4781af4efe31edd81669`, owner `COF_ISD_PROD`, modified 2026-09-03,
  service `https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/REGIONAL_PARCELS_VW/FeatureServer/11`,
  315,734 parcels). Fields: `APN`, `AGENCY_CODE`, `ACTIVE_DATE`, `ROLL_YEAR`; no licence on the item. The
  county GIS page says it can provide "parcel numbers, street addresses, zoning of parcels, and flood zones"
  and that it cannot provide ownership on the internet.

## Terms, license, robots

- No licence or terms are attached to the free PDFs or to the GIS item; the Assessor sells the same data.
  AI use and redistribution: not addressed. `verified: false`.
- robots.txt on `www.fresnocountyca.gov`: a list of training and sandbox pages disallowed; the Assessor page
  and `/files/sharedassets/` PDFs are allowed. The Hub site sets `Crawl-delay: 60`.

## What the files contain

- **Free secured roll PDF** (2025 file downloaded in full, 17,327,395 bytes, page text checked; the 2026 file
  is 53 MB, over the limit, so only its header and size were read): "STATE OF CALIFORNIA COUNTY OF FRESNO
  SECURED ASSESSMENT ROLL - 2025 06/13/2025". Columns: assessor's parcel number (`000-010-01`), value type
  (`ASSESSED`), land, improvements, trade fixture improvements, personal property, manufactured housing, class
  exemption, homeowner exemption, net total, assessee name and address (blank), tax rate area. **No situs, no
  use code, no owner.** The roll PDF is a print file; it would need a parser (page text extraction).
- **Property Characteristics (paid)**: fixed-length 252-character record (`char_cd.txt`, August 8, 2003):
  APN (1-9), street number/fraction/direction/name (12-48), city code, narrative, **Use Code X(7)** (101-107),
  zoning/make, width/acreage, depth, area, air conditioning, pool, additions, floor sizes, garage, bedrooms or
  number of buildings, baths, quality class, effective year, base year, neighborhood code, **Assessors Use
  X(9)** (223-231), number of units, first floor size, number of floors, average unit area. The use-code table
  is not published.

## Gates (need a person)

1. **Purchase.** The one action: mail a written request with a cheque for the **Property Characteristics file
   ($15,491.85)** and the **Secured Assessment Roll file ($48.70)** to Fresno County Assessor, Attention: Data
   Sales, P.O. Box 1146, Fresno, CA 93715, and ask in the same letter for the use-code table and whether the
   files may be republished. The Secured Roll file in the paid form includes owners' names; the founder should
   decide whether to buy it with or without them (natural persons are never stored).
2. A cheaper, partial route: the free 2026 PDF has values only; with the situs index ($29.21) one could join
   values to addresses but still has no use codes, so it cannot define the commercial scope.

## Real run

None. 2025 PDF text was parsed only to confirm the column layout. No registry was built.

## Known gaps

- No use code in any free file; the use-code table behind the Property Characteristics file is not posted.
- Fresno independent cities' parcels are in the county roll (309,837 assessable parcels).
