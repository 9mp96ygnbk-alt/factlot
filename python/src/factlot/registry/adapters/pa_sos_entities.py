"""Pennsylvania Department of State registered business entities (data.pa.gov dataset 3urc-uaba,
"Filtered View - Distinct Registered Businesses in PA Listing Current by County") → ``EntityRecord``.

Layout (confirmed 2026-11-02 against the dataset's column list on the portal and the CSV export): one
row per registered business, with the columns

    business_name, filing_number, address_line1, address_line2, city, state, zip,
    typeofbusinessregistration, shortcountyname, county_code, georeferenced_latitude__longitude

(the export may spell them as the portal's display names; both spellings are accepted). The view is
the distinct-business view of dataset xvd7-5r2c, which repeats a business once per Governor/Officer;
this view has no officer or person-name columns, so no natural person's name passes through.

``filing_number`` is the Department of State's entity number (ten digits, leading zeros kept) and
becomes the registry number. ``typeofbusinessregistration`` begins with ``Domestic`` for a Pennsylvania
entity and ``Foreign`` for one formed elsewhere; a domestic entity gets state of formation ``PA``, a
foreign one is left unknown (the dataset does not say where it was formed). Types with neither prefix
("Authority") are Pennsylvania public bodies and are treated as domestic.

The dataset has no status column. The publisher states it lists all active registrations but warns
that, because of statutory limits on removing businesses no longer operating, it "shows a larger
number of active businesses than currently exist". The status stored is therefore ``listed``: present in
the publisher's active-registrations listing, not a claim that the entity is in good standing.

Usage: ``python -m factlot.registry.adapters.pa_sos_entities export.csv registry.db --as-of 2026-10-31``
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

JURISDICTION = "us-pa"

SOURCE = Source(
    source_id="pa-sos-entities",
    publisher="Pennsylvania Department of State, Bureau of Corporations and Charitable Organizations",
    title="Registered Businesses in PA, distinct listing (data.pa.gov dataset 3urc-uaba)",
    url="https://data.pa.gov/Licenses-Certificates/Filtered-View-Distinct-Registered-Businesses-in-PA/3urc-uaba",
    state_fips="42",
    license="Public Domain U.S. Government (portal license field); PA Data Policy: data sets are offered free and without restriction",
    ai_use="permitted",  # no restriction in the data policy; AI use is not addressed
    redistribution="permitted",  # offered free and without restriction; attribution requested, not required
    attribution="Pennsylvania Department of State, via data.pa.gov",
    terms_reviewed="2026-11-02",
)

LISTED = "listed"


def _key(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")


def state_of_formation(registration_type: str | None) -> str | None:
    """``PA`` for a domestic entity (or a public authority); ``None`` for a foreign one or an unknown type."""
    t = (registration_type or "").strip().lower()
    if t.startswith("domestic") or t == "authority":
        return "PA"
    return None


def _address(r: dict[str, str]) -> str | None:
    line1 = r.get("address_line1", "").strip()
    line2 = r.get("address_line2", "").strip()
    city = r.get("city", "").strip()
    state_zip = " ".join(x for x in (r.get("state", "").strip(), r.get("zip", "").strip()) if x)
    return ", ".join(x for x in (line1, line2, city, state_zip) if x) or None


def read_rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Yield each CSV row as a dict keyed by the lower-case column names."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [_key(h) for h in next(reader)]
        for values in reader:
            yield dict(zip(header, values))


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per row. Rows without a filing number are yielded without a registry
    number, which the registry counts as skipped."""
    for r in read_rows(path):
        number = r.get("filing_number", "").strip()
        yield EntityRecord(
            legal_name=r.get("business_name", "").strip(),
            registry_jurisdiction=JURISDICTION,
            registry_number=number or None,
            taxpayer_number=None,
            state_of_formation=state_of_formation(r.get("typeofbusinessregistration")),
            mailing_address=_address(r),
            status=LISTED,
            locator=f"export.csv filing number {number}" if number else None,
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.pa_sos_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="dataset as-of date, YYYY-MM-DD (the portal's 'data last updated')")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
