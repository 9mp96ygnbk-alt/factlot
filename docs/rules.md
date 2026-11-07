# Rules packs

Rules packs turn jurisdiction law into code that agents can call. Each pack is a deterministic
calculator that also declares:

- **the law it implements**, as statute citations with links;
- **a version**, which is bumped whenever any output could change;
- **a verification status**: `draft` until a named person has checked the rule against the
  official text of every citation and recorded when.

Every result returns the rule's metadata. Draft rules always add a warning. Where a mistake could
cost someone a legal deadline, the rule also returns a conservative answer that can't be late.

| Pack                                                                                    | Tool                                     | Status                                                                                                  |
| --------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Texas property tax protest deadline (Tax Code §41.44(a)(1), §1.06; Gov't Code §662.003) | `rules_tx_property_tax_protest_deadline` | **verified** 2026-11-02 against the official text (§1.06 as amended by H.B. 1392, effective 2026-01-01) |

Draft packs are listed under [Draft packs](#draft-packs). They are not tools.

## Texas protest deadline

The deadline is the later of May 15 and the 30th day after the notice of appraised value was
delivered. It then rolls forward past Saturdays, Sundays, and Texas legal holidays, using actual
holiday dates.

Observed (shifted) holidays and Columbus Day are not treated as holidays. That is deliberate:
when it's unclear whether a day is a holiday, assuming a business day can only make the deadline
earlier.

The rule also returns `conservative_file_by`, the last business day on or before the unadjusted
deadline. It is not later than the deadline even if the holiday list is wrong. Every result carries
a `disclaimer`: information about a statutory deadline computed from the statute text as checked on
the verification date, not legal or tax advice and not a substitute for the advice of an attorney.
Version 2 renamed `recommended_file_by` to `conservative_file_by` and added `disclaimer`.

Not covered:

- other §41.44 deadlines, such as protests of changes made after notice and §25.25 corrections;
- late-protest relief;
- county-specific practice.

### How it was tested

- Shared vectors run in both SDKs, covering Memorial Day, Juneteenth, and weekend cases, with
  expected dates computed independently.
- A full 2026 holiday calendar vector.
- A TypeScript/Python differential test on random inputs from 2000 to 2100.
- An exhaustive invariant check over every notice date from 2000 to 2100. It confirms the deadline
  is always a business day, never before May 15, and that the conservative file-by date is never
  later than the deadline.

## Draft packs

A draft pack encodes law that no named maintainer has checked against the official text. Drafts
are kept apart from verified packs:

- **Not tools.** `rulePacks` (TypeScript) and `RULES` (Python) hold verified packs only, and only
  they become `rules_*` tools on MCP, REST, OpenAPI and the provider tool lists. A test in each
  SDK fails if a draft pack gets into them.
- **Opt-in.** Drafts run only through `runDraftRule(name, input, { acknowledgeDraft: true })` in
  `@factlot/calc` or `run_draft_rule(name, input, acknowledge_draft=True)` in the Python SDK.
  Without the acknowledgement the call raises `CalcInputError`. `draftRulePacks` / `DRAFT_RULES`
  list them with their metadata and input schemas.
- **Marked in every result.** `value.status` is `"draft"`, `value.rule.verification.status` is
  `"draft"`, and the first warning starts "DRAFT — not verified against the official text; do not
  rely on it." Draft metadata never names a verifier.
- **Cited element by element.** Each citation gives the section, the official government URL, the
  date the text was retrieved, and which elements it supports (`covers`). Each pack lists what it
  does not cover (`not_covered`), and its docs page quotes the operative text for every element.
- **Independently checked numbers.** The SDK tables were generated from one extraction of the
  official text; `spec/vectors/rules/drafts/*.tables.json` comes from a second, separate
  extraction, and both SDKs are tested against it. The expected values in the vectors are computed
  by `spec/vectors/rules/drafts/reference.py` in exact decimal arithmetic from those reference
  tables, without importing either SDK. `scripts/rules/check_draft_tables.py` compares the
  reference tables with official files a maintainer downloads.

| Pack                              | Covers                                                                                                  | Docs and checklist                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `nyc_ll97_building_emissions`     | NYC Local Law 97, 2024–2034: limit by ESPM property type, emissions by fuel, excess, $268/tCO2e penalty | [nyc-ll97.md](rules/nyc-ll97.md)                                   |
| `wa_cbps_eui_target`              | Washington Clean Buildings (WAC 194-50): EUI target, Tier 1 test, tier and compliance date              | [wa-cbps.md](rules/wa-cbps.md)                                     |
| `boston_berdo_emissions_standard` | Boston BERDO 2.0: Table 1 standard by building use and year, limit, excess, ACP at $234/tCO2e           | [boston-berdo.md](rules/boston-berdo.md)                           |
| `tx_protest_evidence_dates`       | Texas protest: owner's 14-day evidence date and the requested-information cutoff                        | [tx-protest-evidence-dates.md](rules/tx-protest-evidence-dates.md) |

Not drafted yet:

- **Energize Denver**: the targets are building-specific (interim targets run from each building's
  baseline to a final target), and the city published a proposed redline of the rules dated
  2026-06-08, so the text in force needs to be settled first.
- **Property-tax appeal deadlines** for New York (RPTL grievance day, NYC Tax Commission),
  Colorado and California: not attempted in this round. When checked, nysenate.gov and
  leginfo.legislature.ca.gov answered HTTP 403 to an automated request for robots.txt, so their
  crawl policy could not be read; the Colorado statute host was not looked into.
- **Self-storage lien sales** (Ohio, Indiana, Michigan) and **California SB 35, SB 423 and
  AB 2011** eligibility: not attempted.

## Verifying a pack

To move a pack from `draft` to `verified`:

1. Read each cited section in its official source. For a draft pack, complete the checklist in its
   docs page.
2. Confirm the logic and any tables (for the Texas pack, the holiday list).
3. Set `verification.status` to `"verified"` and record `verified_by` and `verified_at`. Do this in
   both SDKs; the shared vectors keep them in sync.
4. For a draft pack, move it from `draftRulePacks` / `DRAFT_RULES` into `rulePacks` / `RULES`
   (it then becomes a tool) and its vectors from `spec/vectors/rules/drafts/` to
   `spec/vectors/rules/`.
5. Bump the version if any behaviour changed.
