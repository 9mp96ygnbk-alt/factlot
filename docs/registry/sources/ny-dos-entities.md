# ny-dos-entities: New York Department of State, Active Corporations

Review record for the source `ny-dos-entities` (data policy §5). Machine-readable copy:
[`registry/sources/ny/ny-dos-entities.json`](../../../registry/sources/ny/ny-dos-entities.json).
Adapter: `python/src/factlot/registry/adapters/ny_dos_entities.py`; tests:
`python/tests/test_adapter_ny_dos_entities.py`. Reviewed 2026-11-02.

## Publisher and URLs

- Publisher: New York State Department of State, Division of Corporations, through Open NY
  (`data.ny.gov`, a Socrata portal run by the NYS Office of Information Technology Services).
  Dataset owner contact (from the dataset metadata): `dos.dl.ITServices.CorpUCC@dos.ny.gov`.
- Dataset: "Active Corporations: Beginning 1800", id `n9v6-gdp6`.
  Landing page: <https://data.ny.gov/Economic-Development/Active-Corporations-Beginning-1800/n9v6-gdp6>;
  metadata: <https://data.ny.gov/api/views/n9v6-gdp6.json>.
- Bulk file (confirmed): <https://data.ny.gov/api/v3/views/n9v6-gdp6/export.csv> (the classic
  `/api/views/n9v6-gdp6/rows.csv?accessType=DOWNLOAD` is marked deprecated by the platform but
  still answers). Row-level API: `https://data.ny.gov/resource/n9v6-gdp6.csv` (SODA).
- Size: 4,309,633 rows on 2026-11-02 (`$select=count(*)`); the CSV export is about 1 GB.
  Posting frequency: monthly; "Data is accurate as of the last business day of the month and year
  specified in the dataset name."

## Terms, license, robots

- Terms: OPEN-NY Terms of Use (PDF attached to dataset `77gx-ii52`,
  <https://data.ny.gov/dataset/OPEN-NY-Terms-Of-Use/77gx-ii52>, last modified 2013-03-08). Operative
  sentences: "You are welcome to freely download and use this Content as long as you abide by these
  Terms of Use"; "The State grants you a non-exclusive, revocable license to use the Content contained
  on this website in a manner consistent with the Terms of Use"; and, from the preamble, the terms
  "do not contain restrictions requiring members of the public to use attribution, to re-post the
  license terms with any re-uses of the data, to impose share-alike or technical restrictions, nor
  require the public to obtain pre-approval before re-use of the data. [...] So long as you are not
  doing anything malicious with NYS data, you may use it as you wish, subject to no other
  requirements." Lawful use is the one condition. The dataset itself carries no license field.
- AI use: not addressed.
- Redistribution: permitted (no attribution or share-alike requirement). The registry attributes
  "New York State Department of State" anyway. The data is public record (NY Public Officers Law
  art. 6).
- One clause to flag for a person: under "Public Participation" (the section about uploading content
  and forums) the terms say "You must not create accounts with OPEN-NY or access the site through
  unauthorized means, including but not limited to, by using an automated device, script, bot,
  spider, crawler or scraper." It sits in the section on user-contributed content, and the same
  document invites the public to "freely download and use this Content" and the portal publishes
  bulk export and API endpoints for that purpose; the collector uses those endpoints only, identifies
  itself, and obeys robots.txt. A person should confirm this reading before the source goes live
  (backlog A11), together with the portal platform's own terms (socrata.com), which were not read.
- robots.txt (`data.ny.gov`): `User-agent: *`, `Crawl-delay: 1`; `Disallow` only for `/browse`,
  `/catalog`, `/page` and `/*/browse` search pages with `category=`, `q=`, `tags=`, `sortBy=`,
  `view_type=`, `limitTo=`, `federation_filter=` parameters. The dataset page, the metadata API, the
  export and the SODA resource are allowed; the collector uses the dataset page instead of a search.

## What the file contains

One CSV row per entity that is active on the Division's records (publisher's note: "This data does
not include information on inactive corporations"). Header (portal display names; the SODA API uses
`dos_id`, `current_entity_name`, `chairman_name` ... and the adapter accepts both spellings):

    DOS ID, Current Entity Name, Initial DOS Filing Date, County, Jurisdiction, Entity Type,
    DOS Process Name, DOS Process Address 1, DOS Process Address 2, DOS Process City,
    DOS Process State, DOS Process Zip, CEO Name, CEO Address 1, CEO Address 2, CEO City,
    CEO State, CEO Zip, Registered Agent Name, Registered Agent Address 1,
    Registered Agent Address 2, Registered Agent City, Registered Agent State,
    Registered Agent Zip, Location Name, Location Address 1, Location Address 2, Location City,
    Location State, Location Zip

Publisher's limitations (dataset metadata): "Current Entity Name: Contains only the name by which
the corporation is currently known. [...] County: Contains the current county of incorporation.
[...] Service of Process Address: This address is the location to which legal documents are sent
and may not reflect the physical location of the corporation or any of its officers."

Mapping to `EntityRecord` (no use-code table: this is an entity register, every row is in scope):

| Field                | Source column(s)                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry_number`    | DOS ID (registry jurisdiction `us-ny`; entity URN `fl:entity:us-ny:<DOS ID>`)                                                                                                                                                |
| `legal_name`         | Current Entity Name                                                                                                                                                                                                          |
| `state_of_formation` | Jurisdiction: US states, DC and territories mapped to USPS codes; Canadian provinces, UK nations and other countries left unknown (82 distinct values on 2026-11-02; 3,957,843 "New York", 198,866 "Delaware", 12,944 blank) |
| `mailing_address`    | DOS Process Address 1, Address 2, City, State Zip; when blank, the Registered Agent address                                                                                                                                  |
| `status`             | `active` for every row (the dataset holds active entities only)                                                                                                                                                              |
| `taxpayer_number`    | none in this source                                                                                                                                                                                                          |
| `locator`            | `export.csv DOS ID <DOS ID>`                                                                                                                                                                                                 |

Entity Type (30 distinct values, e.g. DOMESTIC LIMITED LIABILITY COMPANY 2,071,889; DOMESTIC
BUSINESS CORPORATION 1,455,216; DOMESTIC NOT-FOR-PROFIT CORPORATION 288,241; FOREIGN LIMITED
LIABILITY COMPANY 174,576; FOREIGN BUSINESS CORPORATION 135,355) is read by `read_rows` but has no
field in `EntityRecord`, so it is not stored (see Known gaps). CEO name and address and the
Registered Agent name are never read into a record: they are usually natural persons.

## Gates

None. The portal needs no account, login, click-through or fee for the export or the API. The
only blocker on 2026-11-02 was the machine running this review (about 80 KB/s of bandwidth), not
the publisher.

### Platform terms read 2026-11-03 (gates pass, Task 5)

Tyler Technologies Terms of Use (served at <https://www.tylertech.com/terms/socrata-terms-of-service>, "Effective April 29, 2024"; HTTP 200, read 2026-11-03; matches the browser capture). Full notes: [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md). Under "Restrictions on Use" the user may not:

> Use any computer code, data mining software, "robot," "bot," "spider," "scraper" or other automatic device, or program, algorithm or methodology having similar processes or functionality, or any manual process, to monitor or copy any of the Web pages, data or content found or accessed through the Services;

> Display, distribute, license, perform, publish, reproduce, duplicate, copy, create derivative works from, modify, sell, resell, exploit, transfer, or transmit for any commercial purposes, all or any portion of the Services

Read: these are Tyler's generic terms for its own "Services". The page refers to "the terms specific to a particular Service as applicable" and does not address a public agency's own dataset licence. Read literally, the scraper clause covers copying "data ... accessed through the Services", which is in tension with the collector's export downloads; the publisher's own dataset licence (recorded above) is what grants rights in the data. Decision for the founder: rely on the agency licence and treat the Tyler page as platform boilerplate, or ask the agency (not Tyler) to confirm that its licence governs bulk exports. Nothing was accepted.

## Real run (2026-11-03)

The full export was archived by the collector (`collected/ny-dos-entities/39ac829345561661/export.csv`, 813,926,983 bytes, document `fl:document:sha256-39ac829345561661814ae84c01c2546609398adb3e706edb2365732d6b74eb11`).
Command: `python -m factlot.registry.adapters.ny_dos_entities collected/ny-dos-entities/39ac829345561661/export.csv registry.db --as-of 2026-10-30`.

- Rows read 3,631,221; kept 3,631,216; invalid 5; distinct entities in the
  registry 3,631,216; facts written 18,104,445; 2241 s.
- After the final linking pass, **84,607 of New York City's 115,733 organisation owners of record resolve to a New York DOS entity** (73%; C23's jurisdiction rule).

## Known gaps

- `EntityRecord` has no entity-type field, so the publisher's Entity Type (LLC, business corporation,
  not-for-profit, LP, ...) is parsed but not stored. Worth adding to the store before the registry
  relies on this source to tell an owner LLC from a not-for-profit.
- Active entities only: an owner-of-record whose entity has dissolved will not link.
- Initial DOS Filing Date, County, and the principal Location address are not stored (no fields).
- Non-US jurisdictions of formation (about 650 rows) are left unknown rather than recorded as a
  country.
- Re-run `discover` monthly: the dataset id is stable but the portal may change the export route
  again.
