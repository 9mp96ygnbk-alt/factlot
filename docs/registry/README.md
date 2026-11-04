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
For those, fuzzy matching with a human review queue (backlog C2) is now built and tested on
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
initials ("L P") do not count. Only organisations are searchable by name.

**Provenance and rights.** Each fact carries:

- its method: `public_record` for facts read from a file, `inferred` with a confidence for
  ownership links;
- the snapshot document ID, plus a record locator such as `account 0420150000012`;
- the source's license, AI-use status, redistribution status, and attribution.

Every fact passes `fact_validate`.

**Time.** Re-ingesting the same snapshot changes nothing. A fact is _current_ only if the latest
snapshot from its source that covered the parcel restated it; otherwise it becomes history. This
is what retires a sold parcel's old owner. Example: an LLC sells to an individual. The new roll
lists a person, whose name we never store, so the LLC's ownership fact and link become history
instead of lingering as current.

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
`registry_owned_by` add a `coverage` object to an empty result, and `registry_get` adds it to its
`NotFound` error. It says whether the county (or entity registry, or crosswalk system) asked about
is loaded, and its `message` says so in words, for example "county 04021 (AZ) is not loaded in
this registry; loaded: county 11001 (DC, 18077 parcels)". A malformed URN is a `FactLotIdError`,
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
building count as one building. On the published DC sample the roll-up makes 396 buildings from
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
and the NYC and DC sales files. `Registry.ingest_parcel_facts` writes their facts to parcels that exist (a record
for an unknown parcel is counted and dropped, so the roll alone decides what is in scope), cites the source file and
record, and covers the parcel with a marker (`coverage.present = 2`) that makes its facts follow the usual currency
rule but does not keep a parcel current that the roll has retired. A derived fact (a zoning district found by
overlay) is `inferred` with a confidence. `transaction.sale` is the one many-valued predicate: a parcel holds one
fact per sale and readers return them all, newest first. Source review records:
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
reg.get(reg.resolve_external("tx-harris-cad-account", "0420150000012"))
```

## Agent tools

When a registry file is configured (`FACTLOT_REGISTRY_DB`, or `configureRegistry()` /
`configure_registry()`), the catalog gains seven tools. They are served over MCP and REST, and in
both SDKs:

- `registry_get`
- `registry_resolve_parcel`
- `registry_resolve_external`
- `registry_search_address`
- `registry_search_entities`
- `registry_owned_by`
- `registry_coverage`

Without a registry, the MCP server does not list them, REST returns 503, and the SDKs return
`RegistryUnavailable`.

Python builds the database and both languages read it. A cross-language test runs the same 40
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

## Next

1. **Texas adapters.** Harris, then Dallas, then the Comptroller entity data. Each adapter is
   written against the real file layouts once the domains are allowed.
2. **Parcel lineage.** Record splits and merges, linking old parcels to new ones, once real rolls
   show how each county reports them.
3. **Hosted registry.** Serve the built database from `@factlot/server` with
   `FACTLOT_REGISTRY_DB`.
