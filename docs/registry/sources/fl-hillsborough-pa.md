# fl-hillsborough-pa: Hillsborough County, Florida Property Appraiser public downloads

Review record for the FactLot Registry source `fl-hillsborough-pa` (Hillsborough County, FIPS 12057).
Config: [`registry/sources/fl/fl-hillsborough-pa.json`](../../../registry/sources/fl/fl-hillsborough-pa.json).
Reviewed 2026-11-06. **`verified: false`.** No adapter. Nothing was downloaded from the file list, and
nothing was loaded.

This record is not an audit and it is not a completeness claim. "Audited" is not "complete." No
scratch registry was built, so there is no audit JSON.

## Why it stops here

The download page does not permit free use. Its only rights line reserves copyright. The office's
disclaimer disclaims warranties for the data and its use and grants no licence. The same office
prices some digital extracts at $125 and marks shapefiles reached through the downloads site "No
charge," which is a fee of zero, not a licence to copy, redistribute, or use the files in an open
registry. The privacy notice cites chapter 119, Florida Statutes, as a right of access. Whether
that access right overrides the copyright notice is a rights question for a person. Until that
person decides, the source stays `verified: false` and is not collected.

## Publisher and URLs

- Publisher: Hillsborough County Property Appraiser (HCPA).
- Public downloads (the page this lane was asked to read): <https://downloads.hcpafl.org/>.
  Title: "Public Downloads - Hillsborough County Property Appraiser". Read 2026-11-06
  (response `date: Fri, 06 Nov 2026 22:53:21 GMT`).
- Maps and data, which opens that downloads site: <https://www.hcpafl.org/Downloads/Maps-Data>
  ("Downloadable Maps & Data"). Read 2026-11-06.
- Disclaimer: <https://www.hcpafl.org/Disclaimer>. Read 2026-11-06.
- Privacy and Security Notice: <https://www.hcpafl.org/Home/Privacy-and-Security-Notice>.
  The page says "Last updated on April 24, 2026". Read 2026-11-06.
- Budget and tax-roll statistics: <https://www.hcpafl.org/Our-Office/Budget-Tax-Roll-Stats>.
  Read 2026-11-06.

The downloads page welcome text, verbatim:

> Welcome to the Hillsborough County Property Appraiser Public Downloads area. Use the folders on the left to select a category of downloads that you would like to view. Click on the name of a file you'd like to start the download of the selected file.

Folders named on that page, and not opened: Root Folder, `_building_footprints`,
`_just value change maps by year`, `_shapefile_archives`.

## Terms, quoted verbatim

Downloads page footer (<https://downloads.hcpafl.org/>, read 2026-11-06). The HTML is
`Copyright &copy;2026 Hillsborough County Property Appraiser.<br>All Rights Reserved.` Rendered:

> Copyright ©2026 Hillsborough County Property Appraiser.
> All Rights Reserved.

No other licence, terms-of-use, or reuse sentence appears on that page. There is no click-through
in front of the file list. File names are postbacks (`__doPostBack`); no direct file URL was
confirmed, and no file was requested.

Disclaimer (<https://www.hcpafl.org/Disclaimer>, read 2026-11-06), the module text:

> The Hillsborough County Property Appraiser makes every effort to produce and publish the most current and accurate information possible. No warranties, expressed or implied, are provided for the data herein, its use, or its interpretation.

Then the heading "IMPORTANT NOTICES:" and:

> PROPERTY VALUES, EXEMPTION STATUS AND OTHER INFORMATION CONTAINED HEREIN ARE SUBJECT TO CHANGE.

The same site's footer, on the disclaimer, maps, privacy, and statistics pages, reads
"© Copyright 2026 Hillsborough County Property Appraiser. All Rights Reserved."

Privacy and Security Notice (<https://www.hcpafl.org/Home/Privacy-and-Security-Notice>,
read 2026-11-06; "Last updated on April 24, 2026"), opening:

> Thank you for visiting the Hillsborough County Property Appraiser (HCPA) website and reviewing our Privacy Policy. HCPA provides its website for your convenience. By using the information, services and products available through this website, You agree to be bound by all of HCPA terms and conditions of use as set forth herein.

The chapter 119 paragraph on that page (bold in the HTML):

> Please note that chapter 119, Florida Statutes, provides a right of access to the records of the state and local governments as well as to private entities acting on their behalf. In the absence of a statutory exemption, this right of access applies to all materials made or received by an agency in connection with the transaction of official business which are used to perpetuate, communicate or formalize knowledge. Therefore, information submitted to or collected by the HCPA from the use of its websites may be examined and inspected upon request if that information is a public record and not otherwise protected from being disclosed.

That paragraph is about inspecting records, including information a visitor submits. It does not
say the download files may be copied, redistributed, or used commercially, and it does not mention
AI. AI use is not addressed on any page read.

Maps and data (<https://www.hcpafl.org/Downloads/Maps-Data>, read 2026-11-06). The "GIS Data" box
opens `https://downloads.hcpafl.org` and is labelled "(updated every Friday)". The description:

> Parcel layer shapefiles and other shapefiles useful for mapping. Please use Firefox, Microsoft Edge or Internet Explorer to access this ftp site.

> **If prompted for a login, use: user id = public and password = access

The same login sentence is printed for the section-maps box. The credentials were not used.

The visible "DIGITAL DATA REQUESTS" table on that page:

| Type                                               | Details                               | Price     |
| -------------------------------------------------- | ------------------------------------- | --------- |
| Assessment Data (current date)                     | text delimited data and descriptions  | $125      |
| Certified roll (October)                           | (blank)                               | $125      |
| Tangible Roll (October)                            | (blank)                               | $125      |
| Parcel layer (entire county)                       | shape file current as of day of order | $125      |
| For shapefiles, please click "GIS DATA" link above |                                       | No charge |
| For Aerial Requests, contact gisdept@hcpafl.org    |                                       | TBD       |

"No charge" is the price cell for the shapefile row. It is not a licence. A later "CUSTOM DATA
REQUESTS" table is inside an HTML comment on the page and is not quoted as current text.

## robots.txt

Read 2026-11-06, user agent `FactLotRegistryBot/1.0 (+https://factlot.com/registry; contact@factlot.com)`:

- <https://downloads.hcpafl.org/robots.txt>: HTTP 404, IIS page "404 - File or directory not found."
  No rules.
- <https://www.hcpafl.org/robots.txt>: HTTP 404, the same IIS page. No rules.
- <https://gis.hcpafl.org/robots.txt>: HTTP 200, body `User-agent: *` / `Disallow: /`. Nothing on
  that host was fetched except this robots.txt.
- <https://maps.hcpafl.org/robots.txt>: HTTP 200, an HTML application shell, not a robots file.
  That host was not used.

## What was listed, and not opened

Root listing on <https://downloads.hcpafl.org/>, read 2026-11-06. Sizes and "Last Updated" are the
page's own cells. None of these files was downloaded, so their contents, column layouts, and
parcel counts are not known.

| File                                    |   Size | Last Updated     |
| --------------------------------------- | -----: | ---------------- |
| allsales_09_18_2026.zip                 |  68 MB | 9/18/2026 7:14AM |
| annotations_03_11_2026.zip              |  21 MB | 3/12/2026 9:49AM |
| County_Boundary_09_18_2026.zip          | 297 KB | 9/18/2026 7:13AM |
| easements_09_18_2026.zip                |   9 MB | 9/18/2026 7:13AM |
| grossarea.zip                           |   4 MB | 3/25/2026 7:39AM |
| HCparcel_4_public_11_06_2026.zip        | 129 MB | 11/6/2026 2:27AM |
| historic_03_11_2026.zip                 |  58 MB | 3/12/2026 9:48AM |
| LatLon_Table_09_18_2026.zip             |   7 MB | 9/18/2026 7:13AM |
| parcels_11_06_2026.zip                  | 149 MB | 11/6/2026 2:27AM |
| PARCEL_SPREADSHEET.xls                  | 537 MB | 9/18/2026 7:14AM |
| roads_09_18_2026.zip                    |   5 MB | 9/18/2026 7:13AM |
| section_grid_09_18_2026.zip             |  89 KB | 9/18/2026 7:13AM |
| special_districts_09_18_2026.zip        | 895 KB | 9/18/2026 7:13AM |
| subdivisions_09_18_2026.zip             |  10 MB | 9/18/2026 7:13AM |
| water_09_18_2026.zip                    |   4 MB | 9/18/2026 7:13AM |
| _Documentation.doc                      | 598 KB | 11/6/2023 7:03AM |
| _DOR_Code_Manual.docx                   |  25 MB | 10/7/2021 9:44AM |
| _Market_Areas_and_Neighborhoods_map.pdf |   2 MB | 10/7/2021 9:44AM |

`_Documentation.doc` and `_DOR_Code_Manual.docx` were not opened. No Florida DOR use-code map was
made from them. A later adapter, and only after a person clears the rights question above, has to
map the Florida Department of Revenue use codes this county assigns, and has to write that map
down as a Florida commercial and industrial classification. It must not reuse the Texas category
letters B, F1, and F2 as a nationwide crosswalk.

## Commercial-universe denominator

Unavailable. The downloads page publishes file sizes, not a count of commercial or industrial
parcels. The statistics page's Table 2,
<https://www.hcpafl.org/Portals/HCPAFL/pdfs/Hillsborough%20Table%202.pdf?ver=2025-08-14-145344-270>
(read 2026-11-06; "Table 2 Distribution of Taxes Levied by Property Type, County and Municipal
Governments, Fiscal Year 2024-25"), is a distribution of taxes levied. It names Commercial and
Industrial as property types and does not state a parcel count. Those tax shares are not a parcel
denominator and are not recorded here as one. No roll file was opened, so no count was computed.

## Freshness

Separate from any loaded as-of, because nothing was loaded:

- The Maps and Data page labels GIS Data "(updated every Friday)" and points it at
  <https://downloads.hcpafl.org>. Read 2026-11-06.
- On that downloads page the same day, `HCparcel_4_public_11_06_2026.zip` and
  `parcels_11_06_2026.zip` are both "Last Updated" `11/6/2026 2:27AM`.
  `PARCEL_SPREADSHEET.xls` is "Last Updated" `9/18/2026 7:14AM`. `_DOR_Code_Manual.docx` is
  "Last Updated" `10/7/2021 9:44AM`. These are the page's timestamps. The files were not opened,
  so the date inside each file is not known.
- Tax-roll certification, quoted from <https://www.hcpafl.org/Our-Office/Budget-Tax-Roll-Stats>
  (read 2026-11-06): "Pursuant to section 193.122(2), Florida Statutes (2014), notice is hereby
  given to all taxpayers and owners of both real and personal property that the 2025 Hillsborough
  County Tax Rolls have been extended to show the tax attributable to all taxable property and
  that said tax rolls were certified for collection to the Tax Collector on 10/5/2025."

## Gate

A person has to decide whether the copyright reservation ("All Rights Reserved"), the warranty-only
disclaimer, the $125 price on assessment data and on an ordered county parcel shapefile, and the
"No charge" price on the GIS Data shapefiles, together with the chapter 119 access paragraph,
allow FactLot to keep and redistribute commercial and industrial parcel facts. Until that decision,
do not snapshot <https://downloads.hcpafl.org/> and do not set `verified` to true.
