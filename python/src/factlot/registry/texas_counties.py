"""Texas 254-county commercial-parcel status. Evidence only.

Commercial scope is the registry's existing rule: Comptroller categories B (multifamily),
F1 (commercial), and F2 (industrial), including subclasses such as B1 and F10
(``is_commercial``). Single-family and other residential classes are out of scope.
A statewide geometry file, even one that lists 254 counties, does not certify a
commercial roll for each county.

Parcel counts stay null unless this workspace measured them from a file it was
allowed to read. A private extract is not a public-serving grant and not a
county-wide certificate. Historical pipeline notes are not copied in as if they
were a new audit. Harris Central Appraisal District and the state geographic
download are not treated as eligible re-fetches.
"""

from __future__ import annotations

from .county_names import _TABLE

# Five-digit FIPS → evidence. Counties absent from this map are UNKNOWN.
# reuse: eligible | blocked | unknown
_ASSIGNED: dict[str, dict[str, str | None]] = {
    "48201": {"source_id": "tx-harris-cad", "reuse": "blocked",
              "blocker": "HCAD terms remain unresolved. Do not re-fetch from the public download."},
    "48113": {"source_id": "tx-dallas-cad", "reuse": "eligible",
              "blocker": "59,645 unique commercial accounts (B11, B12, F10, F20). The 2026-10-12 date is the newest stamp on zip members; the HTTP response had no Last-Modified. Retrieved 2026-11-06. Organisation-owner facts 33,528. Not a current-universe certificate."},
    "48439": {"source_id": "tx-tarrant-ad", "reuse": "eligible",
              "blocker": "Reviewed public-record download. On 2026-11-06 the commercial zip returned http_403. Not retried and not bypassed."},
    "48453": {"source_id": "tx-travis-cad", "reuse": "eligible",
              "blocker": "Supplement 3 zip matches the previously reviewed document, run date 2026-10-06: 30,555 unique commercial parcels (B, F1, F2). Organisation-owner facts 18,082; the pre-2026-11-04 rule stores 17,971 against a cited 17,972. Not a newer roll and not a universe certificate."},
    "48085": {"source_id": "tx-collin-cad", "reuse": "eligible",
              "blocker": "Lite database regenerated 2026-11-06: 18,039 unique commercial parcels; the cited load was 18,035. Organisation-owner facts 13,187, of which 21 fail the pre-2026-11-04 rule. Not a universe certificate."},
    "48121": {"source_id": "tx-denton-cad", "reuse": "eligible",
              "blocker": "Retrieved 2026-11-06. The layer stated no export date, so 2026-11-06 is not a source snapshot date. Count query 384,308 parcels; 13,732 B-or-F rows = 286 repeated polygons + 13,304 in-scope unique ids + 142 out of scope. Organisation-owner facts 9,501. Not a universe certificate."},
    "48157": {"source_id": "tx-fortbend-cad", "reuse": "eligible",
              "blocker": "Certified file date 2026-07-07, HTTP Last-Modified 2026-08-21: 440,798 property rows = 53,053 not real + 378,047 out of scope + 9,698 in scope. Current organisation-owner facts 7,417. Reviewed supplement 4, file date and Last-Modified 2026-10-23, sha256 b7b25d401181f672, was applied as a delta: 4,837 rows, 120 commercial modifications, current unique parcels unchanged at 9,698. Not a universe certificate."},
    "48491": {"source_id": "tx-williamson-cad", "reuse": "eligible",
              "blocker": "Mixed files, not one as-of date: improvement Last-Modified 2026-11-01 (14,087 rows, 11,758 in-scope properties) and PropOwner Last-Modified 2026-11-05 (325,956 rows). 60 in-scope properties have no owner row and are kept without an owner. Organisation-owner facts 8,144. Not a universe certificate."},
    "48215": {"source_id": "tx-hidalgo-cad", "reuse": "blocked",
              "blocker": "Rendered downloads page offers a monthly parcel shapefile on Google Drive. drive.google.com robots.txt disallows the published /uc download URL, so the collector stopped. Not bypassed and not ingested. The search-site public-domain sentence does not clear that file. Public redistribution is unknown."},
    "48339": {"source_id": "tx-montgomery-cad", "reuse": "blocked",
              "blocker": "Rendered exports page offers the 2026 certified roll on Google Drive and states no use terms. Fixed-width layout was not opened. drive.google.com robots.txt disallows the published /uc download URL, so the collector stopped. Not bypassed and not ingested. Public redistribution is unknown."},
    "48029": {"source_id": "tx-bexar-ad", "reuse": "blocked",
              "blocker": "No $0 bulk file. The district's request form was retrieved (279,462 bytes). A request is drafted and not sent. Fees are not accepted."},
    "48141": {"source_id": "tx-elpaso-cad", "reuse": "blocked",
              "blocker": "2026-11-06 the acceptable-use page returned http_403. The export host was not requested. Automated collection waits on written permission or a file a person downloads in a normal browser."},
    "48039": {"source_id": "tx-brazoria-cad", "reuse": "reviewed",
              "blocker": "Downloads page links the 2026 certified roll on pCloud and says information herein is public domain, a work in progress, and that linked sites are not endorsed. The documented public-link download then returned HTTP 410: the link was generated for another IP address. Not retried with another session. Not ingested. Public redistribution is unknown."},
    "48167": {"source_id": "tx-galveston-cad", "reuse": "private",
              "blocker": "Private extract of the district's own 2026 certified zip, header 2026-07-20, layout 8.0.34, 9,065 commercial parcels (F1 7,239 including XV 70 and F9 5, B 1,607, F2 219). Situs 8,089, organisation owners 5,251, main-area floor 7,068, year built 6,733. One real-property record contains three line breaks inside a text field. Read on CRLF boundaries it is one 9,714-character row, land code C1, outside commercial scope, and it is not kept. Entity file not read. The exports page states no license. Public redistribution is unknown."},
    "48355": {"source_id": "tx-nueces-cad", "reuse": "private",
              "blocker": "Private extract of the district's own 2026 certified zip, header 2026-10-09, same 9,714-character record as the 8.0.34 layout, 12,093 commercial parcels (F1 9,579, B 1,886, F2 628). Situs 11,878, organisation owners 7,559. Main-area floor on 1,468 and year built on 1,393; other detail types were not summed. Entity file not read. The downloads page states no license. Public redistribution is unknown."},
    "48061": {"source_id": "tx-cameron-cad", "reuse": "private",
              "blocker": "Private extract of the 2026 certified zip, header run date 2026-07-23, HTTP Last-Modified 2026-07-23, PACS record length 9,922. 224,139 property records = 23,279 not real + 186,655 out of scope + 32 duplicate ids + 14,173 in scope (F1 9,368, B 4,637, F2 163, F 4, F1A 1). L1 personal property stays out. The data page's public-domain sentence is not a license to serve the file. Public redistribution is unknown."},
    "48187": {"source_id": "tx-guadalupe-cad", "reuse": "private",
              "blocker": "Private extract of supplement 0, header run date 2026-07-28, HTTP Last-Modified 2026-07-28. 113,486 property records = 12,984 not real + 96,481 out of scope + 4,021 in scope. Codes whose description is only 2002 (B3, F6, F9) were excluded and were not the selected code on any kept row. Supplement 38, header 2026-10-23, is another full-size export (113,612 records, 4,018 in scope under the same rule) and was not used to replace supplement 0. No license on the page. Public redistribution is unknown."},
    "48041": {"source_id": "tx-brazos-cad", "reuse": "private",
              "blocker": "Private extract of the 2026 certified zip whose name includes totals, header run date 2026-07-30, HTTP Last-Modified 2026-08-11. 132,377 property records = 50,565 not real + 74,232 out of scope + 7,580 unique in-scope ids. F3 commercial improvement-only is 5 of those and is deduped on property id. No license on the downloads page. Public redistribution is unknown."},
    "48303": {"source_id": None, "reuse": "unknown",
              "blocker": "No official bulk appraisal roll was verified. A map service without a state category is not a commercial denominator. No records request was sent."},
}


# Measured from a local ingest. commercial_universe stays null: an extract count is not a completeness certificate.
_MEASURED: dict[str, dict[str, str | int | None]] = {
    "48113": {"staged_parcels": 59645, "unique_ids": 59645, "snapshot_as_of": "2026-10-12",
              "as_of_basis": "newest date stamped on zip members; HTTP Last-Modified was absent",
              "org_owner_facts": 33528},
    "48453": {"staged_parcels": 30555, "unique_ids": 30555, "snapshot_as_of": "2026-10-06",
              "as_of_basis": "run date in the export header; HTTP Last-Modified 2026-10-08",
              "org_owner_facts": 18082},
    "48085": {"staged_parcels": 18039, "unique_ids": 18039, "snapshot_as_of": "2026-11-06",
              "as_of_basis": "HTTP Last-Modified of the regenerated database, not a certification date",
              "org_owner_facts": 13187},
    "48121": {"staged_parcels": 13304, "unique_ids": 13304, "snapshot_as_of": None,
              "as_of_basis": "retrieval 2026-11-06 only; the layer stated no export date",
              "org_owner_facts": 9501},
    "48157": {"staged_parcels": 9698, "unique_ids": 9698, "snapshot_as_of": "2026-07-07",
              "as_of_basis": "certified file date; HTTP Last-Modified 2026-08-21. Supplement 4 file date 2026-10-23 did not change the current unique count",
              "org_owner_facts": 7417},
    "48491": {"staged_parcels": 11758, "unique_ids": 11758, "snapshot_as_of": None,
              "as_of_basis": "mixed files: improvement Last-Modified 2026-11-01, PropOwner Last-Modified 2026-11-05",
              "org_owner_facts": 8144},
    "48167": {"staged_parcels": 9065, "unique_ids": 9065, "snapshot_as_of": "2026-07-20",
              "as_of_basis": "run date in the export header; HTTP Last-Modified 2026-08-05",
              "org_owner_facts": 5251},
    "48355": {"staged_parcels": 12093, "unique_ids": 12093, "snapshot_as_of": "2026-10-09",
              "as_of_basis": "run date in the export header; HTTP Last-Modified 2026-10-13",
              "org_owner_facts": 7559},
    "48061": {"staged_parcels": 14173, "unique_ids": 14173, "snapshot_as_of": "2026-07-23",
              "as_of_basis": "run date in the export header; HTTP Last-Modified 2026-07-23",
              "org_owner_facts": 7080},
    "48187": {"staged_parcels": 4021, "unique_ids": 4021, "snapshot_as_of": "2026-07-28",
              "as_of_basis": "supplement 0 header run date; HTTP Last-Modified 2026-07-28. Supplement 38 was not applied",
              "org_owner_facts": 2428},
    "48041": {"staged_parcels": 7580, "unique_ids": 7580, "snapshot_as_of": "2026-07-30",
              "as_of_basis": "run date in the export header; HTTP Last-Modified 2026-08-11",
              "org_owner_facts": 5078},
}


def texas_fips() -> list[tuple[str, str]]:
    """All Texas counties in the Census table as (five-digit FIPS, name), in FIPS order."""
    return sorted((fips, name) for fips, name in _TABLE.items() if fips.startswith("48"))


def county_row(fips: str, name: str, *, staged_parcels: int | None = None, snapshot_as_of: str | None = None,
               unique_ids: int | None = None) -> dict:
    """One county. Unknown parcel totals stay null."""
    measured = _MEASURED.get(fips, {})
    assigned = _ASSIGNED.get(fips)
    if assigned is None:
        return {
            "fips": fips, "name": name, "source_id": None, "reuse": "unknown",
            "commercial_universe": None, "staged_parcels": None, "unique_ids": None,
            "snapshot_as_of": None, "as_of_basis": None, "org_owner_facts": None,
            "blocker": "No reviewed zero-cost bulk appraisal roll for this county.",
        }
    dated = snapshot_as_of if snapshot_as_of is not None else measured.get("snapshot_as_of")
    return {
        "fips": fips, "name": name, "source_id": assigned["source_id"], "reuse": assigned["reuse"],
        "commercial_universe": None,
        "staged_parcels": staged_parcels if staged_parcels is not None else measured.get("staged_parcels"),
        "unique_ids": unique_ids if unique_ids is not None else measured.get("unique_ids"),
        "snapshot_as_of": dated,
        "as_of_basis": measured.get("as_of_basis"),
        "org_owner_facts": measured.get("org_owner_facts"),
        "blocker": assigned["blocker"],
    }


def matrix() -> list[dict]:
    return [county_row(fips, name) for fips, name in texas_fips()]
