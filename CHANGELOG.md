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

- Public property pages on factlot.com, off unless the Worker variable `PROPERTY_PAGES_ENABLED` is `true`: `/property/<county region>/<parcel id>` for each hosted parcel whose sources record `redistribution` as `permitted` or `attribution_required` (or are listed in `PROPERTY_PAGES_EXTRA_SOURCES`), showing the free view of `registry_get` with every citation, and sitemaps under `/sitemaps/properties.xml`; withheld counties get no page, and page views use no registry lookups.
- Hosted API: opt-in usage counters (`USAGE_COUNTERS_ENABLED`, off unless `"true"`) count requests by surface and path group, registry lookups by tool and region prefix, distinct callers by tier (hashed, as sketches), quota and plan refusals, checkout starts and completions, reports and model-tool calls, and `npm run ops:usage` prints yesterday and the last seven days.
- Texas registry: `tx_travis --history-only <year>` reads Travis CAD's EARS submissions (Comptroller form 96-1051, tax years 2022 to 2025) as market value history only, by the county's `AJR` records with an account's categories added up. Values are the roll as submitted; EARS carries no appraised value.
- Hosted registry, ready for regions beyond Texas: a county whose parcels come only from a source covering part of it (Boston in Suffolk County) is recorded in the pack, and its misses and `registry_coverage` say which part is loaded. Entity registries other than Texas's are served in part the same way (the entities that own a hosted parcel).
- Pack builder: `--jobs <n>` packs each registry file in its own process and gives the same pack; a pack that would exceed the Workers static-assets file limit stops while building.
- Pack builder: `--parts-cache <dir>` reuses the regions whose registry file, options and pack code are unchanged since an earlier build (checked by a stamp and the cached files' hashes) and gives the same pack; `--seed-parts-cache` fills the cache from a finished parallel build.
- `site/_data/hosted.json`, written by `scripts/site/gen-hosted.ts` from the hosted pack's manifest, holds what the hosted registry serves; the home, coverage and MCP pages, README, docs and llms.txt state it between markers that the script rewrites, and the site tests fail when they differ.
- Texas registry: Harris and Dallas now carry value history for tax years 2022 to 2025 beside the 2026 roll (market and appraised value for Harris, market value for Dallas), loaded from each district's certified prior-year exports as value history only: no owner, address or coverage rows, so the current record is unchanged. County pages count these roll years.
- Hosted plan copy and messages now describe paid gating: the pricing page lists Pro monthly and yearly with checkout links and a Free, Pro and Team comparison; the history note and the `registry_get` and `registry_tx_equity_candidates_batch` tool descriptions say what a free call leaves out; quota and plan messages link `https://factlot.com/pricing/`.
- Texas registry: sixteen hosted counties. Cameron, Nueces, Galveston, Jefferson, Brazos, Midland, Ector, Grayson, Guadalupe and Kaufman join Harris, Dallas, Travis, Collin, Denton and Williamson on the hosted registry (305,684 Texas commercial parcels; 434,538 parcels in 43 counties with Maryland, DC and Utah; 88,176 Comptroller entities). Brazos holds roll years 2016 to 2026, Nueces 2021 to 2026, Galveston 2023 to 2026, Kaufman 2024 to 2026, Jefferson and Guadalupe 2025 to 2026. Midland has no values because its publisher's file has none. Tarrant County is still not served. The factlot.com Texas hub, county pages, README, llms.txt and coverage docs state the new figures.
- Texas proof pages on factlot.com: `/texas/<county>/` for the six hosted counties (hosted parcels, roll year and as-of date, source and recorded terms, what the tools answer there), worked examples at `/texas/harris/example/` and `/texas/dallas/example/` (cited parcel facts, the first ten default-rule candidates, and the `calc_tx_unequal_appraisal` input an agent would pass after review, with no computed result for a real property), a status table of other Texas districts on the hub, and a "What you would otherwise use" comparison on the pricing page. Figures come from `site/_data/texas-counties.json` and `texas-examples.json`, written by `scripts/site/gen-texas-counties.ts` and `gen-texas-examples.ts` from a built registry file.
- Paid gating on the hosted API, behind the `GATING_ENABLED` Worker variable (now set to `true` in `deploy/cloudflare/wrangler.jsonc`; nothing changes while it is unset or not exactly `true`). When on: keyless and free-OAuth `registry_get` answers keep only the current roll year in `value_history` and `history` and add `history_available` and `history_note`; registry batch tools (`registry_tx_equity_candidates_batch`) answer `PlanRequired` for free callers and are not metered; Pro can be billed yearly ($490 a year, Stripe price lookup key `factlot_pro_yearly_v1`, same limits as monthly Pro) through `/billing/checkout?plan=pro&interval=year`; `/v1/plans` lists the gating rules and the yearly price. Equity candidates stay available within the free daily lookups.
- On the hosted API with gating on, a free caller's registry_get (and the subject of `registry_tx_equity_candidates`) now says what was left out only when something was: `history_withheld` lists the earlier tax years removed from `value_history` (newest first) and their count, and a count of earlier `include_history` facts, never a value, citation or date; `history_note` states the same in words; `history_available: "pro"` appears with them. A parcel with a single roll year gets none of the three (before, every answer carried the same note). The `/try/` page shows the note with a link to the plans. The `registry_get` `as_of` description now says a dated lookup needs a Pro or Team key on the hosted API.
- On the hosted API with gating on, a free caller's `registry_owned_by` (REST and MCP) keeps the first three parcels of the owner's portfolio in the registry's order, and `buildings` lists only the buildings of those parcels. When parcels were removed, the answer adds `portfolio_withheld` (`count` left out and the portfolio's `total`; never a URN, label or building) and a one-sentence `portfolio_note`; a portfolio of three parcels or fewer is unchanged. Pro and Team keys get every parcel. `/v1/plans` lists the rule as `gating.free_portfolio`.
- Free API key by email on the hosted API, off unless the Worker variable `FREE_KEY_ENABLED` is exactly `true` (unset in `wrangler.jsonc`; off, the endpoints answer 404 and `/account` shows no form). `POST /v1/keys/free` (`{email, accept_terms: true}`, always answers 202 `{sent_if_valid: true}`) or the form on `/account` emails one single-use link (30 minutes; opening it only shows a confirm page, the button redeems it) that shows a `fl_free_...` key once. One active free key per address (a new one revokes the old); only a salted hash of the address and a hash of the key are stored, never the address. A free key is a free caller: it has the free limits (60 requests a minute, 25 registry lookups a day, 3 reports a month) counted per key instead of per IP address, with paid gating's free rules (current roll year only, no batch tools, no `as_of`), the `anonymous` tier in `x-factlot-tier`, and no account, billing, model or paid tools. The free keys used from one IP address together share 100 lookups a day and its minute limit, and an address mints at most 3 keys a day. `/v1/plans` lists the option under `plans.free.free_key` when on; the pricing, Try and MCP pages show a link to it only then; the privacy notice and terms describe what is stored.
- Free key deletion (same `FREE_KEY_ENABLED` switch): `POST /v1/keys/free/delete` or the form on `/account` emails a single-use 30-minute link (sent only if the address has a key; the answer is the same for every address), and its confirm button deletes the key, every key it replaced, the address record and the report and key counters; `DELETE /v1/keys/free` with the key as bearer does the same without email.
- `rules_tx_property_tax_protest_deadline` (still `rules.tx.property_tax_protest_deadline@2`; every
  earlier field keeps its value): optional input `as_of` (default: the current date in US Central
  time), and in the result `as_of` (the date used), `status` (`open`, `passed` or `not_yet_open`),
  `days_remaining` (`null` once passed), `next_season` (`{tax_year, deadline,
conservative_file_by, basis}` for the next tax year when the deadline has passed, else `null`)
  and `notes` (what the rule does not cover, with the sections: §41.44(b)-(c-3) and §25.25). The
  warning that a notice delivered after April 15 moves the deadline now appears only while the
  deadline is open or not yet open.
- `calc_tx_unequal_appraisal` (still `calc.tx_unequal_appraisal@1`; no number changes): optional
  `label` (up to 80 characters) and `address` (up to 120) on the subject and each comparable,
  echoed as `subject_label`, `subject_address` and each comparable row's `label` and `address`;
  each comparable row adds `flags` (`{code, message}`: `value_psf_above_2x`,
  `value_psf_below_half`, `land_ratio_above_2x`, `land_ratio_below_half`, `missing_area`), facts
  about the inputs that never drop a comparable. Two new warnings: no adjustments at all (the
  median is unadjusted; quotes "appropriately adjusted" from §41.43(b)(3) and §42.26(a)(3)), and,
  with `normalize_by` `none`, a comparable area more than 25% from the subject's. The report
  validator accepts results with and without the new fields.
- `registry_tx_equity_candidates` and each answered subject of its batch: `calc_args`
  (`{tax_year, subject, comparables}` with exactly `calc_tx_unequal_appraisal`'s fields: `id` the
  FactLot URN, `label` the situs address, nulls left out, no adjustments; `null` when the subject
  has no value or roll year) and `selection_rule` (tax year, category, area and year bands with
  bounds, `min_matches`, `limit`, counts per tier, and a `notice` that the list is the default
  rule's output for the caller to review, not a selection by FactLot). The hosted API builds both
  from the registry service's answer when the service does not send them, so no registry
  redeploy is needed. Tool descriptions give the order: candidates, review,
  `calc_tx_unequal_appraisal` with `calc_args`, `report_create`.
- `rules_tx_property_tax_protest_deadline_batch` (still `@1`): optional `as_of` for every item;
  each item adds `status`, `days_remaining` and `next_season`; the result adds `as_of`, `notes`
  and `summary.by_status`.
- Reports: every `/v1/reports` and `report_create` answer has `billed` (`true` when the request
  counted against the month).
- Reports: new kind `tx_protest_deadline` (`ics` or `pdf`), built from FactLot's run of
  `rules_tx_property_tax_protest_deadline` on `tax_year`, `notice_delivered_date` and `as_of`, or
  of its `_batch` when `arguments` has `items` (one calendar for a portfolio, each event labelled
  by the item's `id`). Each notice gets two all-day events, the statutory deadline and the
  conservative file-by date, with the basis, the rule's statute text and verification, the status
  and days remaining, every warning and note, both Texas disclaimer sentences and the chapter 1152
  sentence in the description; reminders 30 and 7 days before the file-by date, and one an hour
  after generation when it is under 30 days away. A passed tax year gives the rule's
  `next_season` dates, with the passed year said in each description (`include_past: true` keeps
  the passed dates too). UIDs are stable per notice, tax year and event. Without `as_of` the
  status is measured from the generation day in US Central time. A batch item the rule cannot
  answer is a 400 `ArgumentsError` naming it; item ids go through the caller-text filter, which
  now passes the negated disclaimer ("not an appraisal or an opinion of value").
- Reports, Texas packet: a "Sources and rights" block (PDF after the grid; workbook on the
  Provenance sheet) lists each source document the citations name with its as-of date, URL and
  the publisher's rights word for word, from the new optional `context.sources` (the `sources` of
  `registry_tx_equity_candidates` as returned). Unknown rights read "rights not stated by the
  publisher: relay to the recipient"; comparables without a citation are named and kept.
- Site: a `/pricing/` page (the plan table, what counts as a registry lookup, cancelling and
  refunds, checkout links) and a `/texas/` page (the six hosted counties with parcel counts, the
  Texas tools, how to connect). A test checks the pricing numbers against `plans.ts`.
- Hosted API: a browser that opens `GET /mcp` (an `accept` header with `text/html`) gets a short
  page pointing to the connector steps; every other GET keeps the JSON-RPC 405. `HEAD /health`
  answers 200.

### Changed

- Hosted API, paid gating: `registry_tx_equity_candidates` with `tax_year` now needs a Pro or Team key (`PlanRequired`, not metered). Naming an earlier roll year returned that year's values for the subject and every candidate, in the counties that hold a full roll per year, which is value history. Without `tax_year` the tool is unchanged and uses the newest roll year with values. `/v1/plans` lists the rule as `gating.candidates_tax_year`.
- Registry address search (`registry_search_address`, SDK, Python and hosted): a query that finds nothing is searched once more with the ordinal endings of its street numbers dropped, so "136 W 42nd St" finds a parcel a roll writes as "136 WEST 42 STREET" (New York City, Travis County). A match as written still wins; the first word of the query is left as it is.
- Hosted API, paid gating: `registry_get` with `as_of` (the record as it stood on an earlier date) is value history, so a call without a Pro or Team key now answers `PlanRequired` and is not metered; before, a free caller could read earlier roll years one date at a time. The same call without `as_of` is unchanged. `/v1/plans` lists the rule as `gating.dated_get`.
- Hosted API: **reports are open.** `report_create` is listed over MCP, `POST /v1/reports` builds
  the document, and `/v1/plans` shows `reports.available: true` with the monthly allowance (3 free
  per IP address, 50 on Pro, 1,000 on Team). The 0.5.0 notes below describe the state at release,
  when reports were deployed but closed.
- Public copy: the terms, privacy notice, security page and docs now say that a report file is
  kept for 24 hours (then deleted) and that two tools, `doc_extract_lease` and `report_narrative`,
  send what you submit to a model provider; reports are listed in the tool lists, plans, setup
  guide and Texas protest-kit docs.
- Site: the home page's registry figures are the hosted ones (349,869 commercial parcels, 33
  counties, 6 Texas counties); the self-hosting totals are a separate, labelled line. The top nav
  has Texas and Pricing (`/pricing/`); `/#pricing` still works. The status and assurance pages
  cite the live suite's run of 8 November 2026 (4,635 checks passed, 0 failed).

### Fixed

- Hosted API: HEAD (and any method but GET) on the one-time claim URL `/v1/billing/claim/<token>` and on `/billing/success` now answers 405 and no longer redeems the checkout session, so a link prefetcher or probe cannot burn the key.
- Hosted API: an `Authorization` header that is present but not `Bearer <token>` (a `Token` scheme, a bare key, `Bearer` alone) now answers 401 with `WWW-Authenticate: Bearer` instead of silently serving the free tier. It does not count against the rejected-key limit. `/mcp` keeps its OAuth handling and public pages ignore the header.
- `doc_extract_lease`: PDFs are limited to 5 MB (was 10 MB; MCP requests with a PDF to 8 MB, was 15 MB) and page reading stops with 422 `PdfTooSlow` after 20 seconds, checked between pages. pdf.js offers no cap on decompressed stream size; page and character caps still apply.
- Hosted API: a paid checkout session older than a year can no longer be redeemed for a second key (the already-shown claim now outlives the 365-day KV marker, and sessions older than the marker answer 410).
- Documented that Workers Logs cannot redact URL paths, so tokens in `/account/recover/`, `/v1/billing/claim/`, `/authorize/email/` and report download paths are logged (note in `wrangler.jsonc`).

- Hosted API: free OAuth connections (header-less clients that sign in on the free tier) started
  from one address now share that address's daily registry lookups and monthly reports, instead
  of each connection bringing its own; free connections made before this change sign in again
  once. Keyless calls keep their own per-address allowance.
- Hosted API: an MCP batch in which two requests share an id is refused with -32600 before
  anything is metered (answers are matched to calls by id).
- Texas source configs for 13 appraisal districts are formatted like the rest of the repository
  (CI's format check failed on them).
- Registry privacy: an owner of record that is a surname with two initials and a business word
  ("SMITH J R PROPERTIES") is read as a person, and more given names are recognised in trade names.
  An organisation whose name reads as a person's or a family's ("JOHN SMITH LLC", "SMITH FAMILY
  LP") keeps its name, but its mailing address (owner or entity) is no longer stored or served,
  since it is most often a home; `maintain --purge-persons` removes such addresses from existing
  files, and `audit` reports any left as a violation.
- Hosted registry packs: every county the hosted registry withholds (Tarrant, 48439) is excluded
  from every pack whether or not `--exclude-county` is given; `deploy:registry` refuses a pack
  that serves one or does not record it as withheld; the registry Worker answers nothing of one.
  The file limit is 100,000 (Workers Paid). `pack.ts` runs the new privacy scan
  (`python -m factlot.registry.privacy_scan`) on every file and refuses one with a person owner or
  a personal-style mailing address, and takes `--suppress <file>`: a private removal list of
  subjects and owner names that are not served (`check_pack.ts` takes the same flag).
- Reports, `critical_dates` calendar: a notice deadline that `business_day_roll` moves to a later
  business day is now dated on its contractual date (the later date is described, not
  scheduled), each event carries the tool's warnings about its dates, and a deadline under 30
  days away gets a reminder an hour after generation as well as the 30-day one.
- Reports, caller text: the advice filter matches whole advice phrases ("you should", "is worth",
  "worth $", "appraised at $…", "protest your", "savings of"…) instead of word stems, so names
  such as Worthington Plaza, First Savings Bank or Protestant Church and terms such as appraisal
  notice, protest packet or tax protest are no longer refused. The error names the phrase.
- Reports, Texas workbook: the Grid notice no longer makes Excel autofit row 2 to 256 pt (it is a
  merged row of set height; only the header row and comparable column are frozen), and the
  caller's title and prepared-for line are printed on ReadMe and Grid.
- Reports, PDF: a table with more than 10 columns (the debt-sizing stress table) is laid out on
  landscape pages, and columns are sized so a number is never broken across lines.
- Reports, numbers: one convention in every PDF and workbook (money to the cent with the sign
  first, percentages to two decimals, ratios to two, audit-trail values to 6 significant digits
  with a note); years and counts are no longer printed as "2,026".
- Reports, PDF layout: columns are sized to their longest number or word, long identifiers break
  only at separators, statute URLs are links, and a heading is never left alone at a page foot.
- Reports, Texas: the workbook adds adjusted $/SF and the $/SF adjustment total, the PDF the
  normalizing area and each comparable's area; optional `label` and `address` print beside ids;
  the statutes column is "Source (URL)"; the §41.66(l) description follows the statute and
  §42.26(d) says which text a report of its tax year is printed against; the disclaimer appears
  on the cover and in each footer (no longer three times); an empty warnings list says "none".
- Reports, CAM: the statement lists the pro rata share, gross-up occupancies and factor, cap
  method and rate, and admin fee rate. Proposals: "first-ranked" replaces "best" in the audit
  trail; commissions and downtime are listed with the terms. Lease abstract: dates are date cells,
  money terms say USD, the ReadMe names only sheets that exist, the provenance says the values
  were supplied (not computed), and `source` is `doc_abstract_lease` (no package version).
- Reports, calendar: shorter event titles, no one-day duplicate of a renewal window, and dates
  before today left out unless `include_past` is sent.
- Reports, workbooks: the DCF CashFlows subtotals are live formulas, with each year's NOI and cash
  flow tied out on Checks, and the CAM statement's charge is checked by a live formula; the docs
  now say which kinds carry live formulas and which are value workbooks with live checks. In the
  PDF a long list in Inputs is one row with its count (all values stay in the workbook).
- Reports, filenames cut at word boundaries and drop a trailing year the date repeats.
- Reports, errors: a missing field says "missing", non-object arguments are reported at
  `arguments`, `next` points to the request shape and the tool's schema (and lists the formats
  for a wrong `format`), and refusals carry the report-quota headers.

## [0.5.0] - 2026-11-07

This release brings Texas to the hosted registry, paid Pro and Team plans with metered registry
lookups, sign-in from Claude and ChatGPT without a key header, two model-backed tools for Pro and
Team, and batch tools for Texas protest work. The hosted registry serves Maryland, the District of
Columbia, Juab and Summit counties in Utah, and Harris, Dallas, Travis, Collin, Denton and
Williamson counties in Texas: 349,869 commercial parcels in 33 counties. **Tarrant County is not
served** while the publisher's terms for AI use are unclear. **Hosted reports are deployed but not
yet open:** until they open, `report_create` is not listed and `POST /v1/reports` answers 503
`ReportsUnavailable`.

No calculator's numbers change. Two changes need action from some users: the Texas deadline rule
renames `recommended_file_by` to `conservative_file_by`, and a registry file built with an earlier
release should be run through `python -m factlot.registry.maintain <db> --purge-persons` (see
**Changed**).

### Added

**Hosted registry and Texas**

- Hosted registry lookups on api.factlot.com, on every plan: Maryland, DC and two Utah counties
  (128,854 parcels), and six Texas counties (Harris, Dallas, Travis, Collin, Denton and Williamson;
  221,015 parcels) with value history by tax year and `registry_tx_equity_candidates` with its batch
  form. Texas entity lookups cover the 68,804 Comptroller entities that own a hosted parcel. Tarrant
  County (48439) is not served: none of its parcels, links or IDs are hosted, and
  `registry_coverage` and lookups in the county say why. `registry_coverage` on the hosted API adds
  `hosted` (withheld counties, and entity registries served in part). Hosted equity candidates are
  computed with the SDK's rule, so the hosted answer equals the SDK's for every parameter value.
- `registry_tx_equity_candidates_batch` (`POST /v1/registry/tx_equity_candidates/batch`):
  `registry_tx_equity_candidates` for 1–50 subjects in one call, each with your `id` and its `urn`,
  or `county_fips` and `apn`, and the rule parameters once. Each entry of `results` is that
  subject's answer or its own error (Texas-only and Tarrant checks per subject; a miss carries
  `coverage`); the selection rule and the notice are given once. Candidates per subject only: it
  never runs `calc_tx_unequal_appraisal` or picks comparables. On the hosted API each answered
  subject counts as one registry lookup.
- `rules_tx_property_tax_protest_deadline_batch` (`POST /v1/rules/tx_property_tax_protest_deadline/batch`):
  Texas protest deadlines for 1–200 notices in one call. Each item (`id`, `tax_year`, optional
  `notice_delivered_date`) is answered under `rules.tx.property_tax_protest_deadline@2` exactly as
  the single tool answers it, echoed with its `id`; an item with invalid input carries its own
  `error` and the others are still answered. `summary` counts items per deadline with the earliest
  and latest; the rule, citations and disclaimer appear once. A rules tool, never a registry lookup.
  Formula `rules.tx.property_tax_protest_deadline_batch@1`; shared vectors in
  `spec/vectors/rules/tx_property_tax_protest_deadline_batch.json`.
- `@factlot/tools`: the Texas candidate rule as pure functions (`selectEquityCandidates`,
  `equityReturned`, `assembleTxEquity` and the year, roll, shaping and tier helpers);
  `registryTxEquityCandidates` uses them and its output is unchanged. `hostedWithheldCounties()`
  (TypeScript) and `HOSTED_WITHHELD_COUNTIES` / `hosted_withheld_counties()` in
  `factlot.registry.tx_equity` (Python) list the counties a hosted FactLot service does not serve,
  by 5-digit county FIPS with the reason. Self-hosted use is unchanged;
  `registry_tx_equity_candidates` keeps its Tarrant error.
- Registry pack builder: `--exclude-county` leaves a county out of a hosted pack entirely; a file
  with more than 50,000 entities keeps only those that own a hosted parcel; entity names are indexed
  by 1–3-character grams, so a name search no longer scans every name.
- Registry: Texas appraisal-roll readers. `tx_pacs34` reads the PACS 8.0.34 export layout, maps a
  district's own state-code table to Comptroller categories, leaves out codes the table does not
  list, and stores organisation owners only. County adapters: Andrews (`tx_andrews`, the 2026
  real-property workbook with the district's 2025 state-code table), Bastrop (`tx_bastrop`, by
  parcel-use code), Ector (`tx_ector`, only the commercial and multifamily classifications the file
  states), Midland (`tx_midland_web`; it refuses a file with a birth-date column and does not use
  mineral or personal-property codes for scope) and Orange (`tx_orange`, state codes; it reads no
  owner fields).
- Collector: a download URL's `$limit` or `limit` is recorded as `row_cap` on the manifest, and
  `limit_saturated` tells a row count that reached the cap from a complete extract.
- Registry source records (`docs/registry/quality/audit-2026-11-06/`): quality reviews of Maryland
  SDAT, 57 New York ORPTS counties, MassGIS (no county passes) and six single-county loads; an
  Indiana statewide parcels adapter whose source stays unverified (its licence text grants no right
  to copy or redistribute); terms reviews, with nothing loaded, for 13 Indiana counties and two
  Florida sources (Hillsborough, Miami-Dade).

**Plans, keys and accounts**

- Hosted API: registry lookups are metered. Without a key, 25 a day per IP address (UTC day); Pro
  5,000 and Team 100,000 a month per subscription (calendar month, UTC), shared by its keys. A
  lookup is charged only when answered: `registry_coverage`, coverage misses (a county or system
  that is not loaded), input errors and `RegistryUnavailable` answers are not counted. Over the cap
  a registry call answers 429 `RegistryQuotaExceeded` (an MCP tool error with `isError`), naming
  the cap, the reset time and the plan that lifts it; other tools keep working. Registry responses
  carry `X-FactLot-Registry-Quota-Limit`, `-Remaining` and `-Reset`.
- Hosted API: `/v1/plans` lists each plan's registry lookups and key count, a `quotas` object with
  the counting rules, and `checkout_open`; the API root carries `checkout_open` too.
- Hosted API: agents can buy a key themselves. `POST /v1/billing/checkout` also returns `claim_url`
  and `expires_at`; `GET /v1/billing/claim/<token>` answers 202 while the checkout is unpaid, the
  key once (200, with plan, limits, account and MCP URLs), then 410 with `by` (`agent` or `page`),
  and 404 when unknown or expired. Polling is limited to once every 2 seconds per claim. The API
  root and `/v1/plans` describe the flow in a `checkout` object.
- factlot.com: the page after checkout is a setup guide: the key once with copy buttons, setup for
  Claude Code, Claude Desktop and claude.ai, ChatGPT, Cursor and VS Code, Python and curl, a "Test my
  key" button, and what counts as a lookup. A revisit shows the guide without the key and a link to
  recover access. `GET /v1/onboarding` (`?plan=pro|team`) serves the same guide as JSON, or as
  Markdown with `Accept: text/markdown`.
- Hosted API: Team subscriptions hold up to 5 keys: `POST /v1/billing/keys` adds one (shown once)
  and `DELETE /v1/billing/keys/{id}` revokes one, never the last.
- factlot.com/account: paste a key to see the plan, this month's lookups as a bar, a 30-day chart by
  tool and region, each key and its last use, the renewal date, the masked address Stripe sends
  receipts to, the hosted regions with their source dates, what's new and where to get help; open
  the billing portal to change card or cancel; replace or add keys; see connected apps and
  **Disconnect** them. The account pages share the site's stylesheet.
- Hosted API: `/v1/account` reports `registry_lookups` (used, limit, resets_at), the subscription's
  keys (count, limit, ids, dates and `last_used_at`), `renewal_at` (or `ends_at` for a subscription
  set to cancel), `support`, `changelog`, connected apps (`DELETE /v1/account/connections/{id}`
  disconnects one) and when an inactive record is deleted.
- Hosted API: `account_status` and `account_usage` MCP tools, listed only to callers with a key and
  never counted as lookups, and `GET /v1/account/usage`: charged lookups per UTC day for the last 30
  days (up to 90), by tool and by region prefix.
- factlot.com/account: email recovery for a lost key. Enter the email you paid with; a signed link
  that works once for 15 minutes shows the account and issues a new key (at the plan's key limit it
  replaces the oldest key and says so). The answer is the same whether or not the address has a
  subscription. A welcome email after purchase gives the setup steps and a link to /account (never
  the key). Email sending from factlot.com is not yet set up: until it is, the recovery form says
  so and no welcome email is sent. A self-hosted deployment needs the Email Service binding and the
  `RECOVERY_SIGNING_SECRET` secret.

**Sign-in from Claude and ChatGPT**

- Hosted API: sign in with OAuth 2.1, so Claude (Desktop, claude.ai, mobile) custom connectors and
  ChatGPT developer-mode apps, which cannot send a key header, can connect a paid plan. Add the
  connector `https://api.factlot.com/mcp/signin` and click Connect; a FactLot page shows which app
  is asking and where access goes, and offers **Connect with my key** (the key is pasted once, in a
  POST) and **Continue on the free tier** (an emailed sign-in link follows once email sending is set
  up). A connection is tied to the subscription, not the key: it has the plan's limits and quotas
  exactly as a key does, keeps working when the key is replaced, answers 403 while billing is
  failing, and is revoked when the subscription ends. A free connection gets the free limits (60
  requests a minute, 25 registry lookups a day) counted per connection instead of per address.
  Access tokens last an hour; refresh tokens 30 days, rotated on every refresh. Standards: PKCE
  (S256 only), exact redirect URIs, RFC 8414 metadata at `/.well-known/oauth-authorization-server`,
  RFC 9728 metadata at `/.well-known/oauth-protected-resource/mcp`, dynamic client registration
  (`/register`) and Client ID Metadata Documents, RFC 7009 revocation and RFC 8707 resource
  indicators at `/token`, `iss` on the authorization response; one scope, `mcp`. Tokens are stored
  only as hashes.
- Hosted API: a `401` from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="mcp"`
  (with `error="invalid_token"` for a rejected key or token). `/mcp` without credentials stays open
  on the free tier; `/mcp/signin` is the same endpoint but answers `401` without credentials, which
  is what starts sign-in in Claude.

**Model-backed tools (Pro and Team)**

- Hosted API: `doc_extract_lease` (`POST /v1/doc/extract_lease`). Send a lease as page text, a PDF
  (base64, at most 10 MB, 200 pages and 400,000 characters of text, read page by page and refused
  as soon as the text passes the cap) or an https URL; a model proposes each term with its quote
  and page, and FactLot returns only what `doc_verify_facts` verifies under `facts`, the rest under
  `needs_review` (`verified: false`) with the failed check, `unextracted`, the page count and the
  model's token use. A fact keeps the model's `section` only when it is a short label written on
  the cited page. A scanned PDF answers `NeedsOcr`. A call counts max(pages with text, characters ÷
  4,000) pages against a monthly allowance (Pro 100, Team 2,000), and has 120 seconds. Nothing is
  stored or logged. See `docs/ingestion-hosted.md`.
- Hosted API: `report_narrative` (`POST /v1/report/narrative`): prose (`summary`, `client_memo` or
  `plain_english`) drafted by a model from one FactLot tool result, or from its input (FactLot
  recomputes the result; required for Texas tools, which otherwise answer 422 `InputRequired`).
  Every number, percentage, money amount, date and citation in the prose is checked against the
  result's values (not its free text or array lengths): at least two significant digits or within
  5%, with sign, percentages only as ratios, dates and ranges read whole, number words, fractions
  and multipliers counted, citations whole and in the code named; sentences that fail are removed
  and listed, advice and valuation wording causes a redraft and is then removed, and Texas tools
  carry the calculator's notice. The label says "figures verified by FactLot" only for a recomputed
  result, and "figures matched against the result you supplied (not recomputed by FactLot)"
  otherwise. 60 seconds a call. Monthly allowance: Pro 50, Team 1,000.
- Both are listed to Pro and Team keys on api.factlot.com; `/v1/plans` lists their allowances under
  `model_tools`. Per subscription, at most 2 model-backed calls run at once and 6 start a minute
  (429 `ModelRateLimited` with `retry_after_seconds`); a failed call is given back for the first 5
  failures of a UTC day, and counted from the 6th. Every request asks Anthropic for US inference; a
  provider 5xx is retried once only with 30 seconds left, and a 400 or 413 is not retried. Every
  other tool runs without a model. A self-hosted deployment turns them on with the
  `ANTHROPIC_API_KEY` secret; without it they are not listed and answer 503 `ModelUnavailable`.

**Reports (deployed, not yet open)**

- Hosted API: reports, **deployed but not yet open**. Until they open, `report_create` is not
  listed, `POST /v1/reports` answers 503 `ReportsUnavailable`, and `/v1/plans` shows
  `reports.available: false`. When open, `report_create` (MCP, every plan) and `POST /v1/reports`
  build a client-ready document by code, with no model: `tx_unequal_appraisal` (PDF evidence
  packet, or the adjustment-grid workbook with live formulas and evidence columns),
  `lease_abstract`, `cam_reconciliation`, `debt_sizing`, `asc842_schedule`, `compare_proposals`,
  `dcf_summary` and `critical_dates` (also as an ICS calendar with a reminder 30 days before each
  notice deadline and window), as XLSX or PDF. Every kind but `lease_abstract` requires the tool's
  `arguments` (400 `ArgumentsRequired` without them): FactLot runs the tool and builds the document
  from that run only; a result sent as `input` is not used, and `result_mismatch` says whether it
  differs. `lease_abstract` also accepts a `doc_abstract_lease` result alone (shape and counts
  checked), and then every page says the values are as supplied by the caller and were not
  recomputed. Caller text (title, prepared-for line, citation locators, comparable ids, adjustment
  labels and reasons) is labelled as supplied by the caller, capped, and refused with 422
  `TextNotAllowed` when it reads as advice or a valuation. One report per request (one
  `report_create` per MCP batch). Size limits: a PDF shows at most 2,000 characters of one text and
  60,000 lines; the Texas PDF takes at most 60 comparables of 10 adjustments (413 `TooLarge` naming
  the workbook, which takes up to 200). A fault on FactLot's side answers 500 `ReportFailed`. The
  answer gives `download_url` (24 hours, `GET /v1/reports/d/<token>`, rate limited), `expires_at`,
  `bytes`, `sha256` and `filename`; `inline: true` adds base64 for files under 1 MiB. Reports a
  month: Free 3 per IP address, Pro 50, Team 1,000 per subscription; input errors are free, a
  report is counted before it is built and given back if the build fails, and over the limit the
  answer is 429 `ReportQuotaExceeded`. `/v1/plans` lists them under `reports`. See
  `docs/reports.md`.
- `@factlot/reports`: the report engine as a private workspace package (`createReport()`),
  Workers-compatible; its one new dependency is `pdf-lib` 1.17.1.

**Trust pages**

- factlot.com: `/status/` (the live health endpoint, what is and is not monitored, the live test
  suite, an incident history that records none since 2026-11-03, how to report a problem),
  `/security/` and `docs/security.md` (hosting, what is stored and not stored, transport, keys,
  secrets, dependencies, disclosure, and what is not in place: no SOC 2), `/sla/` and `docs/sla.md`
  (no service-level agreement today; draft terms of a 99.9% monthly target, a 10% credit under 99.5%
  and support targets, not in force until the Terms refer to them; versioning, deprecation, data
  refresh) and `/assurance/` (vectors, the differential test, the Excel workbooks, the live test
  suite, the verified rule, and what is not proven, with the commands to repeat each check). Every
  size the assurance page quotes from the repository is counted by the site build. The site
  footer, `llms.txt` and `SECURITY.md` link to them.

### Changed

**Texas tools and wording**

- `rules_tx_property_tax_protest_deadline` (`rules.tx.property_tax_protest_deadline@2`):
  **`recommended_file_by` is renamed `conservative_file_by`** (same date: the last business day on
  or before the unadjusted deadline), and its step is labelled "Conservative file-by date". A
  client reading `recommended_file_by` must read `conservative_file_by`. The rollover warning states
  the dates instead of advising ("2026-06-18 is the last business day on or before the unadjusted
  date 2026-06-19; the statutory deadline is 2026-06-22 under §1.06."). Every result has a
  `disclaimer`: information about a statutory deadline computed from the statute text as checked on
  the rule's verification date, not legal or tax advice and not a substitute for the advice of an
  attorney.
- `registry_tx_equity_candidates`: the result's `notice` (the same text in TypeScript and Python)
  and the tool description add that it is not an appraisal or an opinion of value (Tex. Occ. Code
  §1103.003(1)), not legal or tax advice and not a substitute for the advice of an attorney; the
  notice adds that FactLot is software, not a property tax consultant under Texas Occupations Code
  chapter 1152, and does not prepare, file or advise on protests. The description calls the results
  candidates under FactLot's default rule (a design choice, not a legal standard; a person decides
  which, if any, to use) and says Tarrant County is not served by the hosted registry while the
  publisher's terms for AI use are unclear.
- `calc_tx_unequal_appraisal` (values unchanged, `calc.tx_unequal_appraisal@1`): the evidence notice
  is returned once, in `value.disclaimer`, and no longer repeated as `warnings[0]`; the
  large-adjustment warning states the fact ("Total adjustments exceed 25% of the comparable's
  normalized value ...") without advising a second look; the tool description says
  `subject_minus_median_pct` is a fraction of the median (0.1554 is 15.54%).
- Texas pages and plugin skills: the skill `tx-commercial-protest-evidence` is renamed
  `tx-unequal-appraisal-arithmetic`, described as the arithmetic of Tax Code §41.43(b)(3) and
  §42.26(a)(3) on comparables and adjustments the user or their consultant chooses, with the
  filing-deadline rule, candidate parcels from the appraisal roll and a cited workbook. Every Texas
  page and skill now states that FactLot is software, not a property tax consultant under
  Occupations Code chapter 1152, that its outputs are not an appraisal or an opinion of value, and
  that they are not a substitute for the advice of an attorney; the deadline skill and docs say
  "conservative file-by date". The Texas deadline page adds a sentence on the next season's
  deadline (computed by the rule) and a tool-by-tool workflow for consultants, appraisers and
  analysts, and the docs say that Texas counties served by the hosted registry are listed by
  `registry_coverage` and that Tarrant County is not served while the publisher's terms for AI use
  are unclear.
- Excel workbook `examples/reconciliation/tx_unequal_appraisal.py`: the title is "Unequal-appraisal
  arithmetic, tax year <N>" (the year when the input gives one). `build.py tx_unequal_appraisal --input`
  writes the workbook for your data (ReadMe, Reconcile and Grid sheets), and the Grid
  carries the subject id, tax year and each comparable's document ID, locator, as-of date and fact
  ID.

**Registry**

- Registry owner rule (`is_organization`): a person's own name and a generic business word ("SMITH
  JOHN PROPERTIES", "GARCIA JOSE INVESTMENTS", "PATEL RAJESH HOLDINGS": two name words, one of them
  a listed given name, at most one initial or suffix, then a word such as PROPERTIES, HOLDINGS,
  INVESTMENTS, REALTY, ENTERPRISES, RENTALS or CO) is read as a sole proprietor, so the owner's name
  and mailing address are not stored. A legal form, "&"/"AND", "OF", a digit, an ordinal or a place
  or institution word keeps the organisation reading; "... BUSINESS TRUST" now reads as an
  organisation. **Registries built earlier need
  `python -m factlot.registry.maintain <db> --purge-persons`.** The bundled GSA lease comps drop one landlord the rule now reads as a person.
  Shared vectors in `spec/registry/organizations.json`.
- Registry: the Williamson adapter keeps an in-scope improvement that the owner file has no row for,
  without an owner or address.
- `registry_resolve_external`: the example system is `sdat_account` (Maryland), with `hcad_account`
  (Harris CAD) named for where Texas is hosted.

**Hosted API, plans and billing**

- Hosted API: `registry_tx_equity_candidates_batch` checks the batch input as the SDK does, then
  answers each subject as `registry_tx_equity_candidates` does (at most 4 at a time) and assembles
  the batch answer in the SDK's shape, so a large batch no longer runs as one registry request. It
  reserves one registry lookup per subject before it runs and keeps one per answered subject; a
  batch larger than what remains is refused whole (`RegistryQuotaExceeded`, saying how many
  subjects fit) and takes nothing. `account_usage` records each charged subject with its region. A
  subject the registry cannot answer fails the whole call as `RegistryUnavailable`.
- Hosted API: checkout for Pro and Team is open. Checkout asks for agreement to the terms, states
  the monthly renewal, collects a billing address when needed, and accepts tax IDs and promotion
  codes; the key page links to factlot.com/account. A deployment without a live Stripe key answers
  503 `CheckoutClosed`.
- Hosted API: plan changes made in the billing portal (Pro to Team and back) change the key's
  limits; a downgrade from Team to Pro keeps the subscription's oldest key and revokes the others.
  A subscription with paused collection, a fully refunded payment or a disputed payment stops its
  keys; a lapsed key can still open the billing portal and `/v1/account`, while tool calls answer
  403 `SubscriptionInactive`. Inactive key records are deleted 365 days after they become inactive.
- Hosted API: billing and account errors carry `code` and `next` (the URL or exact action that
  fixes them) next to `error` and `message`.
- Site: new terms of service and privacy notice (operator named, Texas law, plans, automatic
  renewal, cancellation and refunds, acceptable use, source rights, the Texas professional
  disclaimers, a retention period for every record, subprocessors, and California and Texas privacy
  rights). The pricing section, README and llms.txt state the Free, Pro, Team, Enterprise and
  registry download licence terms, with registry lookup quotas as hard caps.

**Tools, docs and plugin**

- Tool input: a `null` for a field the input schema names is treated as the field left out, in
  TypeScript and Python alike (shared vectors in `spec/vectors/tools.json`). Some agent frameworks
  (the `crewai-tools` MCP adapter) send `null` for every optional field the model skips, which used
  to fail with "expected number, received null". A required field sent as `null` is reported as
  missing; a misspelled field is still reported even when `null`; open objects (facts, fact
  packages) keep their nulls, since a package's signature covers them.
- MCP server instructions mention the unequal-appraisal calculator, Texas candidate parcels, and
  that `registry_coverage` lists hosted regions and is never metered.
- Claude Code plugin and connector docs: one server name, `factlot`, and a section on using a paid
  key.

### Fixed

**Hosted API and security**

- Hosted API: rejected API keys are rate limited per address before the key store is read; IPv6
  callers are limited per /64; a limiter outage answers 503 `ServiceUnavailable` instead of 500.
- Hosted API: the success page cannot mint two keys for one checkout when loaded twice at once, and
  says when a bank payment failed instead of "processing"; webhook events that arrive out of order
  are skipped, webhook bodies over 1 MB are refused, and a Stripe outage re-checks a key at most
  every 10 minutes.
- `SECURITY.md` no longer says there has been no numbered release. GitHub private vulnerability
  reporting and Dependabot security updates are on for the repository: report privately through
  the Security tab or by email.

**Calculators and document tools (numbers unchanged)**

- `calc_compare_proposals` (`calc.compare_proposals@2`): a tenant-perspective proposal typed
  `gross` with an `expense_psf_annual` now draws a warning that the estimate is the landlord's and
  is not charged to the tenant (an NNN deal typed as gross used to rank first with no warning), and
  an omitted `discount_rate_annual` is named in a warning with the 0.08 default.
- `calc_cam_reconciliation` and `calc_cam_reconciliation_batch` (`calc.cam_reconciliation@2`,
  `calc.cam_reconciliation_batch@1`): expense lines left without a `controllable` flag under a cap
  (treated as controllable), without a `variable` flag under a gross-up (not grossed up), and an
  omitted `gross_up.target_occupancy` (0.95) are named in warnings. Each batch statement carries the
  same warnings a single-tenant call with the same lines would.
- `doc_spread_statement`: a statement row whose quote is shorter than 12 characters ("R&M 310,411")
  is no longer left out of the spread; it is accepted where it appears on the page as whole words.
  A stated total that does not foot now names the lines of its period left out of the spread.

**Registry data and privacy**

- Registry: contact names that are not organisations ("ATTN JANE DOE", "C/O JOHN SMITH") are
  removed from owner and entity mailing addresses at ingest; `python -m factlot.registry.maintain --purge-persons`
  removes them from a file built before. The DC registry sample is re-published as
  `registry-sample-dc-2026-11-07`, built with the current owner rule and without contact names in
  mailing addresses; the README, llms.txt, site and the registry-unavailable message link to it.
- `registry_get`: a parcel record with no improvement facts warns that its values may be for the
  land only, and names the parcels of the same building that carry the improvements (Maryland's 100
  Light St is a land account and an improvement account).
- Registry source rights (review of 2026-11-06). `or-metro-rlis-taxlots`: the licence is Metro's
  RLIS Open Database End User License Agreement (revised February 2023), not ODbL; it prohibits
  sublicensing and does not license the database's individual contents, so the source is gated on
  terms (`verified: false`); its current count is 34,210 parcels from the live layer (as of
  2026-11-02). `wi-statewide-parcels`: the publisher states no licence ("free of charge", "free for
  public consumption"), which does not clearly permit redistribution, so the source is gated on
  terms. `ma-massgis-parcels` stays verified; its record now states that the public-domain data may
  be redistributed free or at reproduction cost and that charging for these facts beyond
  reproduction costs is outside the publisher's statement. Verified registry totals are now
  1,733,923 commercial parcels in 330 counties (19 states and DC) from 40 sources (were 1,953,805,
  405 counties, 21 states, 42 sources); `rights.md`, `coverage.md` and `coverage-counties.json` are
  regenerated.
- Registry source config: the Texas Comptroller franchise-tax source (`tx-comptroller-franchise`)
  records `attribution` "Texas Comptroller of Public Accounts", which its terms ask for and which
  the adapter already stores.
- Tool descriptions and docs: the Harris County example account is `0011440000001` (1000 Louisiana
  St, a commercial parcel the registry holds); the previous example was a residential account the
  registry never holds, so it always came back as a miss.

## [0.4.0] - 2026-11-06

### Added

- `lease_comp_search`: search the 6,994 GSA lease comps (the federal government is the tenant; not market comps for private tenants) offline and on the hosted API, by state, county, city, ZIP, radius, size, commencement, rent and type, with summary statistics and a citation on every answer. The data ship inside `@factlot/tools` and the `factlot` Python package and are rebuilt by `scripts/gen-gsa-lease-comps.py` from the GSA file, checked against the release.
- `doc_predicates`: the lease predicate catalog (JSON Schema, an example, which parts are checked against the quote and how, which always need a person), generated from the checks. It replaces `fact_validate` in the Custom GPT Actions subset.
- Document tools: a person's confirmation `{by, at, note?}` turns a value whose only unverifiable parts are true/false values, enums or summaries into a `human_verified` fact, with the quote-checked parts under `checked` and the rest under `confirmed_by_person`. It never overrides a failed quote, a contradicted number or date, or low confidence; generic labels such as "agent" or "system" are refused, and FactLot does not authenticate the name.
- Document tools: rent schedules written by lease year ("Lease Years 1–5: $34.50") verify: rents and lease years are checked against the table, the commencement date against its own quote, and the step dates derived (`doc.lease_year_dates@1`).
- `calc_critical_dates` (`calc.critical_dates@1`): renewal, termination, expansion and other notice deadlines and windows, in calendar months, with US federal holidays flagged or rolled and `as_of` warnings.
- `calc_reconcile_dcf` and `calc_reconcile_cam` (`@1`): tie FactLot's DCF or batch CAM reconciliation out against another system's export, line by line within a tolerance, with likely causes worded as hypotheses from FactLot's conventions; `python -m factlot.reconcile_files` reads a CSV or XLSX export. Tested on synthetic exports only (`examples/reconciliation/tie-out`); ARGUS and Yardi parity remain untested.
- Docs: `connectors/frameworks/README.md`, tested recipes for LangGraph/LangChain, the OpenAI Agents SDK, CrewAI, the MCP Python and TypeScript SDKs and the Vercel AI SDK (client-side tool filtering, 429 policy, User-Agent, API key), and a rerunnable script under `scripts/e2e/frameworks/` (not part of CI). `docs/reconciliation.md`.
- `calc_tx_unequal_appraisal` (`calc.tx_unequal_appraisal@1`): the Texas unequal-appraisal arithmetic of Tax Code §41.43(b)(3) and §42.26(a)(3). 3–200 comparables chosen by the caller, normalized by improvement or land area or compared whole, adjusted by percentages (summed or compounded), USD amounts and $/SF, each with a reason; the sorted adjusted values, the median (the mean of the two middle values for an even count) and the subject's value minus the median. Warns on mixed value bases, §42.26(d) and the §23.231 limitation, comparables in another county, fewer than 5 comparables, total adjustments over 25% and a comparable identical to the subject. Evidence calculation only: not an appraisal or an opinion of value, not legal or tax advice, and not a substitute for the advice of an attorney; it does not say whether to protest.
- Draft rule pack `tx_protest_evidence_dates` (`rules.tx.protest_evidence_dates@1`, opt-in through `runDraftRule` / `run_draft_rule`, not a tool): the owner's 14-day evidence date before an appraisal review board hearing (§41.43(a-1), (a-3)(3)) with a conservative date rolled back past weekends and Texas legal holidays, and the §41.67(d) requested-information cutoff (an exclusion rule, not a due date). `nonBusinessReason` / `non_business_reason` are exported from the verified deadline rule's calendar.
- `registry_tx_equity_candidates`: candidate comparable parcels for a Texas unequal-appraisal comparison from a local registry, with the selection rule, its effective parameters, the tier each candidate came from, and each source's rights. Candidates are shaped for `calc_tx_unequal_appraisal`; owner names, mailing addresses and ownership facts are never returned. Texas parcels only.
- `registry_get`: a parcel's record carries `value_history`, its market and appraised value by tax year from every snapshot, newest first, each value cited.
- Registry: Texas appraisal-roll adapters record `parcel.neighborhood_code` and `parcel.building_class` (Harris, Dallas, Travis; building class for Collin), and each tax year's roll is its own source, so a preliminary roll for the next year no longer retires the certified year's facts.
- Claude Code plugin skill `tx-commercial-protest-evidence` (twelve skills): evidence arithmetic for a Texas unequal-appraisal protest with the filing deadline, candidate comparables, the median calculation and a cited fact package. It never advises whether to protest or what value to claim, never looks up owners, and opens with the statement that it is not a substitute for the advice of an attorney.
- Excel workbook `examples/reconciliation/tx_unequal_appraisal.py`: the unequal-appraisal adjustment grid with live Excel formulas reconciled to `calc_tx_unequal_appraisal` at zero difference, from synthetic inputs or your own (`build.py tx_unequal_appraisal --input`).
- `llms-install.md`: setup steps an AI coding agent can follow, hosted and local.

### Changed

- The shape check enforces the documented field types of `lease.free_rent`, `lease.renewal_option` and `lease.termination_option`.
- `doc_verify_facts`: `verified` now means every part of the value was found in the quote. Prohibited uses, an exclusive's protected use and carve-outs, and ROFR/ROFO descriptions must be written in the quote; an invented item goes to `needs_review` (check `consistency`). A true/false value, an enum the quote does not word, or a paraphrased summary goes to `needs_review` with the new check `coverage` and a reason naming each part. `free_rent.applies_to: base_rent` and a `natural` breakpoint are checked by their wording.
- `doc_abstract_lease`: results no longer depend on document order. A document without a role is the original only when that is unambiguous (`role_inferred: true`); otherwise an `InputError` asks for `role`. Two or more amendments need `effective_date`; same-day amendments conflict instead of superseding.
- `doc_abstract_lease`: an amendment effective after `as_of` is pending: its values are under `pending` and `pending_facts` with a warning, and it does not control the current abstract. A rent schedule restated from a later date keeps the earlier steps (`carried_forward`).
- `doc_compare`: `lease_not_checked` lists the parts of an extracted lease fact that its quote does not confirm. `fact_package_verify` reports `checks_run`, `checks_not_run` and `values_not_checked`; `valid` is unchanged. `doc_verify_claim` accepts a bare sentence string as the claim.
- `calc_exchange_1031` (`calc.exchange_1031@2`): a property identified after the 45-day deadline no longer counts. It is left out of the identification count, total value, ratio, the three-property, 200% and 95% tests and the received share, and is listed only under `late_identifications`. A property received after the exchange deadline no longer counts as received for the 95% exception (before, any late receipt ended the exception).
- `calc_dcf_pro_forma` (`calc.dcf_pro_forma@2`): blended downtime and free rent are no longer rounded to whole months. The suite is vacant for the whole months, the rollover lease's first month collects the remaining share of rent and recoveries, and free rent abates the fraction of a month. Before, a 0.45-month blended downtime disappeared and a 55% renewal probability gave the same value as 100%. A lease that expires inside the projection always appears in `lease_events`, with a warning when its next lease starts after the forward year; the exit-year warning names rollover downtime.
- Whole-number percents are rejected everywhere: a rate field (including the waterfall's `until_irr` hurdles, which accepted values up to 10) above 1 in absolute value, or `min_dscr` above 10, in any calculator or in `lease_comp_validate` is an input error (HTTP 400) naming the decimal you probably meant ("pass 0.08 for 8%"), instead of computing 800% with a warning. Shares and ratios (`pro_rata_share`, `max_ltv`, `min_debt_yield`, occupancy, `*_pct`) rejected above 1 also say to pass a decimal. This replaces the warning added in 0.3.0.

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

[Unreleased]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/9mp96ygnbk-alt/factlot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/9mp96ygnbk-alt/factlot/releases/tag/v0.1.0
