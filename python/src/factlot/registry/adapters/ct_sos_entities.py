"""Connecticut Secretary of the State "Connecticut Business Registry - Business Master" (Open Data CT,
data.ct.gov, dataset n7gp-d28j) → ``EntityRecord``.

Layout (confirmed 2026-11-03 against the SODA CSV and the portal's column metadata): one CSV row per
business on file with the Business Services Division (active and ended), updated daily. The collector
requests a column subset; the SODA API spells the columns in lower case and the portal's export uses
the display names (``Business_Street`` for ``billingstreet``, ``Business_ZIP`` for
``billingpostalcode``, ...); both are accepted. Columns read:

    name, business_type, status, sub_status, accountnumber, billingstreet, billing_unit, billingcity,
    billingcountry, billingpostalcode, billingstate, citizenship, state_or_territory_formation,
    formation_place, date_registration, dissolution_date, mailing_address

``accountnumber`` is the Division's business id and becomes the registry number; it is seven digits.
Businesses of type "Unauthorized" (foreign companies the Division has noted but not registered) carry
the placeholder ``0000000``, which is not a registry number and yields a record without one (the
registry counts it as skipped). ``status`` is the Division's status ("Active", "Forfeited", "Dissolved",
"Revoked", "Withdrawn", "Merged", ...) written as a lower-case token. ``state_or_territory_formation``
(or ``formation_place``) names the state of formation as a postal code or a full name; a domestic
business with neither is formed in Connecticut. The address kept is the business address
(``billing*`` columns); when it is blank the one-line ``mailing_address`` is used. Principals and
agents are separate datasets (``ka36-64k6``, ``qh2m-n44y``), mostly natural persons, and are not read;
the business email address is not selected.

Usage: ``python -m factlot.registry.adapters.ct_sos_entities export.csv registry.db --as-of 2026-11-03``
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

JURISDICTION = "us-ct"

SOURCE = Source(
    source_id="ct-sos-entities",
    publisher="Connecticut Secretary of the State, Business Services Division",
    title="Connecticut Business Registry - Business Master (Open Data CT dataset n7gp-d28j)",
    url="https://data.ct.gov/Business/Connecticut-Business-Registry-Business-Master/n7gp-d28j",
    state_fips="09",
    license="Public Domain (dataset license field on data.ct.gov); the portal's Terms of Use add disclaimers of warranty and no restriction on use",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="permitted",
    attribution="Connecticut Secretary of the State",
    terms_reviewed="2026-11-03",
)

_US_STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA",
    "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
    "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA",
    "MICHIGAN": "MI", "MINNESOTA": "MN", "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT",
    "NEBRASKA": "NE", "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
    "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK",
    "OREGON": "OR", "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY", "PUERTO RICO": "PR",
}
_STATE_CODES = frozenset(_US_STATES.values())

# Portal display name (lower-cased) → SODA field name, for the columns whose names differ.
_ALIASES = {
    "business_street": "billingstreet", "business_unit": "billing_unit", "business_city": "billingcity",
    "business_country": "billingcountry", "business_zip": "billingpostalcode", "business_state": "billingstate",
}
_US_COUNTRIES = ("US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA")
# What the Division writes in an address field when it has none (about three quarters of the street
# values in the first 20,000 rows by business id, which are old forfeited and dissolved companies).
_NO_ADDRESS = frozenset({"NO INFORMATION PROVIDED", "NONE", "N/A", "00000"})


def _key(header: str) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")
    return _ALIASES.get(k, k)


def _text(s: str | None) -> str:
    return " ".join((s or "").split())


def state_of_formation(*values: str | None) -> str | None:
    """Two-letter US state from the first value that names one ("Connecticut", "DE", "NEW YORK");
    ``None`` for countries and anything else."""
    for v in values:
        j = _text(v).upper()
        if j in _STATE_CODES:
            return j
        if j in _US_STATES:
            return _US_STATES[j]
    return None


def status(name: str | None) -> str | None:
    n = _text(name)
    return re.sub(r"[^a-z0-9]+", "_", n.lower()).strip("_") or None if n else None


def registry_number(account_number: str | None) -> str | None:
    """The business id, or ``None`` for blank and all-zero placeholders ("0000000")."""
    n = _text(account_number)
    if n.endswith(".0"):
        n = n[:-2]
    return None if not n or not n.strip("0") else n


def _line(s: str | None) -> str:
    t = _text(s)
    return "" if t.upper() in _NO_ADDRESS else t


def _address(r: dict[str, str]) -> str | None:
    street = ", ".join(x for x in (_line(r.get("billingstreet")), _line(r.get("billing_unit"))) if x)
    state_zip = " ".join(x for x in (_line(r.get("billingstate")), _line(r.get("billingpostalcode"))) if x)
    country = _line(r.get("billingcountry"))
    if country.upper() in _US_COUNTRIES:
        country = ""
    business = ", ".join(x for x in (street, _line(r.get("billingcity")), state_zip, country) if x)
    if business:
        return business
    # One-line mailing address: "street ,unit ,city ,state ,country ,zip" with empty segments.
    parts = [_text(p) for p in (r.get("mailing_address") or "").split(",")]
    parts = [p for p in parts if p and p.upper() not in _US_COUNTRIES and p.upper() not in _NO_ADDRESS]
    return ", ".join(parts) or None


def read_rows(path: str | Path) -> Iterator[dict[str, str]]:
    """Yield each CSV row as a dict keyed by the SODA field names."""
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [_key(h) for h in next(reader)]
        for values in reader:
            yield dict(zip(header, values))


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per row. Rows without a usable business id are yielded without a
    registry number, which the registry counts as skipped."""
    for r in read_rows(path):
        number = registry_number(r.get("accountnumber"))
        formed = state_of_formation(r.get("state_or_territory_formation"), r.get("formation_place"))
        if formed is None and _text(r.get("citizenship")).lower() == "domestic":
            formed = "CT"
        yield EntityRecord(
            legal_name=_text(r.get("name")),
            registry_jurisdiction=JURISDICTION,
            registry_number=number,
            taxpayer_number=None,
            state_of_formation=formed,
            mailing_address=_address(r),
            status=status(r.get("status")),
            locator=f"n7gp-d28j.csv accountnumber {number}" if number else None,
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ct_sos_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the CSV as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date the data was retrieved, YYYY-MM-DD (the dataset updates daily)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
