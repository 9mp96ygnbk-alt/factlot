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

### Fixed

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

[Unreleased]: https://github.com/9mp96ygnbk-alt/factlot/commits/main
