# Alameda County Assessor secured roll (`ca-alameda-assessor`): terms decision memo

Date read: 2026-11-03 (earlier captures 2026-11-02 as marked). Prepared for: the founder.
This memo is research, not legal advice; the founder holds no attorney or real estate license.

## What the publisher's terms say

The free table is ArcGIS item `54cc3c88fa384b28b5c456df0868fc67`, "Assessor_Office_Secured_Tax_Roll_2025_to_2026", <https://www.arcgis.com/sharing/rest/content/items/54cc3c88fa384b28b5c456df0868fc67?f=json> (read 2026-11-02, NOTES.md). `licenseInfo` is an empty string. `accessInformation` and `description` are empty strings. `access` is "public". `listed` is false. No terms of any kind are attached to the item. AI use and redistribution are not addressed on that record.

The Assessor's fee schedule, <https://www.acgov.org/forms/assessor/feeschedule.pdf> (read 2026-11-03; saved as `alameda-feeschedule.pdf` (see evidence-index.md)), is headed effective January 1, 2016. It lists "Entire Assessment Roll (Secured & Unsecured)" on compact disc at $20.00, monthly updates at $20.00 per month, and "Entire Property Characteristic File" at $20,000.00. The schedule states prices. It does not say whether the hosted 2025-26 table is that product, and it does not grant or forbid redistribution.

The live contact page and <https://www.acgov.org/assessor/> returned HTTP 403 on 2026-11-03 (listed in REPORT.md, "Needs a person to open"). The address below is the fee-schedule letterhead. A use-code disclaimer in the review record was not re-fetched. Its wording is NOT CONFIRMED here.

Letterhead address, read 2026-11-03: "1221 Oak St., Room 145, County Administration Building", "Oakland, California 94612-4288", phone "(510) 272-3787". No public email appears on the schedule.

## What the statute says

Gov. Code § 7922.530(a), captured from <https://leginfo.legislature.ca.gov> (read 2026-11-02, NOTES.md):

> Except with respect to public records exempt from disclosure by express provisions of law, each state or local agency, upon a request for a copy of records that reasonably describes an identifiable record or records, shall make the records promptly available to any person upon payment of fees covering direct costs of duplication, or a statutory fee if applicable.

Rev. & Tax. Code § 408.3(a) (read 2026-11-02): "property characteristics information maintained by the assessor is a public record and shall be open to public inspection." Subsection (b) includes "use code designations." The assessor "may require that a fee reasonably related to the actual cost of developing and providing the information be paid", and that cost "may include recovery of developmental and indirect costs". The capture summarizes (d) as no liability for errors. The verbatim sentence of (d) is not in the capture.

Rev. & Tax. Code § 408(a) (read 2026-11-02) withholds records "not required by law to be kept or prepared by the assessor". The capture reads the assessment roll as outside that withholding. Commercial use: silent. Redistribution: silent. Gov. Code § 7921.000 was not read. The leginfo page returned HTTP 403, Cloudflare "Just a moment..." on 2026-11-03. That section is NOT CONFIRMED.

## Options

1. Use as a public record.
2. Ask the publisher for a written statement (letter: `ca-alameda-assessor-letter.md`).
3. Do not load.

## Recommendation

Choose option 2. Do not load the hosted table until the Assessor answers in writing. The item carries no licence, it is unlisted, and the same office sells an "Entire Assessment Roll" on compact disc. An empty `licenseInfo` is not a grant of redistribution. The Public Records Act and § 408.3 make records available and, for characteristics, allow a cost-based fee. They are silent on republication.

Address the letter to the Alameda County Assessor, Office of the Assessor, at the fee-schedule letterhead above. Confirm the room is still current before mailing, because the live contact page was blocked. Ask whether the county objects to redistribution of the public fields for commercial parcels, with every fact cited to the table and with no natural-person name stored, and whether the 2016 roll charge applies to that hosted table. Leave `verified` false until the answer.

## Risk if wrong

If the hosted table is the product the fee schedule sells, loading it without paying and without permission skips a charge the office publishes and a licence the office never gave. If the table is open data the county posted for public use, and the empty licence means only that no extra terms attach, then waiting delays a free secured roll. The blocked contact page means the room number on a 2016 form might be stale. Mailing to a dead room loses the question. Confirm the address, then send.
