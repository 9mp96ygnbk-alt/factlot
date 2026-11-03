# Fulton County Board of Assessors (`ga-fulton-assessor`): terms decision memo

Date read: 2026-11-03 (earlier captures 2026-11-02 as marked). Prepared for: the founder.
This memo is research, not legal advice; the founder holds no attorney or real estate license.

## What the publisher's terms say

Three different statements sit on the ArcGIS items (read 2026-11-02). The site item `9a3d1c28277b43ef99acf5c790302e49`, "Fulton County, Georgia - Open Data", https://www.arcgis.com/sharing/rest/content/items/9a3d1c28277b43ef99acf5c790302e49?f=json, has licenseInfo exactly "CC-BY-SA". The county did not attach a Creative Commons URL or a version number in that field. This lane did not fetch the Creative Commons legal text, so the share-alike and attribution duties of that label are NOT CONFIRMED from a license deed.

"Tax Parcels 2025", item `c805da9aa51d4c508440358c00498fcf`, https://www.arcgis.com/sharing/rest/content/items/c805da9aa51d4c508440358c00498fcf?f=json, is the roll to load. The notes record this licenseInfo sentence:

> Fulton County provides the data within these pages "as is".

`accessInformation` is empty.

"Tax_CAMA", item `75e58855b00d40d7873975f22c24ba8f`, https://www.arcgis.com/sharing/rest/content/items/75e58855b00d40d7873975f22c24ba8f?f=json, is the optional source of year built and building area. Its licenseInfo in the notes starts "Fulton County provides the data within these pages for your personal use" and then continues, on that line and the next, with a quoted as-is. AI use is not addressed on any item read.

Board of Assessors, https://www.fultoncountyga.gov/boardofassessors (read 2026-11-03): "235 Peachtree Street, NE", "Suite 1400", "Atlanta, GA 30303", "boa@fultoncountyga.gov", "404-612-6440". The open-records page, https://www.fultoncountyga.gov/Inside-Fulton-County/Fulton-County-Departments/Office-of-the-County-Attorney/Open-Records-Requests (read 2026-11-03), lists an "Official Custodian of Records" at "141 Pryor Street, S.W., Suite 4038", "Atlanta, Georgia 30303", "orr@fultoncountyga.gov", "404-612-0281".

## What the statute says

O.C.G.A. § 50-18-70 and § 50-18-71 were read on 2026-11-03 in the Attorney General's compilation of the Open Records Act, linked from the AG's page <https://law.georgia.gov/key-issues/open-government/law> as <https://law.georgia.gov/document/here-3/download> (HTTP 200; a March 2016 compilation, byte-identical to the copy on agr.georgia.gov and matching Fulton County's copy <https://www.fultoncountyga.gov/-/media/Files/Open-Records-Act-October-2024.pdf>). The current text was cross-checked against the General Assembly's 2025-supplement PDF, <https://www.legis.ga.gov/api/document/docs/default-source/joint-features-document-library/t50-ch13-40-%28v38a%29-pdf.pdf> (HTTP 200, read 2026-11-03), whose history note records an added paragraph (b)(1.1) on custodians that the 2016 compilation lacks. LexisNexis and justia were not used.

§ 50-18-70(a):

> The General Assembly further finds and declares that there is a strong presumption that public records should be made available for public inspection without delay. This article shall be broadly construed to allow the inspection of governmental records.

§ 50-18-70(b)(2): "'Public record' means all documents, papers, letters, maps, books, tapes, photographs, computer based or generated information, data, data fields, or similar material prepared and maintained or received by an agency".

§ 50-18-71(a):

> All public records shall be open for personal inspection and copying, except those which by order of a court of this state or by law are specifically exempted from disclosure.

§ 50-18-71(c)(2): "an agency may charge a fee for the copying of records or data, not to exceed 10 cent(s) per page for letter or legal size documents or, in the case of other documents, the actual cost of producing the copy. In the case of electronic records, the agency may charge the actual cost of the media on which the records or data are produced."

Commercial use and redistribution: §§ 50-18-70 and 50-18-71 are silent. Neither section contains the word "commercial", and neither limits what a requester may do with a copy once obtained. ("Personal inspection" describes the right of access; it is not a personal-use licence.)

## Options

1. Use as a public record.
2. Ask the publisher for a written statement (letter: `ga-fulton-assessor-letter.md`).
3. Do not load.

## Recommendation

Send the letter. Leave `verified` false until the County says which statement governs. The parcel layer the registry would load carries an "as is" disclaimer. Tax_CAMA includes "for your personal use". The site item says only "CC-BY-SA". Those three cannot be collapsed into one license from the text on hand. The Open Records Act, as read, supplies no commercial-purpose certification and is silent on redistribution after access.

## Risk if wrong

If the personal-use sentence on Tax_CAMA is held to cover the parcel layer as well, publishing derived building facts and parcel facts would conflict with that sentence. If only Tax_CAMA is limited, holding back Tax Parcels 2025 delays Atlanta commercial parcels that the item itself marks only "as is". If "CC-BY-SA" governs and a later reader expects share-alike on the registry, the attribution and share-alike conditions were not read from a Creative Commons deed in this lane.
