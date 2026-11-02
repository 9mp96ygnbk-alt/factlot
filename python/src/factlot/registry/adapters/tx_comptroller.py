"""Texas Comptroller "Active Franchise Taxpayers" (Texas Open Data Portal, dataset 9cir-efmm)
→ ``EntityRecord``.

Layout (confirmed 2026-11-02 against the CSV export and the publisher's "Franchise Layout"
record layout attached to the dataset): one CSV row per franchise taxpayer with the columns

    Taxpayer Number, Taxpayer Name, Taxpayer Address, Taxpayer City, Taxpayer State, Taxpayer Zip,
    Taxpayer County Code, Taxpayer Organizational Type, Record Type Code,
    Responsibility Beginning Date, Secretary of State (SOS) or COA File Number, SOS Charter Date,
    SOS Status Date, SOS Status Code, Right to Transact Business Code, Current Exempt Reason Code,
    Exempt Begin Date, NAICS Code

Record Type Code says what the file number is: ``U`` an SOS file number, ``V`` an SOS certificate
of authority (a foreign entity registered in Texas), ``X`` a Comptroller-assigned number, in which
case the file-number field is blank and the taxpayer is not a registered entity (sole proprietors,
estates, and the like), so no ``EntityRecord`` is produced for it.

Usage: ``python -m factlot.registry.adapters.tx_comptroller export.csv registry.db --as-of 2026-10-31``
"""

from __future__ import annotations

import argparse
import csv
import json
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import EntityRecord, IngestStats, Registry, Source

JURISDICTION = "us-tx"

SOURCE = Source(
    source_id="tx-comptroller-franchise",
    publisher="Texas Comptroller of Public Accounts",
    title="Active Franchise Taxpayers (Texas Open Data Portal dataset 9cir-efmm)",
    url="https://data.texas.gov/dataset/Active-Franchise-Taxpayers/9cir-efmm",
    state_fips="48",
    license="Public domain (Comptroller policy: information on its sites is public domain and may be copied and used as permitted by law)",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="attribution_required",
    attribution="Texas Comptroller of Public Accounts",
    terms_reviewed="2026-11-02",
)

# Record Type Code (publisher's layout): which registry issued the file number.
_REGISTERED = {"U": "sos_file_number", "V": "sos_certificate_of_authority"}

# SOS Status Code (publisher's layout).
SOS_STATUS = {
    "A": "active", "B": "consolidated", "C": "converted", "D": "dissolved", "E": "expired",
    "F": "forfeited_franchise_tax", "G": "miscellaneous", "I": "closed_by_fdic", "J": "state_charter_pulled",
    "K": "forfeited_registered_agent", "L": "forfeited_registered_office", "M": "merger",
    "N": "forfeited_hot_check", "P": "forfeited_court_order", "R": "reinstated", "T": "terminated",
    "W": "withdrawn", "Y": "dead_at_conversion_69", "Z": "dead_at_conversion_83",
}

# Taxpayer Organizational Type codes the publisher defines as Texas-formed entities. Foreign
# (out-of-state) types say nothing about the state of formation, which is left unknown.
TEXAS_FORMED = frozenset({
    "AB", "AP", "CL", "CN", "CP", "CR", "CT", "CW", "FB", "FD", "FE", "FF", "FG", "FI", "FS",
    "PL", "PV", "PX", "ST", "TH",
})


def _mailing_address(r: dict[str, str]) -> str | None:
    street = r.get("Taxpayer Address", "").strip()
    city = r.get("Taxpayer City", "").strip()
    state_zip = " ".join(x for x in (r.get("Taxpayer State", "").strip(), r.get("Taxpayer Zip", "").strip()) if x)
    return ", ".join(x for x in (street, city, state_zip) if x) or None


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per taxpayer that has an SOS file number (record types U and V).

    Taxpayers with a Comptroller-assigned number only (record type X) are yielded without a
    ``registry_number``, which the registry counts as skipped: they are not registered entities.
    """
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        for values in reader:
            r = dict(zip(header, values))
            kind = r.get("Record Type Code", "").strip().upper()
            number = r.get("Secretary of State (SOS) or COA File Number", "").strip()
            org_type = r.get("Taxpayer Organizational Type", "").strip().upper()
            status = SOS_STATUS.get(r.get("SOS Status Code", "").strip().upper())
            taxpayer = r.get("Taxpayer Number", "").strip()
            yield EntityRecord(
                legal_name=r.get("Taxpayer Name", "").strip(),
                registry_jurisdiction=JURISDICTION,
                registry_number=number if kind in _REGISTERED and number else None,
                taxpayer_number=taxpayer or None,
                state_of_formation="TX" if org_type in TEXAS_FORMED else None,
                mailing_address=_mailing_address(r),
                status=status,
                locator=f"export.csv taxpayer {taxpayer}" if taxpayer else None,
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_comptroller", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="dataset update date, YYYY-MM-DD (the portal's 'data last updated')")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
