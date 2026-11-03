"""District of Columbia Department of Licensing and Consumer Protection, Corporations Division
(the Office of Corporate Registrar), "Corporate Registration" dataset on Open Data DC
→ ``EntityRecord``.

Layout (confirmed on the Open Data DC CSV export of 2026-11-02): one UTF-8, header-row CSV row
per registered business entity, as exported by the ArcGIS Hub download API, with the columns

    FILE_NUMBER, ENTITY_STATUS, LOCALE, MODELTYPE, BUSINESS_NAME, BUSNIESS_ADDRESS_LINE1..4,
    BUSINESS_CITY, BUSINESS_STATE, ZIPCODE, BUSINESS_COUNTRY, SUFFIX, RA_NAME, RA_ADDRESS1..4,
    RA_CITY, RA_STATE, RA_ZIPCODE, EFFECTIVE_DATE, FOREIGN_DATEOF_ORGANIZATION, NEXT_REPORTYEAR_DUE,
    DCS_LAST_MOD_DTTM, DATE_LAST_REPORT_FILED, NEXT_REPORTYEAR, LATESTFILED_REPORTDATE,
    LATESTREPORT_YEARFILED, OBJECTID, GLOBALID

(``BUSNIESS`` is the publisher's spelling.) ``FILE_NUMBER`` is the DLCP file number (the registry
number); ``LOCALE`` says whether the entity is ``Domestic`` (formed in the District) or
``Foreign``; ``MODELTYPE`` the entity form; ``SUFFIX`` the entity-type suffix the registrar keeps
separately from ``BUSINESS_NAME`` (it is appended to the legal name when the name does not already
end with it). There is no taxpayer number.

Usage: ``python -m factlot.registry.adapters.dc_dlcp_entities corporate_registration.csv registry.db --as-of 2026-11-02``
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

JURISDICTION = "us-dc"

SOURCE = Source(
    source_id="dc-dlcp-entities",
    publisher="District of Columbia Department of Licensing and Consumer Protection, Corporations Division",
    title="Corporate Registration (Open Data DC)",
    url="https://opendata.dc.gov/datasets/DCGIS::corporate-registration",
    state_fips="11",
    license="CC-BY-4.0 (stated on the dataset page); District data policy (Mayor's Order 2017-115) classes open data as public domain, CC0, attribution requested",
    ai_use="permitted",  # CC-BY-4.0 permits any use with attribution; AI use is not addressed
    redistribution="attribution_required",
    attribution="District of Columbia Department of Licensing and Consumer Protection, Open Data DC",
    terms_reviewed="2026-11-02",
)

_US = frozenset({"", "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"})


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _status(s: str | None) -> str | None:
    """The publisher's status label as a lower-case token: ``'Active'`` → ``'active'``,
    ``'Revoked for Failure to File'`` → ``'revoked_for_failure_to_file'``."""
    t = re.sub(r"[^a-z0-9]+", "_", _squeeze(s).lower()).strip("_")
    return t or None


def legal_name(r: dict[str, str]) -> str:
    name = _squeeze(r.get("BUSINESS_NAME"))
    suffix = _squeeze(r.get("SUFFIX"))
    if suffix and not name.upper().endswith(suffix.upper()):
        name = f"{name} {suffix}"
    return name


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [_squeeze(r.get(f"BUSNIESS_ADDRESS_LINE{i}")) for i in (1, 2, 3, 4)]
    city = _squeeze(r.get("BUSINESS_CITY"))
    state_zip = " ".join(x for x in (_squeeze(r.get("BUSINESS_STATE")), _squeeze(r.get("ZIPCODE"))) if x)
    parts = [*lines, city, state_zip]
    country = _squeeze(r.get("BUSINESS_COUNTRY"))
    if country.upper() not in _US:
        parts.append(country)
    return ", ".join(x for x in parts if x) or None


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per row; rows without a file number or name are yielded without a
    ``registry_number`` (the registry counts them as skipped)."""
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        for values in reader:
            r = dict(zip(header, values))
            number = _squeeze(r.get("FILE_NUMBER"))
            locale = _squeeze(r.get("LOCALE")).upper()
            yield EntityRecord(
                legal_name=legal_name(r),
                registry_jurisdiction=JURISDICTION,
                registry_number=number or None,
                taxpayer_number=None,
                state_of_formation="DC" if locale == "DOMESTIC" else None,
                mailing_address=_mailing_address(r),
                status=_status(r.get("ENTITY_STATUS")),
                locator=f"Corporate Registration FILE_NUMBER {number}" if number else None,
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.dc_dlcp_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="dataset update date, YYYY-MM-DD (the portal's 'data updated' date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
