"""The FactLot Registry: a SQLite store of cited public-record facts about commercial property.

Every fact cites a content-addressed snapshot of the source file and the record it came from,
and carries the source's license and AI-use rights. Ingest is idempotent: re-ingesting the same
snapshot changes nothing; a newer snapshot adds newer facts, and reads return the latest.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib import resources
from pathlib import Path
from typing import Any, Iterable

from ..ids import FactLotIdError, _base32, entity_id, parcel_id, short_id
from .normalize import (
    NAME_KEY_VERSION,
    NAME_OVERLAP_WEIGHT,
    NAME_RATIO_WEIGHT,
    address_state,
    distinctive_tokens,
    entity_standing,
    entity_state,
    is_commercial,
    is_organization,
    legacy_name_key,
    name_similarity,
    normalize_address,
    normalize_name,
    parcel_state,
)

PRODUCER = "factlot.registry"
SCHEMA_VERSION = "2"

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


def file_document_id(path: str | Path) -> tuple[str, int]:
    """Content-addressed FactLot document ID of a (possibly large) file, streamed."""
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            size += len(chunk)
    return f"fl:document:sha256-{h.hexdigest()}", size


# An ownership link is current only while the owner-of-record fact it was inferred from is current.
_CURRENT_LINK = (
    "(r.type != 'owns' OR EXISTS (SELECT 1 FROM current_facts cf WHERE cf.subject = r.to_urn "
    "AND cf.predicate = 'ownership.owner_of_record' AND cf.document_id = r.document_id))"
)


def _fact_id(subject: str, predicate: str, value_json: str, document_id: str) -> str:
    digest = hashlib.sha256("\x1f".join((subject, predicate, value_json, document_id)).encode()).digest()
    return f"flf_{_base32(digest, 24)}"


class Registry:
    def __init__(self, path: str | Path = ":memory:") -> None:
        self.db = sqlite3.connect(str(path))
        self.db.row_factory = sqlite3.Row
        # Every statement in schema.sql is IF NOT EXISTS, so opening an older file adds the newer
        # tables without touching existing ones; the version records which tables to expect.
        self.db.executescript(resources.files("factlot.registry").joinpath("schema.sql").read_text("utf-8"))
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('schema_version', ?)", (SCHEMA_VERSION,))
        self.db.commit()

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
        if value is None or value == "":
            return 0
        value_json = json.dumps(value, sort_keys=True)
        cur = self.db.execute(
            "INSERT OR IGNORE INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)",
            (_fact_id(subject, predicate, value_json, snap.document_id), subject, predicate, value_json,
             unit, snap.as_of, method, confidence, snap.document_id, locator),
        )
        return cur.rowcount

    def _cover(self, subject: str, snap: Snapshot) -> None:
        self.db.execute("INSERT OR REPLACE INTO coverage VALUES (?,?,?,?,1)",
                        (subject, snap.source_id, snap.as_of, snap.document_id))

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
        changes: list[tuple[str, str, str]] = []
        scanned = 0
        for row in self.db.execute(
                "SELECT n.key, n.urn, s.label FROM name_index n JOIN subjects s ON s.urn = n.urn "
                "WHERE s.kind = 'entity' AND s.label IS NOT NULL"):
            scanned += 1
            new = normalize_name(row["label"])
            if new != row["key"] and legacy_name_key(row["label"]) == row["key"]:
                changes.append((row["key"], row["urn"], new))
        for old, urn, new in changes:
            self.db.execute("DELETE FROM name_index WHERE key = ? AND urn = ?", (old, urn))
            self.db.execute("INSERT OR IGNORE INTO name_index VALUES (?,?)", (new, urn))
            if self._has_table("name_tokens"):
                self.db.execute("DELETE FROM name_tokens WHERE urn = ? AND key = ?", (urn, old))
                self._index_name_tokens(new, urn)
        self.db.execute("INSERT OR REPLACE INTO meta VALUES ('name_key_version', ?)", (NAME_KEY_VERSION,))
        self.db.commit()
        return {"scanned": scanned, "rekeyed": len(changes)}

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

    def ingest_parcels(self, records: Iterable[ParcelRecord], snap: Snapshot, *, state_fips: str,
                       account_system: str | None = None, include_all_categories: bool = False,
                       full_roll: bool = False) -> IngestStats:
        """Ingest appraisal-roll records. Out-of-scope (non-commercial) parcels are skipped by default.

        With ``full_roll=True`` the snapshot is treated as the complete roll for its source: parcels
        an earlier snapshot of the same source covered but this one does not list (or lists as out of
        scope — sold, split, merged, reclassified) are retired, so their facts become history.
        """
        stats = IngestStats()
        for r in records:
            stats.seen += 1
            if not include_all_categories and not is_commercial(r.state_category):
                stats.skipped_out_of_scope += 1
                continue
            try:
                urn = parcel_id(state_fips, r.county_fips, r.apn).urn
            except FactLotIdError as e:
                stats.skipped_invalid += 1
                stats.errors.append(f"{r.locator or r.apn}: {e}")
                continue
            stats.kept += 1
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
            if account_system and r.account:
                self.db.execute("INSERT OR REPLACE INTO crosswalk VALUES (?,?,?)", (account_system, r.account, urn))
            if r.situs_address:
                self.db.execute("INSERT OR IGNORE INTO address_index VALUES (?,?)", (normalize_address(r.situs_address), urn))

            # Owner of record — organisations only; persons and withheld owners are not stored (policy §3).
            if r.owner_confidential or not r.owner_name or not is_organization(r.owner_name):
                if r.owner_name or r.owner_confidential:
                    stats.owners_person_or_withheld += 1
                stats.facts_written += n
                continue
            n += self._fact(urn, "ownership.owner_of_record", r.owner_name.strip(), snap, locator=loc)
            n += self._fact(urn, "ownership.owner_mailing_address", r.owner_mailing_address, snap, locator=loc)
            stats.facts_written += n
        if full_roll:
            stats.retired = self._retire_absent(snap)
        self.db.commit()
        return stats

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

    def status(self, urn: str) -> str:
        """'current', or 'not_in_latest_snapshot' when the latest full snapshot of every covering source omitted it."""
        rows = self.db.execute(
            "SELECT c.present FROM coverage c WHERE c.subject = ? AND c.as_of = "
            "(SELECT MAX(as_of) FROM coverage d WHERE d.subject = c.subject AND d.source_id = c.source_id)", (urn,)).fetchall()
        return "current" if any(r["present"] for r in rows) or not rows else "not_in_latest_snapshot"

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

    # --- fuzzy owner matching with human review (backlog C2) --------------------------------------

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

    def facts(self, urn: str, *, history: bool = False) -> list[dict[str, Any]]:
        """FactLot facts about a subject: current ones by default (coverage rule), or the full history."""
        table = "facts" if history else "current_facts"
        rows = self.db.execute(
            f"SELECT * FROM {table} WHERE subject = ? ORDER BY predicate, as_of DESC, fact_id", (urn,)).fetchall()
        out, seen = [], set()
        for f in rows:
            if not history and f["predicate"] in seen:  # two current sources disagree: keep the newest
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
        return out

    def get(self, urn: str) -> dict[str, Any] | None:
        subj = self.db.execute("SELECT * FROM subjects WHERE urn = ?", (urn,)).fetchone()
        if subj is None:
            return None
        rels = [dict(r) for r in self.db.execute(
            f"SELECT from_urn, type, to_urn, as_of, method, confidence, basis, document_id FROM relationships r "
            f"WHERE (from_urn = ? OR to_urn = ?) AND {_CURRENT_LINK} ORDER BY as_of DESC", (urn, urn))]
        xw = [dict(r) for r in self.db.execute("SELECT system, external_id FROM crosswalk WHERE urn = ?", (urn,))]
        return {"urn": urn, "kind": subj["kind"], "short": subj["short"], "label": subj["label"],
                "status": self.status(urn), "facts": self.facts(urn), "relationships": rels, "crosswalk": xw}

    def resolve_parcel(self, state_fips: str, county_fips: str, apn: str) -> str | None:
        urn = parcel_id(state_fips, county_fips, apn).urn
        return urn if self.db.execute("SELECT 1 FROM subjects WHERE urn = ?", (urn,)).fetchone() else None

    def resolve_external(self, system: str, external_id: str) -> str | None:
        row = self.db.execute("SELECT urn FROM crosswalk WHERE system = ? AND external_id = ?", (system, external_id)).fetchone()
        return row["urn"] if row else None

    def search_entities(self, name: str, limit: int = 20) -> list[dict[str, Any]]:
        key = normalize_name(name)
        rows = self.db.execute(
            "SELECT DISTINCT s.urn, s.label FROM name_index n JOIN subjects s ON s.urn = n.urn "
            "WHERE s.kind = 'entity' AND n.key LIKE ? ORDER BY (n.key = ?) DESC, s.label LIMIT ?",
            (f"%{key}%", key, limit)).fetchall()
        return [dict(r) for r in rows]

    def search_address(self, address: str, limit: int = 20) -> list[dict[str, Any]]:
        key = normalize_address(address)
        rows = self.db.execute(
            "SELECT DISTINCT s.urn, s.label FROM address_index a JOIN subjects s ON s.urn = a.urn "
            "WHERE a.key LIKE ? ORDER BY (a.key = ?) DESC, s.label LIMIT ?", (f"%{key}%", key, limit)).fetchall()
        return [dict(r) for r in rows]

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
        The parcel and its other facts stay. Run it once after upgrading; it is idempotent.
        """
        result = {"owner_facts": 0, "mailing_facts": 0, "ownership_links": 0, "review_rows": 0}
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
