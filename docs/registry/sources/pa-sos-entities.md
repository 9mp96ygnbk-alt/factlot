# pa-sos-entities: Pennsylvania Department of State, registered business entities

Review record for the source `pa-sos-entities` (data policy §5). Machine-readable copy:
[`registry/sources/pa/pa-sos-entities.json`](../../../registry/sources/pa/pa-sos-entities.json).
Adapter: `python/src/factlot/registry/adapters/pa_sos_entities.py`; tests:
`python/tests/test_adapter_pa_sos_entities.py`. Reviewed 2026-11-02.

## Publisher and URLs

- Publisher: Pennsylvania Department of State, Bureau of Corporations and Charitable Organizations,
  through the Commonwealth open data portal `data.pa.gov` (a Socrata portal presented by the Governor's
  Office of Administration). Dataset category "Licenses & Certificates"; update frequency monthly.
- Dataset used: "Filtered View - Distinct Registered Businesses in PA Listing Current by County
  Department of State", id `3urc-uaba`. Metadata: <https://data.pa.gov/api/views/3urc-uaba.json>.
  Page: <https://data.pa.gov/Licenses-Certificates/Filtered-View-Distinct-Registered-Businesses-in-PA/3urc-uaba>.
- Parent dataset (not used): "Registered Businesses in PA Current by County Department of State",
  id `xvd7-5r2c`. It repeats each business once per Governor/Officer and carries the officers'
  first, middle and last names. The distinct view `3urc-uaba` has one row per business and no
  person-name columns, which is why it is the file archived.
- Bulk file: <https://data.pa.gov/api/v3/views/3urc-uaba/export.csv>. Row API: <https://data.pa.gov/resource/3urc-uaba.csv>.
- Size: 2,376,248 rows on 2026-11-02 (`$select=count(*)`); roughly 400 MB as CSV. Data last updated
  2026-10-06 (`rowsUpdatedAt`; `Last-Modified: Tue, 06 Oct 2026 12:56:05 GMT` on the CSV).

## Terms, license, robots

- Portal license field: "Public Domain U.S. Government" (terms link `usa.gov/government-works`).
- PA Data Policy, <https://data.pa.gov/data-policy>: "Data sets available through data.pa.gov are
  offered free and without restriction." Attribution: "While not required, when using data from
  data.pa.gov in your own work, we ask that proper credit be given", example "Data retrieved from
  data.pa.gov". Data is "as is" with no warranty of accuracy or fitness. The Commonwealth reserves the
  right to discontinue content at any time.
- AI use: not restricted and not addressed. Redistribution: permitted ("without restriction");
  public record. The registry attributes "Pennsylvania Department of State, via data.pa.gov".
- robots.txt (`data.pa.gov`): `User-agent: *`, `Crawl-delay: 1`; `Disallow` only for `/browse` and
  similar search pages with `q=`, `category=`, `tags=`, `sortBy=` and similar parameters, `/OData.svc/`,
  `/api/odata/`, `/login`, `/tiles/`. The dataset metadata API, the v3 export and the SODA resource
  are allowed.
- `verified: true`: terms and robots read and recorded; license permits redistribution of the facts and
  does not restrict AI use; the file route is confirmed by real downloads (see Real run), though the
  full export was not completed on the review machine.

## What the file contains

One CSV row per registered business. Header (SODA export; the portal's display names are also
accepted by the adapter):

    business_name, filing_number, address_line1, address_line2, city, state, zip,
    typeofbusinessregistration, shortcountyname, county_code, georeferenced_latitude__longitude

The publisher's description: "ALL active business registrations in the data to include: business
corporations, nonprofit corporations, limited liability companies, limited partnerships, limited
liability partnerships, limited liability limited partnerships, business trusts, land banks,
municipal and other authorities", with the caveat "Due to statutory limitations in removing
businesses no longer in operation from our database, this data shows a larger number of active
businesses than currently exist." Fictitious-name registrations are a separate filing track and are
not in the dataset.

Mapping to `EntityRecord` (an entity register: no category table, every row is in scope):

| Field                | Source column(s)                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `registry_number`    | filing_number (10 digits, leading zeros kept; registry jurisdiction `us-pa`; URN `fl:entity:us-pa:<n>`) |
| `legal_name`         | business_name (the publisher's capitalisation)                                                          |
| `state_of_formation` | `PA` when typeofbusinessregistration starts with "Domestic" or is "Authority"; unknown for "Foreign"    |
| `mailing_address`    | address_line1, address_line2, city, state zip (the publisher does not say which address this is)        |
| `status`             | `listed`: in the publisher's active-registrations listing, not a good-standing claim (no status column) |
| `taxpayer_number`    | none in this source                                                                                     |
| `locator`            | `export.csv filing number <n>`                                                                          |

typeofbusinessregistration has 18 distinct values on 2026-11-02 (portal group-by): Domestic Limited
Liability Company, Domestic Business Corporation, Domestic Limited Partnership (LP/LLLP), Domestic
Nonprofit Corporation, Domestic General Partnership (GP/LLP), Domestic Business Trust, Domestic
Professional Association, Domestic Credit Union, Domestic Financial Institution, Domestic Land Bank,
Authority, and the Foreign counterparts (Business Corporation, Nonprofit Corporation, Limited
Liability Company, Limited Partnership, Limited Liability General Partnership, Professional
Association, Business Trust). The type has no field in `EntityRecord` and is not stored. County,
county code and the point are not stored either.

## Gates

None. No account, login, click-through, CAPTCHA or fee. The only blocker on 2026-11-02 was the
review machine's bandwidth (about 60 KB/s), not the publisher.

### Platform terms read 2026-11-03 (gates pass, Task 5)

Tyler Technologies Terms of Use (served at <https://www.tylertech.com/terms/socrata-terms-of-service>, "Effective April 29, 2024"; HTTP 200, read 2026-11-03; matches the browser capture). Full notes: [`../requests/platform-terms/socrata.md`](../requests/platform-terms/socrata.md). Under "Restrictions on Use" the user may not:

> Use any computer code, data mining software, "robot," "bot," "spider," "scraper" or other automatic device, or program, algorithm or methodology having similar processes or functionality, or any manual process, to monitor or copy any of the Web pages, data or content found or accessed through the Services;

> Display, distribute, license, perform, publish, reproduce, duplicate, copy, create derivative works from, modify, sell, resell, exploit, transfer, or transmit for any commercial purposes, all or any portion of the Services

Read: these are Tyler's generic terms for its own "Services". The page refers to "the terms specific to a particular Service as applicable" and does not address a public agency's own dataset licence. Read literally, the scraper clause covers copying "data ... accessed through the Services", which is in tension with the collector's export downloads; the publisher's own dataset licence (recorded above) is what grants rights in the data. Decision for the founder: rely on the agency licence and treat the Tyler page as platform boilerplate, or ask the agency (not Tyler) to confirm that its licence governs bulk exports. Nothing was accepted.

## Real run (2026-11-03)

The full export was archived by the collector (`collected/pa-sos-entities/b385eeddf8631368/export.csv`, 402,718,857 bytes, document `fl:document:sha256-b385eeddf8631368472bf1133d806843f9e890be3d6c2f3f12ebea7fe2c10cd9`).
Command: `python -m factlot.registry.adapters.pa_sos_entities collected/pa-sos-entities/b385eeddf8631368/export.csv registry.db --as-of 2026-10-06`.

- Rows read 2,376,248; kept 2,376,248; invalid 0; distinct entities in the
  registry 2,376,226; facts written 9,504,660; 453 s.
- Entity register, so no category split and no organisation-owner count. No Pennsylvania
  parcel source is loaded yet (Philadelphia is gated on terms), so no Pennsylvania-registered owner links yet; an exact name match to a parcel in another state is queued for review, not linked (C23).

## Known gaps

- Status is not a standing: the listing contains entities that no longer operate. Linking a parcel
  owner to a `listed` entity therefore says only that the name is registered, not that it is in good standing.
- No entity type, county or officer data is stored. The parent dataset names officers (natural
  persons) and is deliberately not used.
- Re-run `discover` monthly; if the export route stalls, page the SODA resource instead.
- Foreign entities have no state of formation in this dataset.
