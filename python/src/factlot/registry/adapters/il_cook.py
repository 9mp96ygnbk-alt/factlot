"""Cook County (Chicago) Assessor's Office open data → ``ParcelRecord``.

Four Socrata datasets on the Cook County Open Data portal (datacatalog.cookcountyil.gov) make up
the roll; the collector archives each as a CSV from the SODA ``/resource/<id>.csv`` endpoint, which
honours a SoQL ``$select``/``$where``/``$limit`` (the ``export.csv`` endpoint does not, and formats
money as ``$2,287``). Layout confirmed on the 2026 files, 2026-11-02. The 14-digit Parcel Index
Number (``pin``) is the key everywhere; zero-pad it when a tool has dropped leading zeros.

- ``pabr-t5kh`` Parcel Universe (Current) — one row per PIN for the current tax year: ``class``
  (the Assessor's three-character class code, ``517``), ``township_code``/``township_name``,
  ``nbhd_code``, ``zip_code``, ``lon``/``lat``. No address, area, or value. Archived filtered to
  classes 3, 5, 6, 7, 8 and 9.
- ``uzyt-m557`` Assessed Values — one row per PIN and year: ``mailed_*``, ``certified_*`` and
  ``board_*`` land, building and total **assessed** values (not market: Cook County assesses
  class 3 and the incentive classes at 10% and class 5 at 25% of market value by ordinance), in
  dollars as ``345709.0``. Archived filtered to the current year and the same classes, with the
  ``_tot`` columns only.
- ``3723-97qp`` Parcel Addresses — one row per PIN and year: situs (``prop_address_full``, city,
  state, ZIP), the taxpayer's mailing name and address (``mail_address_*``), and the owner of
  record's name and address (``owner_address_*``; iasWorld truncates names to about 22 characters
  and, per the publisher, updates owners only intermittently). No class column, and the portal
  streams this 50-million-row dataset at a few hundred rows per second, so the archive is a sample
  of PIN areas (see the source doc); PINs outside it get no situs or owner.
- ``csik-bsws`` Commercial Valuation Data — the Assessor's commercial valuation workbooks, 2021 to
  present, one row per key PIN (``keypin``, ``pins`` as ``01-01-100-084-0000``, several when a
  property spans parcels): ``bldgsf``/``gross_building_area``, ``landsf``, ``yearbuilt``. Only the
  townships reassessed in a given year appear in that year. Used for area and year built.

Members are recognised by their header, so pass the collector's ``collected/il-cook-assessor``
directory (or the member files) and the adapter finds each; when a member was archived more than
once the newest file wins.

Class codes: the Assessor's class dictionary (``classcode.pdf`` on cookcountyassessoril.gov; the
machine-readable copy is ``ccao.class_dict.csv`` in the office's data-architecture repository)
groups them as 1 vacant, 2 residential (six units or fewer), 3 multifamily (seven units or more),
4 not-for-profit, 5A commercial, 5B industrial, 6 industrial incentive (6A, 6B, 6C brownfield),
7 commercial incentive, 8 commercial/industrial incentive, 9 multifamily incentive, EX exempt, RR
railroad. The registry keeps 3 and 9 as ``B``, 5B, 6 and the industrial codes of 8 as ``F2``, and
the rest of 5, 7 and 8 as ``F1``; the class itself is kept in ``local_use_code``.

Usage: ``python -m factlot.registry.adapters.il_cook collected/il-cook-assessor registry.db --as-of 2026-11-01``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "17"
COUNTY_FIPS = "031"
ACCOUNT_SYSTEM = "cook_pin"

SOURCE = Source(
    source_id="il-cook-assessor",
    publisher="Cook County Assessor's Office",
    title="Assessor open data: Parcel Universe (Current), Assessed Values, Parcel Addresses, Commercial Valuation Data",
    url="https://datacatalog.cookcountyil.gov/api/views/pabr-t5kh.json",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="None stated for the datasets; public record (5 ILCS 140). The County website terms "
            "(cookcountyil.gov/terms-use) claim copyright over site content",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed; public record, but see the website terms
    attribution="Cook County Assessor's Office",
    terms_reviewed="2026-11-02",
)

# Industrial class codes outside major class 5B and 6 (the class dictionary's descriptions):
# the industrial half of class 8, "Commercial/Industrial Incentive".
_INDUSTRIAL_8 = frozenset({"850", "880", "881", "883", "887", "889", "890", "893"})
_INDUSTRIAL_5 = frozenset({"550", "580", "581", "583", "587", "589", "593"})  # major class 5B

# Owner names iasWorld carries when it has no owner of record.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "CURRENT OWNER", "OWNER OF RECORD", "TAXPAYER OF",
                                 "TAXPAYER", "OCCUPANT"})

# Which member of the roll a CSV is, by a column only it has. A file with ``pin`` and ``class`` and
# none of these markers is the Parcel Universe, so a narrower ``$select`` of it still works.
_ROLES = (("values", "mailed_tot"), ("addresses", "prop_address_full"), ("commercial", "keypin"))

_PIN_RE = re.compile(r"\d{2}-?\d{2}-?\d{3}-?\d{3}-?\d{4}")


def state_category(class_code: str | None) -> str | None:
    """FactLot category for a Cook County class code (``517`` → ``F1``, ``593`` → ``F2``,
    ``313`` → ``B``); ``None`` for classes outside the commercial scope."""
    c = (class_code or "").strip().upper()
    if c == "OA5":  # omitted assessment on a class 5 parcel; the subclass is unknown
        return "F1"
    m = re.fullmatch(r"(\d{3})[A-Z]?", c)
    if not m:
        return None
    code, major = m.group(1), c[0]
    if major in ("3", "9"):
        return "B"
    if major == "6" or (major == "5" and code in _INDUSTRIAL_5) or (major == "8" and code in _INDUSTRIAL_8):
        return "F2"
    if major in ("5", "7", "8"):
        return "F1"
    return None


def pin14(s: str | None) -> str | None:
    """A PIN as 14 digits: ``01-01-100-084-0000``, or ``1011000840000`` with its leading zero lost,
    → ``01011000840000``."""
    digits = re.sub(r"\D", "", s or "")
    if not digits or len(digits) > 14:
        return None
    return digits.zfill(14)


def _num(s: str | None) -> float | None:
    s = (s or "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas and years: a 0 or blank is 'no figure', not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _role(path: Path) -> str | None:
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        header = next(csv.reader(f), [])
    cols = {h.strip().lstrip("﻿").lower() for h in header}
    role = next((role for role, marker in _ROLES if marker in cols), None)
    if role is None and {"pin", "class"} <= cols:
        return "universe"
    return role


def members(path: str | Path | Iterable[str | Path]) -> dict[str, Path]:
    """Map each role (``universe``, ``values``, ``addresses``, ``commercial``) to its CSV.

    ``path`` is a directory (searched recursively, hidden files skipped), one file, or several.
    When a role appears more than once (a directory of successive snapshots) the newest file wins.
    """
    paths = [Path(path)] if isinstance(path, (str, Path)) else [Path(p) for p in path]
    files: list[Path] = []
    for p in paths:
        if p.is_dir():
            files += [f for f in p.rglob("*.csv") if not any(part.startswith(".") for part in f.relative_to(p).parts)]
        else:
            files.append(p)
    found: dict[str, Path] = {}
    for f in sorted(files, key=lambda f: f.stat().st_mtime):
        if role := _role(f):
            found[role] = f
    if "universe" not in found:
        raise FileNotFoundError(f"no Parcel Universe CSV (a header with pin and class) under {path}")
    return found


def _rows(path: Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        reader.fieldnames = [h.strip().lstrip("﻿").lower() for h in reader.fieldnames or []]
        yield from reader


def _situs(r: dict[str, str]) -> str | None:
    street = _squeeze(r.get("prop_address_full"))
    if not street:
        return None
    city = _squeeze(r.get("prop_address_city_name"))
    rest = " ".join(x for x in (city, _squeeze(r.get("prop_address_state")) or "IL",
                                _squeeze(r.get("prop_address_zipcode_1"))) if x)
    return f"{street}, {rest}"


def _mailing_address(r: dict[str, str], prefix: str) -> str | None:
    street = _squeeze(r.get(f"{prefix}_address_full"))
    city = _squeeze(r.get(f"{prefix}_address_city_name"))
    state_zip = " ".join(x for x in (_squeeze(r.get(f"{prefix}_address_state")),
                                     _squeeze(r.get(f"{prefix}_address_zipcode_1"))) if x)
    return ", ".join(x for x in (street, city, state_zip) if x) or None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def _assessed_total(v: dict[str, str]) -> float | None:
    """The most final stage published for the year: Board of Review, else certified, else mailed."""
    for stage in ("board_tot", "certified_tot", "mailed_tot"):
        if (x := _num(v.get(stage))) is not None:
            return x
    return None


def read_roll(path: str | Path | Iterable[str | Path], *,
              categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per PIN of the Parcel Universe in scope, in universe order.

    ``categories`` limits the PINs kept by FactLot category (default: the registry's commercial
    scope); ``None`` keeps every PIN in the universe file, with ``state_category`` ``None`` for
    classes outside the scope.
    """
    if categories is None:
        keep = lambda cat: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda cat: cat in wanted  # noqa: E731
    found = members(path)
    # 1. The universe decides which PINs exist and their class.
    kept: dict[str, dict[str, str]] = {}
    for r in _rows(found["universe"]):
        pin = pin14(r.get("pin"))
        if not pin or pin in kept:
            continue
        if keep(state_category(r.get("class"))):
            kept[pin] = r
    # 2. Assessed values for the universe's year (the file is already limited to one year).
    values: dict[str, dict[str, str]] = {}
    if "values" in found:
        for r in _rows(found["values"]):
            pin = pin14(r.get("pin"))
            if pin in kept and pin not in values:
                values[pin] = r
    # 3. Situs and owner.
    addresses: dict[str, dict[str, str]] = {}
    if "addresses" in found:
        for r in _rows(found["addresses"]):
            pin = pin14(r.get("pin"))
            if pin in kept and pin not in addresses:
                addresses[pin] = r
    # 4. Area and year built from the commercial valuation workbooks: single-PIN rows only (a
    #    multi-PIN row describes the whole property), the latest year per PIN.
    traits: dict[str, tuple[int, dict[str, str]]] = {}
    if "commercial" in found:
        for r in _rows(found["commercial"]):
            pins = [pin14(p) for p in _PIN_RE.findall(r.get("pins") or "")] or [pin14(r.get("keypin"))]
            if len(pins) != 1 or pins[0] not in kept:
                continue
            year = int(_num(r.get("year")) or 0)
            if pins[0] not in traits or year >= traits[pins[0]][0]:
                traits[pins[0]] = (year, r)
    universe_name = found["universe"].name
    for pin, u in kept.items():
        v = values.get(pin, {})
        a = addresses.get(pin, {})
        year, t = traits.get(pin, (0, {}))
        owner_name = _owner(a.get("owner_address_name"))
        tax_year = _num(v.get("year")) or _num(u.get("year"))
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=pin,
            state_category=state_category(u.get("class")),
            account=pin,
            situs_address=_situs(a),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(a, "owner") if owner_name else None,
            owner_confidential=False,  # the datasets carry no confidentiality flag
            land_area_sf=_positive(t.get("landsf")),
            improvement_area_sf=_positive(t.get("bldgsf")) or _positive(t.get("gross_building_area")),
            year_built=int(y) if (y := _positive(t.get("yearbuilt"))) else None,
            market_value=None,  # Cook County publishes assessed values, not market values
            appraised_value=_assessed_total(v),
            tax_year=int(tax_year) if tax_year else None,
            locator=f"{universe_name} pin {pin}",
            local_use_code=_squeeze(u.get("class")) or None,
        )


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None, full_roll: bool = True) -> IngestStats:
    """Ingest the archived Cook County files into a registry file (created if missing).

    Every member CSV is registered as a snapshot; the facts cite the Parcel Universe snapshot (the
    roll's list of parcels) and each locator names the universe member and PIN.
    """
    found = members(snapshot_path)
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snaps = {role: reg.add_snapshot(SOURCE.source_id, p, as_of, retrieved_at) for role, p in found.items()}
        return reg.ingest_parcels(read_roll(list(found.values())), snaps["universe"], state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.il_cook", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+",
                    help="the collector's collected/il-cook-assessor directory, or the member CSV files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="data date, YYYY-MM-DD (the portal's 'rows updated' date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from these files")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
