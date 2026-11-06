"""Row classification and ingest reconciliation.

Every parcel, owner and value below is SYNTHETIC. Reason codes must not echo an
owner name. The classifier does not mint ``flr1`` ids and does not drop a row the
registry already keeps.
"""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from factlot.registry import EntityRecord, ParcelRecord, Registry, Source
from factlot.registry.validate import (
    category_disposition,
    classify_parcel,
    neutralize_export_cell,
)

SRC = Source("test-county-roll", "Example County Appraisal District (synthetic)", "Appraisal roll",
             "https://example.invalid/roll", "48", county_fips="999", license="Synthetic test data",
             ai_use="permitted", redistribution="permitted", terms_reviewed="2026-11-02")
LIVE = Source("cc-by-example", "Example Publisher", "Roll", "https://publisher.example/roll", "11",
              county_fips="001", license="CC BY 4.0", ai_use="permitted", redistribution="attribution_required",
              terms_reviewed="2026-11-06")


def _write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text)
    return p


class Classify(unittest.TestCase):
    def test_unknown_category_is_not_called_residential(self):
        self.assertEqual(category_disposition("A"), "out_of_scope")
        self.assertEqual(category_disposition(""), "unknown")
        self.assertEqual(category_disposition(None), "unknown")
        self.assertEqual(category_disposition("COMMERCIAL"), "unknown")
        self.assertEqual(category_disposition("F1"), "in_scope")

    def test_bad_missing_and_duplicate_rows(self):
        rows = [
            ParcelRecord("999", "100", "F1", situs_address="1 Main St", owner_name="SECRET OWNER LLC",
                         market_value=10, year_built=1600, extra_facts=[("parcel.latitude", 0), ("parcel.longitude", 0)]),
            ParcelRecord("999", "100", "F1", situs_address="1 Main St", market_value=-5),
            ParcelRecord("999", "200", "A", owner_name="JANE PERSON"),
            ParcelRecord("999", "300", None, situs_address="3 Blank Class"),
            ParcelRecord("999", "--", "F1"),
            ParcelRecord("99", "400", "F1"),
            ParcelRecord("001", "ACCOUNT", "B"),
            ParcelRecord("001", "500", "F2", extra_facts=[("parcel.latitude", 38.9), ("parcel.longitude", -77.0)]),
        ]
        seen: set[str] = set()
        classes = []
        for row in rows:
            item = classify_parcel(row, state_fips="48", seen_urns=seen)
            classes.append(item)
            if item.urn and item.disposition == "keep":
                seen.add(item.urn)
        self.assertEqual(classes[0].disposition, "keep")
        self.assertIn("unknown_county", classes[0].reasons)
        self.assertIn("implausible_year", classes[0].reasons)
        self.assertIn("null_island", classes[0].reasons)
        self.assertNotIn("coordinates_present", classes[0].reasons)
        self.assertEqual(classes[1].disposition, "keep")
        self.assertIn("duplicate_identity", classes[1].reasons)
        self.assertIn("implausible_value", classes[1].reasons)
        self.assertEqual(classes[2].disposition, "skip_out_of_scope")
        self.assertIn("out_of_scope", classes[2].reasons)
        self.assertEqual(classes[3].disposition, "skip_out_of_scope")
        self.assertIn("unknown_category", classes[3].reasons)
        self.assertEqual(classes[4].disposition, "skip_invalid")
        self.assertEqual(classes[5].disposition, "skip_invalid")
        self.assertIn("malformed_county_fips", classes[5].reasons)
        self.assertEqual(classes[6].disposition, "keep")
        self.assertIn("header_like_apn", classes[6].reasons)
        self.assertIn("missing_address", classes[6].reasons)
        self.assertIn("coordinates_present", classes[7].reasons)
        blob = json.dumps([c.reasons for c in classes])
        self.assertNotIn("SECRET", blob)
        self.assertNotIn("JANE", blob)
        self.assertNotIn("flr1:", blob)

    def test_export_neutralizes_formulas_and_keeps_signed_numbers(self):
        self.assertEqual(neutralize_export_cell("=CMD()"), "'=CMD()")
        self.assertEqual(neutralize_export_cell("+1"), "'+1")
        self.assertEqual(neutralize_export_cell("@SUM(A1)"), "'@SUM(A1)")
        self.assertEqual(neutralize_export_cell("\tname"), "'\tname")
        self.assertEqual(neutralize_export_cell("-12.5"), "-12.5")
        self.assertEqual(neutralize_export_cell("-2+3"), "'-2+3")
        self.assertEqual(neutralize_export_cell("100 Main"), "100 Main")


class ReconciliationLedger(unittest.TestCase):
    def test_synthetic_ingest_records_counts_without_names_and_flags_the_fixture(self):
        tmp = Path(tempfile.mkdtemp())
        reg = Registry(tmp / "registry.db")
        reg.add_source(SRC)
        snap = reg.add_snapshot("test-county-roll", _write(tmp, "roll.txt", "synthetic"), as_of="2026-01-01",
                                retrieved_at="2026-11-06T00:00:00+00:00")
        rows = [
            ParcelRecord("999", "100", "F1", situs_address="1 Main St", owner_name="SECRET OWNER LLC"),
            ParcelRecord("999", "100", "F1", situs_address="1 Main St", owner_name="OTHER OWNER LLC"),
            ParcelRecord("999", "200", "A", owner_name="JANE PERSON"),
            ParcelRecord("999", "300", "", situs_address="3 Blank"),
            ParcelRecord("999", "--", "F1"),
            ParcelRecord("001", "500", "F2"),  # Harris County exists; address missing
        ]
        stats = reg.ingest_parcels(rows, snap, state_fips="48")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope, stats.skipped_invalid), (6, 3, 2, 1))
        self.assertEqual(stats.issue_counts.get("classifier_disagreed", 0), 0)
        self.assertGreaterEqual(stats.duplicate_identity, 1)
        self.assertGreaterEqual(stats.unknown_category, 1)
        self.assertEqual(stats.fixture, 1)
        ledgers = reg.reconciliation(snap.document_id)
        self.assertEqual(len(ledgers), 1)
        blob = json.dumps(ledgers)
        self.assertNotIn("SECRET", blob)
        self.assertNotIn("JANE", blob)
        self.assertEqual(ledgers[0]["fixture"], 1)
        self.assertEqual(ledgers[0]["recorded_at"], "2026-11-06T00:00:00+00:00")
        # A second ingest of the same snapshot replaces the ledger row rather than appending.
        reg.ingest_parcels(rows[:1], snap, state_fips="48")
        self.assertEqual(len(reg.reconciliation(snap.document_id)), 1)
        reg.close()

    def test_a_non_synthetic_source_is_not_marked_as_a_fixture(self):
        tmp = Path(tempfile.mkdtemp())
        reg = Registry(tmp / "registry.db")
        reg.add_source(LIVE)
        snap = reg.add_snapshot("cc-by-example", _write(tmp, "roll.txt", "not a fixture"), as_of="2026-01-01",
                                retrieved_at="2026-11-06T00:00:00+00:00")
        # 11001 is the District of Columbia in the Census file.
        stats = reg.ingest_parcels([ParcelRecord("001", "10", "F1", situs_address="1 Example St",
                                                 owner_name="EXAMPLE HOLDINGS LLC")],
                                   snap, state_fips="11")
        self.assertEqual(stats.fixture, 0)
        self.assertEqual(stats.unknown_county, 0)
        self.assertEqual(stats.kept, 1)
        reg.close()
        # The table is additive: an older file opened again gains it without a row rewrite of facts.
        db = sqlite3.connect(tmp / "registry.db")
        db.execute("DROP TABLE ingest_reconciliation")
        db.commit()
        db.close()
        reg = Registry(tmp / "registry.db")
        self.assertTrue(reg._has_table("ingest_reconciliation"))
        reg.close()
