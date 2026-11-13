# FactLot Registry

The registry is the identity layer behind FactLot IDs. It holds cited public-record facts about
**commercial** property: parcels, the legal entities that own them, and the links between them.
Every fact traces back to a specific downloaded file and record.

**Tier 1 (2026-11-02):** 47 sources across 15 states and DC were reviewed in one pass; 18 are
verified and 33 have adapters with synthetic-fixture tests. Beyond Texas, Boston (13,296
commercial parcels), San Francisco (19,048), and Philadelphia (77,286) are loaded in full, and so
are New York City (164,633), Los Angeles (203,179), Denver, Hennepin, Mecklenburg, and DC.
The first audit of those files (2026-11-03) and the fixes it led to are in
[quality/tier1-2026-11-03.md](quality/tier1-2026-11-03.md); the counts below are the first
pass's, kept for the record (the Harris and Dallas counts in the status paragraph below, for one). Owner names are missing from several public files (Los Angeles, San Francisco, Fairfax,
San Bernardino), and most state entity registries outside Texas, New York, Colorado,
Pennsylvania, and DC are sold rather than published. The per-source review records, gates, and
counts are in [sources/README.md](sources/README.md).

**Status (2026-11-02):** the core is built and tested, and the first real roll is in. The Harris
CAD adapter (`factlot.registry.adapters.tx_harris`) loaded the 2026 roll from the collector's
snapshot: 1,628,382 accounts read, 87,717 commercial parcels kept (68,795 F1, 2,466 F2, 16,456
B1–B4), 880,154 cited facts, 56,796 organisation owners of record, in 42 s. The Dallas CAD
adapter (`tx_dallas`) loaded the 2026 certified export: 59,645 commercial parcels (F10, F20, B11,
B12), 537,359 facts, 33,362 organisation owners, in 40 s. The Comptroller adapter
(`tx_comptroller`) loaded 3,272,073 registered Texas entities from the franchise-tax file
(242,564 rows without an SOS number skipped) in 19 min, and exact-name linking matched 66,132 of
the 90,158 organisation owners of record (73%): 224 names were ambiguous and 23,802 unmatched.
For those, fuzzy matching with a human review queue is now built and tested on
synthetic data (see [Owner resolution](#owner-resolution)); it has not yet been run on the real
file, so the 73% figure stands until a reviewer works the queue. The combined registry file is
9.3 GB. The source review is in [texas-sources.md](texas-sources.md).

| Doc                                  | What it covers                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| [data-policy.md](data-policy.md)     | What we may collect, how, and what we never keep                              |
| [texas-sources.md](texas-sources.md) | The Texas pilot sources and the domains each needs                            |
| [coverage.md](coverage.md)           | What is loaded per state and county, and what is queryable today (generated)  |
| [rights.md](rights.md)               | Licence, AI-use status, redistribution and attribution per source (generated) |

## How it works

```
public file (CAD roll, entity list)
  └─ snapshot: SHA-256 → fl:document:sha256-…, plus source URL, retrieval time, as-of date
       └─ adapter: publisher layout → ParcelRecord / EntityRecord
            └─ registry: scope filter → FactLot IDs → cited facts → crosswalks → indexes
                 └─ link_owners(): owner of record → registered entity (exact, unambiguous; or reviewed)
                      └─ queue_fuzzy_owner_matches(): candidates for the rest → owner_match_review
                           └─ decide_owner_match(): a person accepts or rejects; only accept links
```

**Storage.** The registry is a single SQLite file (`factlot.registry`, Python standard library
only). The schema is in `python/src/factlot/registry/schema.sql`. The TypeScript server can read
the same file with `node:sqlite`.

**Scope and privacy.** Only Texas state property categories B, F1, and F2 are ingested.
Owner names that belong to natural persons, and owners withheld under Tax Code §25.025, are never
stored. A name counts as an organisation only if it carries an organisation word (LLC, LP, Inc,
Properties, Bank, ...) before any "DBA"; a person's role ("CO-TRUSTEE", "CO TRS") or bare spaced
initials ("L P") do not count, and neither does a generic business word after a person's own name:
"SMITH JOHN PROPERTIES", "GARCIA JOSE INVESTMENTS" and "PATEL RAJESH HOLDINGS" are persons (two name
words, one of them a listed given name, an optional initial, then a word such as PROPERTIES,
HOLDINGS, INVESTMENTS, REALTY, ENTERPRISES, RENTALS or CO), while "SMITH JOHN PROPERTIES LLC",
"SMITH & JONES PROPERTIES" and "PACIFIC COAST PROPERTIES" stay organisations. Only organisations are
searchable by name.

The rule also reads organisations that have no such word but a legal form no person's name has:
credit unions ("... CREDIT UNION", "FCU"), federal savings banks ("FSB"), national banks written with
"N.A." after a bank word ("CITIBANK, N.A."), government bodies ("CITY OF ...", "SECRETARY OF ...",
"DEPARTMENT OF ...", "BOARD OF MANAGERS"), condominiums and housing development fund corporations,
securitization trusts ("... MORTGAGE LOAN TRUST 2006-1", "PASS THROUGH CERTIFICATES"), business trusts
("... BUSINESS TRUST"), MERS, Fannie Mae and Freddie Mac under their legal names, and foreign "GMBH"
and "PLC". A surname that is also an organisation word does not make a person an organisation:
"JOHN BANK", "CHURCH, MARY" and "ANNA COUNTY" are persons. Forms that a person's name can look like are left out on purpose (a bare "NV",
"SA", "BV" or "AG", "NA", "FANNIE MAE"). The shared vectors are `spec/registry/organizations.json`.

A name that carries a natural person inside an organisation-style wrapper is a person whatever else
it holds (`person_carrying_class`): "ESTATE OF <person>", "HEIRS OF <person>", a personal trust
("<person> REV TR DTD ...", "<person> FAMILY TRUST", "<person> PROPERTIES TRUST"), a trustee named in
person ("<person> TRUSTEE", "TRUSTEES OF <person>", "<bank> AS TRUSTEE OF THE <person> TRUST") and a
company followed by one of these ("<company> LLC <person> REV TR"). A bank or trust company as
trustee with no person named, "TRUST NO 12345", statutory and business trusts, realty trusts,
"BOARD OF TRUSTEES OF EXAMPLE COLLEGE" and "TRINITY CHURCH TRUSTEES" stay organisations. Parties to
deeds and mortgages follow `organization_part`: an organisation is kept as written, a wrapper keeps
its leading company only when nothing of the person's name remains in it, and every other party is
replaced by a count in `<role>_withheld` (`{"count": 2, "kinds": ["estate", "person"]}`).

**Provenance and rights.** Each fact carries:

- its method: `public_record` for facts read from a file, `inferred` with a confidence for
  ownership links;
- the snapshot document ID, plus a record locator such as `account 0011440000001`;
- the source's license, AI-use status, redistribution status, and attribution.

Every fact passes `fact_validate`.

**Time.** Re-ingesting the same snapshot changes nothing. A fact is _current_ only if the latest
snapshot from its source that covered the parcel restated it; otherwise it becomes history. This
is what retires a sold parcel's old owner. Example: an LLC sells to an individual. The new roll
lists a person, whose name we never store, so the LLC's ownership fact and link become history
instead of lingering as current.

`registry_get` with `as_of` (YYYY-MM-DD) applies the same rule to the snapshots dated on or before
that date: the facts and ownership links current then, and the status then (`not_yet_recorded`
before any snapshot covered the record). With `include_history` as well, the history stops at that
date. The building roll-up and crosswalk IDs are the file's current ones. `include_history` lists
every fact, current ones included, so on a file that loaded each source once (the DC sample) it
returns the current facts again: there is nothing superseded yet. On the hosted API, a call without a Pro or Team key gets the current roll year only in `value_history` and in `include_history`'s `history`, and, when earlier roll years (or `include_history` facts) were actually removed, `history_withheld` (the earlier `tax_years`, newest first, their `count`, and a count of earlier `facts`; never a value, citation or date), a one-sentence `history_note` saying the same in words, and `history_available: "pro"` (full history needs a Pro or Team key). A parcel with one roll year gets none of the three, because nothing was left out; `registry_get` with `as_of` (the record on an earlier date) needs a Pro or Team key there and answers `PlanRequired` without one, uncounted; so does `registry_tx_equity_candidates` with `tax_year`, because it values a whole pool of parcels on the roll year named (without `tax_year` it uses the newest roll year that has values, on every plan).

**Area checks.** `registry_get` returns a parcel's area facts as the source publishes them and adds
a `warnings` list (empty when nothing is wrong) when they fail a sanity check:

| Check                                                                     | Threshold                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parcel.improvement_area_sf` ÷ `parcel.land_area_sf` (a floor-area ratio) | above 40, a density few buildings anywhere reach. In the DC sample 36 of 12,318 parcels exceed it, nearly all condominium units whose record carries the whole building's area against the unit's share of the land (one has 195,480 sf on 120 sf) |
| `parcel.land_area_sf`                                                     | 0 or less                                                                                                                                                                                                                                          |
| `parcel.improvement_area_sf`                                              | less than 0                                                                                                                                                                                                                                        |

The thresholds are `MAX_PLAUSIBLE_FAR` in both readers (`packages/tools/src/registry.ts`,
`factlot.registry.store`). A warning never changes or hides a fact.

**Land-only records.** A parcel record with facts but no improvement fact (no positive
`parcel.improvement_area_sf` and no `parcel.year_built`) gets a warning that its values may be for
the land only. When another parcel of the same rolled-up building carries improvement facts, the
warning names it (at most five): a county can assess one building on a land account and a separate
improvement account at the same address. In the Maryland file, 100 Light St in Baltimore is two
accounts, `0304110671-001` (85,073 sf of land, $4,275,000) and `0304110671-001a` (686,947 sf built
in 1975, $25,730,600); `registry_get` on the first names the second. Otherwise the warning says the
parcel may be vacant land, that the source may not publish building facts for it, or that the
building may be assessed on another account.

## Upgrading a registry after a rule change

Owner names are stored only for organisations. If the person-detection rule (`is_organization`)
is tightened, run `Registry(path).purge_person_owners()` once on every registry built before the
change: it deletes owner-of-record facts the current rule reads as persons, with their
mailing-address facts, any ownership links inferred from them, and their review-queue rows. The
parcels and their other facts stay. It is idempotent. If the rule is loosened (a name that was
dropped as a possible person is now read as an organisation), re-ingest the snapshot: facts are
keyed by content, so only the newly readable owners are added.

If `normalize_name` changes, the entity name index holds keys made by the old rule. Run
`Registry(path).rebuild_name_index()` (it rewrites a key only when it is exactly the old rule's
output for the entity's current name) and `rebuild_review_keys()`, then `link_owners()`.
A file records the ID spec parcel rule its parcel URNs were made with in `meta.parcel_rule`
(`2`, ID spec 0.3, for a file started now). A file holding parcels and no `parcel_rule` was built
with parcel rule 1 (separators dropped): it keeps its URNs, ingests into it use rule 1, and
`registry_resolve_parcel` resolves an APN by rule 1. To move such a file to rule 2, rebuild it
from its snapshots; parcel URNs written with separators change (see the ID spec, v0.3).

If `normalize_address` changes (address key version 2, 2026-11-03, reads "Northwest", "North
West" and "N.W." as "NW" and drops a unit, suite, "#" or floor designator with its value), run
`Registry(path).rebuild_address_index()`: it re-keys the address index from every situs-address
fact and records `address_key_version` in `meta`. Until then the readers search an older file by
both the old and the new key, so a published file keeps working.

`python -m factlot.registry.maintain registry.db --all` runs, in order: purge persons, clean
entity names, re-key names, re-key addresses, link owners, roll up buildings
(`rollup_buildings`), and store the coverage summary (`refresh_coverage`). Each step is
idempotent. `python -m factlot.registry.audit registry.db` measures the result (see
[Quality](#quality)).

## Coverage

A registry file holds some counties and some entity registries, not the country. Every registry
tool says so on a miss instead of answering `null` or `[]` alone: `registry_resolve_parcel`,
`registry_resolve_external`, `registry_search_address`, `registry_search_entities` and
`registry_owned_by` add a `coverage` object to an empty result (HTTP 200), and `registry_get` and
`registry_tx_equity_candidates`, which need one record, add it to their `NotFound` error (HTTP 404 on
the REST API, `isError` over MCP, the same object either way). It says whether the county (or entity registry, or crosswalk system) asked about
is loaded, and its `message` says so in words, naming counties by their Census name, for example
"Pinal County, AZ (04021) is not loaded in this registry; loaded: District of Columbia, DC
(11001, 18077 parcels)". `registry_coverage` gives each county's `name` too. The names come from
the US Census Bureau's public-domain county FIPS reference file (2020 Census FIPS Codes for
Counties and County Equivalents, retrieved 2026-11-03), kept in `spec/registry/county-names.tsv`
with its source and checksum; `scripts/gen-county-names.py` regenerates the TypeScript and Python
tables from it. A county code the file does not list reads "county 48999 (TX)". A malformed URN is a `FactLotIdError`,
not a miss. `registry_coverage` lists what the file holds: each county with its parcel and
building counts, sources and as-of dates; each entity registry; each crosswalk system; and the
key versions. The summary is computed from the file (`factlot.registry.coverage`) and stored in
`meta.coverage` by `refresh_coverage`, with a stamp that makes readers recompute it after a later
ingest.

## Buildings

Rolls list each condominium unit as its own parcel, with no record of the building. The
building roll-up (`Registry.rollup_buildings`, `factlot.registry.buildings`) groups the parcels
of one county whose current situs addresses give the same street line and ZIP code (unit,
suite, "#" and floor designators removed) under a building subject. Its URN is the
deterministic building ID (`fl:building:us-<SSCCC>:<zip5>:<street>`, [ID spec](../id-spec.md#building-ids)),
the same ID `id_building` computes offline from the address. Only groups of two or more parcels
are recorded. Each member says how it was placed (`building_members`):

| Rule                    | Meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `dc_condo_lot`          | DC SSL lot 2000-6999: a condominium lot under the District's lot numbering (DCGIS) |
| `nyc_condo_unit_lot`    | NYC BBL lot 1001-6999: a condominium unit lot (NYC Planning PLUTO data dictionary) |
| `nyc_condo_billing_lot` | NYC BBL lot 7501-7599: the condominium's billing lot (PLUTO data dictionary)       |
| `same_street_address`   | the shared street line and ZIP code alone (`is_unit` when the situs names a unit)  |

`street_found` says how the street line was read: `before_comma`, or `street_type_end` for a
situs written without a comma before the city (the street is taken to end at the first street
type after the name, plus a directional). `zip_found` is `other_parcels` when the publisher cut
the ZIP code short and the parcel joined the one building at its street line whose ZIP code
begins with the digits left. `registry_get` on a parcel returns its `building` (URN, label,
parcel and unit counts, rule); on a building URN it returns the members; `registry_owned_by`
gives each parcel its `building` and adds a `buildings` summary, so one owner's 25 parcels in one condominium
building count as one building. On the hosted API, a call without a Pro or Team key gets the first three distinct parcels of `results` in the registry's order, with every row of each (a parcel can have more than one row, one per linking document), and the `buildings` of those parcels only (`owned_parcels` counting distinct kept parcels), and, when parcels were actually removed, `portfolio_withheld` (`count`, the distinct parcels left out, and `total`, the owner's distinct parcels; never a URN, label or building) and a one-sentence `portfolio_note` saying the same in words. A portfolio of three distinct parcels or fewer gets neither, however many rows it has. The tool takes no paging argument, so the cut applies to every call. The entity's own `registry_get` record is limited the same way: its `owns` relationships to the first three distinct parcels, in the registry's order (newest link first, so not necessarily the three `registry_owned_by` keeps), with the same `portfolio_withheld` and `portfolio_note`; its other relationships are unchanged. On the published DC sample the roll-up makes 396 buildings from
1,682 parcels (713 by DC condominium lot numbers).

Limits: the roll-up is an inference from addresses, not a published building record. Two
buildings at one address are one building here; a corner building listed under two addresses is
two; a parcel without a house number or ZIP code is not rolled up (1,056 of 18,077 in the DC
sample).

## Quality

`python -m factlot.registry.audit registry.db` reads a registry file and reports, per source and
snapshot: parcel and entity counts, field completeness, parcels with no situs address or no
organisation owner, conflicting facts, implausible figures, owner-of-record facts that read as
natural persons (policy: zero), the owner link rate by confidence and rule with the reasons the
rest are unlinked, the review queue, snapshot age, and every fact or link whose citation is
incomplete. With `--reread --collected <dir>` it also runs each source's adapter on the archived
file and checks that the registry holds exactly what the adapter yields, which is how an adapter
that misses a header row or a record type is caught. It exits 1 on a hard violation. The audit of
the Tier 1 files is in [quality/tier1-2026-11-03.md](quality/tier1-2026-11-03.md).

## Owner resolution

Owner-of-record names on a roll rarely match a registration letter for letter: "ACME
PROPERTIES, L.L.C." may be registered as "ACME PROPERTY LLC". Resolution happens in two stages,
and only the first is automatic.

**1. Exact match in the right jurisdiction (automatic).** `link_owners()` links a parcel to an
entity when the normalized owner-of-record name equals exactly one registered entity's normalized
legal name (`normalize_name`: case, punctuation, entity-type suffixes such as L.L.C. and Limited
Partnership, apostrophes dropped, what a roll appends to an owner removed ("ET AL", a "DBA" trade
name, a dangling "&" or "THE"), "NO 1" read as "1", and common abbreviations spelled one way:
PPTIES and PROPERTIES, CTR and CENTER, STREET and ST) _among the entities that could plausibly be that owner_: those registered in the
parcel's state, formed in the parcel's state, or registered in the state of the owner's mailing
address. The link is an `owns` relationship labelled `inferred` with confidence 0.9, and its
`basis` says which of the three rules applied. Ambiguous names (several such entities) and
unmatched names stay unlinked, with one exception: when every same-name entity but one has
ended (dissolved, revoked, merged, withdrawn, forfeited existence) and that one still exists,
it is linked at confidence 0.85 with a `basis` saying so; an unknown status anywhere means no
decision. An exact name match that exists only in some other state is not a
link: it is queued for review (stage 2) with rule `exact_name_other_state`, because with several
state registries loaded a common name ("MAIN STREET PROPERTIES LLC") exists in most of them.

**2. Fuzzy candidates with human review (never automatic).** For every current owner of record
that has no link, `queue_fuzzy_owner_matches()` proposes candidate entities and writes them to the
`owner_match_review` table. Nothing is linked at this point. A reviewer calls `review_queue()` to
see pending rows and `decide_owner_match(review_id, accepted, decided_by)` to accept or reject
each. On accept, the registry writes an `owns` link for every parcel whose current owner of record
has that name, labelled `inferred` with confidence `min(score, 0.8)`, so a reviewed link always
ranks below an exact match, and with a `basis` note naming the rule, the score, the reviewer and
the review row. On reject, the decision is recorded and that (owner name, entity) pair is never
queued again. Decisions are final; accepting one candidate rejects the owner's other pending
candidates, because the review is a choice among them. `link_owners()` re-applies accepted
decisions when a newer roll restates the same owner name, so a reviewer decides each name once.

The candidate generator is deterministic and uses the standard library only:

- **Pool.** Entity names are indexed by their distinctive tokens (`name_tokens`): normalized
  tokens minus a stop list of entity-type suffixes and generic words (LLC, LP, INC, PROPERTIES,
  HOLDINGS, PARTNERS, TEXAS, …). An owner name's pool is every entity sharing one of its
  distinctive tokens, plus exact-key matches (so ambiguous names get all their matches at score
  1.0). Tokens shared by more than `max_token_frequency` entities (default 5,000) are ignored, so
  the pool stays small on millions of entities and a name made only of stop tokens is never
  matched.
- **Score**, in [0, 1]: `0.7 × ratio + 0.3 × token_overlap`, where `ratio` is
  `difflib.SequenceMatcher` over the two names with their tokens sorted (a transposed word costs
  nothing; a typo or singular/plural drift costs a little) and `token_overlap` is the Jaccard
  overlap of the distinctive tokens, counting near-equal spellings as the same token. Every row
  records the rule name (`fuzzy_name_v1`), both components and the shared tokens as its `reason`.
- **Threshold 0.85, top 5 per owner** (both are parameters). At 0.85, "ACME PROPERTIES LLC" admits
  "ACME PROPERTY LLC" (0.92), a one-letter typo (0.98), a transposition (1.0) and a different
  suffix such as INC (0.93), while excluding series entities ("ACME PROPERTIES II LLC", 0.80),
  "ACME HOLDINGS LLC" (0.61) and anything sharing only one distinctive token (≈0.4). A lower
  threshold or higher limit only adds pairs; rejected pairs stay rejected.
- **On the real data** (Harris + Dallas owners against 3.27 million Texas entities, 2026-11-02):
  15,888 unmatched owner names considered, 5,195 with at least one candidate, 6,149 review rows
  queued, in 20 minutes (the token index over 3.27 million names took 113 s to build). The queue
  shows both the wins ("1012 KATY STREET PPTY LLC" → "1012 KATY STREET PROPERTY LLC", 0.87) and
  why a person decides: "10850 HARRY HINES LLC" scores 0.97 against "10815 HARRY HINES, LLC", a
  different building.

```python
reg.link_owners()                                # exact matches, plus earlier accepted decisions
reg.queue_fuzzy_owner_matches()                  # {'owners_considered': …, 'queued': …, …}
for row in reg.review_queue(limit=50):           # pending, grouped by owner, best candidate first
    print(row["review_id"], row["owner_name"], "->", row["entity_label"], row["score"], row["reason"])
reg.decide_owner_match(row["review_id"], accepted=True, decided_by="reviewer handle")
```

Registry files written before schema version 2 gain the two new tables when they are next
opened (every schema statement is `IF NOT EXISTS`); the token index is rebuilt from `name_index`
the first time the queue runs, or explicitly with `rebuild_name_tokens()`.

## Enrichment sources

Some sources do not list parcels; they describe parcels an appraisal roll already put in the registry: NYC PLUTO
(zoning, floor-area ratios, buildings, floors, units), the District's zoning map (joined to lots by polygon overlay)
and the NYC and DC sales files; in round 2, NYC's recorded deeds and mortgages (ACRIS), condominium units' inherited
zoning, the District's zoning development standards, building energy benchmarking (NYC, DC, Denver), and zoning for
Minneapolis (by parcel point), Denver and San Francisco (from the assessor's own column). `Registry.ingest_parcel_facts` writes their facts to parcels that exist (a record
for an unknown parcel is counted and dropped, so the roll alone decides what is in scope), cites the source file and
record, and covers the parcel with a marker (`coverage.present = 2`) that makes its facts follow the usual currency
rule but does not keep a parcel current that the roll has retired. A derived fact (a zoning district found by
overlay) is `inferred` with a confidence. Sales and recorded documents
(`transaction.sale`, `transaction.deed`, `debt.mortgage_recorded`, `debt.mortgage_satisfaction_recorded`) are the many-valued
predicates: a parcel holds one fact per sale or document and readers return them all, newest first. Recorded-document
facts name organisations only. Source review records:
[sources/README.md](sources/README.md#enrichment-sources-zoning-building-and-sale-facts); the predicates are in
[../fact-model.md](../fact-model.md).

## Using it

```python
from factlot.registry import Registry, Source, ParcelRecord

reg = Registry("registry.db")
reg.add_source(Source("tx-harris-cad-roll", "Harris Central Appraisal District", "Appraisal roll",
                      "https://…", state_fips="48", county_fips="201", license="…",
                      ai_use="…", redistribution="…", terms_reviewed="YYYY-MM-DD"))
snap = reg.add_snapshot("tx-harris-cad-roll", "downloads/real_acct.zip", as_of="2026-07-25")
stats = reg.ingest_parcels(adapter_records, snap, state_fips="48", account_system="tx-harris-cad-account")
reg.link_owners()
reg.get(reg.resolve_external("tx-harris-cad-account", "0011440000001"))
```

## Agent tools

When a registry is available (a registry file configured with `FACTLOT_REGISTRY_DB`, or
`configureRegistry()` / `configure_registry()`, or the hosted API's registry service), the catalog
gains eight tools. They are served over MCP and REST, and in both SDKs:

- `registry_get`
- `registry_resolve_parcel`
- `registry_resolve_external`
- `registry_search_address`
- `registry_search_entities`
- `registry_owned_by`
- `registry_coverage`
- `registry_tx_equity_candidates`

Without a registry, the MCP server does not list them, REST returns 503, and the SDKs return
`RegistryUnavailable`.

**Address search** matches whole words of the street line (the query up to its first comma),
normalized as the address index is. A query that starts with a house number finds addresses that
start with that number and contain every other word ("1200 Main" finds "1200 MAIN ST NW"); a
query without one must name the street with its type, and its words must appear in a row ("Main
St"). A city or state name, or part of a word, alone matches nothing ("Ontario" does not find
"ONTARIO RD NW"), and the miss says what to send instead. `spec/registry/normalize.json`
(`address_queries`) pins how a query is read in both languages.

**Spellings and ranges.** Every spelling of the street line is searched at once
(`address_search_forms`): a numbered street with and without its ordinal ending ("5th Ave" and "5
Ave", since some rolls write numbered streets bare), written in words ("Fifth Avenue", "Forty-Second
Street", "One Hundred Twenty-Fifth Street"), with San Francisco's leading zero ("03RD ST"), Sixth
Avenue and the Avenue of the Americas as Manhattan's roll writes them ("AVENUE OF THE AMER"), and
Eye Street as "I ST" (Washington, DC). A query with a house number also matches a lot whose label
starts with a house-number range holding it ("350 5th Ave" finds "338-350 5 AVENUE"): when both
ends of the range are odd or both even the lot holds the numbers of that parity only, one side of
the street, as about 99% of the ranges in the registry's rolls do (27,649 of 27,967 outside
Queens); ends of differing parity hold every number between. A label range spanning 500 numbers or
more is not read as a range (11 lots in the registry's rolls, typing slips such as "749-7570 GRANT
AV" or a whole street's numbers). The street must start with the same
word, and every other word of the query must follow the range. In Queens, NY a hyphenated house
number is one number ("37-20 80 Street"), never a range. A query without a comma whose street line
goes on after its street type with a place ending in a state or ZIP code ("6700 Bissonnet St
Houston TX 77074") is read as if a comma came before the place; words between the street type and
the city (a bare unit number) stay in the street line, and a unit is read from the query as asked. In each place group, matches of the
words as written come first, then the other spellings, then ranges; then an exact address, then the
parcel whose label names the unit the query names ("#310"; a unit never filters), then by label.
Parcels sharing one label come largest improvement area first, and those the roll records as land
only last; of a label shared by more than twice the limit, the first by URN are ordered, so a search
reads at most twice its limit of records. `address_ranges`, `address_range_matches`, `address_units` and
`address_queries_with_place` pin these rules in both languages.

**What a result carries.** Each result has `urn` and `label` and, from the parcel's current facts,
what tells parcels at one address apart: `account` (the district's account or lot number),
`property_category`, `use_code`, `improvement_area_sf`, `land_only` (false when the roll records an
improvement, true when it records an improvement area of 0, null when it records neither) and `unit` (the unit its label names after a designator).
Never an owner.

**Place fields.** `address` is accepted for `query` (exactly one of the two), and `state`, `city`,
`postal_code` and `county_fips` mean what the same words after the comma mean, replacing them:
`state` filters, `city` and `postal_code` only order. `county_fips` (5 digits, or 3 with `state`)
filters too, by the county in each parcel's URN, which unlike a label's ZIP code is never written
wrongly.

**The place after the street line.** The rest of the query (after its first comma) is read
conservatively from its end. A trailing country ("USA", "U.S.A.", "US", "United States") is
dropped, and "D.C." is DC. A ZIP code is a 5-digit number (or ZIP+4) that ends the query and does
not follow a unit, suite, box, room, building or number word ("Suite 12345" and "PO Box 12345" are
not ZIP codes); a number of 4 or 6 to 9 digits there ("6103.0", "60701822", as some Connecticut
labels have) is a ZIP code written wrongly and is passed over, and 9 digits are ZIP+4 without its
dash. A state (two letters, or the full name) counts only when it follows a city, in its
comma part or the one before, and never after a unit word or a floor ordinal: "Houston, TX" and
"Waterbury CT 06702" name a state, but a bare ", NE", ", LA", ", TX 77002" or ", Indiana" and
"12th Fl" do not. The city is the comma part left at the end: one to five words of letters, none
a unit word ("Washington 20001" is the city Washington with no state).

Only a named state filters: the answer keeps parcels in that state (from the parcel URN,
`fl:parcel:us-<state FIPS><county FIPS>:…`), before the limit. The ZIP code and the city only
order the matches: first those whose situs address has the ZIP code, then those in the city, then
the rest, each group in the usual order (an exact address first, then by label). A ZIP code never
implies or overrides a state, because published labels carry malformed ZIP codes (Connecticut ZIP
codes without their leading zero, a few from another state's range), and a label pasted back as
the query must still find its parcel. A part that cannot be read, or a query without a comma,
leaves the search as it was. When the street line matches only outside the named state, the answer
is a miss whose `coverage` says what the registry holds in that state ("of MA this registry holds
Suffolk County, MA (25025, … parcels)"; the hosted registry adds "only the City of Boston is
loaded"), or that the state is not loaded; the hosted registry answers a state it holds no parcel
in without reading its address lists. Every spelling keeps to the same state. A street type
alone ("Loop, Houston, TX") is placed among its first 100 matching addresses only, because the
hosted index keeps no more for a one-word query. Same-city and same-ZIP ordering reads the
parcel's label, so a label that leaves out the city or carries a malformed ZIP code sorts with the
rest; this changes the order only, never which parcels are returned. `spec/registry/normalize.json`
(`address_places`, `address_place_ranks`) pins the reading and the order in both languages.

**Misses that say why.** An empty answer's `coverage` carries `reason` and a message: the named
state is not loaded (`state_not_loaded`); the named county is not, or every county known to hold
the named city's or ZIP code's parcels is not (`county_not_loaded`, with `place_counties`; the
table `spec/registry/address-places.tsv` is built from registry parcel labels by
`scripts/gen-address-places.py`, and a city it does not know is not mentioned); the query names no
house number or street type (`no_street`); a street type alone was searched
(`street_type_alone`); no address on the street is in the index for the state (`street_not_found`);
the house number is on the street but not with every other word of the query (`other_words`); the
index shows the street but no such house number on it (`house_number_not_found`, with `street` and
`nearest_house_numbers`, the nearest numbers held on it below and above, in the named ZIP code or
city when a label there names it, else in the state, saying that none of its labels names the place);
or `no_match`. A miss of the street, house-number or no-match kinds also says that the registry holds commercial, industrial and multifamily parcels only, so a house, or a condominium unit owned by a person, is not in it. The nearest numbers are read only when the street's list in the hosted index (its rows
holding the word pair around the street type) has at most 5,000 rows.

**The hosted index.** The registry Worker reads the pack's address lists: "F:<house number>",
"B:<word> <street type>" and "A:<street type> <word>", "U:<street type>", exact keys under
"E:<key>", and, in packs built from 2026-11-12, "R:<first street word>" for the lots whose label
starts with a house-number range. On a pack built before, a number inside a range finds what it
found before, and every other rule above holds.

**Source snapshots over MCP.** Every registry fact cites a `document_id` (`fl:document:sha256-…`),
the content hash of the source file. With a registry loaded, the MCP `fetch` tool returns that
snapshot's publisher, dataset, source URL, retrieval and as-of dates, licence, AI-use and
redistribution rights, file name and size.

Python builds the database and both languages read it. A cross-language test runs the same 60
calls on a synthetic fixture (`spec/registry/`) and requires identical JSON from Python and
TypeScript.

**Retiring dropped parcels.** Pass `full_roll=True` when a snapshot is a source's complete roll.
Parcels an earlier roll listed that are now missing or out of scope get status
`not_in_latest_snapshot`. Their facts move to history, and they become current again if they
return.

## Known limitations (by design for now; revisit)

- **Owner links.** Automatic links require an exact normalized name match. Everything else goes
  through the review queue, and a fuzzy candidate becomes a link only when a person accepts it;
  there is no auto-accept, whatever the score. The queue has no user interface yet: it is worked
  through the Python API (or SQL on `owner_match_review`), and it has not been run on the real
  Harris and Dallas file.
- **Candidate generator.** The score is a string similarity, not evidence: it cannot tell a
  renamed company from an unrelated one with a similar name, and it never sees mailing addresses
  or officers. Series entities ("… II LLC", "… 2 LLC") fall below the default threshold, so a
  roll that abbreviates one is unmatched rather than mis-queued. An owner name made only of generic
  words ("TEXAS PROPERTIES LLC") never gets candidates. The stop list is English and
  Texas-flavoured.
- **Decisions.** A decision is final: there is no undo, and accepting a candidate rejects the
  owner's other pending candidates. A wrong accept is corrected by a takedown (data policy §4),
  not by the queue.
- **Token index.** `name_tokens` adds roughly two rows per entity (about 500 MB on the 3.3 M
  Texas entities). Tokens shared by more than 5,000 entities are ignored when building a pool, so
  an owner whose only distinctive token is that common ("HOUSTON LLC") gets no candidates.

## Public property pages

With the Worker variable `PROPERTY_PAGES_ENABLED` set to `true`, factlot.com serves one page per
hosted parcel at `/property/<county region>/<parcel id>`, the parts of its URN
(`fl:parcel:us-11001:03760068` is `/property/us-11001/03760068`), listed in sitemaps under
`/sitemaps/properties.xml` (named in robots.txt). A page shows what a `registry_get` call without a
key returns, with value history cut to the current roll year: the situs address as the publisher
wrote it, the parcel ID, county and state, property category codes, land and building area, year
built, building class and neighbourhood code where present, the owner of record when the registry
has one (always an organisation) with its linked registered entity and how many other hosted
parcels that entity holds, and the publisher's current roll values with roll year and as-of date.
An owner written as an estate, heirs, a living, revocable, irrevocable or family trust, or a named
trustee is not shown, nor its entity, because such a name usually carries a person's name.
Every fact cites its source document with the licence, attribution, redistribution and AI use
recorded for the source, plus any notice the source's terms require. Earlier roll years are named
by year and count only, never by value.

A parcel gets a page only when every source behind a fact the page shows records `redistribution`
as `permitted` or `attribution_required`. A source recorded `unknown` (the Texas appraisal
districts) gets none unless its source id is listed in the Worker variable
`PROPERTY_PAGES_EXTRA_SOURCES`. Withheld counties never get a page. A parcel without a situs
address has a page marked `noindex` and is not in the sitemaps. Page views do not count against
the free daily registry lookups; each address may open 120 pages a minute. To have a record
removed or corrected (for example one that names a person), email contact@factlot.com.

## Next

1. **Texas adapters.** Harris, then Dallas, then the Comptroller entity data. Each adapter is
   written against the real file layouts once the domains are allowed.
2. **Parcel lineage.** Record splits and merges, linking old parcels to new ones, once real rolls
   show how each county reports them.
3. **More hosted regions.** The hosted registry at `https://api.factlot.com` is a query-only
   service built from registry files: the registry tools run against it and the files are not
   downloadable from it. It serves <!-- hosted:places -->Maryland (all 24 jurisdictions), the District of Columbia, Juab and Summit counties in Utah, sixteen Texas counties (Harris, Dallas, Travis, Collin, Denton, Williamson, Cameron, Nueces, Galveston, Jefferson, Brazos, Midland, Ector, Grayson, Guadalupe and Kaufman), New York City (all five boroughs), Los Angeles County, San Francisco, the City of Boston, Denver, and Connecticut (statewide, by town)<!-- /hosted:places --> (<!-- hosted:totals -->891,631 parcels in 60 counties<!-- /hosted:totals -->); `registry_coverage` lists
   exactly what is hosted. More regions open as their terms allow. A self-hosted
   `@factlot/server` serves any registry file with `FACTLOT_REGISTRY_DB`.

   Hosted pack notes (`scripts/registry/pack.ts`, Worker `deploy/registry`):
   - **Withheld counties.** `--exclude-county <FIPS>` leaves out every parcel and building of a
     county with what hangs off them (facts, coverage rows, links, crosswalk IDs, index rows), and
     the entities that owned only those parcels. The reason comes from `hostedWithheldCounties()`;
     `registry_coverage` lists the county under `hosted.withheld_counties` and a lookup in it
     says why. Tarrant County (48439) is withheld while the publisher's terms for AI use are
     unclear.
   - **Entities.** A file with more than 50,000 entities (the Texas Comptroller's 3.3 million)
     keeps only the entities that own a hosted parcel; `registry_coverage` gives the served and
     total counts under `hosted.entity_registries`, and a lookup of another entity says that
     hosted entity lookups cover owners of hosted parcels. Smaller registries (DC) are kept whole.
   - **Entity search** reads the posting list of the query's least common 1–3-character gram and
     applies the SQL `LIKE` rule to it, so results and order are those of the SDK; a query made
     only of very common grams (such as "LLC") reads names in label order instead.
   - **Texas candidates.** `registry_tx_equity_candidates` is answered with the SDK's own rule
     (`selectEquityCandidates`, `assembleTxEquity`) from area-sorted comparable lists per roll,
     category code, tax year, neighborhood code and ZIP code, so every parameter value gives the
     SDK's answer, including the county tier.
   - **Dated lookups.** `as_of` answers are stored per date at which a file's data changes, for
     Texas as for the other regions.
   - **Counties loaded in part.** A parcel source that covers less than its county (the City of
     Boston's file, in Suffolk County) is listed in `PARTIAL_COUNTY_SOURCES`
     (`deploy/registry/src/hosted.ts`). `registry_coverage` then gives the county an `area` and
     lists it under `hosted.partial_counties`, and a miss in it says which part is loaded.
   - **Parallel builds.** `--jobs <n>` packs each registry file in its own process (at most `n`
     at once) and writes the same files as one process; the build then takes about as long as
     its slowest file. Texas parcels must be in one file. A pack that would exceed the Workers
     limit of 100,000 static-asset files stops while building:
     `npm run pack:registry -- --jobs 6 --out <pack> md.db dc.db ut.db tx.db ny.db ca.db ma.db co.db ct.db`
   - **Reusing unchanged regions.** `--parts-cache <dir>` keeps each region's finished part in
     `<dir>` with a stamp: the registry file's size and sha256 (hashed once, then remembered by
     size, mtime and inode), the region's name and position, every option that reaches it
     (excluded counties, the suppression list's contents, the entity cut-off, the privacy scan,
     the file limit), the Node and SQLite versions, and a code version hashed over every source
     file the part builder imports (found by following imports from `pack.ts`, with the Python
     privacy scan modules). A later build with the same flag copies a region whose stamp matches
     and whose cached files still hash to what was stored, builds the rest, and writes the same
     pack as a full build. Keep the order of the files and add new regions at the end; the cache
     is written only after a build succeeds:
     `npm run pack:registry -- --jobs 6 --parts-cache <cache> --out <pack> md.db … ct.db`.
     `pack.ts --seed-parts-cache <cache> --from-pack <pack> --kept-parts <dir> --built-at <commit>`
     fills the cache from a finished `--jobs` build whose `<k>.part.jsonl` and `<k>.job.json` were
     kept, and refuses when the code changed since that commit (unless each changed file is named
     with `--allow-changed` after review) or a registry file changed after its job started.
   - **What the site says is hosted** comes from `site/_data/hosted.json`. After building a pack,
     `node --experimental-strip-types --conditions=factlot-source scripts/site/gen-hosted.ts <pack>`
     rewrites it from the pack's manifest, together with the marked spans in the pages, README,
     docs and llms.txt; then run `python3 scripts/registry/gen_coverage_docs.py` and
     `python3 scripts/registry/gen_coverage_map.py` (a newly hosted source also needs its
     `hosted_areas` entry in `docs/registry/coverage-data.json`).
