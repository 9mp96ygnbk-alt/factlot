"""What a registry file holds (counties, entity registries, crosswalk systems), and the ``coverage``
object a registry tool returns with a miss, so that "not loaded here" is never mistaken for "does
not exist".

The summary is a pure function of the file: ``Registry.refresh_coverage`` stores it in
``meta.coverage`` (with a stamp that detects later ingests), and a reader computes it once per
open file when it is absent or stale. The TypeScript reader (``packages/tools/src/registry.ts``)
computes the same JSON with the same queries and writes the same messages; the shared fixture test
enforces it.
"""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from .county_names import county_name
from .normalize import STATE_BY_FIPS, STATES, address_query

SCOPE = ("Commercial, industrial and multifamily parcels only (no single-family homes), each fact cited "
         "to its source file; owners of record are kept only for organisations, never natural persons.")
_LIST_CAP = 10


def state_postal(state_fips: str) -> str | None:
    st = STATE_BY_FIPS.get(state_fips)
    return st.upper() if st else None


def _state_label(state_fips: str) -> str:
    return state_postal(state_fips) or f"state {state_fips}"


def county_label(state_fips: str, county_fips: str, detail: str = "") -> str:
    """"Pinal County, AZ (04021)" from the Census names; "county 48999 (TX)" for a code they lack."""
    fips = state_fips + county_fips
    name = county_name(fips)
    if name:
        return f"{name}, {_state_label(state_fips)} ({fips}{detail})"
    return f"county {fips} ({_state_label(state_fips)}{detail})"


def stamp(db: sqlite3.Connection) -> dict[str, int]:
    """Cheap fingerprint of the file's contents: any ingest adds a snapshot or a subject."""
    return {"snapshots": db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0],
            "subjects_max_rowid": db.execute("SELECT COALESCE(MAX(rowid), 0) FROM subjects").fetchone()[0]}


def _sources(db: sqlite3.Connection, lo: str, hi: str, key_sql: str) -> dict[str, list[dict[str, str]]]:
    out: dict[str, list[dict[str, str]]] = {}
    for r in db.execute(
            f"SELECT {key_sql} AS k, c.source_id AS source_id, MAX(c.as_of) AS as_of FROM coverage c "
            "WHERE c.subject >= ? AND c.subject < ? GROUP BY k, c.source_id ORDER BY k, c.source_id", (lo, hi)):
        out.setdefault(r[0], []).append({"source_id": r[1], "as_of": r[2]})
    return out


def compute(db: sqlite3.Connection) -> dict[str, Any]:
    """The coverage summary of a registry file (see module docstring)."""
    buildings = {r[0]: r[1] for r in db.execute(
        "SELECT substr(urn, 13, 8) AS region, COUNT(*) FROM subjects WHERE kind = 'building' "
        "AND urn LIKE 'fl:building:us-%' GROUP BY region")}
    parcel_sources = _sources(db, "fl:parcel:", "fl:parcel;", "substr(c.subject, 11, 8)")
    counties = []
    for region, n in db.execute(
            "SELECT substr(urn, 11, 8) AS region, COUNT(*) FROM subjects WHERE kind = 'parcel' "
            "GROUP BY region ORDER BY region"):
        state_fips, county_fips = region[3:5], region[5:8]
        counties.append({"region": region, "state_fips": state_fips, "county_fips": county_fips,
                         "state": state_postal(state_fips), "parcels": n, "buildings": buildings.get(region, 0),
                         "sources": parcel_sources.get(region, [])})
    entity_sources = _sources(db, "fl:entity:", "fl:entity;",
                              "substr(c.subject, 11, instr(substr(c.subject, 11), ':') - 1)")
    registries = [{"jurisdiction": j, "entities": n, "sources": entity_sources.get(j, [])} for j, n in db.execute(
        "SELECT substr(urn, 11, instr(substr(urn, 11), ':') - 1) AS j, COUNT(*) FROM subjects "
        "WHERE kind = 'entity' GROUP BY j ORDER BY j")]
    systems = [{"system": s, "ids": n} for s, n in db.execute(
        "SELECT system, COUNT(*) FROM crosswalk GROUP BY system ORDER BY system")]
    states = sorted({c["state"] or f"state {c['state_fips']}" for c in counties})
    return {
        "counties": counties,
        "entity_registries": registries,
        "crosswalk_systems": systems,
        "totals": {"parcels": sum(c["parcels"] for c in counties), "entities": sum(r["entities"] for r in registries),
                   "buildings": sum(buildings.values()), "counties": len(counties), "states": states},
    }


def stored_or_compute(db: sqlite3.Connection) -> dict[str, Any]:
    """``meta.coverage`` when it is present and its stamp still matches the file, else ``compute``."""
    row = db.execute("SELECT value FROM meta WHERE key = 'coverage'").fetchone()
    if row:
        try:
            stored = json.loads(row[0])
        except ValueError:
            stored = None
        if isinstance(stored, dict) and stored.get("stamp") == stamp(db) and isinstance(stored.get("summary"), dict):
            return stored["summary"]
    return compute(db)


def key_versions(db: sqlite3.Connection) -> dict[str, str]:
    v = {r[0]: r[1] for r in db.execute(
        "SELECT key, value FROM meta WHERE key IN ('name_key_version', 'address_key_version')")}
    return {"name_key_version": v.get("name_key_version", "1"), "address_key_version": v.get("address_key_version", "1")}


def tool_result(db: sqlite3.Connection, summary: dict[str, Any], fields: bool = False) -> dict[str, Any]:
    """The ``registry_coverage`` tool result: the summary, each county with its Census name, and with ``fields`` its
    field availability (``fields.compact_fields``; None for a county the computation does not list)."""
    by_region = {}
    if fields:
        from .fields import compact_fields, field_availability

        by_region = {c["region"]: compact_fields(c) for c in field_availability(db)}
    counties = [{**c, "name": county_name(c["state_fips"] + c["county_fips"]),
                 **({"fields": by_region.get(c["region"])} if fields else {})} for c in summary["counties"]]
    return {**summary, "counties": counties, **key_versions(db), "scope": SCOPE}


# --- messages for misses --------------------------------------------------------------------------

def _counties_summary(cov: dict[str, Any]) -> str:
    counties = cov["counties"]
    if not counties:
        return "no parcels"
    if len(counties) <= _LIST_CAP:
        return "; ".join(county_label(c["state_fips"], c["county_fips"], f", {c['parcels']} parcels")
                         for c in counties)
    states = cov["totals"]["states"]
    return f"{len(counties)} counties in {len(states)} states ({', '.join(states)})"


def _registries_summary(cov: dict[str, Any]) -> str:
    regs = cov["entity_registries"]
    if not regs:
        return "no entity registries"
    if len(regs) <= _LIST_CAP:
        return ", ".join(f"{r['jurisdiction']} ({r['entities']} entities)" for r in regs)
    return f"{len(regs)} entity registries ({', '.join(r['jurisdiction'] for r in regs)})"


def _as_of(sources: list[dict[str, str]]) -> str:
    return max((s["as_of"] for s in sources), default="unknown")


def parcel_miss(cov: dict[str, Any], state_fips: str, county_fips: str) -> dict[str, Any]:
    """Coverage of the county a parcel query named."""
    region = f"us-{state_fips}{county_fips}"
    county = next((c for c in cov["counties"] if c["region"] == region), None)
    label = county_label(state_fips, county_fips)
    if county:
        message = (f"{label} is loaded in this registry ({county['parcels']} parcels, as of "
                   f"{_as_of(county['sources'])}), but this parcel is not in it: the registry holds commercial, "
                   "industrial and multifamily parcels only, so a residential or exempt parcel is not found")
    else:
        message = (f"{label} is not loaded in this registry; loaded: {_counties_summary(cov)}. "
                   "Call registry_coverage for what this registry holds")
    return {"region": region, "state": state_postal(state_fips), "county_loaded": county is not None,
            "state_loaded": any(c["state_fips"] == state_fips for c in cov["counties"]),
            "loaded_states": cov["totals"]["states"], "message": message}


def building_miss(cov: dict[str, Any], state_fips: str, county_fips: str) -> dict[str, Any]:
    out = parcel_miss(cov, state_fips, county_fips)
    county = next(c for c in cov["counties"] if c["region"] == out["region"]) if out["county_loaded"] else None
    if county and not cov["totals"]["buildings"]:
        out["message"] = ("no building is rolled up at this address: this registry file holds no building roll-up "
                          "(a file built before 2026-11-03 has none until `python -m factlot.registry.maintain <file> "
                          "--buildings` adds it)")
    elif county:
        out["message"] = (f"no building is rolled up at this address: {county_label(state_fips, county_fips)} "
                          f"is loaded in this registry ({county['parcels']} parcels, as of "
                          f"{_as_of(county['sources'])}), and the registry records a building only where two or more "
                          "of its parcels share a street address and ZIP code; search the address with "
                          "registry_search_address to find a single parcel")
    else:
        out["message"] = "no building is rolled up at this address: " + out["message"]
    return out


def entity_miss(cov: dict[str, Any], jurisdiction: str, known: bool) -> dict[str, Any]:
    reg = next((r for r in cov["entity_registries"] if r["jurisdiction"] == jurisdiction), None)
    if known:
        message = "this entity is in the registry, but no current owner of record is linked to it"
    elif reg:
        message = (f"no entity with this number in entity registry {jurisdiction} ({reg['entities']} entities, "
                   f"as of {_as_of(reg['sources'])})")
    else:
        message = (f"entity registry {jurisdiction} is not loaded in this registry; loaded: "
                   f"{_registries_summary(cov)}. Call registry_coverage for what this registry holds")
    return {"jurisdiction": jurisdiction, "loaded": reg is not None, "entity_known": known,
            "loaded_jurisdictions": [r["jurisdiction"] for r in cov["entity_registries"]], "message": message}


_QUERY_STATE = re.compile(r"(?:,\s*([A-Z]{2})(?:\s+[0-9]{5}(?:-[0-9]{4})?)?|\b([A-Z]{2})\s+[0-9]{5}(?:-[0-9]{4})?)\s*$")


def query_state(query: str) -> str | None:
    """The state a search query names at its end (", TX" or "TX 77002"), or None."""
    m = _QUERY_STATE.search(query.upper().strip())
    st = (m.group(1) or m.group(2)) if m else None
    return st if st and st.lower() in STATES else None


def address_miss(cov: dict[str, Any], query: str) -> dict[str, Any]:
    st = query_state(query)
    states = cov["totals"]["states"]
    loaded = st in states if st else None
    if st and not loaded:
        message = f"no parcel matched: {st} is not loaded in this registry; loaded: {_counties_summary(cov)}"
    elif address_query(query)["mode"] is None:
        message = ("no parcel matched: address search matches whole words of the street address, so give a house "
                   'number ("1200 Main St") or a street name with its type ("Main St"); a city, state or part '
                   f"of a word alone matches nothing. Loaded: {_counties_summary(cov)}")
    else:
        message = (f"no parcel matched in this registry (loaded: {_counties_summary(cov)}); it holds commercial, "
                   "industrial and multifamily parcels only, searched by situs address: try the house number "
                   "and street name alone")
    return {"state": st, "state_loaded": loaded, "loaded_states": states, "message": message}


def entities_miss(cov: dict[str, Any]) -> dict[str, Any]:
    return {"loaded_jurisdictions": [r["jurisdiction"] for r in cov["entity_registries"]],
            "message": (f"no registered entity matched; entity registries loaded: {_registries_summary(cov)}. "
                        "Natural persons are never searchable")}


def external_miss(cov: dict[str, Any], system: str, external_id: str) -> dict[str, Any]:
    found = next((s for s in cov["crosswalk_systems"] if s["system"] == system), None)
    if found:
        message = f'no ID "{external_id}" in crosswalk system {system} ({found["ids"]} IDs loaded)'
    else:
        names = ", ".join(f"{s['system']} ({s['ids']} IDs)" for s in cov["crosswalk_systems"]) or "none"
        message = f'crosswalk system "{system}" is not in this registry; systems: {names}'
    return {"system": system, "system_loaded": found is not None, "message": message}


def other_kind_miss(kind: str) -> dict[str, Any]:
    return {"message": f"the registry holds parcels, entities and buildings; it has no {kind} records"}
