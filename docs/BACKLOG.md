# FactLot backlog: everything not finished yet

Last updated: 2026-11-02. Keep this file current: when an item is done, tick it and link the
commit. **Owner** is who has to act. "You" means a decision or an account only the founder can
provide. "Build" means engineering work anyone, including Claude, can do once any blocker is
cleared.

## A. Needs you: decisions, accounts, access

| #   | Item                                                                                                                                                                                                                                          | Why it matters                                                                                    | Blocks                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| A1  | **Create the `factlot` GitHub repository.** Then push from `backups/factlot.bundle` on the factlease branch.                                                                                                                                  | Until then all code exists only in the bundle; the weekly collector and CI can't run.             | A7, B1, B2, C17              |
| A2  | **Allow the data domains** in the development environment's network settings (list in [registry/texas-sources.md](registry/texas-sources.md)). Add `statutes.capitol.texas.gov`, `www.sec.gov`, `www.nyc.gov`, and `codelibrary.amlegal.com`. | Needed to read the real county files, statutes, and leases.                                       | B3–B7, B10–B13               |
| A3  | **Claude API key, and approval to spend.**                                                                                                                                                                                                    | FactLot Bench results and lease-ingestion accuracy need real model calls.                         | B12, C14                     |
| A4  | **Pick a host for the public connector** (Railway, Fly, Render, Cloud Run, or any Docker host), and point a domain at it, such as `mcp.factlot.com`.                                                                                          | Remote connectors (Claude, ChatGPT, Copilot) need a public HTTPS URL.                             | B14, C12                     |
| A5  | **Create the npm org `@factlot` and a PyPI account.**                                                                                                                                                                                         | Needed to publish packages, so `npx @factlot/mcp` and `pip install factlot` work.                 | C16                          |
| A6  | **Set up the contact mailbox** `contact@factlot.com`, or choose another address.                                                                                                                                                              | The collector's user agent and the data policy name it as the contact.                            | B1                           |
| A7  | **Privacy policy, terms of use, and a trademark filing for "FactLot".**                                                                                                                                                                       | Required by public GPTs and connector directories, and protects the brand in the open-core model. | C13                          |
| A8  | **Customer discovery: 54 interviews, 10 design partners** ([plan](customer-discovery.md)).                                                                                                                                                    | The product evidence so far comes from a _simulated_ survey.                                      | Pricing, priorities          |
| A9  | **Decide whether to send Public Information Act requests** ([template](registry/public-information-requests.md)).                                                                                                                             | The legal fallback for districts without bulk downloads.                                          | B3–B7 for some counties      |
| A10 | Optional: **set up Remote Control** in the Claude desktop app.                                                                                                                                                                                | Lets a session run the collector from your computer.                                              | —                            |
| A11 | **Legal review of the data policy.**                                                                                                                                                                                                          | Data on owners and companies carries privacy and liability risk.                                  | Going live with the registry |

## B. Blocked: ready to build once A-items clear

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                              | Blocked by        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| B1  | ~~First run of `.github/workflows/collect.yml`. Review the discovery reports.~~ Done 2026-11-02: run 41543215256 discovered 8 sources and archived 23 files (3.8 GB) from the six verified ones as release `data-tx-2026-11-02-41543215256`; the weekly schedule is live.                                                                                                                                                         | —                 |
| B2  | ~~For each source: confirm the file URLs, record the terms, license, and AI-use status in texas-sources.md, then set `verified: true` so weekly archiving starts.~~ Done 2026-11-02 (c1dbcae, collector changes in f1bb5eb): Harris, Dallas, Travis, Tarrant, Collin, and the Comptroller file are verified. Bexar has no bulk file; TxGIO's download host blocks automated clients.                                              | —                 |
| B3  | ~~**Harris CAD adapter** (file layout → `ParcelRecord`), tested on a real snapshot.~~ Done 2026-11-02 (4b7b3f9): on the real 2026 roll, 1,628,382 accounts read, 87,717 commercial parcels kept, 880,154 facts, 56,796 organisation owners, 42 s.                                                                                                                                                                                 | —                 |
| B4  | ~~**Dallas CAD adapter**~~ Done 2026-11-02 (1cda606): on the real 2026 certified export, 59,645 commercial parcels kept, 537,359 facts, 33,362 organisation owners, 40 s.                                                                                                                                                                                                                                                         | —                 |
| B5  | ~~**Comptroller franchise-tax entity adapter** (→ `EntityRecord`, owner linking)~~ Done 2026-11-02 (1cda606): on the real file, 3,514,637 rows, 3,272,073 registered entities, 242,564 skipped (no SOS number), 16.1 M facts, 19 min; owner linking matched 66,132 of 90,158 organisation owners in Harris and Dallas (73%), 224 ambiguous, 23,802 unmatched (→ C2).                                                              | —                 |
| B6  | Travis, Tarrant, Bexar, and Collin adapters. ~~**Tarrant AD adapter**~~ Done 2026-11-02: on the real 2026 certified commercial extract (`PropertyData(Delimited)_C.ZIP`), 37,292 commercial parcels kept, 378,800 facts, 28,049 organisation owners, 11 s; the full set adds the residential division's plain-`B` multifamily: 45,976 parcels, 462,148 facts, 30,747 organisation owners, 28 s. Travis, Bexar, and Collin remain. | A2 or B2          |
| B7  | TxGIO statewide parcels: geometry and parcel-ID crosswalk                                                                                                                                                                                                                                                                                                                                                                         | A2 or B2          |
| B8  | ~~Run the full multi-stage Docker build.~~ Done 2026-11-02: `docker build -t factlot .` succeeds on the committed Dockerfile (image 266 MB).                                                                                                                                                                                                                                                                                      | —                 |
| B9  | ~~Validate the collection workflow end to end. Its YAML parses, but it has never run.~~ Done 2026-11-02 with B1: discovery artifact, snapshots, and the release step all ran on GitHub's runners.                                                                                                                                                                                                                                 | —                 |
| B10 | ~~**Verify the Texas protest-deadline rule** against Tax Code §41.44 and §1.06 and Gov't Code §662.003. Then mark it `verified`.~~ Done 2026-11-02 (505c691): logic and holiday list match the official text, including §1.06 as amended effective 2026-01-01.                                                                                                                                                                    | —                 |
| B11 | **NYC LL97 rules pack.** Deferred because the constants can't be cited without the law text.                                                                                                                                                                                                                                                                                                                                      | A2                |
| B12 | **Lease-ingestion accuracy** on real leases (for example SEC EDGAR exhibits) with a hand-labelled gold set. Publish precision and recall per predicate.                                                                                                                                                                                                                                                                           | A2, A3            |
| B13 | Check the Gemini schema subset against the live Gemini function-calling docs, which couldn't be reached.                                                                                                                                                                                                                                                                                                                          | A2                |
| B14 | **Live connector tests** in each console: Claude custom connector, ChatGPT developer mode and deep research, Custom GPT Action, Copilot Studio, Gemini CLI, Le Chat, and a Bedrock Agents action group. Confirm the menu paths in the guides.                                                                                                                                                                                     | A4                |
| B15 | Verify the Bedrock Agents Lambda event format against the current AWS docs.                                                                                                                                                                                                                                                                                                                                                       | A2 or AWS account |

## C. Build next (no blocker)

**Registry**

- [ ] C1 Parcel lineage: record splits and merges as relationships, once real rolls show how each county reports them.
- [x] C2 ~~Owner matching beyond exact names: fuzzy candidates plus a human review queue. Inferred links stay labelled with confidence.~~ Done 2026-11-02: `queue_fuzzy_owner_matches()` (score = 0.7 × sequence ratio + 0.3 × distinctive-token overlap, threshold 0.85, top 5), `review_queue()`, `decide_owner_match()`; nothing links without an accept, accepted links carry confidence ≤ 0.8 and the reviewer's name. On the real Harris + Dallas registry: 15,888 unmatched owner names considered, 5,195 got candidates, 6,149 review rows queued in 20 min (the queue shows why review is needed: "10850 HARRY HINES LLC" scores 0.97 against "10815 HARRY HINES, LLC").
- [ ] C3 Beneficial ownership (managing members, registered agents). Texas SOS search is paid, so look for $0 routes such as Comptroller public information reports or records requests.
- [ ] C4 Debt and loan data (lender, maturity): scope v2, after ownership.
- [ ] C5 Change webhooks (ownership or value changed), and serving the built registry from `@factlot/server` (`FACTLOT_REGISTRY_DB`) in the hosted deployment.
- [ ] C6 Crosswalks to other identifiers (DOE UBID, city building IDs), then expand beyond Texas.

**Rules packs**

- [ ] C7 More packs: Texas unequal-appraisal (§42.26) median-ratio math, other §41.44 deadlines, BERDO and other building-performance standards, and zoning envelopes for the top metros.
- [ ] C8 A verification workflow: reviewer sign-off recorded in both SDKs and in CI.

**Ingestion**

- [x] C9 ~~A value–quote consistency check.~~ Done 2026-11-02 (425b3a1): numbers, ratios, dates, and party names in a value must appear in the quote; textual, not semantic.
- [ ] C10 ~~OCR for scanned PDFs~~ (done 2026-11-02, 425b3a1: pluggable backend, tesseract shipped, OCR'd pages flagged in provenance), more predicates (percentage rent, co-tenancy, exclusives, critical dates), and a human review queue for low-confidence facts.
- [ ] C11 Handling customer documents: private storage, no training on them, retention rules.

**Platform and connectors**

- [ ] C12 ~~Hosted server hardening: per-key rate limits, usage metering (the business model is usage-based), logging and observability~~ (done 2026-11-02: named API keys from env or file, per-key per-minute limits with 429 and `Retry-After`, per-key per-tool metering with a jsonl record and `GET /v1/usage`, JSON request logs; see `packages/server/README.md`), and OAuth 2.1 / SSO if directories require it. Rate-limit and usage state is per process; the jsonl file is the durable record.
- [ ] C13 Directory submissions: Anthropic connector directory, ChatGPT apps, the MCP registry, Copilot/AppSource.
- [ ] C14 Run FactLot Bench on current models and publish the results. Add tasks for the registry, rules, and ingestion.
- [ ] C15 Calculators still on the roadmap: ASC 842 remeasurement, lease-vs-own and renew-vs-relocate, prepayment and defeasance, hotel RevPAR, ADR, and GOP.
- [x] C16 ~~A release process: versioning, changelog, publishing to npm and PyPI, and signing the `.mcpb` (`mcpb sign`).~~ Done 2026-11-02 (34f9555): `scripts/release/`, `CHANGELOG.md`, `.github/workflows/release.yml`, [release-process.md](release-process.md). Publishing itself waits on the npm and PyPI accounts (A5).
- [ ] C17 Knowledge-base and documentation links point at `github.com/9mp96ygnbk-alt/factlot`. Update them if the repository lives elsewhere.
- [ ] C18 A landing page for factlot.com.

**Business**

- [ ] C19 A business plan and a bottom-up financial model (revenue drivers, costs, runway). This was offered but not yet written.
- [ ] C20 Market sizing from real firm counts, a competition deep dive, and validated pricing.

**The factlease repository**

- [ ] C21 Apply the four fixes from the original code review: typecheck tests, `erasableSyntaxOnly`, nested test glob, and CI. Or retire the STATE skeleton.
- [ ] C23 Owner linking across states. `link_owners()` links a parcel's owner of record to the
      one entity anywhere in the registry with the same normalized name. With four state
      registries loaded, parcels in states with no entity source still got links: Hennepin
      1,312 and Mecklenburg 1,535 owners "resolved" to entities
      registered in New York, Colorado, Pennsylvania or DC. Some are real (foreign-registered
      owners), most are coincidences of common names. Require the entity's state of formation (or
      a registration in the parcel's state) to match, or the owner's mailing-address state, before
      an `inferred` link; send the rest to the fuzzy review queue at lower confidence. Re-run the
      linking pass afterwards and update the catalog's link counts.
- [x] C22 ~~After FactLot is pushed to its own repository, delete `backups/` from the factlease branch.~~ Done 2026-11-02 (factlease e45b6ad): the bundle is gone and `docs/factlot-backlog.md` there points here.

## D. Known limitations (by design for now; revisit)

- **Calculators.** Rounding first reduces values to 15 significant digits, so amounts at or above
  about $10 trillion lose cents.
- **Registry.**
  - Person-versus-organisation detection is a conservative heuristic.
  - Automatic owner links require an exact normalized name match; near-matches wait in a review queue for a person.
  - A parcel that leaves commercial scope is retired only when the roll is ingested with
    `full_roll=True`.
- **Rules.** Holidays use their actual dates only: observed dates and Columbus Day are not
  treated as holidays, so deadlines can only come out early. Only the general §41.44(a)(1)
  deadline is covered.
- **Ingestion.** Verification is textual, not semantic (see C9).
- **Server.** MCP is stateless (no resumable streams), and there is a single shared bearer key.
- **Evidence.** The 165-agent survey was simulated; it is a source of hypotheses, not market data.

## E. Tier 1 gates (added 2026-11-02; needs you)

The Tier 1 expansion reviewed 47 sources; the per-source records are in
[registry/sources/README.md](registry/sources/README.md). These are the decisions and actions that
only the founder can take, grouped by kind:

- **Terms decisions** (the files are open; the website terms do not grant redistribution in so
  many words; the data are public records): Florida DOR rolls, Cook County, Philadelphia, Fulton,
  Wayne County, Fairfax, Alameda, Riverside, San Bernardino. Decide, or write to each publisher
  for a statement.
- **Forms and signatures:** Maricopa commercial-purpose statement (A.R.S. § 39-121.03, form
  FOR-025); King County RCW 42.56.070 acknowledgement; Virginia SCC consent banner.
- **Purchases:** Clark County ($300/month), North Carolina SOS ($750 + $2,000/year), Santa Clara,
  Orange, San Diego (ParcelQuest), and the Arizona, Georgia, Minnesota, Massachusetts, California,
  and Nevada entity registries. Several carry use-only or no-resale clauses that may rule out an
  open registry; settle the legal question before paying.
- **Records requests:** Bexar; Fairfax owner-of-record file (Virginia FOIA); Michigan entities.
- **Human reads of blocked pages:** Florida Sunbiz data-download terms (bot challenge), Illinois
  SOS bulk files (403 to non-browsers), DataSF terms page, Open Data DC terms page, Socrata and
  Esri Hub platform terms (A11).
- ~~**Full loads to run on a quiet connection:** New York City, Los Angeles, Hennepin, Mecklenburg,
  Denver, DC, and the New York, Colorado, Pennsylvania, and DC entity files.~~ Done 2026-11-03:
  every verified source is loaded in full (counts in the catalog). The three ArcGIS Hub exports
  came through the weekly workflow (`gh workflow run collect.yml -f only=<ids>`), which is the
  route to use for any file this connection cannot finish.
