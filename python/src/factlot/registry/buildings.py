"""Building roll-up: group the parcels of one building (above all, the condominium units that rolls
list as separate parcels) under a building subject with a deterministic FactLot building ID.

A parcel joins a building when its current situs address has the same street line and ZIP code
(unit, suite, "#" and floor designators removed; ``address_tokens`` in factlot.ids) as another
parcel in the same county. The building URN is ``building_id(state, county, zip, street)``: the ID
anyone computes offline from that address with ``id_building``. Each member records the rule that
describes it: a condominium lot in the source's own lot numbering where the source has one (DC
SSL lots 2000-6999; NYC BBL unit lots 1001-6999 and billing lots 7501-7599), otherwise the shared
address alone. Only groups of two or more parcels are recorded. The TypeScript reader
(``packages/tools/src/registry.ts``) reads the same table and writes the same JSON.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from ..ids import FactLotIdError, address_tokens, building_id, normalize_street, short_id
from .coverage import state_postal
from .normalize import situs_names_unit, situs_street_and_zip

RULE_BASIS = {
    "dc_condo_lot": ("District of Columbia SSL lot numbered 2000-6999, which the District's lot numbering assigns "
                     "to condominium units (DCGIS property records: lots 2000-6999 are condo lots)"),
    "nyc_condo_unit_lot": ("New York City BBL lot numbered 1001-6999, which Department of Finance lot numbering "
                           "assigns to condominium units (NYC Planning PLUTO data dictionary)"),
    "nyc_condo_billing_lot": ("New York City BBL lot numbered 7501-7599, a condominium billing lot under Department "
                              "of Finance lot numbering (NYC Planning PLUTO data dictionary)"),
    "same_street_address": "same street line and ZIP code in its situs address as the building's other parcels",
}
GROUPING = ("Parcels in one county whose current situs addresses share a street line and ZIP code (unit, suite, "
            "'#' and floor designators removed). Each member's rule says what else marks it: a condominium lot "
            "in the source's own lot numbering, or the shared address alone. A situs whose ZIP code the publisher "
            "cut short joins the one building at its street line whose ZIP code begins with the digits left "
            "(zip_found other_parcels). Inferred, not a published building record: two buildings at one address "
            "are one building here.")
_NYC = frozenset({"us-36005", "us-36047", "us-36061", "us-36081", "us-36085"})


def member_rule(parcel_urn: str, situs: str | None) -> tuple[str, bool]:
    """``(rule, is_unit)`` for a parcel placed in a building."""
    _, _, region, apn = parcel_urn.split(":", 3)
    if region == "us-11001" and apn[-4:].isdigit() and 2000 <= int(apn[-4:]) <= 6999:
        return "dc_condo_lot", True
    if region in _NYC and apn[:10].isdigit() and len(apn) >= 10:
        lot = int(apn[6:10])
        if 1001 <= lot <= 6999:
            return "nyc_condo_unit_lot", True
        if 7501 <= lot <= 7599:
            return "nyc_condo_billing_lot", False
    return "same_street_address", situs_names_unit(situs)


def has_table(db: sqlite3.Connection) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'building_members'").fetchone() is not None


def rollup(db: sqlite3.Connection) -> dict[str, Any]:
    """Rebuild every building roll-up from the current situs addresses; idempotent. Does not commit."""
    db.execute("DELETE FROM building_members")
    db.execute("DELETE FROM subjects WHERE kind = 'building' AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.subject = subjects.urn)")
    groups: dict[str, list[tuple[str, str, bool, str, str, str]]] = {}
    labels: dict[str, str] = {}
    # (region, street key) -> {zip: building URN}, to complete ZIP codes a publisher cut short.
    by_street: dict[tuple[str, str], dict[str, str]] = {}
    short_zip: list[tuple[str, str, str, str, str, str, str]] = []
    scanned = no_address = 0
    last = None
    for r in db.execute("SELECT subject, value_json, document_id FROM current_facts "
                        "WHERE predicate = 'parcel.situs_address' ORDER BY subject, as_of DESC, fact_id"):
        if r[0] == last:  # two current sources: the newest situs counts
            continue
        last = r[0]
        scanned += 1
        situs = json.loads(r[1])
        found = situs_street_and_zip(situs) if isinstance(situs, str) else None
        region = r[0].split(":")[2]
        try:
            if found is None:
                raise FactLotIdError("no street line and ZIP code")
            street = normalize_street(found[0])
            if len(found[1]) < 5:
                short_zip.append((r[0], situs, region, street, found[1], found[2], r[2]))
                continue
            urn = building_id(region[3:5], region[5:8], found[1], found[0]).urn
        except FactLotIdError:
            no_address += 1
            continue
        rule, unit = member_rule(r[0], situs)
        groups.setdefault(urn, []).append((r[0], rule, unit, found[2], "situs", r[2]))
        by_street.setdefault((region, street), {})[found[1]] = urn
        labels.setdefault(urn, f"{' '.join(address_tokens(found[0]))}, {state_postal(region[3:5]) or region[3:5]} {found[1]}")
    zip_completed = 0
    for parcel, situs, region, street, prefix, how, doc in short_zip:
        matches = [urn for z, urn in sorted(by_street.get((region, street), {}).items()) if z.startswith(prefix)]
        if len(matches) != 1:
            no_address += 1
            continue
        rule, unit = member_rule(parcel, situs)
        groups[matches[0]].append((parcel, rule, unit, how, "other_parcels", doc))
        zip_completed += 1
    buildings = members = 0
    by_rule: dict[str, int] = {}
    for urn in sorted(groups):
        if len(groups[urn]) < 2:
            continue
        buildings += 1
        db.execute("INSERT INTO subjects VALUES (?,?,?,?) ON CONFLICT(urn) DO UPDATE SET label = excluded.label",
                   (urn, "building", short_id(urn), labels[urn]))
        for parcel, rule, unit, how, zip_found, doc in groups[urn]:
            db.execute("INSERT INTO building_members VALUES (?,?,?,?,?,?,?)",
                       (urn, parcel, rule, int(unit), how, zip_found, doc))
            members += 1
            by_rule[rule] = by_rule.get(rule, 0) + 1
    return {"parcels_scanned": scanned, "parcels_without_street_and_zip": no_address,
            "zip_codes_completed": zip_completed, "buildings": buildings,
            "parcels_in_buildings": members, "by_rule": dict(sorted(by_rule.items()))}


def _counts(db: sqlite3.Connection, building_urn: str) -> tuple[int, int]:
    row = db.execute("SELECT COUNT(*), COALESCE(SUM(is_unit), 0) FROM building_members WHERE building_urn = ?",
                     (building_urn,)).fetchone()
    return row[0], row[1]


def building_of(db: sqlite3.Connection, parcel_urn: str) -> dict[str, Any] | None:
    """The building a parcel was rolled up into, or None."""
    if not has_table(db):
        return None
    row = db.execute("SELECT m.building_urn, m.rule, s.short, s.label FROM building_members m "
                     "JOIN subjects s ON s.urn = m.building_urn WHERE m.parcel_urn = ? ORDER BY m.building_urn LIMIT 1",
                     (parcel_urn,)).fetchone()
    if row is None:
        return None
    parcels, units = _counts(db, row[0])
    return {"urn": row[0], "short": row[2], "label": row[3], "parcel_count": parcels, "unit_count": units,
            "rule": row[1], "basis": RULE_BASIS[row[1]]}


def building_detail(db: sqlite3.Connection, building_urn: str) -> dict[str, Any]:
    """Members and grouping of a rolled-up building (the ``building`` field of its registry record)."""
    members = [{"urn": r[0], "label": r[1], "rule": r[2], "is_unit": bool(r[3]), "street_found": r[4],
                "zip_found": r[5]}
               for r in db.execute(
                   "SELECT m.parcel_urn, s.label, m.rule, m.is_unit, m.street_found, m.zip_found FROM building_members m "
                   "JOIN subjects s ON s.urn = m.parcel_urn WHERE m.building_urn = ? ORDER BY m.parcel_urn",
                   (building_urn,))] if has_table(db) else []
    rules: dict[str, int] = {}
    for m in members:
        rules[m["rule"]] = rules.get(m["rule"], 0) + 1
    return {"parcel_count": len(members), "unit_count": sum(1 for m in members if m["is_unit"]),
            "rules": dict(sorted(rules.items())), "basis": {k: RULE_BASIS[k] for k in sorted(rules)},
            "grouping": GROUPING, "members": members}


def owned_buildings(db: sqlite3.Connection, parcels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per building, how many of these (owned) parcels it holds; sets ``building`` on each parcel."""
    out: dict[str, dict[str, Any]] = {}
    for p in parcels:
        b = building_of(db, p["urn"])
        p["building"] = b["urn"] if b else None
        if b:
            entry = out.setdefault(b["urn"], {"urn": b["urn"], "label": b["label"], "owned_parcels": 0,
                                              "parcel_count": b["parcel_count"], "unit_count": b["unit_count"]})
            entry["owned_parcels"] += 1
    return sorted(out.values(), key=lambda e: (-e["owned_parcels"], e["urn"]))
