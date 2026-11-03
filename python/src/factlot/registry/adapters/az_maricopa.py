"""Maricopa County Assessor (Phoenix, Arizona): ``Secured_Master.zip`` → ``ParcelRecord``.

Layout (confirmed on the file published 2026-10-26, read 2026-11-02): a zip holding
``Data/Secured_Master_BK<100|200|300|400|500>.txt`` (one pipe-delimited file per parcel-book series,
header row, CRLF line endings, no quoting) and ``File Spec/Secured Master.pdf`` (the publisher's
39-column specification, revised 2023-02-02). The spec's column names are used below; the file's
own header spells them differently (``FolioKey``, ``OwnerName``, ``SitusAddress``, ``FCV``, ``LPV``,
``PUC``, ``TotalSqFt``, ``ConstrYear`` …), so rows are read by position and the header is skipped.

- ``Parcel_Number`` — the 8- or 9-character Assessor's parcel number ``BBBMMIIIS`` (book, map,
  item, optional split letter), the parcel key. It is shown hyphenated (``177-07-116``,
  ``177-07-015B``) everywhere else the Assessor publishes it, so the registry stores that form.
- ``Property_Use_Code`` — the 4-digit Arizona Property Use Code (PUC) from the Department of
  Revenue's statewide *Property Use Code Manual*: the first two digits are the general use
  (``03`` multiple residential, ``10``–``27`` commercial, ``30``–``39`` industrial …), the third a
  subcategory, the fourth a detail. ``category`` below maps it to the registry's categories; the PUC
  itself is kept in ``local_use_code``.
- ``Property_Type`` — ``RESIDENTIAL``, ``COMMERCIAL`` or ``VACANT``, the Assessor's broad division.
- ``Land_Class`` / ``Improvement_Class`` — the Arizona legal class with its proportion
  (``100% 1.12`` commercial, ``100% 4.2`` rental residential, ``60% 2.R; 40% 1.12`` mixed). The legal
  class sets the assessment ratio, not the use, so it is not used for scope: a 200-unit complex
  and a rented house are both class 4.2.
- Situs: ``Situs_Address`` (street line, with the unit already appended), ``Situs_Suite``,
  ``Situs_City``, ``Situs_Zip_Code`` (blank for some parcels).
- Owner: ``Owner_Name`` (joint owners separated by ``/``), ``Owner_Mail_Address_1``/``_2``,
  ``Owner_Mail_City``, ``Owner_Mail_State``, ``Owner_Mail_Zip_Code`` (5, 9 or hyphenated digits),
  ``Owner_Mail_Country`` (ISO-3 code: ``USA``, ``CAN`` …).
- Values: ``Total_Full_Cash_Value`` (the Assessor's market value: land + improvements) and
  ``Limited_Property_Value`` (the taxable basis since 2015, capped at 5 % growth: the Arizona
  analogue of a Texas appraised value).
- ``Total_Square_Feet`` is the land area in square feet (it is filled for vacant land and for
  commercial parcels whose ``Living_Area`` is 0); ``Living_Area`` is the residential living area;
  ``Construction_Year``; ``Number_Of_Units`` (filled for apartment complexes).

Commercial buildings have no floor area in the Secured Master. ``read_roll`` takes it from the
Assessor's ``Commercial_Master.zip`` (``Data/Commercial_Master.txt``: one row per commercial
improvement and occupancy, 32 fixed columns then 120 repeating component groups, header row of
generic ``Column N`` names) and ``Apartment_Master.zip`` (``Data/Apartment_Master.txt``: one row per
apartment economic unit, header row) when they are given.

Usage: ``python -m factlot.registry.adapters.az_maricopa Secured_Master.zip registry.db --as-of 2026-10-26
[--commercial Commercial_Master.zip] [--apartments Apartment_Master.zip] [--tax-year 2027]``
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "04"
COUNTY_FIPS = "013"
ACCOUNT_SYSTEM = "maricopa_apn"

SOURCE = Source(
    source_id="az-maricopa-assessor",
    publisher="Maricopa County Assessor's Office",
    title="Secured Master data set (Secured_Master.zip), with the Commercial and Apartment Masters",
    url="https://mcassessor.maricopa.gov/page/data_sales/",
    state_fips=STATE_FIPS,
    county_fips=COUNTY_FIPS,
    license="Public record (A.R.S. Title 39); no license stated, disclaimer only. Commercial use of Arizona "
            "public records requires a stated commercial purpose (A.R.S. 39-121.03)",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="unknown",  # not addressed for the free downloads; see the review record
    attribution="Maricopa County Assessor's Office",
    terms_reviewed="2026-11-02",
)

# Secured Master (by Book series), file specification revised 2023-02-02: the 39 columns in order.
SECURED_COLUMNS = [
    "Parcel_Number", "Owner_Name", "Owner_Mail_Address_1", "Owner_Mail_Address_2", "Owner_Mail_City",
    "Owner_Mail_State", "Owner_Mail_Zip_Code", "Owner_Mail_Country", "Situs_Address", "Situs_Suite", "Situs_City",
    "Situs_Zip_Code", "Property_Type", "Deed_Number", "Deed_Date", "Deed_Type", "Land_Full_Cash_Value",
    "Improvement_Full_Cash_Value", "Total_Full_Cash_Value", "Total_Full_Cash_Value_Assessed",
    "Limited_Property_Value", "Limited_Property_Value_Assessed", "Property_Use_Code", "Lot", "Block", "Tract",
    "Land_Class", "Improvement_Class", "Rental_Indicator", "Living_Area", "Total_Square_Feet", "Construction_Year",
    "Pool_Size", "Sale_Price", "Sale_Date", "MCR_Number", "Subdivision_Name", "Number_Of_Units", "Tax_Area_Code",
]

# Commercial Master (R1209 ST42090, modified 2024-03-18): the 32 fixed columns before the 120
# repeating 12-column component groups (1,472 columns in all).
COMMERCIAL_COLUMNS = [
    "County_ID", "Appraiser_Number", "Parcel_Book", "Parcel_Map", "Parcel_Item", "Parcel_Split_Letter",
    "Work_Check_Digit", "IPR_Indicator", "Improvement_ID", "Occupancy_Number", "Occupancy_Perimeter",
    "Occupancy_Rank", "Structure_Class", "Replacement_FCV", "LOC_Replacement_FCV", "Assessed_FCV",
    "Number_of_Stories", "Story_Height", "Ground_Floor_Perimeter", "Ground_Floor_Area", "Total_Floor_Area",
    "Construction_Year", "Completion_Percent", "Obsolete_Percent", "Modernization_Percent",
    "Physical_Condition_Percent", "Process_Status_Indicator", "Review_Due_Code", "Percent_of_Ownership",
    "Quality_Ranking", "Effective_Construction_Year", "Sub_Market_Adjustment",
]

# Apartment Master (R122 ST42100, revised 2024-03-11): 39 columns, one row per economic unit.
APARTMENT_COLUMNS = [
    "Econ_Unit", "Lead_Parcel", "Complex_Name", "PUC", "Land_FCV", "Impr_FCV", "Utilities", "Fireplace",
    "One_Bdrm", "Two_Bdrm", "Three_Bdrm", "Other", "Studio", "One_Bdrm_Rate", "Two_Bdrm_Rate", "Three_Bdrm_Rate",
    "Other_Rate", "Studio_Rate", "Income_Source", "Ground_Flr_Perimeter", "Ground_Flr_Area", "Total_Flr_Area",
    "Story_Count", "Height", "Construction_Yr", "Situs_Address", "Situs_Unit", "Situs_City", "Situs_Zip",
    "Owner_Name", "In_Care_Of", "Address_1", "Address_2", "City", "State", "Zip", "Sum_Land_Sz", "Land_Size",
    "Num_Units",
]

# Property Use Code (first two digits) → registry category, from the Department of Revenue's
# Property Use Code Manual (revised 2011-02-07), section headings:
#   04 hotels, 05 motels, 06 resorts; 10 miscellaneous commercial (including 10-7 "associated
#   parcel", land that serves a commercial parcel), 11 convenience markets / retail strip stores /
#   supermarkets, 12 store combined with other uses, 13 department stores, 14 shopping centers,
#   15 office buildings, 16 banks, 17 service stations / auto repair, 18 vehicle sales / leasing /
#   storage, 19 care facilities, 20 restaurants / bars, 21 hospitals / medical clinics, 22 race
#   tracks / private air fields / animal boarding, 23 cemeteries / mortuaries, 24 golf courses,
#   25 theaters / amusement, 26 parking facilities, 27 clubs and lodges, 29 privately-owned schools,
#   89 converted-use property (a residence or other building converted to office, retail,
#   restaurant, services, care, medical or other commercial use);
#   30 industrial properties (manufacturing, processing, mining and quarrying, lumber, co-generation),
#   31–36 unassigned in the industrial range, 37 industrial warehouses (warehousing, truck
#   terminals, mini-storage, office/retail warehouses), 38–39 unassigned.
# 03 is multiple residential; only its apartment subcategories (third digit 5, 6, 7 = 5–24, 25–99,
# 100 or more units) are multifamily in the registry's sense. Mixed complexes (031), duplexes
# (032), triplexes (033), fourplexes (034), boarding houses (038) and cooperatives (039) are out.
# 28 is partially complete structures, coded 28 + the two-digit use of the finished building.
_F1_PREFIXES = frozenset({"04", "05", "06", *(f"{n}" for n in range(10, 28)), "29", "89"})
_F2_PREFIXES = frozenset(f"{n}" for n in range(30, 40))
_B_PREFIXES = frozenset({"035", "036", "037"})
_PARTIAL = "28"


def category(puc: str | None) -> str | None:
    """Registry category for a Property Use Code, or ``None`` when the use is out of scope."""
    p = re.sub(r"\D", "", puc or "")
    if len(p) < 3:
        return None
    if p[:3] in _B_PREFIXES:
        return "B"
    head = p[:2]
    if head == _PARTIAL:
        head = p[2:4]
        if len(head) < 2 or head == "03":
            return None
    if head in _F1_PREFIXES:
        return "F1"
    if head in _F2_PREFIXES:
        return "F2"
    return None


def format_apn(parcel_no: str) -> str:
    """``17707015B`` → ``177-07-015B``, the Assessor's display form; other shapes pass through."""
    p = parcel_no.strip().upper()
    m = re.fullmatch(r"(\d{3})(\d{2})(\d{3})([A-Z]?)", p)
    return f"{m[1]}-{m[2]}-{m[3]}{m[4]}" if m else p


def _members(path: str | Path) -> Iterator[tuple[str, io.TextIOBase]]:
    """Open each ``.txt`` member of the zip (or of an unpacked directory), in name order."""
    p = Path(path)
    if p.is_dir():
        for member in sorted(x for x in p.rglob("*") if x.is_file() and x.name.lower().endswith(".txt")):
            with open(member, newline="", encoding="latin-1") as f:
                yield member.name, f
        return
    with zipfile.ZipFile(p) as zf:
        for name in sorted(n for n in zf.namelist() if n.lower().endswith(".txt")):
            with zf.open(name) as raw:
                yield Path(name).name, io.TextIOWrapper(raw, encoding="latin-1", newline="")


def _rows(path: str | Path, columns: list[str]) -> Iterator[tuple[str, dict[str, str]]]:
    """Stream ``(member name, row)`` from pipe-delimited members, naming columns by position.

    The first line of each member is its header; it is skipped whether it carries the spec's names,
    the file's own spellings, or generic ``Column N`` labels (the Commercial Master).
    """
    csv.field_size_limit(1 << 30)
    n = len(columns)
    for name, f in _members(path):
        first = True
        for fields in csv.reader(f, delimiter="|", quoting=csv.QUOTE_NONE):
            if first:
                first = False
                if fields and not re.fullmatch(r"\s*\d*\s*", fields[0]):
                    continue  # a header: the key column is never alphabetic
            if not fields or not any(x.strip() for x in fields):
                continue
            if len(fields) < n:
                fields = fields + [""] * (n - len(fields))
            yield name, dict(zip(columns, fields))


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    """Areas, counts and years: 0 or blank means the Assessor has no figure, which is not a fact."""
    v = _num(s)
    return v if v and v > 0 else None


def _squeeze(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _zip(z: str) -> str:
    """``852581234`` → ``85258-1234``; five digits and already-hyphenated values pass through."""
    z = z.strip()
    return f"{z[:5]}-{z[5:]}" if re.fullmatch(r"\d{9}", z) else z


def _situs(r: dict[str, str]) -> str | None:
    """``8683 E VIA DE NEGOCIO 110, SCOTTSDALE AZ 85258``; the street line already carries the unit."""
    street = _squeeze(r.get("Situs_Address"))
    if not street:
        return None
    suite = _squeeze(r.get("Situs_Suite"))
    if suite and not street.endswith(f" {suite}"):
        street = f"{street} {suite}"
    rest = " ".join(x for x in (_squeeze(r.get("Situs_City")), "AZ", _zip(_squeeze(r.get("Situs_Zip_Code")))) if x)
    return f"{street}, {rest}"


# Country codes the Assessor writes for domestic addresses (ISO 3166 alpha-3) or for none.
_DOMESTIC = frozenset({"", "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA", "N/A"})


def _mailing_address(r: dict[str, str]) -> str | None:
    lines = [_squeeze(r.get("Owner_Mail_Address_1")), _squeeze(r.get("Owner_Mail_Address_2"))]
    city = _squeeze(r.get("Owner_Mail_City"))
    state_zip = " ".join(x for x in (_squeeze(r.get("Owner_Mail_State")), _zip(_squeeze(r.get("Owner_Mail_Zip_Code")))) if x)
    lines.append(", ".join(x for x in (city, state_zip) if x))
    country = _squeeze(r.get("Owner_Mail_Country"))
    if country.upper() not in _DOMESTIC:
        lines.append(country)
    return ", ".join(x for x in lines if x) or None


# Names the Assessor could print instead of an owner of record. None was seen in the 2026-10-26
# file (every parcel read had a name), so this list is a guard, not an observation.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN"})


def _owner(name: str | None) -> str | None:
    n = _squeeze(name)
    if not n or n.upper() in _PLACEHOLDER_OWNERS:
        return None
    return n


def _parcel_key(book: str, map_: str, item: str, split: str) -> str:
    """The ``Parcel_Number`` form from the Commercial Master's separate parcel columns."""
    return f"{book.strip().zfill(3)}{map_.strip().zfill(2)}{item.strip().zfill(3)}{split.strip().upper()}"


def read_commercial(path: str | Path) -> dict[str, tuple[float | None, int | None]]:
    """Per parcel: (total floor area over its improvements, earliest construction year).

    The Commercial Master has one row per improvement **and occupancy**; the floor area is the
    improvement's, so it is counted once per ``Improvement_ID``.
    """
    areas: dict[str, dict[str, float]] = {}
    years: dict[str, int] = {}
    for _, r in _rows(path, COMMERCIAL_COLUMNS):
        key = _parcel_key(r["Parcel_Book"], r["Parcel_Map"], r["Parcel_Item"], r["Parcel_Split_Letter"])
        if not key.strip("0"):
            continue
        area = _positive(r.get("Total_Floor_Area"))
        if area is not None:
            areas.setdefault(key, {})[r.get("Improvement_ID", "").strip()] = area
        year = _positive(r.get("Construction_Year"))
        if year is not None and (key not in years or int(year) < years[key]):
            years[key] = int(year)
    out: dict[str, tuple[float | None, int | None]] = {}
    for key in set(areas) | set(years):
        total = sum(areas[key].values()) if key in areas else None
        out[key] = (total, years.get(key))
    return out


def read_apartments(path: str | Path) -> dict[str, tuple[float | None, int | None, int | None]]:
    """Per lead parcel: (total floor area, construction year, number of units) of the economic unit."""
    out: dict[str, tuple[float | None, int | None, int | None]] = {}
    for _, r in _rows(path, APARTMENT_COLUMNS):
        key = r["Lead_Parcel"].strip().upper()
        if not key:
            continue
        year = _positive(r.get("Construction_Yr"))
        units = _positive(r.get("Num_Units"))
        out[key] = (_positive(r.get("Total_Flr_Area")), int(year) if year else None, int(units) if units else None)
    return out


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              commercial_path: str | Path | None = None, apartment_path: str | Path | None = None,
              tax_year: int | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per parcel in scope, in file order.

    ``categories`` limits the parcels kept by registry category (default: the commercial scope);
    ``None`` keeps every parcel, with ``state_category`` ``None`` for uses outside the mapping.
    ``commercial_path`` and ``apartment_path`` add building floor area (and a construction year
    where the Secured Master has none) from the Commercial and Apartment Masters. ``tax_year`` is
    the valuation year the file was published for; the file does not say it, so it is the
    caller's to state.
    """
    wanted = None if categories is None else frozenset(c.upper() for c in categories)
    commercial = read_commercial(commercial_path) if commercial_path else {}
    apartments = read_apartments(apartment_path) if apartment_path else {}
    for member, r in _rows(path, SECURED_COLUMNS):
        raw = r["Parcel_Number"].strip().upper()
        if not raw:
            continue
        puc = _squeeze(r.get("Property_Use_Code"))
        cat = category(puc)
        if wanted is not None and cat not in wanted:
            continue
        owner_name = _owner(r.get("Owner_Name"))
        area = _positive(r.get("Living_Area"))
        year = _positive(r.get("Construction_Year"))
        year = int(year) if year else None
        com_area, com_year = commercial.get(raw, (None, None))
        apt_area, apt_year, _units = apartments.get(raw, (None, None, None))
        area = area if area is not None else (com_area if com_area is not None else apt_area)
        year = year if year is not None else (com_year if com_year is not None else apt_year)
        yield ParcelRecord(
            county_fips=COUNTY_FIPS,
            apn=format_apn(raw),
            state_category=cat,
            account=format_apn(raw),
            situs_address=_situs(r),
            owner_name=owner_name,
            owner_mailing_address=_mailing_address(r) if owner_name else None,
            owner_confidential=False,  # the file carries no withheld-owner marker (see the review record)
            land_area_sf=_positive(r.get("Total_Square_Feet")),
            improvement_area_sf=area,
            year_built=year,
            market_value=_num(r.get("Total_Full_Cash_Value")),
            appraised_value=_num(r.get("Limited_Property_Value")),
            tax_year=tax_year,
            locator=f"{member} Parcel_Number {raw}",
            local_use_code=puc or None,
        )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          full_roll: bool = True, commercial_path: str | Path | None = None,
          apartment_path: str | Path | None = None, tax_year: int | None = None) -> IngestStats:
    """Ingest one archived ``Secured_Master.zip`` into a registry file (created if missing)."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        records = read_roll(snapshot_path, commercial_path=commercial_path, apartment_path=apartment_path,
                            tax_year=tax_year)
        return reg.ingest_parcels(records, snap, state_fips=STATE_FIPS, account_system=ACCOUNT_SYSTEM,
                                  full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.az_maricopa", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to Secured_Master.zip as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="publication date, YYYY-MM-DD (the ArcGIS item's 'modified' date)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--commercial", help="path to Commercial_Master.zip (commercial building floor area)")
    ap.add_argument("--apartments", help="path to Apartment_Master.zip (apartment floor area)")
    ap.add_argument("--tax-year", type=int, help="valuation year the file was published for")
    ap.add_argument("--partial", action="store_true", help="do not retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, full_roll=not args.partial,
                  commercial_path=args.commercial, apartment_path=args.apartments, tax_year=args.tax_year)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
