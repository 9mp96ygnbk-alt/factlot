# co-sos-entities: Colorado business entities (Colorado Department of State)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-02. Machine-readable copy:
[`registry/sources/co/co-sos-entities.json`](../../../registry/sources/co/co-sos-entities.json).
Adapter: `python/src/factlot/registry/adapters/co_sos_entities.py`; tests:
`python/tests/test_adapter_co_sos_entities.py`.

## Publisher and URLs

- Publisher: Colorado Department of State (CDOS, the Secretary of State's office), published by the
  Business Intelligence Center of Colorado on the Colorado Information Marketplace
  (`data.colorado.gov`, a Socrata portal).
- Dataset: "Business Entities in Colorado", id `4ykn-tg5h`,
  <https://data.colorado.gov/Business/Business-Entities-in-Colorado/4ykn-tg5h>. Metadata:
  <https://data.colorado.gov/api/views/4ykn-tg5h.json>. Dataset description: "Colorado Business
  Entities (corporations, LLCs, etc.) registered with the Colorado Department of State (CDOS) since
  1864."
- Bulk file: <https://data.colorado.gov/api/v3/views/4ykn-tg5h/export.csv> (the classic
  `rows.csv` export is marked deprecated by the platform). 3,132,613 rows at review (`$select=count(*)`
  on the SODA endpoint); the portal's custom metadata says it is updated "Every day after midnight".
- Publisher's documentation: the portal links to a CDOS e-learning course on business filing data
  (<https://www.sos.state.co.us/pubs/info_center/eLearningCourses/BIC-BusinessFilingData/index.html>),
  which is a JavaScript application and could not be read as text.

## Terms, license, robots

- License, as the portal records it: `licenseId: PUBLIC_DOMAIN`, license name "Public Domain";
  attribution "CDOS", attribution link <https://www.sos.state.co.us/>.
- Terms of Service of the portal, <https://data.colorado.gov/terms>: "By using data made available
  through this site, the user agrees to all the conditions stated in the following paragraphs as
  well as the terms and conditions described under the State of Colorado Privacy Policy." The
  conditions are a warranty disclaimer, a notice that schemas may change, a required disclaimer
  ("Applications using data supplied by this site must include the following disclaimers on their
  sites: 'The data made available here has been modified for use from its original source, which is
  the State of Colorado. THE STATE OF COLORADO MAKES NO REPRESENTATIONS OR WARRANTY AS TO THE
  COMPLETENESS, ACCURACY, TIMELINESS, OR CONTENT OF ANY DATA MADE AVAILABLE THROUGH THIS SITE. THE STATE OF COLORADO EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, OR FITNESS FOR A PARTICULAR PURPOSE. The data is subject to change as modifications and updates are complete. It is understood that the information contained in the Web feed is being used at one's own risk."),
  and a right to discontinue feeds and "to require the termination of any and all displaying,
  distributing or otherwise using any or all of the data for any reason". Nothing restricts
  copying, redistribution, commercial use or AI use. The registry must show the State's disclaimer
  wherever these facts are displayed (the `attribution` field of the source records this).
- robots.txt (<https://data.colorado.gov/robots.txt>): `User-agent: *`, `Crawl-delay: 1`;
  disallows `/browse?…&q=` style search pages, `/OData.svc/`, `/api/odata/`, `/login`, `/tiles/`
  and widget/edit paths. The dataset page, the metadata endpoint and the export are allowed. The
  collector's 2 s interval exceeds the crawl delay.
- Platform terms: the Socrata/Tyler platform's own terms (linked from the footer as
  <https://www.tylertech.com/privacy>) were not read as text; same note as for
  `tx-comptroller-franchise`.

## What the file contains

One CSV row per registered entity, UTF-8, header row, 35 columns (portal field names):

| Column                                                                                           | Meaning (portal column description)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entityid`                                                                                       | "The state assigned identification number (unique) for the business entity." Used as `registry_number`; the entity URN is `fl:entity:us-co:<entityid>`.                                                                                                                                                                                                                                                                                                                                 |
| `entityname`                                                                                     | "The name of the business entity as selected by the business owner." The Department appends a status history to the name of an entity that is not in good standing (", Dissolved November 30, 1874", ", Delinquent January 1, 2025", " Reinstated 2004, Delinquent January 1, 2010", ", delinquency cured October 08, 2026"): 1,871,772 of 3,132,613 names. The adapter strips it (`legal_name`); the status column already says it.                                                    |
| `principaladdress1/2`, `principalcity`, `principalstate`, `principalzipcode`, `principalcountry` | Principal address (the portal warns it "is not always guaranteed to be the physical location"). Stored as the entity's address; the mailing address is used when it is blank.                                                                                                                                                                                                                                                                                                           |
| `mailingaddress1/2`, `mailingcity`, `mailingstate`, `mailingzipcode`, `mailingcountry`           | Mailing address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `entitystatus`                                                                                   | One of 15 status names (counts at review): Delinquent 1,164,345; Good Standing 1,024,737; Voluntarily Dissolved 603,550; Administratively Dissolved 157,830; Withdrawn 80,750; Noncompliant 33,037; Revoked 20,686; Judicially Dissolved 15,925; Exists 15,658; Merged 10,168; Converted 4,874; Registered Agent Resigned 663; Effectiveness Prevented 228; Dissolved (Term Expired) 144; Consolidated 18. Mapped to snake-case tokens (`good_standing`, …) by `STATUS` in the adapter. |
| `jurisdictonofformation` (sic)                                                                   | State or country of formation, written inconsistently as a postal code or a name ("DE", "Delaware", "DELAWARE"; 2,856,739 rows are "CO"). Mapped to `state_of_formation` when it names a US state; countries, "United States" and "FC" give `None`.                                                                                                                                                                                                                                     |
| `entitytype`                                                                                     | CDOS abbreviation: `DLLC` 2,116,937, `DPC` 552,185, `DNC` 129,372, `FLLC` 126,043, `FPC` 120,354, `DLP`, `DLLP`, `FNC`, `DLLLP`, `FLP`, `FO`, `GP`, `DPC-PBC`, … (D = domestic, F = foreign; LLC, PC profit corporation, NC nonprofit corporation, LP, LLP, LLLP, PBC public benefit corporation). Not stored (no field in `EntityRecord`).                                                                                                                                             |
| `agentfirstname` … `agentmailingcountry`                                                         | Registered agent (mostly natural persons). Not read.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `entityformdate`                                                                                 | Formation date. Not stored (no field in `EntityRecord`).                                                                                                                                                                                                                                                                                                                                                                                                                                |

`EntityRecord` mapping: `legal_name` = `entityname`, `registry_jurisdiction` = `us-co`,
`registry_number` = `entityid`, `taxpayer_number` = none (the file has none), `mailing_address` =
principal address (else mailing address), `status` as above, `locator` = `export.csv entityid <id>`.

## Gates

None for the download: no account, login, click-through, fee or CAPTCHA. A person should still read
the platform's own terms (as for every Socrata portal in the registry) and should decide where the
State's required disclaimer is shown.

### Platform terms read 2026-11-03

Tyler Technologies Terms of Use (served at <https://www.tylertech.com/terms/socrata-terms-of-service>, "Effective April 29, 2024"; HTTP 200, read 2026-11-03; matches the browser capture). Full notes: [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md). Under "Restrictions on Use" the user may not:

> Use any computer code, data mining software, "robot," "bot," "spider," "scraper" or other automatic device, or program, algorithm or methodology having similar processes or functionality, or any manual process, to monitor or copy any of the Web pages, data or content found or accessed through the Services;

> Display, distribute, license, perform, publish, reproduce, duplicate, copy, create derivative works from, modify, sell, resell, exploit, transfer, or transmit for any commercial purposes, all or any portion of the Services

Read: these are Tyler's generic terms for its own "Services". The page refers to "the terms specific to a particular Service as applicable" and does not address a public agency's own dataset licence. Read literally, the scraper clause covers copying "data ... accessed through the Services", which is in tension with the collector's export downloads; the publisher's own dataset licence (recorded above) is what grants rights in the data. Open point: whether to rely on the agency licence and treat the Tyler page as platform boilerplate, or ask the agency (not Tyler) to confirm that its licence governs bulk exports. Nothing was accepted.

## Real run (2026-11-03)

The full export was archived by the collector (`collected/co-sos-entities/a92bf7fb1236bc86/export.csv`, 819,036,143 bytes, document `fl:document:sha256-a92bf7fb1236bc86cfe080bbfe6f87d4e33650b3187ae67680eddd898eccf074`).
Command: `python -m factlot.registry.adapters.co_sos_entities collected/co-sos-entities/a92bf7fb1236bc86/export.csv registry.db --as-of 2026-11-02`.

- Rows read 3,132,613; kept 3,132,612; invalid 1; distinct entities in the
  registry 3,132,612; facts written 15,567,366; 1433 s.
- After the final linking pass, **9,332 of Denver's 11,115 organisation owners of record resolve to a Colorado entity** (83%; C23's jurisdiction rule).

Quality pass (2026-11-03): the first load kept the appended status history in `entity.legal_name`, so an
owner of record written as the bare name (`ACME INC`) never matched an entity the Department lists
as `ACME INC, Delinquent January 1, 2025`: 60% of the file. `legal_name` now strips it
(`Registry.rewrite_entity_names`, or `python -m factlot.registry.maintain --clean-entity-names`, applies the fix
to a built file). See [the Tier 1 quality report](../quality/tier1-2026-11-03.md) for the effect on the link rate.

## Known gaps

- Every entity ever registered is in the file (1864 onward), most of them delinquent or dissolved.
  The registry's exact-name owner linking treats two entities with the same normalized name as
  ambiguous, so an owner name that matches a live entity and a dissolved one of the same name is
  left unlinked, unless every one but one has ended: then the surviving entity is linked at
  confidence 0.85 (registry README, stage 1).
- `entitytype` and `entityformdate` are not stored because `EntityRecord` has no field for them.
- The e-learning course that documents the fields could not be read; the column descriptions on the
  portal were used instead.
