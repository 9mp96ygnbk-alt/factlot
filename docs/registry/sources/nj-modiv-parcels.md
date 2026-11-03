# nj-modiv-parcels: New Jersey statewide parcels with MOD-IV attributes (NJOGIS)

Review record for data policy §5. Reviewed 2026-11-03. **Not verified; no adapter.** Machine-readable
copy: [`registry/sources/nj/nj-modiv-parcels.json`](../../../registry/sources/nj/nj-modiv-parcels.json)
(`verified: false`). One review covers Bergen (34003), Essex (34013), Hudson (34017) and Middlesex
(34023), and the other 17 counties.

## Publisher and URLs

- Publisher: NJ Office of Information Technology, Office of GIS (NJOGIS), which joins the Division
  of Taxation's MOD-IV tax list (the statewide property assessment system that municipal assessors
  and county tax boards feed) to the statewide parcel composite.
- Landing page: <https://nj.gov/njgin/edata/parcels/> (NJGIN "Parcels"). Downloads there: statewide
  Parcels joined with MOD-IV, statewide Parcels, and the statewide MOD-IV table as file geodatabases;
  one file geodatabase and one shapefile per county (Hub document pages on
  `njogis-newjersey.opendata.arcgis.com`). Reference documents: parcel update log, NJ GIS Parcel
  Mapping Standard v3.2.1, MOD-IV User Manual (`state.nj.us/treasury/taxation/pdf/lpt/modIVmanual.pdf`),
  MOD-IV layout (`.../MODIVLayoutandDescrip.pdf`).
- Queryable service confirmed by real requests:
  `https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0`
  ("Cad_parcel_mod4", 3,481,240 parcels; `maxRecordCount` 2000; JSON, GeoJSON and PBF; data last
  edited 2026-08-18). Page 0 of a county's class 4A/4B/4C parcels is 1,227,534 bytes with geometry
  off (the `files` in the config); each county needs offset paging. Per-county parcels, with the
  newest parcel edit date: Bergen 281,646 (2025-10-21); Essex 178,089 (2026-03-02); Hudson 143,305
  (2025-10-29); Middlesex 243,019 (2026-05-18).
- Commercial classes (statewide composite counts): Bergen 4A 11,108, 4B 2,394, 4C 1,789; Essex
  10,754, 1,918, 2,638; Hudson 10,269, 1,299, 4,220; Middlesex 7,684, 2,022, 922.

## Terms, license, robots

- No licence. The service metadata says: "Acknowledgement of the service provider, NJ Office of
  Information Technology, Office of GIS (NJOGIS), is requested for maps, data or other products
  derived from this service", disclaims all warranty ("as is"), says the data "must not be used as
  survey data", and adds that distribution is "subject to the Conditions of Use for State of New
  Jersey executive branch web sites" (<https://www.nj.gov/nj/legal.shtml>, read: information
  disclaimer, investment disclaimer, links, endorsement, intrusion detection, privacy; no licence,
  no redistribution grant, no commercial-use or AI-use clause). AI use is not addressed.
- robots.txt: `nj.gov` disallows only `/Support/`, a few `/cgi-bin/` application paths and document
  folders; the Hub (`njogis-newjersey.opendata.arcgis.com`) has `Crawl-delay: 60` and disallows
  `/sites/`, `/admin/`, `/sessions/`, `/groups/`, `/people/`, `/workspace/`; `services2.arcgis.com`
  returns no robots.txt (the body is the text "Invalid URL"). The collector's discover step ran clean
  on both landing pages.
- **Owner names are redacted by statute.** NJGIN: "In compliance with the provisions and protections
  afforded the personally identifiable information of certain persons, as enacted by Daniel's Law
  (P.L. 2020, c. 125), the NJ Office of GIS has redacted owner names from all hosted parcels and tax
  list database downloads, map services and applications." The metadata cites Bill A6171 and
  danielslaw.nj.gov. `OWNER_NAME` is blank in all 8,000 rows sampled. The owner mailing street, city
  and ZIP (`ST_ADDRESS`, `CITY_STATE`, `ZIP_CODE`) are published.
- **Statutes touching commercial reuse.** Nothing found that restricts commercial use of the tax
  list as such. Daniel's Law is the live constraint: N.J.S.A. 56:8-166.1 (read as summarized in
  secondary sources and the Office of Information Privacy's pages, not in full) bars any person,
  business or association from disclosing or re-disclosing the home address of a covered person
  (judges, law-enforcement officers, prosecutors and family) after written notice, with a private
  right of action; courts have treated each access as a separate disclosure and data-broker suits
  are pending. OPRA (N.J.S.A. 47:1A-5) only sets a 14-business-day response time for commercial
  requests and special service charges. A person should have counsel decide whether republishing
  `ST_ADDRESS` (owner mailing address, often a home address of a small owner) is acceptable before
  it is stored.

## What the file contains

Fields on the layer (statewide parcel standard plus a MOD-IV subset): `PAMS_PIN` (municipal code,
block, lot, qualifier; the parcel key), `COUNTY`, `MUN_NAME`, `PROP_LOC` (situs, no ZIP), `PROP_CLASS`,
`OWNER_NAME` (blank), `ST_ADDRESS`, `CITY_STATE`, `ZIP_CODE`, `LAND_VAL`, `IMPRVT_VAL`, `NET_VALUE`,
`LAST_YR_TX`, `BLDG_DESC`, `LAND_DESC`, `CALC_ACRE`, `PROP_USE` (three-character property use code
for class 4 properties), `BLDG_CLASS`, `YR_CONSTR`, `SALE_PRICE`, `DEED_DATE`, `DWELL`, `COMM_DWELL`,
`PCL_PBDATE`. In the 8,000 sampled class 4 parcels (2,000 per county, in object-id order): situs and
owner mailing address on all, a net value on 7,997, a construction year on 4,666, a sale price on
6,666.

Property classes: 4A commercial, 4B industrial, 4C apartments, the codes used by the MOD-IV system
(the MOD-IV User Manual's class definitions, including the unit threshold for 4C, were not read for
this review; confirm them before mapping). The layer has `DWELL`/`COMM_DWELL` unit counts, mostly
blank in the sample. The mapping would be 4A to F1, 4B to F2, 4C to B; the 15-series exempt classes
are out of scope. No area of improvements is published; `CALC_ACRE` is a lot size in acres.

## Gates

**Terms, one action for a person:** email `njgin@oit.nj.gov` (the service metadata's contact for
errors and questions) and ask in writing whether the statewide Parcels and MOD-IV data may be
redistributed in an open dataset and used to train and serve AI systems, with attribution to NJOGIS.
Until the answer is on file the source stays `verified: false` and the collector skips it. Separately,
counsel should decide the `ST_ADDRESS` question under Daniel's Law. Owner names are not obtainable
here at all; the only route is an OPRA request to each county tax board or municipal assessor, who
will apply the same redaction, so for New Jersey the registry would have situs, class and value but
no owner-to-entity links.

## Real run

None (unverified). Samples were fetched only to confirm the layout: 2,000 class 4A/4B/4C parcels for
each of Bergen, Essex, Middlesex and Hudson (Bergen 4A 1,445, 4C 346, 4B 209; Essex 1,445, 240, 315;
Middlesex 1,484, 96, 420; Hudson 1,363, 511, 126), `OWNER_NAME` blank in every row.

## Known gaps

- No owner names, by law. No improvement area. Situs has no ZIP (the owner ZIP is not the situs ZIP).
- The 3857 service is a convenience copy; the file geodatabase downloads (size not measured) are the
  bulk route and need the Hub's 60-second crawl delay.
- The Division of Taxation MOD-IV "Tax List Search" and the Rutgers MOD-IV historical database
  (`modiv.rutgers.edu`, 1989 to date, downloads limited and larger requests by arrangement) were
  not reviewed.
