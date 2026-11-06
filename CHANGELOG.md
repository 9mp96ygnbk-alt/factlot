# Changelog

All notable changes to FactLot are recorded here. Every package in this repository (the
`@factlot/*` npm packages and the `factlot` Python package) shares one version number.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Calculator formulas carry their own
`version` (for example `calc.net_effective_rent@1`); a formula bump is listed under **Changed**
with the calculator name.

Maintainers: add a line under **Unreleased** in the same pull request as the change. The release
step (`node scripts/release/changelog.mjs release <version>`) moves it under the new version.

## [Unreleased]

### Changed

- `doc_verify_facts`: `verified` now means every part of the value was found in the quote. Prohibited uses, an exclusive's protected use and carve-outs, and ROFR/ROFO descriptions must be written in the quote; an invented item goes to `needs_review` (check `consistency`). A true/false value, an enum the quote does not word, or a paraphrased summary goes to `needs_review` with the new check `coverage` and a reason naming each part. `free_rent.applies_to: base_rent` and a `natural` breakpoint are checked by their wording.
- `doc_abstract_lease`: results no longer depend on document order. A document without a role is the original only when that is unambiguous (`role_inferred: true`); otherwise an `InputError` asks for `role`. Two or more amendments need `effective_date`; same-day amendments conflict instead of superseding.
- `doc_abstract_lease`: an amendment effective after `as_of` is pending: its values are under `pending` and `pending_facts` with a warning, and it does not control the current abstract. A rent schedule restated from a later date keeps the earlier steps (`carried_forward`).
- `doc_compare`: `lease_not_checked` lists the parts of an extracted lease fact that its quote does not confirm. `fact_package_verify` reports `checks_run`, `checks_not_run` and `values_not_checked`; `valid` is unchanged. `doc_verify_claim` accepts a bare sentence string as the claim.
- `calc_exchange_1031` (`calc.exchange_1031@2`): a property identified after the 45-day deadline no longer counts. It is left out of the identification count, total value, ratio, the three-property, 200% and 95% tests and the received share, and is listed only under `late_identifications`. A property received after the exchange deadline no longer counts as received for the 95% exception (before, any late receipt ended the exception).
- `calc_dcf_pro_forma` (`calc.dcf_pro_forma@2`): blended downtime and free rent are no longer rounded to whole months. The suite is vacant for the whole months, the rollover lease's first month collects the remaining share of rent and recoveries, and free rent abates the fraction of a month. Before, a 0.45-month blended downtime disappeared and a 55% renewal probability gave the same value as 100%. A lease that expires inside the projection always appears in `lease_events`, with a warning when its next lease starts after the forward year; the exit-year warning names rollover downtime.
- Whole-number percents are rejected everywhere: a rate field above 1 in absolute value, or `min_dscr` above 10, in any calculator or in `lease_comp_validate` is an input error (HTTP 400) naming the decimal you probably meant ("pass 0.08 for 8%"), instead of computing 800% with a warning. Shares and ratios (`pro_rata_share`, `max_ltv`, `min_debt_yield`, occupancy, `*_pct`) rejected above 1 also say to pass a decimal. This replaces the warning added in 0.3.0.

### Fixed

- Docs: getting-started no longer says REST and OpenAPI always list the registry tools (they are listed only with a registry) and has a hosted-API section, including that Python's default `urllib` user agent is refused at the edge; connectors README tool count and Docker tag; Claude connector steps start from the hosted URL; the site says eleven skills; `document-verification.md` and `ingest.md` list `as_of` as required and describe the stricter checks; the registry-unavailable message links the current DC sample.

## [0.3.0] - 2026-11-04

### Added

- Registry: CMBS loan-level facts from SEC Form ABS-EE (Regulation AB II, EX-102): the many-valued `debt.cmbs_loan` gives, per trust, loan and property, balances, rate, maturity, payment status, servicer and special-servicing dates, workout strategy, NOI, DSCR, occupancy and organisation tenants, on building IDs with a `located_on` link to the parcel (377 registered CMBS trusts; 21,595 facts on 16,701 buildings). No borrower names (the filings carry none) and no watchlist status (not in the SEC data).
- Registry: `entity.parent` and `controls` links from Exhibit 21 of Form 10-K filings to registered entities, matched by exact normalized name and jurisdiction (2,996 links from 109 REITs, retailers and healthcare operators); registrants are `fl:entity:us-sec:<CIK>`. `scripts/registry/sec_edgar.py` reads the declared contact from `FACTLOT_SEC_USER_AGENT`.
- Registry: recorded deeds, mortgages and satisfactions for NYC commercial, industrial and multifamily lots from ACRIS, 2013 to 2026 (`transaction.deed`, `debt.mortgage_recorded`, `debt.mortgage_satisfaction_recorded`, many per parcel, newest first); only organisations among the parties are stored.
- Registry: NYC condominium unit lots inherit zoning and building facts from their PLUTO billing lot (labelled inferred; 99.4% of NYC registry lots now have a zoning district); NYC sales extend back to 2007 (107,090 sales; a standard-library reader handles DOF's legacy `.xls` workbooks).
- Registry: DC parcels get their zoning district's maximum floor-area ratio and height (`zoning.max_far_*`, `zoning.max_far_nonresidential`, `zoning.max_height_ft`, inferred from the Office of Zoning's development standards); building energy benchmarking (`energy.*`) for NYC Local Law 84, DC and Denver; zoning districts for Denver, San Francisco and Minneapolis parcels.
- `doc_spread_statement`: spread a T-12, operating statement or rent-roll summary onto a published chart of accounts (multifamily, commercial, hotel after the USALI summary), with every line cited, footing checks and exceptions.
- `doc_check_use_conflict`: check a proposed use against verified exclusives and prohibited uses with a published use-category vocabulary (66 categories, 2022 NAICS); every hit is a potential conflict for human review.
- Clause-level lease predicates: `lease.prohibited_uses`, `lease.go_dark`, `lease.radius_restriction`, `lease.relocation_right`, `lease.kick_out`; structured `lease.exclusive_use` (carve-outs), `lease.assignment_sublease` (consent standard), `lease.rofr`/`lease.rofo` details and co-tenancy occupancy and named tenants, with numbers and consent wording checked against the quote.
- `fact_package_create` and `fact_package_verify`: canonical (RFC 8785), Merkle-hashed (RFC 6962) fact packages with optional Ed25519 signatures made with the holder's own key; FactLot never holds private keys.
- Self-hosted PDF input: `factlot.read_pdf` and the local MCP tool `doc_read_pdf` (pypdf via `factlot[pdf]`, the OCR hook for scanned pages); `ocr_pages` marks OCR pages in citations. Python extras `pdf` and `signing`. `@factlot/tools` adds `runToolAsync`, `signFactPackage` and `canonicalJson`.
- Lease comps: a `lease.comp` fact shape (rent, escalations, free rent, TI, commissions, term, area, expense basis, who confirmed it, verification) and `lease_comp_validate`, which validates a comp and derives its net effective rent (`calc.net_effective_rent@1`), in both SDKs; `docs/lease-comps.md` describes how firms can trade comps without a central database (rights model, no personal data).
- Registry: `gsa_leases` loads 6,994 federal lease comps from the GSA lease inventory (public domain), keyed to building IDs and linked to parcels, each stating that GSA leases are government-tenant leases; `sec_lease_exhibits` builds comps from SEC Exhibit 10 leases whose values were verified with `doc_verify_facts`.
- `registry_get` takes `as_of` (facts as they stood on a date) and warns when a parcel's area facts are implausible; MCP `fetch` of a registry fact's `fl:document:sha256-…` ID returns the source snapshot's metadata (publisher, URL, dates, licence and rights).
- Operations calculators: `calc_multifamily_rent_roll` (`calc.multifamily_rent_roll@1`: gross potential rent, vacancy, non-revenue units, loss to lease, concessions in weeks, months or dollars amortised over the lease, effective rent income, physical and economic occupancy, expirations by month, floor-plan summaries; a single-lease mode for effective rent after a concession), `calc_capex_recovery` (`calc.capex_recovery@1`: straight-line or level-payment recovery with interest, an optional savings cap, per-tenant split, every assumption echoed with its lease clause) and `calc_cam_reconciliation_batch` (`calc.cam_reconciliation_batch@1`: every tenant in one call, each statement identical to `calc_cam_reconciliation`, with a building reconciliation that explains the unrecovered amount).
- `calc_rent_schedule`, `calc_net_effective_rent` and `calc_compare_proposals` take an optional `unit` (`kw`, `mw`, `unit`, `acre`, `key`, `room`, `space`; default `sf`): labels and warnings follow the unit, numbers are unchanged, and `unit` and `rate_unit` appear only when it is given. Claude Code plugin skill `multifamily-rent-roll`.
- Draft rules packs for NYC Local Law 97 (limit, emissions, $268/tCO2e penalty, 2024–2034), the Washington Clean Buildings Performance Standard (EUI target, Tier 1 test, tier and compliance date) and Boston BERDO 2.0 (emissions standard by building use and year), each citing the official text with a verification checklist. They are drafts, not tools: `runDraftRule(…, { acknowledgeDraft: true })` / `run_draft_rule(…, acknowledge_draft=True)`; every result is marked `status: "draft"` with a DRAFT warning. `scripts/rules/check_draft_tables.py` diffs a draft's tables against official files for the verifying maintainer.
- Valuation calculators: `calc_dcf_pro_forma` (`calc.dcf_pro_forma@1`: property DCF from a rent roll with blended renewal assumptions, recoveries, vacancy, exit cap on forward NOI, value, NPV and unlevered IRR), `calc_direct_cap` (`calc.direct_cap@1`), `calc_amortization_schedule` (`calc.amortization_schedule@1`: partial interest-only, balloon, monthly or quarterly, 30/360 or actual/360 or actual/365, rows that foot to the cent), `calc_equity_waterfall` (`calc.equity_waterfall@1`: pref, return of capital, catch-up, IRR-hurdle promote tiers) and `calc_exchange_1031` (`calc.exchange_1031@1`: deadlines, identification tests, cash and mortgage boot; not tax advice).
- Claude Code plugin skills `cre-valuation` and `exchange-1031`; `cre-loan-sizing` covers amortization schedules.
- Seven Excel reconciliation workbooks in `examples/reconciliation/` (office, industrial, retail, multifamily-adjacent, hotel, lender, ASC 842) from synthetic inputs: live Excel formulas reconciled to FactLot's calculators at zero difference, regenerated by a standard-library script. ARGUS parity is stated as untested.
- Generated `docs/registry/coverage.md` (per state and county: what is loaded, owner names, entity links, zoning, sales, building facts, as-of dates, licence and AI use, and what is queryable today) and `docs/registry/rights.md` (licence, AI use, redistribution and attribution for all 126 reviewed sources), from `scripts/registry/gen_coverage_docs.py`.

### Changed

- Registry owner rule: credit unions, national banks written "N.A.", federal savings banks, government bodies, condominiums and boards of managers, housing development fund corporations, MERS, Fannie Mae and Freddie Mac under their legal names, securitization trusts and foreign GMBH/PLC now read as organisations; a surname that is also an organisation word ("JOHN BANK", "CHURCH, MARY") no longer makes a person an organisation. Registries built earlier need `python -m factlot.registry.maintain <db> --purge-persons`. Shared synthetic vectors in `spec/registry/organizations.json`.
- ID spec 0.3: parcel IDs keep where an APN's separators fall ("12-34" ≠ "1-234"); NYC BBL, Los Angeles AIN, Cook PIN and DC SSL normalize to their zero-padded form ("3-1234-56" = "3012340056"); LEIs must pass their ISO 17442 check digits. Earlier IDs still parse (`normalizeApnV1` / `normalize_apn_v1`), and registry files record the rule they were built with, so published files keep working.
- Registry address search matches whole words: a house number, or a street name with its type; a city name alone no longer matches unrelated streets. Registry messages name counties ("Pinal County, AZ (04021)") from the Census Bureau county FIPS list.
- MCP: input-validation errors return the same JSON error object as REST; `search` returns no results and a note when nothing matches. Calculator steps show rounded numbers in formula text (results unchanged).
- `/openapi-3.0.json` is the curated Custom GPT Actions subset (at most 30 operations); `/openapi.json` (3.1) lists every tool, and `/openapi-3.0.json?operations=all` gives the complete 3.0 document.

## [0.2.0] - 2026-11-04

### Added

- Registry zoning, building and sale facts on parcels. NYC PLUTO adds zoning district, overlays, special districts, maximum floor-area ratios, built FAR, buildings, floors, units and area by use for 116,887 New York City parcels. DC zoning districts (`inferred`, with a confidence, from each lot's polygon sampled against the zoning map) cover 16,648 of 18,077 DC parcels. `transaction.sale` facts come from NYC Department of Finance sales (12,445 sales, 2024 through September 2026) and the DC tax extract (latest sale per parcel), with no party names and arm's length not stated; $0 transfers and prices repeated across several lots are flagged. A parcel can hold many sales, newest first.
- New predicates: `zoning.*`, `parcel.built_far`, `parcel.num_floors`, `parcel.num_buildings`, `parcel.units_*`, `parcel.area_by_use_sf` and others (see `docs/fact-model.md`).
- Document verification: `doc_verify_facts`, `doc_abstract_lease`, `doc_compare` and `doc_verify_claim` (MCP, REST `/v1/doc/*`, every provider format, Python SDK). Your agent extracts each value with a verbatim quote and page; FactLot checks deterministically that the quote is on that page and states the value, and returns cited facts with character spans, review items and rejections with reasons. No model runs and nothing is stored ([guide](docs/document-verification.md)).
- Registry misses now say whether the county, entity registry or crosswalk system is loaded: a `coverage` object comes with empty results and with `registry_get` NotFound, and a malformed URN is a format error. New tool `registry_coverage` lists what a registry file holds.
- ID spec 0.2: `id_building`, a deterministic building ID from county, ZIP and street line (`fl:building:us-11001:20002:208-massachusetts-ave-ne`), shared by every unit at the address; `id_space` accepts it. Registry building roll-up groups condo units and other parcels at one street address under a building with unit and parcel counts, each grouping labelled with how it was inferred (DC or NYC condo lot numbering, or the shared address); `registry_get` and `registry_owned_by` show it.
- Claude Code plugin and marketplace (`/plugin marketplace add 9mp96ygnbk-alt/factlot`, then `/plugin install factlot@factlot`): eight CRE skills (loan sizing, lease economics, CAM reconciliation, ASC 842, lease vs own and renewals, investment returns, hotel metrics, Texas protest deadline) that call the hosted FactLot tools and cite formula IDs.
- `examples/` (curl, Python REST, MCP client, offline SDK, Claude API and OpenAI Responses remote MCP) and `npm run test:hosted`, a live end-to-end check of the hosted service: every conformance vector over REST, every MCP tool against REST, every site page and link, and the checkout paths.
- Registry Tier 2 expansion: statewide Vermont, Arkansas and Connecticut (CC0 layer) parcels, 24 Minnesota opt-in counties, Montana apartments and industrial parcels, five more North Carolina counties (Guilford, Forsyth, Cumberland, Johnston, New Hanover) and Garfield County, Utah: 228,453 more commercial parcels in 182 counties, with review records and adapters ([expansion notes](docs/registry/tier2/expansion.md)).
- Registry quality audit (`python -m factlot.registry.audit`): per source and snapshot, parcel and entity counts, field completeness, conflicting and implausible facts, person-like owner names (policy: zero), owner link rate by confidence and rule with the reasons the rest are unlinked, review queue, snapshot age and citation gaps; `--reread` runs each adapter on its archived file and compares counts. `python -m factlot.registry.maintain` re-applies the person rule, re-keys the name index and review queue, relinks and queues fuzzy candidates on a built file. The Tier 1 audit is in `docs/registry/quality/tier1-2026-11-03.md`.

### Changed

- `fact_validate` rejects unknown fields, `valid_from` after `valid_to`, inverted spans, inferred facts without sources, and computed facts with neither a formula nor a source; for Ingest predicates it checks the value's shape and that each source quote states the value. `@factlot/schema` objects are strict, matching the published JSON Schema (`additionalProperties: false`).
- OpenAPI documents omit `registry_*` operations unless the server has a registry loaded, as `/v1/tools` and MCP already do (keeps Custom GPT Actions under 30 operations).
- Ingest verifier: written-form patterns are ASCII-only, as in JavaScript, and a whole-number float year such as 2026.0 is accepted.
- Address search reads "Northwest", "North West" and "N.W." as "NW" (all eight directionals) and ignores a trailing suite, unit, "#" or floor. Older registry files are searched by old and new keys until `python -m factlot.registry.maintain <db> --all` re-keys them.
- ID spec 0.2, suite rule 2: "Suite 1-20" and "Suite 120" no longer share an ID; "Third Floor" equals "3rd Floor"; "Apt 4B" equals "4B". Earlier IDs still parse, and the old rule stays callable.
- `calc.lease_remeasurement_asc842@2`: the amortization schedule foots to the cent. Every row rolls forward exactly, the final period trues up the liability and ROU asset to zero (shown as a step), `total_interest`, `total_amortization` and the new `total_lease_cost` are row sums, and the rounding rule is stated in the steps. Some schedule cells move by cents; headline figures are unchanged.
- `calc.compare_proposals@2`: `area_basis` (rentable or usable, via `usable_sf` or `load_factor`) and per-proposal `operating_expenses` (gross, nnn, base_year, expense_stop with growth), so mixed gross and NNN proposals compare like for like; landlord `downtime_months`; the discounting convention is stated in the steps; warnings when the usable-SF ranking differs and when terms differ by 12 months or more.
- `calc.cam_reconciliation@2`: `admin_fee` (rate, before or after the cap, capped or not, per-line `admin_fee_applies`) and `occupancy` (move-in and move-out prorate share, cap and base-year or stop deduction by days), with order-of-operations warnings for the fee.
- `calc.debt_sizing@3`: optional `stress` table (NOI, rate and value shocks; max loan, binding constraint, LTV, DSCR and debt yield per scenario) and `existing_loan_balance` refinance shortfall. Results without them are unchanged.
- `calc_rent_schedule` and `calc_net_effective_rent` warn when commencement is mid-month (months run from the commencement day, no calendar proration).
- Tool input: a field the tool does not define is now an input error naming the field and the nearest known name (`expenses.0.controlable: unknown field (did you mean "controllable"?)`) instead of being ignored, which silently changed answers. Rate fields above 1 and a `min_dscr` above 10 add a warning that the value looks like a whole-number percent, and a rate rejected as too big says rates are decimals. Date errors name the `YYYY-MM-DD` format.
- `calc.renew_vs_relocate` warns when `relocate.overlap_months` is set but `current_rent_monthly` is 0 or missing (double rent priced at $0); `calc.compare_proposals` warns when proposals commence on different dates; `calc.walt` states its day count (actual days ÷ 365.25) in the steps.
- `/v1/tools` lists registry tools only when a registry is loaded, like MCP `tools/list`, and the registry-unavailable message says how to get a registry instead of naming a server setting. Paid plan text says no hosted registry region is open yet.
- Registry owner-name normalization (`normalize_name`, and its TypeScript mirror `normalizeName`): apostrophes are dropped, what a roll appends to an owner (`ET AL`, a `DBA` trade name, a dangling `&` or `THE`) is removed, `NO 1` reads as `1`, consecutive initials run together, and common abbreviations spell one way (`PPTIES`/`PROPERTIES`, `CTR`/`CENTER`, `STREET`/`ST`). Registry files built before this change need `python -m factlot.registry.maintain registry.db --all` (re-keys the name index in place). `is_organization` reads a spaced `L P` as a partnership only with a number or a property or business word in the name, and a trust named for a person (separate property, revocable, life estate) as a person.
- Entity name search (`registry_search_entities`, `Registry.search_entities`) uses the name keys the file was built with: a file without `name_key_version` 2 in its `meta` table (such as `registry-sample-dc-2026-11-03`) is searched with the earlier keys until `maintain --all` re-keys it. New files record version 2.
- `Registry.ingest_parcels`: re-ingesting a snapshot now replaces the facts an earlier run wrote for it that the adapter no longer yields, and the links derived from a replaced owner; an unchanged file still writes nothing.

### Fixed

- `calc_walt`'s `weight_by` description named `area_sf` and `annual_rent`; it now names the accepted values `area` and `rent`, and the tool description states the day count.
- `calc.debt_sizing`: constraints that allow less than one rounding increment (for example `value: 1`) are an input error instead of a crash on an infinite debt yield.
- Hosted billing: a checkout paid by bank transfer (complete, payment still processing) now says the payment is processing and the page will show the key once it clears, instead of asking the customer to reload in a minute.
- Hosted billing: a key whose subscription Stripe does not know (for example a sandbox purchase re-checked with a live key) now stops working at its next check instead of staying active.
- The hosted OpenAPI documents advertised `http://` server URLs; they now advertise `https://api.factlot.com`.
- The registry parcel total on factlot.com and in `llms.txt` is 1,953,805, not 1,945,117: it had counted 37,292 Tarrant parcels where the full set is 45,976, and Travis gained 4 with supplement 3.
- Colorado entity adapter: the Department's appended status history (`, Delinquent January 1, 2025`) is no longer part of the legal name (1.87 million of 3.13 million names), so owners written as the bare name link.
- New York City adapter: an owner name wrapped across the two 40-character halves of the `OWNER` field is rejoined when the break fell inside a word.
- Mecklenburg adapter: `legalacres` holding square feet (139 parcels) and condominium-unit figures (21) no longer produce areas of billions of square feet.
- `Registry.link_owners` drops pending review candidates for a name that now links.

## [0.1.1] - 2026-11-03

### Added

- Hosted FactLot at `https://api.factlot.com` (`deploy/cloudflare`, a Cloudflare Worker running the unchanged `@factlot/server` handler): remote MCP at `/mcp`, REST and OpenAPI, free with no key at 60 requests a minute per address, and the factlot.com landing page with a pricing section. The MCP Registry entry now lists the remote endpoint.
- Paid hosted plans through Stripe Checkout: Pro ($49 a month, 600 requests a minute) and Team ($599 a month, 3,000 a minute). Keys are `fl_live_` bearer tokens stored only as hashes and shown once; `/v1/billing/checkout` (agents can start checkout and hand the link to their human), `/v1/billing/portal`, `/v1/billing/rotate`, `/v1/plans`, `/v1/account`, and an optional signed webhook.
- `registry-sample-dc-2026-11-03`: a downloadable SQLite registry of 18,077 District of Columbia commercial parcels, 5,513 owning entities and 7,908 cited ownership links (CC BY 4.0) for trying the `registry_*` tools.
- `Registry.purge_person_owners()`: removes owner names that the current person-detection rule reads as natural persons from a registry built under an earlier rule (with their mailing addresses, inferred links and review rows). Run once after upgrading past 0.1.0's tightened `is_organization`.
- Registry Tier 2 review: 61 more counties (the rest of the US top 100 by population), 28 verified with adapters and tests across 15 states, statewide parcel sources for Wisconsin, Utah, North Carolina, New York, Maryland and Massachusetts, the Connecticut entity registry, and a review record and collector config for every source ([index](docs/registry/tier2/README.md)).
- Registry statewide loads (2026-11-03): New York outside the city, Maryland, Wisconsin, Massachusetts outside Boston and 23 more Utah counties loaded in full into the scratch registry, 477,121 more commercial parcels in 177 counties (1,008,126 in 207 counties in all, 436,190 with an organisation owner of record); counts per county in each review record.

## [0.1.0] - 2026-11-03

The first release. Everything below is the work since the repository was created, summarised
from its commit history; nothing was published to npm or PyPI before it.

### Added

- `site/` gained schema.org JSON-LD, Open Graph and Twitter tags, a canonical link, a "For AI agents" section, a hosted-registry early-access call to action, and `site/llms.txt`; `llms.txt` now opens with what FactLot does, when to use it, and how to install it today.
- `site/`: the factlot.com landing page, a static page with no build step, no scripts, and no
  tracking, with deployment notes.
- Customer documents policy (`docs/customer-documents.md`), with controls in code: every ingest report carries a `retention` header (`retain_until`, default 30 days, `--retain-days`), `--redact` / `IngestResult.to_report(redact=True)` persists document text only as the quotes that are evidence, and the server's request log schema is fixed to metadata (`REQUEST_LOG_FIELDS`) with a test that no request body, tool argument, or bearer token reaches a log line.
- `calc.lease_remeasurement_asc842@1`: lessee remeasurement of a lease liability and
  right-of-use asset under ASC 842 (modification, lease-term or purchase-option reassessment,
  contingency resolution, residual value guarantee change; index changes warn that they are not
  a trigger on their own), with the ASC 842-20-35-4 asset adjustment and gain floor and a
  per-period table (operating: straight-line single lease cost; finance: interest plus
  amortization). Steps cite the ASC paragraphs; judgment points (partial termination, discount
  rate updates) are warnings.
- `calc.prepayment_and_defeasance@1`: prepayment premium, total payoff, and cost as a share of
  balance for a fixed-rate loan under yield maintenance (PV-of-payments or rate-differential
  basis, Treasury plus spread, minimum, and an explicit monthly or semiannual discounting
  convention), step-down, flat percentage, or defeasance (replacement securities cost from a flat
  yield or a stepped curve, plus stated costs). Both calculators ship in TypeScript and Python
  with shared vectors and differential-test generators.
- `@factlot/schema` (MIT): the fact data model with provenance and AI-use rights, exported as
  JSON Schema.
- `@factlot/id`: FactLot ID v0.1, deterministic identifiers for parcels, legal entities,
  documents, and spaces, plus minted building, lease, and loan IDs and short IDs.
- `@factlot/calc`: deterministic calculators with step-by-step audit trails and versioned
  formulas: rent schedule, net effective rent, proposal comparison, CAM reconciliation,
  percentage rent, debt sizing, WALT, NPV, and IRR.
- `@factlot/calc` and `factlot`: `calc.lease_vs_own@1` (NPV of leasing versus buying over a
  horizon with financing, residual by value or exit cap, optional after-tax treatment, year-by-year
  tables, and the break-even residual value), `calc.renew_vs_relocate@1` (NPV, discounted effective
  rent, break-even starting rent, and cash-flow tables for renewing in place versus moving, including
  TI net of allowance, moving, downtime, double rent, termination, and disruption costs), and
  `calc.hotel_metrics@1` (occupancy, ADR, RevPAR, TRevPAR, and a USALI-style ladder from departmental
  profit through GOP, management fees, EBITDA, FF&E reserve, and NOI), with conformance vectors and
  differential-test generators; `@factlot/calc` also exports `npvAt`.
- `@factlot/tools` (MIT): one tool catalog (calculators, IDs, fact validation) generating
  native tool definitions for the Claude Messages API, OpenAI Chat Completions and Responses,
  Gemini, Amazon Bedrock Converse, and OpenAPI 3.1 and 3.0; `runTool` returns input errors as
  data. Every input field carries a description, enforced by a test.
- `@factlot/mcp`: a local stdio MCP server over the whole catalog, with `search` and `fetch`
  over a built-in knowledge base and `schema_get`.
- `@factlot/server`: the remote connector, one stateless HTTP service serving Streamable HTTP
  MCP at `/mcp`, REST at `/v1`, and OpenAPI, with optional bearer auth, and a Docker image.
- A Claude Desktop extension build (`npm run build:mcpb`) that bundles the stdio server and
  generates its manifest from the catalog.
- Connector guides for Claude, ChatGPT and OpenAI, Gemini, Microsoft Copilot Studio, Amazon
  Bedrock (including an Agents action-group Lambda with tests), and OpenAI-compatible clients.
- `factlot` Python package: a dependency-free port of the calculators and IDs that loads the
  generated tool definitions and runs every tool, held to the same conformance vectors as the
  TypeScript packages.
- Language-neutral conformance vectors in `spec/vectors` and a TypeScript-versus-Python
  differential test over random inputs.
- Rules packs: versioned rules that cite their statutes and carry a verification status, with
  the first pack, `rules_tx_property_tax_protest_deadline`, verified against the official
  Texas Tax Code and Government Code text.
- The registry: a Python, SQLite-backed store of cited parcel and entity facts (content-addressed
  snapshots, commercial-only scope, no natural-person indexing, owner-to-entity linking,
  retirement of parcels dropped from a source's latest roll), six `registry_*` tools on every
  surface when a registry is configured, a data policy, and a Texas source catalog.
- A polite data collector (`factlot.collector`) that identifies itself, obeys `robots.txt`
  including `Crawl-delay`, rate-limits per host, reads JSON download listings, names archived
  files from `Content-Disposition`, and records every decision in a manifest; a weekly GitHub
  Actions workflow archives verified Texas sources as release assets.
- Adapters for the Harris CAD, Dallas CAD, and Tarrant AD appraisal rolls and the Texas
  Comptroller franchise-tax entity file, run on the real 2026 files (87,717, 59,645, and 37,292
  commercial parcels; 3.27 million registered entities; 73% of organisation owners linked by
  exact name).
- A lease-ingestion prototype (`factlot.ingest`) with deterministic verification of every
  extracted value against a verbatim quote on the cited page, a value-in-quote consistency check
  (numbers, ratios, dates, and party names must appear in the quote), a pluggable OCR step for
  scanned pages with a tesseract backend, and amendment supersession.
- Ingest predicates for percentage rent, co-tenancy, the renewal, termination and expansion
  notice deadlines, the rent commencement date, the operating-expense base year, parking, and
  the guaranty (name only; a value that reads as an address is refused), each with a value shape
  and the same consistency checks as the existing ones.
- An ingest review queue: a candidate whose quote is on the page but whose value is not written
  in it, or whose extractor confidence is below a threshold, waits for a named reviewer instead
  of being dropped or accepted (`review_queue`, `decide`; CLI `--review`, `--accept`,
  `--reject`, `--by`). The queue lives in the CLI's output file; an accepted item becomes an
  `extracted` fact whose provenance names the reviewer and the failed check, a rejected
  (predicate, quote) pair is never queued again, and re-running keeps every decision.
- The README states what FactLot covers today.
- Tier 1 expansion: 47 source reviews across 15 states and DC (`docs/registry/sources/`), one
  collector config per source under `registry/sources/<state>/`, 33 adapters (New York City,
  Los Angeles, San Francisco, Alameda, Riverside, Boston, Philadelphia, Cook County, Fulton,
  Maricopa, King, Hennepin, Mecklenburg, Denver, Wayne, Fairfax, DC, Florida DOR, Travis, Collin,
  and the New York, Colorado, Pennsylvania, DC, Florida, North Carolina, and Virginia entity
  registries), each with a synthetic-fixture test. Parcels keep the publisher's own use code
  (`parcel.local_use_code`). The weekly collector workflow covers every state, loads configs
  recursively, honours `Crawl-delay`, strips explicit default ports from redirect targets, and
  refuses to archive an export API's "pending" placeholder.
- Registry owner resolution beyond exact names: deterministic fuzzy candidates
  (`queue_fuzzy_owner_matches`), a review queue, and `decide_owner_match`; nothing is linked
  without a person's accept, and accepted links carry confidence at most 0.8 and the reviewer.
- `@factlot/server`: named API keys from an environment variable or a JSON file, per-key rate
  limits (429 with `Retry-After`), per-key per-tool usage metering with a jsonl record and an
  admin `GET /v1/usage`, and JSON request logging (`FACTLOT_API_KEYS`, `FACTLOT_API_KEYS_FILE`,
  `FACTLOT_RATE_LIMIT_PER_MINUTE`, `FACTLOT_ADMIN_KEY`, `FACTLOT_USAGE_LOG`, `FACTLOT_LOG`).
- A release process: one shared version, `scripts/release/`, this changelog, a tag-driven
  publish workflow for npm, PyPI, and the `.mcpb`, issue and pull-request templates, CODEOWNERS,
  Dependabot, a code of conduct, and a getting-started guide.
- FactLot Bench: fourteen CRE agent tasks with independently computed ground truth, a runner,
  and a scorer.
- Documentation for agents (`llms.txt`, `AGENTS.md`, `docs/agents.md`), the ID spec, the fact
  model, the registry, rules, and ingestion.

### Changed

- `calc.debt_sizing@2`: the maximum loan is rounded down after reducing it to 15 significant
  digits, so binary noise no longer costs a whole increment (a 57% LTV on $10,000,000 rounded
  to $1,000 returned $5,699,000 instead of $5,700,000). Both SDKs; `reduceNoise` /
  `reduce_noise` added to the core helpers.
- `calc.renew_vs_relocate@2`: warns when a break-even starting rent is negative (one case's
  one-time costs alone exceed the other's NPV), instead of reporting an unachievable rent
  silently.
- `calc.lease_vs_own@2`: warns when the loan exceeds purchase price plus closing costs (negative
  equity at closing).
- Tool descriptions state units, decimal-versus-percent, and periods for every field an agent
  could misread (NPV rate, one-time TI allowances, `current_rent_monthly`, the first escalation
  month, hotel `rooms_out_of_order` as off-market room-nights); Gemini definitions spell out
  exclusive bounds and defaults, which its schema subset drops.
- `calc.irr@2`: on long cash-flow series the NPV near -100% overflows or underflows to infinity
  or NaN, and `calc.irr@1` bracketed those values and reported spurious roots at -99.99%, -99%
  and -98% (with a "multiple IRRs" warning). Brackets with a non-finite end are now skipped. A
  series whose NPV is finite at every grid rate (for example up to 70 periods of flows below
  $10^12) gives the same result as before.

### Security

From the security review of 2026-11-03:

- Tool input limits in both SDKs: nesting depth 32, 200,000 values, 10,000 items per array,
  16 MiB per string, checked before schema validation; per-field caps in the input schemas
  (1,200 IRR cash flows, 10,000 NPV cash flows and WALT leases, 1,200 abated months, ASC 842
  payments, step-down rows and yield-curve points, 1,000 CAM expense lines, lengths on names,
  IDs and registry queries). They refuse only inputs far beyond real use; results within them
  are unchanged.
- Hosted server: per-IP rate limit on every route (`FACTLOT_RATE_LIMIT_PER_IP_PER_MINUTE`), a
  per-IP budget for rejected bearer tokens (`FACTLOT_AUTH_FAILURES_PER_IP_PER_MINUTE`, default
  30), `X-Forwarded-*` trusted only with `FACTLOT_TRUST_PROXY`, a validated Host for the OpenAPI
  `servers` URL, security headers and `Cache-Control: no-store`, 413 from `Content-Length`, MCP
  envelope and batch limits, request/header/keep-alive timeouts, 405 with `Allow`, error
  responses and logs without messages or stacks, and an admin key that must differ from every
  API key. Startup warns when no key is configured (the server is open).
- Collector: no requests to loopback, private, link-local (169.254.169.254) or other non-public
  addresses, including redirect targets and the connected peer; file names from URLs and
  `Content-Disposition` cannot leave the snapshot directory; downloads are capped at 2 GiB and
  pages at 32 MiB.
- Workflows: actions pinned to commit SHAs, explicit least-privilege tokens, no persisted
  checkout credentials, and the `collect.yml` dispatch input no longer interpolated into a shell.
- Docker: base image pinned by digest; documented to run `--read-only` with all capabilities
  dropped.
- Registry errors no longer include the database path.

### Fixed

- Registry privacy: a person's role or initials no longer make an owner name an organisation.
  "SMITH JOHN CO-TRUSTEE", "DOE JANE CO TRS", "GARCIA MARIA L P" and "JOHN SMITH DBA SMITH
  PROPERTIES" were stored with their mailing addresses; they are now treated as natural persons
  ("L.P." with a dot is still a partnership). Re-ingest existing registries to drop them.
- Registry owner linking: a reviewer's accepted match is the only owner link for that name, so
  an exact or standing match loaded later no longer gives the parcel a second owner. A negated
  entity status ("not_in_good_standing", "unregistered") no longer reads as live.
- Ingest review: a rejected candidate stays rejected when a re-run reports it with higher
  extractor confidence or a lower threshold (it had become a fact); two values for one
  (predicate, quote) can no longer both be accepted (the second accept placed nothing); a
  `lease.cam_cap` rate outside (0, 1] is refused like other ratios (5 for 5% passed).
- Ingest ordering and CLI: an undated amendment no longer jumps ahead of dated ones (amendments
  apply in the order given when any is undated); a malformed `--amendment file@date` stops the
  run before any model call; `--accept`/`--reject` on a redacted report keeps it redacted.
- Ingest redaction: a rejected candidate's value is dropped with its quote, since a value
  refused by the shape check can be what the check keeps out (a guarantor's address).
- Python IDs and fact validation now match TypeScript on unusual input: a trailing newline no
  longer passes `parse` or `validate_fact` (re's `$` matched before it), FIPS codes and floor
  numbers accept ASCII digits only, and suite whitespace follows ECMAScript (a leading
  byte-order mark is trimmed). TypeScript IDs are unchanged; new vectors in `spec/vectors`.
- Python raised `ZeroDivisionError` or `decimal.InvalidOperation` where TypeScript returned a
  value or a `CalcInputError`: NPV and IRR on long series, `round_` of values of 1e26 and above,
  and debt sizing with a 0% interest-only loan and a DSCR constraint. Python `run_tool` now
  rejects non-object arguments, and validates the WALT lease `id`, as TypeScript does.
- Python validates registry tool input before opening the registry, matching TypeScript (found
  by the shared vectors).
- When two Texas legal holidays fall on the same date, both SDKs keep the first name.
- Collector: skipped URLs are recorded in the manifest, and network failures are no longer
  reported as `robots.txt` refusals.
- Collector: a download that times out, stops short of its announced length, or loses the
  connection is retried (`retries`, default 2) with a `Range` request where the host honours
  one, and a plain request where it hangs up on `Range` (ArcGIS Hub); a partial file is never
  archived, and a short body on a sized response is no longer archived silently.
- NYC Department of Finance adapter: the published roll has a header row and a trailing tab on
  every line, which the adapter now drops (it read zero rows from the real FY27 file).
- Registry owner linking: an exact name match is linked only to an entity registered or formed
  in the parcel's state, or registered in the state of the owner's mailing address; an exact
  match that exists only in another state is queued for review (`exact_name_other_state`,
  score 0.8) instead of linked. `link_owners()` re-derives exact-match links on every run and
  reports `cross_state` and `queued_for_review` counts. With four state registries loaded,
  Minneapolis and Charlotte owners had been "resolved" to New York, Colorado, Pennsylvania and
  DC entities of the same name.
- Registry owner linking: when several same-name entities are plausible and all but one have
  ended (dissolved, revoked, merged, withdrawn), the one still in existence is linked at
  confidence 0.85 (`linked_by_standing`); an unknown status anywhere leaves the name ambiguous.

[Unreleased]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/9mp96ygnbk-alt/factlot/releases/tag/v0.1.0
