"""Candidate comparables for a Texas unequal-appraisal comparison (``registry_tx_equity_candidates``).

Given a Texas parcel, list parcels from the same appraisal district and tax year that a person may use as
comparables, with the values, characteristics and citations ``calc_tx_unequal_appraisal`` takes, and the rule
that chose them. The rule is FactLot's default, not a legal standard; a person decides which to use.

Year consistency: every field of the subject and of each candidate is read from one tax year's roll. A Texas
district's rolls are one registry source per tax year (``store.roll_source``), so a parcel can hold current facts
from two years at once; this module never mixes them. The subject's roll year is the newest tax year whose roll
source gives it a positive value (or the ``tax_year`` asked for); building class may also come from the district's
companion source for that year (``tx-harris-cad-buildings``, ``-<year>`` for other years).

Privacy (data policy §3): only the parcel predicates in ``PARCEL_PREDICATES`` are read, so no owner name,
mailing address, ``ownership.*`` fact or relationship can reach the output.

Mirrors ``registryTxEquityCandidates`` in packages/tools/src/registry.ts exactly (the cross-language registry test).
"""

from __future__ import annotations

import json
import re
from typing import Any

from .._core import fmt_num, round_
from .store import ROLL_BASE_TAX_YEAR, Registry, _number, fact_citation

TEXAS_FIPS = "48"
WHICH_PARCEL = "give urn, or county_fips and apn (with state_fips 48, or none)"


# Tarrant Appraisal District (48439): its robots.txt signals "search=yes,ai-train=no,use=reference"; use=reference
# is undefined and ai-input is not stated, so this tool serves no Tarrant parcel until that is clarified.
WITHHELD_COUNTIES = {
    "439": ("Tarrant Appraisal District's published signals do not say whether serving its data to AI agents is "
            "allowed; FactLot does not serve Tarrant comparables until that is clarified"),
}

# Counties a hosted FactLot service serves from no tool (``hostedWithheldCounties()`` in TS), keyed by 5-digit county
# FIPS, with the reason. Owner decision of 2026-11-07: Tarrant (48439) is withheld from every hosted tool, not only
# this one. Self-hosted SDKs are unaffected; the hosted pack builder imports this as its one source of truth.
HOSTED_WITHHELD_COUNTIES = {f"{TEXAS_FIPS}{county}": reason for county, reason in WITHHELD_COUNTIES.items()}


def hosted_withheld_counties() -> dict[str, str]:
    """A fresh copy of ``HOSTED_WITHHELD_COUNTIES`` (``hostedWithheldCounties()`` in TS)."""
    return dict(HOSTED_WITHHELD_COUNTIES)


def texas_only(state_fips: str) -> str:
    """The error for a parcel outside Texas (``texasOnly`` in TS)."""
    return (f"registry_tx_equity_candidates is Texas-only (state FIPS 48): this parcel is in state FIPS {state_fips}. "
            "Texas unequal-appraisal protests compare parcels on one Texas appraisal district's roll")


DEFAULTS = {"area_band": 0.35, "year_band": 15, "min_matches": 10, "limit": 50}
#: The most candidates one answer returns: the input schema's bound on ``limit`` (``TX_EQUITY_LIMIT_MAX`` in TS).
LIMIT_MAX = 200
#: Most codes in ``local_use_codes`` (``TX_EQUITY_USE_CODES_MAX`` in TS).
USE_CODES_MAX = 50
#: Most subjects in one ``registry_tx_equity_candidates_batch`` call (``TX_EQUITY_BATCH_MAX_SUBJECTS`` in TS).
BATCH_MAX_SUBJECTS = 50
#: The rule parameters a batch applies to every subject.
BATCH_PARAMS = ("area_band", "year_band", "min_matches", "limit", "tax_year", "same_building_class",
                "same_local_use_code", "local_use_codes")
# The only predicates this tool reads (never ownership.*).
PARCEL_PREDICATES = (
    "parcel.tax_year", "parcel.apn", "parcel.state_property_category", "parcel.market_value",
    "parcel.appraised_value", "parcel.improvement_area_sf", "parcel.land_area_sf", "parcel.year_built",
    "parcel.neighborhood_code", "parcel.building_class", "parcel.local_use_code", "parcel.situs_address",
)
_IN = ", ".join(f"'{p}'" for p in PARCEL_PREDICATES)
_ORDER = " ORDER BY f.subject, f.predicate, f.as_of DESC, f.fact_id"
# Current facts of one parcel with the source of each, and the same for every parcel in a county whose category
# fact in one of the given roll sources has a given value (the caller adds the source lists).
_SUBJECT_SQL = (
    "SELECT f.*, s.source_id AS source_id FROM current_facts f JOIN snapshots s ON s.document_id = f.document_id "
    f"WHERE f.subject = ? AND f.predicate IN ({_IN})" + _ORDER
)
_POOL_SQL = (
    "SELECT f.*, s.source_id AS source_id FROM current_facts f JOIN snapshots s ON s.document_id = f.document_id "
    "WHERE f.subject IN (SELECT c.subject FROM current_facts c JOIN snapshots cs ON cs.document_id = c.document_id "
    "WHERE c.subject >= ? AND c.subject < ? AND c.predicate = 'parcel.state_property_category' AND c.value_json = ? "
    "AND cs.source_id IN ({rolls})) AND f.predicate IN (" + _IN + ") AND s.source_id IN ({sources})" + _ORDER
)
_COUNTY_SOURCES_SQL = "SELECT source_id FROM sources WHERE state_fips = ? AND county_fips = ? ORDER BY source_id"
_YEAR_SUFFIX = re.compile(r"-([0-9]{4})$")
_SOURCE_SQL = (
    "SELECT s.document_id, s.source_id, s.as_of, s.retrieved_at, s.filename, src.publisher, src.title, src.url, "
    "src.license, src.ai_use, src.redistribution, src.attribution FROM snapshots s JOIN sources src USING (source_id) "
    "WHERE s.document_id = ?"
)
_ZIP_AFTER_COMMA = re.compile(r"(?:^|[^0-9A-Z_])([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")
_STATE_ZIP_TAIL = re.compile(r"\s[A-Z]{2}\s+([0-9]{5})(?:[- ]?[0-9]{1,4})?\s*$")

TIERS = ("neighborhood", "zip", "county")
# The steps of ``_funnel``, in its order (``TX_EQUITY_STEPS`` in TS).
STEPS = {
    "base": ("on the district's roll for the tax year, with exactly the subject's state property category code, a "
             "positive improvement area and an appraised or market value"),
    "area": "improvement area within area_band of the subject's",
    "year": "year built within year_band years of the subject's, when both are known",
    "same_building_class": "building class exactly the subject's (same_building_class)",
    "same_local_use_code": "local use code exactly the subject's (same_local_use_code)",
    "local_use_codes": "local use code one of local_use_codes",
}
RULE = (
    "FactLot's default candidate rule (a design choice, not a legal standard): the subject's roll year is the newest "
    "tax year whose roll gives it a positive market or appraised value (or tax_year when given), and every field of "
    "the subject and the candidates is read from that year's roll (building class also from the district's "
    "buildings file for that year). Candidates are parcels on the same district's roll for that year with exactly "
    "the same state property category code, an improvement area within area_band (a share) of the subject's, a year built within "
    "year_band years of the subject's when both are known, and an appraised or market value. Tiers: parcels sharing "
    "the subject's neighborhood code (when it has one), then parcels in its 5-digit ZIP code, then the rest of the "
    "county only when the first two tiers hold fewer than min_matches. Ordered by tier, then nearest improvement "
    "area, then URN; at most limit returned."
)
NOTICE = (
    "Candidates only: a person decides which, if any, to use as comparables. The selection rule is FactLot's "
    "default, not a legal standard of comparability. For evidence calculations only: FactLot does not represent "
    "property owners, file protests, or advise whether to protest or what value to claim. Owner names and mailing "
    "addresses are never returned. Not an appraisal or an opinion of value (Tex. Occ. Code §1103.003(1)); not legal "
    "or tax advice and not a substitute for the advice of an attorney. FactLot is software, not a property tax "
    "consultant under Texas Occupations Code chapter 1152; it does not prepare, file or advise on protests."
)


CALC_ARGS_NOTICE = (
    "calc_args is the candidate list under FactLot's default rule (selection_rule) in calc_tx_unequal_appraisal's "
    "input shape, not a selection of comparables by FactLot: the caller reviews it, may remove, add or edit "
    "comparables, and adds any adjustments, each with a reason, before calling calc_tx_unequal_appraisal (which "
    "needs at least 3 comparables). The order of operations is registry_tx_equity_candidates, review, "
    "calc_tx_unequal_appraisal with the reviewed calc_args, then report_create."
)
_CALC_LABEL_MAX = 80
_CALC_FIELDS = ("county_fips", "value", "value_basis", "improvement_area_sf", "land_area_sf")
_CALC_CITATION_KEYS = ("fact_id", "document_id", "locator", "as_of")


def _calc_party(row: dict[str, Any], with_citation: bool) -> dict[str, Any]:
    """A subject or candidate as a ``calc_tx_unequal_appraisal`` subject or comparable (``calcParty`` in TS)."""
    out: dict[str, Any] = {"id": row["id"]}
    situs = _string(row.get("situs_address"))
    if situs is not None:
        out["label"] = situs if len(situs) <= _CALC_LABEL_MAX else situs[:_CALC_LABEL_MAX - 1] + "…"
    for k in _CALC_FIELDS:
        if row.get(k) not in (None, ""):
            out[k] = row[k]
    cite = row.get("citation")
    if with_citation and cite:
        out["citation"] = {k: cite[k] for k in _CALC_CITATION_KEYS if cite.get(k) not in (None, "")}
    return out


def equity_calc_args(answer: dict[str, Any]) -> dict[str, Any]:
    """``calc_args`` and ``selection_rule`` from an answer's own fields (``txEquityCalcArgs`` in TS)."""
    subject, selection = answer["subject"], answer["selection"]
    criteria, parameters = selection["criteria"], selection["parameters"]
    area, year = criteria["improvement_area_sf"], criteria["year_built"]
    tax_year = selection["tax_year"] if selection["tax_year"] is not None else subject["tax_year"]
    calc_args = None if subject["value"] is None or tax_year is None else {
        "tax_year": tax_year,
        "subject": _calc_party(subject, False),
        "comparables": [_calc_party(c, True) for c in answer["candidates"]],
    }
    return {
        "calc_args": calc_args,
        "selection_rule": {
            "tax_year": selection["tax_year"],
            "state_property_category": criteria["state_property_category"],
            "area_band": {"share": parameters["area_band"], "min_sf": None if area is None else area["min"],
                          "max_sf": None if area is None else area["max"]},
            "year_band": {"years": parameters["year_band"], "min": None if year is None else year["min"],
                          "max": None if year is None else year["max"]},
            "min_matches": parameters["min_matches"],
            "limit": parameters["limit"],
            "subject_summary": selection.get("subject_summary"),
            "narrowing": selection.get("narrowing", []),
            "steps": selection.get("steps", []),
            "tiers": [{k: t[k] for k in ("tier", "key", "applied", "matched", "returned")} for t in selection["tiers"]],
            "widened_to_county": selection["widened_to_county"],
            "matched": selection["matched"],
            "returned": selection["returned"],
            "notice": CALC_ARGS_NOTICE,
        },
    }


def batch_answer(answer: dict[str, Any]) -> dict[str, Any]:
    """One subject's answer inside a batch: the single answer without ``notice`` and ``selection.rule``, which the
    batch gives once at the top."""
    out = {k: v for k, v in answer.items() if k != "notice"}
    out["selection"] = {k: v for k, v in answer["selection"].items() if k != "rule"}
    return out


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


def source_tax_year(source_id: str) -> int:
    """The tax year a roll or companion source holds by its id (``sourceTaxYear`` in TS): ``-<year>``, else the base year."""
    m = _YEAR_SUFFIX.search(source_id)
    return int(m.group(1)) if m else ROLL_BASE_TAX_YEAR


def _source_base(source_id: str) -> str:
    return _YEAR_SUFFIX.sub("", source_id)


def _by_subject(rows: list[Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r["subject"], []).append(dict(r))
    return out


def _roll_years(rows: list[dict[str, Any]]) -> dict[str, tuple[float, bool]]:
    """source → (tax year, has a positive value) for each source whose current facts give the parcel a tax year."""
    first: dict[str, dict[str, dict[str, Any]]] = {}
    for r in rows:
        first.setdefault(r["source_id"], {}).setdefault(r["predicate"], r)
    out: dict[str, tuple[float, bool]] = {}
    for src, facts in first.items():
        year = _number(_value(facts, "parcel.tax_year"))
        if year is not None:
            valued = any((_number(_value(facts, p)) or 0) > 0 for p in ("parcel.market_value", "parcel.appraised_value"))
            out[src] = (year, valued)
    return out


def _year_facts(rows: list[dict[str, Any]], rolls: list[str], companions: list[str]) -> dict[str, dict[str, Any]]:
    """predicate → newest fact from the year's roll sources; building class from a companion when the roll has none."""
    facts: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r["source_id"] in rolls:
            facts.setdefault(r["predicate"], r)
    if "parcel.building_class" not in facts:
        for r in rows:
            if r["source_id"] in companions and r["predicate"] == "parcel.building_class":
                facts.setdefault(r["predicate"], r)
    return facts


def _value(facts: dict[str, dict[str, Any]], predicate: str) -> Any:
    f = facts.get(predicate)
    return json.loads(f["value_json"]) if f else None


def _string(v: Any) -> str | None:
    return v if isinstance(v, str) and v != "" else None


def _positive(v: Any) -> float | None:
    n = _number(v)
    return n if n is not None and n > 0 else None


_SHAPE_KEYS = ("id", "county_fips", "apn", "value", "value_basis", "value_per_sf", "market_value", "appraised_value",
               "improvement_area_sf", "land_area_sf", "year_built", "state_property_category", "local_use_code",
               "neighborhood_code", "building_class", "situs_address", "tax_year", "citation")


def _shape(r: dict[str, Any]) -> dict[str, Any]:
    """A subject or candidate row in the answer's key order with ``value_per_sf`` computed (``equityShape`` in TS):
    the roll's value divided by its improvement area, rounded to the cent; null without both."""
    value, area = _number(r.get("value")), _positive(r.get("improvement_area_sf"))
    out = {k: r.get(k) for k in _SHAPE_KEYS}
    out["value_per_sf"] = round_(value / area, 2) if value is not None and area is not None else None
    return out


def _comparable(urn: str, facts: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A parcel shaped as a ``calc_tx_unequal_appraisal`` subject or comparable; missing facts are null."""
    market, appraised = _number(_value(facts, "parcel.market_value")), _number(_value(facts, "parcel.appraised_value"))
    basis = "appraised" if appraised is not None else "market" if market is not None else None
    cited = facts.get("parcel.appraised_value" if basis == "appraised" else "parcel.market_value") if basis else None
    return _shape({
        "id": urn,
        "county_fips": urn.split(":")[2][5:8],
        "apn": _string(_value(facts, "parcel.apn")),
        "value": appraised if basis == "appraised" else market,
        "value_basis": basis,
        "market_value": market,
        "appraised_value": appraised,
        "improvement_area_sf": _number(_value(facts, "parcel.improvement_area_sf")),
        "land_area_sf": _number(_value(facts, "parcel.land_area_sf")),
        "year_built": _number(_value(facts, "parcel.year_built")),
        "state_property_category": _string(_value(facts, "parcel.state_property_category")),
        "local_use_code": _string(_value(facts, "parcel.local_use_code")),
        "neighborhood_code": _string(_value(facts, "parcel.neighborhood_code")),
        "building_class": _string(_value(facts, "parcel.building_class")),
        "situs_address": _string(_value(facts, "parcel.situs_address")),
        "tax_year": _number(_value(facts, "parcel.tax_year")),
        "citation": fact_citation(cited) if cited else None,
    })


def _code_text(v: Any) -> str:
    return v if isinstance(v, str) else "not on the roll"


def _narrowing(subject: dict[str, Any], same_building_class: bool, same_local_use_code: bool,
               local_use_codes: list[str] | None, year_used: Any, missing: bool) -> list[dict[str, Any]]:
    """The caller's narrowing parameters as the answer states them (``equityNarrowing`` in TS)."""
    roll = "any roll" if year_used is None else f"the {fmt_num(year_used)} roll"
    out: list[dict[str, Any]] = []

    def entry(parameter: str, value: Any, text: str) -> dict[str, Any]:
        return {"parameter": parameter, "applied": value is not None and not missing, "value": value,
                "text": "not applied: the subject lacks a fact the rule needs, so no candidates are selected"
                if missing else text}

    if same_building_class:
        cls = subject["building_class"]
        out.append(entry("same_building_class", cls,
                         f"not applied: the subject has no building class on {roll}" if cls is None
                         else f"only parcels whose building class is exactly the subject's ({cls})"))
    codes = local_use_codes or []
    if same_local_use_code:
        code = subject["local_use_code"]
        out.append(entry("same_local_use_code", None if codes else code,
                         "not applied: local_use_codes was given and is used instead" if codes
                         else f"not applied: the subject has no local use code on {roll}" if code is None
                         else f"only parcels whose local use code is exactly the subject's ({code})"))
    if codes:
        out.append(entry("local_use_codes", list(codes),
                         "only parcels whose local use code is one of: " + ", ".join(codes)))
    return out


def _sources(reg: Registry, document_ids: set[str]) -> list[dict[str, Any]]:
    """The cited snapshots with their source's rights, as ``registry_get`` gives each fact's ``rights``."""
    out = []
    for doc in sorted(document_ids):
        row = reg.db.execute(_SOURCE_SQL, (doc,)).fetchone()
        if row is None:
            continue
        # Every right is stated, attribution included (null when the source asks for none), so an agent can relay them.
        rights = {"ai_use": row["ai_use"], "redistribution": row["redistribution"], "license": row["license"],
                  "attribution": row["attribution"] or None}
        out.append({"document_id": doc, "source_id": row["source_id"],
                    "title": f"{row['publisher']}: {row['title']} ({row['filename']})", "uri": row["url"],
                    "retrieved_at": row["retrieved_at"], "as_of": row["as_of"], "rights": rights})
    return out


def equity_candidates(reg: Registry, urn: str, *, area_band: float = DEFAULTS["area_band"],
                      year_band: int = DEFAULTS["year_band"], min_matches: int = DEFAULTS["min_matches"],
                      limit: int = DEFAULTS["limit"], tax_year: int | None = None, same_building_class: bool = False,
                      same_local_use_code: bool = False, local_use_codes: list[str] | None = None) -> dict[str, Any]:
    """Candidates for the Texas parcel ``urn`` (which the caller has checked is a parcel in this file)."""
    region = urn.split(":")[2]
    subject_rows = _by_subject(reg.db.execute(_SUBJECT_SQL, (urn,)).fetchall()).get(urn, [])
    years = _roll_years(subject_rows)
    available = sorted({y for y, _v in years.values()}, reverse=True)
    valued = [y for y, v in years.values() if v]
    warnings: list[str] = []
    if tax_year is not None:
        year_used = tax_year if tax_year in available else None
        if year_used is None:
            warnings.append(f"the subject is on no current roll for tax year {tax_year}; its roll years: "
                            + (", ".join(str(int(y)) for y in available) or "none"))
    else:
        year_used = max(valued) if valued else (available[0] if available else None)
    rolls = sorted(src for src, (y, _v) in years.items() if y == year_used)
    county_sources = [r[0] for r in reg.db.execute(_COUNTY_SOURCES_SQL, (region[3:5], region[5:8]))]
    companions = [c for c in county_sources if c not in rolls and year_used is not None
                  and source_tax_year(c) == year_used and any(c.startswith(_source_base(r) + "-") for r in rolls)]
    subject_facts = _year_facts(subject_rows, rolls, companions)
    subject = {**_comparable(urn, subject_facts), "value_history": reg.value_history(urn)}
    codes = list(local_use_codes) if local_use_codes else None
    parameters = {"area_band": area_band, "year_band": year_band, "min_matches": min_matches, "limit": limit,
                  "tax_year": tax_year, "same_building_class": same_building_class,
                  "same_local_use_code": same_local_use_code, "local_use_codes": codes}
    area, year, zip5 = _positive(subject["improvement_area_sf"]), subject["year_built"], situs_zip5(subject["situs_address"])
    criteria = {
        "county_fips": subject["county_fips"], "tax_year": subject["tax_year"],
        "state_property_category": subject["state_property_category"],
        "improvement_area_sf": None if area is None else {"subject": area, "min": area * (1 - area_band),
                                                           "max": area * (1 + area_band)},
        "year_built": None if year is None else {"subject": year, "min": year - year_band, "max": year + year_band},
        "neighborhood_code": subject["neighborhood_code"], "zip": zip5,
    }
    missing = [p for p, v in (("parcel.tax_year", subject["tax_year"]),
                              ("parcel.state_property_category", subject["state_property_category"]),
                              ("parcel.improvement_area_sf", area)) if v is None]
    narrowing = _narrowing(subject, same_building_class, same_local_use_code, codes, year_used, bool(missing))
    # The rule's narrowing tests: a building class, and the local use codes a candidate's must be one of.
    rule_class = subject["building_class"] if same_building_class else None
    rule_codes = codes if codes else ([subject["local_use_code"]] if same_local_use_code
                                      and subject["local_use_code"] is not None else None)
    if subject["value"] is None:
        warnings.append("the subject has no current parcel.appraised_value or parcel.market_value fact")
    matched: list[tuple[int, float, str, dict[str, Any], dict[str, dict[str, Any]]]] = []
    funnel: list[int] = []
    if missing:
        warnings.append("no candidates selected: the subject has no current " + ", ".join(missing)
                        + " fact (an improvement area must be positive), which the rule needs")
    else:
        for n in narrowing:
            if not n["applied"]:
                warnings.append(f"{n['parameter']} {n['text']}")
        lo, hi = criteria["improvement_area_sf"]["min"], criteria["improvement_area_sf"]["max"]
        sql = _POOL_SQL.format(rolls=", ".join("?" * len(rolls)), sources=", ".join("?" * (len(rolls) + len(companions))))
        pool = _by_subject(reg.db.execute(sql, (
            f"fl:parcel:{region}:", f"fl:parcel:{region};", subject_facts["parcel.state_property_category"]["value_json"],
            *rolls, *rolls, *companions)).fetchall())
        funnel = [0, 0, 0] + ([0] if rule_class is not None else []) + ([0] if rule_codes is not None else [])
        for cand_urn, cand_rows in pool.items():
            if cand_urn == urn:
                continue
            facts = _year_facts(cand_rows, rolls, companions)
            c = _comparable(cand_urn, facts)
            c_area = _positive(c["improvement_area_sf"])
            if (c["state_property_category"] != subject["state_property_category"] or c["tax_year"] != subject["tax_year"]
                    or c_area is None or c["value"] is None):
                continue
            funnel[0] += 1
            if not lo <= c_area <= hi:
                continue
            funnel[1] += 1
            if year is not None and c["year_built"] is not None and abs(c["year_built"] - year) > year_band:
                continue
            funnel[2] += 1
            k = 3
            if rule_class is not None:
                if c["building_class"] != rule_class:
                    continue
                funnel[k] += 1
                k += 1
            if rule_codes is not None:
                if c["local_use_code"] not in rule_codes:
                    continue
                funnel[k] += 1
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
    step_names = [] if missing else [STEPS["base"], STEPS["area"], STEPS["year"]]
    step_names += [STEPS[n["parameter"]] for n in narrowing if n["applied"]]
    steps = [{"step": name, "left": funnel[i]} for i, name in enumerate(step_names)]
    if not missing and len(included) < min_matches:
        warnings.append(f"{len(included)} candidates meet the rule in the whole county, fewer than min_matches "
                        f"({min_matches}); the statute does not define a reasonable number of comparables")
    if not missing and len(returned) < limit:
        near = counts[0] + counts[1]
        if not widened and counts[2] > 0:
            warnings.append(f"{len(returned)} candidates returned for limit {limit}: the neighborhood and ZIP code "
                            f"tiers hold {near}, at least min_matches ({min_matches}), so the rule does not include "
                            f"the {counts[2]} more that meet it in the rest of the county; a min_matches above {near} "
                            "includes them")
        elif len(included) >= min_matches:
            warnings.append(f"{len(returned)} candidates returned for limit {limit}: no other parcel meets the rule")
    if subject["value_basis"] is not None:
        other = sum(1 for c in candidates if c["value_basis"] != subject["value_basis"])
        if other:
            warnings.append(f"{other} of the {len(candidates)} candidates have a value_basis other than the subject's "
                            f"({subject['value_basis']}): compare like with like")
    for field, words in (("building_class", "a building class"), ("local_use_code", "a local use code")):
        mine = subject[field]
        if not isinstance(mine, str):
            continue
        other = sum(1 for c in candidates if c[field] != mine)
        if other:
            warnings.append(f"{other} of the {len(candidates)} candidates have {words} other than the subject's "
                            f"({mine}) or none on the roll")
    # Every snapshot a returned fact comes from, with its source's rights.
    docs = {f["document_id"] for facts in [subject_facts, *(m[4] for m in returned)] for f in facts.values()}
    docs |= {cite["document_id"] for e in subject["value_history"] for cite in e["citations"].values() if cite}
    sources = _sources(reg, docs)
    # The files the compared values come from: each value citation's snapshot.
    cited_by: dict[str, dict[str, Any]] = {}
    for row, is_subject in [(subject, True), *((c, False) for c in candidates)]:
        if row["citation"]:
            e = cited_by.setdefault(row["citation"]["document_id"], {"subject": False, "candidates": 0})
            if is_subject:
                e["subject"] = True
            else:
                e["candidates"] += 1
    certification = None if year_used is None else f"{fmt_num(year_used)}-07-25"
    compared_files = [{
        "document_id": src["document_id"], "source_id": src["source_id"], "title": src["title"], "as_of": src["as_of"],
        "tax_year": year_used,
        "before_certification_deadline": None if certification is None or not isinstance(src["as_of"], str)
        else src["as_of"] < certification,
        "subject_value": cited_by[src["document_id"]]["subject"],
        "candidate_values": cited_by[src["document_id"]]["candidates"],
    } for src in sources if src["document_id"] in cited_by]
    subject_summary = (
        f"the subject on {'no roll' if year_used is None else f'the {fmt_num(year_used)} roll'}: "
        f"state property category {_code_text(subject['state_property_category'])}; "
        f"building class {_code_text(subject['building_class'])}; "
        f"local use code {_code_text(subject['local_use_code'])}; "
        f"improvement area {'not on the roll' if area is None else fmt_num(area) + ' sf'}; "
        f"year built {'not on the roll' if year is None else fmt_num(year)}"
    )
    answer = {
        "subject": subject,
        "candidates": candidates,
        "selection": {"rule": RULE, "parameters": parameters, "tax_year": year_used, "available_tax_years": available,
                      "roll_sources": rolls, "building_class_sources": companions, "compared_files": compared_files,
                      "subject_summary": subject_summary, "criteria": criteria, "narrowing": narrowing,
                      "steps": steps, "tiers": tiers, "widened_to_county": widened and not missing,
                      "matched": len(included), "returned": len(returned), "truncated": len(included) > len(returned)},
        "sources": sources,
        "notice": NOTICE,
        "warnings": warnings,
    }
    return {**answer, **equity_calc_args(answer)}
