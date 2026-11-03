# FactLot Registry

The registry is the identity layer behind FactLot IDs. It holds cited public-record facts about
**commercial** property: parcels, the legal entities that own them, and the links between them.
Every fact traces back to a specific downloaded file and record.

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

| Doc                                  | What it covers                                     |
| ------------------------------------ | -------------------------------------------------- |
| [data-policy.md](data-policy.md)     | What we may collect, how, and what we never keep   |
| [texas-sources.md](texas-sources.md) | The Texas pilot sources and the domains each needs |

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
stored. Only organisations are searchable by name.

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

## Owner resolution

Owner-of-record names on a roll rarely match a registration letter for letter: "ACME
PROPERTIES, L.L.C." may be registered as "ACME PROPERTY LLC". Resolution happens in two stages,
and only the first is automatic.

**1. Exact match (automatic).** `link_owners()` links a parcel to an entity when the normalized
owner-of-record name equals exactly one registered entity's normalized legal name. The link is
an `owns` relationship labelled `inferred` with confidence 0.9. Ambiguous names (several entities
with the same normalized name) and unmatched names stay unlinked.

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
`configure_registry()`), the catalog gains six tools. They are served over MCP and REST, and in
both SDKs:

- `registry_get`
- `registry_resolve_parcel`
- `registry_resolve_external`
- `registry_search_address`
- `registry_search_entities`
- `registry_owned_by`

Without a registry, the MCP server does not list them, REST returns 503, and the SDKs return
`RegistryUnavailable`.

Python builds the database and both languages read it. A cross-language test runs the same 18
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
