# tn-comptroller-assessment: Tennessee Comptroller statewide parcel and assessment data (86 counties)

Reviewed 2026-11-03. Status: **not verified (gated: request form with a click-through acknowledgment and a CAPTCHA, and a
stated ban on automated downloads)**; no adapter, no tests, nothing loaded. Config:
[`registry/sources/tn/tn-comptroller-assessment.json`](../../../registry/sources/tn/tn-comptroller-assessment.json)
(`files` empty). Nothing was submitted, accepted, registered or downloaded.

## Publisher and URLs

- Publisher: Tennessee Comptroller of the Treasury, Division of Property Assessments (DPA), Geographic Services. Contact
  on the page: `GIS.Data@cot.tn.gov`.
- Download page: <https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html>
  ("Parcel Data"; reached from "Download Redistricting, Land Use Maps and Parcel Data"). The stewardship page
  (`.../parcel-data-stewardship.html`) says DPA "makes the data available for download HERE" and points to the same page.
- The page's only download mechanism is an embedded Formstack form: `https://comptrollertn.formstack.com/forms/js.php/parcel_data`
  (form id 4763356, "parcel data"; submits to `https://comptrollertn.formstack.com/forms/index.php`). There is no
  file link on the page and no listing of per-county files.
- Related pages read: land-use data page (`.../gisredistricting/land-use-data.html`), the Comptroller's site
  Disclaimer (`/disclaimer.html`), the assessment glossary. `/quick-links/tn-property-assessment-data.html` answers 302
  and the stewardship "Real Estate Assessment Data" page ends in a 404; both lead to the on-line assessment look-up
  (`tnmap.tn.gov/assessment`, `assessment.cot.tn.gov`), which is a per-parcel viewer, not a bulk source (the second host
  also fails TLS name verification). Not pursued.

## Terms, license, robots

- robots.txt on `comptroller.tn.gov`: `User-agent: *` / `Allow: /`. (`comptrollertn.formstack.com/robots.txt` is a 404.)
- Page text (Parcel Data): "Geographic Services offers a GIS parcel data product for download in an Esri shapefile
  format that requires specialized GIS software for viewing and/or editing. The available parcel data is updated weekly
  and can be downloaded by county below. We do not offer historical downloads, nor any recurring extracts or other
  automated downloads of the data hosted on our website. The shapefile data can be used in a commercial
  application."
- Tabular data (same page): "There is a table named 'Assessment_Data_##.dbf' within each county's downloaded folder. If
  the table is joined to the corresponding parcels layer via the field "GISLINK", additional owner, property, building,
  land use, and assessment information can be viewed. Also present in the downloaded folder is an excel spreadsheet
  containing a field dictionary".
- The commercial-use sentence is about "the shapefile data". It does not name the Assessment_Data table, and no sentence
  addresses redistribution of facts or AI use. No licence is named.
- The form's disclaimer (shown above the Acknowledgment checkbox, quoted in part): "THE INFORMATION IS PRESENTED FOR
  GRAPHICAL REFERENCE ONLY. ... THE TENNESSEE COMPTROLLER OF THE TREASURY MAKES NO WARRANTY, EXPRESSED OR IMPLIED,
  INCLUDING BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ...".
- Site Disclaimer: information "is collected, maintained, and provided for the convenience of our customers"; the Comptroller
  "does not certify the authenticity of information herein that originates from third parties".
- Underlying records are public records under the Tennessee Public Records Act (T.C.A. 10-7-503).

## What the file contains

Not downloaded; the layout below is only what the pages say. Per county folder: parcel shapefile, `Assessment_Data_##.dbf`
(joined on `GISLINK`; owner, property, building, land use and assessment information), an Excel field dictionary. The
field names, the owner-name and confidentiality fields, and the value and area columns are unconfirmed, so no adapter or
fixture was written (a fixture would have to invent the layout).

Coverage. The form offers 86 counties: Anderson, Bedford, Benton, Bledsoe, Blount, Bradley, Campbell, Cannon, Carroll,
Carter, Cheatham, Claiborne, Clay, Cocke, Coffee, Crockett, Cumberland, Decatur, DeKalb, Dickson, Dyer, Fayette, Fentress,
Franklin, Gibson, Giles, Grainger, Greene, Grundy, Hamblen, Hancock, Hardeman, Hardin, Hawkins, Haywood, Henderson, Henry,
Houston, Humphreys, Jackson, Jefferson, Johnson, Lake, Lauderdale, Lawrence, Lewis, Lincoln, Loudon, McMinn, McNairy,
Macon, Madison, Marion, Marshall, Maury, Meigs, Monroe, Moore, Morgan, Obion, Overton, Perry, Pickett, Polk, Putnam, Rhea,
Roane, Robertson, Scott, Sequatchie, Sevier, Smith, Stewart, Sullivan, Sumner, Tipton, Trousdale, Unicoi, Union, Van Buren,
Warren, Washington, Wayne, Weakley, White, Wilson. Not covered ("NOT MAINTAINED BY THE TENNESSEE OFFICE OF THE
COMPTROLLER OF THE TREASURY"): Chester, Davidson, Hamilton, Hickman, Knox, Montgomery, Rutherford, Shelby, Williamson; the
land-use page says they "do not participate in the state's IMPACT CAMA system". Knox, Hamilton and Rutherford, the
sample counties first proposed for this source, are therefore not in it.

Published code definitions found for a later mapping (land use, a modelled product "revised 7/10/2018",
<https://comptroller.tn.gov/content/dam/cot/pa/documents/landuse/COTLandUseCodes.pdf>; whether `Assessment_Data` carries
these codes or the assessors' own is unconfirmed): `04` multi-family (three or more dwelling units) would map to `B`;
`11` general commercial, `12` office, `13` motel/hotel, `14` commercial-residential split, `15` golf course, `16` nursing
home would map to `F1`; `21` light industry/warehousing and `22` heavy industry to `F2`; residential, vacant,
agricultural, timber, public, utilities and water codes are out of scope. `local_use_code` would keep the publisher's code.
The assessment glossary states the property classes (the Constitution's subclasses: public utility, industrial and
commercial, residential, farm); industrial and commercial real property is assessed at 40 percent of appraised value.

## Gates

All need a person. Nothing was done about any of them.

1. **Request form** (Formstack, embedded in the Parcel Data page). Required fields: Name; Address; one or more counties
   (checkbox groups "Counties A - D", "F - J", "L - P", "R - W"); the Attestation checkbox: "I attest to the best of my
   knowledge and belief that the information I have provided on this form is true and correct._"; and the Acknowledgment
   checkbox: "I acknowledge that I have read and understand the disclaimer above and agree to be bound by it._". The
   form loads an invisible CAPTCHA (reCAPTCHA key in the form definition). Submitting it enters personal data, accepts
   terms and passes a bot check: not allowed for the collector.
2. **No automated or recurring download.** "We do not offer historical downloads, nor any recurring extracts or other
   automated downloads of the data hosted on our website." The weekly refresh the registry would need is exactly what
   this excludes, so ask first.
3. **Scope of the commercial-use statement.** It covers "the shapefile data"; owner and assessment facts live in the
   `.dbf` table. A written confirmation covering the table, republication of facts and AI use is needed before
   `verified: true`.

What would clear the gate: an answer from `GIS.Data@cot.tn.gov` on (a) a bulk or API route for the county folders (86 counties,
weekly) that does not need the form, and (b) whether facts from `Assessment_Data_##.dbf` (owner of
record, land use, values) may be republished in an open registry with AI use allowed. If the answer is yes, a person
submits the form once for the wanted counties and places the zips in `collected/`; the adapter can then be written
against the real layout. Alternatively use the per-county sources for the nine excluded counties (Davidson is done:
[tn-davidson-assessor](tn-davidson-assessor.md); Shelby is gated: [tn-shelby-assessor](tn-shelby-assessor.md)).

## Real run

None. `python -m factlot.collector discover --config registry/sources/tn/tn-comptroller-assessment.json` fetched the
two landing pages (both `ok`, no file links found, as the download is behind the form). No file was downloaded, so
there are no row counts, no category counts and no owner-name availability figures.

## Known gaps

- Layout, owner-name and confidentiality fields, value columns, building area and year built are unknown until a
  person obtains a county folder.
- Whether `Assessment_Data` uses the modelled land-use codes above or the assessors' own property-type codes.
- Redistribution and AI-use terms for the table (not stated).
