# FactLot v0.1: what the product does today (brief for the feedback round)

This brief describes **only what exists in the repository on 2026-11-02**. Reviewers must judge
this, not the roadmap. Anything not listed here does not exist yet.

## What you get

FactLot is an open-source "fact layer" for commercial real estate (CRE) AI agents. It ships as:

- an MCP server (`@factlot/mcp`) and a remote connector (`@factlot/server`: Streamable HTTP MCP at
  `/mcp`, REST at `/v1`, OpenAPI), with native tool definitions for Claude, OpenAI, Gemini,
  Copilot, Bedrock, and Mistral generated from one catalog;
- TypeScript packages and a dependency-free Python SDK that give identical results (checked by
  shared vectors and a random differential test);
- a Docker image for self-hosting.

**Not yet:** packages are not on npm or PyPI (you build from source); there is no hosted public
endpoint; there is no pricing in force (the plan is usage-based with a free tier, self-hosting is
free); no SOC 2; no OAuth (one shared bearer key on the hosted server); no web UI.

## The 22 tools

**Deterministic calculators** (every result returns `value`, `steps` with every intermediate
number and formula, `warnings`, and a versioned `formula` ID such as `calc.cam_reconciliation@1`):

| Tool                      | What it does                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `calc_rent_schedule`      | Base-rent schedule from commencement, term, area, starting $/SF/yr, escalations (percent or fixed), abated months. Steps, totals, expiration.   |
| `calc_net_effective_rent` | Effective, straight-line, and discounted net effective rent after free rent, TI, commissions, other concessions.                                |
| `calc_compare_proposals`  | Ranks 2–20 proposals on one discounted $/SF/yr basis, tenant perspective (occupancy cost incl. NNN/base-year expenses) or landlord perspective. |
| `calc_percentage_rent`    | Overage rent over a natural or fixed breakpoint, exclusions, partial years, amounts paid.                                                       |
| `calc_cam_reconciliation` | Annual CAM: exclusions, gross-up, pro rata share, controllable caps (three methods), base year or expense stop, estimates paid → balance due.   |
| `calc_debt_sizing`        | Max loan under LTV / DSCR / debt-yield constraints; reports the binding constraint and debt service.                                            |
| `calc_walt`               | Weighted average lease term by area or rent as of a date.                                                                                       |
| `calc_npv`, `calc_irr`    | Periodic NPV; IRR with every root reported when there are several.                                                                              |

Rounding is deterministic (15 significant digits, half away from zero). Amounts of about
$10 trillion and above lose cents. These are the only calculators: there is **no** ASC 842 /
lease accounting, no lease-vs-own or renew-vs-relocate, no prepayment/defeasance, no hotel
KPIs, no DCF/argus-style pro forma, no sales-comp adjustment grid, no construction budgeting.

**Rules pack** (jurisdiction law as cited, versioned code):

| Tool                                     | What it does                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules_tx_property_tax_protest_deadline` | Texas protest deadline: later of May 15 or 30 days after notice, rolled past weekends and Texas legal holidays, plus a conservative file-by date. **Verified** against Tax Code §41.44, §1.06 and Gov't Code §662.003 on 2026-11-02. Covers only the general §41.44(a)(1) deadline. |

No other rules exist (no NYC LL97, no zoning, no other states, no unequal-appraisal math).

**FactLot IDs** (deterministic, computed offline, never change):

| Tool          | What it does                                                          |
| ------------- | --------------------------------------------------------------------- |
| `id_parcel`   | `fl:parcel:us-<state+county FIPS>:<normalized APN>` for any US parcel |
| `id_entity`   | `fl:entity:<jurisdiction>:<registry file number>` or from an LEI      |
| `id_space`    | Suite/unit ID inside a building URN                                   |
| `id_document` | SHA-256 content-addressed document ID                                 |
| `id_parse`    | Validate and decompose a URN                                          |

`fact_validate` checks a fact against the model: subject ID, dotted predicate, as-of date,
provenance with citations (document, page, clause, quote), rights (AI use, redistribution).

**Registry tools** (only when a registry database is configured; the agent otherwise gets
`RegistryUnavailable`): `registry_get`, `registry_resolve_parcel`, `registry_resolve_external`,
`registry_search_address`, `registry_search_entities`, `registry_owned_by`.

## The registry: what data is actually in it

Built from public records with a polite, identified collector (robots.txt, rate limits, hash-verified
weekly archives on GitHub releases). Every fact cites the source file (SHA-256), the record, the
as-of date, and the source's license / AI-use / redistribution status.

Loaded on 2026-11-02 (real data, from the publishers' own bulk files):

- **Harris County, TX (Houston):** 87,717 commercial parcels (68,795 F1 commercial, 2,466 F2
  industrial, 16,456 B multifamily) from the 2026 certified roll: situs, state category, land and
  building area, year built, market and appraised value, owner of record and mailing address for
  56,796 organisation-owned parcels.
- **Dallas County, TX:** 59,645 commercial parcels from the 2026 certified export, same fields
  (market value only; no separate appraised value).
- **Texas legal entities:** the Comptroller's active franchise-taxpayer list (legal name, SOS
  file number, taxpayer number, mailing address, status), used to link an owner-of-record name
  to a registered entity. A link is made only on an exact normalized-name match to exactly one
  entity, labelled `inferred` with confidence 0.9.

**Scope and privacy rules:** commercial categories only (B, F1, F2 and district subclasses); no
single-family; owner names of natural persons are never stored or searchable; owners withheld
under Tax Code §25.025 stay withheld; no sale prices (Texas is non-disclosure); nothing is
inferred about people.

**Not in the registry:** any county outside Harris and Dallas (Travis, Tarrant, Collin files are
archived but not yet parsed; Bexar publishes no bulk file); parcel geometry (TxGIO blocks
automated downloads); debt, loans, lenders, maturities; tenants, rent rolls, lease comps, sales
comps, listings; building specs beyond area and year built; permits, zoning; anything outside
Texas; history (the archive started 2026-11-02, so there is one snapshot per source so far);
change webhooks; fuzzy owner matching (exact normalized names only).

## Lease ingestion (prototype)

`python -m factlot.ingest` turns a lease PDF and amendments into cited facts: a model (you
bring your own Claude credentials) proposes `{predicate, value, verbatim quote, page}` candidates;
deterministic code **rejects any quote not found on the cited page**, type-checks values, and
applies amendment supersession with history kept. Predicates cover the basics (parties, premises,
term dates, rent steps, pro rata share, CAM caps, renewal options). **No accuracy number exists**:
it has only been run on a synthetic lease. No OCR for scanned PDFs. No value-vs-quote semantic
check (a quote can exist while the value misreads it). No rent rolls, estoppels, OMs, T-12s, or
loan documents.

## Connectors and deployment

Claude (custom connector, Desktop `.mcpb`, Claude Code, API), ChatGPT (developer-mode app, Custom
GPT Action, Responses API remote MCP, function calling), Gemini, Copilot Studio, Bedrock
(Converse and Agents Lambda), OpenAI-compatible providers. All documented; **none has been tested
live in the vendor consoles yet.** Self-host with Docker; the hosted server has a single shared
bearer key, no per-key rate limits or usage metering, no OAuth.

## Evidence that it works

- 67 TypeScript tests, 51 Python tests, shared conformance vectors with expected values computed
  independently of the code, and a 2,000-case TypeScript/Python differential run with 0
  mismatches.
- FactLot Bench: 14 CRE tasks with independent ground truth, runnable with and without the tools.
  **It has not been run on any model yet** (needs an API key), so there is no published number
  showing the tools improve agent accuracy.
- The Harris and Dallas registry loads above are real.

## Licensing

Apache-2.0 for the platform code, MIT for schemas, SDK definitions, and tools. Self-hosting is
free. Registry data carries each publisher's terms: Texas appraisal rolls and the Comptroller
file are public records; one publisher (Tarrant) signals no AI training in robots.txt. No
customer document is ever used for training; the ingestion pipeline runs where you run it.
