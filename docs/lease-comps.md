# Lease comps

Lease comps are the one thing the survey's personas asked for that no open source had: what
space like theirs leases for. FactLot does not sell them. It holds comps as **cited, verifiable
facts** from three free routes, and gives firms an open format and a validator to trade comps
with each other without a central database.

> **A comp is only as good as its basis.** Every comp says its expense basis (full service, NNN,
> base year, ...), whether its rent is the deal's _starting_ rent or a rent seen _now_, who
> confirmed it and how, and what it does not state. The tools never convert between bases and
> never average comps. GSA leases in particular are government-tenant leases: read
> [GSA leases are not market comps](#gsa-leases-are-not-market-comps-for-every-use).

| Route                                                       | Comps                              | What backs a comp                                                                                    | Terms                                              |
| ----------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [GSA lease inventory](#gsa-lease-inventory)                 | 6,994 federal leases (every state) | the GSA file and row, `public_record`                                                                | public domain                                      |
| [SEC lease exhibits](#sec-lease-exhibits)                   | 4 (sample of 55 leases read)       | quote and page of the filed lease, checked by `doc_verify_facts`, `extracted`                        | SEC.gov public information; values and quotes only |
| [Shared by firms](#sharing-comps-between-firms-give-to-get) | whatever firms contribute          | the contributor's own record, cited by ID or hash without sharing it; `reported` to `human_verified` | each comp states its own rights                    |

## The `lease.comp` fact

A comp is an ordinary FactLot fact ([fact model](fact-model.md)): subject an `fl:lease:` URN,
predicate `lease.comp`, an `as_of` date, provenance and rights. Its value is a `LeaseComp`
(`@factlot/schema`, published in `spec/schemas/fact.json`). A comp names no person or company: there is no
tenant or landlord field, only types.

| Field                                                                  | Meaning                                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comp_type`                                                            | `new`, `renewal`, `extension`, `expansion`, `sublease`, `amendment`, `holdover`, `other`                                                                |
| `property_type`, `tenant_type`                                         | `office`, `industrial`, `retail`, `medical_office`, `flex`, ...; tenant by type only (`government_federal`, `corporate`, `retail_national`, ...)        |
| `area_sf`, `area_basis`                                                | area leased and its basis (`rentable`, `usable`, `gross`, `unknown`)                                                                                    |
| `commencement_date`, `expiration_date`, `term_months`                  | give `term_months` or `expiration_date`; if both, they must agree to within a month and a half                                                          |
| `early_termination_date`                                               | first date the tenant may terminate early                                                                                                               |
| `starting_rent_psf_yr`                                                 | the deal's first-year base rent, USD per SF **per year** (a shared comp must give it)                                                                   |
| `current_rent_psf_yr`                                                  | a rent seen now (public inventories); not a starting rent, so no NER is derived from it                                                                 |
| `escalation`                                                           | `none`, `percent` (`rate` 0.03 compounding), `fixed_psf` (`amount` USD/SF/yr), each with `every_months`                                                 |
| `free_rent_months`, `free_rent_applies_to`                             | months of abated rent at the start of the term, base or gross                                                                                           |
| `ti_allowance_psf`, `leasing_commissions_usd`, `other_concessions_usd` | landlord-funded concessions                                                                                                                             |
| `expense_basis`, `opex_psf_yr`                                         | `full_service`, `modified_gross`, `industrial_gross`, `base_year`, `nnn`, `absolute_net`, `ground`, `not_full_service`, `unknown`; tenant-paid expenses |
| `renewal_options`                                                      | `{count, term_months?}`                                                                                                                                 |
| `building`, `submarket`, `state`                                       | optional location: an `fl:building:` ID (anyone computes it from the address), a submarket label, a state code                                          |
| `confirming_party`                                                     | `landlord`, `tenant`, `landlord_broker`, `tenant_broker`, `both_parties`, `public_record`, `appraiser`, `lender`, `other`                               |
| `verification`                                                         | `unverified`, `party_confirmed`, `document_verified` (needs a source with the document's SHA-256), `public_record`                                      |
| `notes`                                                                | caveats, at most 1,000 characters; no names or contact details (a check rejects emails, phone numbers and ID numbers)                                   |

The AI-use and redistribution rights are the fact's own `rights` (`ai_use`, `redistribution`,
`license`, `attribution`); a shared comp must state them. The net effective rent is a second fact,
`lease.net_effective_rent`, derived from the comp.

## `lease_comp_validate`

One tool (MCP, REST `/v1/comps/validate`, every provider format, and `factlot.run_tool` in
Python), the same answers in both languages (`spec/vectors/lease_comps.json`, 32 cases, and 300 more
in the differential test):

1. the fact goes through `fact_validate` (schema, citation, rights, date order);
2. the value is checked against `LeaseComp`, then the rules that need two fields: a rent, a term,
   expiration after commencement, a term that matches the dates, an early termination inside the
   term, free rent within the term, a percent escalation that has its rate, and no email, phone or ID
   number in `notes` or `submarket`;
3. with the default `share` profile it also requires what makes a comp worth sharing: the starting
   rent, escalations, free rent (0 if none), TI (0 if none), property type, an expense basis other
   than `unknown`, stated rights, and a source with a SHA-256 if it claims `document_verified`. The
   `observed` profile (public records) only needs a rent;
4. when valid with a starting rent, `ner.fact` is a **computed** `lease.net_effective_rent` fact:
   `calc.net_effective_rent@1`, straight-line and discounted at `discount_rate_annual` (default 8%,
   an assumption, not part of the comp), on the comp's own expense basis, its `inputs` naming the comp's
   fact ID if it has one, and its `rights` copied from the comp.

Warnings do not fail a comp: unknown rights, a rent outside $1 to $500 per SF per year, free rent
equal to the term, free rent on gross rent (the calculator abates base rent only), a mid-month
commencement.

```
lease_comp_validate({ fact: { subject: "fl:lease:…", predicate: "lease.comp", value: {…}, as_of, provenance, rights } })
→ { valid, issues: [{ path, message }], warnings, ner: { formula: "calc.net_effective_rent@1", fact } | null }
```

## `lease_comp_search`

The 6,994 GSA comps ship inside the tool packages, so this tool works offline, in both SDKs, and on the
hosted API, with no registry file and no network call (MCP, REST `/v1/comps/search`, every provider
format, `factlot.run_tool` in Python; the same answers in both languages, `spec/vectors/lease_comp_search.json`,
17 cases, and 150 more in the differential test).

> **Every answer says it:** the federal government (GSA, for an agency) is the tenant in every one of these
> leases. They are not market comps for private tenants, and the rent is the current rent in GSA's file, not the
> starting rent. Read [GSA leases are not market comps](#gsa-leases-are-not-market-comps-for-every-use).

Filters: `state`, `county_fips` (5 digits; Connecticut uses its planning regions), `city` (whole, any case), `zip`
(ZIP+4 accepted), `near` (`latitude`, `longitude`, `radius_miles` up to 500: great-circle distance to the coordinates
GSA's file gives; FactLot geocodes nothing, and the 9 comps without coordinates are left out and counted), rentable SF,
commencement dates, rent per SF, `property_type` (`office`, `industrial`, `other`) and `expense_basis`. `sort` is one of
`distance_asc` (the default with `near`), `commencement_desc` (the default otherwise), `commencement_asc`,
`expiration_asc`, `expiration_desc`, `rent_psf_desc`, `rent_psf_asc`, `rentable_sf_desc`, `rentable_sf_asc`; ties go by
GSA lease number. `limit` is 25 by default, 200 at most.

```
lease_comp_search({ near: { latitude: 29.7604, longitude: -95.3698, radius_miles: 5 }, limit: 3 })
→ { caveat, total_matches: 12, returned: 3, sort: "distance_asc",
    results: [{ comp_id: "fl:lease:0000000000tvar4xzf9ttp7kmj", gsa_lease_number: "LTX16707",
                address: "1000 LOUISIANA ST", city: "HOUSTON", state: "TX", zip: "77002", county_fips: "48201",
                latitude, longitude, building: "fl:building:us-48201:77002:1000-louisiana-st",
                landlord: "1000 LOUISIANA LP", tenant_type: "government_federal", rentable_sf: 132539,
                commencement_date: "2012-05-24", expiration_date: "2027-05-23", term_months: 180,
                early_termination_date: null, annual_rent_usd: 5144284.3, rent_psf_yr: 38.81,
                property_type: "office", expense_basis: "full_service", comp_type: "extension",
                renewal_options_left: 0, distance_miles: 0.16,
                source: { document_id: "fl:document:sha256-11c0a0eb…", section: "row 4898 lease LTX16707 location TX2772" } }, …],
    summary: { label, count: 12, rent_psf_yr: { min, p25, median: 34.31, p75, max }, rentable_sf: {…}, property_types },
    warnings, citation: { source, file_url, document_id, as_of: "2026-11-01", retrieved_at, license, attribution,
    release: "lease-comps-gsa-2026-11-04", release_sha256, rights }, provenance }
```

- `comp_id` is the lease ID the release uses (the same URN `registry_get` takes on a registry built from it), and
  `building` the building ID computed from the address. `landlord` is the lessor only where the release stored it as
  an organisation and `is_organization` still agrees (6,451 of 6,994); otherwise `null`. Individuals are never stored.
- `summary` covers every match, not just the returned page: the count, and the minimum, quartiles (linear
  interpolation between ranks, as PERCENTILE.INC), median and maximum of rent per SF and of rentable SF. It is labelled
  as statistics of GSA leases; over the whole file the median is $29.86 (quartiles $23.54 and $38.63), the figures above.
- The data: `python/src/factlot/data/gsa_lease_comps.tsv` (and the same bytes as a string in
  `packages/tools/src/data/gsa_lease_comps.ts`), one row per comp, 1.34 MB, 431 KB gzipped; it adds about 431 KB
  (gzip) to the hosted Worker. It is parsed on the first search (about 35 ms in Node, 40 ms in Python); later searches
  take about 10 to 20 ms.
- Regenerate it with `python3 scripts/gen-gsa-lease-comps.py October-2026-External.xlsx factlot-lease-comps-gsa-2026-11-04.db.gz`
  (both files from the GSA page and the release). The script parses the GSA file with the registry adapter, takes the
  coordinates and annual rent from the same rows, and stops unless the GSA file is the release's snapshot (same
  SHA-256), the `.db.gz` matches its `SHA256SUMS`, and every comp, landlord, building ID and row locator equals the
  release's.

## How comps are keyed

- **Lease** `fl:lease:<26-character token>`. The [ID spec](id-spec.md) has the registry mint lease
  IDs because a lease has no universal key. The adapters mint them _reproducibly_: ten zeros (no
  timestamp), then 16 base-32 characters of SHA-256 over `gsa-lease-number:<number>` (GSA) or
  `sec-lease-exhibit:<accession>:<file>` (SEC), so two registries built from the same file agree. Each
  adds a crosswalk (`gsa-lease-number`, `sec-accession-exhibit`) and a `registry_search_address` entry. A firm sharing a
  comp mints its own with `mint("lease")` (`@factlot/id`, `factlot.ids`).
- **Building** `fl:building:us-<SSCCC>:<zip5>:<street>`, computed from the address ([ID
  spec](id-spec.md#building-ids)) and written in the comp's `building`. A GSA lease gives only a county
  _name_; `registry/counties.py` maps it to the county FIPS (Census 2020 file plus Connecticut's
  planning regions), so 6,794 of 7,031 leases have a building ID. A building is not a registry subject
  for leases (the roll-up owns those); a `leases` relationship runs from the lease to its building ID.
- **Parcel**: where the registry holds a parcel whose current situs address gives the same building
  ID, a `leases` relationship (`inferred`, 0.8 for one parcel at the address, 0.6 for several) runs
  from the lease to the parcel (`gsa_leases.link_parcels`; run it again after loading more parcels).
  `registry_get` on the lease URN returns the comp, its landlord, its crosswalk and these links; on the
  parcel it returns the leases linked to it.

## GSA lease inventory

Source `gsa-lease-inventory`, adapter `factlot.registry.adapters.gsa_leases`, review record
[registry/sources/gsa-lease-inventory.md](registry/sources/gsa-lease-inventory.md). GSA posts a monthly
file of its leases (address, county, lease RSF, effective and expiration dates, termination right, fully
serviced Y/N, **current annual rent**, office/warehouse/special mix, renewal options left, lessor). It is
a US federal government work (public domain); GSA asks for a citation.

First real run, the October 2026 file (2026-11-04, scratch registry): 7,368 rows with a lease
number; 7,031 leases written (194 rows without an address or state and 143 without lease RSF skipped); **6,994 `lease.comp` facts**; 37 leases keep their dates and area but no comp because the rent
per RSF is outside $2 to $250 (rent and RSF describe different things, such as parking: from $0.23 to
$3,287). 34,571 cited facts, all passing `fact_validate`; every comp passes `lease_comp_validate`.
6,484 lessors stored as organisations, 547 dropped by `is_organization` (individuals and trusts; the rule
is conservative, so about 70 of the dropped are airports, towns and the Postal Service). 6,794 building
IDs (169 streets without a house number, 68 counties the table did not match); 659 leases linked to
798 parcels in the scratch parcel registries available (Tier 1, Tier 2, Harris, Tarrant, DC).

By property type: 6,493 office, 372 industrial, 118 other, 11 unstated. By expense basis: 6,772
fully serviced, 222 not. Median current rent $29.86 per RSF per year (quartiles $23.54 and $38.63).
Most comps: California 613, Texas 530, Florida 384, Virginia 336, New York 265, Pennsylvania 223.
Largest metros: Washington (DC-VA-MD-WV) 427, New York 183, Los Angeles 157, Miami 121, Chicago 113,
Philadelphia 107, Atlanta 86, Dallas-Fort Worth 86, Kansas City 81, Houston 79, Seattle 78, San Diego 75.

### GSA leases are not market comps for every use

The tenant is the federal government. GSA leases are usually full service, follow GSA's own lease form and
requirements (security, accessibility, build-out standards, termination rights), and often cover a small
share of a building. The rent in the file is the **current** annual rent, not the starting rent: the file
carries no escalation schedule, free rent, tenant improvement allowance or commission, so no NER is
derived. GSA states the file is for market research on future leasing opportunities and that certain
details are redacted. Every `lease.comp` from this source says so in its `notes`, and sets `tenant_type`
`government_federal`, `confirming_party` and `verification` `public_record`. An agent should use them as
evidence of what a landlord accepts from a creditworthy government tenant, adjust before using one for a
private tenant, and never mix them silently into a set of market comps.

## SEC lease exhibits

Source `sec-edgar-lease-exhibits`, adapter `factlot.registry.adapters.sec_lease_exhibits`, fetcher
`scripts/registry/sec_lease_exhibits_fetch.py`, review record
[registry/sources/sec-edgar-lease-exhibits.md](registry/sources/sec-edgar-lease-exhibits.md).
Public companies file executed leases as Exhibit 10. **The agent extracts; FactLot verifies**
([document verification](document-verification.md)): an agent reads an exhibit and writes the values it
found with their quotes and pages; `doc_verify_facts` checks each one; only verified facts are stored,
with the filing URL, accession number and the exhibit's SHA-256 (the snapshot is the document hash). A
tenant or landlord name is stored only if `is_organization` passes (and appears in its quote), signature
blocks are refused as quotes, and the lease texts are never stored.

Sample of 2026-11-04: five EDGAR full-text queries (office, industrial, retail, medical, laboratory;
8-K, 10-Q and 10-K exhibits filed 2023 to 2026) found 75 Exhibit 10 documents; 20 were amendments,
subleases or purchase agreements and were not read; **55 original leases were read, 4 became comps**
(Dexcom, San Diego office; Forge Global, San Francisco office; Zynex, Englewood office; Boxabl, North Las
Vegas industrial NNN), one more (Netgear) has verified facts but no comp because its rent steps follow
no constant percentage or dollar bump, and 49 were skipped, chiefly because most leases define the
commencement date as the later of a date or the delivery of the premises (no fixed date to cite), or
redact the rent. A comp from a filing is before leasing commissions (leases do not state them), takes its
expense basis from the agent's reading of a quoted clause (the quote is checked, its meaning is not), and
uses the pages `html_pages` cuts from the exhibit (HTML has no page numbers). To widen the sample, a rent
predicate that takes monthly dollars was added (Dexcom, Boxabl); the next gain is accepting a lease's
stated anticipated commencement date with a flag, which needs a founder decision (below).

## Sharing comps between firms (give-to-get)

There is no database and no account. Firms exchange **comp packages**: a JSON array of `lease.comp`
facts (and their `lease.net_effective_rent` facts) that each passed `lease_comp_validate`. The contribution is
the access: a firm that wants the pool's comps contributes its own in the same format, and each member runs
the validator on what it receives.

1. **Contribute.** Write each deal as a `lease.comp` fact: mint a lease ID, put the economics in the value,
   cite your own record (`provenance.sources[0].document_id` is your system's ID for the lease abstract, or
   `fl:document:sha256-…` of the lease, which proves later that you hold the document without sharing it),
   set `provenance.method` (`reported`, `human_verified`, `extracted`), `confirming_party` and
   `verification`, and the `rights`. Run `lease_comp_validate`; keep `ner.fact` with the comp.
2. **Exchange.** Swap the packages by any channel the members already use (a shared bucket, a Git
   repository, email). Nothing here hosts or routes them. Optionally, a package can be signed by the contributor,
   so a receiver can check who vouched for it; signed packages are an optional layer from the document tools
   workstream, and nothing in the format or the validator depends on them.
3. **Read.** A reader validates each fact again, keeps the rights with it, and treats `unverified` and
   `party_confirmed` comps as hearsay, `document_verified` comps as backed by a document the contributor can
   produce on request, and `public_record` comps as backed by a public file.
4. **Challenge.** A reader who finds a comp wrong sends the contributor the fact ID; the contributor
   supersedes it (`supersedes` in the fact model) with a corrected fact. The history stays.

### Rights model

Rights travel with each comp (`rights.ai_use`, `rights.redistribution`):

- `redistribution: permitted` or `attribution_required`: a member may put the comp in a client
  deliverable (with the attribution, if required). `prohibited`: a member may read and use it in analysis
  inside the pool, and may not reproduce it outside. `unknown` is treated as `prohibited`; the validator warns.
- `ai_use: permitted`: an AI agent may read the comp. `prohibited`: the comp is for human readers only.
  Agents must check this field before they read a comp. FactLot enforces nothing by itself; it makes the
  contributor's choice machine-readable, as the survey asked.
- A contributor may contribute a comp with narrower rights than the pool's norm, and may withdraw a comp by
  superseding it; copies already made are not recalled, which is why `unverified` hearsay should not be shared with `permitted`
  rights.

### No personal data

A comp has no tenant, landlord, broker or contact field, and the shape rejects unknown fields. The text
fields (`notes`, `submarket`) are scanned for emails, phone numbers and ID numbers. A `building` URN is a
street address, so a contributor who wants to keep a tenant unidentifiable should omit it and give a
submarket; the commercial building is not a natural person, but a single-tenant building identifies its tenant. Nothing
here stores a natural person's name.

### What this does not do

It does not decide who may join, store the packages, check that a contributor told the truth (a
`document_verified` comp can be checked against the document on request; the rest rest on the contributor's
word), or normalise one expense basis to another. The NER is on the comp's own basis.

## State and local lease datasets reviewed

Checked 2026-11-04 for open, reusable per-lease data from large states. None is loaded.

| State            | What it publishes                                                                   | Verdict                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| California       | DGS Statewide Property Inventory summary: totals of leased space, rent and leases   | summary only, no per-lease rows                                                                                                       |
| Washington       | OFM Leased Facilities Summary Report, annual PDF                                    | a PDF summary, no open per-lease dataset                                                                                              |
| Colorado         | Office of the State Architect annual report, lease tables with SF, rent, expiration | PDF tables, not a dataset; state tenants                                                                                              |
| Montana, Florida | biennial lease summary (cost per SF by city); statutory 24-month expiry list        | PDF reports                                                                                                                           |
| Connecticut      | data.ct.gov "Leased State Locations" (`u2up-g29d`), public domain                   | 121 rows, address and town but no ZIP, no commencement date, no lessor, and obvious errors (expirations in 1900 and 2112): not loaded |

The shape would need an expiration-only comp and a ZIP source to take the Connecticut file; its value is too
small to justify that.

## Not done, and why

- **Hosting shared comps, accounts, matching and a marketplace.** Not built. Only the public GSA comps are served by
  the hosted API (bundled, `lease_comp_search`).
- **A residential rent benchmark (HUD Fair Market Rents).** Not built: on 2026-11-06 huduser.gov answered every
  scripted request, robots.txt included, with an AWS WAF challenge (HTTP 202, `x-amzn-waf-action: challenge`), which
  FactLot does not work around. HUD's own eGIS copy (the "Fair Market Rents" feature service, owner HUD.Official.Content)
  has FMR areas without the county list, and its metadata says "FY2024" while its data were last edited 2025-09-30, so
  its fiscal year cannot be cited with confidence. A person can download the FMR file from huduser.gov in a browser;
  the tool can then be built from it.
- **CMBS lease data and Exhibit 21** belong to another workstream.
- **A stated anticipated commencement date** (for leases that define commencement by delivery) would raise the SEC
  yield from 4 of 55 to perhaps 15 of 55 if comps may carry an "anticipated" flag. Decision below.
- **IOLP** (GSA Inventory of Owned and Leased Properties, CC0) was archived and reviewed. It adds a construction
  year and an asset type for leased buildings but no rent or lessor; not loaded.
- **Metro labels.** The counts above use the Census 2023 CBSA delineation file; the registry does not store a metro.
