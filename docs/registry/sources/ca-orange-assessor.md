# Orange County Assessor (California, FIPS 06059): access review

**Verdict (reviewed 2026-11-02): no free bulk file. `verified: false`. No adapter written.** The
secured roll is available only in person or by written request, priced by phone; the county sends
online users to ParcelQuest, a commercial vendor. Config:
[`registry/sources/ca/ca-orange-assessor.json`](../../../registry/sources/ca/ca-orange-assessor.json)
(`files` is empty, because no file URL could be confirmed).

## Publisher and URLs

- Publisher: Orange County Assessor (Claude Parrish, elected Assessor). Site: `www.ocassessor.gov`.
- Roll products page: <https://www.ocassessor.gov/page/assessor-roll-products> (revised 8/09/2021).
- Public records page: <https://www.ocassessor.gov/contact-us/assessor-public-records>.
- Property information page: <https://www.ocassessor.gov/page/property-information-and-parcel-maps>,
  which hands off to ParcelQuest (`assr.parcelquest.com/impl/ORGASSR`).
- Per-parcel lookup (no bulk, no owners): <https://assessedvalue.ocassessor.gov/>.
- County GIS: OC Public Works open data, <https://data-ocpw.opendata.arcgis.com/> (see below).

## Terms, license, robots

- `ocassessor.gov/robots.txt` is the stock Drupal file: it blocks `/core/`, `/profiles/`, `/admin/`,
  `/search/`, user and comment paths, and nothing else. Every page used here is allowed.
- Roll products page, the operative sentence: "Assessor roll products are ONLY AVAILABLE in-person
  at our Public Service Center or by written request. Please call (714) 834-2727 for pricing and
  more information." Listed charges are for paper items only (parcel map pages $1.50, photocopy
  pages $0.15, certifications $1.00, roll pages $1.00, comparable sales $10.00).
- Public records page: requests go by mail (500 S. Main Street, Suite 103, Orange, CA 92868, Attn:
  Quality Assurance), in person, or by fax to (714) 834-3199, under the California Public Records
  Act (Gov. Code 7920 et seq.) and Rev. & Tax. Code 408, 451 and 481.
- Privacy statement (<https://www.ocassessor.gov/news-information/privacy-statement>): the assessment
  roll "is by law a public document", and the Assessor "will not use this website to provide
  assessment roll information on individual property owners".
- No license, terms of use, or AI-use statement applies to a bulk file, because none is published.

## What the file contains

There is no file to describe. What the Assessor does offer:

- Counter and written-request products (paper and, on request, "property assessment information,
  property characteristics, and other information at our Public Service Counter").
- Via ParcelQuest (vendor, paid; not reviewed).

County GIS lead, reviewed and rejected for now: the OC Public Works layer "Parcels With Attributes"
(`https://ocgis.com/arcpub/rest/services/LegalLotsAttributeOpenData/FeatureServer/0`, 987,692
features, updated nightly, open to anonymous queries, robots.txt on `ocgis.com` disallows only
`/art`) carries `AssessmentNo` (APN), `SiteAddress`, `SiteCityState`, `SiteZip5`, `MailAddress`,
`LandVal`, `ImprovedVal`, `AssdAmt`, and zoning/general-plan fields. It has **no assessor use or
class code**: `GPLU_CODE` / `GPLU_DESC` hold editing notes (a sample of 3 rows shows `keep oct26` and
`CO`; 985,217 rows are empty, and the only values are `CO`, `new legal lot id`, `delete`). `ZCLASS`
and `ZC_DETAIL` are zoning, not use. Commercial scope cannot be derived from it without guessing.
`MailAddress` repeats the site address and may be the owner's mailing address, which would be
privacy-relevant. The Hub item's license field is `none`. The OC Landbase itself is licensed under
Board Resolution 11-196 (reported by the county's Landbase page, which answers 403 to the
collector, so it was not read directly).

## Gates (need a person)

1. **Purchase or records request.** Write or call the Assessor (714-834-2727; written request to
   Attn: Quality Assurance). Ask for the secured roll in electronic form with the assessor's use
   (class) code, situs, assessed land and improvement values, and the use-code table; ask whether
   owner names are included (the privacy statement suggests the Assessor treats owner-name output as
   a counter service) and the price and redistribution terms.
2. **Or** buy through ParcelQuest (<https://assr.parcelquest.com/impl/ORGASSR>), which is a paid,
   contract-licensed product whose license would have to be read before any use.
3. Nothing was purchased, no form was sent, and no account was created.

## Real run

None: nothing to download. The `discover` run confirmed the three Assessor pages respond (HTTP 200
under the collector's user agent) and contain no downloadable file links.

## Known gaps

- Owner names, use codes, the use-code list, and the price are unknown until the Assessor answers.
- Orange County's use-code list was not found online.
- Expect secured-roll tapes to carry names (the paid route), so the privacy rules in the data
  policy (no natural-person names stored) will apply when a file arrives.
