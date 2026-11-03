"""MassGIS Level 3 standardized assessors' parcels, "Assess" table → ``ParcelRecord`` (four Massachusetts counties).

MassGIS publishes, for every Massachusetts municipality, the town's assessor database as a standardized
table (``M###Assess``) next to its digital parcel map. This adapter reads that table for the towns of
Middlesex (FIPS 25017), Worcester (25027), Essex (25009), and Norfolk (25021) counties; Suffolk County
is covered by ``ma_boston`` (Boston only). The table carries the owner of record (``OWNER1``) and the
owner's mailing address, so owner names are present.

Layout (confirmed 2026-11-03 on ``L3_SHP_M049_Cambridge`` FY2026 and other towns): the per-town
download ``shapefiles/l3parcels/L3_SHP_M###_NAME.zip`` holds ``M###Assess_CY##_FY##.dbf`` (dBase III,
UTF-8 per its ``.cpg``), the use-code lookup ``M###UC_LUT_*.dbf``, and the parcel shapefiles this
adapter does not read. The adapter reads the Assess ``.dbf`` straight out of the zip (or a bare
``.dbf``) with the standard library. Columns (MassGIS Standard for Digital Parcels, Level 3):

- ``PROP_ID`` — the assessor's parcel id, unique within the town but NOT across towns, and not
  alphanumeric-safe (``7-115`` and ``71-15`` collapse to the same digits). ``apn`` therefore
  starts with the 3-digit MassGIS town id and escapes the rest (``apn_for``).
- ``USE_CODE`` — four characters: the Massachusetts Department of Revenue property type
  classification code (three digits) plus one local digit. The state codes are the publisher's
  ``M###UC_LUT`` table (``TOWN_ID`` 0 rows): ``111`` apartments with four to eight units, ``112``
  apartments with more than eight units, ``114`` affordable housing units (more than 50% of the units
  qualify) → ``B``; ``3xx`` (hotels through commercial land, ``300``–``393``) → ``F1``; ``4xx``
  (manufacturing, warehouses, mining, utilities, industrial land) → ``F2``. The rest yield no record:
  ``0xx`` mixed use (as ``ma_boston`` does), ``1xx`` other residential including ``102`` condominiums, and
  ``9xx`` tax-exempt.
- ``OWNER1`` owner of record; ``OWN_ADDR``, ``OWN_CITY``, ``OWN_STATE``, ``OWN_ZIP`` owner mailing address
  (``OWN_CO``, the care-of line, is not copied: it often names a person). No confidentiality flag exists.
- ``SITE_ADDR``, ``CITY``, ``ZIP`` situs. ``LOT_SIZE`` with ``LOT_UNITS`` (``A`` acres, ``S`` square feet),
  ``BLD_AREA`` building area, ``YEAR_BUILT``, ``TOTAL_VAL`` (full and fair cash value, as Massachusetts
  assesses at 100%), ``FY`` the fiscal year (recorded as ``tax_year``).

Usage: ``python -m factlot.registry.adapters.ma_massgis L3_SHP_M049_CAMBRIDGE.zip registry.db``
The assessment date (``--as-of``) defaults to 1 January of the calendar year before the file's fiscal
year (``assessment_date``): towns are on their own fiscal years (FY2025, FY2026 and FY2027 files are
current together). Each town is its own file; ``--full-roll`` retires parcels missing from this
town's file and is only right when every other town of the county has the same date.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "25"
ACCOUNT_SYSTEM = "massgis_prop_id"
SQFT_PER_ACRE = 43560

SOURCE = Source(
    source_id="ma-massgis-parcels",
    publisher="MassGIS (Massachusetts Bureau of Geographic Information) with the municipal assessors",
    title="Level 3 standardized assessors' parcels, Assess table, by municipality",
    url="https://www.mass.gov/info-details/massgis-data-property-tax-parcels",
    state_fips=STATE_FIPS,
    county_fips=None,  # four counties; each record carries its own
    license="Public domain, stated in the layer metadata ('This parcel data is in the public domain and should not be "
            "redistributed for a fee beyond reproduction costs')",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="permitted",  # public domain; fee clause noted in the review record
    attribution="MassGIS and the municipal assessing departments",
    terms_reviewed="2026-11-03",
)

# MassGIS town id → county FIPS (without the state), for the municipalities of Middlesex 017, Worcester 027,
# Essex 009 and Norfolk 021 counties (176 towns; the comment is the name in the download file name).
TOWN_COUNTY = {
    2: "017",  # ACTON
    7: "009",  # AMESBURY
    9: "009",  # ANDOVER
    10: "017",  # ARLINGTON
    11: "027",  # ASHBURNHAM
    12: "017",  # ASHBY
    14: "017",  # ASHLAND
    15: "027",  # ATHOL
    17: "027",  # AUBURN
    18: "021",  # AVON
    19: "017",  # AYER
    21: "027",  # BARRE
    23: "017",  # BEDFORD
    25: "021",  # BELLINGHAM
    26: "017",  # BELMONT
    28: "027",  # BERLIN
    30: "009",  # BEVERLY
    31: "017",  # BILLERICA
    32: "027",  # BLACKSTONE
    34: "027",  # BOLTON
    37: "017",  # BOXBOROUGH
    38: "009",  # BOXFORD
    39: "027",  # BOYLSTON
    40: "021",  # BRAINTREE
    45: "027",  # BROOKFIELD
    46: "021",  # BROOKLINE
    48: "017",  # BURLINGTON
    49: "017",  # CAMBRIDGE
    50: "021",  # CANTON
    51: "017",  # CARLISLE
    54: "027",  # CHARLTON
    56: "017",  # CHELMSFORD
    64: "027",  # CLINTON
    65: "021",  # COHASSET
    67: "017",  # CONCORD
    71: "009",  # DANVERS
    73: "021",  # DEDHAM
    77: "027",  # DOUGLAS
    78: "021",  # DOVER
    79: "017",  # DRACUT
    80: "027",  # DUDLEY
    81: "017",  # DUNSTABLE
    84: "027",  # EASTBROOKFIELD
    92: "009",  # ESSEX
    93: "017",  # EVERETT
    97: "027",  # FITCHBURG
    99: "021",  # FOXBOROUGH
    100: "017",  # FRAMINGHAM
    101: "021",  # FRANKLIN
    103: "027",  # GARDNER
    105: "009",  # GEORGETOWN
    107: "009",  # GLOUCESTER
    110: "027",  # GRAFTON
    115: "017",  # GROTON
    116: "009",  # GROVELAND
    119: "009",  # HAMILTON
    124: "027",  # HARDWICK
    125: "027",  # HARVARD
    128: "009",  # HAVERHILL
    133: "021",  # HOLBROOK
    134: "027",  # HOLDEN
    136: "017",  # HOLLISTON
    138: "027",  # HOPEDALE
    139: "017",  # HOPKINTON
    140: "027",  # HUBBARDSTON
    141: "017",  # HUDSON
    144: "009",  # IPSWICH
    147: "027",  # LANCASTER
    149: "009",  # LAWRENCE
    151: "027",  # LEICESTER
    153: "027",  # LEOMINSTER
    155: "017",  # LEXINGTON
    157: "017",  # LINCOLN
    158: "017",  # LITTLETON
    160: "017",  # LOWELL
    162: "027",  # LUNENBURG
    163: "009",  # LYNN
    164: "009",  # LYNNFIELD
    165: "017",  # MALDEN
    166: "009",  # MANCHESTER
    168: "009",  # MARBLEHEAD
    170: "017",  # MARLBOROUGH
    174: "017",  # MAYNARD
    175: "021",  # MEDFIELD
    176: "017",  # MEDFORD
    177: "021",  # MEDWAY
    178: "017",  # MELROSE
    179: "027",  # MENDON
    180: "009",  # MERRIMAC
    181: "009",  # METHUEN
    184: "009",  # MIDDLETON
    185: "027",  # MILFORD
    186: "027",  # MILLBURY
    187: "021",  # MILLIS
    188: "027",  # MILLVILLE
    189: "021",  # MILTON
    196: "009",  # NAHANT
    198: "017",  # NATICK
    199: "021",  # NEEDHAM
    202: "027",  # NEWBRAINTREE
    205: "009",  # NEWBURY
    206: "009",  # NEWBURYPORT
    207: "017",  # NEWTON
    208: "021",  # NORFOLK
    210: "009",  # NORTHANDOVER
    212: "027",  # NORTHBROOKFIELD
    213: "017",  # NORTHREADING
    215: "027",  # NORTHBOROUGH
    216: "027",  # NORTHBRIDGE
    220: "021",  # NORWOOD
    222: "027",  # OAKHAM
    226: "027",  # OXFORD
    228: "027",  # PAXTON
    229: "009",  # PEABODY
    232: "017",  # PEPPERELL
    234: "027",  # PETERSHAM
    235: "027",  # PHILLIPSTON
    238: "021",  # PLAINVILLE
    241: "027",  # PRINCETON
    243: "021",  # QUINCY
    244: "021",  # RANDOLPH
    246: "017",  # READING
    252: "009",  # ROCKPORT
    254: "009",  # ROWLEY
    255: "027",  # ROYALSTON
    257: "027",  # RUTLAND
    258: "009",  # SALEM
    259: "009",  # SALISBURY
    262: "009",  # SAUGUS
    266: "021",  # SHARON
    269: "017",  # SHERBORN
    270: "017",  # SHIRLEY
    271: "027",  # SHREWSBURY
    274: "017",  # SOMERVILLE
    277: "027",  # SOUTHBOROUGH
    278: "027",  # SOUTHBRIDGE
    280: "027",  # SPENCER
    282: "027",  # STERLING
    284: "017",  # STONEHAM
    285: "021",  # STOUGHTON
    286: "017",  # STOW
    287: "027",  # STURBRIDGE
    288: "017",  # SUDBURY
    290: "027",  # SUTTON
    291: "009",  # SWAMPSCOTT
    294: "027",  # TEMPLETON
    295: "017",  # TEWKSBURY
    298: "009",  # TOPSFIELD
    299: "017",  # TOWNSEND
    301: "017",  # TYNGSBOROUGH
    303: "027",  # UPTON
    304: "027",  # UXBRIDGE
    305: "017",  # WAKEFIELD
    307: "021",  # WALPOLE
    308: "017",  # WALTHAM
    311: "027",  # WARREN
    314: "017",  # WATERTOWN
    315: "017",  # WAYLAND
    316: "027",  # WEBSTER
    317: "021",  # WELLESLEY
    320: "009",  # WENHAM
    321: "027",  # WESTBOYLSTON
    323: "027",  # WESTBROOKFIELD
    324: "009",  # WESTNEWBURY
    328: "027",  # WESTBOROUGH
    330: "017",  # WESTFORD
    332: "027",  # WESTMINSTER
    333: "017",  # WESTON
    335: "021",  # WESTWOOD
    336: "021",  # WEYMOUTH
    342: "017",  # WILMINGTON
    343: "027",  # WINCHENDON
    344: "017",  # WINCHESTER
    347: "017",  # WOBURN
    348: "027",  # WORCESTER
    350: "021",  # WRENTHAM
}

# Massachusetts DOR state use codes (first three characters of USE_CODE) that are apartment buildings.
MULTIFAMILY_CODES = frozenset({"111", "112", "114"})

# Owner strings a publisher uses when it has no owner of record.
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "CURRENT OWNER", "N/A", "NONE"})


def state_category(use_code: str | None) -> str | None:
    """FactLot category for a MassGIS ``USE_CODE``, or ``None`` when out of scope.

    ``B`` for the apartment codes in ``MULTIFAMILY_CODES``, ``F1`` for 3xx, ``F2`` for 4xx. Mixed use
    (0xx), other residential (1xx), and exempt (9xx) codes yield ``None``.
    """
    code = (use_code or "").strip()[:3]
    if len(code) < 3 or not code.isdigit():
        return None
    if code in MULTIFAMILY_CODES:
        return "B"
    if code[0] == "3":
        return "F1"
    if code[0] == "4":
        return "F2"
    return None


def apn_for(town_id: int, prop_id: str) -> str:
    """Registry APN: the 3-digit town id, then the lower-cased ``PROP_ID`` with every character that is
    not a letter or digit written ``x<hex>x`` and a literal ``x`` written ``xx``.

    ``7-115`` in Cambridge (town 49) is ``0497x2dx115``. The mapping is one-to-one, because the registry
    reduces an APN to lower-case letters and digits and ``7-115`` and ``71-15`` would otherwise both become
    ``7115`` (485 such pairs exist in Cambridge alone).
    """
    out = []
    for ch in (prop_id or "").strip().lower():
        if ch == "x":
            out.append("xx")
        elif ch.isascii() and ch.isalnum():
            out.append(ch)
        else:
            out.append(f"x{ord(ch):x}x")
    return f"{town_id:03d}{''.join(out)}"


def _text(s: str | None) -> str:
    return " ".join((s or "").split())


def _num(s: str | None) -> float | None:
    s = (s or "").strip().replace(",", "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _positive(s: str | None) -> float | None:
    v = _num(s)
    return v if v and v > 0 else None


def _owner(name: str | None) -> str | None:
    n = _text(name).strip(" ,")
    return None if not n or n.upper() in _PLACEHOLDER_OWNERS else n


def _situs(r: dict[str, str]) -> str | None:
    line = _text(r.get("SITE_ADDR"))
    if not line:
        line = _text(" ".join(x for x in (_text(r.get("ADDR_NUM")), _text(r.get("FULL_STR"))) if x))
    line = re.sub(r"^0+\s+", "", line)  # "0 EXAMPLE ST": the assessor's way of saying no number
    if not line:
        return None
    city = _text(r.get("CITY")).upper()
    zip5 = _text(r.get("ZIP"))[:5]
    return f"{line}, {' '.join(x for x in (city, 'MA', zip5) if x)}"


def _mailing_address(r: dict[str, str]) -> str | None:
    street, city = _text(r.get("OWN_ADDR")), _text(r.get("OWN_CITY"))
    state_zip = " ".join(x for x in (_text(r.get("OWN_STATE")), _text(r.get("OWN_ZIP"))[:5]) if x)
    return ", ".join(x for x in (street, city, state_zip) if x) or None


def _land_area_sf(r: dict[str, str]) -> float | None:
    area = _positive(r.get("LOT_SIZE"))
    if area is None:
        return None
    unit = _text(r.get("LOT_UNITS")).upper()
    if unit == "S":
        return area
    if unit == "A":
        return round(area * SQFT_PER_ACRE, 2)
    return None


def read_dbf(stream, encoding: str = "utf-8") -> Iterator[dict[str, str]]:
    """Rows of a dBase III table as dicts of stripped strings (deleted records skipped)."""
    head = stream.read(32)
    if len(head) < 32:
        return
    count, header_len, record_len = struct.unpack("<IHH", head[4:12])
    block = stream.read(header_len - 32)  # field descriptors, then a 0x0D terminator
    fields: list[tuple[str, int]] = []
    for i in range(0, len(block) - 31, 32):
        desc = block[i:i + 32]
        if desc[0] == 0x0D:
            break
        fields.append((desc[:11].split(b"\0")[0].decode("ascii", "replace"), desc[16]))
    for _ in range(count):
        rec = stream.read(record_len)
        if len(rec) < record_len:
            return
        if rec[:1] == b"*":
            continue
        pos, row = 1, {}
        for name, length in fields:
            row[name] = rec[pos:pos + length].decode(encoding, "replace").strip()
            pos += length
        yield row


_ASSESS_MEMBER = re.compile(r"(?:^|/)M(\d{3})Assess[^/]*\.dbf$", re.I)


def _open_assess(path: Path):
    """``(stream, town_id_from_name, label)`` for a town zip or a bare Assess .dbf."""
    if path.suffix.lower() == ".dbf":
        m = _ASSESS_MEMBER.search(path.name)
        return open(path, "rb"), int(m.group(1)) if m else None, path.name
    zf = zipfile.ZipFile(path)
    for name in zf.namelist():
        m = _ASSESS_MEMBER.search(name)
        if m:
            return zf.open(name), int(m.group(1)), path.name
    raise ValueError(f"{path}: no M###Assess .dbf in the archive")


def assessment_date(path: str | Path) -> str:
    """Assessment date (``YYYY-MM-DD``) of a town file: 1 January of the calendar year before its fiscal year.

    Each town is on its own fiscal year (FY2025, FY2026 and FY2027 files sit side by side in the same
    release), so the date is read from the first record's ``FY`` rather than given once for all towns.
    """
    stream, _, label = _open_assess(Path(path))
    with stream:
        for r in read_dbf(stream):
            fy = _positive(r.get("FY"))
            if fy:
                return f"{int(fy) - 1}-01-01"
    raise ValueError(f"{label}: no fiscal year in the Assess table")


def read_roll(path: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              county_fips: str | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per assessor record (parcel or condominium unit) in scope.

    ``categories`` limits the rows kept (default: the registry's commercial scope B, F1, F2); ``None``
    keeps every record, with ``state_category`` ``None`` for out-of-scope use codes. ``county_fips`` (three
    digits) overrides the built-in town-to-county table for a town it does not list.
    """
    keep = None if categories is None else frozenset(c.upper() for c in categories)
    path = Path(path)
    stream, name_town, label = _open_assess(path)
    with stream:
        for r in read_dbf(stream):
            town = int(_num(r.get("TOWN_ID")) or name_town or 0)
            county = county_fips or TOWN_COUNTY.get(town)
            if county is None:
                raise ValueError(f"{label}: town id {town} is not in TOWN_COUNTY; pass county_fips")
            prop = _text(r.get("PROP_ID"))
            if not prop:
                continue
            use = r.get("USE_CODE", "").strip()
            category = state_category(use)
            if keep is not None and category not in keep:
                continue
            owner = _owner(r.get("OWNER1"))
            year = _positive(r.get("YEAR_BUILT"))
            fiscal_year = _positive(r.get("FY"))
            apn = apn_for(town, prop)
            yield ParcelRecord(
                county_fips=county,
                apn=apn,
                state_category=category,
                account=f"M{town:03d}:{prop}",
                situs_address=_situs(r),
                owner_name=owner,
                owner_mailing_address=_mailing_address(r) if owner else None,
                owner_confidential=False,
                land_area_sf=_land_area_sf(r),
                improvement_area_sf=_positive(r.get("BLD_AREA")),
                year_built=int(year) if year else None,
                market_value=_positive(r.get("TOTAL_VAL")),
                tax_year=int(fiscal_year) if fiscal_year else None,
                locator=f"{label} PROP_ID {prop}",
                local_use_code=use or None,
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str | None = None, retrieved_at: str | None = None,
          county_fips: str | None = None, full_roll: bool = False) -> IngestStats:
    """Ingest one archived town file into a registry file (created if missing).

    ``full_roll`` defaults to ``False``: a town is one file of a many-file source.
    """
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of or assessment_date(snapshot_path), retrieved_at)
        return reg.ingest_parcels(read_roll(snapshot_path, county_fips=county_fips), snap, state_fips=STATE_FIPS,
                                  account_system=ACCOUNT_SYSTEM, full_roll=full_roll)
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ma_massgis", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to a town zip (or Assess .dbf) as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of",
                    help="assessment date, YYYY-MM-DD; default: 1 January of the calendar year before the file's fiscal year")
    ap.add_argument("--county-fips", help="3-digit county FIPS for a town not in TOWN_COUNTY")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--full-roll", action="store_true", help="retire parcels missing from this file")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at,
                  county_fips=args.county_fips, full_roll=args.full_roll)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
