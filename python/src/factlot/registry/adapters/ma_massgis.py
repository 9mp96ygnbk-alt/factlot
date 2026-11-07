"""MassGIS Level 3 standardized assessors' parcels, "Assess" table → ``ParcelRecord`` (every Massachusetts town but Boston).

MassGIS publishes, for every Massachusetts municipality, the town's assessor database as a standardized
table (``M###Assess``) next to its digital parcel map. This adapter reads that table for all 351
municipalities in all 14 counties except Boston, which is covered by ``ma_boston`` (``ma-boston-assessing``)
and refused here (``EXCLUDED_TOWNS``); Suffolk County's other towns, Chelsea, Revere and Winthrop, load from
this source. ``TOWN_COUNTY`` maps the MassGIS town id to the county from the publisher's own town layer.
The table carries the owner of record (``OWNER1``) and the owner's mailing address, so owner names are
present. (The source began with the four Tier 2 counties, Middlesex 25017, Worcester 25027, Essex 25009
and Norfolk 25021, and was extended statewide on 2026-11-03.)

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
    county_fips=None,  # statewide; each record carries its own
    license="Public domain, stated in the layer metadata ('This parcel data is in the public domain and should not be "
            "redistributed for a fee beyond reproduction costs')",
    ai_use="unknown",  # not addressed by the publisher
    redistribution="permitted",  # public domain; not for a fee beyond reproduction costs (see the review record)
    attribution="MassGIS and the municipal assessing departments",
    terms_reviewed="2026-11-03",
)

# MassGIS town id → county FIPS (without the state) for every municipality except Boston: 350 towns. From the
# publisher's own town layer (shapefiles/state/towns.zip, TOWNS_POLYM.dbf, fields TOWN_ID and FIPS_STCO, read
# 2026-11-03); the comment is the name in the download file name.
TOWN_COUNTY = {
    1: "023",  # ABINGTON
    2: "017",  # ACTON
    3: "005",  # ACUSHNET
    4: "003",  # ADAMS
    5: "013",  # AGAWAM
    6: "003",  # ALFORD
    7: "009",  # AMESBURY
    8: "015",  # AMHERST
    9: "009",  # ANDOVER
    10: "017",  # ARLINGTON
    11: "027",  # ASHBURNHAM
    12: "017",  # ASHBY
    13: "011",  # ASHFIELD
    14: "017",  # ASHLAND
    15: "027",  # ATHOL
    16: "005",  # ATTLEBORO
    17: "027",  # AUBURN
    18: "021",  # AVON
    19: "017",  # AYER
    20: "001",  # BARNSTABLE
    21: "027",  # BARRE
    22: "003",  # BECKET
    23: "017",  # BEDFORD
    24: "015",  # BELCHERTOWN
    25: "021",  # BELLINGHAM
    26: "017",  # BELMONT
    27: "005",  # BERKLEY
    28: "027",  # BERLIN
    29: "011",  # BERNARDSTON
    30: "009",  # BEVERLY
    31: "017",  # BILLERICA
    32: "027",  # BLACKSTONE
    33: "013",  # BLANDFORD
    34: "027",  # BOLTON
    36: "001",  # BOURNE
    37: "017",  # BOXBOROUGH
    38: "009",  # BOXFORD
    39: "027",  # BOYLSTON
    40: "021",  # BRAINTREE
    41: "001",  # BREWSTER
    42: "023",  # BRIDGEWATER
    43: "013",  # BRIMFIELD
    44: "023",  # BROCKTON
    45: "027",  # BROOKFIELD
    46: "021",  # BROOKLINE
    47: "011",  # BUCKLAND
    48: "017",  # BURLINGTON
    49: "017",  # CAMBRIDGE
    50: "021",  # CANTON
    51: "017",  # CARLISLE
    52: "023",  # CARVER
    53: "011",  # CHARLEMONT
    54: "027",  # CHARLTON
    55: "001",  # CHATHAM
    56: "017",  # CHELMSFORD
    57: "025",  # CHELSEA
    58: "003",  # CHESHIRE
    59: "013",  # CHESTER
    60: "015",  # CHESTERFIELD
    61: "013",  # CHICOPEE
    62: "007",  # CHILMARK
    63: "003",  # CLARKSBURG
    64: "027",  # CLINTON
    65: "021",  # COHASSET
    66: "011",  # COLRAIN
    67: "017",  # CONCORD
    68: "011",  # CONWAY
    69: "015",  # CUMMINGTON
    70: "003",  # DALTON
    71: "009",  # DANVERS
    72: "005",  # DARTMOUTH
    73: "021",  # DEDHAM
    74: "011",  # DEERFIELD
    75: "001",  # DENNIS
    76: "005",  # DIGHTON
    77: "027",  # DOUGLAS
    78: "021",  # DOVER
    79: "017",  # DRACUT
    80: "027",  # DUDLEY
    81: "017",  # DUNSTABLE
    82: "023",  # DUXBURY
    83: "023",  # EASTBRIDGEWATER
    84: "027",  # EASTBROOKFIELD
    85: "013",  # EASTLONGMEADOW
    86: "001",  # EASTHAM
    87: "015",  # EASTHAMPTON
    88: "005",  # EASTON
    89: "007",  # EDGARTOWN
    90: "003",  # EGREMONT
    91: "011",  # ERVING
    92: "009",  # ESSEX
    93: "017",  # EVERETT
    94: "005",  # FAIRHAVEN
    95: "005",  # FALLRIVER
    96: "001",  # FALMOUTH
    97: "027",  # FITCHBURG
    98: "003",  # FLORIDA
    99: "021",  # FOXBOROUGH
    100: "017",  # FRAMINGHAM
    101: "021",  # FRANKLIN
    102: "005",  # FREETOWN
    103: "027",  # GARDNER
    104: "007",  # AQUINNAH
    105: "009",  # GEORGETOWN
    106: "011",  # GILL
    107: "009",  # GLOUCESTER
    108: "015",  # GOSHEN
    109: "007",  # GOSNOLD
    110: "027",  # GRAFTON
    111: "015",  # GRANBY
    112: "013",  # GRANVILLE
    113: "003",  # GREATBARRINGTON
    114: "011",  # GREENFIELD
    115: "017",  # GROTON
    116: "009",  # GROVELAND
    117: "015",  # HADLEY
    118: "023",  # HALIFAX
    119: "009",  # HAMILTON
    120: "013",  # HAMPDEN
    121: "003",  # HANCOCK
    122: "023",  # HANOVER
    123: "023",  # HANSON
    124: "027",  # HARDWICK
    125: "027",  # HARVARD
    126: "001",  # HARWICH
    127: "015",  # HATFIELD
    128: "009",  # HAVERHILL
    129: "011",  # HAWLEY
    130: "011",  # HEATH
    131: "023",  # HINGHAM
    132: "003",  # HINSDALE
    133: "021",  # HOLBROOK
    134: "027",  # HOLDEN
    135: "013",  # HOLLAND
    136: "017",  # HOLLISTON
    137: "013",  # HOLYOKE
    138: "027",  # HOPEDALE
    139: "017",  # HOPKINTON
    140: "027",  # HUBBARDSTON
    141: "017",  # HUDSON
    142: "023",  # HULL
    143: "015",  # HUNTINGTON
    144: "009",  # IPSWICH
    145: "023",  # KINGSTON
    146: "023",  # LAKEVILLE
    147: "027",  # LANCASTER
    148: "003",  # LANESBOROUGH
    149: "009",  # LAWRENCE
    150: "003",  # LEE
    151: "027",  # LEICESTER
    152: "003",  # LENOX
    153: "027",  # LEOMINSTER
    154: "011",  # LEVERETT
    155: "017",  # LEXINGTON
    156: "011",  # LEYDEN
    157: "017",  # LINCOLN
    158: "017",  # LITTLETON
    159: "013",  # LONGMEADOW
    160: "017",  # LOWELL
    161: "013",  # LUDLOW
    162: "027",  # LUNENBURG
    163: "009",  # LYNN
    164: "009",  # LYNNFIELD
    165: "017",  # MALDEN
    166: "009",  # MANCHESTER
    167: "005",  # MANSFIELD
    168: "009",  # MARBLEHEAD
    169: "023",  # MARION
    170: "017",  # MARLBOROUGH
    171: "023",  # MARSHFIELD
    172: "001",  # MASHPEE
    173: "023",  # MATTAPOISETT
    174: "017",  # MAYNARD
    175: "021",  # MEDFIELD
    176: "017",  # MEDFORD
    177: "021",  # MEDWAY
    178: "017",  # MELROSE
    179: "027",  # MENDON
    180: "009",  # MERRIMAC
    181: "009",  # METHUEN
    182: "023",  # MIDDLEBOROUGH
    183: "015",  # MIDDLEFIELD
    184: "009",  # MIDDLETON
    185: "027",  # MILFORD
    186: "027",  # MILLBURY
    187: "021",  # MILLIS
    188: "027",  # MILLVILLE
    189: "021",  # MILTON
    190: "011",  # MONROE
    191: "013",  # MONSON
    192: "011",  # MONTAGUE
    193: "003",  # MONTEREY
    194: "013",  # MONTGOMERY
    195: "003",  # MOUNTWASHINGTON
    196: "009",  # NAHANT
    197: "019",  # NANTUCKET
    198: "017",  # NATICK
    199: "021",  # NEEDHAM
    200: "003",  # NEWASHFORD
    201: "005",  # NEWBEDFORD
    202: "027",  # NEWBRAINTREE
    203: "003",  # NEWMARLBOROUGH
    204: "011",  # NEWSALEM
    205: "009",  # NEWBURY
    206: "009",  # NEWBURYPORT
    207: "017",  # NEWTON
    208: "021",  # NORFOLK
    209: "003",  # NORTHADAMS
    210: "009",  # NORTHANDOVER
    211: "005",  # NORTHATTLEBOROUGH
    212: "027",  # NORTHBROOKFIELD
    213: "017",  # NORTHREADING
    214: "015",  # NORTHAMPTON
    215: "027",  # NORTHBOROUGH
    216: "027",  # NORTHBRIDGE
    217: "011",  # NORTHFIELD
    218: "005",  # NORTON
    219: "023",  # NORWELL
    220: "021",  # NORWOOD
    221: "007",  # OAKBLUFFS
    222: "027",  # OAKHAM
    223: "011",  # ORANGE
    224: "001",  # ORLEANS
    225: "003",  # OTIS
    226: "027",  # OXFORD
    227: "013",  # PALMER
    228: "027",  # PAXTON
    229: "009",  # PEABODY
    230: "015",  # PELHAM
    231: "023",  # PEMBROKE
    232: "017",  # PEPPERELL
    233: "003",  # PERU
    234: "027",  # PETERSHAM
    235: "027",  # PHILLIPSTON
    236: "003",  # PITTSFIELD
    237: "015",  # PLAINFIELD
    238: "021",  # PLAINVILLE
    239: "023",  # PLYMOUTH
    240: "023",  # PLYMPTON
    241: "027",  # PRINCETON
    242: "001",  # PROVINCETOWN
    243: "021",  # QUINCY
    244: "021",  # RANDOLPH
    245: "005",  # RAYNHAM
    246: "017",  # READING
    247: "005",  # REHOBOTH
    248: "025",  # REVERE
    249: "003",  # RICHMOND
    250: "023",  # ROCHESTER
    251: "023",  # ROCKLAND
    252: "009",  # ROCKPORT
    253: "011",  # ROWE
    254: "009",  # ROWLEY
    255: "027",  # ROYALSTON
    256: "013",  # RUSSELL
    257: "027",  # RUTLAND
    258: "009",  # SALEM
    259: "009",  # SALISBURY
    260: "003",  # SANDISFIELD
    261: "001",  # SANDWICH
    262: "009",  # SAUGUS
    263: "003",  # SAVOY
    264: "023",  # SCITUATE
    265: "005",  # SEEKONK
    266: "021",  # SHARON
    267: "003",  # SHEFFIELD
    268: "011",  # SHELBURNE
    269: "017",  # SHERBORN
    270: "017",  # SHIRLEY
    271: "027",  # SHREWSBURY
    272: "011",  # SHUTESBURY
    273: "005",  # SOMERSET
    274: "017",  # SOMERVILLE
    275: "015",  # SOUTHHADLEY
    276: "015",  # SOUTHAMPTON
    277: "027",  # SOUTHBOROUGH
    278: "027",  # SOUTHBRIDGE
    279: "013",  # SOUTHWICK
    280: "027",  # SPENCER
    281: "013",  # SPRINGFIELD
    282: "027",  # STERLING
    283: "003",  # STOCKBRIDGE
    284: "017",  # STONEHAM
    285: "021",  # STOUGHTON
    286: "017",  # STOW
    287: "027",  # STURBRIDGE
    288: "017",  # SUDBURY
    289: "011",  # SUNDERLAND
    290: "027",  # SUTTON
    291: "009",  # SWAMPSCOTT
    292: "005",  # SWANSEA
    293: "005",  # TAUNTON
    294: "027",  # TEMPLETON
    295: "017",  # TEWKSBURY
    296: "007",  # TISBURY
    297: "013",  # TOLLAND
    298: "009",  # TOPSFIELD
    299: "017",  # TOWNSEND
    300: "001",  # TRURO
    301: "017",  # TYNGSBOROUGH
    302: "003",  # TYRINGHAM
    303: "027",  # UPTON
    304: "027",  # UXBRIDGE
    305: "017",  # WAKEFIELD
    306: "013",  # WALES
    307: "021",  # WALPOLE
    308: "017",  # WALTHAM
    309: "015",  # WARE
    310: "023",  # WAREHAM
    311: "027",  # WARREN
    312: "011",  # WARWICK
    313: "003",  # WASHINGTON
    314: "017",  # WATERTOWN
    315: "017",  # WAYLAND
    316: "027",  # WEBSTER
    317: "021",  # WELLESLEY
    318: "001",  # WELLFLEET
    319: "011",  # WENDELL
    320: "009",  # WENHAM
    321: "027",  # WESTBOYLSTON
    322: "023",  # WESTBRIDGEWATER
    323: "027",  # WESTBROOKFIELD
    324: "009",  # WESTNEWBURY
    325: "013",  # WESTSPRINGFIELD
    326: "003",  # WESTSTOCKBRIDGE
    327: "007",  # WESTTISBURY
    328: "027",  # WESTBOROUGH
    329: "013",  # WESTFIELD
    330: "017",  # WESTFORD
    331: "015",  # WESTHAMPTON
    332: "027",  # WESTMINSTER
    333: "017",  # WESTON
    334: "005",  # WESTPORT
    335: "021",  # WESTWOOD
    336: "021",  # WEYMOUTH
    337: "011",  # WHATELY
    338: "023",  # WHITMAN
    339: "013",  # WILBRAHAM
    340: "015",  # WILLIAMSBURG
    341: "003",  # WILLIAMSTOWN
    342: "017",  # WILMINGTON
    343: "027",  # WINCHENDON
    344: "017",  # WINCHESTER
    345: "003",  # WINDSOR
    346: "025",  # WINTHROP
    347: "017",  # WOBURN
    348: "027",  # WORCESTER
    349: "015",  # WORTHINGTON
    350: "021",  # WRENTHAM
    351: "001",  # YARMOUTH
}

# Towns this source never loads: Boston (Suffolk County) is loaded from ma-boston-assessing, whose parcel keys
# differ, so loading Boston's MassGIS file too would make every Boston parcel twice.
EXCLUDED_TOWNS = {35: "BOSTON: loaded from ma-boston-assessing"}

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
            if town in EXCLUDED_TOWNS:
                raise ValueError(f"{label}: town id {town} is not loaded from this source ({EXCLUDED_TOWNS[town]})")
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
