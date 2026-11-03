"""New York Department of State "Active Corporations: Beginning 1800" (Open NY, data.ny.gov,
dataset n9v6-gdp6) → ``EntityRecord``.

Layout (confirmed 2026-11-02 against the CSV export and the dataset's column list on the portal):
one CSV row per active entity on file with the Division of Corporations, with the columns

    DOS ID, Current Entity Name, Initial DOS Filing Date, County, Jurisdiction, Entity Type,
    DOS Process Name, DOS Process Address 1, DOS Process Address 2, DOS Process City,
    DOS Process State, DOS Process Zip, CEO Name, CEO Address 1, CEO Address 2, CEO City,
    CEO State, CEO Zip, Registered Agent Name, Registered Agent Address 1,
    Registered Agent Address 2, Registered Agent City, Registered Agent State,
    Registered Agent Zip, Location Name, Location Address 1, Location Address 2, Location City,
    Location State, Location Zip

(the SODA API spells them ``dos_id``, ``current_entity_name``, ``chairman_name``, ...; both
spellings are accepted). ``DOS ID`` is the Division's entity number and becomes the registry
number. ``Jurisdiction`` is the state or country of formation as the publisher spells it
("New York", "Delaware", "ENGLAND", ...); US states, DC, and territories are mapped to USPS codes,
anything else is left unknown. The dataset holds active entities only (publisher's note: "This
data does not include information on inactive corporations"), so every row's status is ``active``.
The address kept is the service-of-process address (the publisher warns it "may not reflect the
physical location of the corporation"); when it is blank the registered agent's address is used.
CEO and registered-agent names are not read: they are usually natural persons.

The publisher's ``Entity Type`` (e.g. "DOMESTIC LIMITED LIABILITY COMPANY") has no slot in
``EntityRecord`` and is not stored; ``read_rows`` exposes it for callers that need it.

Usage: ``python -m factlot.registry.adapters.ny_dos_entities export.csv registry.db --as-of 2026-10-31``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import EntityRecord, IngestStats, Registry, Source

JURISDICTION = "us-ny"

SOURCE = Source(
    source_id="ny-dos-entities",
    publisher="New York State Department of State, Division of Corporations",
    title="Active Corporations: Beginning 1800 (Open NY dataset n9v6-gdp6)",
    url="https://data.ny.gov/Economic-Development/Active-Corporations-Beginning-1800/n9v6-gdp6",
    state_fips="36",
    license="OPEN-NY Terms of Use (non-exclusive, revocable licence; no attribution, share-alike or pre-approval requirement; lawful use only)",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="permitted",
    attribution="New York State Department of State",
    terms_reviewed="2026-11-02",
)

# Publisher's Jurisdiction values that are US states, DC, or territories → USPS code. Canadian
# provinces, UK nations, and other countries are left as unknown state of formation.
US_JURISDICTIONS = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA",
    "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE", "DISTRICT OF COLUMBIA": "DC",
    "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL",
    "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA",
    "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
    "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR",
    "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA",
    "WASHINGTON": "WA", "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
    "PUERTO RICO": "PR", "U.S. VIRGIN ISLANDS": "VI", "GUAM": "GU", "AMERICAN SAMOA": "AS",
    "NORTHERN MARIANA ISLANDS": "MP",
}

# Column aliases: normalised portal display name → SODA field name used internally.
_ALIASES = {
    "ceo_name": "chairman_name", "ceo_address_1": "chairman_address_1", "ceo_address_2": "chairman_address_2",
    "ceo_city": "chairman_city", "ceo_state": "chairman_state", "ceo_zip": "chairman_zip",
}


def _key(header: str) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")
    return _ALIASES.get(k, k)


def state_of_formation(jurisdiction: str | None) -> str | None:
    """USPS code for a US jurisdiction name as the publisher spells it; ``None`` otherwise."""
    if not jurisdiction:
        return None
    return US_JURISDICTIONS.get(re.sub(r"\s+", " ", jurisdiction.strip().upper()))


def _address(r: dict[str, str], prefix: str) -> str | None:
    line1 = r.get(f"{prefix}_address_1", "").strip()
    line2 = r.get(f"{prefix}_address_2", "").strip()
    city = r.get(f"{prefix}_city", "").strip()
    state_zip = " ".join(x for x in (r.get(f"{prefix}_state", "").strip(), r.get(f"{prefix}_zip", "").strip()) if x)
    return ", ".join(x for x in (line1, line2, city, state_zip) if x) or None


def read_rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Yield each CSV row as a dict keyed by the SODA field names (``dos_id``, ``entity_type``, ...)."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [_key(h) for h in next(reader)]
        for values in reader:
            yield dict(zip(header, values))


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per row. Rows without a DOS ID are yielded without a registry
    number, which the registry counts as skipped."""
    for r in read_rows(path):
        dos_id = r.get("dos_id", "").strip()
        yield EntityRecord(
            legal_name=r.get("current_entity_name", "").strip(),
            registry_jurisdiction=JURISDICTION,
            registry_number=dos_id or None,
            taxpayer_number=None,
            state_of_formation=state_of_formation(r.get("jurisdiction")),
            mailing_address=_address(r, "dos_process") or _address(r, "registered_agent"),
            status="active",
            locator=f"export.csv DOS ID {dos_id}" if dos_id else None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          link: bool = True) -> tuple[IngestStats, dict[str, int]]:
    """Ingest one archived export into a registry file, then (by default) link parcel owners to entities."""
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ny_dos_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="dataset as-of date, YYYY-MM-DD (the last business day of the month in the portal's update)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
