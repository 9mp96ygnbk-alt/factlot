"""PACS appraisal export 8.0.34 (APPRAISAL_INFO.TXT) → ``ParcelRecord``.

Galveston Central Appraisal District ships this layout inside the 2026 certified zip
(``Appraisal Export Layout - 8.0.34.xlsx``, version date 01/23/2026). The columns the
registry reads sit at the same positions as the 8.0.33 web export, but the property
record is 9,714 characters rather than 9,922. Nueces uses the same record length and
its own ``APPRAISAL_STATE_CODE.TXT``. Entity files are not opened.

The Comptroller category is the file's own PTD code. A code the file does not list is
left out rather than guessed. Public redistribution of these extracts is not stated.
"""

from __future__ import annotations

import argparse
import io
import json
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..normalize import is_commercial
from ..store import IngestStats, ParcelRecord, ParcelValues, Registry, Source, roll_source
from .tx_travis import (
    IMP_DET_FIELDS,
    LAND_DET_FIELDS,
    PROP_FIELDS,
    STATE_CD_FIELDS,
    _FLOOR_DETAIL_TYPES,
    _SQFT_PER_ACRE,
    _field,
    _mailing_address,
    _num,
    _positive,
    _situs,
    _squeeze,
)

# Last column this reader touches (situs_unit). A shorter record is not this layout.
_MIN_RECORD = 4479

# "Current Appraisal Owner" block of the 8.0.34 property record (layout: appr_owner_name 4492-4561,
# address 4562-4857, confidential flag 4859, address-suppress flag 4860). Some districts export the
# property-year owner block (609-678) as "Not Available" on every row and put the owner here
# (Jefferson 2025 and 2026). The block is read with the same keys, so the person rule and the
# mailing-address rule apply unchanged.
_APPR_OWNER_FIELDS = {
    "py_owner_name": (4492, 4561), "py_addr_line1": (4562, 4621), "py_addr_line2": (4622, 4681),
    "py_addr_line3": (4682, 4741), "py_addr_city": (4742, 4791), "py_addr_state": (4792, 4841),
    "py_addr_country": (4842, 4846), "py_addr_zip": (4847, 4851), "py_addr_zip_cass": (4852, 4855),
    "py_confidential_flag": (4859, 4859), "py_address_suppress_flag": (4860, 4860),
}
_APPR_BLOCK_END = 4860

_INFO = "APPRAISAL_INFO.TXT"
_STATE = "APPRAISAL_STATE_CODE.TXT"
_LAND = "APPRAISAL_LAND_DETAIL.TXT"
_IMP = "APPRAISAL_IMPROVEMENT_DETAIL.TXT"


@dataclass
class ExportTally:
    """Drops measured while reading. Not a county-wide denominator."""

    info_rows: int = 0
    short_rows: int = 0
    not_real: int = 0
    deleted: int = 0
    duplicate_ids: int = 0
    unmapped_code: int = 0
    opaque_code: int = 0
    out_of_scope: int = 0
    kept: int = 0
    owner_from_appraisal_block: int = 0
    local_codes: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class CountyExport:
    source: Source
    county_fips: str
    account_system: str
    # Improvement-detail type codes this district uses for building floor area, as its own
    # APPRAISAL_IMPROVEMENT_DETAIL descriptions label them ("COMMERCIAL BUILDING", "OFFICE",
    # "LIVING AREA"). Added to the generic main-area rule; measured on the kept commercial parcels
    # of each 2026 roll on 2026-11-08. A code not listed here is left out, not guessed.
    building_detail_types: frozenset[str] = frozenset()


GALVESTON = CountyExport(
    source=Source(
        source_id="tx-galveston-cad",
        publisher="Galveston Central Appraisal District",
        title="2026 certified roll web export (PACS 8.0.34)",
        url="https://galvestoncad.org/preliminary-and-certified-roll-export-data/",
        state_fips="48",
        county_fips="167",
        license="No license stated on the exports page (read 2026-11-06). Public record (Tex. Gov't Code ch. 552)",
        ai_use="unknown",
        redistribution="unknown",  # not stated; private staging only
        attribution="Galveston Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="167",
    account_system="gcad_prop_id",
)

GUADALUPE = CountyExport(
    source=Source(
        source_id="tx-guadalupe-cad",
        publisher="Guadalupe Appraisal District",
        title="2026 certified appraisal roll, supplement 0 (PACS 8.0.34)",
        url="https://guadalupead.org/certified-appraisal-roll/",
        state_fips="48",
        county_fips="187",
        license="No license stated on the certified-roll page (read 2026-11-06). Public record (Tex. Gov't Code ch. 552)",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Guadalupe Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="187",
    account_system="gcad_gco_prop_id",
    building_detail_types=frozenset({"COM", "CUPS", "APT", "APT2", "DUP1", "RES1"}),
)

CAMERON = CountyExport(
    source=Source(
        source_id="tx-cameron-cad",
        publisher="Cameron Appraisal District",
        title="2026 certified appraisal export (PACS 8.0.33 record length)",
        url="https://www.cameroncad.org/Pages/Data",
        state_fips="48",
        county_fips="061",
        license="Data page says information herein is in the public domain and disclaims warranty (read 2026-11-06). That sentence is not treated as a license to serve the file publicly",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Cameron Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="061",
    account_system="cameron_prop_id",
)

BRAZOS = CountyExport(
    source=Source(
        source_id="tx-brazos-cad",
        publisher="Brazos Central Appraisal District",
        title="2026 certified roll (PACS 8.0.34), file name includes totals",
        url="https://brazoscad.org/certified-data-downloads/",
        state_fips="48",
        county_fips="041",
        license="No license stated on the downloads page (read 2026-11-06). Public record (Tex. Gov't Code ch. 552)",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Brazos Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="041",
    account_system="brazoscad_prop_id",
    building_detail_types=frozenset({"MA", "MA2", "WAREHOUSE", "OFFICE", "APT", "RETAIL", "CHURCH", "SHOP CENTE", "CONV STORE"}),
)

GRAYSON = CountyExport(
    source=Source(
        source_id="tx-grayson-cad",
        publisher="Grayson Central Appraisal District",
        title="Appraisal export as of supplement (PACS 8.0.34)",
        url="https://graysonappraisal.org/public-information/",
        state_fips="48",
        county_fips="181",
        license="No license stated on the public-information page (read 2026-11-06). The GIS disclaimer is informational and is not a license",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Grayson Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="181",
    account_system="grayson_prop_id",
    building_detail_types=frozenset({"COMM", "LA", "APT", "LVM", "ZROW-S", "ZROW1", "Z-ROWT"}),
)

TAYLOR = CountyExport(
    source=Source(
        source_id="tx-taylor-cad",
        publisher="Central Appraisal District of Taylor County",
        title="2026 adjusted certified appraisal roll (PACS 8.0.34)",
        url="https://taylor-cad.org/data-downloads/",
        state_fips="48",
        county_fips="441",
        license="No license stated for the appraisal-roll zip (read 2026-11-06). The internal-use and no-resale paragraph is under the GIS shapefile heading and names the GIS shapefiles",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Central Appraisal District of Taylor County",
        terms_reviewed="2026-11-06",
    ),
    county_fips="441",
    account_system="taylor_prop_id",
)

ANGELINA = CountyExport(
    source=Source(
        source_id="tx-angelina-cad",
        publisher="Angelina County Appraisal District",
        title="2026 certified roll export (PACS 8.0.34 record length)",
        url="https://www.angelinacad.org/open-records",
        state_fips="48",
        county_fips="005",
        license="Open-records page disclaimer, read 2026-11-06: no responsibility for downloading, no technical support, as-is with no warranty, possible inaccuracies, no liability for errors or omissions, and a bandwidth retry note. Downloading accepts that text. No fee, use, resale, attribution, indemnity, or confidentiality clause is in the text. Public redistribution is not granted",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Angelina County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="005",
    account_system="angelina_prop_id",
)

JEFFERSON = CountyExport(
    source=Source(
        source_id="tx-jefferson-cad",
        publisher="Jefferson Central Appraisal District",
        title="2026 public export, supplement group 05 (PACS 8.0.34)",
        url="https://jcad.org/data-download/",
        state_fips="48",
        county_fips="245",
        license="No license stated on the data-download page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Jefferson Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="245",
    account_system="jcad_prop_id",
    building_detail_types=frozenset({"COM", "SEC", "DUP", "HSE"}),
)

LIBERTY = CountyExport(
    source=Source(
        source_id="tx-liberty-cad",
        publisher="Liberty County Central Appraisal District",
        title="2026 certified appraisal roll (PACS 8.0.34)",
        url="https://libertycad.com/",
        state_fips="48",
        county_fips="291",
        license="No license stated on the district page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Liberty County Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="291",
    account_system="libertycad_prop_id",
)

WICHITA = CountyExport(
    source=Source(
        source_id="tx-wichita-ad",
        publisher="Wichita Appraisal District",
        title="2026 certified real roll (PACS 8.0.34 record length)",
        url="https://wadtx.com/reports/",
        state_fips="48",
        county_fips="485",
        license="No license stated on the reports page (read 2026-11-06). The posted layout pdf is 8.0.25 and was not used. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Wichita Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="485",
    account_system="wad_prop_id",
)

SAN_PATRICIO = CountyExport(
    source=Source(
        source_id="tx-sanpatricio-cad",
        publisher="San Patricio County Appraisal District",
        title="2026 certified export (PACS 8.0.34 record length)",
        url="https://sanpatcad.org/data-downloads/",
        state_fips="48",
        county_fips="409",
        license="No license stated for the roll zip (read 2026-11-06). The posted layout is 8.0.20 and was not used. A map-file note says the district cannot provide technical support and the product is not suitable for legal, engineering, or surveying purposes. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="San Patricio County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="409",
    account_system="sanpat_prop_id",
)

CALDWELL = CountyExport(
    source=Source(
        source_id="tx-caldwell-cad",
        publisher="Caldwell County Appraisal District",
        title="2026 certified export (PACS 8.0.34 record length)",
        url="https://caldwellcad.org/publicly-available-data/",
        state_fips="48",
        county_fips="055",
        license="The public-data page says other exports must be requested and include a fee, and that the district cannot offer technical support for the posted exports (read 2026-11-06). No redistribution license is stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Caldwell County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="055",
    account_system="caldwell_prop_id",
)

ATASCOSA = CountyExport(
    source=Source(
        source_id="tx-atascosa-cad",
        publisher="Atascosa Central Appraisal District",
        title="2026 certified export (PACS 8.0.34 record length)",
        url="https://atascosacad.com/data-export/",
        state_fips="48",
        county_fips="013",
        license="No license stated on the data-export page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Atascosa Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="013",
    account_system="atascosa_prop_id",
)

HARDIN = CountyExport(
    source=Source(
        source_id="tx-hardin-cad",
        publisher="Hardin County Appraisal District",
        title="2026 certified roll (PACS 8.0.34 record length)",
        url="https://hardin-cad.org/data-downloads/",
        state_fips="48",
        county_fips="199",
        license="No license stated on the data-downloads page (read 2026-11-06). A separate open-records policy prices custom copies. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Hardin County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="199",
    account_system="hardin_prop_id",
)

WILSON = CountyExport(
    source=Source(
        source_id="tx-wilson-cad",
        publisher="Wilson County Appraisal District",
        title="2026 appraisal roll, supplement 46 (PACS 8.0.34)",
        url="https://wilson-cad.org/reports/",
        state_fips="48",
        county_fips="493",
        license="No license stated on the reports page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Wilson County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="493",
    account_system="wilson_prop_id",
)

HILL = CountyExport(
    source=Source(
        source_id="tx-hill-cad",
        publisher="Hill County Appraisal District",
        title="2026 appraisal data as of supplement 5 (PACS 8.0.34)",
        url="https://hillcad.org/download-data/",
        state_fips="48",
        county_fips="217",
        license="No license stated on the download page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Hill County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="217",
    account_system="hill_prop_id",
)

WOOD = CountyExport(
    source=Source(
        source_id="tx-wood-cad",
        publisher="Wood County Appraisal District",
        title="2026 certified roll (PACS 8.0.34 record length)",
        url="https://www.woodcad.net/2026-records/",
        state_fips="48",
        county_fips="499",
        license="No license stated on the records page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Wood County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="499",
    account_system="wood_prop_id",
)

BROWN = CountyExport(
    source=Source(
        source_id="tx-brown-cad",
        publisher="Brown County Appraisal District",
        title="2026 certified real-estate export (PACS 8.0.34 record length)",
        url="https://brown-cad.org/downloads/",
        state_fips="48",
        county_fips="049",
        license="No license stated on the downloads page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Brown County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="049",
    account_system="brown_prop_id",
)

MATAGORDA = CountyExport(
    source=Source(
        source_id="tx-matagorda-cad",
        publisher="Matagorda County Appraisal District",
        title="2026 appraisal export, supplement 14, confidential owners redacted (PACS 8.0.34)",
        url="https://matagorda-cad.org/roll-export-data/",
        state_fips="48",
        county_fips="321",
        license="No license stated on the roll-export page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Matagorda County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="321",
    account_system="matagorda_prop_id",
)

LAMAR = CountyExport(
    source=Source(
        source_id="tx-lamar-cad",
        publisher="Lamar County Appraisal District",
        title="2026 notice-of-appraised-value open-records snapshot (PACS 8.0.33), not the certified roll",
        url="https://lamarcad.org/public-info/",
        state_fips="48",
        county_fips="277",
        license="The open-records form says many data files are free to download from the website and that a CD, email, or mailed copy is $50. This file is the posted free zip. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Lamar County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="277",
    account_system="lamar_prop_id",
)

SCURRY = CountyExport(
    source=Source(
        source_id="tx-scurry-cad",
        publisher="Scurry County Appraisal District",
        title="2026 certified real roll, supplement 11 (PACS 8.0.34)",
        url="https://scurrytex.com/",
        state_fips="48",
        county_fips="415",
        license="No license stated on the pages read 2026-11-06. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Scurry County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="415",
    account_system="scurry_prop_id",
)

TRINITY = CountyExport(
    source=Source(
        source_id="tx-trinity-cad",
        publisher="Trinity County Appraisal District",
        title="2026 certified appraisal roll (PACS 8.0.34 record length)",
        url="https://trinitycad.net/",
        state_fips="48",
        county_fips="455",
        license="No license stated on the pages read 2026-11-06. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Trinity County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="455",
    account_system="trinity_prop_id",
)

COMANCHE = CountyExport(
    source=Source(
        source_id="tx-comanche-cad",
        publisher="Comanche Central Appraisal District",
        title="2026 real certified roll (PACS 8.0.34 record length)",
        url="https://comanchecad.org/",
        state_fips="48",
        county_fips="093",
        license="No license stated on the pages read 2026-11-06. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Comanche Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="093",
    account_system="comanche_prop_id",
)

CAMP = CountyExport(
    source=Source(
        source_id="tx-camp-cad",
        publisher="Camp Central Appraisal District",
        title="2026 roll as of certification, supplement 1 (PACS 8.0.34 record length)",
        url="https://campcad.org/",
        state_fips="48",
        county_fips="063",
        license="The shapefile page disclaimer is informational and not a survey, and says the district cannot provide technical support for shapefiles (read 2026-11-06). No redistribution license is stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Camp Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="063",
    account_system="camp_prop_id",
)

HOCKLEY = CountyExport(
    source=Source(
        source_id="tx-hockley-cad",
        publisher="Hockley County Appraisal District",
        title="2026 certified appraisal roll (PACS 8.0.34 record length)",
        url="https://www.hockleycad.org/tax-information/",
        state_fips="48",
        county_fips="219",
        license="No license stated on the tax-information page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Hockley County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="219",
    account_system="hockley_prop_id",
)

LAVACA = CountyExport(
    source=Source(
        source_id="tx-lavaca-cad",
        publisher="Lavaca County Central Appraisal District",
        title="2026 real-property-only certified file (PACS 8.0.34 record length)",
        url="https://lavacacad.com/certified-appraisal-rolls/",
        state_fips="48",
        county_fips="285",
        license="No license stated on the certified-rolls page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Lavaca County Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="285",
    account_system="lavaca_prop_id",
)

GAINES = CountyExport(
    source=Source(
        source_id="tx-gaines-cad",
        publisher="Gaines County Appraisal District",
        title="2026 certified real-property data (PACS 8.0.34 record length)",
        url="https://gainescad.org/data-downloads/",
        state_fips="48",
        county_fips="165",
        license="No license stated on the data-downloads page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Gaines County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="165",
    account_system="gaines_prop_id",
)

BANDERA = CountyExport(
    source=Source(
        source_id="tx-bandera-cad",
        publisher="Bandera Central Appraisal District",
        title="2026 certified roll (PACS 8.0.34 record length)",
        url="https://bancad.org/downloads-data-download-disclaimer/",
        state_fips="48",
        county_fips="019",
        license="Website download disclaimer, 2021 pdf: public-service access, no warranty, users are responsible for dissemination. Not a license grant. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Bandera Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="019",
    account_system="bandera_prop_id",
)

HOWARD = CountyExport(
    source=Source(
        source_id="tx-howard-cad",
        publisher="Howard County Appraisal District",
        title="2026 certified appraisal roll with supplements (PACS 8.0.34)",
        url="https://howardcad.org/appraisal-rolls/",
        state_fips="48",
        county_fips="227",
        license="No license stated on the appraisal-rolls page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Howard County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="227",
    account_system="howard_prop_id",
)

GILLESPIE = CountyExport(
    source=Source(
        source_id="tx-gillespie-cad",
        publisher="Gillespie Central Appraisal District",
        title="2026 certified data export (PACS 8.0.34 record length)",
        url="https://gillespiecad.org/public-information/",
        state_fips="48",
        county_fips="171",
        license="Data-download disclaimer, May 15, 2019 pdf: public-service access, no warranty of accuracy or completeness. No prohibition is stated. Public redistribution is not granted",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Gillespie Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="171",
    account_system="gillespie_prop_id",
)

TITUS = CountyExport(
    source=Source(
        source_id="tx-titus-cad",
        publisher="Titus County Appraisal District",
        title="2026 certified roll (PACS 8.0.34 record length)",
        url="https://titus-cad.org/download-data/",
        state_fips="48",
        county_fips="449",
        license="No license stated on the download page (read 2026-11-06). A records form prices custom copies. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Titus County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="449",
    account_system="titus_prop_id",
)

BEE = CountyExport(
    source=Source(
        source_id="tx-bee-cad",
        publisher="Bee County Appraisal District",
        title="2026 certification export (PACS 8.0.34 record length)",
        url="https://beecad.org/data-and-records/",
        state_fips="48",
        county_fips="025",
        license="No license stated on the data page (read 2026-11-06). A charges sheet prices a CD copy. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Bee County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="025",
    account_system="bee_prop_id",
)

SHELBY = CountyExport(
    source=Source(
        source_id="tx-shelby-cad",
        publisher="Shelby County Appraisal District",
        title="2026 certified roll, supplement 3 (PACS 8.0.34 record length)",
        url="https://www.shelbycad.com/open-records",
        state_fips="48",
        county_fips="419",
        license="No license stated on the open-records page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Shelby County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="419",
    account_system="shelby_prop_id",
)

SAN_JACINTO = CountyExport(
    source=Source(
        source_id="tx-sanjacinto-cad",
        publisher="San Jacinto County Appraisal District",
        title="2026 county export, header 2026-07-09 (PACS 8.0.34 record length), not labeled certified in the header",
        url="https://sjcad.org/certified-appraisal-rolls/",
        state_fips="48",
        county_fips="407",
        license="No license stated on the rolls page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="San Jacinto County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="407",
    account_system="sanjacinto_prop_id",
)

WASHINGTON = CountyExport(
    source=Source(
        source_id="tx-washington-cad",
        publisher="Washington County Appraisal District",
        title="2026 certified appraisal roll, supplement 0 (PACS 8.0.34 record length)",
        url="https://washingtoncad.org/downloads/",
        state_fips="48",
        county_fips="477",
        license="Downloads page disclaimer, read live 2026-11-06: informational, not a survey, no guarantee of accuracy or completeness, no accountability for errors or omissions. Clicking the link accepts that text. No fee, indemnity, confidentiality, or attestation clause is in the text. Public redistribution is not granted",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Washington County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="477",
    account_system="washington_prop_id",
)

WALKER = CountyExport(
    source=Source(
        source_id="tx-walker-cad",
        publisher="Walker County Appraisal District",
        title="2026 certified roll (PACS 8.0.34)",
        url="https://walkercad.org/texas-public-information-act/",
        state_fips="48",
        county_fips="471",
        license="No license stated on the public-information page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Walker County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="471",
    account_system="walkercad_prop_id",
)

KAUFMAN = CountyExport(
    source=Source(
        source_id="tx-kaufman-cad",
        publisher="Kaufman Central Appraisal District",
        title="2026 certified export (PACS 8.0.34 record length)",
        url="https://kaufman-cad.org/public-info/",
        state_fips="48",
        county_fips="257",
        license="The public-info page says the district cannot offer technical support for reading the exports (read 2026-11-06). No click-through is on the roll links. The map disclaimer was not accepted. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Kaufman Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="257",
    account_system="kaufman_prop_id",
    building_detail_types=frozenset({"CM", "CS", "LA", "STR2"}),
)

NUECES = CountyExport(
    source=Source(
        source_id="tx-nueces-cad",
        publisher="Nueces Central Appraisal District",
        title="2026 certified public export (PACS 8.0.34 record length)",
        url="https://nuecescad.net/downloads-reports/",
        state_fips="48",
        county_fips="355",
        license="No license stated on the downloads page (read 2026-11-06). Public record (Tex. Gov't Code ch. 552)",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Nueces Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="355",
    account_system="ncad_prop_id",
    building_detail_types=frozenset({"MA", "MA2", "OFF", "LIB", "APT", "SHOP", "WHSE", "CHURCH", "REST", "MINISTG", "ST"}),
)

# Local codes whose own labels are not the Comptroller category the PTD column names.
# Mitchell F3/F4 are improvement-only. Dimmit F3 is mineral mapped to F2. Yoakum F3/F4
# are improvement-only; Yoakum F2 itself stays, and FOR has no PTD code so it never maps.
MITCHELL_EXCLUDE = frozenset({"F3", "F4"})
DIMMIT_EXCLUDE = frozenset({"F3"})
YOAKUM_EXCLUDE = frozenset({"F3", "F4"})
# Kimble's own table: C2 is vacant lots (C1), not commercial. F3 and F4 are
# improvement-only accounts with their own property ids, so they are kept and
# not added onto another account. Conversion labels and the unidentified
# "2 N" code are not used.
KIMBLE_EXCLUDE = frozenset({"2 N", "L2A", "L2C", "L2G", "L2H", "L2J", "L2M", "L2P", "L2Q", "L2T"})
# Shackelford's own table: C1C and C2 are vacant lots (C1), not commercial.
# EX1–EX8 are exempt. G1–G3 are minerals. L2* conversion labels are not commercial.
SHACKELFORD_EXCLUDE = frozenset({
    "EX1", "EX2", "EX3", "EX4", "EX5", "EX6", "EX7", "EX8",
    "G1", "G2", "G3",
    "L2A", "L2C", "L2D", "L2E", "L2F", "L2G", "L2J", "L2K", "L2L", "L2M", "L2O", "L2P", "L2Q", "L2S", "L2T", "L4",
})

MITCHELL = CountyExport(
    source=Source(
        source_id="tx-mitchell-cad",
        publisher="Mitchell County Appraisal District",
        title="2026 supplement 2 full-county export (PACS 8.0.34). Not established as the latest complete roll",
        url="https://mitchellcad.org/",
        state_fips="48",
        county_fips="335",
        license="No license stated on the pages read (2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Mitchell County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="335",
    account_system="mitchell_prop_id",
)

DIMMIT = CountyExport(
    source=Source(
        source_id="tx-dimmit-cad",
        publisher="Dimmit Central Appraisal District",
        title="2026 real and manufactured-housing certified values, supplement 0 (PACS 8.0.34)",
        url="https://dimmit-cad.org/data-downloads/",
        state_fips="48",
        county_fips="127",
        license="No license stated on the data-downloads page (read 2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Dimmit Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="127",
    account_system="dimmit_prop_id",
)

YOAKUM = CountyExport(
    source=Source(
        source_id="tx-yoakum-cad",
        publisher="Yoakum County Appraisal District",
        title="2026 certified-values export, supplement 0 (PACS 8.0.34). Mineral accounts are in the file and filtered by code",
        url="https://yoakumcad.org/",
        state_fips="48",
        county_fips="501",
        license="No license stated on the pages read (2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Yoakum County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="501",
    account_system="yoakum_prop_id",
)

KIMBLE = CountyExport(
    source=Source(
        source_id="tx-kimble-cad",
        publisher="Kimble Central Appraisal District",
        title="2026 certified roll, supplement 0, header as of supplement (PACS 8.0.34)",
        url="https://kimblecad.org/downloads/",
        state_fips="48",
        county_fips="267",
        license="The 2020 data-download disclaimer says there is no warranty and the user is responsible for interpreting codes. No assent control was required for the file. Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Kimble Central Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="267",
    account_system="kimble_prop_id",
)

SHACKELFORD = CountyExport(
    source=Source(
        source_id="tx-shackelford-cad",
        publisher="Shackelford County Appraisal District",
        title="2026 certified export, supplement 0, header as of supplement (PACS 8.0.34)",
        url="https://shackelfordcad.com/",
        state_fips="48",
        county_fips="417",
        license="No license stated on the pages read (2026-11-06). Public redistribution is not stated",
        ai_use="unknown",
        redistribution="unknown",
        attribution="Shackelford County Appraisal District",
        terms_reviewed="2026-11-06",
    ),
    county_fips="417",
    account_system="shackelford_prop_id",
)


# Archives the standard library cannot open. Some districts post earlier rolls as 7-Zip or RAR (Bell 2025 and
# 2024); libarchive's bsdtar, present on macOS and most Linux systems, lists and streams their members, so the
# archived file stays the citation and nothing is unpacked to disk.
_BSDTAR_SUFFIXES = frozenset({".7z", ".rar"})


def _bsdtar() -> str:
    import shutil

    exe = shutil.which("bsdtar")
    if exe is None:
        raise NotImplementedError("reading a .7z or .rar roll needs bsdtar (libarchive), which is not installed")
    return exe


def _bsdtar_names(path: Path) -> list[str]:
    import subprocess

    out = subprocess.run([_bsdtar(), "-tf", str(path)], check=True, capture_output=True)
    return [n for n in out.stdout.decode("utf-8", "replace").splitlines() if n and not n.endswith("/")]


def _lines_via_bsdtar(path: Path, name: str) -> Iterator[str]:
    """Stream one member of a 7-Zip or RAR archive through ``bsdtar -xOf``."""
    import subprocess

    proc = subprocess.Popen([_bsdtar(), "-xOf", str(path), name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        assert proc.stdout is not None
        for rec in _crlf_records(proc.stdout):
            yield rec.decode("latin-1")
    finally:
        proc.stdout.close()
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"bsdtar exited {rc} reading {name} from {path}")


def _member(path: str | Path, suffix: str) -> str | None:
    """The one archive member whose name ends with ``suffix``. Entity files are never selected."""
    p = Path(path)
    if p.is_dir():
        names = [str(f.relative_to(p)) for f in p.rglob("*") if f.is_file()]
    elif p.suffix.lower() in _BSDTAR_SUFFIXES:
        names = _bsdtar_names(p)
    else:
        with zipfile.ZipFile(p) as zf:
            names = zf.namelist()
    hit = [n for n in names if n.upper().endswith(suffix) and "ENTITY_INFO" not in n.upper()]
    if len(hit) > 1:
        raise ValueError(f"more than one {suffix} in {path}")
    return hit[0] if hit else None


def _crlf_records(raw) -> Iterator[bytes]:
    """Records separated by CRLF. A bare line feed inside a field stays in the record."""
    pending = b""
    while True:
        chunk = raw.read(1 << 20)
        if not chunk:
            if pending:
                yield pending
            return
        pending += chunk
        parts = pending.split(b"\r\n")
        pending = parts.pop()
        yield from parts


def _lines(path: str | Path, suffix: str) -> Iterator[str]:
    name = _member(path, suffix)
    if name is None:
        return
    p = Path(path)
    if p.is_dir():
        with open(p / name, "rb") as raw:
            for rec in _crlf_records(raw):
                yield rec.decode("latin-1")
        return
    if p.suffix.lower() in _BSDTAR_SUFFIXES:
        yield from _lines_via_bsdtar(p, name)
        return
    with zipfile.ZipFile(p) as zf:
        info = zf.getinfo(name)
        if info.compress_type in _UNZIP_ONLY:
            yield from _lines_via_unzip(p, name)
            return
        with zf.open(name) as raw:
            for rec in _crlf_records(raw):
                yield rec.decode("latin-1")


# Compression methods the standard library cannot read: 9 is Deflate64, which some districts' zips use
# (Galveston 2023 and 2024, Nueces 2021). Info-ZIP's unzip, present on macOS and Linux, streams them.
_UNZIP_ONLY = frozenset({9})


def _lines_via_unzip(path: Path, name: str) -> Iterator[str]:
    """Stream one member through ``unzip -p``; the archive hash and citations are unchanged."""
    import shutil
    import subprocess

    exe = shutil.which("unzip")
    if exe is None:
        raise NotImplementedError(f"{path.name}: member {name} uses a compression method the standard library cannot read and unzip is not installed")
    proc = subprocess.Popen([exe, "-p", str(path), name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        assert proc.stdout is not None
        for rec in _crlf_records(proc.stdout):
            yield rec.decode("latin-1")
    finally:
        proc.stdout.close()
        rc = proc.wait()
        if rc not in (0, 1):  # 1 = warnings only
            raise RuntimeError(f"unzip exited {rc} reading {name} from {path}")


def state_table(path: str | Path) -> dict[str, str]:
    """CAD code → PTD category from ``APPRAISAL_STATE_CODE.TXT`` only."""
    table: dict[str, str] = {}
    for line in _lines(path, _STATE):
        code = _field(line, STATE_CD_FIELDS["state_cd"]).upper()
        ptd = _field(line, STATE_CD_FIELDS["ptd_state_cd"]).upper()
        if code and ptd:
            table[code] = ptd
    if not table:
        raise ValueError(f"no state-code table in {path}")
    return table


def read_roll(path: str | Path, county_fips: str, tally: ExportTally | None = None, *,
              exclude_local: frozenset[str] = frozenset(),
              building_types: frozenset[str] = frozenset()) -> Iterator[ParcelRecord]:
    """Yield one commercial real-property record per account. The first row wins."""
    tally = tally if tally is not None else ExportTally()
    table = state_table(path)
    kept: dict[str, dict[str, str]] = {}
    for line in _lines(path, _INFO):
        tally.info_rows += 1
        if len(line) < _MIN_RECORD:
            tally.short_rows += 1
            continue
        if _field(line, PROP_FIELDS["prop_type_cd"]).upper() != "R":
            tally.not_real += 1
            continue
        if _field(line, PROP_FIELDS["sup_action"]).upper() == "D":
            tally.deleted += 1
            continue
        pid = _field(line, PROP_FIELDS["prop_id"]).lstrip("0")
        if not pid or pid in kept:
            tally.duplicate_ids += 1
            continue
        local = _field(line, PROP_FIELDS["imprv_state_cd"]).upper() or _field(line, PROP_FIELDS["land_state_cd"]).upper()
        if local in exclude_local:
            tally.opaque_code += 1
            continue
        category = table.get(local)
        if category is None:
            tally.unmapped_code += 1
            continue
        if not is_commercial(category):
            tally.out_of_scope += 1
            continue
        row = {name: _field(line, span) for name, span in PROP_FIELDS.items()}
        if _squeeze(row["py_owner_name"]).upper() in ("", "NOT AVAILABLE") and len(line) >= _APPR_BLOCK_END:
            appr = {name: _field(line, span) for name, span in _APPR_OWNER_FIELDS.items()}
            if _squeeze(appr["py_owner_name"]):
                row.update(appr)
                tally.owner_from_appraisal_block += 1
        row["_code"], row["_category"] = local, category
        kept[pid] = row
        tally.kept += 1
        tally.local_codes[local] = tally.local_codes.get(local, 0) + 1
    land: dict[str, float] = defaultdict(float)
    for line in _lines(path, _LAND):
        pid = _field(line, LAND_DET_FIELDS["prop_id"]).lstrip("0")
        if pid not in kept:
            continue
        if sf := _positive(_field(line, LAND_DET_FIELDS["size_square_feet"])):
            land[pid] += sf
        elif acres := _positive(_field(line, LAND_DET_FIELDS["size_acres"]), 4):
            land[pid] += acres * _SQFT_PER_ACRE
    area: dict[str, float] = defaultdict(float)
    built: dict[str, int] = {}
    for line in _lines(path, _IMP):
        if len(line) < 108:
            continue
        pid = _field(line, IMP_DET_FIELDS["prop_id"]).lstrip("0")
        if pid not in kept:
            continue
        # 8.0.33 exports name floors 1ST/2ND. These 8.0.34 rolls name them MA / MA2 and
        # describe them as main area. Porches, garages and pools stay out of the sum.
        detail_type = _field(line, IMP_DET_FIELDS["imprv_det_type_cd"]).upper()
        detail_desc = line[50:75].strip().upper()
        if detail_type not in _FLOOR_DETAIL_TYPES and detail_type not in building_types and "MAIN AREA" not in detail_desc:
            continue
        if a := _positive(_field(line, IMP_DET_FIELDS["imprv_det_area"])):
            area[pid] += a
        if year := _positive(_field(line, IMP_DET_FIELDS["yr_built"])):
            built[pid] = min(built.get(pid, int(year)), int(year))
    for pid, r in kept.items():
        confidential = r["py_confidential_flag"].upper() == "T"
        owner = None if confidential else (_squeeze(r["py_owner_name"]) or None)
        suppressed = confidential or r["py_address_suppress_flag"].upper() == "T"
        land_sf = round(land[pid], 2) if land.get(pid) else None
        if land_sf is None and (acres := _positive(r["land_acres"], 4)):
            land_sf = round(acres * _SQFT_PER_ACRE, 2)
        yield ParcelRecord(
            county_fips=county_fips,
            apn=pid,
            state_category=r["_category"],
            account=pid,
            situs_address=_situs(r),
            owner_name=owner,
            owner_mailing_address=_mailing_address(r) if owner and not suppressed else None,
            owner_confidential=confidential,
            land_area_sf=land_sf,
            improvement_area_sf=round(area[pid], 2) if area.get(pid) else None,
            year_built=built.get(pid),
            market_value=_num(r["market_value"]),
            appraised_value=_num(r["appraised_val"]),
            tax_year=int(y) if (y := _num(r["prop_val_yr"])) else None,
            locator=f"APPRAISAL_INFO prop_id {pid}",
            local_use_code=r["_code"] or None,
        )


def read_value_history(path: str | Path, accounts: Iterable[str], county_fips: str,
                       tally: ExportTally | None = None) -> Iterator[ParcelValues]:
    """Yield each listed account's tax year, market and appraised value from ``APPRAISAL_INFO.TXT``, and nothing else.

    For a prior-year roll (``Registry.ingest_value_history``): the owner, address and detail columns are never read,
    and the state-code, land and improvement files are not opened. Only real property that is not marked deleted
    counts; the first row of an account wins, as in ``read_roll``. The columns read (``prop_id``, ``prop_type_cd``,
    ``prop_val_yr``, ``sup_action``, ``appraised_val``, ``market_value``) sit at the same positions in the 8.0.30,
    8.0.33 and 8.0.34 property records.
    """
    tally = tally if tally is not None else ExportTally()
    wanted = frozenset(accounts)
    seen: set[str] = set()
    for line in _lines(path, _INFO):
        tally.info_rows += 1
        if len(line) < _MIN_RECORD:
            tally.short_rows += 1
            continue
        if _field(line, PROP_FIELDS["prop_type_cd"]).upper() != "R":
            tally.not_real += 1
            continue
        if _field(line, PROP_FIELDS["sup_action"]).upper() == "D":
            tally.deleted += 1
            continue
        pid = _field(line, PROP_FIELDS["prop_id"]).lstrip("0")
        if pid not in wanted:
            tally.out_of_scope += 1
            continue
        if pid in seen:
            tally.duplicate_ids += 1
            continue
        seen.add(pid)
        tally.kept += 1
        yield ParcelValues(
            county_fips=county_fips, apn=pid,
            tax_year=int(y) if (y := _num(_field(line, PROP_FIELDS["prop_val_yr"]))) else None,
            market_value=_num(_field(line, PROP_FIELDS["market_value"])),
            appraised_value=_num(_field(line, PROP_FIELDS["appraised_val"])),
            locator=f"APPRAISAL_INFO prop_id {pid}",
        )


def build_history(snapshot_path: str | Path, db_path: str | Path, source: Source, *, county_fips: str,
                  account_system: str, as_of: str, tax_year: int,
                  retrieved_at: str | None = None) -> tuple[IngestStats, ExportTally]:
    """Add one prior year's values from an archived PACS export to the county's parcels already loaded.

    History only (``Registry.ingest_value_history``): the current record, owners and addresses are not touched. The
    year is loaded under ``roll_source(source, tax_year)``. A row whose ``prop_val_yr`` is not ``tax_year`` is not
    loaded and is named in ``stats.errors``.
    """
    tally = ExportTally()
    reg = Registry(db_path)
    try:
        src = roll_source(source, tax_year)
        reg.add_source(src)
        snap = reg.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        accounts = [row[0] for row in reg.db.execute("SELECT external_id FROM crosswalk WHERE system = ?", (account_system,))]
        wrong: list[str] = []

        def in_year(rows: Iterable[ParcelValues]) -> Iterator[ParcelValues]:
            for r in rows:
                if r.tax_year == tax_year:
                    yield r
                else:
                    wrong.append(f"{r.locator}: tax year {r.tax_year}, expected {tax_year}")

        stats = reg.ingest_value_history(in_year(read_value_history(snapshot_path, accounts, county_fips, tally)), snap,
                                         state_fips="48")
        stats.seen += len(wrong)
        stats.skipped_invalid += len(wrong)
        stats.errors.extend(wrong[:20])
        stats.source_id, stats.tax_year = src.source_id, tax_year
        return stats, tally
    finally:
        reg.close()


def build(snapshot_path: str | Path, db_path: str | Path, county: CountyExport, *, as_of: str,
          retrieved_at: str | None = None, exclude_local: frozenset[str] = frozenset()) -> tuple[IngestStats, ExportTally]:
    """Ingest one archived export into a registry file. Entity members are not read."""
    tally = ExportTally()
    reg = Registry(db_path)
    try:
        stats = reg.ingest_roll(
            county.source, snapshot_path, read_roll(snapshot_path, county.county_fips, tally, exclude_local=exclude_local,
                      building_types=county.building_detail_types),
            as_of=as_of, retrieved_at=retrieved_at, state_fips="48", account_system=county.account_system,
            full_roll=True,
        )
    finally:
        reg.close()
    return stats, tally


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.tx_pacs34")
    ap.add_argument("county", choices=("galveston", "nueces"))
    ap.add_argument("snapshot")
    ap.add_argument("db")
    ap.add_argument("--as-of", required=True)
    ap.add_argument("--retrieved-at")
    args = ap.parse_args(argv)
    county = GALVESTON if args.county == "galveston" else NUECES
    stats, tally = build(args.snapshot, args.db, county, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps({"stats": asdict(stats), "tally": asdict(tally)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
