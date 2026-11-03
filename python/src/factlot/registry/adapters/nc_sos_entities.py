"""North Carolina Secretary of State, Business Registration Division: the "Corporations System
Public Data Export" (the Data Subscription "Core" export) → ``EntityRecord``.

Layout: written to the publisher's layout document (``Business_Registration_layout.pdf``, "North
Carolina Corporations System Public Data Export Table Documentation", dated 2012-04-23, revised
2015-06-12), which is published free of charge; the data files themselves are sold by subscription
(see ``docs/registry/sources/nc-sos-entities.md``), so this adapter has NOT yet been run on a real
file. The export is a relational set of delimited text tables, one file per table, keyed as follows:

- ``Corporations`` — one row per corporate profile. ``PItemId`` is "the ONLY unique identity for a
  corporation" (``CorpNum`` is not unique); it is the SOSID shown on the public profile pages and is
  used as the registry number. ``EntityID`` joins to the names and addresses; ``OfficeAddressID``
  and ``OfficeMailingID`` are the principal office and mailing addresses; ``CorpType`` (lookup
  ``CorpTypes``), ``Status`` (lookup ``CorpStatus``), ``Citzenship`` (sic), ``DateFormed``,
  ``StateOfInc``, ``CountryOfInc``.
- ``Names`` — every name of every entity (``EntityID``, ``EName``, ``NTypeID``). The legal name is
  the row with ``NTypeID = 1`` ("Legal NC" in ``NameTypes``); other types are Homestate, Previous
  Legal NC, Previous Homestate.
- ``Addresses`` — ``AddressID``, ``Addr1``..``Addr3``, ``City``, ``State``, ``Zip``, ``Country``.
- ``CorpStatus`` — ``Status`` → ``StatusDesc``.

The files are expected as ``<Table>.txt`` (the layout names ``CorpOfficers.txt``, ``EntityTypes.txt``,
``CitizenshipTypes.txt``) or ``<Table>.csv``, with a header row; the delimiter (comma or tab) is
sniffed from the header. Natural persons appear in ``Names`` only as agents or officers and have no
``Corporations`` row, so they are never yielded.

Usage: ``python -m factlot.registry.adapters.nc_sos_entities <export dir or zip> registry.db --as-of 2026-11-02``
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

JURISDICTION = "us-nc"

SOURCE = Source(
    source_id="nc-sos-entities",
    publisher="North Carolina Secretary of State, Business Registration Division",
    title="Corporations System Public Data Export (Business Registration data subscription)",
    url="https://www.sosnc.gov/online_services/data_subscriptions/business_registration_data_subscriptions",
    state_fips="37",
    license="Public record (N.C. Gen. Stat. ch. 132); no license or terms of use stated for the data files, which are sold by subscription",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; public record
    attribution="North Carolina Secretary of State",
    terms_reviewed="2026-11-02",
)

# Name type of the one required legal name (layout: "every entity is required to have only one
# 'Legal NC' name. This is represented in the names table where NTypeID = 1").
LEGAL_NAME_TYPE = "1"

# The publisher's status descriptions (CorpStatus.StatusDesc) mapped to the registry's vocabulary;
# anything else is kept as a lower-case token of the description so nothing is lost.
STATUS = {
    "CURRENT-ACTIVE": "active",
    "CURRENT ACTIVE": "active",
    "ACTIVE": "active",
    "ADMIN. DISSOLVED": "administratively_dissolved",
    "ADMINISTRATIVELY DISSOLVED": "administratively_dissolved",
    "DISSOLVED": "dissolved",
    "WITHDRAWN": "withdrawn",
    "REVOKED": "revoked",
    "MERGED": "merged",
    "CONVERTED": "converted",
    "SUSPENDED": "suspended",
    "EXPIRED": "expired",
}

_TABLE_SUFFIXES = (".txt", ".csv")


def _is_table(name: str, table: str) -> bool:
    p = Path(name)
    return p.stem.lower() == table.lower() and p.suffix.lower() in _TABLE_SUFFIXES


def _parse(f: io.TextIOBase) -> Iterator[dict[str, str]]:
    """Rows of one open table as dicts keyed by the header; the delimiter is sniffed from the header line."""
    first = f.readline()
    if not first:
        return
    delimiter = "\t" if first.count("\t") >= first.count(",") else ","
    header = [h.strip() for h in next(csv.reader([first], delimiter=delimiter))]
    for values in csv.reader(f, delimiter=delimiter):
        if values:
            yield dict(zip(header, (v.strip() for v in values)))


def _rows(path: str | Path, table: str) -> Iterator[dict[str, str]]:
    """Stream one table (``Corporations``, ``Names``, ...) from an export directory or zip; absent → no rows."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for child in sorted(p.iterdir()):
            if _is_table(child.name, table):
                with open(child, newline="", encoding="utf-8-sig", errors="replace") as f:
                    yield from _parse(f)
                return
        return
    with zipfile.ZipFile(p) as zf:
        for name in sorted(zf.namelist()):
            if _is_table(name, table):
                with zf.open(name) as raw:
                    yield from _parse(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline=""))
                return


def _get(r: dict[str, str], key: str) -> str:
    """Case-insensitive column lookup (the layout mixes ``PItemId`` and ``PitemID``)."""
    if key in r:
        return r[key]
    lk = key.lower()
    for k, v in r.items():
        if k.lower() == lk:
            return v
    return ""


def _address(a: dict[str, str] | None) -> str | None:
    if not a:
        return None
    lines = [_get(a, "Addr1"), _get(a, "Addr2"), _get(a, "Addr3")]
    state_zip = " ".join(x for x in (_get(a, "State"), _get(a, "Zip")) if x)
    lines.append(", ".join(x for x in (_get(a, "City"), state_zip) if x))
    country = _get(a, "Country")
    if country and country.upper() not in ("US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"):
        lines.append(country)
    return ", ".join(x for x in lines if x) or None


def normalize_status(desc: str | None) -> str | None:
    d = (desc or "").strip()
    if not d:
        return None
    return STATUS.get(d.upper()) or re.sub(r"[^a-z0-9]+", "_", d.lower()).strip("_") or None


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per ``Corporations`` row (registry number = ``PItemId``).

    Rows whose entity has no "Legal NC" name are yielded with an empty name, which the registry
    counts as skipped. The lookup tables are read first (they are small), then the names and
    addresses of every entity, then the profiles are streamed.
    """
    status_desc = {_get(r, "Status"): _get(r, "StatusDesc") for r in _rows(path, "CorpStatus")}
    legal_names: dict[str, str] = {}
    for n in _rows(path, "Names"):
        if _get(n, "NTypeID") == LEGAL_NAME_TYPE:
            legal_names.setdefault(_get(n, "EntityID"), _get(n, "EName"))
    addresses: dict[str, dict[str, str]] = {_get(a, "AddressID"): a for a in _rows(path, "Addresses")}
    for c in _rows(path, "Corporations"):
        pitem = _get(c, "PItemId")
        entity = _get(c, "EntityID")
        office = _address(addresses.get(_get(c, "OfficeAddressID")))
        mailing = _address(addresses.get(_get(c, "OfficeMailingID")))
        state = _get(c, "StateOfInc").upper()
        yield EntityRecord(
            legal_name=legal_names.get(entity, ""),
            registry_jurisdiction=JURISDICTION,
            registry_number=pitem or None,
            state_of_formation=state if re.fullmatch(r"[A-Z]{2}", state) else None,
            mailing_address=office or mailing,  # principal office, else the mailing address
            status=normalize_status(status_desc.get(_get(c, "Status"), _get(c, "Status"))),
            locator=f"Corporations PItemId {pitem}" if pitem else None,
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.nc_sos_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the export zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
