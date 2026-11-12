"""Current ownership links when a district loads one registry source per roll year.

Every owner, account and value here is SYNTHETIC (invented organisations only). Each roll year keeps its
owner facts and links current in its own source; a reader shows the newest owner fact, and only the link
inferred from that fact's document is current. The older years' links are owner history.
"""

import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

import factlot
from factlot.registry import EntityRecord, ParcelRecord, Registry, Source
from factlot.registry import audit as audit_mod
from factlot.tools import configure_registry

DISTRICT = Source("test-cad-996", "Example Appraisal District (synthetic)", "Appraisal roll",
                  "https://example.invalid/cad-996", "48", county_fips="996", license="Synthetic test data",
                  ai_use="permitted", redistribution="permitted", terms_reviewed="2026-11-12")
OLD_OWNER, NEW_OWNER = "Example Holdings LLC", "Sample Ridge Partners LP"
OLD, NEW = "fl:entity:us-tx:0809000001", "fl:entity:us-tx:0809000002"


def parcel(apn: str) -> str:
    return f"fl:parcel:us-48996:{apn}"


def record(apn: str, owner: str, year: int) -> ParcelRecord:
    return ParcelRecord("996", apn, "F1", account=f"K{apn}", situs_address=f"{int(apn[-2:])} Beta Plaza, Example City TX 77001",
                        owner_name=owner, market_value=1000000 + year, tax_year=year)


def build(tmp: Path) -> Path:
    """Three roll years of one district, each its own source: 2000001 changes owner on the 2026 roll, 2000002
    keeps its owner, 2000003 is on the 2024 roll only."""
    db = tmp / "registry.db"
    reg = Registry(db)
    reg.add_source(Source("test-entities-996", "Example Secretary (synthetic)", "Entities", "https://example.invalid/e",
                          "48", license="Synthetic test data", ai_use="permitted", redistribution="permitted",
                          terms_reviewed="2026-11-12"))
    ents = tmp / "entities.csv"
    ents.write_text("synthetic entities")
    snap = reg.add_snapshot("test-entities-996", ents, as_of="2026-10-01", retrieved_at="2026-10-01T00:00:00+00:00")
    reg.ingest_entities([EntityRecord(OLD_OWNER, "us-tx", "0809000001", status="ACTIVE"),
                         EntityRecord(NEW_OWNER, "us-tx", "0809000002", status="ACTIVE")], snap)
    rolls = {
        2024: [record("2000001", OLD_OWNER, 2024), record("2000002", OLD_OWNER, 2024), record("2000003", OLD_OWNER, 2024)],
        2025: [record("2000001", OLD_OWNER, 2025), record("2000002", OLD_OWNER, 2025)],
        2026: [record("2000001", NEW_OWNER, 2026), record("2000002", OLD_OWNER, 2026)],
    }
    for year, records in rolls.items():
        path = tmp / f"roll-{year}.txt"
        path.write_text(f"synthetic roll {year}")
        reg.ingest_roll(DISTRICT, path, records, as_of=f"{year}-07-25", retrieved_at=f"{year}-07-25T00:00:00+00:00",
                        state_fips="48", account_system="test-cad-996-account", full_roll=True, base_year=2026)
    reg.link_owners()
    reg.close()
    return db


class OwnerLinkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = build(Path(tempfile.mkdtemp()))
        cls.reg = Registry(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.reg.close()

    def owners(self, urn: str, as_of: str | None = None) -> list[tuple[str, str]]:
        rec = self.reg.get(urn, as_of)
        return [(r["from_urn"], r["as_of"]) for r in rec["relationships"] if r["type"] == "owns"]

    def owner_fact(self, urn: str, as_of: str | None = None):
        return next(f["value"] for f in self.reg.facts(urn, as_of=as_of) if f["predicate"] == "ownership.owner_of_record")

    def test_every_roll_year_keeps_its_own_link(self):
        n = sqlite3.connect(self.db).execute(
            "SELECT COUNT(*) FROM relationships WHERE type = 'owns' AND to_urn = ?", (parcel("2000001"),)).fetchone()[0]
        self.assertEqual(n, 3, "prior-year links are kept as owner history")

    def test_owner_changed_between_years_shows_the_new_owner_only(self):
        self.assertEqual(self.owner_fact(parcel("2000001")), NEW_OWNER)
        self.assertEqual(self.owners(parcel("2000001")), [(NEW, "2026-07-25")])

    def test_owner_unchanged_across_years_is_linked_once(self):
        self.assertEqual(self.owners(parcel("2000002")), [(OLD, "2026-07-25")])

    def test_dated_lookup_returns_the_owner_on_the_latest_roll_by_then(self):
        self.assertEqual(self.owner_fact(parcel("2000001"), "2025-12-31"), OLD_OWNER)
        self.assertEqual(self.owners(parcel("2000001"), "2025-12-31"), [(OLD, "2025-07-25")])
        self.assertEqual(self.owners(parcel("2000001"), "2024-12-31"), [(OLD, "2024-07-25")])
        self.assertEqual(self.owners(parcel("2000001"), "2024-01-01"), [])

    def test_parcel_on_an_older_roll_only_keeps_that_rolls_owner(self):
        self.assertEqual(self.owners(parcel("2000003")), [(OLD, "2024-07-25")])

    def test_portfolio_lists_each_parcel_once_and_drops_a_parcel_sold(self):
        old = [o["urn"] for o in self.reg.parcels_owned_by(OLD)]
        self.assertEqual(old, sorted(set(old), key=old.index))
        self.assertEqual(sorted(old), [parcel("2000002"), parcel("2000003")])
        self.assertEqual([o["urn"] for o in self.reg.parcels_owned_by(NEW)], [parcel("2000001")])
        self.assertEqual(self.reg.stats()["ownership_links"], 3)

    def test_entity_record_lists_only_current_links(self):
        rels = self.reg.get(OLD)["relationships"]
        self.assertEqual(sorted(r["to_urn"] for r in rels), [parcel("2000002"), parcel("2000003")])

    def test_tools_answer_alike(self):
        configure_registry(str(self.db))
        try:
            got = factlot.run_tool("registry_owned_by", {"entity_urn": OLD})
            self.assertEqual(sorted(r["urn"] for r in got["results"]), [parcel("2000002"), parcel("2000003")])
            rec = factlot.run_tool("registry_get", {"urn": parcel("2000001")})
            self.assertEqual([r["from_urn"] for r in rec["relationships"]], [NEW])
        finally:
            configure_registry(None)

    def test_a_single_year_parcel_is_unchanged(self):
        tmp = Path(tempfile.mkdtemp())
        db = tmp / "one.db"
        reg = Registry(db)
        reg.add_source(Source("test-entities-995", "Example Secretary (synthetic)", "Entities", "https://example.invalid/e",
                              "48", license="Synthetic test data", ai_use="permitted", redistribution="permitted"))
        (tmp / "e.csv").write_text("synthetic entities 995")
        snap = reg.add_snapshot("test-entities-995", tmp / "e.csv", as_of="2026-10-01")
        reg.ingest_entities([EntityRecord(OLD_OWNER, "us-tx", "0809000001", status="ACTIVE")], snap)
        (tmp / "r.txt").write_text("synthetic roll 995")
        reg.ingest_roll(DISTRICT, tmp / "r.txt", [record("2000001", OLD_OWNER, 2026)], as_of="2026-07-25",
                        state_fips="48", full_roll=True, base_year=2026)
        reg.link_owners()
        self.assertEqual([(r["from_urn"], r["as_of"]) for r in reg.get(parcel("2000001"))["relationships"]],
                         [(OLD, "2026-07-25")])
        self.assertEqual([o["urn"] for o in reg.parcels_owned_by(OLD)], [parcel("2000001")])
        reg.close()


class OwnerLinkAuditTests(unittest.TestCase):
    TODAY = date(2026, 11, 12)

    def setUp(self):
        self.db = build(Path(tempfile.mkdtemp()))

    def test_multi_year_links_are_clean_under_the_rule(self):
        report = audit_mod.audit_db(self.db, today=self.TODAY)
        self.assertEqual(report["current_owner_links"],
                         {"parcels_with_several_owners": 0, "parcels_with_repeated_link": 0, "by_county": {}})
        self.assertFalse(any("current ownership links" in v for v in report["violations"]))

    def test_a_second_entity_linked_from_the_current_document_is_a_violation(self):
        db = sqlite3.connect(self.db)
        db.execute("INSERT INTO relationships SELECT ?, type, to_urn, as_of, method, confidence, document_id, basis "
                   "FROM relationships WHERE to_urn = ? AND from_urn = ?", (OLD, parcel("2000001"), NEW))
        db.commit()
        db.close()
        report = audit_mod.audit_db(self.db, today=self.TODAY)
        self.assertEqual(report["current_owner_links"]["by_county"],
                         {"us-48996": {"several_owners": 1, "repeated_link": 0}})
        self.assertIn("us-48996: 1 parcels have current ownership links from more than one entity", report["violations"])


if __name__ == "__main__":
    unittest.main()
