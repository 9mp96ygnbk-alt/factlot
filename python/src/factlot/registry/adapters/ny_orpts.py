"""New York State Department of Taxation and Finance (ORPTS), "Property Assessment Data from Local
Assessment Rolls" (Open NY, data.ny.gov, dataset 7vem-aaz7) → ``ParcelRecord``.

Layout (confirmed 2026-11-03 against the SODA CSV and the portal's column list): one row per parcel
per roll year for every city and town in New York State except New York City, filed by 996 local
governments. The file is large (about 4.7 million rows a year), so the collector fetches one filtered
CSV per county (``roll_year``, ``county_name`` and the property-class range in the URL) with a column
subset. The SODA API spells the columns in lower case (``roll_year``, ``county_name``, ...); the
portal's export uses display names ("Roll Year", "County Name", ...); both are accepted. Key columns:

- ``county_name`` — mapped to the 3-digit county FIPS by ``COUNTY_FIPS`` (the five boroughs of New
  York City are not in this dataset). ``municipality_name`` is the assessing city or town and
  ``swis_code`` the six-digit SWIS (it identifies a village inside a town).
- ``swis_code`` + ``print_key_code`` — the publisher's tip: "For a unique identifier for every property
  in New York State, combine the SWIS code and print key fields." The registry strips punctuation from
  an APN, and print keys differ only by punctuation ("11" and "1.1" are different Erie parcels), so the
  APN is built by ``apn()``, which keeps every character (punctuation is written as ``x`` plus its hex
  code, a literal ``x`` as ``xx``); the readable ``<swis>-<print key>`` is the account (crosswalk
  system ``ny_swis_printkey``).
- ``property_class`` — the ORPTS three-digit property type classification code, defined on the
  publisher's page "Property type classification codes"
  (``tax.ny.gov/research/property/assess/manuals/prclas.htm``); ``property_class_description`` its
  text. The first digit is the category: 1xx agricultural, 2xx residential, 3xx vacant land, 4xx
  commercial ("Property used for the sale of goods and/or services"; hotels, motels and apartments
  are commercial), 5xx recreation and entertainment, 6xx community services, 7xx industrial, 8xx
  public services, 9xx wild, forested and conservation lands. The roll also carries local codes the
  page does not list (412 Condominium, 413 Co-operative). Mapped by ``category()``.
- Owners: ``primary_owner_first_name``, ``primary_owner_mi``, ``primary_owner_last_name``,
  ``primary_owner_suffix`` (and three additional owners, not read). Counties fill them differently:
  Suffolk puts the whole name ("LAST, FIRST") in the last-name column; Erie, Monroe and Westchester
  split a person across first and last; companies are written in the last-name column. The adapter
  joins the non-blank parts; the registry keeps only organisations.
- Situs: ``parcel_address_number``, ``parcel_address_street``, ``parcel_address_suff`` plus the
  municipality (the roll has no ZIP for the parcel). Mailing address: prefix, number, street,
  suffix, PO box, city, state, ZIP, country.
- ``full_market_value`` (the publisher's estimate of market value at the roll's valuation date; 0 or
  blank where the municipality does not report one, common in Suffolk) → ``market_value``;
  ``assessment_total`` is an assessed (fractional) value and is not stored. The roll has no building
  area and no year built; ``front`` and ``depth`` are frontage and depth in feet, not an area.

Usage: ``python -m factlot.registry.adapters.ny_orpts ny-monroe-2025.csv registry.db --as-of 2026-04-24 --tax-year 2025``
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

STATE_FIPS = "36"
ACCOUNT_SYSTEM = "ny_swis_printkey"

SOURCE = Source(
    source_id="ny-orpts-rolls",
    publisher="New York State Department of Taxation and Finance, Office of Real Property Tax Services",
    title="Property Assessment Data from Local Assessment Rolls (Open NY dataset 7vem-aaz7)",
    url="https://data.ny.gov/Government-Finance/Property-Assessment-Data-from-Local-Assessment-Rolls/7vem-aaz7",
    state_fips=STATE_FIPS,
    county_fips=None,  # one file per county; each record carries its own
    license="OPEN-NY Terms of Use (non-exclusive, revocable licence; no attribution, share-alike or pre-approval requirement; lawful use only)",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="permitted",
    attribution="New York State Department of Taxation and Finance",
    terms_reviewed="2026-11-03",
)

# County name (upper case, punctuation removed) → 3-digit county FIPS. New York City's boroughs are
# covered by ny_nyc and are not in this dataset.
COUNTY_FIPS = {
    "ALBANY": "001", "ALLEGANY": "003", "BROOME": "007", "CATTARAUGUS": "009", "CAYUGA": "011",
    "CHAUTAUQUA": "013", "CHEMUNG": "015", "CHENANGO": "017", "CLINTON": "019", "COLUMBIA": "021",
    "CORTLAND": "023", "DELAWARE": "025", "DUTCHESS": "027", "ERIE": "029", "ESSEX": "031",
    "FRANKLIN": "033", "FULTON": "035", "GENESEE": "037", "GREENE": "039", "HAMILTON": "041",
    "HERKIMER": "043", "JEFFERSON": "045", "LEWIS": "049", "LIVINGSTON": "051", "MADISON": "053",
    "MONROE": "055", "MONTGOMERY": "057", "NASSAU": "059", "NIAGARA": "063", "ONEIDA": "065",
    "ONONDAGA": "067", "ONTARIO": "069", "ORANGE": "071", "ORLEANS": "073", "OSWEGO": "075",
    "OTSEGO": "077", "PUTNAM": "079", "RENSSELAER": "083", "ROCKLAND": "087", "ST LAWRENCE": "089",
    "SARATOGA": "091", "SCHENECTADY": "093", "SCHOHARIE": "095", "SCHUYLER": "097", "SENECA": "099",
    "STEUBEN": "101", "SUFFOLK": "103", "SULLIVAN": "105", "TIOGA": "107", "TOMPKINS": "109",
    "ULSTER": "111", "WARREN": "113", "WASHINGTON": "115", "WAYNE": "117", "WESTCHESTER": "119",
    "WYOMING": "121", "YATES": "123",
}

# ORPTS property classes that are multifamily: 411 Apartments and 413 Co-operative. 410 "Living
# Accomodations" (mostly seasonal and single-family homes in Suffolk), 412 Condominium (residential
# condominium units) and 414-418 lodging are not apartment buildings; lodging is commercial.
_B_CLASSES = frozenset({"411", "413"})
# 4xx commercial classes that are residential in practice and stay out of scope.
_NOT_COMMERCIAL = frozenset({"410", "412"})
# 7xx industrial: 700 Industrial, 710-715 manufacturing and processing, 720-729 mining and quarrying.
# Oil and gas wells (730-739) and pipelines (740-749) are production and transmission rights, not
# industrial buildings, and stay out of scope.
_F2_CLASSES = frozenset({"700", "710", "711", "712", "713", "714", "715", "716", "717", "718", "719",
                         "720", "721", "722", "723", "724", "725", "726", "727", "728", "729"})

_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "UNKNOWN OWNERS", "N/A", "NONE"})


def category(property_class: str | None) -> str | None:
    """FactLot category (``B``, ``F1``, ``F2``) for an ORPTS property class, or ``None`` when out of scope.

    ``B`` for 411 and 413, ``F1`` for the other 4xx commercial classes (not 410 or 412), ``F2`` for the
    industrial classes in ``_F2_CLASSES``. Vacant land (3xx, including 330 and 340 in commercial and
    industrial areas), residential, recreation, community service, public service and wild-land
    classes yield ``None``.
    """
    code = (property_class or "").strip()
    if code.endswith(".0"):
        code = code[:-2]
    if not re.fullmatch(r"\d{3}", code):
        return None
    if code in _B_CLASSES:
        return "B"
    if code in _NOT_COMMERCIAL:
        return None
    if code[0] == "4":
        return "F1"
    if code in _F2_CLASSES:
        return "F2"
    return None


def apn(swis: str | None, print_key: str | None) -> str | None:
    """Lower-case alphanumeric parcel key that keeps every character of the print key.

    The registry removes punctuation from an APN, which would merge print keys that differ only by
    ``.``, ``-`` or ``/``. Each such character is written as ``x`` followed by its two-digit hex code
    and a literal ``x`` as ``xx``, so distinct print keys stay distinct: ``472003`` + ``10.-1-22`` is
    ``47200310x2ex2d1x2d22``.
    """
    s = re.sub(r"\s+", "", swis or "").lower()
    p = re.sub(r"\s+", "", print_key or "").lower()
    if not s or not p:
        return None
    out = []
    for ch in p:
        if ch == "x":
            out.append("xx")
        elif ch.isascii() and ch.isalnum():
            out.append(ch)
        else:
            out.append(f"x{ord(ch):02x}")
    return s + "".join(out)


_ALIASES = {"additional_owner_1_first_name": "additional_owner_1_first", "additional_owner_2_first_name": "additional_owner_2_first",
            "additional_owner_3_first_name": "additional_owner_3_first"}


def _key(header: str) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")
    return _ALIASES.get(k, k)


def _text(s: str | None) -> str:
    return " ".join((s or "").split())


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "").replace("$", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    v = _num(s)
    return v if v and v > 0 else None


def county_fips(name: str | None) -> str | None:
    key = re.sub(r"\s+", " ", re.sub(r"[^A-Z ]+", " ", (name or "").upper())).strip()
    return COUNTY_FIPS.get(key)


def _owner(r: dict[str, str]) -> str | None:
    parts = [_text(r.get(k)) for k in ("primary_owner_first_name", "primary_owner_mi", "primary_owner_last_name", "primary_owner_suffix")]
    name = " ".join(p for p in parts if p)
    return None if not name or name.upper() in _PLACEHOLDER_OWNERS else name


def _situs(r: dict[str, str]) -> str | None:
    street = _text(r.get("parcel_address_street"))
    if not street:
        return None
    line = " ".join(x for x in (_text(r.get("parcel_address_number")), street, _text(r.get("parcel_address_suff"))) if x)
    place = " ".join(x for x in (_text(r.get("municipality_name")).upper(), "NY") if x)
    return f"{line}, {place}"


def _mailing_address(r: dict[str, str]) -> str | None:
    number_street = " ".join(x for x in (_text(r.get("mailing_address_prefix")), _text(r.get("mailing_address_number")),
                                         _text(r.get("mailing_address_street")), _text(r.get("mailing_address_suff"))) if x)
    po = _text(r.get("mailing_address_po_box"))
    state_zip = " ".join(x for x in (_text(r.get("mailing_address_state")), _text(r.get("mailing_address_zip"))) if x)
    country = _text(r.get("mailing_address_country"))
    if country.upper() in ("US", "USA", "UNITED STATES"):
        country = ""
    parts = [number_street, f"PO BOX {po}" if po and not number_street else "", _text(r.get("mailing_address_city")), state_zip, country]
    return ", ".join(p for p in parts if p) or None


def _rows(path: str | Path) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f)
        header = [_key(h) for h in next(reader)]
        for values in reader:
            if any(v.strip() for v in values):
                yield dict(zip(header, values))


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              tax_year: int | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per roll row in scope.

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2);
    ``None`` keeps every row, with ``state_category`` ``None`` for out-of-scope classes. ``tax_year``
    defaults to the row's own ``roll_year``. Rows whose county is not a known New York county, or
    that lack a SWIS or print key, are skipped (they cannot be keyed).
    """
    keep = None if categories is None else frozenset(c.upper() for c in categories)
    name = Path(path).name
    for r in _rows(path):
        county = county_fips(r.get("county_name"))
        key = apn(r.get("swis_code"), r.get("print_key_code"))
        if county is None or key is None:
            continue
        pclass = _text(r.get("property_class"))
        cat = category(pclass)
        if keep is not None and cat not in keep:
            continue
        owner = _owner(r)
        year = tax_year if tax_year is not None else (int(y) if (y := _positive(r.get("roll_year"))) else None)
        yield ParcelRecord(
            county_fips=county,
            apn=key,
            state_category=cat,
            account=f"{_text(r.get('swis_code'))}-{_text(r.get('print_key_code'))}",
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner else None,
            owner_confidential=False,
            market_value=_positive(r.get("full_market_value")),
            tax_year=year,
            locator=f"{name} SWIS {_text(r.get('swis_code'))} print key {_text(r.get('print_key_code'))}",
            local_use_code=pclass[:-2] if pclass.endswith(".0") else (pclass or None),
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          tax_year: int | None = None, full_roll: bool = False) -> IngestStats:
    """Ingest one archived county CSV into a registry file (created if missing).

    ``full_roll`` is off by default: each snapshot holds one county, so treating it as the complete
    roll would retire every other county's parcels. Turn it on only for a statewide file.
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
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ny_orpts", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the county CSV as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="dataset update date, YYYY-MM-DD (the portal's 'data last updated')")
    ap.add_argument("--tax-year", type=int, help="roll year recorded as tax_year (default: each row's roll_year)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true", help="the file is the complete statewide roll: retire parcels missing from it")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  tax_year=args.tax_year, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
