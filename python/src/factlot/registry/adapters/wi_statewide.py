"""Wisconsin Statewide Parcel Map Initiative (V12) → ``ParcelRecord``; covers every Wisconsin county.

The State Cartographer's Office and the Department of Administration's Wisconsin Land Information
Program aggregate the counties' parcel and tax-roll data once a year (V12: 3,574,646 parcels,
released 2026-06-30). The full file geodatabase is 516 MB, so the collector archives pages of the
public ArcGIS REST feature service instead (``Wisconsin_Statewide_Parcels_DB/FeatureServer/0``),
queried with ``returnGeometry=false``, ordered by ``OBJECTID`` and filtered to commercial or
manufacturing parcels; each archived file is one ``f=json`` page (``{"features": [{"attributes":
{…}}, …]}``, at most 2,000 features). Layout confirmed on the V12 schema documentation
(``V12_Wisconsin_Statewide_Parcels_Schema_Documentation.pdf``) and on live pages, 2026-11-03.

Columns read (all text unless noted):

- ``PARCELID`` — the county's parcel id (the tax key); ``STATEID`` is ``<PARCELFIPS><PARCELID>``. Ids carry
  dashes, periods, slashes and spaces in 31 counties, and differ by punctuation alone in some (Brown
  ``11-109`` and ``1-1109``), so the APN is ``apn_for(PARCELID)``, which escapes them (a Milwaukee tax key is
  unchanged). The same PARCELID occurs in more than one county, so the account (crosswalk ``wi_parcelid``)
  is ``<county FIPS>:<PARCELID>``.
- ``CONAME`` — "the name of the county which the parcel is administratively part of", spelled as the
  schema's Table B-1 ("County Naming and FIPS Codes"); ``PARCELFIPS`` — "the 3-digit FIPS code of the
  county (the contributing jurisdiction of the parcel dataset)". The two differ where a city that spans a
  county line supplies its own parcels: in V12, 5,258 Calumet County parcels carry Outagamie's (Appleton)
  or Winnebago's (Menasha) PARCELFIPS, and 172 Winnebago parcels carry Outagamie's. The county of a record
  is therefore ``CONAME`` through Table B-1 (``COUNTY_FIPS``); ``PARCELFIPS`` is used only when ``CONAME``
  is not a Wisconsin county name.
- ``PROPCLASS`` — the statutory class of property (Wis. Stat. 70.32(2)(a)): ``1`` residential,
  ``2`` commercial, ``3`` manufacturing, ``4`` agricultural, ``5`` undeveloped, ``5M`` agricultural
  forest, ``6`` productive forest land, ``7`` other. A parcel with several classes lists them comma
  separated (``1,2``). Tax-exempt parcels have a null class and an ``AUXCLASS`` instead. Wisconsin
  has no multifamily class: apartment buildings are class 2, so they map to F1 here and the
  registry cannot tell them from other commercial property.
- ``OWNERNME1`` / ``OWNERNME2`` — owner names (the first is used). Counties that redact owners write
  ``NOT AVAILABLE`` (Kenosha County entirely; eight counties in part; Jackson writes it twice); that
  becomes ``owner_confidential``. ``UNKNOWN`` and ``UNKNOWN OWNER`` (a few rows in Columbia, Marathon,
  Racine and Dane) are no owner. Milwaukee County truncates names to about 28 characters.
- ``PSTLADRESS`` — the owner's mailing address on one line; ``SITEADRESS``, ``PLACENAME``
  (``CITY OF MILWAUKEE``), ``ZIPCODE`` — the situs.
- ``CNTASSDVALUE`` total assessed value, ``ESTFMKVALUE`` estimated fair market value (dollars),
  ``DEEDACRES`` / ``ASSDACRES`` / ``GISACRES`` acres, ``TAXROLLYEAR`` the roll year (2025 for most
  counties in V12).

Usage: ``python -m factlot.registry.adapters.wi_statewide collected/wi-statewide-parcels registry.db --as-of 2026-06-30``
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from pathlib import Path

from ..normalize import COMMERCIAL_CATEGORIES, is_commercial
from ..store import IngestStats, ParcelRecord, Registry, Source

STATE_FIPS = "55"
ACCOUNT_SYSTEM = "wi_parcelid"

SOURCE = Source(
    source_id="wi-statewide-parcels",
    publisher="Wisconsin State Cartographer's Office and Department of Administration, Wisconsin Land Information Program",
    title="Wisconsin Statewide Parcel Map Initiative, V12 (Wisconsin_Statewide_Parcels_DB)",
    url="https://www.sco.wisc.edu/parcels/data/",
    state_fips=STATE_FIPS,
    license="No formal licence; 'free of charge' and 'free for public consumption' (publisher's data page and ArcGIS item "
            "metadata). Accuracy and warranty disclaimer only",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="permitted",  # no restriction stated; free for public consumption
    attribution="Wisconsin State Cartographer's Office / Department of Administration, Wisconsin Land Information "
                "Program (V12 Statewide Parcel Map Database Project)",
    terms_reviewed="2026-11-03",
)

# Schema Table B-1, "County Naming and FIPS Codes" (V12 schema documentation): CONAME → county FIPS.
COUNTY_FIPS = {
    "ADAMS": "001", "ASHLAND": "003", "BARRON": "005", "BAYFIELD": "007", "BROWN": "009", "BUFFALO": "011",
    "BURNETT": "013", "CALUMET": "015", "CHIPPEWA": "017", "CLARK": "019", "COLUMBIA": "021", "CRAWFORD": "023",
    "DANE": "025", "DODGE": "027", "DOOR": "029", "DOUGLAS": "031", "DUNN": "033", "EAU CLAIRE": "035",
    "FLORENCE": "037", "FOND DU LAC": "039", "FOREST": "041", "GRANT": "043", "GREEN": "045", "GREEN LAKE": "047",
    "IOWA": "049", "IRON": "051", "JACKSON": "053", "JEFFERSON": "055", "JUNEAU": "057", "KENOSHA": "059",
    "KEWAUNEE": "061", "LA CROSSE": "063", "LAFAYETTE": "065", "LANGLADE": "067", "LINCOLN": "069",
    "MANITOWOC": "071", "MARATHON": "073", "MARINETTE": "075", "MARQUETTE": "077", "MENOMINEE": "078",
    "MILWAUKEE": "079", "MONROE": "081", "OCONTO": "083", "ONEIDA": "085", "OUTAGAMIE": "087", "OZAUKEE": "089",
    "PEPIN": "091", "PIERCE": "093", "POLK": "095", "PORTAGE": "097", "PRICE": "099", "RACINE": "101",
    "RICHLAND": "103", "ROCK": "105", "RUSK": "107", "ST CROIX": "109", "SAUK": "111", "SAWYER": "113",
    "SHAWANO": "115", "SHEBOYGAN": "117", "TAYLOR": "119", "TREMPEALEAU": "121", "VERNON": "123", "VILAS": "125",
    "WALWORTH": "127", "WASHBURN": "129", "WASHINGTON": "131", "WAUKESHA": "133", "WAUPACA": "135",
    "WAUSHARA": "137", "WINNEBAGO": "139", "WOOD": "141",
}
_WI_FIPS = frozenset(COUNTY_FIPS.values())

# Owner values the counties write where an owner is redacted (schema documentation: "NOT AVAILABLE").
_WITHHELD_OWNERS = frozenset({"NOT AVAILABLE", "NOT AVAIL", "REDACTED", "CONFIDENTIAL"})
# Owner values that say only that the county has no owner of record (V12: Columbia, Marathon, Racine, Dane).
_PLACEHOLDER_OWNERS = frozenset({"UNKNOWN", "UNKNOWN OWNER", "OWNER UNKNOWN", "N/A", "NONE"})
_SQFT_PER_ACRE = 43560
_PLACE_PREFIX = re.compile(r"^(CITY|TOWN|VILLAGE) OF\s+", re.I)


def _squeeze(s: object) -> str:
    return re.sub(r"\s+", " ", str(s) if s is not None else "").strip()


def _positive(v: object) -> float | None:
    try:
        x = float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return x if x and x > 0 else None


def classes(code: object) -> list[str]:
    """The property classes in a ``PROPCLASS`` value (``"1,2"`` → ``["1", "2"]``), upper-cased."""
    return [c.strip().upper() for c in _squeeze(code).split(",") if c.strip()]


def state_category(code: object) -> str | None:
    """``2`` → F1 (commercial; apartments included), ``3`` → F2 (manufacturing).

    A parcel with several classes is commercial when class 2 is among them, otherwise
    manufacturing when class 3 is. Everything else maps to its nearest out-of-scope category.
    """
    cs = classes(code)
    if not cs:
        return None
    if "2" in cs:
        return "F1"
    if "3" in cs:
        return "F2"
    first = cs[0]
    return {"1": "A", "4": "D1", "5": "C1", "5M": "D1", "6": "D2", "7": "G"}.get(first)


def county_fips(a: dict) -> str | None:
    """The 3-digit FIPS of the county the parcel is part of: ``CONAME`` through Table B-1, else
    ``PARCELFIPS`` (the contributing county; a 5-digit value loses its ``55`` prefix), else ``STATEID``.
    ``None`` when none of them names a Wisconsin county (V12 has one such row: ``MENOMONIE``, ``999``)."""
    name = re.sub(r"[^A-Z ]+", " ", _squeeze(a.get("CONAME")).upper())
    by_name = COUNTY_FIPS.get(" ".join(name.split()))
    if by_name:
        return by_name
    f = re.sub(r"\D", "", _squeeze(a.get("PARCELFIPS")))
    if len(f) == 5 and f.startswith(STATE_FIPS):
        f = f[2:]
    if len(f) != 3:
        sid = re.sub(r"\D", "", _squeeze(a.get("STATEID")))
        f = sid[:3]
    return f if f in _WI_FIPS else None


def _situs(a: dict) -> str | None:
    street = _squeeze(a.get("SITEADRESS"))
    if not street:
        return None
    place = _PLACE_PREFIX.sub("", _squeeze(a.get("PLACENAME")))
    rest = " ".join(x for x in (place, "WI" if place else "", _squeeze(a.get("ZIPCODE"))) if x)
    return f"{street}, {rest}" if rest else street


def _owner(a: dict) -> tuple[str | None, bool]:
    """``(owner name, withheld)``: a redacted owner is withheld, never a name; a placeholder is no owner.

    Jackson County writes the redaction twice (``NOT AVAILABLE NOT AVAILABLE``), so a name made only of
    the redaction phrase is withheld too.
    """
    n = _squeeze(a.get("OWNERNME1"))
    if not n:
        return None, False
    up = n.upper()
    if up in _WITHHELD_OWNERS or not re.sub(r"\bNOT AVAILABLE\b", "", up).strip(" ,;"):
        return None, True
    if up in _PLACEHOLDER_OWNERS:
        return None, False
    return n, False


def apn_for(parcel_id: str) -> str:
    """Registry APN for a ``PARCELID``: lower case, every character that is not a letter or digit written
    ``x<hex>x`` and a literal ``x`` written ``xx``.

    The registry reduces an APN to letters and digits, and Wisconsin parcel ids differ by punctuation
    alone: in V12, 74 pairs of commercial parcels in Brown, Vilas, Kewaunee and Oneida counties
    (Brown ``11-109`` and ``1-1109``) would otherwise be one parcel. Ids made only of letters and digits
    without an ``x`` (every Milwaukee tax key) are unchanged. ``11-109`` is ``11x2dx109``.
    """
    out = []
    for ch in _squeeze(parcel_id).lower():
        if ch == "x":
            out.append("xx")
        elif ch.isascii() and ch.isalnum():
            out.append(ch)
        else:
            out.append(f"x{ord(ch):x}x")
    return "".join(out)


def pages(path: str | Path | Iterable[str | Path]) -> list[Path]:
    """The archived JSON page files: a file, a list of files, or a collector directory (searched
    recursively for the files the collector names ``query`` and for ``*.json``)."""
    if isinstance(path, (str, Path)):
        paths: list[Path] = [Path(path)]
    else:
        paths = [Path(p) for p in path]
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out += sorted(f for f in p.rglob("*")
                          if f.is_file() and (f.name == "query" or (f.suffix == ".json" and f.name != "discovered.json")))
        else:
            out.append(p)
    return out


def _features(page: Path) -> Iterator[dict]:
    with open(page, encoding="utf-8") as f:
        doc = json.load(f)
    for feat in doc.get("features", []):
        yield feat.get("attributes", feat)


def read_page(page: str | Path, *, categories: Iterable[str] | None = COMMERCIAL_CATEGORIES,
              seen: set[tuple[str, str]] | None = None) -> Iterator[ParcelRecord]:
    """Yield one ``ParcelRecord`` per in-scope feature of one archived page.

    ``categories`` limits by FactLot category (default: the registry's commercial scope; ``None``
    keeps every parcel). ``seen`` (county, parcel id) pairs de-duplicate across pages: the first
    row wins.
    """
    if categories is COMMERCIAL_CATEGORIES:
        keep = is_commercial
    elif categories is None:
        keep = lambda code: True  # noqa: E731
    else:
        wanted = frozenset(c.upper() for c in categories)
        keep = lambda code: (code or "") in wanted  # noqa: E731
    seen = seen if seen is not None else set()
    for a in _features(Path(page)):
        pid = _squeeze(a.get("PARCELID")) or _squeeze(a.get("TAXPARCELID"))
        county = county_fips(a)
        if not pid or not county or (county, pid) in seen:
            continue
        category = state_category(a.get("PROPCLASS"))
        if not keep(category):
            continue
        seen.add((county, pid))
        owner_name, withheld = _owner(a)
        acres = next((v for v in (_positive(a.get("DEEDACRES")), _positive(a.get("ASSDACRES")),
                                  _positive(a.get("GISACRES"))) if v), None)
        year = _squeeze(a.get("TAXROLLYEAR"))
        yield ParcelRecord(
            county_fips=county,
            apn=apn_for(pid),
            state_category=category,
            account=f"{county}:{pid}",  # PARCELIDs repeat across counties (344 in V12's commercial set)
            situs_address=_situs(a),
            owner_name=owner_name,
            owner_mailing_address=_squeeze(a.get("PSTLADRESS")) or None if owner_name else None,
            owner_confidential=withheld,
            land_area_sf=round(acres * _SQFT_PER_ACRE, 2) if acres else None,
            improvement_area_sf=None,  # the layer has no building area
            year_built=None,
            market_value=_positive(a.get("ESTFMKVALUE")),
            appraised_value=_positive(a.get("CNTASSDVALUE")),
            tax_year=int(year) if year.isdigit() else None,
            locator=f"{Path(page).parent.name}/{Path(page).name} STATEID {_squeeze(a.get('STATEID')) or pid}",
            local_use_code=_squeeze(a.get("PROPCLASS")) or None,
        )


def read_roll(path: str | Path | Iterable[str | Path], **kw) -> Iterator[ParcelRecord]:
    """Yield the in-scope parcels of every page under ``path``, each (county, parcel id) once."""
    seen: set[tuple[str, str]] = set()
    for page in pages(path):
        yield from read_page(page, seen=seen, **kw)


def build(snapshot_path: str | Path | Iterable[str | Path], db_path: str | Path, *, as_of: str,
          retrieved_at: str | None = None) -> IngestStats:
    """Ingest the archived pages into a registry file (created if missing).

    Each page is its own snapshot and its facts cite it. The pages are a filtered extract of the
    county (or counties) queried, not a full roll, so no parcel is retired.
    """
    total = IngestStats()
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        seen: set[tuple[str, str]] = set()
        for page in pages(snapshot_path):
            snap = reg.add_snapshot(SOURCE.source_id, page, as_of, retrieved_at)
            s = reg.ingest_parcels(read_page(page, seen=seen), snap, state_fips=STATE_FIPS,
                                   account_system=ACCOUNT_SYSTEM, full_roll=False)
            for f in ("seen", "kept", "skipped_out_of_scope", "skipped_invalid", "owners_person_or_withheld",
                      "facts_written", "retired"):
                setattr(total, f, getattr(total, f) + getattr(s, f))
            total.errors += s.errors
        return total
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.wi_statewide", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="+", help="the collector's collected/wi-statewide-parcels directory, or page files")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="V12 release date, YYYY-MM-DD (2026-06-30)")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    stats = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at)
    print(json.dumps(asdict(stats), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
