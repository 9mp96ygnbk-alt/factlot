# FactLot ID specification, v0.2 (draft)

FactLot IDs are canonical identifiers for commercial real estate things. The goal
is to be the **default join key** between agents, vendors, and systems of record.
The reference implementation is [`@factlot/id`](../packages/id).

## Principles

1. **Deterministic where a natural key exists.** If the world already has an
   authoritative key, such as a county APN, a state entity file number, or a
   document's bytes, the FactLot ID is a pure function of it. Any party can compute
   it offline, and two parties always agree.
2. **Registry-minted where none exists.** Leases and loans have no universal key.
   The FactLot registry (or a self-hosted registry) mints opaque, time-sortable
   tokens for them and records `same_as` crosswalks to other systems, such as
   CoStar IDs, Yardi property codes, or NYC BBL/BIN. Buildings have a deterministic
   ID from their street address (v0.2, [below](#building-ids)); a minted building
   token remains valid for a building with no street address.
3. **Never reused, never reassigned.** If a parcel is split or merged, new parcel IDs
   are created and the lineage is recorded as relationships. Old IDs are not
   changed or recycled.
4. **Readable and compact forms.** Every ID has a canonical URN and a short form
   derived from it.

## Canonical URN forms

URNs are lowercase ASCII.

| Kind     | Form                                     | Example                                                         | Natural key                                 |
| -------- | ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| parcel   | `fl:parcel:us-<SS><CCC>:<apn>`           | `fl:parcel:us-06037:5432001012`                                 | State + county FIPS, normalized APN         |
| entity   | `fl:entity:<jurisdiction>:<number>`      | `fl:entity:us-de:7654321`, `fl:entity:lei:5493001kjtiigc8y1r12` | Registry jurisdiction + file number, or LEI |
| document | `fl:document:sha256-<64 hex>`            | `fl:document:sha256-9f86…`                                      | SHA-256 of exact bytes                      |
| building | `fl:building:us-<SSCCC>:<zip5>:<street>` | `fl:building:us-11001:20002:208-massachusetts-ave-ne`           | State + county FIPS, ZIP code, street line  |
| building | `fl:building:<26-char token>`            | `fl:building:01jbx3k8q2…`                                       | Minted (no street address)                  |
| space    | `fl:space:<building>:<suite>`            | `fl:space:us-11001:20002:208-massachusetts-ave-ne:400`          | Building + normalized suite                 |
| lease    | `fl:lease:<26-char token>`               | Minted                                                          | Minted                                      |
| loan     | `fl:loan:<26-char token>`                | Minted                                                          | Minted                                      |

### Normalization

- **APN (default):** lowercase, then remove every character that is not `a-z` or `0-9`.
  Counties where separators carry meaning must supply a county rule. The registry
  publishes these county rules, and the library accepts a `normalize` override.
  County rules are versioned. Changing a rule never changes an existing ID; it only
  affects how new input is mapped.
- **Entity jurisdiction:** lowercase ISO 3166-2 style (`us-de`, `us-ny`), or `lei`.
- **Entity number:** lowercase alphanumerics only.
- **Suite (suite rule 2, v0.2):** whole floors normalize to `f<n>`, so "3rd Floor",
  "Third Floor", "Floor 3", "FL 3" and "3rd Flr" all become `f3` (ordinal words "first"
  to "twentieth"). Otherwise a leading designator (`suite`, `ste`, `unit`, `apartment`,
  `apt`, `space`, `spc`, `room`, `rm`, `no`, `#`) is removed and the value is lowercased;
  a run of separators between two digits becomes one hyphen, and every other
  character outside `a-z0-9` is dropped. So "Suite 100", "Ste 100", "STE. 100" and
  "#100" are `100`; "Suite 1-20" is `1-20` and "Suite 120" is `120` (two suites, two
  IDs); "Suite 1200-A" is `1200a`; "PH-2" is `ph2`.
  - **Leading zeros are kept.** "0100" and "100" are different suites: some buildings
    number lower-level suites with a leading zero, and an ID must never merge two
    suites. A system that pads suite numbers should strip its own padding first.
  - **Space ID URN:** `fl:space:<building>:<suite>`, where `<building>` is everything
    after `fl:building:` in the building URN, and `<suite>` matches
    `[a-z0-9]+(-[a-z0-9]+)*`.

### Building IDs

A building's ID is a pure function of its street address, so a lender, a broker and a
property manager who each hold "208 Massachusetts Ave NE, Washington, DC 20002, Unit 4"
compute the same ID offline, and every condominium unit, suite and floor at that
address shares it:

```
fl:building:us-<SS><CCC>:<zip5>:<street key>
fl:building:us-11001:20002:208-massachusetts-ave-ne
```

Inputs: state and county FIPS, the 5-digit ZIP code (ZIP+4 is accepted; only the first
five digits count), and the street line. The street key is made like this:

1. Anything from the first comma on is ignored (city, state, ZIP), so a full address
   with commas is accepted.
2. Upper case. `#` is its own token. A unit designator (`#`, `STE`, `SUITE`, `UNIT`,
   `APT`, `APARTMENT`, `ROOM`, `SPC`) is removed with the one token after it; a floor
   (`FL`, `FLR`, `FLOOR` before a one- or two-digit number, or after an ordinal such as
   `3RD`) is removed with its number. `RM` is not a unit designator (Texas
   Ranch-to-Market roads are written "RM 620").
3. Every character outside `A-Z0-9` becomes a space.
4. Directionals become one or two letters wherever they stand: `NORTH`→`N` … `WEST`→`W`,
   `NORTHEAST`→`NE` … `SOUTHWEST`→`SW`, and `N`/`S` followed by `E`/`W` merge (`N W`, from
   "N.W." or "North West", is `NW`).
5. Street words become their short form: `STREET` `ST`, `AVENUE`/`AV` `AVE`, `ROAD` `RD`,
   `DRIVE` `DR`, `BOULEVARD` `BLVD`, `LANE` `LN`, `PARKWAY` `PKWY`, `HIGHWAY` `HWY`,
   `FREEWAY` `FWY`, `EXPRESSWAY` `EXPY`, `COURT` `CT`, `PLACE` `PL`, `CIRCLE` `CIR`,
   `TRAIL` `TRL`, `TERRACE` `TER`, `SQUARE` `SQ`, `PLAZA` `PLZ`, `ALLEY` `ALY`,
   `BUILDING` `BLDG`, and ordinal words `FIRST`…`TWENTIETH` → `1ST`…`20TH`.
6. The words are lowercased and joined with hyphens. The first word must start with a
   digit (the house number) and at least one word must follow. A hyphenated house number
   keeps its parts ("37-10 30th St" is `37-10-30th-st`).
7. A street line that still ends in a two-letter word and a ZIP code ("… Washington DC
   20002" with no comma) is rejected: pass the street line alone or put a comma before
   the city.

These tables are part of the ID rule. Changing them changes IDs, so they change only
with a new spec version, and the conformance vectors pin them.

**Why the street address.** It is what every party has, it needs no registry to
compute, and it is the one key shared by the condominium units of a building, which
rolls list as separate parcels with no record above them. A parcel-based key fails for
condominiums (no unit owner knows the condominium's own parcel, where one exists) and
for buildings on several parcels. The ZIP code is part of the key because one county
can hold the same street address in two towns. Known limits: a corner building with two
addresses has two IDs, and a building renumbered by the city gets a new one (a registry can
record `same_as` links between them; the FactLot Registry does not yet); two buildings at one address ("Building A",
"Building B" without a separate street number) share an ID unless the street line names
the building (`BLDG` is kept in the key); a building demolished and replaced at the same
address keeps the address's ID. A minted `fl:building:<token>` remains available for
buildings without a street address and for the cases where the address ID is wrong.

**Registry roll-up.** The FactLot Registry groups parcels whose current situs addresses
give the same building ID (two or more parcels) under a building record, and labels how
each parcel was placed: a condominium lot in the source's own numbering (District of
Columbia SSL lots 2000-6999; New York City BBL unit lots 1001-6999 and billing lots
7501-7599) or the shared address alone. See [the registry](registry/README.md#buildings).

### Minted tokens

A registry may mint a lease token _reproducibly_ instead of randomly when the lease has a natural key in a public
file: ten zeros in place of the timestamp, then 16 characters of the SHA-256 of a namespaced key (the GSA adapter
uses `gsa-lease-number:<lease number>`, the SEC adapter `sec-lease-exhibit:<accession>:<file>`), so registries built
from the same file agree. The token is still a valid `fl:lease:` token, and the crosswalk to the natural key is
recorded. The random ULID layout below remains what `mint` produces.

Minted tokens use the ULID layout in Crockford base32 (lowercase): 10 characters
of millisecond timestamp followed by 16 characters of randomness. Tokens sort
lexicographically by creation time.

## Short form

`<prefix>_<24 chars>`. The 24 characters are the first 120 bits of
`SHA-256(urn)`, encoded in lowercase Crockford base32 (`0-9a-hjkmnp-tv-z`).

| Kind   | parcel | entity | building | space | lease | document | loan  |
| ------ | ------ | ------ | -------- | ----- | ----- | -------- | ----- |
| Prefix | `flp`  | `fle`  | `flb`    | `fls` | `fll` | `fld`    | `fln` |

Anyone can compute a short ID from its URN. Going from a short ID back to the URN
requires a registry lookup.

## Versions

| Version | Changes                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2     | Deterministic building IDs from the street address (`fl:building:us-<SSCCC>:<zip5>:<street>`); spaces within them. Suite rule 2: a separator between digits is kept ("1-20" was `120`, now `1-20`), ordinal floor words and "Flr" are floors ("Third Floor" was `thirdfloor`, now `f3`), and `apt`/`apartment` are designators ("Apt 4B" was `apt4b`, now `4b`). Parcel, entity and document IDs are unchanged. |
| 0.1     | First draft.                                                                                                                                                                                                                                                                                                                                                                                                    |

**Earlier IDs stay valid.** Every v0.1 URN still parses (`id_parse`), including space IDs
made under suite rule 1; only the inputs listed for 0.2 map to a different space ID
now. `normalizeSuiteV1` / `normalize_suite_v1` reproduce suite rule 1, so a system that
stored v0.1 space IDs can recompute them and record the old and new IDs as `same_as`.

## Open questions

- Non-US parcels: which national cadastral keys to use, and in what namespace form.
- Buildings on several parcels and campuses at one address: the address ID covers the
  first; the second needs either a building designator in the street line or a minted ID
  with `located_on` relationships.
- Whether to incorporate existing open building IDs, such as the US DOE UBID (Unique
  Building Identifier, from the footprint), as `same_as` crosswalks.
- County APN rule catalogue: format, governance, and test vectors.
