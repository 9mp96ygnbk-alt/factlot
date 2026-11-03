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

## Real run

Run on 2026-11-02 (US Central evening; UTC 2026-11-03). **Sample, not the full file.** The v3 export
streamed 16 MB in 18 minutes and the SODA request `?$limit=3000000` about 4 MB per minute, so
the roughly 400 MB file would have taken well over an hour; both were stopped (the brief's 30-minute
limit) and a 20,000-row request was archived instead. The sample is the first 20,000 rows in the
portal's default order, which is alphabetical by business name (it starts at "001care Inc"), so it
over-represents names beginning with digits and early letters.

- Collector `discover` on the metadata page: `ok`, 0 file links matched (a JSON page; the file URL is
  known from the portal).
- Snapshot (via a scratch copy of the config whose `files` lists the SODA sample URL, same source id):
  `collected/pa-sos-entities/68b25849aa06e515/3urc-uaba.csv`, 3,426,712 bytes, retrieved
  2026-11-03T01:45:32+00:00, `Last-Modified: Tue, 06 Oct 2026 12:56:05 GMT`; document id
  `fl:document:sha256-68b25849aa06e5156731985dacb253e731e3cdb5a68b23c02e06b9c86240f267`; as-of 2026-10-06.
- `pa_sos_entities.build(..., as_of="2026-10-06")`: rows read 20,000; entities kept 20,000; skipped
  invalid 0; facts written 98,980; owner links 0 (no parcel data in the test registry); 3 seconds.
  Entity register, so no category split and no organisation-owner count.
- In the sample: state of formation PA 18,980 (domestic), unknown 1,020 (foreign); every row has a
  filing number (10 digits) and an address; types Domestic LLC 13,144, Domestic Business Corporation
  3,173, Domestic LP 1,853, Domestic Nonprofit 805, Foreign LLC 741, Foreign Business Corporation 199,
  Foreign LP 69, Foreign Nonprofit 10, Domestic Business Trust 3, Domestic GP 2, Foreign LLGP 1.
- Extrapolated: the full 2.38 million rows would ingest in about six to seven minutes at the
  sample's rate.

## Known gaps

- Status is not a standing: the listing contains entities that no longer operate. Linking a parcel
  owner to a `listed` entity therefore says only that the name is registered, not that it is in good standing.
- No entity type, county or officer data is stored. The parent dataset names officers (natural
  persons) and is deliberately not used.
- The full export was not archived on the review machine; the weekly collector run on a normal
  connection will fetch it from the confirmed URL. If the export route stalls, page the SODA
  resource instead. Re-run `discover` monthly.
- Foreign entities have no state of formation in this dataset.
