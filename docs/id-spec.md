# FactLot ID specification, v0.1 (draft)

FactLot IDs are canonical identifiers for commercial real estate things. The goal
is to be the **default join key** between agents, vendors, and systems of record.
The reference implementation is [`@factlot/id`](../packages/id).

## Principles

1. **Deterministic where a natural key exists.** If the world already has an
   authoritative key, such as a county APN, a state entity file number, or a
   document's bytes, the FactLot ID is a pure function of it. Any party can compute
   it offline, and two parties always agree.
2. **Registry-minted where none exists.** Buildings, leases, and loans have no
   universal key. The FactLot registry (or a self-hosted registry) mints opaque,
   time-sortable tokens for them and records `same_as` crosswalks to other systems,
   such as CoStar IDs, Yardi property codes, or NYC BBL/BIN.
3. **Never reused, never reassigned.** If a parcel is split or merged, new parcel IDs
   are created and the lineage is recorded as relationships. Old IDs are not
   changed or recycled.
4. **Readable and compact forms.** Every ID has a canonical URN and a short form
   derived from it.

## Canonical URN forms

URNs are lowercase ASCII.

| Kind     | Form                                | Example                                                         | Natural key                                 |
| -------- | ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| parcel   | `fl:parcel:us-<SS><CCC>:<apn>`      | `fl:parcel:us-06037:5432001012`                                 | State + county FIPS, normalized APN         |
| entity   | `fl:entity:<jurisdiction>:<number>` | `fl:entity:us-de:7654321`, `fl:entity:lei:5493001kjtiigc8y1r12` | Registry jurisdiction + file number, or LEI |
| document | `fl:document:sha256-<64 hex>`       | `fl:document:sha256-9f86…`                                      | SHA-256 of exact bytes                      |
| building | `fl:building:<26-char token>`       | `fl:building:01jbx3k8q2…`                                       | Minted                                      |
| space    | `fl:space:<building token>:<suite>` | `fl:space:01jbx3k8q2…:400`                                      | Building + normalized suite                 |
| lease    | `fl:lease:<26-char token>`          | Minted                                                          | Minted                                      |
| loan     | `fl:loan:<26-char token>`           | Minted                                                          | Minted                                      |

### Normalization

- **APN (default):** lowercase, then remove every character that is not `a-z` or `0-9`.
  Counties where separators carry meaning must supply a county rule. The registry
  publishes these county rules, and the library accepts a `normalize` override.
  County rules are versioned. Changing a rule never changes an existing ID; it only
  affects how new input is mapped.
- **Entity jurisdiction:** lowercase ISO 3166-2 style (`us-de`, `us-ny`), or `lei`.
- **Entity number:** lowercase alphanumerics only.
- **Suite:** a leading designator (`suite`, `ste`, `unit`, `space`, `spc`, `room`,
  `rm`, `no`, `#`) is removed, then the value is reduced to lowercase alphanumerics.
  Whole floors normalize to `f<n>`, so "3rd Floor", "Floor 3", and "FL 3" all become `f3`.

### Minted tokens

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

## Open questions for v0.2

- Non-US parcels: which national cadastral keys to use, and in what namespace form.
- Building identity across parcels, for example a campus on several parcels or a
  building on a ground lease. Is a building a registry-minted ID with `located_on`
  relationships to parcels, as v0.1 assumes, or something else?
- Whether to incorporate existing open building IDs, such as the US DOE
  UBID (Unique Building Identifier), as `same_as` crosswalks or as the natural key.
- County APN rule catalogue: format, governance, and test vectors.
