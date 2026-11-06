"""Texas 254-county commercial-parcel status. Evidence only.

Commercial scope is the registry's existing rule: Comptroller categories B (multifamily),
F1 (commercial), and F2 (industrial), including subclasses such as B1 and F10
(``is_commercial``). Single-family and other residential classes are out of scope.
A statewide geometry file, even one that lists 254 counties, does not certify a
commercial roll for each county.

Parcel counts stay null unless this workspace has measured them from a file whose
reuse was already recorded as permitted. Historical pipeline notes are not copied
in as if they were a new audit. Harris Central Appraisal District and the state
geographic download are not treated as eligible re-fetches.
"""

from __future__ import annotations

from .county_names import _TABLE

# Five-digit FIPS → evidence. Counties absent from this map are UNKNOWN.
# reuse: eligible | blocked | unknown
_ASSIGNED: dict[str, dict[str, str | None]] = {
    "48201": {"source_id": "tx-harris-cad", "reuse": "blocked",
              "blocker": "HCAD terms remain unresolved. Do not re-fetch from the public download."},
    "48113": {"source_id": "tx-dallas-cad", "reuse": "eligible",
              "blocker": "Reviewed as a public-record bulk export. Not re-audited in this workspace."},
    "48439": {"source_id": "tx-tarrant-ad", "reuse": "eligible",
              "blocker": "Reviewed public-record download. Commercial zip is a separate file from the full roll."},
    "48453": {"source_id": "tx-travis-cad", "reuse": "eligible",
              "blocker": "Reviewed public-record export. Not re-audited in this workspace."},
    "48085": {"source_id": "tx-collin-cad", "reuse": "eligible",
              "blocker": "Reviewed public-record database. Not re-audited in this workspace."},
    "48121": {"source_id": "tx-denton-cad", "reuse": "eligible",
              "blocker": "County GIS query reviewed as a public record. The district's own extract page was not readable."},
    "48157": {"source_id": "tx-fortbend-cad", "reuse": "eligible",
              "blocker": "Reviewed public-record export. Confidential owners are redacted by the publisher."},
    "48491": {"source_id": "tx-williamson-cad", "reuse": "eligible",
              "blocker": "Reviewed public-record portal. Platform terms were not read as text."},
    "48141": {"source_id": "tx-elpaso-cad", "reuse": "blocked",
              "blocker": "Review did not verify a bulk file that may be redistributed."},
    "48215": {"source_id": "tx-hidalgo-cad", "reuse": "blocked",
              "blocker": "No confirmed bulk file. A records request would need separate approval."},
    "48339": {"source_id": "tx-montgomery-cad", "reuse": "blocked",
              "blocker": "No confirmed bulk file. A records request would need separate approval."},
    "48029": {"source_id": "tx-bexar-ad", "reuse": "blocked",
              "blocker": "No bulk appraisal-roll download was found. A records request would need separate approval."},
}


def texas_fips() -> list[tuple[str, str]]:
    """All Texas counties in the Census table as (five-digit FIPS, name), in FIPS order."""
    return sorted((fips, name) for fips, name in _TABLE.items() if fips.startswith("48"))


def county_row(fips: str, name: str, *, staged_parcels: int | None = None, snapshot_as_of: str | None = None,
               unique_ids: int | None = None) -> dict:
    """One county. Unknown parcel totals stay null."""
    assigned = _ASSIGNED.get(fips)
    if assigned is None:
        return {
            "fips": fips, "name": name, "source_id": None, "reuse": "unknown",
            "commercial_universe": None, "staged_parcels": None, "unique_ids": None,
            "snapshot_as_of": None,
            "blocker": "No reviewed zero-cost bulk appraisal roll for this county.",
        }
    return {
        "fips": fips, "name": name, "source_id": assigned["source_id"], "reuse": assigned["reuse"],
        "commercial_universe": None, "staged_parcels": staged_parcels, "unique_ids": unique_ids,
        "snapshot_as_of": snapshot_as_of, "blocker": assigned["blocker"],
    }


def matrix() -> list[dict]:
    return [county_row(fips, name) for fips, name in texas_fips()]
