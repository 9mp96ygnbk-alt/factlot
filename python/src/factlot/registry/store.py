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
from .normalize import is_commercial, is_organization, normalize_address, normalize_name

PRODUCER = "factlot.registry"


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
        self.db.executescript(resources.files("factlot.registry").joinpath("schema.sql").read_text("utf-8"))
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('schema_version', '1')")
        self.db.commit()

    @classmethod
    def open_readonly(cls, path: str | Path) -> "Registry":
        """Open an existing registry file for queries only (as the agent tools do)."""
        if not Path(path).exists():
            raise FileNotFoundError(f"no registry file at {path}")
        reg = cls.__new__(cls)
        reg.db = sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro", uri=True)
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
            self.db.execute("INSERT OR IGNORE INTO name_index VALUES (?,?)", (normalize_name(r.legal_name), urn))
        self.db.commit()
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

        Run after any ingest (order of datasets doesn't matter). A link is made only when the
        normalized owner name equals exactly one entity's normalized legal name; it is labelled
        ``inferred`` with confidence 0.9. Ambiguous or unmatched names are left unlinked.
        """
        result = {"linked": 0, "ambiguous": 0, "unmatched": 0}
        owners = self.db.execute(
            "SELECT subject, value_json, as_of, document_id FROM current_facts "
            "WHERE predicate = 'ownership.owner_of_record'"
        ).fetchall()
        for o in owners:
            key = normalize_name(json.loads(o["value_json"]))
            candidates = [row["urn"] for row in self.db.execute(
                "SELECT n.urn FROM name_index n JOIN subjects s ON s.urn = n.urn WHERE n.key = ? AND s.kind = 'entity'",
                (key,))]
            if len(candidates) == 1:
                self.db.execute(
                    "INSERT OR IGNORE INTO relationships VALUES (?,?,?,?,?,?,?,?)",
                    (candidates[0], "owns", o["subject"], o["as_of"], "inferred", 0.9, o["document_id"],
                     "owner of record exactly matches one registered entity's normalized legal name"),
                )
                result["linked"] += 1
            elif candidates:
                result["ambiguous"] += 1
            else:
                result["unmatched"] += 1
        self.db.commit()
        return result

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

    def stats(self) -> dict[str, int]:
        q = lambda sql: self.db.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "parcels": q("SELECT COUNT(*) FROM subjects WHERE kind = 'parcel'"),
            "entities": q("SELECT COUNT(*) FROM subjects WHERE kind = 'entity'"),
            "facts": q("SELECT COUNT(*) FROM facts"),
            "ownership_links": q(f"SELECT COUNT(*) FROM relationships r WHERE type = 'owns' AND {_CURRENT_LINK}"),
            "snapshots": q("SELECT COUNT(*) FROM snapshots"),
        }
