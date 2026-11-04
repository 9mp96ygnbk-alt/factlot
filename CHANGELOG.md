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

### Added

- Claude Code plugin and marketplace (`/plugin marketplace add 9mp96ygnbk-alt/factlot`, then `/plugin install factlot@factlot`): eight CRE skills (loan sizing, lease economics, CAM reconciliation, ASC 842, lease vs own and renewals, investment returns, hotel metrics, Texas protest deadline) that call the hosted FactLot tools and cite formula IDs.
- `examples/` (curl, Python REST, MCP client, offline SDK, Claude API and OpenAI Responses remote MCP) and `npm run test:hosted`, a live end-to-end check of the hosted service: every conformance vector over REST, every MCP tool against REST, every site page and link, and the checkout paths.
- Registry Tier 2 expansion: statewide Vermont, Arkansas and Connecticut (CC0 layer) parcels, 24 Minnesota opt-in counties, Montana apartments and industrial parcels, five more North Carolina counties (Guilford, Forsyth, Cumberland, Johnston, New Hanover) and Garfield County, Utah: 228,453 more commercial parcels in 182 counties, with review records and adapters ([expansion notes](docs/registry/tier2/expansion.md)).
- Registry quality audit (`python -m factlot.registry.audit`): per source and snapshot, parcel and entity counts, field completeness, conflicting and implausible facts, person-like owner names (policy: zero), owner link rate by confidence and rule with the reasons the rest are unlinked, review queue, snapshot age and citation gaps; `--reread` runs each adapter on its archived file and compares counts. `python -m factlot.registry.maintain` re-applies the person rule, re-keys the name index and review queue, relinks and queues fuzzy candidates on a built file. The Tier 1 audit is in `docs/registry/quality/tier1-2026-11-03.md`.

### Changed

- Registry owner-name normalization (`normalize_name`, and its TypeScript mirror `normalizeName`): apostrophes are dropped, what a roll appends to an owner (`ET AL`, a `DBA` trade name, a dangling `&` or `THE`) is removed, `NO 1` reads as `1`, consecutive initials run together, and common abbreviations spell one way (`PPTIES`/`PROPERTIES`, `CTR`/`CENTER`, `STREET`/`ST`). Registry files built before this change need `python -m factlot.registry.maintain registry.db --all` (re-keys the name index in place). `is_organization` reads a spaced `L P` as a partnership only with a number or a property or business word in the name, and a trust named for a person (separate property, revocable, life estate) as a person.
- Entity name search (`registry_search_entities`, `Registry.search_entities`) uses the name keys the file was built with: a file without `name_key_version` 2 in its `meta` table (such as `registry-sample-dc-2026-11-03`) is searched with the earlier keys until `maintain --all` re-keys it. New files record version 2.
- `Registry.ingest_parcels`: re-ingesting a snapshot now replaces the facts an earlier run wrote for it that the adapter no longer yields, and the links derived from a replaced owner; an unchanged file still writes nothing.

### Fixed

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

- Launch kit under `docs/launch/`: zero-dollar go-to-market strategy, launch-day checklist, ready-to-post drafts, directory and awesome-list submission text, GitHub metadata suggestions, and an early-access reply template. `site/` gained schema.org JSON-LD, Open Graph and Twitter tags, a canonical link, a "For AI agents" section, a hosted-registry early-access call to action, and `site/llms.txt`; `llms.txt` now opens with what FactLot does, when to use it, and how to install it today.
- `site/`: the factlot.com landing page, a static page with no build step, no scripts, and no
  tracking, with deployment notes and a record of the checks run on it.
- Customer documents policy (`docs/customer-documents.md`) and hosted-ingest launch checklist, with controls in code: every ingest report carries a `retention` header (`retain_until`, default 30 days, `--retain-days`), `--redact` / `IngestResult.to_report(redact=True)` persists document text only as the quotes that are evidence, and the server's request log schema is fixed to metadata (`REQUEST_LOG_FIELDS`) with a test that no request body, tool argument, or bearer token reaches a log line.
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
- Business documents under `docs/business/`: a business plan, a bottom-up 36-month financial
  model (`model.md` with its monthly lines in `model.csv`, three scenarios), and a market-sizing
  study with cited firm counts, a competition deep dive, and a pricing comparison (backlog C19
  and C20).
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
- A simulated product-feedback round: the 165 survey personas reviewed v0.1 as built, and the
  README states what FactLot covers today.
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
  model, the registry, rules, ingestion, and the backlog.

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

From the pre-launch audit ([docs/security/audit-2026-11-03.md](docs/security/audit-2026-11-03.md)):

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

[Unreleased]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/9mp96ygnbk-alt/factlot/releases/tag/v0.1.0
