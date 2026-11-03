"""Quality audit of a registry file: is what it holds clean, complete, cited and current?

``python -m factlot.registry.audit registry.db [more.db ...]`` measures, per source and per
snapshot:

- **Counts.** Parcels (or entities) the file holds, and, with ``--collected`` or ``--files``, what
  the source file yields when the adapter is run on it again: records in scope, records overall,
  distinct APNs, distinct FactLot parcel IDs (two APNs that normalize alike collapse into one
  parcel), and whether the registry holds exactly that many.
- **Completeness.** For every parcel field, how many parcels have it; parcels with no situs
  address, no organisation owner, or no valid ``as_of``.
- **Duplicates.** Parcels with two different values for one single-valued fact from one document
  (two conflicting rows for one account), and APNs that look like column headings.
- **Privacy.** Owner-of-record facts that the current ``is_organization`` rule reads as a natural
  person. Policy says this number is zero (data policy section 3).
- **Owner links.** Organisation-owned parcels, how many are linked to a registered entity, by
  confidence and by rule, and why the rest are not (no entity registry for the state; the exact
  name exists only in another state; several same-name entities; no exact name); the review queue.
- **Citations.** Facts and links whose document is not a snapshot, whose document ID is not a
  SHA-256 content address, that have no record locator, no valid date or no method; sources with no
  URL or licence.
- **Age.** Days between each snapshot's ``as_of`` and the audit date.

The audit only reads. Every number comes from queries over the registry file, so it can be re-run
after any rebuild; scans of the fact table use the ``(subject, predicate)`` index, and on a 30 GB
file the whole audit takes a few minutes. Exit status 1 means a hard violation (a person-like
owner, an uncited fact, a count that disagrees with the source file).
"""

from __future__ import annotations

import argparse
import importlib
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from ..ids import FactLotIdError, entity_id, parcel_id
from .normalize import STATE_BY_FIPS, is_commercial, is_organization, normalize_name
from .store import EXACT_MATCH_BASIS

DOCUMENT_ID = re.compile(r"^fl:document:sha256-[0-9a-f]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
# Subject URNs sort in ranges, which lets the audit walk only parcel (or entity) rows of the index.
_PARCEL = ("fl:parcel:", "fl:parcel;")
_ENTITY = ("fl:entity:", "fl:entity;")

STALE_AFTER_DAYS = 400
# A link rate below this, in a state whose entity registry is loaded, is worth a look.
LOW_LINK_RATE = 0.5
# More than this share of parcels without a situs address is a finding.
MISSING_ADDRESS_WARN = 0.05

PARCEL_FIELDS = {
    "apn": "parcel.apn",
    "situs_address": "parcel.situs_address",
    "state_property_category": "parcel.state_property_category",
    "land_area_sf": "parcel.land_area_sf",
    "improvement_area_sf": "parcel.improvement_area_sf",
    "year_built": "parcel.year_built",
    "market_value": "parcel.market_value",
    "appraised_value": "parcel.appraised_value",
    "tax_year": "parcel.tax_year",
    "owner_of_record": "ownership.owner_of_record",
}

# Bounds outside which a figure on a parcel is implausible (a unit slip or a misread column).
MAX_AREA_SF = 5e8  # about 11,500 acres
MAX_VALUE_USD = 5e10
MIN_YEAR_BUILT = 1700
MIN_TAX_YEAR = 2000

# Governments and special districts are not in business registries (they pay no franchise or
# registration fee), so an owner like "DALLAS CITY OF" never links; counted apart from real gaps.
_PUBLIC_BODY = re.compile(
    r"\b(?:CITY OF|COUNTY OF|STATE OF|TOWN OF|VILLAGE OF|UNITED STATES|ISD|SCHOOL DISTRICT|"
    r"HOUSING AUTHORITY|HOSPITAL DISTRICT|DISTRICT|AUTHORITY|DEPARTMENT OF|COMMONWEALTH OF)\b|\b(?:CITY|COUNTY|STATE)$")

# An APN made only of letters, underscores and spaces is a column heading read as data.
_HEADER_LIKE_APN = re.compile(r"^[A-Za-z_ .#]+$")

# Source IDs whose adapter is not the one named in ``SOURCE`` of the module that reads them.
_READER_MODULES = (
    "tx_harris", "tx_dallas", "tx_tarrant", "tx_travis", "tx_collin", "tx_comptroller", "ny_nyc",
    "ma_boston", "ca_san_francisco", "ca_los_angeles", "co_denver", "dc_otr", "mn_hennepin",
    "nc_mecklenburg", "pa_philadelphia", "co_sos_entities", "ny_dos_entities", "pa_sos_entities",
    "dc_dlcp_entities",
)


# --- helpers ----------------------------------------------------------------------------------


def _connect(path: str | Path) -> sqlite3.Connection:
    if not Path(path).exists():
        raise FileNotFoundError(f"no registry file at {path}")
    db = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row

    def org_json(value_json: str) -> int:
        try:
            v = json.loads(value_json)
        except (TypeError, ValueError):
            return 0
        return 1 if isinstance(v, str) and is_organization(v) else 0

    db.create_function("fl_is_org", 1, org_json, deterministic=True)
    db.create_function("fl_is_org_name", 1, lambda n: 1 if n and is_organization(n) else 0, deterministic=True)
    return db


def _has_table(db: sqlite3.Connection, name: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _age_days(as_of: str | None, today: date) -> int | None:
    if not as_of or not ISO_DATE.match(as_of):
        return None
    try:
        return (today - date.fromisoformat(as_of)).days
    except ValueError:
        return None


def _pct(n: int, d: int) -> float | None:
    return round(100.0 * n / d, 2) if d else None


def _link_rule(basis: str | None) -> str:
    """Which rule made an ``owns`` link, from its basis text."""
    b = basis or ""
    if b.startswith(EXACT_MATCH_BASIS):
        if "only one of" in b:
            return "exact_name_standing"
        if "(registered in the parcel's state)" in b:
            return "exact_name_registered_in_parcel_state"
        if "(formed in the parcel's state)" in b:
            return "exact_name_formed_in_parcel_state"
        if "mailing address" in b:
            return "exact_name_registered_in_mailing_state"
        return "exact_name_legacy" if b == EXACT_MATCH_BASIS else "exact_name_other"
    if "accepted by" in b:
        return "reviewed_fuzzy_name"
    return "other"


def _confidence_bucket(c: float | None) -> str:
    if c is None:
        return "none"
    if c >= 0.9:
        return "0.90+"
    if c >= 0.85:
        return "0.85-0.89"
    if c >= 0.8:
        return "0.80-0.84"
    return "below 0.80"


# --- source files: re-running adapters --------------------------------------------------------


def adapter_for(source_id: str) -> Any | None:
    """The adapter module whose ``SOURCE.source_id`` is ``source_id``, or None."""
    for name in _READER_MODULES:
        try:
            mod = importlib.import_module(f"factlot.registry.adapters.{name}")
        except Exception:  # an adapter with an optional dependency missing: skip it
            continue
        src = getattr(mod, "SOURCE", None)
        if src is not None and src.source_id == source_id:
            return mod
    return None


def locate_snapshot_file(collected: str | Path, source_id: str, document_id: str, filename: str | None) -> Path | None:
    """Find a snapshot's archived file in a collector output directory (``<source>/<sha16>/<filename>``)."""
    hex16 = document_id.rsplit("sha256-", 1)[-1][:16]
    d = Path(collected) / source_id / hex16
    if not d.is_dir():
        return None
    if filename and (d / filename).exists():
        return d / filename
    files = [p for p in d.iterdir() if p.is_file()]
    return files[0] if len(files) == 1 else None


def reread_source_file(mod: Any, path: Path) -> dict[str, Any]:
    """Run an adapter's reader on a snapshot file and describe what it yields."""
    reader: Callable[..., Iterable[Any]] | None = getattr(mod, "read_roll", None)
    entity_reader = getattr(mod, "read_entities", None)
    if reader is None and entity_reader is not None:
        rows = no_number = 0
        urns: set[str] = set()
        for e in entity_reader(path):
            rows += 1
            if not e.registry_number or not e.legal_name.strip():
                no_number += 1
                continue
            try:
                urns.add(entity_id(e.registry_jurisdiction, e.registry_number).urn)
            except FactLotIdError:
                no_number += 1
        # The registry keeps one entity per registry number; a record without one is skipped by ingest.
        return {"records_in_scope": rows, "skipped_without_registry_number": no_number,
                "distinct_entity_ids": len(urns), "distinct_parcel_ids": len(urns)}
    if reader is None:
        return {"error": "adapter has no read_roll"}
    state_fips = getattr(mod, "STATE_FIPS", mod.SOURCE.state_fips)
    yielded = 0
    in_scope = 0
    apns: set[str] = set()
    urns: set[str] = set()
    invalid = 0
    org_owners = 0
    header_like: list[str] = []
    for r in reader(path):
        yielded += 1
        # Ingest keeps only the commercial scope, whatever the reader yields (Denver's reader yields every row).
        if not is_commercial(r.state_category):
            continue
        in_scope += 1
        apns.add(r.apn)
        if _HEADER_LIKE_APN.match(r.apn or "") and len(header_like) < 5:
            header_like.append(r.apn)
        try:
            urns.add(parcel_id(state_fips, r.county_fips, r.apn).urn)
        except FactLotIdError:
            invalid += 1
        if r.owner_name and not r.owner_confidential and is_organization(r.owner_name):
            org_owners += 1
    out: dict[str, Any] = {
        "records_read": yielded,
        "records_in_scope": in_scope,
        "distinct_apns": len(apns),
        "distinct_parcel_ids": len(urns),
        "invalid_apns": invalid,
        "org_owner_records": org_owners,
        "header_like_apns": header_like,
    }
    # Every row the reader reaches, in or out of the commercial scope, when the adapter can filter at the source.
    if yielded == in_scope:
        try:
            out["records_all_categories"] = sum(1 for _ in reader(path, categories=None))
        except TypeError:
            pass
    else:
        out["records_all_categories"] = yielded
    return out


# --- the audit --------------------------------------------------------------------------------


def audit_db(path: str | Path, *, today: date | None = None, collected: str | Path | None = None,
             files: dict[str, list[str]] | None = None, reread: bool = False,
             entity_names: bool = False) -> dict[str, Any]:
    """Audit one registry file; returns a JSON-serialisable report.

    ``entity_names=True`` also counts registered entities whose legal name reads as a person (slow on
    millions of entities; informational, since a registration is a legal entity, not a natural person).
    ``reread=True`` also re-runs each source's adapter on its archived file (found under
    ``collected`` or named in ``files``, a map of source ID to paths) and compares the counts.
    """
    today = today or datetime.now(timezone.utc).date()
    db = _connect(path)
    try:
        return _audit(db, Path(path), today, collected, files or {}, reread, entity_names)
    finally:
        db.close()


def _audit(db: sqlite3.Connection, path: Path, today: date, collected: str | Path | None,
           files: dict[str, list[str]], reread: bool, entity_names: bool = False) -> dict[str, Any]:
    q = lambda sql, *a: db.execute(sql, a).fetchall()  # noqa: E731
    one = lambda sql, *a: db.execute(sql, a).fetchone()[0]  # noqa: E731

    sources = {r["source_id"]: dict(r) for r in q("SELECT * FROM sources")}
    snaps = [dict(r) for r in q("SELECT * FROM snapshots ORDER BY source_id, as_of, document_id")]
    snap_by_doc = {s["document_id"]: s for s in snaps}

    # Parcels or entities each document covers (the coverage table is the source of truth for scope).
    cover: dict[str, dict[str, int]] = defaultdict(lambda: {"parcels": 0, "entities": 0, "absent": 0})
    for r in q("SELECT document_id, COUNT(*) n, SUM(present = 0) absent FROM coverage "
               "WHERE subject >= ? AND subject < ? GROUP BY document_id", *_PARCEL):
        cover[r["document_id"]]["parcels"] = r["n"]
        cover[r["document_id"]]["absent"] = r["absent"] or 0
    for r in q("SELECT document_id, COUNT(*) n FROM coverage WHERE subject >= ? AND subject < ? GROUP BY document_id",
               *_ENTITY):
        cover[r["document_id"]]["entities"] = r["n"]

    # Per document and predicate: facts, distinct parcels, facts without a locator or a valid date.
    pred: dict[str, dict[str, dict[str, int]]] = defaultdict(dict)
    bad_loc_parcels: dict[str, int] = {}
    bad_date_parcels: dict[str, int] = {}
    for r in q(
        "SELECT document_id, predicate, COUNT(*) n, COUNT(DISTINCT subject) subjects FROM facts "
        "WHERE subject >= ? AND subject < ? GROUP BY document_id, predicate", *_PARCEL):
        pred[r["document_id"]][r["predicate"]] = {"facts": r["n"], "parcels": r["subjects"]}
    for r in q(
        "SELECT document_id, COUNT(DISTINCT CASE WHEN locator IS NULL OR TRIM(locator) = '' THEN subject END) loc, "
        f"COUNT(DISTINCT CASE WHEN as_of IS NULL OR as_of NOT GLOB '{_ISO_GLOB}' THEN subject END) dt "
        "FROM facts WHERE subject >= ? AND subject < ? GROUP BY document_id", *_PARCEL):
        bad_loc_parcels[r["document_id"]] = r["loc"]
        bad_date_parcels[r["document_id"]] = r["dt"]

    # Figures no parcel plausibly has, and categories outside the commercial scope.
    max_year = today.year + 2
    implausible: dict[str, dict[str, int]] = {}
    for r in q(
        "SELECT document_id, "
        "SUM(predicate = 'parcel.year_built' AND (CAST(value_json AS REAL) < ? OR CAST(value_json AS REAL) > ?)) year_built, "
        "SUM(predicate IN ('parcel.land_area_sf', 'parcel.improvement_area_sf') "
        "    AND (CAST(value_json AS REAL) <= 0 OR CAST(value_json AS REAL) > ?)) area, "
        "SUM(predicate IN ('parcel.market_value', 'parcel.appraised_value') "
        "    AND (CAST(value_json AS REAL) < 0 OR CAST(value_json AS REAL) > ?)) value, "
        "SUM(predicate = 'parcel.tax_year' AND (CAST(value_json AS REAL) < ? OR CAST(value_json AS REAL) > ?)) tax_year, "
        "SUM(predicate = 'parcel.state_property_category' AND value_json NOT GLOB '\"B*' "
        "    AND value_json NOT GLOB '\"F[12]*') out_of_scope_category "
        "FROM facts WHERE subject >= ? AND subject < ? GROUP BY document_id",
        MIN_YEAR_BUILT, max_year, MAX_AREA_SF, MAX_VALUE_USD, MIN_TAX_YEAR, max_year, *_PARCEL):
        implausible[r["document_id"]] = {k: (r[k] or 0) for k in
                                         ("year_built", "area", "value", "tax_year", "out_of_scope_category")}

    # Owner facts the privacy rule reads as a natural person (must be zero).
    persons: dict[str, dict[str, Any]] = {}
    for r in q(
        "SELECT document_id, COUNT(*) n, SUM(fl_is_org(value_json) = 0) persons FROM facts "
        "WHERE subject >= ? AND subject < ? AND predicate = 'ownership.owner_of_record' GROUP BY document_id",
        *_PARCEL):
        persons[r["document_id"]] = {"owner_facts": r["n"], "person_like": r["persons"] or 0}
    for doc, p in persons.items():
        if p["person_like"]:
            p["sample_parcels"] = [x["subject"] for x in q(
                "SELECT subject FROM facts WHERE subject >= ? AND subject < ? AND document_id = ? "
                "AND predicate = 'ownership.owner_of_record' AND fl_is_org(value_json) = 0 LIMIT 5", *_PARCEL, doc)]
    orphan_mailing = {r["document_id"]: r["n"] for r in q(
        "SELECT m.document_id, COUNT(*) n FROM facts m WHERE m.subject >= ? AND m.subject < ? "
        "AND m.predicate = 'ownership.owner_mailing_address' AND NOT EXISTS (SELECT 1 FROM facts o "
        "WHERE o.subject = m.subject AND o.predicate = 'ownership.owner_of_record' AND o.document_id = m.document_id) "
        "GROUP BY m.document_id", *_PARCEL)}

    # Citations over every fact (parcels and entities): one pass over the table.
    cite = {r["document_id"]: dict(r) for r in q(
        "SELECT f.document_id AS document_id, COUNT(*) facts, "
        "SUM(f.locator IS NULL OR TRIM(f.locator) = '') no_locator, "
        f"SUM(f.as_of IS NULL OR f.as_of NOT GLOB '{_ISO_GLOB}') bad_as_of, "
        "SUM(f.method IS NULL OR f.method = '') no_method, "
        "SUM(s.document_id IS NULL) no_snapshot, "
        "SUM(s.as_of IS NOT NULL AND f.as_of != s.as_of) as_of_differs_from_snapshot "
        "FROM facts f LEFT JOIN snapshots s ON s.document_id = f.document_id GROUP BY f.document_id")}

    # Links.
    links: dict[str, dict[str, Any]] = {}
    link_rows = q(
        "SELECT r.document_id AS document_id, r.basis AS basis, r.confidence AS confidence, "
        "COUNT(*) n, COUNT(DISTINCT r.to_urn) parcels FROM relationships r WHERE r.type = 'owns' GROUP BY 1, 2, 3")
    for r in link_rows:
        d = links.setdefault(r["document_id"], {"links": 0, "no_basis": 0, "no_snapshot": 0,
                                                "by_rule": Counter(), "by_confidence": Counter()})
        d["links"] += r["n"]
        if not (r["basis"] or "").strip():
            d["no_basis"] += r["n"]
        if r["document_id"] not in snap_by_doc:
            d["no_snapshot"] += r["n"]
        d["by_rule"][_link_rule(r["basis"])] += r["n"]
        d["by_confidence"][_confidence_bucket(r["confidence"])] += r["n"]
    linked_current = {r["document_id"]: r["n"] for r in q(
        "SELECT r.document_id AS document_id, COUNT(DISTINCT r.to_urn) n FROM relationships r "
        "WHERE r.type = 'owns' AND EXISTS (SELECT 1 FROM current_facts cf WHERE cf.subject = r.to_urn "
        "AND cf.predicate = 'ownership.owner_of_record' AND cf.document_id = r.document_id) GROUP BY 1")}
    org_current = {r["document_id"]: r["n"] for r in q(
        "SELECT document_id, COUNT(DISTINCT subject) n FROM current_facts WHERE subject >= ? AND subject < ? "
        "AND predicate = 'ownership.owner_of_record' GROUP BY document_id", *_PARCEL)}

    person_named_entities: dict[str, int] = {}
    if entity_names:
        for r in q("SELECT c.document_id, SUM(fl_is_org_name(s.label) = 0) n FROM coverage c JOIN subjects s ON s.urn = c.subject "
                   "WHERE c.subject >= ? AND c.subject < ? GROUP BY c.document_id", *_ENTITY):
            person_named_entities[r["document_id"]] = r["n"] or 0

    # Lookup tables: every parcel with an account should resolve by it, every parcel with an address by it.
    crosswalked = {r["c"]: r["n"] for r in q(
        "SELECT substr(urn, 11, 8) c, COUNT(DISTINCT urn) n FROM crosswalk WHERE urn >= ? AND urn < ? GROUP BY 1", *_PARCEL)}
    address_indexed = {r["c"]: r["n"] for r in q(
        "SELECT substr(urn, 11, 8) c, COUNT(DISTINCT urn) n FROM address_index WHERE urn >= ? AND urn < ? GROUP BY 1",
        *_PARCEL)}

    # Which states have an entity registry loaded (a parcel there can be linked).
    # Entity URNs read 'fl:entity:us-ny:<number>': two letters after 'us-'.
    entity_states = {r["st"]: r["n"] for r in q(
        "SELECT substr(urn, 14, 2) st, COUNT(*) n FROM subjects WHERE urn >= ? AND urn < ? GROUP BY 1", *_ENTITY)
        if r["st"] in set(STATE_BY_FIPS.values())}

    # Review queue by county.
    review: dict[str, dict[str, Any]] = defaultdict(lambda: {"pending": 0, "accepted": 0, "rejected": 0,
                                                              "pending_by_rule": Counter(), "pending_owners": 0})
    if _has_table(db, "owner_match_review"):
        seen_owner: set[tuple[str, str]] = set()
        for r in q("SELECT owner_key, parcel_urn, status, reason FROM owner_match_review"):
            county = r["parcel_urn"][10:18]
            d = review[county]
            d[r["status"]] += 1
            if r["status"] == "pending":
                try:
                    rule = json.loads(r["reason"]).get("rule", "unknown")
                except ValueError:
                    rule = "unknown"
                d["pending_by_rule"][rule] += 1
                if (county, r["owner_key"]) not in seen_owner:
                    seen_owner.add((county, r["owner_key"]))
                    d["pending_owners"] += 1

    # Assemble per source.
    report_sources: list[dict[str, Any]] = []
    violations: list[str] = []
    warnings: list[str] = []
    for source_id in sorted(sources.keys() | {s["source_id"] for s in snaps}):
        src = sources.get(source_id, {})
        docs = [s for s in snaps if s["source_id"] == source_id]
        kinds = {"parcels" if cover[s["document_id"]]["parcels"] else "entities" if cover[s["document_id"]]["entities"]
                 else "empty" for s in docs}
        kind = "parcels" if "parcels" in kinds else "entities" if "entities" in kinds else "empty"
        entry: dict[str, Any] = {
            "source_id": source_id,
            "kind": kind,
            "publisher": src.get("publisher"),
            "url": src.get("url"),
            "license": src.get("license"),
            "ai_use": src.get("ai_use"),
            "redistribution": src.get("redistribution"),
            "terms_reviewed": src.get("terms_reviewed"),
            "state_fips": src.get("state_fips"),
            "county_fips": src.get("county_fips"),
            "snapshots": [],
            "findings": [],
        }
        find = entry["findings"]
        if not src:
            find.append(("violation", "snapshots exist for a source that has no sources row"))
        else:
            for col in ("url", "license"):
                if not (src.get(col) or "").strip():
                    find.append(("violation", f"source has no {col}"))
            if not src.get("terms_reviewed"):
                find.append(("warning", "source has no terms_reviewed date"))
        totals = Counter()
        for s in docs:
            doc = s["document_id"]
            c = cover[doc]
            cs = cite.get(doc, {"facts": 0, "no_locator": 0, "bad_as_of": 0, "no_method": 0, "no_snapshot": 0,
                                "as_of_differs_from_snapshot": 0})
            age = _age_days(s["as_of"], today)
            snap_entry: dict[str, Any] = {
                "document_id": doc, "filename": s["filename"], "bytes": s["bytes"], "as_of": s["as_of"],
                "retrieved_at": s["retrieved_at"], "age_days": age,
                "document_id_is_sha256": bool(DOCUMENT_ID.match(doc)),
                "parcels": c["parcels"], "entities": c["entities"], "facts": cs["facts"],
            }
            entry["snapshots"].append(snap_entry)
            if not snap_entry["document_id_is_sha256"]:
                find.append(("violation", f"snapshot {doc[:40]} is not a sha256 content address"))
            if age is None:
                find.append(("violation", f"snapshot {doc[-8:]} has no valid as_of ({s['as_of']!r})"))
            elif age > STALE_AFTER_DAYS:
                find.append(("warning", f"snapshot {doc[-8:]} is {age} days old (as_of {s['as_of']})"))
            for k in ("parcels", "entities", "facts"):
                totals[k] += snap_entry[k]
            totals["no_locator"] += cs["no_locator"]
            totals["bad_as_of"] += cs["bad_as_of"]
            totals["no_method"] += cs["no_method"]
            totals["no_snapshot"] += cs["no_snapshot"]
            totals["as_of_differs"] += cs["as_of_differs_from_snapshot"]
            totals["absent"] += c["absent"]
            totals["bad_loc_parcels"] += bad_loc_parcels.get(doc, 0)
            totals["bad_date_parcels"] += bad_date_parcels.get(doc, 0)
            totals["orphan_mailing"] += orphan_mailing.get(doc, 0)
            totals["persons"] += persons.get(doc, {}).get("person_like", 0)
            totals["owner_facts"] += persons.get(doc, {}).get("owner_facts", 0)
            totals["org_current_parcels"] += org_current.get(doc, 0)
            totals["linked_current_parcels"] += linked_current.get(doc, 0)
            totals["links"] += links.get(doc, {}).get("links", 0)
            totals["links_no_basis"] += links.get(doc, {}).get("no_basis", 0)
            totals["links_no_snapshot"] += links.get(doc, {}).get("no_snapshot", 0)

        if kind == "parcels":
            p = totals["parcels"]
            fields: dict[str, Any] = {}
            conflicting = 0
            for name, predicate in PARCEL_FIELDS.items():
                have = sum(pred[s["document_id"]].get(predicate, {}).get("parcels", 0) for s in docs)
                extra = sum(pred[s["document_id"]].get(predicate, {}).get("facts", 0)
                            - pred[s["document_id"]].get(predicate, {}).get("parcels", 0) for s in docs)
                fields[name] = {"parcels": have, "missing": p - have, "pct_present": _pct(have, p)}
                conflicting += extra
            entry["parcels"] = {
                "count": p,
                "absent_from_latest_snapshot": totals["absent"],
                "fields": fields,
                "missing_address": p - fields["situs_address"]["parcels"],
                "no_organisation_owner": p - fields["owner_of_record"]["parcels"],
                "missing_as_of": totals["bad_date_parcels"],
                "conflicting_facts": conflicting,
            }
            entry["implausible_facts"] = {
                k: sum(implausible.get(s["document_id"], {}).get(k, 0) for s in docs)
                for k in ("year_built", "area", "value", "tax_year", "out_of_scope_category")}
            for k, n in entry["implausible_facts"].items():
                if n:
                    find.append(("warning", f"{n} parcels have an implausible {k.replace('_', ' ')}"))
            entry["owners"] = {"owner_facts": totals["owner_facts"], "person_like": totals["persons"],
                               "orphan_mailing_addresses": totals["orphan_mailing"]}
            sample = [x for s in docs for x in persons.get(s["document_id"], {}).get("sample_parcels", [])][:5]
            if sample:
                entry["owners"]["sample_parcels"] = sample
            if totals["persons"]:
                find.append(("violation", f"{totals['persons']} owner-of-record facts read as natural persons"))
            if totals["orphan_mailing"]:
                find.append(("violation", f"{totals['orphan_mailing']} owner mailing addresses with no owner fact"))
            if conflicting:
                find.append(("violation", f"{conflicting} extra facts: parcels with two different values for one "
                                          "single-valued fact in one document"))
            if p and entry["parcels"]["missing_address"] / p > MISSING_ADDRESS_WARN:
                find.append(("warning", f"{entry['parcels']['missing_address']} of {p} parcels have no situs address"))
            if totals["bad_date_parcels"]:
                find.append(("violation", f"{totals['bad_date_parcels']} parcels have a fact with no valid as_of"))

            counties = sorted({sub for sub in _counties_of(db, [s["document_id"] for s in docs])})
            entry["counties"] = counties
            entry["lookups"] = {
                "parcels_with_account_crosswalk": sum(crosswalked.get(c, 0) for c in counties),
                "parcels_with_address_index": sum(address_indexed.get(c, 0) for c in counties),
            }
            lacking = fields["situs_address"]["parcels"] - entry["lookups"]["parcels_with_address_index"]
            if lacking > 0:
                find.append(("violation", f"{lacking} parcels with a situs address are missing from the address index"))
            # Owner links.
            states = {STATE_BY_FIPS.get(c[3:5]) for c in counties}
            have_registry = sorted(st for st in states if st in entity_states)
            org = totals["org_current_parcels"]
            linked = totals["linked_current_parcels"]
            lk: dict[str, Any] = {
                "organisation_owner_parcels": org,
                "linked_parcels": linked,
                "link_rate_pct": _pct(linked, org),
                "entity_registry_loaded_for": have_registry,
                "by_rule": dict(sum((links.get(s["document_id"], {}).get("by_rule", Counter()) for s in docs),
                                    Counter())),
                "by_confidence": dict(sum((links.get(s["document_id"], {}).get("by_confidence", Counter())
                                           for s in docs), Counter())),
            }
            if not have_registry:
                lk["link_rate_pct"] = None
                lk["note"] = "no entity registry is loaded for this state, so owners cannot be linked"
            else:
                lk["unlinked"] = _unlinked_breakdown(db, [s["document_id"] for s in docs])
                if org and linked / org < LOW_LINK_RATE:
                    find.append(("warning", f"owner link rate {_pct(linked, org)}% with an entity registry loaded"))
            entry["links"] = lk
            rv = {"pending": 0, "accepted": 0, "rejected": 0, "pending_owners": 0, "pending_by_rule": Counter()}
            for county in counties:
                d = review.get(county)
                if d:
                    for k in ("pending", "accepted", "rejected", "pending_owners"):
                        rv[k] += d[k]
                    rv["pending_by_rule"].update(d["pending_by_rule"])
            rv["pending_by_rule"] = dict(rv["pending_by_rule"])
            entry["review_queue"] = rv
        elif kind == "entities":
            entry["entities"] = {"count": totals["entities"]}
            if entity_names:
                entry["entities"]["names_read_as_persons"] = sum(person_named_entities.get(s["document_id"], 0) for s in docs)

        entry["citations"] = {
            "facts": totals["facts"],
            "without_locator": totals["no_locator"],
            "without_valid_as_of": totals["bad_as_of"],
            "without_method": totals["no_method"],
            "document_not_a_snapshot": totals["no_snapshot"],
            "as_of_differs_from_snapshot": totals["as_of_differs"],
            "links": totals["links"],
            "links_without_basis": totals["links_no_basis"],
            "links_document_not_a_snapshot": totals["links_no_snapshot"],
        }
        for key, label in (("no_locator", "facts have no record locator"), ("bad_as_of", "facts have no valid as_of"),
                           ("no_method", "facts have no method"),
                           ("no_snapshot", "facts cite a document that is not a snapshot"),
                           ("as_of_differs", "facts carry a different as_of than their snapshot"),
                           ("links_no_basis", "links have no basis"),
                           ("links_no_snapshot", "links cite a document that is not a snapshot")):
            if totals[key]:
                find.append(("violation", f"{totals[key]} {label}"))

        if reread:
            entry["source_file"] = _reread(source_id, docs, cover, collected, files)
            for r in entry["source_file"]:
                if r.get("matches_registry") is False:
                    find.append(("violation", f"{r['file']}: the adapter yields {r['records_in_scope']} in-scope "
                                              f"records ({r.get('distinct_parcel_ids')} distinct IDs) but the "
                                              f"registry holds {r['registry_parcels']}"))
                if r.get("header_like_apns"):
                    find.append(("violation", f"{r['file']}: APNs that look like column headings: {r['header_like_apns']}"))
                if r.get("distinct_apns") is not None and r["distinct_apns"] != r["distinct_parcel_ids"] + r.get("invalid_apns", 0):
                    find.append(("warning", f"{r['file']}: {r['distinct_apns']} distinct APNs normalize to "
                                            f"{r['distinct_parcel_ids']} parcel IDs"))
        report_sources.append(entry)

    # Global checks.
    orphan_docs = sorted(d for d in cite if d not in snap_by_doc)
    stats = {
        "parcels": one("SELECT COUNT(*) FROM subjects WHERE urn >= ? AND urn < ?", *_PARCEL),
        "entities": one("SELECT COUNT(*) FROM subjects WHERE urn >= ? AND urn < ?", *_ENTITY),
        "facts": sum(c["facts"] for c in cite.values()),
        "links": one("SELECT COUNT(*) FROM relationships WHERE type = 'owns'"),
        "snapshots": len(snaps),
        "review_pending": one("SELECT COUNT(*) FROM owner_match_review WHERE status = 'pending'")
        if _has_table(db, "owner_match_review") else 0,
    }
    for e in report_sources:
        for sev, msg in e.pop("findings"):
            (violations if sev == "violation" else warnings).append(f"{e['source_id']}: {msg}")
            e.setdefault("findings", []).append({"severity": sev, "message": msg})
        e.setdefault("findings", [])
    if orphan_docs:
        violations.append(f"facts cite {len(orphan_docs)} documents that are not snapshots")
    orphan_links = sum(d["links"] for doc, d in links.items() if doc not in snap_by_doc)
    if orphan_links:
        violations.append(f"{orphan_links} ownership links cite a document that is not a snapshot")
    return {
        "database": path.name,
        "audited_on": today.isoformat(),
        "stats": stats,
        "entity_registries_by_state": entity_states,
        "sources": report_sources,
        "violations": violations,
        "warnings": warnings,
    }


def _counties_of(db: sqlite3.Connection, docs: list[str]) -> set[str]:
    """Parcel county codes (``us-48201``) covered by these documents."""
    out: set[str] = set()
    marks = ",".join("?" * len(docs))
    for r in db.execute("SELECT DISTINCT substr(subject, 11, 8) c FROM coverage WHERE subject >= ? AND subject < ? "
                        f"AND document_id IN ({marks})", (*_PARCEL, *docs)):
        out.add(r["c"])
    return out


def _unlinked_breakdown(db: sqlite3.Connection, docs: list[str]) -> dict[str, int]:
    """Why current organisation owners have no link, counted in parcels.

    ``public_body_not_registered``: a city, county, school or special district, which no business registry
    lists; ``exact_name_in_another_state_queued``: an entity with exactly this name exists, but not in a state that could be
    the owner's; ``fuzzy_candidates_queued``: near matches wait for a reviewer; ``exact_name_ambiguous_or_unplausible``:
    exact names exist and none was chosen; ``no_exact_name``: nothing in the loaded registries has this name.
    """
    marks = ",".join("?" * len(docs))
    rows = db.execute(
        "SELECT cf.value_json AS v, COUNT(DISTINCT cf.subject) n FROM current_facts cf "
        "WHERE cf.subject >= ? AND cf.subject < ? AND cf.predicate = 'ownership.owner_of_record' "
        f"AND cf.document_id IN ({marks}) AND NOT EXISTS (SELECT 1 FROM relationships r WHERE r.to_urn = cf.subject "
        "AND r.type = 'owns' AND r.document_id = cf.document_id) GROUP BY cf.value_json", (*_PARCEL, *docs)).fetchall()
    queued: dict[str, set[str]] = defaultdict(set)
    if _has_table(db, "owner_match_review"):
        for r in db.execute("SELECT owner_key, reason FROM owner_match_review WHERE status = 'pending'"):
            try:
                queued[r["owner_key"]].add(json.loads(r["reason"]).get("rule", ""))
            except ValueError:
                pass
    out: Counter[str] = Counter()
    for r in rows:
        key = normalize_name(json.loads(r["v"]))
        n = r["n"]
        exact = db.execute("SELECT 1 FROM name_index n JOIN subjects s ON s.urn = n.urn WHERE n.key = ? "
                           "AND s.kind = 'entity' LIMIT 1", (key,)).fetchone()
        rules = queued.get(key, set())
        if "exact_name_other_state" in rules:
            out["exact_name_in_another_state_queued"] += n
        elif rules:
            out["fuzzy_candidates_queued"] += n
        elif exact:
            out["exact_name_ambiguous_or_unplausible"] += n
        elif _PUBLIC_BODY.search(key):
            out["public_body_not_registered"] += n
        else:
            out["no_exact_name"] += n
    return dict(out)


def _reread(source_id: str, docs: list[dict[str, Any]], cover: dict[str, dict[str, int]],
            collected: str | Path | None, files: dict[str, list[str]]) -> list[dict[str, Any]]:
    mod = adapter_for(source_id)
    out: list[dict[str, Any]] = []
    explicit = {Path(p).name: Path(p) for p in files.get(source_id, [])}
    for s in docs:
        path = explicit.get(s["filename"] or "")
        if path is None and collected:
            path = locate_snapshot_file(collected, source_id, s["document_id"], s["filename"])
        entry: dict[str, Any] = {"file": s["filename"], "document_id": s["document_id"][-12:]}
        if mod is None:
            entry["error"] = "no adapter registered for this source"
        elif path is None or not path.exists():
            entry["error"] = "archived file not found"
        else:
            try:
                entry.update(reread_source_file(mod, path))
            except Exception as e:  # report, do not abort the audit
                entry["error"] = f"{type(e).__name__}: {e}"
            held = cover[s["document_id"]]["parcels"] or cover[s["document_id"]]["entities"]
            entry["registry_parcels"] = held
            if "records_in_scope" in entry and "error" not in entry:
                expected = entry.get("distinct_parcel_ids", entry["records_in_scope"])
                entry["matches_registry"] = expected == held
        out.append(entry)
    return out


# --- output -----------------------------------------------------------------------------------


def render_markdown(report: dict[str, Any]) -> str:
    lines = [f"# Registry audit: {report['database']} ({report['audited_on']})", ""]
    st = report["stats"]
    lines += [f"{st['parcels']:,} parcels, {st['entities']:,} entities, {st['facts']:,} facts, {st['links']:,} "
              f"ownership links, {st['snapshots']} snapshots, {st['review_pending']:,} pending reviews.", ""]
    lines += ["| Source | Parcels | Missing address | No org owner | Persons | Link rate | Review | As of (age) | Citation gaps |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |"]
    for e in report["sources"]:
        c = e["citations"]
        gaps = (c["without_locator"] + c["without_valid_as_of"] + c["without_method"] + c["document_not_a_snapshot"]
                + c["links_without_basis"] + c["links_document_not_a_snapshot"])
        ages = ", ".join(f"{s['as_of']} ({s['age_days']} d)" for s in e["snapshots"][:2]) + (" ..." if len(e["snapshots"]) > 2 else "")
        if e["kind"] == "parcels":
            p, lk = e["parcels"], e["links"]
            rate = "n/a" if lk["link_rate_pct"] is None else f"{lk['link_rate_pct']}%"
            lines.append(f"| {e['source_id']} | {p['count']:,} | {p['missing_address']:,} | {p['no_organisation_owner']:,} "
                         f"| {e['owners']['person_like']} | {rate} | {e['review_queue']['pending']:,} | {ages} | {gaps} |")
        else:
            n = e.get("entities", {}).get("count", 0)
            lines.append(f"| {e['source_id']} | {n:,} entities | | | | | | {ages} | {gaps} |")
    lines.append("")
    for title, items in (("Violations", report["violations"]), ("Warnings", report["warnings"])):
        lines.append(f"## {title} ({len(items)})")
        lines += [f"- {i}" for i in items] or ["- none"]
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.audit", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db", nargs="+", help="registry SQLite file(s) to audit (read only)")
    ap.add_argument("--today", help="audit date, YYYY-MM-DD (default: today, UTC)")
    ap.add_argument("--collected", help="collector output directory (<source>/<sha16>/<file>); with --reread, "
                                        "snapshot files are found there")
    ap.add_argument("--reread", action="store_true",
                    help="re-run each source's adapter on its archived file and compare counts (slow on large files)")
    ap.add_argument("--files", help="JSON file mapping source_id to a list of archived file paths (overrides --collected)")
    ap.add_argument("--entity-names", action="store_true",
                    help="also count registered entities whose legal name reads as a person (slow; informational)")
    ap.add_argument("--format", choices=("json", "markdown"), default="json")
    ap.add_argument("--out", help="write the report here instead of stdout")
    args = ap.parse_args(argv)
    today = date.fromisoformat(args.today) if args.today else None
    files = json.loads(Path(args.files).read_text()) if args.files else None
    reports = [audit_db(p, today=today, collected=args.collected, files=files, reread=args.reread,
                        entity_names=args.entity_names) for p in args.db]
    body = json.dumps(reports if len(reports) > 1 else reports[0], indent=2, sort_keys=True) if args.format == "json" \
        else "\n".join(render_markdown(r) for r in reports)
    if args.out:
        Path(args.out).write_text(body + "\n")
    else:
        print(body)
    return 1 if any(r["violations"] for r in reports) else 0


if __name__ == "__main__":
    sys.exit(main())
