"""Virginia State Corporation Commission, Clerk's Information System: business entity data
(the weekly "Business Entity Data Sales" zip) → ``EntityRecord``.

NOT YET CONFIRMED ON A REAL DOWNLOAD. The SCC's bulk file could not be fetched on 2026-11-02:
``cis.scc.virginia.gov`` did not answer the collector, the download sits behind the site's
cookie-consent click-through, and the SCC's purchase page describes paid extractions (see
``docs/registry/sources/va-scc-entities.md``). The layout below is transcribed from the field maps
of the open-source openva/crump parser (``table_maps/*.yaml``), which document the upstream CSV
headers, and must be checked against the real file before this adapter's output is trusted.

Expected layout: a zip of eleven CSVs. The six *entity* files share a 28-column core:

    EntityID, Name, Status, StatusReason, Status Date, Duration, IncorpDate, IncorpState,
    IndustryCode, Street1, Street2, City, State, Zip, PrinOffEffDate, RA-Name, RA-Street1,
    RA-Street2, RA-City, RA-State, RA-Zip, RA-EffDate, RA-Status, RA-Loc, StockInd, TotalShares,
    MergerInd, AssessInd

- ``Corp.csv`` (stock and nonstock corporations; adds ``Stock1``), ``LLC.csv`` (adds ``Is Series
  LLC``, ``Is Protected Series``, ``Series LLC ID``), ``LP.csv``, ``GP.csv``, ``BT.csv`` (business
  trusts), ``PSA.csv`` (professional stock associations).
- ``Amendment.csv``, ``Merger.csv``, ``Officer.csv``, ``NameHistory.csv``, ``ReservedName.csv`` are
  not read. ``Officer.csv`` names natural persons and is never opened (data policy §3).
- Values still carry fixed-width padding (stripped here); ``Status`` and ``StatusReason`` are
  spelled out by the publisher; ``State`` and ``IncorpState`` are full state names.

``EntityID`` is the SCC entity id and becomes ``registry_number`` under jurisdiction ``us-va``.

Usage: ``python -m factlot.registry.adapters.va_scc_entities current.zip registry.db --as-of 2026-11-02``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import EntityRecord, IngestStats, Registry, Source

JURISDICTION = "us-va"

SOURCE = Source(
    source_id="va-scc-entities",
    publisher="Virginia State Corporation Commission, Office of the Clerk",
    title="Business Entity Data Sales file (Clerk's Information System weekly export)",
    url="https://cis.scc.virginia.gov/",
    state_fips="51",
    license="Not established: terms could not be read (host unreachable to the collector; www.scc.virginia.gov "
            "robots.txt disallows all generic agents; the SCC purchase page describes paid extractions)",
    ai_use="unknown",
    redistribution="unknown",
    attribution="Virginia State Corporation Commission, Office of the Clerk",
    terms_reviewed="2026-11-02",
)

# The entity files, by member name (case-insensitive). Everything else in the zip is ignored.
ENTITY_FILES = {"corp.csv": "corporation", "llc.csv": "llc", "lp.csv": "lp", "gp.csv": "gp",
                "bt.csv": "business_trust", "psa.csv": "professional_stock_association"}

# Full state names as the SCC spells them → USPS codes. Two-letter codes pass through unchanged.
_STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA",
    "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
    "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI",
    "MINNESOTA": "MN", "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX",
    "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI", "WYOMING": "WY", "PUERTO RICO": "PR", "GUAM": "GU", "VIRGIN ISLANDS": "VI",
    "AMERICAN SAMOA": "AS", "NORTHERN MARIANA ISLANDS": "MP",
}


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def state_code(name: str | None) -> str | None:
    """``Virginia`` → ``VA``; a two-letter code passes through; foreign countries and blanks → ``None``."""
    n = _squeeze(name).upper()
    if not n:
        return None
    if len(n) == 2 and n.isalpha():
        return n
    return _STATES.get(n)


def _status(s: str | None) -> str | None:
    """The publisher's spelled-out status (``Active``, ``Inactive``) as a snake_case token."""
    n = re.sub(r"[^a-z0-9]+", "_", _squeeze(s).lower()).strip("_")
    return n or None


def _mailing_address(r: dict[str, str]) -> str | None:
    street = ", ".join(x for x in (_squeeze(r.get("Street1")), _squeeze(r.get("Street2"))) if x)
    city = _squeeze(r.get("City"))
    state = state_code(r.get("State")) or _squeeze(r.get("State"))
    state_zip = " ".join(x for x in (state, _squeeze(r.get("Zip"))) if x)
    return ", ".join(x for x in (street, city, state_zip) if x) or None


def _members(path: str | Path) -> Iterator[tuple[str, Iterator[dict[str, str]]]]:
    """``(member name, rows)`` for each entity file in the zip, or in an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for f in sorted(p.iterdir()):
            if f.name.lower() in ENTITY_FILES:
                with open(f, newline="", encoding="utf-8-sig", errors="replace") as fh:
                    yield f.name, csv.DictReader(fh)
        return
    with zipfile.ZipFile(p) as zf:
        for name in zf.namelist():
            if Path(name).name.lower() in ENTITY_FILES:
                with zf.open(name) as raw:
                    yield name, csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline=""))


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per row of the six entity files.

    A row without an ``EntityID`` or a name is yielded with the field blank so the registry counts
    it as skipped rather than silently dropped.
    """
    for member, rows in _members(path):
        for raw in rows:
            r = {_squeeze(k): v for k, v in raw.items() if k is not None}
            entity_id = _squeeze(r.get("EntityID"))
            yield EntityRecord(
                legal_name=_squeeze(r.get("Name")),
                registry_jurisdiction=JURISDICTION,
                registry_number=entity_id or None,
                taxpayer_number=None,
                state_of_formation=state_code(r.get("IncorpState")),
                mailing_address=_mailing_address(r),
                status=_status(r.get("Status")),
                locator=f"{Path(member).name} EntityID {entity_id}" if entity_id else Path(member).name,
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          link: bool = True) -> tuple[IngestStats, dict[str, int]]:
    """Ingest one archived zip into a registry file, then (by default) link parcel owners to entities."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        stats = reg.ingest_entities(read_entities(snapshot_path), snap)
        links = reg.link_owners() if link else {}
        return stats, links
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.va_scc_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the Business Entity Data Sales zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the file is refreshed weekly)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
