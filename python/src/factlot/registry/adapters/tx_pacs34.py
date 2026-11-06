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
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..normalize import is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source
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
    local_codes: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class CountyExport:
    source: Source
    county_fips: str
    account_system: str


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
)


def _member(path: str | Path, suffix: str) -> str | None:
    """The one archive member whose name ends with ``suffix``. Entity files are never selected."""
    p = Path(path)
    if p.is_dir():
        names = [str(f.relative_to(p)) for f in p.rglob("*") if f.is_file()]
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
    with zipfile.ZipFile(p) as zf, zf.open(name) as raw:
        for rec in _crlf_records(raw):
            yield rec.decode("latin-1")


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
              exclude_local: frozenset[str] = frozenset()) -> Iterator[ParcelRecord]:
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
        if detail_type not in _FLOOR_DETAIL_TYPES and "MAIN AREA" not in detail_desc:
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


def build(snapshot_path: str | Path, db_path: str | Path, county: CountyExport, *, as_of: str,
          retrieved_at: str | None = None, exclude_local: frozenset[str] = frozenset()) -> tuple[IngestStats, ExportTally]:
    """Ingest one archived export into a registry file. Entity members are not read."""
    tally = ExportTally()
    reg = Registry(db_path)
    try:
        stats = reg.ingest_roll(
            county.source, snapshot_path, read_roll(snapshot_path, county.county_fips, tally, exclude_local=exclude_local),
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
