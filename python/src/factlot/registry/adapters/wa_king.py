"""King County, Washington (Seattle) Department of Assessments: the "Assessments Data Download"
extracts → ``ParcelRecord``.

Status (2026-11-02): the download page (info.kingcounty.gov/assessor/DataDownload/default.aspx)
shows its file links only after a person ticks an acknowledgement of RCW 42.56.070's prohibition on
using lists of individuals for commercial purposes. The collector does not accept terms, so no file
has been downloaded and nothing below is confirmed against a real extract. The layout is written
from the Assessor's published extract descriptions (the ``*.doc`` layout files that accompany each
zip) as known to the author; confirm every column name against the first real snapshot and run
``check_lookup`` before trusting the category mapping. See docs/registry/sources/wa-king-assessor.md.

Layout: each extract is a zip holding one comma-separated, header-row, quoted CSV (``EXTR_*.csv``).
A parcel is keyed by its PIN, ``Major`` (6 digits) + ``Minor`` (4 digits); the adapter zero-pads both.

- ``Real Property Account.zip`` → ``EXTR_RPAcct_NoName.csv``: one row per tax account: ``AcctNbr``,
  ``Major``, ``Minor``, the taxpayer's mailing address (``AttnLine``, ``AddrLine``, ``CityState``,
  ``ZipCode``), ``LevyCode``, ``Status``, ``BillYr``, ``TaxValReason``, ``ApprLandVal``, ``ApprImpsVal``,
  ``TaxableLandVal``, ``TaxableImpsVal``. The public file is the "NoName" variant: the taxpayer name
  column is not published. If a ``TaxpayerName`` column is present it is read; otherwise no owner.
- ``Parcel.zip`` → ``EXTR_Parcel.csv``: one row per parcel: ``PropType``, ``PresentUse`` (the
  Assessor's use code, lookup type 102), ``SqFtLot``, zoning, views, nuisances. No situs address.
- ``Commercial Building.zip`` → ``EXTR_CommBldg.csv``: one row per commercial building: ``BldgNbr``,
  ``YrBuilt``, ``BldgGrossSqFt``, ``BldgNetSqFt``, ``PredominantUse``, and the building's address
  (``Address`` or its parts ``BuildingNumber`` … ``ZipCode``).
- ``Apartment Complex.zip`` → ``EXTR_AptComplex.csv``: one row per apartment complex: ``NbrBldgs``,
  ``NbrUnits``, ``YrBuilt``, ``AvgUnitSize``, and the complex address.
- ``Lookup.zip`` → ``EXTR_LookUp.csv``: ``LUType``, ``LUItem``, ``LUDescription``; PresentUse is
  ``LUType`` 102.

Category mapping: the FactLot category is decided from the publisher's PresentUse *description*
(read from the Lookup extract) by the rules in ``category_for``, so the mapping does not depend on
the numeric codes, which stay verbatim in ``local_use_code``. Apartment uses are ``B``; industrial,
warehouse and terminal uses are ``F2``; an explicit list of commercial uses is ``F1``; everything
else (single family, condominium units, vacant land, public, exempt, open space) is out of scope.

Usage: ``python -m factlot.registry.adapters.wa_king "Real Property Account.zip" Parcel.zip
"Commercial Building.zip" "Apartment Complex.zip" Lookup.zip --db registry.db --as-of 2026-10-30``
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

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "53"
COUNTY_FIPS = "033"
ACCOUNT_SYSTEM = "king_pin"

SOURCE = Source(
    source_id="wa-king-assessor",
    publisher="King County Department of Assessments",
    title="Assessments Data Download extracts (Real Property Account, Parcel, Commercial Building, "
          "Apartment Complex, Lookup)",
    url="https://info.kingcounty.gov/assessor/DataDownload/default.aspx",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (RCW 42.56); download gated by an acknowledgement of RCW 42.56.070 "
            "(no use of lists of individuals for commercial purposes); the King County website terms "
            "of use reserve publication and distribution rights",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="unknown",  # website terms of use require written permission; public record
    attribution="King County Department of Assessments",
    terms_reviewed="2026-11-02",
)

# Member files, matched by case-insensitive prefix so the "NoName" suffix and any renaming survive.
_MEMBERS = {
    "account": "extr_rpacct",
    "parcel": "extr_parcel",
    "commercial": "extr_commbldg",
    "apartment": "extr_aptcomplex",
    "lookup": "extr_lookup",
}
PRESENT_USE_LOOKUP_TYPE = "102"

# Taxpayer names the Assessor would use when there is no owner of record: not an owner.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "CURRENT OWNER", "OWNER UNKNOWN"})

# --- PresentUse description → FactLot category ----------------------------------------------
# Applied in order to the normalized description (upper case, one space, no space around "(").
# The descriptions are the Assessor's (lookup type 102) as published in its eReal Property pages
# and Lookup extract; ``check_lookup`` reports any description the rules do not recognise.
_F1_EXACT = frozenset({
    "OFFICE BUILDING", "MEDICAL/DENTAL OFFICE", "BANK", "HOTEL/MOTEL", "TAVERN/LOUNGE",
    "GROCERY STORE", "GAS STATION", "SERVICE STATION", "SERVICE BUILDING", "AUTO SHOWROOM AND LOT",
    "BOWLING ALLEY", "CAR WASH", "DAYCARE CENTER", "HEALTH CLUB", "MOVIE THEATER", "NURSING HOME",
    "POST OFFICE/POST SERVICE", "REHABILITATION CENTER", "RESIDENCE HALL/DORM", "RETIREMENT FACILITY",
    "SPORT FACILITY", "VET/ANIMAL CONTROL SRVC", "MINI LUBE", "HOSPITAL", "MARINA", "GOLF COURSE",
    "CLUB", "FRATERNAL ORGANIZATION", "MORTUARY/CEMETERY/CREMATORY", "GREENHSE/NRSRY/HORT SRVC",
    "SHELL STRUCTURE", "AIR TERMINAL AND HANGERS", "PARK, PRIVATE(AMUSE CTR)",
    "ART GALLERY/MUSEUM/SOC SRVC", "MOBILE HOME PARK", "SCHOOL(PRIVATE)",
})
_F1_PREFIXES = ("RETAIL", "SHOPPING CTR", "RESTAURANT", "PARKING(", "CONV STORE", "HIST PROP(")
_F2_EXACT = frozenset({"MINING/QUARRY/ORE PROCESSING", "HIGH TECH/HIGH FLEX"})
_F2_PREFIXES = ("INDUSTRIAL", "TERMINAL(")
_B_EXACT = frozenset({"ROOMING HOUSE"})
_B_PREFIXES = ("APARTMENT",)
# Residential historic property and vacant land are out of scope even though a prefix matches.
_OUT_EXACT = frozenset({"HIST PROP(RESIDENCE)"})
_OUT_PREFIXES = ("VACANT(",)


def normalize_description(s: str | None) -> str:
    """``" Apartment (Mixed  Use) "`` → ``"APARTMENT(MIXED USE)"``."""
    t = re.sub(r"\s+", " ", (s or "").upper()).strip()
    return re.sub(r"\s*\(\s*", "(", t).replace(" )", ")")


def category_for(description: str | None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for a PresentUse description, or ``None`` (out of scope)."""
    d = normalize_description(description)
    if not d or d in _OUT_EXACT or d.startswith(_OUT_PREFIXES):
        return None
    if d in _B_EXACT or d.startswith(_B_PREFIXES):
        return "B"
    if d in _F2_EXACT or d.startswith(_F2_PREFIXES) or "WAREHOUSE" in d:
        return "F2"
    if d in _F1_EXACT or d.startswith(_F1_PREFIXES):
        return "F1"
    return None


# --- file access -------------------------------------------------------------------------------

def _member_name(path: Path, prefix: str) -> str | None:
    """Name of the CSV in ``path`` (a zip, a directory, or the CSV itself) that starts with ``prefix``."""
    if path.is_dir():
        names = sorted(m.name for m in path.iterdir())
    elif path.suffix.lower() == ".csv":
        names = [path.name]
    elif zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            names = [Path(n).name for n in zf.namelist()]
    else:
        return None
    return next((n for n in names if n.lower().startswith(prefix) and n.lower().endswith(".csv")), None)


def _read(f: io.TextIOBase, name: str) -> Iterator[tuple[str, dict[str, str]]]:
    """Header names are normalized to lower case without spaces or underscores, so small layout
    edits (``Bldg Gross SqFt``) do not break the read."""
    reader = csv.reader(f)
    header = [re.sub(r"[\s_]+", "", h).lower().lstrip("﻿") for h in next(reader, [])]
    for values in reader:
        if any(values):
            yield name, dict(zip(header, values))


def _rows(paths: Iterable[Path], kind: str) -> Iterator[tuple[str, dict[str, str]]]:
    """Stream ``(member name, row)`` for one extract, from the first of ``paths`` that holds it."""
    csv.field_size_limit(1 << 30)
    prefix = _MEMBERS[kind]
    for p in paths:
        name = _member_name(p, prefix)
        if name is None:
            continue
        if p.is_dir() or p.suffix.lower() == ".csv":
            with open(p / name if p.is_dir() else p, newline="", encoding="latin-1") as f:
                yield from _read(f, name)
        else:
            with zipfile.ZipFile(p) as zf:
                member = next(n for n in zf.namelist() if Path(n).name == name)
                with zf.open(member) as raw:
                    yield from _read(io.TextIOWrapper(raw, encoding="latin-1", newline=""), name)
        return
    raise FileNotFoundError(f"no {prefix}*.csv among {[str(p) for p in paths]}")


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, years, values: the Assessor writes 0 when it has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def pin(r: dict[str, str]) -> str | None:
    """``Major`` + ``Minor`` as the 10-digit PIN, zero-padded; ``None`` if either is missing."""
    major, minor = _squeeze(r.get("major")), _squeeze(r.get("minor"))
    if not major or not minor or not (major + minor).isdigit():
        return None
    return major.zfill(6) + minor.zfill(4)


def _building_address(r: dict[str, str]) -> str | None:
    """Street line of a building or complex, ``"<street>, WA <zip>"``; the extracts carry no situs city."""
    street = _squeeze(r.get("address"))
    if not street:
        parts = (r.get("buildingnumber"), r.get("fraction"), r.get("directionprefix"), r.get("streetname"),
                 r.get("streettype"), r.get("directionsuffix"))
        street = " ".join(x for x in (_squeeze(p) for p in parts) if x)
    if not street or street == "0":
        return None
    zip_code = _squeeze(r.get("zipcode"))[:5]
    return f"{street}, WA {zip_code}" if zip_code.isdigit() else street


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [_squeeze(r.get("attnline")), _squeeze(r.get("addrline"))]
    city_state = _squeeze(r.get("citystate"))
    zip_code = _squeeze(r.get("zipcode")).rstrip("-")
    lines.append(" ".join(x for x in (city_state, zip_code) if x))
    return ", ".join(x for x in lines if x) or None


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


def read_lookup(paths: Iterable[str | Path], lookup_type: str = PRESENT_USE_LOOKUP_TYPE) -> dict[str, str]:
    """``{code: description}`` for one lookup type from the Lookup extract."""
    out: dict[str, str] = {}
    for _, r in _rows([Path(p) for p in paths], "lookup"):
        if _squeeze(r.get("lutype")) == lookup_type:
            out[_squeeze(r.get("luitem"))] = _squeeze(r.get("ludescription"))
    return out


def check_lookup(paths: Iterable[str | Path]) -> dict[str, list[str]]:
    """Which PresentUse descriptions each rule set recognises, and which it does not, for review."""
    report: dict[str, list[str]] = {"B": [], "F1": [], "F2": [], "out_of_scope": []}
    for code, desc in sorted(read_lookup(paths).items(), key=lambda kv: kv[0].zfill(4)):
        report[category_for(desc) or "out_of_scope"].append(f"{code} {desc}")
    return report


def read_roll(paths: Iterable[str | Path], *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per real-property account whose PresentUse maps into scope.

    ``paths`` are the extract zips (or unpacked directories / CSVs) for the account, parcel,
    commercial building, apartment complex and lookup files, in any order. ``categories`` limits the
    FactLot categories kept (default: the commercial scope); ``None`` keeps every parcel the Parcel
    extract lists, with ``state_category`` ``None`` for uses outside the mapping.
    """
    ps = [Path(p) for p in paths]
    wanted = None if categories is None else frozenset(c.upper() for c in categories)
    lookup = read_lookup(ps)
    # 1. Parcels in scope, with their use code and lot area.
    parcels: dict[str, dict[str, str | None]] = {}
    for _, r in _rows(ps, "parcel"):
        p = pin(r)
        if not p:
            continue
        code = _squeeze(r.get("presentuse"))
        category = category_for(lookup.get(code))
        if wanted is not None and category not in wanted:
            continue
        parcels[p] = {"code": code or None, "category": category, "lot": r.get("sqftlot"), "proptype": r.get("proptype")}
    # 2. Buildings: situs, gross area, year built.
    situs: dict[str, str] = {}
    area: dict[str, float] = defaultdict(float)
    built: dict[str, int] = {}
    for kind in ("commercial", "apartment"):
        try:
            rows = _rows(ps, kind)
            for _, r in rows:
                p = pin(r)
                if p not in parcels:
                    continue
                if p not in situs and (addr := _building_address(r)):
                    situs[p] = addr
                if kind == "commercial" and (a := _positive(r.get("bldggrosssqft"))):
                    area[p] += a
                if y := _positive(r.get("yrbuilt")):
                    built[p] = min(built.get(p, int(y)), int(y))
        except FileNotFoundError:
            continue  # a run without one of the building extracts still yields the parcel facts
    # 3. Accounts: values, tax year, taxpayer (when published), then yield in account-file order.
    seen: set[str] = set()
    for member, r in _rows(ps, "account"):
        p = pin(r)
        if p not in parcels or p in seen:
            continue
        seen.add(p)
        info = parcels[p]
        owner_name = _owner(r.get("taxpayername"))
        land_val, imps_val = _num(r.get("apprlandval")), _num(r.get("apprimpsval"))
        taxable = [v for v in (_num(r.get("taxablelandval")), _num(r.get("taxableimpsval"))) if v is not None]
        market = (land_val or 0) + (imps_val or 0) if land_val is not None or imps_val is not None else None
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=p,
            state_category=info["category"],
            account=p,
            situs_address=situs.get(p),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=False,  # the extract carries no confidentiality flag; names are simply not published
            land_area_sf=_positive(info["lot"]),
            improvement_area_sf=area[p] if area.get(p) else None,
            year_built=built.get(p),
            market_value=market,
            appraised_value=sum(taxable) if taxable else None,
            tax_year=int(y) if (y := _num(r.get("billyr"))) else None,
            locator=f"{member} PIN {p}",
            local_use_code=info["code"],
        )


def build(snapshot_paths: Iterable[str | Path], db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True) -> IngestStats:
    """Ingest one publication of the extracts into a registry file (created if missing).

    Every input file is registered as a snapshot; the facts cite the Real Property Account extract
    (the first path whose name matches it), with locators naming the member file and PIN.
    """
    paths = [Path(p) for p in snapshot_paths]
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snaps = {p: reg.add_snapshot(SOURCE.source_id, p, as_of, retrieved_at) for p in paths}
        account = next((p for p in paths if _member_name(p, _MEMBERS["account"]) is not None), paths[0])
        return reg.ingest_parcels(read_roll(paths), snaps[account], state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.wa_king", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshots", nargs="+", help="the archived extract zips: Real Property Account, Parcel, "
                                                 "Commercial Building, Apartment Complex, Lookup")
    ap.add_argument("--db", required=True, help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="publication date, YYYY-MM-DD (the date shown on the download page)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this publication")
    ap.add_argument("--check-lookup", action="store_true",
                    help="print how each PresentUse description maps (review before the first load) and exit")
    args = ap.parse_args(argv)
    if args.check_lookup:
        print(json.dumps(check_lookup(args.snapshots), indent=2))
        return 0
    stats = build(args.snapshots, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
