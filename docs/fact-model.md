# Fact model

The reference implementation is [`@factlot/schema`](../packages/schema). JSON Schema
versions are available from `jsonSchemas()` or from the MCP tool `schema_get`.

A **fact** is one atomic, citable claim about one identified subject:

```json
{
  "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4",
  "predicate": "lease.renewal_option",
  "value": {
    "count": 2,
    "term_months": 60,
    "notice_months": 12,
    "rent": "95% of FMV"
  },
  "as_of": "2026-11-02",
  "provenance": {
    "method": "extracted",
    "sources": [
      {
        "document_id": "fl:document:sha256-…",
        "title": "Second Amendment to Lease",
        "page": 4,
        "section": "§3(b)",
        "quote": "Tenant shall have two (2) options to extend…"
      }
    ],
    "producer": { "name": "factlot-ingest", "version": "0.3.1" },
    "confidence": 0.96
  },
  "rights": { "ai_use": "permitted", "redistribution": "prohibited" },
  "supersedes": ["fact_01jb…"]
}
```

## Rules

1. **No uncited facts.** Every fact must have at least one source, except facts
   whose `method` is `computed`; an `inferred` fact cites the evidence it was
   inferred from. A computed fact names its formula (`calc.net_effective_rent@1`,
   required unless it cites a source) and lists its input fact IDs where it has
   them. Fields the schema does not define are rejected, `valid_from` may not be
   after `valid_to`, and a source `span` may not end before it starts.
   `fact_validate` also checks the value of an Ingest predicate against each
   source quote ([document verification](document-verification.md)).
2. **Method tells agents when to escalate.** The trust levels, from highest to
   lowest, are `human_verified`, `public_record`, `computed`, `extracted`,
   `reported`, and `inferred`. An agent should send a human anything below its
   threshold.
3. **Rights travel with the data.** `ai_use` and `redistribution` let an agent
   decide mechanically whether it may read a fact, and whether it may put it in a
   client deliverable. Data licensing often decides whether a fact may be used at all.
4. **Time is explicit.** `as_of` is required. Facts that change over time, such as
   rent steps or zoning, carry `valid_from` and `valid_to`.
5. **Amendments supersede rather than overwrite.** A fact from an amendment lists
   the IDs of the facts it replaces in `supersedes`. The full history is kept.
6. **Predicates are open.** Predicates are dotted, lowercase snake_case names. Asset
   classes extend the vocabulary without schema changes, for example
   `datacenter.critical_it_mw` or `hotel.keys`. This is deliberate: data center,
   hotel, medical, and storage assets do not fit a generic office schema.

## Predicates the registry writes for zoning, building and sale facts

The registry (`docs/registry/`) attaches these to parcels, in addition to the roll facts
(`parcel.apn`, `parcel.land_area_sf`, `parcel.improvement_area_sf`, `parcel.year_built`, and the rest).
They come from sources that add facts to parcels an appraisal roll created ("enrichment" sources: NYC PLUTO,
the DC zoning map, NYC Department of Finance sales), never new parcels. The names are listed in
`Predicates` (`@factlot/schema`) and in `ENRICHMENT_PREDICATES` (`factlot.registry.store`); a test keeps them
in step. A building-level fact is attached to the parcel and describes the lot's buildings taken together,
because the registry holds parcels, not buildings. `zoning.district` is the registry's name for what the
starter list called `parcel.zoning_district`, which the registry does not write.

| Predicate                                                                                             | Value           | Unit              | Meaning                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | --------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zoning.district`                                                                                     | string          |                   | The lot's zoning district as the jurisdiction names it (`C5-3`, `MU-4`). On a split lot, the district covering most of it                                                                                                                                                                                                                                                                       |
| `zoning.district_description`                                                                         | string          |                   | The publisher's description of the district                                                                                                                                                                                                                                                                                                                                                     |
| `zoning.other_districts`                                                                              | list of strings |                   | Further districts of a split lot                                                                                                                                                                                                                                                                                                                                                                |
| `zoning.split_zone`                                                                                   | `true`          |                   | Written only when a zoning boundary splits the lot                                                                                                                                                                                                                                                                                                                                              |
| `zoning.commercial_overlay`                                                                           | list of strings |                   | Commercial overlay districts (NYC)                                                                                                                                                                                                                                                                                                                                                              |
| `zoning.special_district`                                                                             | list of strings |                   | Special purpose districts and overlay zones, by the jurisdiction's name                                                                                                                                                                                                                                                                                                                         |
| `zoning.limited_height_district`                                                                      | string          |                   | NYC limited height district                                                                                                                                                                                                                                                                                                                                                                     |
| `zoning.e_designation`                                                                                | string          |                   | NYC environmental designation number                                                                                                                                                                                                                                                                                                                                                            |
| `zoning.max_far_residential`, `_commercial`, `_facility`, `_manufacturing`, `_affordable_residential` | number          |                   | Maximum floor-area ratio the zoning allows for that use; a ratio the publisher lists as 0 is not written                                                                                                                                                                                                                                                                                        |
| `parcel.built_far`                                                                                    | number          |                   | Built floor-area ratio as the publisher computes it                                                                                                                                                                                                                                                                                                                                             |
| `parcel.num_buildings`, `parcel.num_floors`                                                           | integer, number |                   | Buildings on the lot; floors of the tallest one (may be fractional)                                                                                                                                                                                                                                                                                                                             |
| `parcel.units_residential`, `parcel.units_total`                                                      | integer         |                   | Unit counts                                                                                                                                                                                                                                                                                                                                                                                     |
| `parcel.area_by_use_sf`                                                                               | object          | sf                | Gross floor area by use: `commercial`, `residential`, `office`, `retail`, `garage`, `storage`, `factory`, `other` (positive ones only)                                                                                                                                                                                                                                                          |
| `parcel.land_use_code`                                                                                | string          |                   | The publisher's land use category code (NYC: `01`-`11`)                                                                                                                                                                                                                                                                                                                                         |
| `parcel.year_altered`                                                                                 | integer         |                   | Latest major alteration year                                                                                                                                                                                                                                                                                                                                                                    |
| `parcel.historic_district`                                                                            | string          |                   | Name of the historic district the lot is in                                                                                                                                                                                                                                                                                                                                                     |
| `parcel.landmark_designated`                                                                          | `true`          |                   | The lot has a landmark designation (the designation's name is not stored)                                                                                                                                                                                                                                                                                                                       |
| `transaction.sale`                                                                                    | object          |                   | One recorded sale: `date`, `price_usd`, and where the source gives them `building_class`, `building_class_category`, `tax_class`, unit counts, `land_area_sf`, `gross_area_sf`, and `nominal_consideration` (true only for a $0 price, a transfer without cash consideration)                                                                                                                   |
| `transaction.deed`                                                                                    | object          |                   | One recorded deed (NYC ACRIS): `date` (recorded), `document_date`, `doc_type` and `doc_type_description`, `amount_usd` (as recorded, zero included), `percent_transferred` (when below 100), `crfn`, `document_id`, `grantors` and `grantees` (**organisations only**), `organizations_only: true`, and `lots_in_document`, `partial_lot`, `air_rights`, `subterranean_rights` where they apply |
| `debt.mortgage_recorded`                                                                              | object          |                   | One recorded mortgage: the same keys with `borrowers` and `lenders` (organisations only); `amount_usd` is the principal for the whole document                                                                                                                                                                                                                                                  |
| `debt.mortgage_satisfaction_recorded`                                                                 | object          |                   | One recorded satisfaction (`SAT`, `PSAT` partial, `WSAT` withheld): the same keys; it is an event on the lot and is not linked to a particular mortgage                                                                                                                                                                                                                                         |
| `zoning.max_far_nonresidential`                                                                       | number          |                   | Maximum floor-area ratio for non-residential buildings (DC development standards)                                                                                                                                                                                                                                                                                                               |
| `zoning.max_height_ft`                                                                                | number          | ft                | Greatest plain height limit among the zone's building categories (DC development standards); skipped where the limit is stated in prose                                                                                                                                                                                                                                                         |
| `energy.reporting_year`, `energy.property_type`                                                       | integer, string |                   | Year of the newest usable benchmarking report of the property the parcel belongs to; its EPA primary property type                                                                                                                                                                                                                                                                              |
| `energy.site_eui`, `energy.weather_normalized_site_eui`, `energy.source_eui`                          | number          | kBtu/ft2          | Energy use intensity from the report (site, weather-normalized site, source)                                                                                                                                                                                                                                                                                                                    |
| `energy.energy_star_score`                                                                            | integer         |                   | ENERGY STAR score, 1 to 100, where the report has one                                                                                                                                                                                                                                                                                                                                           |
| `energy.ghg_emissions`, `energy.ghg_intensity`                                                        | number          | tCO2e, kgCO2e/ft2 | Total location-based greenhouse gas emissions and their intensity                                                                                                                                                                                                                                                                                                                               |
| `energy.floor_area_sf`                                                                                | number          | sf                | Gross floor area the report used (Portfolio Manager's)                                                                                                                                                                                                                                                                                                                                          |
| `energy.property_lot_count`                                                                           | integer         |                   | Written only when one report covers several tax lots; every `energy.*` figure then describes the whole property, not the lot                                                                                                                                                                                                                                                                    |

**Many-valued predicates.** For every other predicate a reader returns one fact (when two current sources
disagree, the newest). `transaction.sale`, `transaction.deed`, `debt.mortgage_recorded` and
`debt.mortgage_satisfaction_recorded` are the exceptions: a parcel holds one fact per sale or recorded document, all
current ones are returned, newest first by `date` (price, then fact ID, break ties). The list is
`MULTI_VALUED_PREDICATES` in both `factlot.registry.store` and `@factlot/tools`.

**Sales name no parties; recorded documents name organisations only.** The sales sources publish no buyer, seller or other
party, so a `transaction.sale` carries none, and none states that a sale was at arm's length. The recorded-document
facts (`transaction.deed`, `debt.mortgage_recorded`, `debt.mortgage_satisfaction_recorded`, from NYC ACRIS) do have
parties in their source, and name only those that are organisations under the registry's `is_organization` rule. Every
other party (any natural person, and any name the rule is not sure about) is dropped when the file is read and appears in
no fact, count, index or log; the fact says `organizations_only: true` so that a deed to an individual (no grantee
listed) is not read as a deed with no grantee.

**Inherited and derived facts.** A condominium unit lot has no row in NYC's PLUTO; its `zoning.*` and a few building facts
are copied from its billing lot, as `inferred` facts (confidence 0.9) whose locator names the billing lot. A DC parcel's
`zoning.max_far_*` and `zoning.max_height_ft` are the standards of its zoning district (`inferred`, confidence at most
0.9, 0.6 under an overlay suffix). A parcel that a city's zoning map is joined to by its coordinates (Minneapolis) or an
energy report matched to it by street address (Denver) is `inferred` as well.

**Derived zoning.** Where the zoning map and the lots come from different files (DC), the district is found by
overlaying the lot polygon on the zoning map. The fact's method is `inferred`, its confidence is the district's
share of the sampled points on the lot (at most 0.95), and its locator names both files by document ID.

## Predicates from SEC filings

Two registry sources read the SEC's EDGAR filings ([CMBS loan data](registry/sources/sec-edgar-cmbs-abs-ee.md),
[Exhibit 21 subsidiary lists](registry/sources/sec-edgar-exhibit-21.md)). Their predicates are in `Predicates`
(`@factlot/schema`) and `ENRICHMENT_PREDICATES` (`factlot.registry.store`).

**`debt.cmbs_loan`** is attached to a **building** subject (`fl:building:us-<SSCCC>:<zip5>:<street>`), not to a parcel:
a loan is secured by a building, and the registry joins it to parcels through the building (the roll-up, or a
`located_on` link from the building to its one parcel). It is many-valued: one fact per CMBS trust and loan that names the
building, returned newest reporting period first (`MULTI_VALUED_PREDICATES`). Method `public_record`; the fact's source
is the trust's Exhibit 102 file (`as_of` is the reporting period end). The value is an object; fields are omitted when the
filing leaves them out.

| Field                                                                                                     | Meaning                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trust`, `trust_cik`, `loan_id`                                                                           | The issuing trust, its SEC CIK, and the loan's "Prospectus Loan ID" in that trust                                                                                                                                                                                                                     |
| `reporting_period_start`, `reporting_period_end`                                                          | The monthly report the figures come from                                                                                                                                                                                                                                                              |
| `originator`, `origination_date`, `maturity_date`, `original_term_months`, `amortization_months`          | As filed (`maturity_date` is the final maturity; a hyper-amortizing loan's anticipated repayment date is not given)                                                                                                                                                                                   |
| `original_balance_usd`, `current_balance_usd`, `balance_at_securitization_usd`, `actual_balance_usd`      | The trust's loan: scheduled balance at period end, and the actual balance when it differs. **Not the property's share** of a multi-property loan                                                                                                                                                      |
| `interest_rate_pct`                                                                                       | Rate for the period, in percent (`5.25`)                                                                                                                                                                                                                                                              |
| `payment_type`, `loan_structure`, `interest_only`                                                         | Coded `{code, description}` (SEC code tables): amortizing/IO/hyper-amortizing; whole loan, pari passu note, A/B note...                                                                                                                                                                               |
| `properties_in_loan`                                                                                      | How many properties secure the loan. Balances repeat on each property's fact: do not add them up                                                                                                                                                                                                      |
| `payment_status`, `paid_through_date`                                                                     | Delinquency: `{code: "0", description: "Current"}`, 30-59, 60-89, 90+ days, matured balloon, grace period, late under 30 days                                                                                                                                                                         |
| `primary_servicer`, `special_servicer_transfer_date`, `master_servicer_return_date`, `specially_serviced` | Servicing. `specially_serviced` is true when a transfer date is reported and no later return date is. **No watchlist status is in the filing**                                                                                                                                                        |
| `workout_strategy`, `modified`, `last_modification_date`, `modification`, `post_modification_*`           | Workout and modification, coded                                                                                                                                                                                                                                                                       |
| `paid_off_in_period`, `liquidation_prepayment`, `liquidation_prepayment_date`                             | The balance fell to zero in the period (paid off or liquidated)                                                                                                                                                                                                                                       |
| `property`                                                                                                | Name, address, city, state, ZIP, county as filed; `type`; `net_rentable_sf`; `units_beds_rooms`; `year_built`; `occupancy_pct`; `noi_usd`, `ncf_usd`, `dscr_noi`, `dscr_ncf` with `financials_period_*` (most recent) and `*_at_securitization`; valuation; `status`; `defeasance`; `largest_tenants` |
| `placement`                                                                                               | How the building ID was keyed: `state_fips`, `county_fips`, `method` (ZIP code area, county name, ...), and `address_used` when a list of house numbers was cut to the first                                                                                                                          |

No borrower or sponsor is named in the filing, so none is stored. Tenant names are stored only for organisations or recurring
chains (never a person).

**`entity.parent`** (many-valued: two registrants may list one joint venture) is attached to a registry **entity** (an LLC or corporation from a state registry) and says which SEC
registrant lists it as a subsidiary in Exhibit 21 of its Form 10-K. Method `inferred`, with a confidence (0.9 when the
exhibit's jurisdiction is the state whose registry holds the entity, 0.85 when it is the state of formation the registry
records for a foreign registration) and the exhibit line as locator. The match is an exact normalized name plus the
jurisdiction; nothing fuzzy. A company registered in several states is several registry entities and each gets the fact;
two live same-name entities in one registry are ambiguous and get none. The value holds `parent` (`name`, `cik`, `urn` = `fl:entity:us-sec:<CIK>`), `listed_as` (the
name and jurisdiction as the exhibit writes them), `filing` (accession, dates, exhibit) and `match` (rule). The registrant
is an entity of its own and holds a `controls` relationship to each subsidiary. "Subsidiary" is the registrant's word and
covers indirect subsidiaries, so the registrant is the _ultimate listed parent_, not necessarily the immediate one, and many
registrants list only significant subsidiaries.

## Lease comps

`lease.comp` (subject an `fl:lease:` URN) holds one lease comparable and `lease.net_effective_rent` its derived net
effective rent; their shape, the validator `lease_comp_validate`, the GSA and SEC sources and the rules for sharing comps
between firms are in [lease-comps.md](lease-comps.md). The registry also writes `lease.rentable_area_sf`,
`lease.commencement_date`, `lease.expiration_date` and `lease.landlord` (an organisation only) on those leases, and
`leases` relationships from a lease to its building ID and to the parcels at its address.
