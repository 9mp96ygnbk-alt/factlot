"""Fort Bend Central Appraisal District: the Orion appraisal export zip → ``ParcelRecord``.

Layout (confirmed on the 2026 certified export, 2026-11-03, and the supplement 4 export): a zip of
comma-delimited, double-quote-qualified text files with CRLF line endings and a header row, in the
Orion Appraisal Export layout, which FBCAD ships inside every zip as ``Orion Appraisal Export
Layout.xlsx`` (one sheet per record type, with each field's position, type and description). The
exports on the website are the **redacted** ones: owners who made a Tax Code §25.025 election are
left out (the file's ``ConfidentialFlag``, ``CAAgentID``, ``ARBAgentID`` and ``EntityAgentID``
columns are dropped from the owner file). Members used here (the file name prefix is a timestamp):

- ``*_PropertyExport.txt`` (record type 1): one row per property. ``PropertyQuickRefID`` is the
  district's account id (first character ``R`` real, ``M`` mobile home, ``N`` mineral, ``P``
  personal, ``V`` unknown to the layout sheet), ``PropertyNumber`` the geographic account number,
  ``PropertyTypeCode`` (``RR`` residential, ``RC`` commercial, ``RA`` acreage, ``RD``, ``RL`` land,
  ``RM``, ``RX`` exempt, ``RCT``, ``RIT``) FBCAD's own class. ``SitusStreetAddress``, ``SitusCity``,
  ``SitusState``, ``SitusZip``; ``Acres``; ``StateCodeLand`` and ``StateCodeImp`` are the PTD
  (state) codes of the first land segment and the first improvement; ``ChangeCode`` is ``A``, ``M``
  or ``D`` (a deleted account in a supplement), ``TaxYear`` and ``SupplementNumber`` (``CERT``,
  ``PRE`` or ``SUPP n``).
- ``*_OwnerExport.txt`` (record type 2): one row per owner of a property (``OwnershipPercentage``;
  several rows for a divided interest). ``OwnerName`` and ``OwnerAddress1..3``, ``OwnerCity``,
  ``OwnerState``, ``OwnerPostalCode`` are the owner of record as of the appraisal year; the
  ``Current*`` columns are the owner now. The values are per owner: ``ImpHSValue``, ``ImpNHSValue``,
  ``LandHSValue``, ``LandNHSValue``, ``AgMktValue``, ``TimMktValue`` (market) and ``AgUseValue``,
  ``TimUseValue`` (use values).

State codes: FBCAD uses the Comptroller's ``F1``, ``F2``, ``B1``–``B3`` and sub-classes of ``F1``
with a letter suffix (``F1H``, ``F1M``, ``F1V``, ``F1X``); the suffix is the district's own, and its
meaning was not published where the collector could read it, so the code is kept verbatim in
``local_use_code`` and the account maps to ``F1``. The export carries no building area, year built
or appraised (capped) value: the "Commercial Segments" workbook has areas but is not read here.
``market_value`` is the sum of the owners' market components above.

A supplement export holds only the accounts that changed, so a supplement must be loaded with
``full_roll=False`` (``--partial``); the certified roll is complete.

Usage: ``python -m factlot.registry.adapters.tx_fortbend ORION-EXPORT.zip registry.db --as-of 2026-07-07``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source
from .tx_collin import _num, _positive, _squeeze

STATE_FIPS = "48"
COUNTY_FIPS = "157"
ACCOUNT_SYSTEM = "fbcad_quickref"

SOURCE = Source(
    source_id="tx-fortbend-cad",
    publisher="Fort Bend Central Appraisal District",
    title="Orion appraisal export, redacted (certified roll and supplements)",
    url="https://www.fbcad.org/certified-and-supplements-reports/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (Tex. Gov't Code ch. 552); no license stated. The data-file disclaimer provides the files 'as is' and "
            "requires the user to hold the district harmless",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # not addressed; public record
    attribution="Fort Bend Central Appraisal District",
    terms_reviewed="2026-11-03",
)

# Owner names FBCAD uses when it has no owner of record: the parcel keeps no owner name.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "OWNER UNKNOWN", "UNKNOWN OWNER"})

_SQFT_PER_ACRE = 43560

_MARKET_COLUMNS = ("ImpHSValue", "ImpNHSValue", "LandHSValue", "LandNHSValue", "AgMktValue", "TimMktValue")


def state_category(code: str | None) -> str | None:
    """Comptroller category for a ``StateCodeImp``/``StateCodeLand``: ``F1H`` → ``F1``, ``B2`` → ``B2`` (``is_commercial`` reads B subclasses)."""
    c = _squeeze(code).upper()
    m = re.fullmatch(r"(F[12])[A-Z]", c)
    return (m.group(1) if m else c) or None


def _member_rows(path: str | Path, suffix: str) -> Iterator[dict[str, str]]:
    """Rows of the export member whose name ends with ``suffix``, from the zip or an unpacked directory."""
    csv.field_size_limit(1 << 30)
    p = Path(path)
    if p.is_dir():
        for member in sorted(f for f in p.rglob("*") if f.is_file() and f.name.endswith(suffix)):
            with open(member, newline="", encoding="utf-8-sig", errors="replace") as f:
                yield from csv.DictReader(f)
        return
    with zipfile.ZipFile(p) as zf:
        for name in zf.namelist():
            if name.endswith(suffix):
                with zf.open(name) as raw:
                    yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline=""))


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(r.get("SitusStreetAddress"))
    if not street:
        return None
    state = _squeeze(r.get("SitusState")) or "TX"
    rest = " ".join(x for x in (_squeeze(r.get("SitusCity")), state, _squeeze(r.get("SitusZip"))) if x)
    return f"{street}, {rest}"


def _mailing_address(o: dict[str, str]) -> str | None:
    lines = [_squeeze(o.get(f"OwnerAddress{i}")) for i in (1, 2, 3)]
    state_zip = " ".join(x for x in (_squeeze(o.get("OwnerState")), _squeeze(o.get("OwnerPostalCode"))) if x)
    lines.append(", ".join(x for x in (_squeeze(o.get("OwnerCity")), state_zip) if x))
    return ", ".join(x for x in lines if x) or None


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real property in scope, in property-file order.

    ``categories`` limits the properties kept by Comptroller category (default: the registry's
    commercial scope); ``None`` keeps every real property, which needs memory for all owners.
    Accounts deleted in a supplement (``ChangeCode`` ``D``) are skipped. A property with no owner
    row in the owner file is still yielded, without an owner or values.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    kept: dict[str, tuple[dict[str, str], str, str | None]] = {}
    for r in _member_rows(path, "PropertyExport.txt"):
        qid = _squeeze(r.get("PropertyQuickRefID"))
        if not qid.upper().startswith("R") or _squeeze(r.get("ChangeCode")).upper() == "D" or qid in kept:
            continue
        local = _squeeze(r.get("StateCodeImp")).upper() or _squeeze(r.get("StateCodeLand")).upper()
        category = state_category(local)
        if keep(category):
            kept[qid] = (r, local, category)
    owners: dict[str, list[dict[str, str]]] = defaultdict(list)
    if kept:
        for o in _member_rows(path, "OwnerExport.txt"):
            qid = _squeeze(o.get("PropertyQuickRefID"))
            if qid in kept:
                owners[qid].append(o)
    for qid, (r, local, category) in kept.items():
        rows = owners.get(qid, [])
        # The owner of record is the largest holding (first listed on a tie).
        main = max(rows, key=lambda o: _num(o.get("OwnershipPercentage")) or 0.0, default=None)
        confidential = bool(main and _squeeze(main.get("ConfidentialFlag")) in ("1", "true", "True"))
        name = None if confidential or not main else _squeeze(main.get("OwnerName"))
        if name and name.upper() in _PLACEHOLDER_OWNERS:
            name = None
        market = None
        if rows:
            market = sum((_num(o.get(c)) or 0.0) for o in rows for c in _MARKET_COLUMNS) or None
        acres = _positive(r.get("Acres"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=qid,
            state_category=category,
            account=qid,
            situs_address=_situs(r),
            owner_name=name or None,
            owner_mailing_address=_mailing_address(main) if main and name else None,
            owner_confidential=confidential,
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,  # not in the export
            year_built=None,  # not in the export
            market_value=market,
            appraised_value=None,  # the export has no capped value
            tax_year=int(y) if (y := _num(r.get("TaxYear"))) else None,
            locator=f"PropertyExport PropertyQuickRefID {qid}",
            local_use_code=local or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one archived Orion export zip into a registry file (created if missing).

    Pass ``full_roll=False`` for a supplement: it lists only the accounts that changed, so it must
    not retire the others.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_fortbend", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to an Orion export zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="export date, YYYY-MM-DD (the file's release date on the site)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file (use for supplements)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
