"""Public building energy benchmarking disclosures (NYC Local Law 84, DC) → ``ParcelFacts``.

Cities that require large buildings to report energy and water use to the EPA's Portfolio Manager publish the results.
This adapter attaches the newest usable report of each property to the registry's parcels under the same predicates,
whatever the city:

- ``energy.reporting_year``: the year of the report as the publisher gives it (NYC: the calendar year the data covers;
  DC: the dataset's ``REPORTINGYEAR``).
- ``energy.property_type``: the EPA primary property type (``Office``, ``Multifamily Housing``).
- ``energy.site_eui`` (kBtu/ft2), ``energy.weather_normalized_site_eui`` (kBtu/ft2), ``energy.source_eui`` (kBtu/ft2),
  ``energy.energy_star_score`` (1 to 100), ``energy.ghg_emissions`` (total location-based greenhouse gas emissions,
  metric tons CO2e), ``energy.ghg_intensity`` (kg CO2e/ft2), ``energy.floor_area_sf`` (the gross floor area the report
  used).
- ``energy.property_lot_count``: written only when one report covers several tax lots, in which case every figure above
  describes the whole property and is attached to each of its lots; it must not be read as the lot's own.

One report per parcel: for each parcel, the latest report year in the file that has a usable report (a positive site
EUI). If that year has reports of more than one property on the parcel (a condominium with several reporting
properties, a campus), the parcel gets nothing: single-valued predicates cannot hold two properties and the file does
not say which is the lot's. Earlier years are not stored; the year is in ``energy.reporting_year``.

Names are never read: not the property name, not the owner of record, not the address (DC's layer carries an owner
column; NYC's carries the property name; neither is requested). Every fact is ``public_record`` and cites the file and
the report's line or record.

- **NYC** (``ny-nyc-dob-ll84``): NYC Open Data ``5zyy-y8am``, CSV with the adapter's ``$select`` (``NYC_COLUMNS``). The
  BBL column lists one or more lots separated by ``;`` or ``,``. "Not Available" stands for missing.
- **DC** (``dc-doee-energy-benchmarking``): DOEE's Building Energy Benchmarks layer (DC GIS feature service layer 45),
  ArcGIS ``query`` responses (``f=json``) with the adapter's ``outFields`` (``DC_FIELDS``). Only reports with status
  ``In Compliance`` are used. The ``SSL`` column lists one or more SSLs separated by ``;``.

- **Denver** (``co-denver-energize-benchmarking``): the City's *Energize Denver Master Dataset* (an ``.xlsx`` the Climate
  Action, Sustainability and Resiliency office posts each year; buildings of 25,000 sq ft and more). The file has a
  building ID, the building's name and street address, and **no parcel number**, so a row is matched to a parcel by its
  street address: the address, with ", DENVER CO", normalised like the registry's situs addresses (``normalize_address``),
  must equal the address key of exactly one parcel. That is an inference, so these facts are ``inferred`` with
  confidence 0.85, and a row whose address matches no parcel or several is left out. Building names are never read.

Usage::

    python -m factlot.registry.adapters.energy_benchmark nyc ll84.csv registry.db --as-of 2025-11-25
    python -m factlot.registry.adapters.energy_benchmark dc page1.json page2.json ... registry.db --as-of 2026-11-02
    python -m factlot.registry.adapters.energy_benchmark denver master.xlsx registry.db --as-of 2026-09-22
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..normalize import normalize_address
from ..store import IngestStats, ParcelFacts, Registry, Source
from . import xlsx_reader
from .ny_pluto import COUNTY_FIPS as NYC_COUNTY_FIPS

NYC_STATE_FIPS = "36"
DC_STATE_FIPS, DC_COUNTY_FIPS = "11", "001"

NYC_SOURCE = Source(
    source_id="ny-nyc-dob-ll84",
    publisher="New York City Department of Buildings",
    title="Local Law 84 energy and water benchmarking disclosure (2022-present)",
    url="https://data.cityofnewyork.us/Environment/NYC-Building-Energy-and-Water-Data-Disclosure-for-Lo/5zyy-y8am",
    state_fips=NYC_STATE_FIPS,
    county_fips=None,  # five counties; each record carries its own
    license="Published on NYC Open Data under the NYC Open Data Law (Admin. Code §23-502). NYC Open Data "
            "FAQ: 'Open Data belongs to all New Yorkers. There are no restrictions on the use of Open "
            "Data.' Owners self-report to the EPA's Portfolio Manager; the figures are as submitted and "
            "are not verified by the City.",
    ai_use="unknown",  # not addressed by the publisher beyond 'no restrictions on the use'
    redistribution="permitted",  # no restrictions on use (FAQ)
    attribution="New York City Department of Buildings, Local Law 84 benchmarking",
    terms_reviewed="2026-11-04",
)
DC_SOURCE = Source(
    source_id="dc-doee-energy-benchmarking",
    publisher="District of Columbia Department of Energy and Environment (DC GIS)",
    title="Building Energy Benchmarks (Clean and Affordable Energy Act benchmarking)",
    url="https://opendata.dc.gov/datasets/DCGIS::building-energy-benchmarking",
    state_fips=DC_STATE_FIPS,
    county_fips=DC_COUNTY_FIPS,
    license="CC-BY-4.0 (Open Data DC item 'Building Energy Benchmarking'); District terms for District data: the "
            "data on the sites is public domain under a CC0 1.0 dedication. Owners self-report to the EPA's "
            "Portfolio Manager; DOEE publishes the results.",
    ai_use="permitted",
    redistribution="attribution_required",
    attribution="District of Columbia Department of Energy and Environment (DOEE), Open Data DC",
    terms_reviewed="2026-11-04",
)

NYC_COLUMNS = ("report_year", "property_id", "nyc_borough_block_and_lot", "primary_property_type", "year_ending",
               "site_eui_kbtu_ft", "weather_normalized_site_eui", "source_eui_kbtu_ft", "energy_star_score",
               "total_location_based_ghg", "total_location_based_ghg_1", "property_gfa_calculated", "number_of_buildings")
DC_FIELDS = ("SSL", "PMPROPERTYID", "REPORTINGYEAR", "REPORTSTATUS", "PRIMARYPROPERTYTYPE_EPACALC",
             "PRIMARYPROPERTYTYPE_SELFSELECT", "ENERGYSTARSCORE", "SITEEUI_KBTU_FT", "WEATHERNORMALZEDSITEEUI_KBTUFT",
             "SOURCEEUI_KBTU_FT", "TOTGHGEMISSIONS_METRICTONSCO2E", "TOTGHGEMISSINTENSITY_KGCO2EFT",
             "REPORTEDBUILDINGGROSSFLOORAREA", "TAXRECORDFLOORAREA")

_MISSING = {"", "not available", "n/a", "na", "null", "none"}


DENVER_STATE_FIPS, DENVER_COUNTY_FIPS = "08", "031"
DENVER_SOURCE = Source(
    source_id="co-denver-energize-benchmarking",
    publisher="City and County of Denver, Climate Action, Sustainability and Resiliency",
    title="Energize Denver Master Dataset (building energy benchmarking)",
    url="https://opendata-geospatialdenver.hub.arcgis.com/documents/geospatialDenver::energize-denver-2025-master-dataset",
    state_fips=DENVER_STATE_FIPS,
    county_fips=DENVER_COUNTY_FIPS,
    license="CC BY 3.0 (City and County of Denver open data catalog); the item's use constraints disclaim liability and "
            "say NOT FOR ENGINEERING PURPOSES. Owners self-report to the EPA's Portfolio Manager.",
    ai_use="unknown",  # not addressed by the publisher; CC BY 3.0 does not restrict it
    redistribution="attribution_required",  # CC BY 3.0
    attribution="City and County of Denver",
    terms_reviewed="2026-11-04",
)
DENVER_MATCH_CONFIDENCE = 0.85
# The columns the adapter reads from the Denver workbook (property name and mailing columns are never read).
DENVER_COLUMNS = ("Building ID", "Street", "Primary Property Type EPA Calculated", "Master Sq Ft", "Reporting Year",
                  "Energy Star Score", "Site EUI (kBtu/sq ft)", "Weather Normalized Site EUI (kBtu/sq ft)",
                  "Total GHG Emissions (Metric Tons Co2e)")


@dataclass
class Counts:
    reports_read: int = 0
    reports_usable: int = 0
    parcels_with_a_report: int = 0
    parcels_skipped_several_properties: int = 0
    parcels_multi_lot_property: int = 0
    parcels_by_year: dict[str, int] = field(default_factory=dict)
    rows_matched_to_one_parcel: int = 0
    rows_address_matches_no_parcel: int = 0
    rows_address_matches_several_parcels: int = 0


@dataclass
class Report:
    year: int
    property_id: str
    facts: list[tuple[str, object, str | None]]
    lots: int
    where: str
    method: str = "public_record"
    confidence: float | None = None


def _number(v: object) -> float | None:
    s = str(v if v is not None else "").strip().replace(",", "")
    if s.lower() in _MISSING:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean(v: float) -> int | float:
    v = round(v, 4)
    return int(v) if v == int(v) else v


def _text(v: object) -> str:
    s = " ".join(str(v if v is not None else "").split())
    return "" if s.lower() in _MISSING else s


def report_facts(year: int, property_type: object, site_eui: object, weather_normalized: object, source_eui: object,
                 score: object, ghg: object, ghg_intensity: object, area: object, lots: int) -> list[tuple[str, object, str | None]]:
    """The ``(predicate, value, unit)`` facts of one report; ``[]`` unless it has a positive site EUI."""
    eui = _number(site_eui)
    if eui is None or eui <= 0:
        return []
    out: list[tuple[str, object, str | None]] = [("energy.reporting_year", year, None)]
    if t := _text(property_type):
        out.append(("energy.property_type", t, None))
    out.append(("energy.site_eui", _clean(eui), "kBtu/ft2"))
    for predicate, raw, unit in (("energy.weather_normalized_site_eui", weather_normalized, "kBtu/ft2"),
                                 ("energy.source_eui", source_eui, "kBtu/ft2")):
        if (n := _number(raw)) is not None and n > 0:
            out.append((predicate, _clean(n), unit))
    if (n := _number(score)) is not None and 1 <= n <= 100:
        out.append(("energy.energy_star_score", int(n), None))
    if (n := _number(ghg)) is not None and n >= 0:
        out.append(("energy.ghg_emissions", _clean(n), "tCO2e"))
    if (n := _number(ghg_intensity)) is not None and n >= 0:
        out.append(("energy.ghg_intensity", _clean(n), "kgCO2e/ft2"))
    if (n := _number(area)) is not None and n > 0:
        out.append(("energy.floor_area_sf", _clean(n), "sf"))
    if lots > 1:
        out.append(("energy.property_lot_count", lots, None))
    return out


def _bbls(raw: object) -> list[str]:
    seen: list[str] = []
    for part in re.split(r"[;,\s]+", str(raw or "")):
        head = part.strip().split(".")[0]
        if len(head) == 10 and head.isdigit() and head[0] in NYC_COUNTY_FIPS and head not in seen:
            seen.append(head)
    return seen


def nyc_reports(path: str | Path, counts: Counts) -> Iterator[tuple[tuple[str, str], Report]]:
    csv.field_size_limit(1 << 30)
    name = Path(path).name
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip().lower() for h in next(reader, [])]
        for n, values in enumerate(reader, 2):
            r = dict(zip(header, values))
            counts.reports_read += 1
            lots = _bbls(r.get("nyc_borough_block_and_lot"))
            try:
                year = int(float(r.get("report_year") or ""))
            except ValueError:
                continue
            facts = report_facts(year, r.get("primary_property_type"), r.get("site_eui_kbtu_ft"),
                                 r.get("weather_normalized_site_eui"), r.get("source_eui_kbtu_ft"), r.get("energy_star_score"),
                                 r.get("total_location_based_ghg"), r.get("total_location_based_ghg_1"),
                                 r.get("property_gfa_calculated"), len(lots))
            if not facts or not lots:
                continue
            counts.reports_usable += 1
            pid = _text(r.get("property_id"))
            where = f"{name} line {n}: Portfolio Manager property {pid}, report year {year}"
            for b in lots:
                yield (NYC_COUNTY_FIPS[b[0]], b), Report(year, pid, facts, len(lots), where)


def _ssls(raw: object) -> list[str]:
    seen: list[str] = []
    for part in re.split(r"[;]+", str(raw or "")):
        s = " ".join(part.split()).upper()
        if re.fullmatch(r"\d{4}[A-Z]{0,4} ?\d{4}", s) and s not in seen:
            seen.append(s)
    return seen


def dc_reports(paths: Iterable[str | Path], counts: Counts) -> Iterator[tuple[tuple[str, str], Report]]:
    for path in paths:
        name = Path(path).name
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        for n, feature in enumerate(data.get("features", []), 1):
            a = feature["attributes"]
            counts.reports_read += 1
            if _text(a.get("REPORTSTATUS")) != "In Compliance":
                continue
            lots = _ssls(a.get("SSL"))
            year = a.get("REPORTINGYEAR")
            if not isinstance(year, int):
                continue
            facts = report_facts(year, a.get("PRIMARYPROPERTYTYPE_EPACALC") or a.get("PRIMARYPROPERTYTYPE_SELFSELECT"),
                                 a.get("SITEEUI_KBTU_FT"), a.get("WEATHERNORMALZEDSITEEUI_KBTUFT"), a.get("SOURCEEUI_KBTU_FT"),
                                 a.get("ENERGYSTARSCORE"), a.get("TOTGHGEMISSIONS_METRICTONSCO2E"),
                                 a.get("TOTGHGEMISSINTENSITY_KGCO2EFT"),
                                 a.get("REPORTEDBUILDINGGROSSFLOORAREA"), len(lots))
            if not facts or not lots:
                continue
            counts.reports_usable += 1
            pid = _text(a.get("PMPROPERTYID"))
            where = f"{name} record {n}: Portfolio Manager property {pid}, reporting year {year}"
            for s in lots:
                yield (DC_COUNTY_FIPS, s), Report(year, pid, facts, len(lots), where)


def denver_reports(path: str | Path, parcels_at: Callable[[str], list[str]], counts: Counts) -> Iterator[tuple[tuple[str, str], Report]]:
    """Report rows of the Denver workbook, each placed on the one parcel at its street address."""
    name = Path(path).name
    names: dict[str, int] | None = None
    for n, row in enumerate(xlsx_reader.rows(path), 1):
        if names is None:
            cells = [str(c).strip() if c is not None else "" for c in row]
            if "Building ID" in cells and "Street" in cells:
                names = {c: i for i, c in enumerate(cells) if c in DENVER_COLUMNS}
            continue

        def cell(col: str) -> object:
            i = names.get(col) if names else None
            return row[i] if i is not None and i < len(row) else None

        counts.reports_read += 1
        year = _number(cell("Reporting Year"))
        street = _text(cell("Street"))
        facts = report_facts(int(year) if year else 0, cell("Primary Property Type EPA Calculated"), cell("Site EUI (kBtu/sq ft)"),
                             cell("Weather Normalized Site EUI (kBtu/sq ft)"), None, cell("Energy Star Score"),
                             cell("Total GHG Emissions (Metric Tons Co2e)"), None, cell("Master Sq Ft"), 1)
        if not facts or not year or not street:
            continue
        counts.reports_usable += 1
        apns = parcels_at(street)
        if not apns:
            counts.rows_address_matches_no_parcel += 1
            continue
        if len(apns) > 1:
            counts.rows_address_matches_several_parcels += 1
            continue
        counts.rows_matched_to_one_parcel += 1
        bid = _text(cell("Building ID")).removesuffix(".0")
        where = (f"{name} row {n}: Energize Denver building {bid}, reporting year {int(year)}, "
                 f"matched on street address {normalize_address(street + ', DENVER CO')}")
        yield (DENVER_COUNTY_FIPS, apns[0]), Report(int(year), bid, facts, 1, where, "inferred", DENVER_MATCH_CONFIDENCE)



def parcel_facts(reports: Iterable[tuple[tuple[str, str], Report]], counts: Counts) -> Iterator[ParcelFacts]:
    """One ``ParcelFacts`` per parcel: its latest usable report year; nothing when that year has several properties."""
    by_parcel: dict[tuple[str, str], dict[int, dict[str, Report]]] = defaultdict(lambda: defaultdict(dict))
    for key, rep in reports:
        by_parcel[key][rep.year][rep.property_id] = rep  # a property listed twice in a year counts once (the last)
    for (county, apn), years in by_parcel.items():
        latest = max(years)
        props = years[latest]
        if len(props) > 1:
            counts.parcels_skipped_several_properties += 1
            continue
        rep = next(iter(props.values()))
        counts.parcels_with_a_report += 1
        counts.parcels_multi_lot_property += rep.lots > 1
        counts.parcels_by_year[str(latest)] = counts.parcels_by_year.get(str(latest), 0) + 1
        yield ParcelFacts(county, apn, list(rep.facts), locator=rep.where, method=rep.method, confidence=rep.confidence)


def _build(source: Source, state_fips: str, path_for_snapshot: str | Path, extra_snapshots: list[str | Path],
           reports: Iterable[tuple[tuple[str, str], Report]], db_path: str | Path, counts: Counts, as_of: str,
           retrieved_at: str | None) -> IngestStats:
    reg = Registry(db_path)
    try:
        reg.add_source(source)
        for extra in extra_snapshots:
            reg.add_snapshot(source.source_id, extra, as_of, retrieved_at)
        snap = reg.add_snapshot(source.source_id, path_for_snapshot, as_of, retrieved_at)
        return reg.ingest_parcel_facts(parcel_facts(reports, counts), snap,
                                       state_fips=state_fips, full_roll=True)
    finally:
        reg.close()


def build_nyc(path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
              counts: Counts | None = None) -> IngestStats:
    counts = counts if counts is not None else Counts()
    return _build(NYC_SOURCE, NYC_STATE_FIPS, path, [], nyc_reports(path, counts), db_path, counts, as_of, retrieved_at)


def build_dc(paths: list[str | Path], db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
             counts: Counts | None = None) -> IngestStats:
    """DC's layer arrives in pages of 2,000 records; every page is a snapshot of the source and the facts cite the
    first page (the locator names the page file and record)."""
    counts = counts if counts is not None else Counts()
    return _build(DC_SOURCE, DC_STATE_FIPS, paths[0], list(paths[1:]), dc_reports(paths, counts), db_path, counts, as_of, retrieved_at)


def registry_address_lookup(db_path: str | Path) -> Callable[[str], list[str]]:
    """A function from a Denver street address to the APNs of the parcels whose situs address key equals it."""
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    apn = {urn: a for urn, a in db.execute(
        "SELECT subject, json_extract(value_json, '$') FROM current_facts WHERE predicate = 'parcel.apn' "
        "AND subject LIKE 'fl:parcel:us-08031:%'")}
    by_key: dict[str, list[str]] = defaultdict(list)
    for key, urn in db.execute("SELECT key, urn FROM address_index WHERE urn LIKE 'fl:parcel:us-08031:%'"):
        if urn in apn:
            by_key[key].append(apn[urn])
    db.close()
    return lambda street: sorted(set(by_key.get(normalize_address(street + ", DENVER CO"), [])))


def build_denver(path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
                 counts: Counts | None = None) -> IngestStats:
    counts = counts if counts is not None else Counts()
    lookup = registry_address_lookup(db_path)
    return _build(DENVER_SOURCE, DENVER_STATE_FIPS, path, [], denver_reports(path, lookup, counts), db_path, counts, as_of, retrieved_at)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.energy_benchmark", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("city", choices=("nyc", "dc", "denver"))
    ap.add_argument("files", nargs="+", help="the downloaded file(s) followed by the registry file")
    ap.add_argument("--as-of", required=True, help="the dataset's last-updated date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    *paths, db = args.files
    counts = Counts()
    if args.city == "nyc":
        stats = build_nyc(paths[0], db, as_of=args.as_of, retrieved_at=args.retrieved_at, counts=counts)
    elif args.city == "denver":
        stats = build_denver(paths[0], db, as_of=args.as_of, retrieved_at=args.retrieved_at, counts=counts)
    else:
        stats = build_dc(paths, db, as_of=args.as_of, retrieved_at=args.retrieved_at, counts=counts)
    print(json.dumps({"ingest": asdict(stats), "reader": asdict(counts)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
