"""lease_comp_search: search the GSA lease comps bundled with FactLot, offline.

The 6,994 comps of the release lease-comps-gsa-2026-11-04 (U.S. General Services Administration, Lease Inventory,
October 2026 file) ship as ``factlot/data/gsa_lease_comps.tsv``, one row per comp, written by
scripts/gen-gsa-lease-comps.py from the GSA file and checked against the release. The file is read and parsed on
the first search. Every answer carries the citation (GSA file, its SHA-256 document ID, retrieval date, licence,
the row of each comp) and the caveat that the federal government is the tenant: these are not market comps for
private tenants. This is the same code as packages/tools/src/comps_search.ts; spec/vectors/lease_comp_search.json
pins both.
"""

from __future__ import annotations

import hashlib
import math
import re
from functools import cmp_to_key, lru_cache
from importlib import resources
from typing import Any

from ._core import round_
from .docverify import DocInputError
from .facts import _JS_WS, _JS_WS_CHARS
from .ids import FactLotIdError, _base32, building_id

EARTH_RADIUS_MILES = 3958.8
SORTS = ("commencement_desc", "commencement_asc", "expiration_asc", "expiration_desc", "rent_psf_desc",
         "rent_psf_asc", "rentable_sf_desc", "rentable_sf_asc", "distance_asc")
SUMMARY_LABEL = ("Statistics of the GSA leases that match the filters (the federal government is the tenant): current "
                 "rent per rentable SF per year from GSA's file, not starting rents and not market rents.")
_INT_COLUMNS = ("row", "term_months", "renewal_options_left")
_NUM_COLUMNS = ("latitude", "longitude", "rentable_sf", "annual_rent_usd", "rent_psf_yr")


def _num(text: str) -> float | int:
    f = float(text)
    return int(f) if f.is_integer() else f


@lru_cache(maxsize=1)
def _data() -> tuple[dict[str, str], tuple[dict[str, Any], ...]]:
    """(metadata, rows) of the bundled file, parsed once."""
    text = resources.files("factlot").joinpath("data/gsa_lease_comps.tsv").read_text("utf-8")
    meta: dict[str, str] = {}
    columns: list[str] | None = None
    rows: list[dict[str, Any]] = []
    for line in text.split("\n"):
        if not line:
            continue
        if line.startswith("# "):
            if ": " in line:
                key, value = line[2:].split(": ", 1)
                meta[key] = value
            continue
        cells = line.split("\t")
        if columns is None:
            columns = cells
            continue
        row: dict[str, Any] = {}
        for key, cell in zip(columns, cells):
            if cell == "":
                row[key] = None
            elif key in _INT_COLUMNS:
                row[key] = int(cell)
            elif key in _NUM_COLUMNS:
                row[key] = _num(cell)
            else:
                row[key] = cell
        rows.append(row)
    return meta, tuple(rows)


def lease_urn(lease_number: str) -> str:
    """The release's lease ID: ten zeros, then 16 base-32 characters of SHA-256(``gsa-lease-number:<number>``)."""
    return f"fl:lease:{'0' * 10}{_base32(hashlib.sha256(f'gsa-lease-number:{lease_number}'.encode()).digest(), 16)}"


def citation() -> dict[str, Any]:
    meta = _data()[0]
    return {
        "source": meta["source"],
        "landing_page": meta["landing_page"],
        "file_url": meta["file_url"],
        "document_id": meta["document_id"],
        "as_of": meta["as_of"],
        "retrieved_at": meta["retrieved_at"],
        "license": meta["license"],
        "terms": meta["terms"],
        "attribution": meta["attribution"],
        "release": meta["release"],
        "release_file": meta["release_file"],
        "release_sha256": meta["release_sha256"],
        "rights": {"ai_use": "permitted", "redistribution": "permitted"},
    }


def _distance_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine, mean Earth radius 3,958.8 miles), rounded to 0.01 mile."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return round_(2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a))), 2)


def _percentile(sorted_values: list[float], p: float) -> float:
    """Linear interpolation between closest ranks (the spreadsheet PERCENTILE.INC rule)."""
    pos = (len(sorted_values) - 1) * p
    lo = math.floor(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def _stats(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    s = sorted(values)
    return {"min": s[0], "p25": round_(_percentile(s, 0.25), 2), "median": round_(_percentile(s, 0.5), 2),
            "p75": round_(_percentile(s, 0.75), 2), "max": s[-1]}


def _building(row: dict[str, Any]) -> str | None:
    fips, zip5 = row["county_fips"], row["zip"]
    if fips is None or zip5 is None:
        return None
    try:
        return building_id(fips[:2], fips[2:], zip5, row["street"]).urn
    except FactLotIdError:
        return None


def _result(row: dict[str, Any], distance: float | None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "comp_id": lease_urn(row["lease"]),
        "gsa_lease_number": row["lease"],
        "address": row["street"],
        "city": row["city"],
        "state": row["state"],
        "zip": row["zip"],
        "county_fips": row["county_fips"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "building": _building(row),
        "landlord": row["landlord"],
        "tenant_type": "government_federal",
        "rentable_sf": row["rentable_sf"],
        "commencement_date": row["commencement_date"],
        "expiration_date": row["expiration_date"],
        "term_months": row["term_months"],
        "early_termination_date": row["early_termination_date"],
        "annual_rent_usd": row["annual_rent_usd"],
        "rent_psf_yr": row["rent_psf_yr"],
        "property_type": row["property_type"],
        "expense_basis": row["expense_basis"],
        "comp_type": row["comp_type"],
        "renewal_options_left": row["renewal_options_left"],
    }
    if distance is not None:
        out["distance_miles"] = distance
    out["source"] = {"document_id": _data()[0]["document_id"],
                     "section": f"row {row['row']} lease {row['lease']} location {row['location']}"}
    return out


def _cmp(a: Any, b: Any) -> int:
    return (a > b) - (a < b)


def _comparator(sort: str):
    key = {"commencement": "commencement_date", "expiration": "expiration_date", "rent_psf": "rent_psf_yr",
           "rentable_sf": "rentable_sf", "distance": "distance"}[sort.rsplit("_", 1)[0]]
    sign = -1 if sort.endswith("_desc") else 1

    def compare(x: tuple[dict[str, Any], float | None], y: tuple[dict[str, Any], float | None]) -> int:
        vx = x[1] if key == "distance" else x[0][key]
        vy = y[1] if key == "distance" else y[0][key]
        return sign * _cmp(vx, vy) or _cmp(x[0]["lease"], y[0]["lease"])

    return cmp_to_key(compare)


def search(args: dict[str, Any], producer: dict[str, str]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    for lo, hi in (("min_rentable_sf", "max_rentable_sf"), ("min_rent_psf_yr", "max_rent_psf_yr")):
        if lo in args and hi in args and args[lo] > args[hi]:
            issues.append({"path": hi, "message": f"is below {lo}"})
    if "commencement_from" in args and "commencement_to" in args and args["commencement_from"] > args["commencement_to"]:
        issues.append({"path": "commencement_to", "message": "is before commencement_from"})
    near = args.get("near")
    sort = args.get("sort", "distance_asc" if near is not None else "commencement_desc")
    if sort == "distance_asc" and near is None:
        issues.append({"path": "sort", "message": "distance_asc needs near (latitude, longitude, radius_miles)"})
    if issues:
        raise DocInputError(issues)
    limit = args.get("limit", 25)
    state = args["state"].upper() if "state" in args else None
    city = re.sub(f"[{_JS_WS}]+", " ", args["city"]).strip(_JS_WS_CHARS).upper() if "city" in args else None
    zip5 = args["zip"][:5] if "zip" in args else None

    rows = _data()[1]
    matched: list[tuple[dict[str, Any], float | None]] = []
    no_coordinates = 0
    for row in rows:
        if state is not None and row["state"] != state:
            continue
        if "county_fips" in args and row["county_fips"] != args["county_fips"]:
            continue
        if city is not None and row["city"].upper() != city:
            continue
        if zip5 is not None and row["zip"] != zip5:
            continue
        if "property_type" in args and row["property_type"] != args["property_type"]:
            continue
        if "expense_basis" in args and row["expense_basis"] != args["expense_basis"]:
            continue
        if "min_rentable_sf" in args and row["rentable_sf"] < args["min_rentable_sf"]:
            continue
        if "max_rentable_sf" in args and row["rentable_sf"] > args["max_rentable_sf"]:
            continue
        if "min_rent_psf_yr" in args and row["rent_psf_yr"] < args["min_rent_psf_yr"]:
            continue
        if "max_rent_psf_yr" in args and row["rent_psf_yr"] > args["max_rent_psf_yr"]:
            continue
        if "commencement_from" in args and row["commencement_date"] < args["commencement_from"]:
            continue
        if "commencement_to" in args and row["commencement_date"] > args["commencement_to"]:
            continue
        distance = None
        if near is not None:
            if row["latitude"] is None or row["longitude"] is None:
                no_coordinates += 1
                continue
            distance = _distance_miles(near["latitude"], near["longitude"], row["latitude"], row["longitude"])
            if distance > near["radius_miles"]:
                continue
        matched.append((row, distance))
    matched.sort(key=_comparator(sort))

    warnings: list[str] = []
    if near is not None and no_coordinates:
        warnings.append(f"{no_coordinates} comps that pass the other filters have no coordinates in GSA's file and "
                        "were left out of the radius search")
    if not matched:
        warnings.append("no GSA lease matches these filters; the file covers federal leases only, so an empty result "
                        "says nothing about the private market")
    types: dict[str, int] = {}
    for row, _ in matched:
        t = row["property_type"] or "unstated"
        types[t] = types.get(t, 0) + 1
    meta = _data()[0]
    cite = citation()
    return {
        "dataset": f"GSA lease comps, release {meta['release']} ({meta['rows']} comps)",
        "caveat": meta["caveat"],
        "total_matches": len(matched),
        "returned": min(limit, len(matched)),
        "sort": sort,
        "results": [_result(row, distance) for row, distance in matched[:limit]],
        "summary": {
            "label": SUMMARY_LABEL,
            "count": len(matched),
            "rent_psf_yr": _stats([row["rent_psf_yr"] for row, _ in matched]),
            "rentable_sf": _stats([row["rentable_sf"] for row, _ in matched]),
            "property_types": {k: types[k] for k in sorted(types)},
        },
        "warnings": warnings,
        "citation": cite,
        "provenance": {
            "method": "public_record",
            "producer": producer,
            "sources": [{"document_id": cite["document_id"], "uri": cite["file_url"], "title": cite["source"]}],
        },
    }
