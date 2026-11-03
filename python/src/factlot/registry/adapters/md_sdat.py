"""Maryland SDAT "Real Property Assessments" on opendata.maryland.gov → ``ParcelRecord``.

The State Department of Assessments and Taxation (SDAT) and the Maryland Department of Planning (MDP)
publish one statewide Socrata dataset, ``ed4q-f8tm`` ("Maryland Real Property Assessments_Hidden
Property Owner Names"), with one row per real-property tax account in all 24 jurisdictions (23
counties and Baltimore City), refreshed monthly.

**The publisher withholds owner names.** The dataset title says so and its 223 columns carry no owner
name and no owner address, only the owner-occupancy code. Every record this adapter yields has
``owner_name=None``; ``owner_confidential`` stays ``False`` because the withholding is the publisher's
blanket design, not a per-owner confidentiality flag (the same choice as ``wa_king``).

Layout (confirmed on SoQL ``.csv`` exports of 2026-11-03): the CSV header uses the portal's API field
names (long, lower case, ending in the SDAT field number). The adapter reads these columns:

- ``account_id_mdp_field_acctid`` — the tax account id: SDAT county code (2), district (2), account
  number (the rest). It is the parcel key (``APN``) and is unique statewide.
- ``county_name_mdp_field_cntyname`` — the jurisdiction, mapped to its county FIPS in ``COUNTY_FIPS``.
- ``land_use_code_mdp_field_lu_desclu_sdat_field_50`` — SDAT field 50, written ``Commercial (C)``: the
  description with the code letter in parentheses. Mapped in ``CATEGORY_BY_LU``: ``C`` commercial and
  ``CC`` commercial condominium → ``F1``, ``I`` industrial → ``F2``, ``M`` apartments → ``B``. The other
  values (``R`` residential, ``U`` residential condominium, ``TH`` town house, ``E`` exempt, ``EC`` exempt
  commercial, ``A`` agricultural, ``CR`` commercial residential and ``RC`` residential commercial (mixed
  use), ``CA`` country club, ``MA`` marsh land) yield no record. Definitions: the dataset's
  ``Real_Property_Records_Documentation.pdf`` and the Fields Reference dataset ``w8th-47fz``.
- Situs: premise address fields 20–28 (number with leading zeros, suffix, direction, name, type, city,
  ZIP, condominium unit); ``00000`` and ``0000`` mean none. When the premise has no street name, MDP's
  cleaned ``mdp_street_address`` is used.
- Areas: ``c_a_m_a_system_data_land_area`` with the unit of measure field (``S`` square feet, ``A``
  acres; blank means the unit is unknown, so no area is recorded), ``structure_area_sq_ft``,
  ``year_built_yyyy`` (``0000`` = none).
- Values: ``market_value`` is the current cycle's full cash value, land (SDAT field 164) plus
  improvements (165); ``appraised_value`` is the current assessment year's total assessment (172), which
  is the three-year phase-in value. Zero means none.
- ``record_deletion_date`` (field 398): accounts with a deletion date are skipped.

Usage: ``python -m factlot.registry.adapters.md_sdat ed4q-f8tm.csv registry.db --as-of 2026-10-05 --tax-year 2027``
(``--as-of`` is the portal's ``date_of_most_recent_open_data_portal_record_update``; the file has one
such date). One file per county is loaded at the same ``--as-of``; do not use ``--full-roll`` unless the
file holds every county that was loaded before.
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

STATE_FIPS = "24"
ACCOUNT_SYSTEM = "sdat_account"
SQFT_PER_ACRE = 43560

SOURCE = Source(
    source_id="md-sdat-real-property",
    publisher="Maryland State Department of Assessments and Taxation (SDAT) and Maryland Department of Planning (MDP)",
    title="Maryland Real Property Assessments (statewide, owner names hidden), opendata.maryland.gov dataset ed4q-f8tm",
    url="https://opendata.maryland.gov/d/ed4q-f8tm",
    state_fips=STATE_FIPS,
    county_fips=None,  # statewide: each record carries its own county
    license="Public Domain (portal license field PUBLIC_DOMAIN); attribution field 'SDAT and MDP'",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="permitted",  # public domain
    attribution="Maryland State Department of Assessments and Taxation and Maryland Department of Planning, via opendata.maryland.gov",
    terms_reviewed="2026-11-03",
)

# The portal's jurisdiction names (county_name_mdp_field_cntyname) → county FIPS (without the state).
COUNTY_FIPS = {
    "ALLEGANY": "001", "ANNE ARUNDEL": "003", "BALTIMORE": "005", "CALVERT": "009", "CAROLINE": "011",
    "CARROLL": "013", "CECIL": "015", "CHARLES": "017", "DORCHESTER": "019", "FREDERICK": "021",
    "GARRETT": "023", "HARFORD": "025", "HOWARD": "027", "KENT": "029", "MONTGOMERY": "031",
    "PRINCE GEORGE'S": "033", "QUEEN ANNE'S": "035", "ST. MARY'S": "037", "SOMERSET": "039",
    "TALBOT": "041", "WASHINGTON": "043", "WICOMICO": "045", "WORCESTER": "047", "BALTIMORE CITY": "510",
}

# SDAT land use letter code (field 50) → FactLot category. Everything else is out of scope.
CATEGORY_BY_LU = {"C": "F1", "CC": "F1", "I": "F2", "M": "B"}

_ACCT = "account_id_mdp_field_acctid"
_COUNTY = "county_name_mdp_field_cntyname"
_LU = "land_use_code_mdp_field_lu_desclu_sdat_field_50"
_P_NUM = "premise_address_number_mdp_field_premsnum_sdat_field_20"
_P_SFX = "premise_address_number_suffix_sdat_field_21"
_P_DIR = "premise_address_direction_mdp_field_premsdir_sdat_field_22"
_P_NAME = "premise_address_name_mdp_field_premsnam_sdat_field_23"
_P_TYPE = "premise_address_type_mdp_field_premstyp_sdat_field_24"
_P_CITY = "premise_address_city_mdp_field_premcity_sdat_field_25"
_P_ZIP = "premise_address_zip_code_mdp_field_premzip_sdat_field_26"
_P_UNIT = "premise_address_condominium_unit_no_sdat_field_28"
_M_ADDR = "mdp_street_address_mdp_field_address"
_M_CITY = "mdp_street_address_city_mdp_field_city"
_M_ZIP = "mdp_street_address_zip_code_mdp_field_zipcode"
_LAND_VAL = "current_cycle_data_land_value_mdp_field_names_nfmlndvl_curlndvl_and_sallndvl_sdat_field_164"
_IMPR_VAL = "current_cycle_data_improvements_value_mdp_field_names_nfmimpvl_curimpvl_and_salimpvl_sdat_field_165"
_TOTAL = "current_assessment_year_total_assessment_sdat_field_172"
_YEAR = "c_a_m_a_system_data_year_built_yyyy_mdp_field_yearblt_sdat_field_235"
_STRUCT = "c_a_m_a_system_data_structure_area_sq_ft_mdp_field_sqftstrc_sdat_field_241"
_LAND = "c_a_m_a_system_data_land_area_mdp_field_landarea_sdat_field_242"
_LUOM = "c_a_m_a_system_data_land_unit_of_measure_mdp_field_luom_sdat_field_243"
_DELETED = "record_deletion_date_yyyy_mm_dd_sdat_field_398"


def lu_code(value: str | None) -> str | None:
    """The code letters of a land use value: ``'Commercial Condominium (CC)'`` → ``'CC'``."""
    m = re.search(r"\(([A-Za-z]+)\)\s*$", value or "")
    return m.group(1).upper() if m else None


def state_category(value: str | None) -> str | None:
    """FactLot category for an SDAT land use value, or ``None`` when out of scope."""
    code = lu_code(value)
    return CATEGORY_BY_LU.get(code) if code else None


def _text(s: str | None) -> str:
    return " ".join((s or "").split())


def _num(s: str | None) -> float | None:
    try:
        return float((s or "").strip().replace(",", "")) if (s or "").strip() else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Values, areas, and years: the publisher writes 0 (or ``0000``) when it has no figure."""
    v = _num(s)
    return v if v and v > 0 else None


def _zip(s: str | None) -> str:
    z = _text(s)
    return "" if not z or set(z) == {"0"} else z[:5]


def _number(s: str | None) -> str:
    n = _text(s).lstrip("0")
    return n


def _situs(r: dict[str, str]) -> str | None:
    street = _text(" ".join(x for x in (_text(r.get(_P_DIR)), _text(r.get(_P_NAME)), _text(r.get(_P_TYPE))) if x))
    if street:
        number = _number(r.get(_P_NUM)) + _text(r.get(_P_SFX))
        unit = _text(r.get(_P_UNIT))
        line = " ".join(x for x in (number, street, f"UNIT {unit}" if unit else "") if x)
        city = _text(r.get(_P_CITY)) or _text(r.get(_M_CITY))
        zip5 = _zip(r.get(_P_ZIP)) or _zip(r.get(_M_ZIP))
    else:
        line = _text(r.get(_M_ADDR))
        if not line:
            return None
        city, zip5 = _text(r.get(_M_CITY)), _zip(r.get(_M_ZIP))
    tail = " ".join(x for x in (city, "MD", zip5) if x)
    return f"{line}, {tail}"


def _land_area_sf(r: dict[str, str]) -> float | None:
    area = _positive(r.get(_LAND))
    if area is None:
        return None
    unit = _text(r.get(_LUOM)).upper()
    if unit == "S":
        return area
    if unit == "A":
        return round(area * SQFT_PER_ACRE, 2)
    return None  # blank or unknown unit of measure: no area is better than a wrong one


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        yield from csv.DictReader(f)


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              tax_year: int | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per tax account in scope.

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2); ``None``
    keeps every account with a mapped county, with ``state_category`` ``None`` for out-of-scope land
    use. Rows of an unknown jurisdiction and rows with a deletion date are skipped. ``tax_year`` is
    recorded as given (the file has no year column the adapter can rely on).
    """
    keep = None if categories is None else frozenset(c.upper() for c in categories)
    for r in _rows(path):
        acct = _text(r.get(_ACCT))
        county = COUNTY_FIPS.get(_text(r.get(_COUNTY)).upper())
        if not acct or not county:
            continue
        deleted = _text(r.get(_DELETED))
        if deleted and set(deleted) - set("0."):
            continue
        category = state_category(r.get(_LU))
        if keep is not None and category not in keep:
            continue
        land, impr = _positive(r.get(_LAND_VAL)), _positive(r.get(_IMPR_VAL))
        market = (land or 0) + (impr or 0)
        year = _positive(r.get(_YEAR))
        yield ParcelRecord(
            county_fips=county,
            apn=acct,
            state_category=category,
            account=acct,
            situs_address=_situs(r),
            owner_name=None,  # withheld by the publisher
            owner_mailing_address=None,
            owner_confidential=False,
            land_area_sf=_land_area_sf(r),
            improvement_area_sf=_positive(r.get(_STRUCT)),
            year_built=int(year) if year else None,
            market_value=market or None,
            appraised_value=_positive(r.get(_TOTAL)),
            tax_year=tax_year,
            locator=f"{Path(path).name} account {acct}",
            local_use_code=lu_code(r.get(_LU)),
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          tax_year: int | None = None, full_roll: bool = False) -> IngestStats:
    """Ingest one archived CSV into a registry file (created if missing).

    ``full_roll`` defaults to ``False`` because the source is loaded one county file at a time.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, tax_year=tax_year), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.md_sdat", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the CSV as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="date of the portal record update, YYYY-MM-DD")
    ap.add_argument("--tax-year", type=int, help="tax year to record (e.g. 2027 for the cycle year in the file)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true",
                    help="retire accounts missing from this file (only when the file covers every county loaded before)")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  tax_year=args.tax_year, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
