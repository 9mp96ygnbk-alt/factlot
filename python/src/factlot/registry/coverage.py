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
from .address_places import label_any_counties, place_counties, place_states, zip_counties, zip_prefix_states
from .normalize import (ADDRESS_ONE_WORD_CANDIDATES, STATE_BY_FIPS, STATE_NAMES, STATES, address_place_rank,
                        address_place_with, address_query, address_query_with_place)

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


def _state_counties_summary(cov: dict[str, Any], st: str) -> str:
    """The counties of one state, as ``_counties_summary`` words them (``stateCountiesSummary`` in TS)."""
    counties = [c for c in cov["counties"] if c["state"] == st]
    if len(counties) <= _LIST_CAP:
        return "; ".join(county_label(c["state_fips"], c["county_fips"], f", {c['parcels']} parcels")
                         for c in counties)
    return f"{len(counties)} counties ({sum(c['parcels'] for c in counties)} parcels)"


# What registry_search_address's misses say about the registry's scope (ADDRESS_SCOPE_NOTE in TS).
ADDRESS_SCOPE_NOTE = ("the registry holds commercial, industrial and multifamily parcels only, so a house, or a condominium unit "
                      "owned by a person, is not in it")


def address_place_city(place: dict[str, Any]) -> str | None:
    """The city a place names, as the county tables read it (``addressPlaceCity`` in TS): None for a state code, and
    for a state's name when the place names no state; "New York, NY" and "Washington, DC" keep their city."""
    c = place["city"]
    if c is None or c in STATES:
        return None
    return None if place["state"] is None and c in STATE_NAMES else c


def address_place_counties(place: dict[str, Any] | None) -> dict[str, Any] | None:
    """The counties the place a query names lies in (``addressPlaceCounties`` in TS): ``{"name", "state",
    "counties"}`` from its ZIP code when the tables know it, else from its city (``address_place_city``), in the state
    it names, or when it names none in the only state with a place of that name; None when the tables cannot tell."""
    if not place:
        return None
    city = address_place_city(place)
    if place["zip"] is not None:
        every = zip_counties(place["zip"])
        st = place["state"]
        if st is None and every and len({c[:2] for c in every}) == 1:
            st = state_postal(every[0][:2])
        counties = place_counties(st, place["zip"]) if st else None
        if st and counties:
            return {"name": f"ZIP code {place['zip']}", "state": st, "counties": counties}
    if city is not None:
        states = [place["state"]] if place["state"] else place_states(city)
        counties = place_counties(states[0], city) if len(states) == 1 else None
        if counties:
            return {"name": city, "state": states[0], "counties": counties}
    return None


def _county_list(counties: list[str]) -> str:
    labels = [county_label(c[:2], c[2:]) for c in counties]
    return labels[0] if len(labels) < 2 else f"{', '.join(labels[:-1])} and {labels[-1]}"


def _held_county_names(cov: dict[str, Any], st: str) -> str:
    names = [county_name(c["state_fips"] + c["county_fips"]) or f"county {c['state_fips']}{c['county_fips']}"
             for c in cov["counties"] if c["state"] == st]
    return ", ".join(names) if names else "none"


def address_place_differs(place: dict[str, Any], results: list[dict[str, Any]]) -> list[bool]:
    """Which results lie outside the counties of the place the query names (``addressPlaceDiffers`` in TS): never one
    whose own label has the query's ZIP code or city (``address_place_rank`` 0 or 1); otherwise one whose county is
    in none of the counties the tables know, in its state, for the query's ZIP code or city (a ZIP code the Census
    tables place only in other states, by its ZCTA or else its first three digits' ZCTAs, is known there, with no
    county); one where they know neither does not."""
    city = address_place_city(place)
    asked = {**place, "city": city}
    keys = [k for k in (place["zip"], city) if k is not None]
    out = []
    for r in results:
        urn = str(r["urn"])
        m = re.match(r"fl:[a-z]+:us-([0-9]{5}):", urn)
        if not m or not keys or address_place_rank(asked, urn, r.get("label")) in (0, 1):
            out.append(False)
            continue
        fips = m.group(1)
        st = state_postal(fips[:2])
        known = differs = False
        for k in keys:
            counties = place_counties(st, k) if st else None
            # A ZIP code that lies only in other states (none of its counties in this one), or that is no ZCTA and
            # whose first three digits' ZCTAs all lie in other states.
            if not counties and k == place["zip"] and st:
                every = zip_counties(k)
                states = [state_postal(c[:2]) for c in every] if every else zip_prefix_states(k)
                if states and st not in states:
                    known = True
            if not counties:
                continue
            if fips in counties:
                break
            known = True
        else:
            differs = known
        out.append(differs)
    return out


def address_found(query: str, where: dict[str, str] | None, results: list[dict[str, Any]]) -> dict[str, Any]:
    """The answer of a search that found parcels (``addressFound`` in TS): a result outside the counties of the place
    the query names carries ``place_differs: true``, and when every one does and the tables know the place's
    counties, ``note`` says the matches are outside them, with ``place_counties``."""
    where = where or {}
    asked = address_query_with_place(query)
    place = address_place_with(asked, where) if "," in asked or any(v is not None for v in where.values()) else None
    if not place or (place["zip"] is None and address_place_city(place) is None):
        return {"results": results}
    differs = address_place_differs(place, results)
    if not any(differs):
        return {"results": results}
    out: dict[str, Any] = {"results": [{**r, "place_differs": True} if d else r for r, d in zip(results, differs)]}
    pc = address_place_counties(place) if all(differs) else None
    if pc:
        out["note"] = (f"these matches are outside the counties {pc['name']}, {pc['state']} lies in "
                       f"({_county_list(pc['counties'])})")
        out["place_counties"] = pc["counties"]
    return out


def address_miss(cov: dict[str, Any], query: str, where: dict[str, str] | None = None,
                 hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """Why an address search found nothing (``addressMiss`` in TS). A query with a comma is read by ``address_place``
    (the state it names after a city) with the call's place parameters; one without, by those and ``query_state``.
    ``hint`` is what the search found on the query's street (``address_street_hint_from``)."""
    where = where or {}
    query = address_query_with_place(query)
    comma = "," in query
    named = any(v is not None for v in where.values())
    place = address_place_with(query, where) if comma or named else None
    st = place["state"] if place and place["state"] is not None else (
        None if comma or "state" in where else query_state(query))
    states = cov["totals"]["states"]
    loaded = st in states if st else None
    q = address_query(query)
    one_word = q["mode"] == "street" and len(q["tokens"]) == 1
    # The state the search was kept to (a state the query names without a city is reported, not searched by).
    kept = place["state"] if place else None
    holds = f"Of {kept} this registry holds {_state_counties_summary(cov, kept)}" if kept else (
        f"Loaded: {_counties_summary(cov)}")
    at = f" in {kept}" if kept else ""
    out: dict[str, Any] = {"state": st, "state_loaded": loaded, "loaded_states": states}
    county = place.get("county") if place else None
    held = {c["state_fips"] + c["county_fips"] for c in cov["counties"]}
    # A search kept to a county (county_fips) is judged by that county alone: the place's counties are not read.
    pc = address_place_counties(place) if county is None else None
    unheld = [c for c in pc["counties"] if c not in held] if pc else []
    # The place lies only in counties the registry does not hold: no county it holds is one the tables give the
    # place, nor holds a parcel whose label names it, however few (a label is never denied).
    labelled_held = [c for c in label_any_counties(
        pc["state"], place["zip"] if pc["name"].startswith("ZIP code ") else pc["name"]) or [] if c in held] if pc else []
    outside = (pc is not None and pc["state"] in states and len(unheld) == len(pc["counties"])
               and not labelled_held)
    if pc and pc["state"] in states:
        out["place_counties"] = pc["counties"]
    if st and not loaded:
        reason = "state_not_loaded"
        message = f"no parcel matched: {st} is not loaded in this registry; loaded: {_counties_summary(cov)}"
    elif q["mode"] is None:
        reason = "no_street"
        message = ("no parcel matched: address search matches whole words of the street address, so give a house "
                   'number ("1200 Main St") or a street name with its type ("Main St"); a city, state or part '
                   f"of a word alone matches nothing. Loaded: {_counties_summary(cov)}")
    elif county is not None and not any(c["state_fips"] + c["county_fips"] == county for c in cov["counties"]):
        reason = "county_not_loaded"
        out["county_loaded"] = False
        message = f"no parcel matched{at}: {county_label(county[:2], county[2:])} is not loaded in this registry. {holds}"
    elif outside:
        # The place lies wholly in counties the registry does not hold. The search still ran over every county held
        # in the state (a city or ZIP code never filters): a miss inside loaded coverage, no county_loaded: False.
        reason = "county_not_loaded"
        none = "none of which this registry holds" if len(pc["counties"]) > 1 else "which this registry does not hold"
        message = (f"no parcel matched{at}: {pc['name']}, {pc['state']} lies in {_county_list(pc['counties'])}, "
                   f"{none}. Of {pc['state']} this registry holds: {_held_county_names(cov, pc['state'])}")
    else:
        parts: list[str] = []
        if one_word:
            reason = "street_type_alone"
            parts.append(f"a street type alone is matched among its first {ADDRESS_ONE_WORD_CANDIDATES} addresses "
                         'only, so give the street name with it ("Main St")')
        elif hint and hint["held"] is False:
            reason = "street_not_found"
            out["street"] = hint["street"]
            parts.append(f"no address on {hint['street']}{at} is in this registry")
        elif hint and hint["held"] and hint["number_held"]:
            reason = "other_words"
            out["street"] = hint["street"]
            parts.append(f"{hint['number']} {hint['street']}{at} is in this registry, but not with every other word of "
                         "the query; search the house number and street alone")
        elif hint and hint["held"] and hint["nearest"]:
            reason = "house_number_not_found"
            out["street"] = hint["street"]
            out["nearest_house_numbers"] = hint["nearest"]
            # The nearest numbers come from the whole state when no label on the street names the ZIP code or city.
            away = ""
            if hint["rank"] == 2 and place is not None and (place["zip"] is not None or place["city"] is not None):
                away = ", and none of its labels names " + (f"ZIP code {place['zip']}" if place["zip"] is not None
                                                             else place["city"])
            parts.append(f"{hint['street']}{at} is in this registry, but not number {hint['number']}; the nearest "
                         f"numbers on it are {' and '.join(str(n) for n in hint['nearest'])}{away}")
        else:
            reason = "no_match"
        # A place partly in counties the registry does not hold: which ones. When every county it lies in is one,
        # the place is still not wholly outside because labels of parcels held elsewhere name it: say where.
        if pc and pc["state"] in states and unheld:
            if len(unheld) < len(pc["counties"]):
                parts.append(f"{pc['name']}, {pc['state']} also lies in {_county_list(unheld)}, which this registry "
                             "does not hold")
            else:
                parts.append(f"{pc['name']}, {pc['state']} lies in {_county_list(unheld)}, which this registry does "
                             f"not hold, but the labels of parcels it holds in {_county_list(labelled_held)} name it")
        if not one_word:
            parts.append(ADDRESS_SCOPE_NOTE)
        message = f"no parcel matched{at}: {'; '.join(parts)}. {holds}"
    out["reason"] = reason
    out["message"] = message
    return out


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
