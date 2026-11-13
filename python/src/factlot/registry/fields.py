"""Field availability and value-history labels (``packages/tools/src/fields.ts`` in TypeScript; the shared fixture and
``fields.test.ts`` keep the two equal).

``field_availability`` says, per county of a registry file, which fact groups it holds and for what share of its
parcels, and which roll years with the value types and files of each. ``label_value_history`` adds to value-history
entries what their files show: value types, the file (name URL-decoded for display), the roll, and notes.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
from typing import Any, Callable
from urllib.parse import unquote

FIELD_GROUPS: dict[str, tuple[str, ...]] = {
    "owner_of_record": ("ownership.owner_of_record",),
    "owner_mailing_address": ("ownership.owner_mailing_address",),
    "market_value": ("parcel.market_value",),
    "appraised_value": ("parcel.appraised_value",),
    "building_facts": ("parcel.improvement_area_sf", "parcel.year_built", "parcel.num_floors", "parcel.num_buildings",
                       "parcel.units_total", "parcel.units_residential", "parcel.year_altered", "parcel.area_by_use_sf",
                       "parcel.built_far"),
    "neighborhood_and_class": ("parcel.neighborhood_code", "parcel.building_class"),
    "zoning": ("zoning.",),
    "recorded_sales": ("transaction.sale",),
    "deeds_and_mortgages": ("transaction.deed", "debt.mortgage_recorded", "debt.mortgage_satisfaction_recorded"),
    "energy_benchmarks": ("energy.",),
}
FACT_GROUPS: tuple[str, ...] = (*FIELD_GROUPS, "entity_links")


def _share(n: int, of: int) -> int | float:
    if not of:
        return 0
    v = math.floor(n / of * 1000 + 0.5) / 1000  # JavaScript's Math.round
    return int(v) if v.is_integer() else v


def _as_of_year(as_of: str) -> int | None:
    return int(as_of[:4]) if re.match(r"\d{4}-\d{2}-\d{2}", as_of or "") else None


def roll_of(source_id: str, filename: str | None, tax_year: Any, as_of: str) -> str | None:
    """What a file says about its roll (``rollOf`` in TypeScript); None when the as-of date is not a date."""
    y = _as_of_year(as_of)
    if y is None:
        return None
    name = filename or ""
    if re.search(r"prelim", name, re.I) or (source_id.startswith("tx-") and tax_year is not None and tax_year > y):
        return "preliminary"
    if re.search(r"pre-?cert|un-?cert|non-?cert|estimate", name, re.I):
        return None
    if re.search(r"(?:^|[^a-z])certif|certf", name, re.I):
        return "certified"
    return None


def display_filename(name: str | None) -> str | None:
    """A file name as it is shown: URL-decoded when it holds only valid escapes, else as stored."""
    if name is None or "%" not in name or re.search(r"%(?![0-9A-Fa-f]{2})", name):
        return name
    try:
        return unquote(name, errors="strict")
    except UnicodeDecodeError:
        return name


def _year_text(v: Any) -> str:
    return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)


def label_value_history(entries: list[dict[str, Any]], file_of: Callable[[str], dict[str, Any] | None]) -> list[dict[str, Any]]:
    """Value-history entries with their labels (``labelValueHistory`` in TypeScript). ``file_of(document_id)`` gives
    {source_id, filename, as_of, read_on} or None."""
    out: list[dict[str, Any]] = []
    for e in entries:
        cites = e.get("citations") or {}
        cite = cites.get("market_value") or cites.get("appraised_value")
        f = file_of(cite["document_id"]) if cite else None
        ty = e["tax_year"] if isinstance(e.get("tax_year"), (int, float)) and not isinstance(e.get("tax_year"), bool) else None
        types = (["market"] if e.get("market_value") is not None else []) + (["appraised"] if e.get("appraised_value") is not None else [])
        notes: list[str] = []
        if f:
            y = _as_of_year(f["as_of"])
            if y is not None and f["as_of"] == f["read_on"]:
                notes.append(f"{f['as_of']}, this file's as-of date, is the day the registry read it.")
            if y is not None and ty is not None and y > ty + 1:
                t = _year_text(ty)
                notes.append(f"This {t} value comes from a file dated {f['as_of']}, after the {t} roll year: it is the roll as "
                             "the publisher held it on that date, which can differ from the roll as certified.")
        out.append({**e, "value_types": types,
                    "file": ({"source_id": f["source_id"], "filename": display_filename(f["filename"]), "as_of": f["as_of"],
                              "read_on": f["read_on"]} if f else None),
                    "roll": roll_of(f["source_id"], f["filename"], ty, f["as_of"]) if f else None,
                    "notes": notes})
    for i, e in enumerate(out):
        ty = e["tax_year"]
        if not isinstance(ty, (int, float)) or isinstance(ty, bool):
            continue
        newer = next((x for x in reversed(out[:i])
                      if isinstance(x["tax_year"], (int, float)) and x["tax_year"] != ty), None)
        if newer is not None and newer["tax_year"] > ty + 1:
            a, b = int(ty) + 1, int(newer["tax_year"]) - 1
            span = str(a) if a == b else f"{a} to {b}"
            e["notes"].append(f"The registry holds no value of this parcel for {span}, between this {_year_text(ty)} entry "
                              f"and the {_year_text(newer['tax_year'])} entry.")
    return out


def _group_case() -> str:
    arms = []
    for g, preds in FIELD_GROUPS.items():
        exact = [p for p in preds if not p.endswith(".")]
        conds = ([f"predicate IN ({', '.join(repr(p) for p in exact)})"] if exact else []) + [
            f"(predicate >= '{p}' AND predicate < '{p[:-1]}/')" for p in preds if p.endswith(".")]
        arms.append(f"WHEN {' OR '.join(conds)} THEN '{g}'")
    return f"CASE {' '.join(arms)} END"


def _year(v: Any) -> int | None:
    y = json.loads(v)
    if isinstance(y, bool) or not isinstance(y, (int, float)) or not float(y).is_integer():
        return None
    return int(y)


def field_availability(db: sqlite3.Connection) -> list[dict[str, Any]]:
    """Per county of the file (region order): parcels, each group's parcels and share, and roll years
    (``fieldAvailability`` in TypeScript)."""
    parcels = {r[0]: r[1] for r in db.execute(
        "SELECT substr(urn, 11, 8) AS region, COUNT(*) AS n FROM subjects WHERE kind = 'parcel' GROUP BY region ORDER BY region")}
    counts: dict[str, dict[str, int]] = {}
    for region, g, n in db.execute(
            f"SELECT region, g, COUNT(*) AS n FROM (SELECT DISTINCT substr(subject, 11, 8) AS region, subject, {_group_case()} AS g "
            "FROM facts WHERE subject >= 'fl:parcel:' AND subject < 'fl:parcel;') WHERE g IS NOT NULL GROUP BY region, g"):
        counts.setdefault(region, {})[g] = n
    for region, n in db.execute(
            "SELECT substr(to_urn, 11, 8) AS region, COUNT(DISTINCT to_urn) AS n FROM relationships "
            "WHERE type = 'owns' AND to_urn >= 'fl:parcel:' AND to_urn < 'fl:parcel;' GROUP BY region"):
        counts.setdefault(region, {})["entity_links"] = n
    snaps = {r[0]: r for r in db.execute("SELECT document_id, source_id, filename, as_of, retrieved_at FROM snapshots")}
    docs: dict[str, dict[str, dict[int | None, dict[str, int]]]] = {}
    valued: dict[str, dict[int, int]] = {}

    def has(predicate: str) -> str:
        return (f"EXISTS (SELECT 1 FROM facts m WHERE m.subject = t.subject AND m.predicate = '{predicate}' "
                "AND m.document_id = t.document_id)")
    for region, doc, v, n, mk, ap in db.execute(
            "WITH ty AS (SELECT substr(subject, 11, 8) AS region, subject, document_id, value_json AS v, "
            f"{has('parcel.market_value')} AS mk, {has('parcel.appraised_value')} AS ap FROM facts t "
            "WHERE subject >= 'fl:parcel:' AND subject < 'fl:parcel;' AND predicate = 'parcel.tax_year') "
            "SELECT region, document_id, v, SUM(mk OR ap) AS n, SUM(mk) AS mk, SUM(ap) AS ap FROM ty GROUP BY region, document_id, v "
            "UNION ALL SELECT region, NULL, v, COUNT(DISTINCT subject), 0, 0 FROM ty WHERE mk OR ap GROUP BY region, v"):
        y = _year(v)
        if y is None:
            continue
        if doc is None:
            valued.setdefault(region, {})[y] = n
            continue
        if not n:
            continue
        c = docs.setdefault(region, {}).setdefault(doc, {}).setdefault(y, {"parcels": 0, "market": 0, "appraised": 0})
        c["parcels"] += n
        c["market"] += mk
        c["appraised"] += ap
    for region, doc, n, mk, ap in db.execute(
            "SELECT substr(subject, 11, 8) AS region, document_id, COUNT(DISTINCT subject) AS n, "
            "COUNT(DISTINCT CASE WHEN predicate = 'parcel.market_value' THEN subject END) AS mk, "
            "COUNT(DISTINCT CASE WHEN predicate = 'parcel.appraised_value' THEN subject END) AS ap FROM facts "
            "WHERE subject >= 'fl:parcel:' AND subject < 'fl:parcel;' AND predicate IN ('parcel.market_value', 'parcel.appraised_value') "
            "GROUP BY region, document_id"):
        if doc in docs.get(region, {}):
            continue
        docs.setdefault(region, {}).setdefault(doc, {})[None] = {"parcels": n, "market": mk, "appraised": ap}

    out = []
    for region, n in parcels.items():
        m = counts.get(region, {})
        groups = {g: {"parcels": m.get(g, 0), "share": _share(m.get(g, 0), n)} for g in FACT_GROUPS}
        years: dict[int | None, list[dict[str, Any]]] = {}
        for doc, by_year in docs.get(region, {}).items():
            s = snaps.get(doc)
            for y, c in by_year.items():
                as_of = str(s[3]) if s else ""
                read_on = str(s[4])[:10] if s else ""
                filename = s[2] if s else None
                source_id = str(s[1]) if s else ""
                f = {"source_id": source_id, "filename": filename, "as_of": as_of, "read_on": read_on,
                     "dated": "read" if as_of and as_of == read_on else "file", "roll": roll_of(source_id, filename, y, as_of),
                     "parcels": c["parcels"], "market_value": c["market"], "appraised_value": c["appraised"]}
                lst = years.setdefault(y, [])
                same = next((x for x in lst if (x["source_id"], x["filename"], x["as_of"], x["read_on"])
                             == (source_id, filename, as_of, read_on)), None)
                if same:
                    for k in ("parcels", "market_value", "appraised_value"):
                        same[k] += f[k]
                else:
                    lst.append(f)
        roll_years = []
        for y in sorted(years, key=lambda k: (k is None, -(k or 0))):
            files = sorted(years[y], key=lambda f: f["source_id"])
            files = sorted(files, key=lambda f: f["as_of"], reverse=True)
            types = (["market"] if any(f["market_value"] for f in files) else []) + (
                ["appraised"] if any(f["appraised_value"] for f in files) else [])
            roll_years.append({"tax_year": y,
                               "parcels": max((f["parcels"] for f in files), default=0) if y is None else valued.get(region, {}).get(y, 0),
                               "value_types": types, "preliminary": all(f["roll"] == "preliminary" for f in files),
                               "files": files})
        out.append({"region": region, "parcels": n, "groups": groups, "roll_years": roll_years})
    return out


def compact_fields(c: dict[str, Any]) -> dict[str, Any]:
    """What registry_coverage carries per county with fields: true (``compactFields`` in TypeScript)."""
    return {"shares": {g: c["groups"][g]["share"] for g in FACT_GROUPS if c["groups"][g]["share"] > 0},
            "roll_years": [{"tax_year": y["tax_year"], "value_types": y["value_types"],
                            "as_of": y["files"][0]["as_of"] if y["files"] else None,
                            **({"preliminary": True} if y["preliminary"] else {})} for y in c["roll_years"]]}
