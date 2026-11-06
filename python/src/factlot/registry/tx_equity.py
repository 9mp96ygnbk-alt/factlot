"""Candidate comparables for a Texas unequal-appraisal comparison (``registry_tx_equity_candidates``).

Given a Texas parcel, list parcels from the same appraisal district and tax year that a person may use as
comparables, with the values, characteristics and citations ``calc_tx_unequal_appraisal`` takes, and the rule
that chose them. The rule is FactLot's default, not a legal standard; a person decides which to use.

Privacy (data policy §3): only the parcel predicates in ``PARCEL_PREDICATES`` are read, so no owner name,
mailing address, ``ownership.*`` fact or relationship can reach the output.

Mirrors ``registryTxEquityCandidates`` in packages/tools/src/registry.ts exactly (the cross-language registry test).
"""

from __future__ import annotations

import json
import re
from typing import Any

from .store import Registry, _number, fact_citation

TEXAS_FIPS = "48"
WHICH_PARCEL = "give urn, or county_fips and apn (with state_fips 48, or none)"


def texas_only(state_fips: str) -> str:
    """The error for a parcel outside Texas (``texasOnly`` in TS)."""
    return (f"registry_tx_equity_candidates is Texas-only (state FIPS 48): this parcel is in state FIPS {state_fips}. "
            "Texas unequal-appraisal protests compare parcels on one Texas appraisal district's roll")


DEFAULTS = {"area_band": 0.35, "year_band": 15, "min_matches": 10, "limit": 50}
# The only predicates this tool reads (never ownership.*).
PARCEL_PREDICATES = (
    "parcel.tax_year", "parcel.state_property_category", "parcel.market_value", "parcel.appraised_value",
    "parcel.improvement_area_sf", "parcel.land_area_sf", "parcel.year_built", "parcel.neighborhood_code",
    "parcel.building_class", "parcel.situs_address",
)
_IN = ", ".join(f"'{p}'" for p in PARCEL_PREDICATES)
_ORDER = " ORDER BY f.subject, f.predicate, f.as_of DESC, f.fact_id"
# Current facts of one parcel, and of every parcel in a county whose current category fact has a given value.
_SUBJECT_SQL = f"SELECT f.* FROM current_facts f WHERE f.subject = ? AND f.predicate IN ({_IN})" + _ORDER
_POOL_SQL = (
    "SELECT f.* FROM current_facts f WHERE f.subject IN (SELECT c.subject FROM current_facts c WHERE c.subject >= ? "
    "AND c.subject < ? AND c.predicate = 'parcel.state_property_category' AND c.value_json = ?) "
    f"AND f.predicate IN ({_IN})" + _ORDER
)
_SOURCE_SQL = (
    "SELECT s.document_id, s.source_id, s.as_of, s.retrieved_at, s.filename, src.publisher, src.title, src.url, "
    "src.license, src.ai_use, src.redistribution, src.attribution FROM snapshots s JOIN sources src USING (source_id) "
    "WHERE s.document_id = ?"
)
_ZIP_AFTER_COMMA = re.compile(r"(?:^|[^0-9A-Z_])([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")
_STATE_ZIP_TAIL = re.compile(r"\s[A-Z]{2}\s+([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")

TIERS = ("neighborhood", "zip", "county")
RULE = (
    "FactLot's default candidate rule (a design choice, not a legal standard): parcels in the subject's appraisal "
    "district (county) whose current facts give the same tax year as the subject's and exactly the same state "
    "property category code, an improvement area within area_band (a share) of the subject's, a year built within "
    "year_band years of the subject's when both are known, and an appraised or market value. Tiers: parcels sharing "
    "the subject's neighborhood code (when it has one), then parcels in its 5-digit ZIP code, then the rest of the "
    "county only when the first two tiers hold fewer than min_matches. Ordered by tier, then nearest improvement "
    "area, then URN; at most limit returned."
)
NOTICE = (
    "Candidates only: a person decides which, if any, to use as comparables. The selection rule is FactLot's "
    "default, not a legal standard of comparability. For evidence calculations only: FactLot does not represent "
    "property owners, file protests, or advise whether to protest or what value to claim. Owner names and mailing "
    "addresses are never returned."
)


def situs_zip5(situs: Any) -> str | None:
    """The 5-digit ZIP code of a situs address (``situsZip5`` in TS): after the first comma, or after a state."""
    if not isinstance(situs, str):
        return None
    s = situs.upper().strip()
    if "," in s:
        m = _ZIP_AFTER_COMMA.search(s.split(",", 1)[1])
    else:
        m = _STATE_ZIP_TAIL.search(s)
    return m.group(1) if m else None


def _first_per_predicate(rows: list[Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """subject → predicate → its newest current fact row (``registry_get``'s rule for single-valued predicates)."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r["subject"], {}).setdefault(r["predicate"], dict(r))
    return out


def _value(facts: dict[str, dict[str, Any]], predicate: str) -> Any:
    f = facts.get(predicate)
    return json.loads(f["value_json"]) if f else None


def _string(v: Any) -> str | None:
    return v if isinstance(v, str) and v != "" else None


def _positive(v: Any) -> float | None:
    n = _number(v)
    return n if n is not None and n > 0 else None


def _comparable(urn: str, facts: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A parcel shaped as a ``calc_tx_unequal_appraisal`` subject or comparable; missing facts are null."""
    market, appraised = _number(_value(facts, "parcel.market_value")), _number(_value(facts, "parcel.appraised_value"))
    basis = "appraised" if appraised is not None else "market" if market is not None else None
    cited = facts.get("parcel.appraised_value" if basis == "appraised" else "parcel.market_value") if basis else None
    return {
        "id": urn,
        "county_fips": urn.split(":")[2][5:8],
        "value": appraised if basis == "appraised" else market,
        "value_basis": basis,
        "market_value": market,
        "appraised_value": appraised,
        "improvement_area_sf": _number(_value(facts, "parcel.improvement_area_sf")),
        "land_area_sf": _number(_value(facts, "parcel.land_area_sf")),
        "year_built": _number(_value(facts, "parcel.year_built")),
        "state_property_category": _string(_value(facts, "parcel.state_property_category")),
        "neighborhood_code": _string(_value(facts, "parcel.neighborhood_code")),
        "building_class": _string(_value(facts, "parcel.building_class")),
        "situs_address": _string(_value(facts, "parcel.situs_address")),
        "tax_year": _number(_value(facts, "parcel.tax_year")),
        "citation": fact_citation(cited) if cited else None,
    }


def _sources(reg: Registry, document_ids: set[str]) -> list[dict[str, Any]]:
    """The cited snapshots with their source's rights, as ``registry_get`` gives each fact's ``rights``."""
    out = []
    for doc in sorted(document_ids):
        row = reg.db.execute(_SOURCE_SQL, (doc,)).fetchone()
        if row is None:
            continue
        rights = {"ai_use": row["ai_use"], "redistribution": row["redistribution"], "license": row["license"]}
        if row["attribution"]:
            rights["attribution"] = row["attribution"]
        out.append({"document_id": doc, "source_id": row["source_id"],
                    "title": f"{row['publisher']}: {row['title']} ({row['filename']})", "uri": row["url"],
                    "retrieved_at": row["retrieved_at"], "as_of": row["as_of"], "rights": rights})
    return out


def equity_candidates(reg: Registry, urn: str, *, area_band: float = DEFAULTS["area_band"],
                      year_band: int = DEFAULTS["year_band"], min_matches: int = DEFAULTS["min_matches"],
                      limit: int = DEFAULTS["limit"]) -> dict[str, Any]:
    """Candidates for the Texas parcel ``urn`` (which the caller has checked is a parcel in this file)."""
    region = urn.split(":")[2]
    subject_facts = _first_per_predicate(reg.db.execute(_SUBJECT_SQL, (urn,)).fetchall()).get(urn, {})
    subject = {**_comparable(urn, subject_facts), "value_history": reg.value_history(urn)}
    parameters = {"area_band": area_band, "year_band": year_band, "min_matches": min_matches, "limit": limit}
    area, year, zip5 = _positive(subject["improvement_area_sf"]), subject["year_built"], situs_zip5(subject["situs_address"])
    criteria = {
        "county_fips": subject["county_fips"], "tax_year": subject["tax_year"],
        "state_property_category": subject["state_property_category"],
        "improvement_area_sf": None if area is None else {"subject": area, "min": area * (1 - area_band),
                                                           "max": area * (1 + area_band)},
        "year_built": None if year is None else {"subject": year, "min": year - year_band, "max": year + year_band},
        "neighborhood_code": subject["neighborhood_code"], "zip": zip5,
    }
    warnings: list[str] = []
    missing = [p for p, v in (("parcel.tax_year", subject["tax_year"]),
                              ("parcel.state_property_category", subject["state_property_category"]),
                              ("parcel.improvement_area_sf", area)) if v is None]
    if subject["value"] is None:
        warnings.append("the subject has no current parcel.appraised_value or parcel.market_value fact")
    matched: list[tuple[int, float, str, dict[str, Any], dict[str, dict[str, Any]]]] = []
    if missing:
        warnings.append("no candidates selected: the subject has no current " + ", ".join(missing)
                        + " fact (an improvement area must be positive), which the rule needs")
    else:
        lo, hi = criteria["improvement_area_sf"]["min"], criteria["improvement_area_sf"]["max"]
        pool = _first_per_predicate(reg.db.execute(
            _POOL_SQL, (f"fl:parcel:{region}:", f"fl:parcel:{region};", subject_facts["parcel.state_property_category"]["value_json"])
        ).fetchall())
        for cand_urn, facts in pool.items():
            if cand_urn == urn:
                continue
            c = _comparable(cand_urn, facts)
            c_area = _positive(c["improvement_area_sf"])
            if (c["state_property_category"] != subject["state_property_category"] or c["tax_year"] != subject["tax_year"]
                    or c_area is None or not lo <= c_area <= hi or c["value"] is None):
                continue
            if year is not None and c["year_built"] is not None and abs(c["year_built"] - year) > year_band:
                continue
            if subject["neighborhood_code"] is not None and c["neighborhood_code"] == subject["neighborhood_code"]:
                tier = 0
            elif zip5 is not None and situs_zip5(c["situs_address"]) == zip5:
                tier = 1
            else:
                tier = 2
            matched.append((tier, abs(c_area - area), cand_urn, c, facts))
    matched.sort(key=lambda m: (m[0], m[1], m[2]))
    counts = [sum(1 for m in matched if m[0] == t) for t in range(3)]
    widened = counts[0] + counts[1] < min_matches
    included = [m for m in matched if m[0] < 2 or widened]
    returned = included[:limit]
    keys = (subject["neighborhood_code"], zip5, subject["county_fips"])
    applied = (keys[0] is not None, keys[1] is not None, widened)
    tiers = [{"tier": TIERS[t], "key": keys[t], "applied": applied[t] and not missing, "matched": counts[t],
              "returned": sum(1 for m in returned if m[0] == t), "ids": [m[2] for m in returned if m[0] == t]}
             for t in range(3)]
    candidates = [m[3] for m in returned]
    if not missing and len(included) < min_matches:
        warnings.append(f"{len(included)} candidates meet the rule in the whole county, fewer than min_matches "
                        f"({min_matches}); the statute does not define a reasonable number of comparables")
    if subject["value_basis"] is not None:
        other = sum(1 for c in candidates if c["value_basis"] != subject["value_basis"])
        if other:
            warnings.append(f"{other} of the {len(candidates)} candidates have a value_basis other than the subject's "
                            f"({subject['value_basis']}): compare like with like")
    # Every snapshot a returned fact comes from, with its source's rights.
    docs = {f["document_id"] for facts in [subject_facts, *(m[4] for m in returned)] for f in facts.values()}
    docs |= {cite["document_id"] for e in subject["value_history"] for cite in e["citations"].values() if cite}
    return {
        "subject": subject,
        "candidates": candidates,
        "selection": {"rule": RULE, "parameters": parameters, "criteria": criteria, "tiers": tiers,
                      "widened_to_county": widened and not missing, "matched": len(included),
                      "returned": len(returned), "truncated": len(included) > len(returned)},
        "sources": _sources(reg, docs),
        "notice": NOTICE,
        "warnings": warnings,
    }
