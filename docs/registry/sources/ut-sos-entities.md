# ut-sos-entities: Utah Division of Corporations and Commercial Code business entity registry (access review; no bulk file found)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/ut/ut-sos-entities.json`](../../../registry/sources/ut/ut-sos-entities.json). **No bulk file found; nothing downloaded; no
adapter.** Tier 2, west region ([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: Utah Department of Commerce, Division of Corporations and Commercial Code. The registry is searched through the Division's
  Business Entity Search (interactive).
- Public Disclosure page (read 2026-11-03): <https://commerce.utah.gov/?p=32972>: "Information about a business that registers with the Division is
  public information"; the registration records "are classified as public records pursuant to GRAMA"; "Historical business information is still public
  information". It says nothing about bulk data, lists or downloads; requests for records are referred to the Department of Commerce's Access to
  Government Records page.
- Open data: the old state portal address `opendata.utah.gov` answers "Domain Decommissioned"; the current state open data catalog was not found
  to list the registry. A Business Entity List builder (search-result lists) exists per search-result summaries; it is an interactive application and
  was not examined or automated.

## Terms, license, robots

Public records under GRAMA (Utah Code 63G-2); no license, redistribution or AI-use statement; no bulk product found. robots.txt of
`commerce.utah.gov` was not examined because no file was sought there.

## What the file contains

Nothing to read: no file.

## Gates

Records request. A person must ask the Division (or file a GRAMA request under Utah Code 63G-2 through the Department of Commerce's records page) for a
bulk extract of the entity registry (entity number, name, type, status, formation date, principal address), and ask whether a fee or a use restriction
applies. Third-party resellers of the register exist; they are not the publisher and are not used.

## Real run

None.

## Known gaps

Without this registry, Utah parcel owners cannot be linked to Utah entities; the Utah LIR source ([ut-ugrc-lir.md](ut-ugrc-lir.md)) has no owner names
anyway, so the dependency is a later problem. Colorado, Oregon and Hawaii entity reviews: [co-sos-entities.md](co-sos-entities.md),
[or-sos-entities.md](or-sos-entities.md), [hi-breg-entities.md](hi-breg-entities.md).
