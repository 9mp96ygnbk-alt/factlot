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
(`tx_comptroller`) turns the franchise-tax file into entities and links owners of record to them.
The source review is in [texas-sources.md](texas-sources.md).

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
                 └─ link_owners(): owner of record → registered entity (exact, unambiguous only)
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

**Owner resolution.** A parcel is linked to an entity only when the normalized owner-of-record
name matches exactly one registered entity. Such links are labelled `inferred` with confidence
0.9. Ambiguous and unmatched names stay unlinked.

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

## Next

1. **Texas adapters.** Harris, then Dallas, then the Comptroller entity data. Each adapter is
   written against the real file layouts once the domains are allowed.
2. **Parcel lineage.** Record splits and merges, linking old parcels to new ones, once real rolls
   show how each county reports them.
3. **Hosted registry.** Serve the built database from `@factlot/server` with
   `FACTLOT_REGISTRY_DB`.
