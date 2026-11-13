"""The FactLot Registry: a SQLite store of cited public-record facts about commercial property.

Every fact cites a content-addressed snapshot of the source file and the record it came from,
and carries the source's license and AI-use rights. Ingest is idempotent: re-ingesting the same
snapshot changes nothing; a newer snapshot adds newer facts, and reads return the latest.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from importlib import resources
from pathlib import Path
from typing import Any, Callable, Iterable

from .._core import fmt_num
from ..ids import FactLotIdError, _base32, entity_id, normalize_apn_v1, parcel_id, parse as parse_id, short_id
from .fields import label_value_history
from . import buildings as _buildings
from . import coverage as _coverage
from .normalize import (
    ADDRESS_KEY_VERSION,
    ADDRESS_CARD_PREDICATES,
    ADDRESS_ONE_WORD_CANDIDATES,
    ADDRESS_STREET_HINT_ROWS,
    NAME_KEY_VERSION,
    NAME_OVERLAP_WEIGHT,
    NAME_RATIO_WEIGHT,
    address_card,
    address_forms,
    address_hint_streets,
    address_match_key,
    address_place_rank,
    address_place_top,
    address_place_with,
    address_query,
    address_query_with_place,
    address_result_rows,
    address_row_tier,
    address_state,
    address_street_hint_from,
    address_unit,
    address_window_end,
    distinctive_tokens,
    scrub_mailing_address,
    entity_standing,
    entity_state,
    is_commercial,
    is_organization,
    legacy_address_key,
    legacy_name_key,
    name_similarity,
    normalize_address,
    organization_part,
    personal_style_organization,
    normalize_name,
    parcel_state,
)

PRODUCER = "factlot.registry"
# Predicates a subject may hold many of at once (one fact per sale, deed, mortgage or satisfaction; one per CMBS trust's
# participation in a building's loan; one per registrant that lists an entity as its subsidiary). Every other predicate is
# single-valued: when two current sources disagree, the newest fact is returned.
MULTI_VALUED_PREDICATES = frozenset({
    "transaction.sale", "transaction.deed", "debt.mortgage_recorded", "debt.mortgage_satisfaction_recorded",
    "debt.cmbs_loan", "entity.parent",
})
# Coverage marker (``coverage.present``) for a source that adds facts to parcels another source created.
COVERED_BY_ENRICHMENT = 2
# The predicates the registry writes (the TypeScript starter vocabulary, `Predicates` in @factlot/schema,
# lists the same names; tests keep the two in step).
ENRICHMENT_PREDICATES = frozenset({
    "zoning.district", "zoning.district_description", "zoning.other_districts", "zoning.split_zone",
    "zoning.commercial_overlay", "zoning.special_district", "zoning.limited_height_district",
    "zoning.e_designation", "zoning.max_far_residential", "zoning.max_far_commercial",
    "zoning.max_far_facility", "zoning.max_far_manufacturing", "zoning.max_far_affordable_residential",
    "parcel.built_far", "parcel.num_buildings", "parcel.num_floors", "parcel.units_residential",
    "parcel.units_total", "parcel.area_by_use_sf", "parcel.land_use_code", "parcel.year_altered",
    "parcel.historic_district", "parcel.landmark_designated", "transaction.sale",
    "debt.cmbs_loan", "entity.parent",
    "transaction.deed", "debt.mortgage_recorded", "debt.mortgage_satisfaction_recorded",
    "zoning.max_far_nonresidential", "zoning.max_height_ft",
    "energy.reporting_year", "energy.property_type", "energy.site_eui", "energy.weather_normalized_site_eui",
    "energy.source_eui", "energy.energy_star_score", "energy.ghg_emissions", "energy.ghg_intensity",
    "energy.floor_area_sf", "energy.property_lot_count",
    "parcel.neighborhood_code", "parcel.building_class",
})
SCHEMA_VERSION = "2"
# The ID spec parcel rule a file's parcel URNs were made with (meta ``parcel_rule``): rule 2 (ID spec
# 0.3) for a file started now; a file holding parcels and no ``parcel_rule`` was built with rule 1 and
# keeps it, so its parcels are found and re-ingested under the URNs they already have.
PARCEL_RULE = "2"

# Owner links: an exact, unambiguous normalized-name match is confidence 0.9; a fuzzy candidate a
# reviewer accepted is the candidate's score capped below that, so inferred links stay ranked.
EXACT_MATCH_CONFIDENCE = 0.9
REVIEWED_MATCH_MAX_CONFIDENCE = 0.8
# Score given to an exact name match registered only in another state, so it ranks first in the
# review queue but below the cap for reviewed links.
CROSS_STATE_EXACT_SCORE = 0.8
# Confidence of an exact link chosen among same-name entities because the others have ended
# (dissolved, revoked, merged, ...): one more inference than a plain exact match.
STANDING_MATCH_CONFIDENCE = 0.85
EXACT_MATCH_BASIS = "owner of record exactly matches one registered entity's normalized legal name"
# Defaults for the candidate generator: see Registry.queue_fuzzy_owner_matches.
FUZZY_THRESHOLD = 0.85
FUZZY_LIMIT_PER_OWNER = 5
FUZZY_MAX_TOKEN_FREQUENCY = 5000


@dataclass(frozen=True)
class Source:
    source_id: str
    publisher: str
    title: str
    url: str
    state_fips: str
    license: str
    ai_use: str = "unknown"
    redistribution: str = "unknown"
    county_fips: str | None = None
    attribution: str | None = None
    terms_reviewed: str | None = None


# Appraisal rolls are loaded under one registry source per tax year, so a district's next-year file (a
# preliminary roll in spring, or a next-year working file such as DCAD<year>_CURRENT.zip) does not retire
# the certified roll of the year before: the coverage rule retires facts only within a source. The tax
# year a source was first loaded for (its base year: 2026 for most Texas rolls) keeps the plain source id;
# every other tax year is ``<source_id>-<year>`` (``tx-dallas-cad-2027``). Within one tax year a newer
# file (certified after preliminary, a supplement after certification) still replaces the older one.
ROLL_BASE_TAX_YEAR = 2026


def roll_source(source: Source, tax_year: int | None, base_year: int = ROLL_BASE_TAX_YEAR) -> Source:
    """The registry source a roll for ``tax_year`` is loaded under (see ``ROLL_BASE_TAX_YEAR``)."""
    if tax_year is None or tax_year == base_year:
        return source
    return replace(source, source_id=f"{source.source_id}-{tax_year}", title=f"{source.title}, tax year {tax_year}")


def roll_tax_year(records: Iterable["ParcelRecord"]) -> tuple[int | None, list["ParcelRecord"]]:
    """The tax year of a roll file (the year most of its records state) and the records, read into a list."""
    recs = list(records)
    years = Counter(r.tax_year for r in recs if r.tax_year)
    return (years.most_common(1)[0][0] if years else None), recs


@dataclass(frozen=True)
class Snapshot:
    document_id: str
    source_id: str
    retrieved_at: str
    as_of: str
    filename: str | None = None
    bytes: int | None = None


@dataclass
class ParcelRecord:
    """One appraisal-roll record, already mapped from a source's layout by an adapter."""

    county_fips: str
    apn: str
    state_category: str | None = None
    account: str | None = None
    situs_address: str | None = None
    owner_name: str | None = None
    owner_mailing_address: str | None = None
    owner_confidential: bool = False
    land_area_sf: float | None = None
    improvement_area_sf: float | None = None
    year_built: int | None = None
    market_value: float | None = None
    appraised_value: float | None = None
    tax_year: int | None = None
    locator: str | None = None
    # The publisher's own use/class code (e.g. Cook County "5-17", LA County "2100"), kept verbatim
    # next to the normalized state_category so the mapping can be audited.
    local_use_code: str | None = None
    # Sales the same file records for the parcel, each a ``transaction.sale`` value (see docs/fact-model.md).
    sales: list[dict[str, Any]] = field(default_factory=list)
    # Other facts the same file records for the parcel (a zoning district the roll carries), as ``(predicate, value, unit)``.
    extra_facts: list[tuple[str, Any, str | None]] = field(default_factory=list)


@dataclass
class ParcelFacts:
    """Facts about a parcel the registry already holds, from a source that is not its roll.

    Zoning files, sales files and the like describe parcels the appraisal rolls created; they add
    facts to those parcels (matched by county and APN) and never create one. ``facts`` is a list of
    ``(predicate, value, unit)``; empty and null values are skipped.
    """

    county_fips: str
    apn: str
    facts: list[tuple[str, Any, str | None]]
    locator: str | None = None
    # How the facts were obtained: ``public_record`` for values read from the file, ``inferred``
    # (with a confidence) for values FactLot derived, such as a zoning district found by overlaying
    # a lot polygon on a zoning map. They apply to every fact of the record.
    method: str = "public_record"
    confidence: float | None = None


@dataclass
class ParcelValues:
    """One earlier tax year's values for a parcel the registry already holds (``Registry.ingest_value_history``).

    Carries nothing but the figures of the value history: no owner, address, area or building facts.
    """

    county_fips: str
    apn: str
    tax_year: int | None
    market_value: float | None = None
    appraised_value: float | None = None
    locator: str | None = None


@dataclass
class BuildingFacts:
    """Facts about a building subject, from a source that is not an appraisal roll (SEC CMBS loan data).

    ``urn`` is the deterministic building ID of the address (``fl:building:us-<SSCCC>:<zip5>:<street>``);
    the subject is created if the roll-up has not (a building the roll-up never made has no parcels).
    ``facts`` is a list of ``(predicate, value, unit)``; empty and null values are skipped.
    """

    urn: str
    label: str | None
    facts: list[tuple[str, Any, str | None]]
    locator: str | None = None
    method: str = "public_record"
    confidence: float | None = None


@dataclass
class EntityParent:
    """A registrant's statement that it has a subsidiary (SEC Exhibit 21), matched to a registered entity.

    ``parent_cik`` is the registrant's SEC CIK (its entity ID is ``fl:entity:us-sec:<cik>``);
    ``subsidiary_urn`` is the registry entity the subsidiary's name and jurisdiction matched. The link is
    an inference: ``confidence`` and ``basis`` say how strong and why, ``locator`` names the exhibit line.
    """

    parent_name: str
    parent_cik: str
    parent_state: str | None
    subsidiary_urn: str
    confidence: float
    basis: str
    value: dict[str, Any]
    locator: str | None = None


@dataclass
class EntityRecord:
    """A registered business entity (e.g. from franchise-tax or Secretary of State data)."""

    legal_name: str
    registry_jurisdiction: str  # e.g. "us-tx"
    registry_number: str | None  # Secretary of State file number
    taxpayer_number: str | None = None
    state_of_formation: str | None = None
    mailing_address: str | None = None
    status: str | None = None
    locator: str | None = None


@dataclass
class IngestStats:
    seen: int = 0
    kept: int = 0
    skipped_out_of_scope: int = 0
    skipped_invalid: int = 0
    owners_person_or_withheld: int = 0
    facts_written: int = 0
    retired: int = 0
    errors: list[str] = field(default_factory=list)
    source_id: str | None = None  # the registry source the file was loaded under (``ingest_roll``)
    tax_year: int | None = None  # the roll's tax year (``ingest_roll``)


def file_document_id(path: str | Path) -> tuple[str, int]:
    """Content-addressed FactLot document ID of a (possibly large) file, streamed."""
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            size += len(chunk)
    return f"fl:document:sha256-{h.hexdigest()}", size


# An ownership link is current only when it was inferred from the owner-of-record fact the parcel's record
# shows: the newest current one (latest as_of, then lowest fact ID, as ``Registry.facts`` keeps it). A district
# that loads one source per roll year keeps every year's owner fact current; the older years' links are owner
# history, not current owners (CURRENT_LINK in packages/tools/src/registry.ts).
_CURRENT_LINK = (
    "(r.type != 'owns' OR r.document_id = (SELECT cf.document_id FROM current_facts cf WHERE cf.subject = r.to_urn "
    "AND cf.predicate = 'ownership.owner_of_record' ORDER BY cf.as_of DESC, cf.fact_id LIMIT 1))"
)


# Facts current on a date: the coverage rule of the ``current_facts`` view applied to the snapshots
# dated on or before it (FACTS_AT in packages/tools/src/registry.ts).
_FACTS_AT = (
    "SELECT f.* FROM facts f JOIN snapshots s ON s.document_id = f.document_id WHERE f.subject = ? "
    "AND f.as_of <= ? AND f.as_of = (SELECT MAX(c.as_of) FROM coverage c WHERE c.subject = f.subject "
    "AND c.source_id = s.source_id AND c.as_of <= ?)"
)
_ORDER_FACTS = " ORDER BY predicate, as_of DESC, fact_id"
# An ownership link on a date: made by then, from the owner-of-record fact the record shows on that date (the
# newest of those current then, as ``Registry.facts`` keeps it with ``as_of``; LINK_AT in TypeScript).
_LINK_AT = (
    "r.as_of <= ? AND (r.type != 'owns' OR r.document_id = (SELECT f.document_id FROM facts f JOIN snapshots s ON "
    "s.document_id = f.document_id WHERE f.subject = r.to_urn AND f.predicate = 'ownership.owner_of_record' "
    "AND f.as_of <= ? AND f.as_of = (SELECT MAX(c.as_of) FROM coverage c "
    "WHERE c.subject = f.subject AND c.source_id = s.source_id AND c.as_of <= ?) "
    "ORDER BY f.as_of DESC, f.fact_id LIMIT 1))"
)
# Mailing-address predicates: stored without the contact names in them that are not organisations
# (``normalize.scrub_mailing_address``).
MAILING_PREDICATES = ("ownership.owner_mailing_address", "entity.mailing_address")
# Recorded documents whose value lists their organisation parties by role (adapters/ny_acris.py), and the roles.
# A withheld party leaves ``<role>_withheld``: ``{"count": n, "kinds": [...]}``, never a name.
PARTY_LIST_PREDICATES = ("transaction.deed", "debt.mortgage_recorded", "debt.mortgage_satisfaction_recorded")
PARTY_ROLES = ("grantors", "grantees", "borrowers", "lenders")


def withhold_parties(value: dict[str, Any]) -> tuple[dict[str, Any], int, int]:
    """A document value with every party ``organization_part`` rejects taken out of its role lists.

    A rejected name is removed and counted in ``<role>_withheld`` (``{"count", "kinds"}``, merged with any count
    already there); a "<company> LLC <person> REV TR" string is replaced by its leading company when nothing of the
    person's name remains, and counted too. A role left with no name loses its list (and its ``_truncated`` flag); the
    document's date, type, amount and IDs stay. Returns the value, the names withheld whole and the names cut."""
    out = dict(value)
    withheld = cut = 0
    for role in PARTY_ROLES:
        names = out.get(role)
        if not isinstance(names, list):
            continue
        kept: list[Any] = []
        kinds: Counter = Counter()
        for n in names:
            stored, kind = organization_part(n) if isinstance(n, str) else (None, "person")
            if kind is not None:
                kinds[kind] += 1
            if stored is None:
                withheld += 1
            elif stored != n:
                cut += 1
            if stored is not None and stored not in kept:
                kept.append(stored)
        if not kinds:
            continue
        prior = out.get(role + "_withheld") if isinstance(out.get(role + "_withheld"), dict) else {}
        out[role + "_withheld"] = {"count": int(prior.get("count") or 0) + sum(kinds.values()),
                                   "kinds": sorted(set(prior.get("kinds") or []) | set(kinds))}
        if kept:
            out[role] = kept
        else:
            out.pop(role, None)
            out.pop(role + "_truncated", None)
    return out, withheld, cut
# Floor-area ratio (improvement area ÷ land area) above which ``get`` warns (MAX_PLAUSIBLE_FAR in TypeScript).
MAX_PLAUSIBLE_FAR = 40


def _area_value(facts: list[dict[str, Any]], predicate: str) -> float | None:
    v = next((f["value"] for f in facts if f["predicate"] == predicate), None)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None


def area_warnings(facts: list[dict[str, Any]]) -> list[str]:
    """Sanity checks on a parcel's area facts (``areaWarnings`` in TypeScript); the facts stay as published."""
    land = _area_value(facts, "parcel.land_area_sf")
    building = _area_value(facts, "parcel.improvement_area_sf")
    out = []
    if land is not None and land <= 0:
        out.append(f"parcel.land_area_sf is {fmt_num(land)}: a land area must be positive, so the source's value "
                   "is not usable")
    if building is not None and building < 0:
        out.append(f"parcel.improvement_area_sf is {fmt_num(building)}: a building area cannot be negative, so the "
                   "source's value is not usable")
    if land is not None and building is not None and land > 0 and building > 0 and building / land > MAX_PLAUSIBLE_FAR:
        out.append(f"parcel.improvement_area_sf ({fmt_num(building)} sf) is {fmt_num(building / land, 1)} times "
                   f"parcel.land_area_sf ({fmt_num(land)} sf), a floor-area ratio above {MAX_PLAUSIBLE_FAR}, which few "
                   "buildings anywhere reach: one of the two areas is probably not this parcel's own (a "
                   "condominium unit's record, for example, can carry the whole building's area against the unit's "
                   "share of the land); check the source before using either")
    return out


def _improved_siblings(db: sqlite3.Connection, building_urn: str, parcel_urn: str) -> list[str]:
    """Parcels of a building, other than ``parcel_urn``, whose current facts include improvement facts (at most 5)."""
    return [r[0] for r in db.execute(
        "SELECT DISTINCT m.parcel_urn AS urn FROM building_members m JOIN current_facts f ON f.subject = m.parcel_urn "
        "WHERE m.building_urn = ? AND m.parcel_urn <> ? AND (f.predicate = 'parcel.year_built' OR "
        "(f.predicate = 'parcel.improvement_area_sf' AND CAST(f.value_json AS REAL) > 0)) ORDER BY m.parcel_urn LIMIT 5",
        (building_urn, parcel_urn))]


def improvement_warnings(facts: list[dict[str, Any]], building: dict[str, Any] | None,
                         siblings: list[str]) -> list[str]:
    """A warning when a parcel record carries no improvement facts (``improvementWarnings`` in TypeScript).

    Its values may be for the land only. ``siblings`` are parcels of its building that do carry them, where
    the improvements are probably assessed (a land account and a separate improvement account at one
    address, for example).
    """
    if not facts:
        return []
    improved = any((f["predicate"] == "parcel.year_built" and _area_value([f], "parcel.year_built") is not None)
                   or (f["predicate"] == "parcel.improvement_area_sf"
                       and (_area_value([f], "parcel.improvement_area_sf") or 0) > 0) for f in facts)
    if improved:
        return []
    base = ("This parcel record has no improvement facts (parcel.improvement_area_sf, parcel.year_built), so its "
            "values may be for the land only")
    if building and siblings:
        one = len(siblings) == 1
        return [f"{base}. {'Another parcel' if one else 'Other parcels'} of building {building['urn']} at the same "
                f"address {'has' if one else 'have'} them: {', '.join(siblings)}. The building is probably assessed "
                f"on {'that account' if one else 'those accounts'}; get {'it' if one else 'them'} for the building's "
                "area, age and value."]
    return [f"{base}: it may be vacant land, the source may not publish building facts for it, or the building may "
            "be assessed on another account."]


# The recorded sales and documents (RECORDED_PREDICATES and RECORDED_FACTS_LIMIT in TypeScript): a record keeps the
# newest RECORDED_FACTS_LIMIT of them; registry_recorded_facts reads the rest.
RECORDED_PREDICATES = ("transaction.sale", "transaction.deed", "debt.mortgage_recorded",
                       "debt.mortgage_satisfaction_recorded")
RECORDED_FACTS_LIMIT = 50


def _year_of(f: dict[str, Any]) -> int | None:
    d = f["value"].get("date") if isinstance(f["value"], dict) else None
    m = re.match(r"(\d{4})", d) if isinstance(d, str) else None
    return int(m[1]) if m else None


def _year_span(facts: list[dict[str, Any]]) -> dict[str, int]:
    years = [y for y in map(_year_of, facts) if y is not None]
    return {"from_year": min(years), "to_year": max(years)} if years else {}


def capped_recorded_facts(facts: list[dict[str, Any]], limit: int = RECORDED_FACTS_LIMIT
                          ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Facts (newest first) with only the first ``limit`` recorded facts kept in their places, and the summary of
    what was left out, or ``None`` when nothing was (``capRecordedFacts`` in TypeScript)."""
    kept: list[dict[str, Any]] = []
    left: list[dict[str, Any]] = []
    n = 0
    for f in facts:
        if f["predicate"] not in RECORDED_PREDICATES:
            kept.append(f)
        elif n < limit:
            kept.append(f)
            n += 1
        else:
            left.append(f)
    if not left:
        return facts, None
    by_predicate: dict[str, Any] = {}
    for p in RECORDED_PREDICATES:
        total = sum(1 for f in facts if f["predicate"] == p)
        if not total:
            continue
        out = [f for f in left if f["predicate"] == p]
        by_predicate[p] = {"kept": total - len(out), "total": total, **_year_span(out)}
    return kept, {"limit": limit, "kept": n, "total": n + len(left), **_year_span(left),
                  "by_predicate": by_predicate, "rest": "registry_recorded_facts"}


# registry_recorded_facts (RECORDED_PAGE_MAX and friends in TypeScript).
RECORDED_PAGE_MAX = 100
RECORDED_PAGE_DEFAULT = 50
RECORDED_CURSOR_HELP = "expected the next_cursor of an earlier registry_recorded_facts answer for this parcel"
_CURSOR = re.compile(r"\d{1,9}(\.\d{1,9}){3}")


def parse_recorded_cursor(cursor: str | None, totals: dict[str, int]) -> list[int] | None:
    """The offsets a cursor holds (one per RECORDED_PREDICATES entry), or ``None`` when it is not one for these totals."""
    if cursor is None:
        return [0] * len(RECORDED_PREDICATES)
    if not _CURSOR.fullmatch(cursor):
        return None
    offsets = [int(x) for x in cursor.split(".")]
    return offsets if all(o <= totals.get(p, 0) for o, p in zip(offsets, RECORDED_PREDICATES)) else None


def _recorded_key(f: dict[str, Any]) -> tuple[str, float, str]:
    v = f["value"] if isinstance(f["value"], dict) else {}
    price = v.get("price_usd", v.get("current_balance_usd"))
    return (str(v.get("date") or v.get("reporting_period_end") or ""),
            float(price) if isinstance(price, (int, float)) and not isinstance(price, bool) else -1.0, f["id"])


def recorded_page(urn: str, predicate: str | None, totals: dict[str, int], offsets: list[int],
                  slices: dict[str, list[dict[str, Any]]], limit: int) -> dict[str, Any]:
    """One page of registry_recorded_facts (``recordedPage`` in TypeScript): the slices from the cursor's offsets,
    merged newest first."""
    wanted = [predicate is None or p == predicate for p in RECORDED_PREDICATES]
    at, used, facts = list(offsets), [0] * len(RECORDED_PREDICATES), []
    while len(facts) < limit:
        best = -1
        for i, p in enumerate(RECORDED_PREDICATES):
            lst = slices.get(p, [])
            if not wanted[i] or used[i] >= len(lst):
                continue
            if best < 0 or _recorded_key(lst[used[i]]) > _recorded_key(
                    slices[RECORDED_PREDICATES[best]][used[best]]):
                best = i
        if best < 0:
            break
        facts.append(slices[RECORDED_PREDICATES[best]][used[best]])
        used[best] += 1
        at[best] += 1
    more = any(wanted[i] and at[i] < totals.get(p, 0) for i, p in enumerate(RECORDED_PREDICATES))
    return {
        "urn": urn,
        "predicate": predicate,
        "totals": {p: totals[p] for p in RECORDED_PREDICATES if totals.get(p)},
        "total": sum(totals.get(p, 0) for i, p in enumerate(RECORDED_PREDICATES) if wanted[i]),
        "facts": facts,
        "next_cursor": ".".join(map(str, at)) if more else None,
    }


def _newest_first(facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Order the facts of a many-valued predicate (sales) newest first, in the slots they occupy."""
    slots = [i for i, f in enumerate(facts) if f["predicate"] in MULTI_VALUED_PREDICATES]
    if len(slots) > 1:
        def key(f: dict[str, Any]) -> tuple[str, float, str]:
            v = f["value"] if isinstance(f["value"], dict) else {}
            price = v.get("price_usd", v.get("current_balance_usd"))
            return (str(v.get("date") or v.get("reporting_period_end") or ""),
                    float(price) if isinstance(price, (int, float)) else -1.0, f["id"])
        ordered = sorted((facts[i] for i in slots), key=key, reverse=True)
        for i, f in zip(slots, ordered):
            facts[i] = f
    return facts


# Value history (Registry.value_history; VALUE_HISTORY_IN and ORDER_VALUE_HISTORY in TypeScript).
_VALUE_HISTORY_IN = "'parcel.tax_year', 'parcel.market_value', 'parcel.appraised_value'"
_ORDER_VALUE_HISTORY = " ORDER BY as_of DESC, document_id, predicate, fact_id"


def fact_citation(row: Any) -> dict[str, Any]:
    """The citation of one stored fact row: what a reader needs to find it in its source (``factCitation`` in TS)."""
    return {"fact_id": row["fact_id"], "document_id": row["document_id"], "locator": row["locator"], "as_of": row["as_of"]}


def _number(v: Any) -> float | None:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None


def value_history_entries(rows: Iterable[Any]) -> list[dict[str, Any]]:
    """Value-history entries from fact rows ordered by ``_ORDER_VALUE_HISTORY`` (``valueHistoryEntries`` in TS).

    The rows of one snapshot make one entry; where a snapshot holds two facts for one predicate (a file that
    lists a parcel twice) the first in that order is used.
    """
    by_doc: dict[str, dict[str, Any]] = {}
    for r in rows:
        by_doc.setdefault(r["document_id"], {}).setdefault(r["predicate"], r)
    kept: list[dict[str, Any]] = []
    for doc in by_doc.values():
        market, appraised, year = doc.get("parcel.market_value"), doc.get("parcel.appraised_value"), doc.get("parcel.tax_year")
        mv = _number(json.loads(market["value_json"])) if market else None
        av = _number(json.loads(appraised["value_json"])) if appraised else None
        if mv is None and av is None:
            continue
        ty = _number(json.loads(year["value_json"])) if year else None
        if any(e["tax_year"] == ty and e["market_value"] == mv and e["appraised_value"] == av for e in kept):
            continue  # restated unchanged: the newer snapshot's entry stands
        first = market if mv is not None else appraised
        kept.append({
            "tax_year": ty, "market_value": mv, "appraised_value": av, "as_of": first["as_of"],
            "citations": {"market_value": fact_citation(market) if mv is not None else None,
                          "appraised_value": fact_citation(appraised) if av is not None else None},
        })
    # Snapshots are newest first already; a stable sort by tax year keeps that order within a year.
    return sorted(kept, key=lambda e: (e["tax_year"] is None, -(e["tax_year"] or 0)))


def _fact_id(subject: str, predicate: str, value_json: str, document_id: str) -> str:
    digest = hashlib.sha256("\x1f".join((subject, predicate, value_json, document_id)).encode()).digest()
    return f"flf_{_base32(digest, 24)}"


class Registry:
    def __init__(self, path: str | Path = ":memory:") -> None:
        self.db = sqlite3.connect(str(path))
        self.db.row_factory = sqlite3.Row
        # Every statement in schema.sql is IF NOT EXISTS, so opening an older file adds the newer
        # tables without touching existing ones; the version records which tables to expect.
        self._written: set[str] = set()  # fact IDs the parcel being ingested produced (see ingest_parcels)
        self._tracking = False
        self.db.executescript(resources.files("factlot.registry").joinpath("schema.sql").read_text("utf-8"))
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('schema_version', ?)", (SCHEMA_VERSION,))
        # A file with no name keys yet is keyed by the current rules from the start; a file built
        # before name_key_version existed keeps reading as version 1 until ``rebuild_name_index``.
        if not self.db.execute("SELECT 1 FROM name_index LIMIT 1").fetchone():
            self.db.execute("INSERT OR IGNORE INTO meta VALUES ('name_key_version', ?)", (NAME_KEY_VERSION,))
        # The same for address keys (``rebuild_address_index`` re-keys an older file).
        if not self.db.execute("SELECT 1 FROM address_index LIMIT 1").fetchone():
            self.db.execute("INSERT OR IGNORE INTO meta VALUES ('address_key_version', ?)", (ADDRESS_KEY_VERSION,))
        if not self.db.execute("SELECT 1 FROM subjects WHERE kind = 'parcel' LIMIT 1").fetchone():
            self.db.execute("INSERT OR IGNORE INTO meta VALUES ('parcel_rule', ?)", (PARCEL_RULE,))
        self.db.commit()

    def parcel_urn(self, state_fips: str, county_fips: str, apn: str) -> str:
        """The parcel URN for an APN under the parcel rule this file was built with (see ``PARCEL_RULE``)."""
        rule_1 = getattr(self, "_parcel_rule_1", None)
        if rule_1 is None:
            row = self.db.execute("SELECT value FROM meta WHERE key = 'parcel_rule'").fetchone()
            rule_1 = self._parcel_rule_1 = not (row and row[0] == PARCEL_RULE)
        return parcel_id(state_fips, county_fips, apn, normalize_apn_v1 if rule_1 else None).urn

    def _address_search_keys(self, address: str) -> list[str]:
        """Keys to search for ``address``: the current key, and on a file not yet re-keyed the version 1 key too."""
        row = self.db.execute("SELECT value FROM meta WHERE key = 'address_key_version'").fetchone()
        keys = [normalize_address(address)]
        if not (row and row[0] == ADDRESS_KEY_VERSION) and legacy_address_key(address) not in keys:
            keys.append(legacy_address_key(address))
        return keys

    def coverage(self) -> dict[str, Any]:
        """What this file holds (``factlot.registry.coverage``), recomputed only after the file changes."""
        stamp = _coverage.stamp(self.db)
        cached = getattr(self, "_coverage_cache", None)
        if cached is None or cached[0] != stamp:
            cached = self._coverage_cache = (stamp, _coverage.stored_or_compute(self.db))
        return cached[1]

    def _name_search_key(self, name: str) -> str:
        """The key ``name`` has under the rules this file's name index was built with."""
        row = self.db.execute("SELECT value FROM meta WHERE key = 'name_key_version'").fetchone()
        return normalize_name(name) if row and row[0] == NAME_KEY_VERSION else legacy_name_key(name)

    @classmethod
    def open_readonly(cls, path: str | Path) -> "Registry":
        """Open an existing registry file for queries only (as the agent tools do)."""
        if not Path(path).exists():
            raise FileNotFoundError(f"no registry file at {path}")
        reg = cls.__new__(cls)
        # as_uri() percent-encodes the path, so a "?" or "#" in it cannot add URI parameters.
        reg.db = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True)
        reg.db.row_factory = sqlite3.Row
        return reg

    def close(self) -> None:
        self.db.close()

    # --- sources & snapshots ------------------------------------------------------------------

    def add_source(self, s: Source) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (s.source_id, s.publisher, s.title, s.url, s.state_fips, s.county_fips, s.license,
             s.ai_use, s.redistribution, s.attribution, s.terms_reviewed),
        )
        self.db.commit()

    def add_snapshot(self, source_id: str, path: str | Path, as_of: str, retrieved_at: str | None = None) -> Snapshot:
        """Register a downloaded file; its SHA-256 becomes the citation for every fact derived from it."""
        doc, size = file_document_id(path)
        snap = Snapshot(
            document_id=doc,
            source_id=source_id,
            retrieved_at=retrieved_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
            as_of=as_of,
            filename=Path(path).name,
            bytes=size,
        )
        self.db.execute(
            "INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?,?,?)",
            (snap.document_id, snap.source_id, snap.retrieved_at, snap.as_of, snap.filename, snap.bytes),
        )
        self.db.commit()
        row = self.db.execute("SELECT * FROM snapshots WHERE document_id = ?", (doc,)).fetchone()
        return Snapshot(**{k: row[k] for k in row.keys()})

    # --- writing ------------------------------------------------------------------------------

    def _subject(self, urn: str, kind: str, label: str | None) -> None:
        self.db.execute(
            "INSERT INTO subjects VALUES (?,?,?,?) ON CONFLICT(urn) DO UPDATE SET label = COALESCE(excluded.label, label)",
            (urn, kind, short_id(urn), label),
        )

    def _fact(self, subject: str, predicate: str, value: Any, snap: Snapshot, *, unit: str | None = None,
              method: str = "public_record", confidence: float | None = None, locator: str | None = None) -> int:
        if predicate in MAILING_PREDICATES and isinstance(value, str):
            value, _ = scrub_mailing_address(value)  # no natural person's name on a stored address (policy §3)
        if value is None or value == "":
            return 0
        value_json = json.dumps(value, sort_keys=True)
        fact_id = _fact_id(subject, predicate, value_json, snap.document_id)
        if self._tracking:
            self._written.add(fact_id)
        cur = self.db.execute(
            "INSERT OR IGNORE INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)",
            (fact_id, subject, predicate, value_json, unit, snap.as_of, method, confidence, snap.document_id, locator),
        )
        return cur.rowcount

    def _drop_stale(self, urn: str, snap: Snapshot, old_ids: set[str] | None) -> None:
        """Delete facts a previous ingest of this document wrote for ``urn`` that this run did not write."""
        if not old_ids:
            return
        for fact_id in old_ids - self._written:
            predicate = self.db.execute("SELECT predicate FROM facts WHERE fact_id = ?", (fact_id,)).fetchone()
            self.db.execute("DELETE FROM facts WHERE fact_id = ?", (fact_id,))
            if predicate and predicate[0] == "ownership.owner_of_record":
                self.db.execute("DELETE FROM relationships WHERE to_urn = ? AND type = 'owns' AND document_id = ?",
                                (urn, snap.document_id))

    def _cover(self, subject: str, snap: Snapshot, present: int = 1) -> None:
        self.db.execute("INSERT OR REPLACE INTO coverage VALUES (?,?,?,?,?)",
                        (subject, snap.source_id, snap.as_of, snap.document_id, present))

    def ingest_entities(self, records: Iterable[EntityRecord], snap: Snapshot) -> IngestStats:
        stats = IngestStats()
        for r in records:
            stats.seen += 1
            if not r.registry_number or not r.legal_name.strip():
                stats.skipped_invalid += 1
                continue
            try:
                urn = entity_id(r.registry_jurisdiction, r.registry_number).urn
            except FactLotIdError as e:
                stats.skipped_invalid += 1
                stats.errors.append(f"{r.locator or r.legal_name}: {e}")
                continue
            stats.kept += 1
            self._subject(urn, "entity", r.legal_name.strip())
            self._cover(urn, snap)
            loc = r.locator
            n = self._fact(urn, "entity.legal_name", r.legal_name.strip(), snap, locator=loc)
            n += self._fact(urn, "entity.registry_number", r.registry_number, snap, locator=loc)
            n += self._fact(urn, "entity.state_of_formation", r.state_of_formation, snap, locator=loc)
            if not personal_style_organization(r.legal_name):  # likely a home address (policy section 3)
                n += self._fact(urn, "entity.mailing_address", r.mailing_address, snap, locator=loc)
            n += self._fact(urn, "entity.status", r.status, snap, locator=loc)
            stats.facts_written += n
            if r.taxpayer_number:
                self.db.execute("INSERT OR REPLACE INTO crosswalk VALUES (?,?,?)",
                                (f"{r.registry_jurisdiction}-taxpayer", r.taxpayer_number, urn))
            key = normalize_name(r.legal_name)
            self.db.execute("INSERT OR IGNORE INTO name_index VALUES (?,?)", (key, urn))
            self._index_name_tokens(key, urn)
        self.db.commit()
        return stats

    def _unindex_name_tokens(self, key: str, urn: str) -> None:
        """Remove the token rows of one name key, by primary key (``name_tokens`` has no index on the entity)."""
        self.db.executemany("DELETE FROM name_tokens WHERE token = ? AND urn = ? AND key = ?",
                            [(t, urn, key) for t in distinctive_tokens(key)])

    def _index_name_tokens(self, key: str, urn: str) -> None:
        self.db.executemany("INSERT OR IGNORE INTO name_tokens VALUES (?,?,?)",
                            [(t, urn, key) for t in distinctive_tokens(key)])

    def rebuild_name_tokens(self) -> int:
        """(Re)build the fuzzy-match token index from name_index; returns the number of entity names indexed.

        Needed once for a registry file built before schema version 2; ingest_entities keeps it current.
        """
        self.db.execute("DELETE FROM name_tokens")
        n = 0
        rows = self.db.execute(
            "SELECT n.key, n.urn FROM name_index n JOIN subjects s ON s.urn = n.urn WHERE s.kind = 'entity'").fetchall()
        for row in rows:
            self._index_name_tokens(row["key"], row["urn"])
            n += 1
        self.db.commit()
        return n

    def rebuild_name_index(self) -> dict[str, int]:
        """Re-key the entity name index after a change to ``normalize_name``; idempotent.

        A stored key is rewritten only when it is exactly what the previous normalization made of
        the entity's current legal name, so keys from an entity's earlier names are left as they
        are. Token-index rows follow. Returns ``{"scanned": …, "rekeyed": …}``; run
        ``rebuild_review_keys`` afterwards on a registry with a review queue.
        """
        # One sequential pass over the entities, then a point lookup only for those whose key changed.
        changed: list[tuple[str, str, str]] = []
        scanned = 0
        for row in self.db.execute("SELECT urn, label FROM subjects WHERE kind = 'entity' AND label IS NOT NULL"):
            scanned += 1
            new, old = normalize_name(row["label"]), legacy_name_key(row["label"])
            if new != old:
                changed.append((old, new, row["urn"]))
        has_tokens = self._has_table("name_tokens")
        rekeyed = 0
        for old, new, urn in changed:
            if self.db.execute("DELETE FROM name_index WHERE key = ? AND urn = ?", (old, urn)).rowcount:
                rekeyed += 1
                self.db.execute("INSERT OR IGNORE INTO name_index VALUES (?,?)", (new, urn))
                if has_tokens:
                    self._unindex_name_tokens(old, urn)
                    self._index_name_tokens(new, urn)
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('name_key_version', ?)", (NAME_KEY_VERSION,))
        self.db.commit()
        return {"scanned": scanned, "rekeyed": rekeyed}

    def rebuild_address_index(self) -> dict[str, int]:
        """Re-key the address index from every situs address the file holds (current and earlier); idempotent.

        Every address key comes from a ``parcel.situs_address`` fact, so the index is rebuilt from
        those facts under the current ``normalize_address`` and the file is marked with the current
        ``address_key_version``. Returns ``{"addresses": …, "keys": …}``.
        """
        self.db.execute("DELETE FROM address_index")
        n = 0
        for row in self.db.execute("SELECT DISTINCT subject, value_json FROM facts WHERE predicate = 'parcel.situs_address'").fetchall():
            value = json.loads(row["value_json"])
            if isinstance(value, str) and value.strip():
                self.db.execute("INSERT OR IGNORE INTO address_index VALUES (?,?)", (normalize_address(value), row["subject"]))
                n += 1
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('address_key_version', ?)", (ADDRESS_KEY_VERSION,))
        self.db.commit()
        keys = self.db.execute("SELECT COUNT(*) FROM address_index").fetchone()[0]
        return {"addresses": n, "keys": keys}

    def rollup_buildings(self) -> dict[str, Any]:
        """Group the parcels of one building under a building subject (``factlot.registry.buildings``); idempotent."""
        result = _buildings.rollup(self.db)
        self.db.commit()
        return result

    def refresh_coverage(self) -> dict[str, Any]:
        """Store the coverage summary in ``meta.coverage`` so readers need not compute it; run after any change."""
        summary = _coverage.compute(self.db)
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('coverage', ?)",
                        (json.dumps({"stamp": _coverage.stamp(self.db), "summary": summary}),))
        self.db.commit()
        self._coverage_cache = (_coverage.stamp(self.db), summary)
        return dict(summary["totals"])

    def rewrite_entity_names(self, source_id: str, clean: Callable[[str], str]) -> dict[str, int]:
        """Re-derive entity legal names after an adapter fix, in place; idempotent.

        ``clean`` maps a stored legal name to the name the fixed adapter now writes. For every
        entity of the source whose name changes, the ``entity.legal_name`` fact is rewritten (same
        document and locator; the fact ID follows its value), the subject's label, and its keys in
        the name and token indexes. Ingesting the same snapshot again with the fixed adapter then
        adds nothing. Run ``link_owners`` afterwards.
        """
        changes: list[tuple[str, str, str, str, str]] = []
        for r in self.db.execute(
                "SELECT f.fact_id, f.subject, f.value_json, f.document_id FROM facts f "
                "JOIN snapshots s ON s.document_id = f.document_id "
                "WHERE s.source_id = ? AND f.predicate = 'entity.legal_name'", (source_id,)):
            old = json.loads(r["value_json"])
            new = clean(old) if isinstance(old, str) else old
            if isinstance(new, str) and new and new != old:
                changes.append((r["fact_id"], r["subject"], old, new, r["document_id"]))
        merged = 0
        has_tokens = self._has_table("name_tokens")
        for fact_id, urn, old, new, doc in changes:
            value_json = json.dumps(new, sort_keys=True)
            cur = self.db.execute("UPDATE OR IGNORE facts SET value_json = ?, fact_id = ? WHERE fact_id = ?",
                                  (value_json, _fact_id(urn, "entity.legal_name", value_json, doc), fact_id))
            if cur.rowcount == 0:  # the cleaned fact is already there
                self.db.execute("DELETE FROM facts WHERE fact_id = ?", (fact_id,))
                merged += 1
            self.db.execute("UPDATE subjects SET label = ? WHERE urn = ? AND label = ?", (new, urn, old))
            old_keys = {normalize_name(old), legacy_name_key(old)} - {normalize_name(new)}
            for key in old_keys:
                self.db.execute("DELETE FROM name_index WHERE key = ? AND urn = ?", (key, urn))
                if has_tokens:
                    self._unindex_name_tokens(key, urn)
            self.db.execute("INSERT OR IGNORE INTO name_index VALUES (?,?)", (normalize_name(new), urn))
            if has_tokens:
                self._index_name_tokens(normalize_name(new), urn)
        self.db.commit()
        return {"rewritten": len(changes), "already_present": merged}

    def rebuild_review_keys(self) -> dict[str, int]:
        """Recompute ``owner_key`` of every review row from its owner name after a normalization change.

        A pending row whose new key collides with an existing row for the same entity is dropped
        (the pair is already queued under that key); a decided row is never dropped.
        """
        moved = dropped = 0
        for row in self.db.execute("SELECT review_id, owner_name, owner_key, entity_urn, status FROM owner_match_review").fetchall():
            new = normalize_name(row["owner_name"])
            if new == row["owner_key"]:
                continue
            clash = self.db.execute("SELECT 1 FROM owner_match_review WHERE owner_key = ? AND entity_urn = ?",
                                    (new, row["entity_urn"])).fetchone()
            if clash:
                if row["status"] == "pending":
                    self.db.execute("DELETE FROM owner_match_review WHERE review_id = ?", (row["review_id"],))
                    dropped += 1
                continue
            self.db.execute("UPDATE owner_match_review SET owner_key = ? WHERE review_id = ?", (new, row["review_id"]))
            moved += 1
        self.db.commit()
        return {"rekeyed": moved, "dropped_duplicates": dropped}

    def ingest_roll(self, source: Source, snapshot_path: str | Path, records: Iterable[ParcelRecord], *, as_of: str,
                    retrieved_at: str | None = None, state_fips: str, account_system: str | None = None,
                    full_roll: bool = False, base_year: int = ROLL_BASE_TAX_YEAR) -> IngestStats:
        """Register an appraisal-roll file under the source for its tax year (``roll_source``) and ingest it.

        The file's tax year is the one most of its records state; ``stats.source_id`` names the source used.
        """
        year, recs = roll_tax_year(records)
        src = roll_source(source, year, base_year)
        self.add_source(src)
        snap = self.add_snapshot(src.source_id, snapshot_path, as_of, retrieved_at)
        stats = self.ingest_parcels(recs, snap, state_fips=state_fips, account_system=account_system, full_roll=full_roll)
        stats.source_id, stats.tax_year = src.source_id, year
        return stats

    def ingest_parcels(self, records: Iterable[ParcelRecord], snap: Snapshot, *, state_fips: str,
                       account_system: str | None = None, include_all_categories: bool = False,
                       full_roll: bool = False) -> IngestStats:
        """Ingest appraisal-roll records. Out-of-scope (non-commercial) parcels are skipped by default.

        With ``full_roll=True`` the snapshot is treated as the complete roll for its source: parcels
        an earlier snapshot of the same source covered but this one does not list (or lists as out of
        scope — sold, split, merged, reclassified) are retired, so their facts become history.
        """
        stats = IngestStats()
        replaced: set[str] = set()
        self._tracking = True
        try:
            return self._ingest_parcels(records, snap, stats, replaced, state_fips, account_system,
                                        include_all_categories, full_roll)
        finally:
            self._tracking = False

    def _ingest_parcels(self, records: Iterable[ParcelRecord], snap: Snapshot, stats: IngestStats, replaced: set[str],
                        state_fips: str, account_system: str | None, include_all_categories: bool,
                        full_roll: bool) -> IngestStats:
        for r in records:
            stats.seen += 1
            if not include_all_categories and not is_commercial(r.state_category):
                stats.skipped_out_of_scope += 1
                continue
            try:
                urn = self.parcel_urn(state_fips, r.county_fips, r.apn)
            except FactLotIdError as e:
                stats.skipped_invalid += 1
                stats.errors.append(f"{r.locator or r.apn}: {e}")
                continue
            stats.kept += 1
            # Re-ingesting a snapshot makes the registry hold what the adapter yields now: facts an earlier
            # run wrote for this parcel from this document that the adapter no longer yields are dropped
            # (with the links derived from a dropped owner), so an adapter fix does not leave the old
            # values beside the new ones. Identical facts are untouched, so re-ingesting an unchanged
            # file writes nothing. A parcel a file lists twice keeps the facts of both rows.
            old_ids: set[str] | None = None
            if urn not in replaced:
                replaced.add(urn)
                old_ids = {row[0] for row in self.db.execute(
                    "SELECT fact_id FROM facts WHERE subject = ? AND document_id = ?", (urn, snap.document_id))}
                self._written = set()
            loc = r.locator or (f"account {r.account}" if r.account else f"apn {r.apn}")
            self._subject(urn, "parcel", r.situs_address)
            self._cover(urn, snap)
            n = self._fact(urn, "parcel.apn", r.apn, snap, locator=loc)
            n += self._fact(urn, "parcel.situs_address", r.situs_address, snap, locator=loc)
            n += self._fact(urn, "parcel.state_property_category", r.state_category, snap, locator=loc)
            n += self._fact(urn, "parcel.land_area_sf", r.land_area_sf, snap, unit="sf", locator=loc)
            n += self._fact(urn, "parcel.improvement_area_sf", r.improvement_area_sf, snap, unit="sf", locator=loc)
            n += self._fact(urn, "parcel.year_built", r.year_built, snap, locator=loc)
            n += self._fact(urn, "parcel.market_value", r.market_value, snap, unit="USD", locator=loc)
            n += self._fact(urn, "parcel.appraised_value", r.appraised_value, snap, unit="USD", locator=loc)
            n += self._fact(urn, "parcel.tax_year", r.tax_year, snap, locator=loc)
            n += self._fact(urn, "parcel.local_use_code", r.local_use_code, snap, locator=loc)
            for sale in r.sales:
                n += self._fact(urn, "transaction.sale", sale, snap, locator=loc)
            for predicate, value, unit in r.extra_facts:
                n += self._fact(urn, predicate, value, snap, unit=unit, locator=loc)
            if account_system and r.account:
                self.db.execute("INSERT OR REPLACE INTO crosswalk VALUES (?,?,?)", (account_system, r.account, urn))
            if r.situs_address:
                self.db.execute("INSERT OR IGNORE INTO address_index VALUES (?,?)", (normalize_address(r.situs_address), urn))

            # Owner of record — organisations only; persons and withheld owners are not stored (policy §3).
            if r.owner_confidential or not r.owner_name or not is_organization(r.owner_name):
                if r.owner_name or r.owner_confidential:
                    stats.owners_person_or_withheld += 1
                stats.facts_written += n
                self._drop_stale(urn, snap, old_ids)
                continue
            n += self._fact(urn, "ownership.owner_of_record", r.owner_name.strip(), snap, locator=loc)
            if not personal_style_organization(r.owner_name):  # likely a home address (policy section 3)
                n += self._fact(urn, "ownership.owner_mailing_address", r.owner_mailing_address, snap, locator=loc)
            stats.facts_written += n
            self._drop_stale(urn, snap, old_ids)
        if full_roll:
            stats.retired = self._retire_absent(snap)
        self.db.commit()
        return stats

    def ingest_value_history(self, records: Iterable[ParcelValues], snap: Snapshot, *, state_fips: str) -> IngestStats:
        """Add one earlier tax year's values to parcels the registry already holds, and nothing else.

        This is the safe path for a prior-year roll. It writes only ``parcel.tax_year``, ``parcel.market_value``
        and ``parcel.appraised_value`` facts, each citing ``snap``, and it never creates a subject, a crosswalk
        or search-index row, a relationship, or an owner, address, area or building fact, so an older roll cannot
        change the current record. It writes no ``coverage`` row either: a fact is current only through
        coverage (``current_facts``), so these stay history, and ``value_history`` reads them from ``facts``.
        A record whose parcel is not a registry parcel is counted in ``skipped_out_of_scope`` and dropped;
        one with no value is counted in ``skipped_invalid``. Re-ingesting a document makes the registry hold
        what the records yield now.
        """
        stats = IngestStats()
        replaced: set[str] = set()
        self._tracking = True
        try:
            for r in records:
                stats.seen += 1
                try:
                    urn = self.parcel_urn(state_fips, r.county_fips, r.apn)
                except FactLotIdError as e:
                    stats.skipped_invalid += 1
                    stats.errors.append(f"{r.locator or r.apn}: {e}")
                    continue
                if not self.db.execute("SELECT 1 FROM subjects WHERE urn = ? AND kind = 'parcel'", (urn,)).fetchone():
                    stats.skipped_out_of_scope += 1
                    continue
                if r.market_value is None and r.appraised_value is None:
                    stats.skipped_invalid += 1
                    continue
                stats.kept += 1
                old_ids: set[str] | None = None
                if urn not in replaced:
                    replaced.add(urn)
                    old_ids = {row[0] for row in self.db.execute(
                        "SELECT fact_id FROM facts WHERE subject = ? AND document_id = ?", (urn, snap.document_id))}
                    self._written = set()
                loc = r.locator or f"apn {r.apn}"
                n = self._fact(urn, "parcel.tax_year", r.tax_year, snap, locator=loc)
                n += self._fact(urn, "parcel.market_value", r.market_value, snap, unit="USD", locator=loc)
                n += self._fact(urn, "parcel.appraised_value", r.appraised_value, snap, unit="USD", locator=loc)
                stats.facts_written += n
                self._drop_stale(urn, snap, old_ids)
            self.db.commit()
            return stats
        finally:
            self._tracking = False

    def ingest_parcel_facts(self, records: Iterable[ParcelFacts], snap: Snapshot, *, state_fips: str,
                            full_roll: bool = False) -> IngestStats:
        """Add facts from a non-roll source (zoning, sales, ...) to parcels the registry already holds.

        A record whose parcel is not in the registry is counted in ``skipped_out_of_scope`` and
        dropped: the appraisal roll decides which parcels are in scope, and these sources do not
        widen it. Like ``ingest_parcels``, re-ingesting a document makes the registry hold what the
        records yield now, and ``full_roll=True`` retires parcels an earlier snapshot of this source
        covered that this one does not list.
        """
        stats = IngestStats()
        replaced: set[str] = set()
        self._tracking = True
        try:
            for r in records:
                stats.seen += 1
                try:
                    urn = self.parcel_urn(state_fips, r.county_fips, r.apn)
                except FactLotIdError as e:
                    stats.skipped_invalid += 1
                    stats.errors.append(f"{r.locator or r.apn}: {e}")
                    continue
                if not self.db.execute("SELECT 1 FROM subjects WHERE urn = ? AND kind = 'parcel'", (urn,)).fetchone():
                    stats.skipped_out_of_scope += 1
                    continue
                stats.kept += 1
                old_ids: set[str] | None = None
                if urn not in replaced:
                    replaced.add(urn)
                    old_ids = {row[0] for row in self.db.execute(
                        "SELECT fact_id FROM facts WHERE subject = ? AND document_id = ?", (urn, snap.document_id))}
                    self._written = set()
                loc = r.locator or f"apn {r.apn}"
                self._cover(urn, snap, COVERED_BY_ENRICHMENT)
                for predicate, value, unit in r.facts:
                    stats.facts_written += self._fact(urn, predicate, value, snap, unit=unit, method=r.method,
                                                       confidence=r.confidence, locator=loc)
                self._drop_stale(urn, snap, old_ids)
            if full_roll:
                stats.retired = self._retire_absent(snap)
            self.db.commit()
            return stats
        finally:
            self._tracking = False

    def ingest_building_facts(self, records: Iterable[BuildingFacts], snap: Snapshot, *,
                              full_roll: bool = False) -> IngestStats:
        """Add facts to building subjects (created here if the roll-up has not made them).

        One record per building, with all of the file's facts for it. Like the other ingests, re-ingesting
        a document makes the registry hold what the records yield now, and ``full_roll=True`` retires
        buildings an earlier snapshot of this source covered that this one does not list (a loan paid off).
        """
        stats = IngestStats()
        self._tracking = True
        try:
            for r in records:
                stats.seen += 1
                try:
                    if parse_id(r.urn)[0] != "building":
                        raise FactLotIdError("not a building ID")
                except FactLotIdError as e:
                    stats.skipped_invalid += 1
                    stats.errors.append(f"{r.locator or r.urn}: {e}")
                    continue
                stats.kept += 1
                old_ids = {row[0] for row in self.db.execute(
                    "SELECT fact_id FROM facts WHERE subject = ? AND document_id = ?", (r.urn, snap.document_id))}
                self._written = set()
                self._subject(r.urn, "building", r.label)
                self._cover(r.urn, snap)
                for predicate, value, unit in r.facts:
                    stats.facts_written += self._fact(r.urn, predicate, value, snap, unit=unit, method=r.method,
                                                       confidence=r.confidence, locator=r.locator)
                self._drop_stale(r.urn, snap, old_ids)
            if full_roll:
                stats.retired = self._retire_absent(snap)
            self.db.commit()
            return stats
        finally:
            self._tracking = False

    def ingest_entity_parents(self, records: Iterable[EntityParent], snap: Snapshot, *,
                              full_roll: bool = False) -> IngestStats:
        """Record registrants' Exhibit 21 subsidiaries that matched registered entities.

        For each record the registrant becomes an entity (``fl:entity:us-sec:<cik>``, indexed by name, with a
        ``sec-cik`` crosswalk), the subsidiary entity gets an ``entity.parent`` fact (``inferred``, with the
        confidence), and the registrant gets a ``controls`` link to it citing the same document. A link set an
        earlier document of this source wrote for the registrant is replaced by this one's.
        """
        stats = IngestStats()
        self._tracking = True
        done_parents: set[str] = set()
        try:
            for r in records:
                stats.seen += 1
                try:
                    parent = entity_id("us-sec", r.parent_cik).urn
                except FactLotIdError as e:
                    stats.skipped_invalid += 1
                    stats.errors.append(f"{r.locator or r.parent_cik}: {e}")
                    continue
                if not self.db.execute("SELECT 1 FROM subjects WHERE urn = ? AND kind = 'entity'",
                                       (r.subsidiary_urn,)).fetchone():
                    stats.skipped_out_of_scope += 1
                    continue
                stats.kept += 1
                if parent not in done_parents:
                    done_parents.add(parent)
                    self.db.execute(
                        "DELETE FROM relationships WHERE from_urn = ? AND type = 'controls' AND document_id IN "
                        "(SELECT document_id FROM snapshots WHERE source_id = ? AND document_id != ?)",
                        (parent, snap.source_id, snap.document_id))
                    self._subject(parent, "entity", r.parent_name)
                    self._cover(parent, snap)
                    stats.facts_written += self._fact(parent, "entity.legal_name", r.parent_name, snap)
                    stats.facts_written += self._fact(parent, "entity.registry_number", r.parent_cik, snap)
                    stats.facts_written += self._fact(parent, "entity.state_of_formation", r.parent_state, snap)
                    key = normalize_name(r.parent_name)
                    self.db.execute("INSERT OR IGNORE INTO name_index VALUES (?,?)", (key, parent))
                    self._index_name_tokens(key, parent)
                    self.db.execute("INSERT OR REPLACE INTO crosswalk VALUES (?,?,?)", ("sec-cik", r.parent_cik, parent))
                self._cover(r.subsidiary_urn, snap, COVERED_BY_ENRICHMENT)
                stats.facts_written += self._fact(r.subsidiary_urn, "entity.parent", r.value, snap, method="inferred",
                                                   confidence=r.confidence, locator=r.locator)
                self.db.execute("INSERT OR REPLACE INTO relationships VALUES (?,?,?,?,?,?,?,?)",
                                (parent, "controls", r.subsidiary_urn, snap.as_of, "inferred", r.confidence,
                                 snap.document_id, r.basis))
            if full_roll:
                stats.retired = self._retire_absent(snap)
            self.db.commit()
            return stats
        finally:
            self._tracking = False

    def _retire_absent(self, snap: Snapshot) -> int:
        """Mark subjects covered by an earlier snapshot of this source, but not by this one, as absent."""
        cur = self.db.execute(
            "INSERT OR IGNORE INTO coverage (subject, source_id, as_of, document_id, present) "
            "SELECT DISTINCT c.subject, c.source_id, ?, ?, 0 FROM coverage c "
            "WHERE c.source_id = ? AND c.as_of < ? AND c.subject NOT IN "
            "  (SELECT subject FROM coverage WHERE document_id = ?)",
            (snap.as_of, snap.document_id, snap.source_id, snap.as_of, snap.document_id),
        )
        return cur.rowcount

    def status(self, urn: str, as_of: str | None = None) -> str:
        """'current', or 'not_in_latest_snapshot' when the latest full snapshot of every covering source omitted it.

        With ``as_of``, the status on that date ('not_yet_recorded' before any snapshot covered the subject).
        """
        at = "" if as_of is None else " AND {}.as_of <= ?"
        rows = self.db.execute(
            f"SELECT c.present FROM coverage c WHERE c.subject = ?{at.format('c')} AND c.as_of = "
            f"(SELECT MAX(as_of) FROM coverage d WHERE d.subject = c.subject AND d.source_id = c.source_id{at.format('d')})",
            (urn,) if as_of is None else (urn, as_of, as_of)).fetchall()
        if not rows and as_of is not None and self.db.execute(
                "SELECT 1 FROM coverage WHERE subject = ?", (urn,)).fetchone():
            return "not_yet_recorded"
        return "current" if any(r["present"] == 1 for r in rows) or not rows else "not_in_latest_snapshot"

    def link_owners(self) -> dict[str, int]:
        """Link each parcel's current owner of record to a registered entity, where unambiguous.

        Run after any ingest (order of datasets doesn't matter). A link is made when the
        normalized owner name equals exactly one entity's normalized legal name among the
        entities that could be that owner: registered in the parcel's state, formed in the
        parcel's state, or registered in the state of the owner's mailing address (``inferred``,
        confidence 0.9, the basis naming the rule); or when a reviewer has accepted a candidate
        for that name (``inferred``, confidence at most 0.8; see ``decide_owner_match``). A
        reviewer's decision takes precedence: a name with an accepted candidate is linked only to
        that entity, even if an exact match is loaded later, so a parcel never gets two owners.
        Several such entities are ambiguous and stay unlinked, unless exactly one of them still
        exists and every other has ended (dissolved, revoked, merged, withdrawn): then that one is
        linked at confidence 0.85. An exact match that exists only
        in some other state is not linked but queued for review (rule ``exact_name_other_state``),
        since a common name is registered in most states; ``queue_fuzzy_owner_matches`` finds
        near-matches for the rest.
        """
        result = {"linked": 0, "linked_by_standing": 0, "linked_by_review": 0, "ambiguous": 0,
                  "cross_state": 0, "queued_for_review": 0, "unmatched": 0, "review_rows_superseded": 0}
        linked_keys: set[str] = set()
        # Exact-match links are re-derived on every run, so a registry linked under an earlier
        # rule (or before more entity registries were loaded) ends up with the links the current
        # rule makes. Reviewed links are a person's decision and are left alone.
        self.db.execute("DELETE FROM relationships WHERE type = 'owns' AND method = 'inferred' AND basis LIKE ?",
                        (f"{EXACT_MATCH_BASIS}%",))
        accepted = self._accepted_decisions()
        owners = self.db.execute(
            "SELECT f.subject, f.value_json, f.as_of, f.document_id, "
            "(SELECT m.value_json FROM current_facts m WHERE m.subject = f.subject AND m.document_id = f.document_id "
            " AND m.predicate = 'ownership.owner_mailing_address') AS mailing "
            "FROM current_facts f WHERE f.predicate = 'ownership.owner_of_record'"
        ).fetchall()
        cross_state: dict[str, dict[str, Any]] = {}
        for o in owners:
            name = json.loads(o["value_json"])
            key = normalize_name(name)
            candidates = self._exact_entities(key)
            plausible = self._plausible_entities(candidates, o["subject"], json.loads(o["mailing"]) if o["mailing"] else None)
            if key in accepted:
                # A reviewer's decision for this name stands; an exact or standing link made as
                # well would give the parcel a second owner of record.
                self._link_reviewed(accepted[key], o)
                result["linked_by_review"] += 1
                linked_keys.add(key)
            elif len(plausible) == 1:
                (urn, rule), = plausible.items()
                self._link(urn, o, EXACT_MATCH_CONFIDENCE, f"{EXACT_MATCH_BASIS} ({rule})")
                result["linked"] += 1
                linked_keys.add(key)
            elif plausible and len(live := self._still_in_existence(plausible)) == 1:
                # Several same-name entities in the right place, all but one dissolved, revoked,
                # merged or withdrawn: the one that still exists is the owner, at lower confidence.
                [urn] = live
                self._link(urn, o, STANDING_MATCH_CONFIDENCE,
                           f"{EXACT_MATCH_BASIS} ({plausible[urn]}; the only one of {len(plausible)} "
                           f"same-name entities still in existence, the others having ended)")
                result["linked_by_standing"] += 1
                linked_keys.add(key)
            elif plausible:
                result["ambiguous"] += 1
            elif candidates:
                result["cross_state"] += 1
                c = cross_state.setdefault(key, {"name": name, "parcel": o["subject"], "count": 0, "entities": candidates})
                c["count"] += 1
            else:
                result["unmatched"] += 1
        # A pending candidate for a name that now links is moot (a decided row is never touched; it
        # keeps a rejected pair from coming back). A name still unlinked on other parcels is queued again below.
        if linked_keys and self._has_table("owner_match_review"):
            ordered = sorted(linked_keys)
            for i in range(0, len(ordered), 500):
                chunk = ordered[i:i + 500]
                result["review_rows_superseded"] += self.db.execute(
                    f"DELETE FROM owner_match_review WHERE status = 'pending' AND owner_key IN ({','.join('?' * len(chunk))})",
                    chunk).rowcount
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for key in sorted(cross_state):
            c = cross_state[key]
            state = parcel_state(c["parcel"])
            for urn in c["entities"]:
                reason = {"rule": "exact_name_other_state", "ratio": 1.0, "token_overlap": 1.0, "shared_tokens": [],
                          "parcel_state": state, "entity_state": entity_state(urn)}
                cur = self.db.execute(
                    "INSERT OR IGNORE INTO owner_match_review (owner_name, owner_key, parcel_urn, parcel_count, "
                    "entity_urn, score, reason, status, queued_at) VALUES (?,?,?,?,?,?,?,'pending',?)",
                    (c["name"], key, c["parcel"], c["count"], urn, CROSS_STATE_EXACT_SCORE,
                     json.dumps(reason, sort_keys=True), now))
                result["queued_for_review"] += cur.rowcount
        self.db.commit()
        return result

    def _plausible_entities(self, candidates: list[str], parcel_urn: str, mailing: str | None) -> dict[str, str]:
        """The candidate entities that could be this parcel's owner, each with the rule that admits it."""
        if not candidates:
            return {}
        state = parcel_state(parcel_urn)
        mail_state = address_state(mailing)
        out: dict[str, str] = {}
        for urn in candidates:
            registry = entity_state(urn)
            if state and registry == state:
                out[urn] = "registered in the parcel's state"
            elif state and self._state_of_formation(urn) == state:
                out[urn] = "formed in the parcel's state"
            elif mail_state and registry == mail_state:
                out[urn] = "registered in the state of the owner's mailing address"
        return out

    def _still_in_existence(self, candidates: dict[str, str]) -> list[str]:
        """Candidates whose status says they still exist, when every other candidate's says it ended.

        Returns ``[]`` unless the standings are decisive: an unknown status anywhere means no decision.
        """
        standings = {urn: entity_standing(self._status(urn)) for urn in candidates}
        if None in standings.values():
            return []
        live = [urn for urn, st in standings.items() if st == "live"]
        return live if len(live) == 1 else []

    def _status(self, entity_urn: str) -> str | None:
        row = self.db.execute(
            "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'entity.status' LIMIT 1",
            (entity_urn,)).fetchone()
        v = json.loads(row["value_json"]) if row else None
        return v if isinstance(v, str) else None

    def _state_of_formation(self, entity_urn: str) -> str | None:
        row = self.db.execute(
            "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'entity.state_of_formation' LIMIT 1",
            (entity_urn,)).fetchone()
        v = json.loads(row["value_json"]) if row else None
        return v.strip().lower() if isinstance(v, str) and v.strip() else None

    def _exact_entities(self, key: str) -> list[str]:
        return [row["urn"] for row in self.db.execute(
            "SELECT n.urn FROM name_index n JOIN subjects s ON s.urn = n.urn WHERE n.key = ? AND s.kind = 'entity' "
            "ORDER BY n.urn", (key,))]

    def _link(self, entity_urn: str, owner_fact: sqlite3.Row, confidence: float, basis: str) -> int:
        cur = self.db.execute(
            "INSERT OR IGNORE INTO relationships VALUES (?,?,?,?,?,?,?,?)",
            (entity_urn, "owns", owner_fact["subject"], owner_fact["as_of"], "inferred", confidence,
             owner_fact["document_id"], basis),
        )
        return cur.rowcount

    def _accepted_decisions(self) -> dict[str, sqlite3.Row]:
        return {r["owner_key"]: r for r in self.db.execute(
            "SELECT review_id, owner_key, entity_urn, score, reason, decided_by FROM owner_match_review "
            "WHERE status = 'accepted' ORDER BY review_id")}

    def _link_reviewed(self, decision: sqlite3.Row, owner_fact: sqlite3.Row) -> int:
        confidence = min(round(float(decision["score"]), 4), REVIEWED_MATCH_MAX_CONFIDENCE)
        reason = json.loads(decision["reason"])
        basis = (f"owner of record fuzzy-matched a registered entity's legal name "
                 f"(rule {reason.get('rule')}, score {decision['score']}, ratio {reason.get('ratio')}, "
                 f"token overlap {reason.get('token_overlap')}); accepted by {decision['decided_by']} "
                 f"in owner_match_review #{decision['review_id']}")
        return self._link(decision["entity_urn"], owner_fact, confidence, basis)

    # --- fuzzy owner matching with human review------------------------------------------------

    def _common_tokens(self, max_token_frequency: int) -> set[str]:
        """Tokens indexed for more entities than the cap: too common to narrow a candidate pool."""
        return {r["token"] for r in self.db.execute(
            "SELECT token FROM name_tokens GROUP BY token HAVING COUNT(*) > ?", (max_token_frequency,))}

    def fuzzy_owner_candidates(self, owner_name: str, *, threshold: float = FUZZY_THRESHOLD,
                               limit: int = FUZZY_LIMIT_PER_OWNER,
                               max_token_frequency: int = FUZZY_MAX_TOKEN_FREQUENCY,
                               _common: set[str] | None = None) -> list[dict[str, Any]]:
        """Registered entities whose legal name resembles an owner-of-record name, best first.

        Deterministic and standard-library only. The pool is every entity sharing a distinctive
        token with the owner name (tokens shared by more than ``max_token_frequency`` entities are
        ignored, so the pool stays small on millions of entities), plus exact-key matches. Each
        pool member is scored with ``name_similarity``; the top ``limit`` at or above ``threshold``
        are returned with the score's reasons. This only proposes: it never writes a link.
        """
        key = normalize_name(owner_name)
        common = self._common_tokens(max_token_frequency) if _common is None else _common
        tokens = [t for t in distinctive_tokens(key) if t not in common]
        pool: dict[str, str] = {}
        if tokens:
            marks = ",".join("?" * len(tokens))
            for r in self.db.execute(f"SELECT urn, key FROM name_tokens WHERE token IN ({marks})", tokens):
                pool[r["urn"]] = r["key"]
        for urn in self._exact_entities(key):
            pool[urn] = key
        # A perfect ratio cannot lift a candidate to the threshold without this much token overlap.
        min_overlap = max(0.0, (threshold - NAME_RATIO_WEIGHT) / NAME_OVERLAP_WEIGHT)
        scored: list[tuple[float, str, dict[str, Any]]] = []
        for urn, entity_key in pool.items():
            sim = name_similarity(key, entity_key)
            if sim["token_overlap"] + 1e-9 < min_overlap or sim["score"] + 1e-9 < threshold:
                continue
            scored.append((-sim["score"], urn, sim))
        scored.sort(key=lambda s: (s[0], s[1]))
        out = []
        for _neg, urn, sim in scored[:limit]:
            out.append({"entity_urn": urn, "entity_key": pool[urn], "score": sim["score"],
                        "reason": {k: sim[k] for k in ("rule", "ratio", "token_overlap", "shared_tokens")}})
        return out

    def queue_fuzzy_owner_matches(self, *, threshold: float = FUZZY_THRESHOLD,
                                  limit_per_owner: int = FUZZY_LIMIT_PER_OWNER,
                                  max_token_frequency: int = FUZZY_MAX_TOKEN_FREQUENCY) -> dict[str, int]:
        """Find fuzzy candidates for every current owner of record that has no link, and queue them.

        One queue row per (owner name, candidate entity); a pair already in the queue, whatever its
        status, is never added again, so a rejected candidate stays rejected. Nothing is linked
        here: links come only from ``decide_owner_match`` (data policy §4). Returns counts.
        """
        if self.db.execute("SELECT 1 FROM name_tokens LIMIT 1").fetchone() is None:
            self.rebuild_name_tokens()
        common = self._common_tokens(max_token_frequency)
        accepted = self._accepted_decisions()
        owners: dict[str, dict[str, Any]] = {}
        rows = self.db.execute(
            "SELECT f.subject, f.value_json FROM current_facts f WHERE f.predicate = 'ownership.owner_of_record' "
            "AND NOT EXISTS (SELECT 1 FROM relationships r WHERE r.to_urn = f.subject AND r.type = 'owns' "
            "AND r.document_id = f.document_id) ORDER BY f.subject").fetchall()
        for r in rows:
            name = json.loads(r["value_json"])
            key = normalize_name(name)
            if key in accepted:
                continue  # already decided; link_owners() applies it
            o = owners.setdefault(key, {"name": name, "parcel": r["subject"], "count": 0})
            o["count"] += 1
        result = {"owners_considered": len(owners), "owners_with_candidates": 0, "queued": 0, "already_queued": 0}
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for key in sorted(owners):
            o = owners[key]
            cands = self.fuzzy_owner_candidates(o["name"], threshold=threshold, limit=limit_per_owner,
                                                max_token_frequency=max_token_frequency, _common=common)
            if not cands:
                continue
            result["owners_with_candidates"] += 1
            for c in cands:
                cur = self.db.execute(
                    "INSERT OR IGNORE INTO owner_match_review (owner_name, owner_key, parcel_urn, parcel_count, "
                    "entity_urn, score, reason, status, queued_at) VALUES (?,?,?,?,?,?,?,'pending',?)",
                    (o["name"], key, o["parcel"], o["count"], c["entity_urn"], c["score"],
                     json.dumps(c["reason"], sort_keys=True), now))
                if cur.rowcount:
                    result["queued"] += 1
                else:
                    result["already_queued"] += 1
        self.db.commit()
        return result

    def review_queue(self, status: str = "pending", limit: int = 100) -> list[dict[str, Any]]:
        """Rows of the owner-match review queue with the given status, grouped by owner, best candidate first."""
        rows = self.db.execute(
            "SELECT q.*, s.label AS entity_label FROM owner_match_review q LEFT JOIN subjects s ON s.urn = q.entity_urn "
            "WHERE q.status = ? ORDER BY q.owner_key, q.score DESC, q.entity_urn LIMIT ?", (status, limit)).fetchall()
        out = []
        for r in rows:
            d = {k: r[k] for k in r.keys()}
            d["reason"] = json.loads(d["reason"])
            out.append(d)
        return out

    def decide_owner_match(self, review_id: int, accepted: bool, decided_by: str) -> dict[str, Any]:
        """Record a reviewer's decision on a queued candidate. Decisions are final.

        Accepting links the entity to every parcel whose current owner of record has that name
        (``owns``, ``inferred``, confidence ``min(score, 0.8)``, basis naming the rule and the
        reviewer) and rejects the owner's other pending candidates, since the review is a choice
        among them. Rejecting only records the decision; the pair is never queued again.
        """
        if not decided_by or not decided_by.strip():
            raise ValueError("decided_by must name the reviewer")
        reviewer = decided_by.strip()
        row = self.db.execute("SELECT * FROM owner_match_review WHERE review_id = ?", (review_id,)).fetchone()
        if row is None:
            raise ValueError(f"no owner_match_review row {review_id}")
        if row["status"] != "pending":
            raise ValueError(f"owner_match_review row {review_id} was already {row['status']}")
        if accepted:
            prior = self.db.execute(
                "SELECT review_id FROM owner_match_review WHERE owner_key = ? AND status = 'accepted'",
                (row["owner_key"],)).fetchone()
            if prior:
                raise ValueError(f"owner name already accepted in owner_match_review row {prior['review_id']}")
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        status = "accepted" if accepted else "rejected"
        self.db.execute(
            "UPDATE owner_match_review SET status = ?, decided_at = ?, decided_by = ? WHERE review_id = ?",
            (status, now, reviewer, review_id))
        links = 0
        if accepted:
            self.db.execute(
                "UPDATE owner_match_review SET status = 'rejected', decided_at = ?, decided_by = ? "
                "WHERE owner_key = ? AND status = 'pending'", (now, reviewer, row["owner_key"]))
            decision = self._accepted_decisions()[row["owner_key"]]
            owners = self.db.execute(
                "SELECT subject, value_json, as_of, document_id FROM current_facts "
                "WHERE predicate = 'ownership.owner_of_record'").fetchall()
            for o in owners:
                if normalize_name(json.loads(o["value_json"])) == row["owner_key"]:
                    links += self._link_reviewed(decision, o)
        self.db.commit()
        return {"review_id": review_id, "status": status, "decided_by": reviewer, "links_created": links}

    # --- reading ------------------------------------------------------------------------------

    def _rights(self, document_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        row = self.db.execute(
            "SELECT s.*, src.publisher, src.title AS src_title, src.url, src.license, src.ai_use, src.redistribution, src.attribution "
            "FROM snapshots s JOIN sources src USING (source_id) WHERE s.document_id = ?", (document_id,)).fetchone()
        source = {"document_id": document_id, "title": f"{row['publisher']}: {row['src_title']} ({row['filename']})",
                  "uri": row["url"], "retrieved_at": row["retrieved_at"]}
        rights = {"ai_use": row["ai_use"], "redistribution": row["redistribution"], "license": row["license"]}
        if row["attribution"]:
            rights["attribution"] = row["attribution"]
        return source, rights

    def facts(self, urn: str, *, history: bool = False, as_of: str | None = None) -> list[dict[str, Any]]:
        """FactLot facts about a subject: current ones by default (coverage rule), or the full history.

        With ``as_of`` (YYYY-MM-DD): the facts current on that date, or with ``history`` every fact dated on or
        before it.
        """
        if as_of is None:
            table = "facts" if history else "current_facts"
            rows = self.db.execute(f"SELECT * FROM {table} WHERE subject = ?{_ORDER_FACTS}", (urn,)).fetchall()
        elif history:
            rows = self.db.execute(f"SELECT * FROM facts WHERE subject = ? AND as_of <= ?{_ORDER_FACTS}",
                                   (urn, as_of)).fetchall()
        else:
            rows = self.db.execute(_FACTS_AT + _ORDER_FACTS, (urn, as_of, as_of)).fetchall()
        out, seen = [], set()
        for f in rows:
            # Two current sources disagree: keep the newest (a predicate that holds many facts keeps them all).
            if not history and f["predicate"] in seen and f["predicate"] not in MULTI_VALUED_PREDICATES:
                continue
            seen.add(f["predicate"])
            source, rights = self._rights(f["document_id"])
            if f["locator"]:
                source["section"] = f["locator"]
            fact: dict[str, Any] = {
                "id": f["fact_id"],
                "subject": urn,
                "predicate": f["predicate"],
                "value": json.loads(f["value_json"]),
                "as_of": f["as_of"],
                "provenance": {"method": f["method"], "sources": [source], "producer": {"name": PRODUCER, "version": "1"}},
                "rights": rights,
            }
            if f["unit"]:
                fact["unit"] = f["unit"]
            if f["confidence"] is not None:
                fact["provenance"]["confidence"] = f["confidence"]
            out.append(fact)
        return _newest_first(out)

    def recorded_lists(self, urn: str) -> dict[str, list[dict[str, Any]]]:
        """A parcel's current recorded facts by predicate, each newest first (``registryRecordedLists``)."""
        out: dict[str, list[dict[str, Any]]] = {}
        for f in self.facts(urn):
            if f["predicate"] in RECORDED_PREDICATES:
                out.setdefault(f["predicate"], []).append(f)
        return out

    def get(self, urn: str, as_of: str | None = None) -> dict[str, Any] | None:
        """A record: current facts and links, or with ``as_of`` (YYYY-MM-DD) those current on that date.

        The building roll-up and crosswalk IDs are the file's current ones either way. ``warnings`` flags
        area facts that look wrong (``area_warnings``).
        """
        subj = self.db.execute("SELECT * FROM subjects WHERE urn = ?", (urn,)).fetchone()
        if subj is None:
            return None
        link, params = (_CURRENT_LINK, ()) if as_of is None else (_LINK_AT, (as_of, as_of, as_of))
        rels = [dict(r) for r in self.db.execute(
            f"SELECT from_urn, type, to_urn, as_of, method, confidence, basis, document_id FROM relationships r "
            f"WHERE (from_urn = ? OR to_urn = ?) AND {link} ORDER BY as_of DESC", (urn, urn, *params))]
        xw = [dict(r) for r in self.db.execute("SELECT system, external_id FROM crosswalk WHERE urn = ?", (urn,))]
        facts, truncated = capped_recorded_facts(self.facts(urn, as_of=as_of))
        status = self.status(urn, as_of)
        if status == "not_yet_recorded":
            rels = []  # no link before the record itself
        record: dict[str, Any] = {"urn": urn, "kind": subj["kind"], "short": subj["short"], "label": subj["label"]}
        if as_of is not None:
            record["as_of"] = as_of
        record.update({"status": status, "facts": facts})
        if truncated is not None:
            record["recorded_facts_truncated"] = truncated
        record.update({"relationships": rels, "crosswalk": xw})
        if subj["kind"] == "parcel":
            record["building"] = _buildings.building_of(self.db, urn)
            record["value_history"] = self.value_history(urn, as_of)
        elif subj["kind"] == "building":
            record["building"] = _buildings.building_detail(self.db, urn)
        record["warnings"] = area_warnings(facts)
        if subj["kind"] == "parcel":
            building = record["building"]
            siblings = _improved_siblings(self.db, building["urn"], urn) if building else []
            record["warnings"] += improvement_warnings(facts, building, siblings)
        return record

    def value_history(self, urn: str, as_of: str | None = None) -> list[dict[str, Any]]:
        """A parcel's market and appraised values by tax year, each cited (``registryValueHistory`` in TypeScript).

        Read from every snapshot (current and superseded; with ``as_of``, those dated on or before it): one entry
        per snapshot that recorded a value. A tax year a later snapshot restates with the same values is listed
        once, cited to the newest; a tax year two snapshots value differently is listed once per value, newest
        snapshot first. Ordered by tax year, newest first (an entry without a tax year last).
        """
        sql = f"SELECT * FROM facts WHERE subject = ? AND predicate IN ({_VALUE_HISTORY_IN})"
        params: tuple[Any, ...] = (urn,)
        if as_of is not None:
            sql += " AND as_of <= ?"
            params += (as_of,)
        def file_of(document_id: str) -> dict[str, Any] | None:
            r = self.db.execute("SELECT source_id, filename, as_of, retrieved_at FROM snapshots WHERE document_id = ?",
                                (document_id,)).fetchone()
            return ({"source_id": r["source_id"], "filename": r["filename"], "as_of": r["as_of"],
                     "read_on": str(r["retrieved_at"])[:10]} if r else None)
        return label_value_history(value_history_entries(self.db.execute(sql + _ORDER_VALUE_HISTORY, params).fetchall()),
                                   file_of)

    def snapshot(self, document_id: str) -> dict[str, Any] | None:
        """A source snapshot the registry cites, by its ``fl:document:sha256-…`` ID (``registrySnapshot`` in TS)."""
        row = self.db.execute(
            "SELECT s.document_id, s.source_id, s.retrieved_at, s.as_of, s.filename, s.bytes, src.publisher, "
            "src.title, src.url, src.license, src.ai_use, src.redistribution, src.attribution "
            "FROM snapshots s JOIN sources src USING (source_id) WHERE s.document_id = ?", (document_id,)).fetchone()
        return dict(row) if row else None

    def resolve_parcel(self, state_fips: str, county_fips: str, apn: str) -> str | None:
        urn = self.parcel_urn(state_fips, county_fips, apn)
        return urn if self.db.execute("SELECT 1 FROM subjects WHERE urn = ?", (urn,)).fetchone() else None

    def resolve_external(self, system: str, external_id: str) -> str | None:
        row = self.db.execute("SELECT urn FROM crosswalk WHERE system = ? AND external_id = ?", (system, external_id)).fetchone()
        return row["urn"] if row else None

    def search_entities(self, name: str, limit: int = 20) -> list[dict[str, Any]]:
        key = self._name_search_key(name)
        rows = self.db.execute(
            "SELECT DISTINCT s.urn, s.label FROM name_index n JOIN subjects s ON s.urn = n.urn "
            "WHERE s.kind = 'entity' AND n.key LIKE ? ORDER BY (n.key = ?) DESC, s.label LIMIT ?",
            (f"%{key}%", key, limit)).fetchall()
        return [dict(r) for r in rows]

    def search_address(self, address: str, limit: int = 20, where: dict[str, str] | None = None) -> list[dict[str, Any]]:
        """Parcels whose situs address holds the query's words (``address_query``): with a house number, an
        address starting with it and holding every other word; otherwise the words in a row, including a
        street type. A query with neither finds nothing. Every spelling of the street line is searched
        (``address_search_forms``: "Fifth Avenue", "5th Ave" and "5 Ave" are one street), and with a house number every
        parcel whose house-number range holds it (``address_range_matches``). ``where`` holds the call's place
        parameters (``address_place_with``). Each result carries its search card (``address_card``)."""
        return self.search_address_hint(address, limit, where, hint=False)[0]

    def search_address_hint(self, address: str, limit: int = 20, where: dict[str, str] | None = None,
                            hint: bool = True) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        """``search_address``, and when nothing matched what the search found on the query's street
        (``address_street_hint_from``) for the miss."""
        # The unit as asked: rebuilding a query without a comma leaves the unit out of its street line.
        unit = address_unit(address)
        asked = address
        address = address_query_with_place(address)
        mode = address_query(address)["mode"]
        if mode is None:
            return [], None
        place = address_place_with(address, where)
        runs = [k.split(" ") for k in self._address_search_keys(address.split(",")[0])]
        if mode == "street" and all(len(w) == 1 for w in runs):
            rows = self._search_address_runs(mode, runs, limit, place)
            return [{**r, **self._address_card(r["urn"], r["label"])} for r in rows], None
        # A query rebuilt with a comma still finds the address it was, exactly, first.
        forms = address_forms(runs, [] if address == asked else self._address_search_keys(asked.split(",")[0]))
        ordered = self._address_matches(mode, forms, place, unit)
        end = address_window_end(ordered, limit)
        results = address_result_rows([(m, self._address_card(m["urn"], m["label"])) for m in ordered[:end]], limit)
        if results or not hint:
            return results, None
        number = forms["first"][0][0] if forms["first"] and forms["first"][0] else ""
        lists = []
        for street, lst in address_hint_streets(mode, forms):
            pair = f"% {lst[2:]} %"
            count = self.db.execute("SELECT COUNT(*) FROM address_index a WHERE (' ' || a.key || ' ') LIKE ?",
                                    (pair,)).fetchone()[0]
            rows = None if count > ADDRESS_STREET_HINT_ROWS else [
                (r["urn"], r["label"], r["key"]) for r in self.db.execute(
                    "SELECT a.urn, s.label, a.key FROM address_index a JOIN subjects s ON s.urn = a.urn "
                    "WHERE (' ' || a.key || ' ') LIKE ?", (pair,))]
            lists.append((street, count, rows))
        return results, (address_street_hint_from(number, place, lists) if number.isdigit() and number.isascii()
                         else None)

    def _address_card(self, urn: str, label: Any) -> dict[str, Any]:
        """A parcel's search card from its current facts (``registry_get``'s first fact of each predicate)."""
        q = ",".join("?" * len(ADDRESS_CARD_PREDICATES))
        rows = self.db.execute(
            f"SELECT predicate, value_json FROM current_facts WHERE subject = ? AND predicate IN ({q}) "
            "ORDER BY predicate, as_of DESC, fact_id", (urn, *ADDRESS_CARD_PREDICATES)).fetchall()
        return address_card(label, [{"predicate": r["predicate"], "value": json.loads(r["value_json"])} for r in rows])

    def _address_matches(self, mode: str, forms: dict[str, list[list[str]]], place: dict[str, Any],
                         unit: str | None = None) -> list[dict[str, Any]]:
        """Every parcel a search matches (each spelling, and with a house number each range holding it), in its place's
        state (and county) only, sorted by ``address_match_key``."""
        where, params = [], []
        for words in forms["first"] + forms["other"]:
            if mode == "street":
                where.append("(' ' || a.key || ' ') LIKE ?")
                params.append(f"% {' '.join(words)} %")
                continue
            where.append("(" + " AND ".join(["(a.key || ' ') LIKE ?"]
                                            + ["(' ' || a.key || ' ') LIKE ?" for _ in words[1:]]) + ")")
            params += [f"{words[0]} %", *(f"% {w} %" for w in words[1:])]
            # A number inside a house-number range ("350" in "338-350 5 AVENUE").
            if len(words) > 1 and words[0].isascii() and words[0].isdigit():
                where.append("(a.key GLOB '[0-9]*' AND substr(a.key, instr(a.key, ' ') + 1, 1) GLOB '[0-9]' AND "
                             + " AND ".join("(' ' || a.key || ' ') LIKE ?" for _ in words[1:]) + ")")
                params += [f"% {w} %" for w in words[1:]]
        by_urn: dict[str, dict[str, Any]] = {}
        for r in self.db.execute("SELECT a.key, s.urn, s.label FROM address_index a JOIN subjects s ON s.urn = a.urn "
                                 f"WHERE {' OR '.join(where)}", params):
            urn, label = r["urn"], r["label"]
            t = address_row_tier(mode, forms, urn, label, r["key"])
            if t is None:
                continue
            rank = address_place_rank(place, urn, label)
            if rank < 0:
                continue
            m = by_urn.get(urn)
            if m is None or t[0] < m["tier"]:
                by_urn[urn] = {"urn": urn, "label": label, "rank": rank, "tier": t[0], "exact": t[1],
                               "unit": unit is not None and address_unit(label) == unit}
            elif t[0] == m["tier"] and t[1]:
                m["exact"] = True
        return sorted(by_urn.values(), key=address_match_key)

    def _search_address_runs(self, mode: str, runs: list[list[str]], limit: int,
                             place: dict[str, Any]) -> list[dict[str, Any]]:
        """The matches in today's order (exact address first, then label, then URN); with a place (``address_place``),
        those in its state only, grouped by ``address_place_rank`` (same ZIP code, then same city, then the rest), in
        that order within each group, before the limit is applied."""
        where, params = [], []
        for words in runs:
            if mode == "street":
                where.append("(' ' || a.key || ' ') LIKE ?")
                params.append(f"% {' '.join(words)} %")
            else:
                where.append("(" + " AND ".join(["(a.key || ' ') LIKE ?"]
                                                + ["(' ' || a.key || ' ') LIKE ?" for _ in words[1:]]) + ")")
                params += [f"{words[0]} %", *(f"% {w} %" for w in words[1:])]
        keys = [" ".join(w) for w in runs]
        exact = " OR ".join("a.key = ?" for _ in keys)
        sql = (f"SELECT s.urn, s.label, MAX({exact}) AS x FROM address_index a JOIN subjects s ON s.urn = a.urn "
               f"WHERE {' OR '.join(where)} GROUP BY s.urn ORDER BY x DESC, s.label, s.urn")
        top = address_place_top(place)
        if top == 2 and place["state"] is None and place.get("county") is None:
            rows = self.db.execute(f"{sql} LIMIT ?", (*keys, *params, limit)).fetchall()
            return [{"urn": r["urn"], "label": r["label"]} for r in rows]
        groups: list[list[dict[str, Any]]] = [[], [], []]
        others = 0
        one_word = mode == "street" and all(len(w) == 1 for w in runs)
        for r in self.db.execute(sql, (*keys, *params)):
            if one_word and not r["x"]:
                if others == ADDRESS_ONE_WORD_CANDIDATES:
                    break
                others += 1
            rank = address_place_rank(place, r["urn"], r["label"])
            if rank < 0:
                continue
            groups[rank].append({"urn": r["urn"], "label": r["label"]})
            if len(groups[top]) >= limit:
                break
        return [m for g in groups for m in g][:limit]

    def parcels_owned_by(self, entity_urn: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT r.to_urn AS urn, s.label, r.confidence, r.as_of FROM relationships r JOIN subjects s ON s.urn = r.to_urn "
            f"WHERE r.from_urn = ? AND r.type = 'owns' AND {_CURRENT_LINK} ORDER BY s.label", (entity_urn,)).fetchall()
        return [dict(r) for r in rows]

    def purge_person_owners(self) -> dict[str, int]:
        """Remove owner-of-record facts that the current ``is_organization`` rule reads as persons.

        The ingest step stores owner names only for organisations (data policy, "People are not
        the product"). When that rule is tightened, a registry built earlier can still hold
        individuals it once read as organisations ("SMITH JOHN CO-TRUSTEE"). This deletes, for
        each such fact: the owner-of-record fact, the mailing-address fact from the same
        document, any ownership link inferred from it, and any review-queue rows for that name.
        It also removes, from every stored owner and entity mailing address, the contact names
        ("ATTN JANE DOE", "C/O JOHN SMITH") that ``scrub_mailing_address`` does not read as
        organisations, as ingest now does (``contact_names``; an address left empty is deleted),
        and deletes the mailing address of every owner and entity whose name reads as a person's or
        a family's (``personal_style_organization``: "JOHN SMITH LLC", "SMITH FAMILY LP"), as ingest
        now does (``personal_addresses``). In recorded documents (deeds, mortgages, satisfactions) it takes every
        party the rule now rejects out of the role lists and counts it in ``<role>_withheld`` (``withhold_parties``):
        the document fact stays, with its date, type, amount and IDs, even when no party is left
        (``documents_left_without_parties``). The parcel and its other facts stay. Run it once after
        upgrading; it is idempotent.
        """
        result = {"owner_facts": 0, "mailing_facts": 0, "ownership_links": 0, "review_rows": 0, "contact_names": 0,
                  "personal_addresses": 0, "party_names_withheld": 0, "party_names_cut_to_company": 0,
                  "document_facts_rewritten": 0, "documents_left_without_parties": 0}
        rows = self.db.execute(
            "SELECT fact_id, subject, value_json, document_id FROM facts WHERE predicate = 'ownership.owner_of_record'"
        ).fetchall()
        keys: set[str] = set()
        for r in rows:
            name = json.loads(r["value_json"])
            if isinstance(name, str) and is_organization(name):
                continue
            keys.add(normalize_name(name) if isinstance(name, str) else "")
            result["mailing_facts"] += self.db.execute(
                "DELETE FROM facts WHERE subject = ? AND document_id = ? AND predicate = 'ownership.owner_mailing_address'",
                (r["subject"], r["document_id"])).rowcount
            result["ownership_links"] += self.db.execute(
                "DELETE FROM relationships WHERE type = 'owns' AND to_urn = ? AND document_id = ?",
                (r["subject"], r["document_id"])).rowcount
            result["owner_facts"] += self.db.execute("DELETE FROM facts WHERE fact_id = ?", (r["fact_id"],)).rowcount
        if keys and self._has_table("owner_match_review"):
            for k in keys:
                result["review_rows"] += self.db.execute(
                    "DELETE FROM owner_match_review WHERE owner_key = ?", (k,)).rowcount
        for r in self.db.execute(
                f"SELECT fact_id, subject, predicate, value_json, document_id FROM facts WHERE predicate IN "
                f"({','.join('?' * len(PARTY_LIST_PREDICATES))})", PARTY_LIST_PREDICATES).fetchall():
            old = json.loads(r["value_json"])
            if not isinstance(old, dict) or not any(isinstance(old.get(k), list) for k in PARTY_ROLES):
                continue
            new, withheld, cut = withhold_parties(old)
            if not (withheld or cut):
                continue
            result["party_names_withheld"] += withheld
            result["party_names_cut_to_company"] += cut
            result["document_facts_rewritten"] += 1
            if not any(new.get(k) for k in PARTY_ROLES):
                result["documents_left_without_parties"] += 1
            value_json = json.dumps(new, sort_keys=True)
            cur = self.db.execute("UPDATE OR IGNORE facts SET value_json = ?, fact_id = ? WHERE fact_id = ?",
                                  (value_json, _fact_id(r["subject"], r["predicate"], value_json, r["document_id"]),
                                   r["fact_id"]))
            if cur.rowcount == 0:  # the rewritten fact is already there
                self.db.execute("DELETE FROM facts WHERE fact_id = ?", (r["fact_id"],))
        rows = self.db.execute(
            f"SELECT fact_id, subject, predicate, value_json, document_id FROM facts WHERE predicate IN "
            f"({','.join('?' * len(MAILING_PREDICATES))})", MAILING_PREDICATES).fetchall()
        for r in rows:
            old = json.loads(r["value_json"])
            new, removed = scrub_mailing_address(old) if isinstance(old, str) else (old, 0)
            if not removed:
                continue
            result["contact_names"] += removed
            if new is None:
                self.db.execute("DELETE FROM facts WHERE fact_id = ?", (r["fact_id"],))
                continue
            value_json = json.dumps(new, sort_keys=True)
            cur = self.db.execute("UPDATE OR IGNORE facts SET value_json = ?, fact_id = ? WHERE fact_id = ?",
                                  (value_json, _fact_id(r["subject"], r["predicate"], value_json, r["document_id"]),
                                   r["fact_id"]))
            if cur.rowcount == 0:  # the scrubbed fact is already there
                self.db.execute("DELETE FROM facts WHERE fact_id = ?", (r["fact_id"],))
        for name_predicate, mailing in (("ownership.owner_of_record", "ownership.owner_mailing_address"),
                                        ("entity.legal_name", "entity.mailing_address")):
            for r in self.db.execute(
                    "SELECT f.subject, f.value_json, f.document_id FROM facts f WHERE f.predicate = ? AND EXISTS "
                    "(SELECT 1 FROM facts m WHERE m.subject = f.subject AND m.document_id = f.document_id "
                    "AND m.predicate = ?)", (name_predicate, mailing)).fetchall():
                name = json.loads(r["value_json"])
                if isinstance(name, str) and personal_style_organization(name):
                    result["personal_addresses"] += self.db.execute(
                        "DELETE FROM facts WHERE subject = ? AND document_id = ? AND predicate = ?",
                        (r["subject"], r["document_id"], mailing)).rowcount
        self.db.commit()
        return result

    def stats(self) -> dict[str, int]:
        q = lambda sql: self.db.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "parcels": q("SELECT COUNT(*) FROM subjects WHERE kind = 'parcel'"),
            "entities": q("SELECT COUNT(*) FROM subjects WHERE kind = 'entity'"),
            "facts": q("SELECT COUNT(*) FROM facts"),
            "ownership_links": q(f"SELECT COUNT(*) FROM relationships r WHERE type = 'owns' AND {_CURRENT_LINK}"),
            "snapshots": q("SELECT COUNT(*) FROM snapshots"),
            # A file written before schema version 2 and opened read-only has no review table.
            "owner_matches_pending_review": q(
                "SELECT COUNT(*) FROM owner_match_review WHERE status = 'pending'") if self._has_table("owner_match_review") else 0,
        }

    def _has_table(self, name: str) -> bool:
        return self.db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None
