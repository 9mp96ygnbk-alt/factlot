"""Registry audit tests.

Every parcel, owner, entity, and value below is SYNTHETIC (invented to exercise the audit). The
fixtures are tiny registries built through the real ingest path, then damaged on purpose where a
test needs a finding.
"""

import contextlib
import io
import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from factlot.registry import EntityRecord, Registry, Source
from factlot.registry import audit as audit_mod
from factlot.registry import maintain
from factlot.registry.adapters import dc_dlcp_entities, ma_boston

TODAY = date(2026, 11, 3)
HEADER = "PID,ST_NUM,ST_NAME,CITY,ZIP_CODE,LUC,OWNER,MAIL_STREET_ADDRESS,MAIL_CITY,MAIL_STATE,MAIL_ZIP_CODE,LAND_SF,GROSS_AREA,TOTAL_VALUE,YR_BUILT"
ROWS = [
    "0300010000,100,EXAMPLE ST,BOSTON,02110,345,EXAMPLE TOWER LLC,1 PARK AVE,BOSTON,MA,02110,40000,250000,52000000,1985",
    "0300020000,226,RIVER RD,BOSTON,02128,112,EXAMPLE APARTMENTS LP,1 PARK AVE,NEW YORK,NY,10001,9000,18000,9000000,1920",
    "0300030000,5,OAK LN,BOSTON,02124,105,EXAMPLE JANE,5 OAK LN,BOSTON,MA,02124,3000,4200,900000,1905",  # residential
    "0300040000,7,SHIELD ST,BOSTON,02118,401,EXAMPLE JOHN Q,7 SHIELD ST,BOSTON,MA,02118,8000,5000,700000,1950",  # person
    "0300050000,9,LOT ST,BOSTON,02118,390,UNLINKED HOLDINGS LLC,PO BOX 1,BOSTON,MA,02118,12000,0,1200000,",
]


def write_roll(tmp: Path, name: str, rows: list[str]) -> Path:
    p = tmp / name
    p.write_text("\n".join([HEADER, *rows]) + "\n")
    return p


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_roll(self.tmp, "fy2026.csv", ROWS)
        self.db = self.tmp / "registry.db"
        ma_boston.build(self.csv, self.db, as_of="2025-01-01", retrieved_at="2026-11-03T00:00:00+00:00")
        reg = Registry(self.db)
        reg.add_source(Source("ma-test-entities", "Example Secretary (synthetic)", "Entities", "https://example.invalid/e",
                              "25", license="Synthetic", ai_use="permitted", redistribution="permitted",
                              terms_reviewed="2026-11-03"))
        ents = self.tmp / "entities.csv"
        ents.write_text("synthetic entities")
        snap = reg.add_snapshot("ma-test-entities", ents, as_of="2026-10-30", retrieved_at="2026-11-03T00:00:00+00:00")
        reg.ingest_entities([EntityRecord("Example Tower LLC", "us-ma", "001", state_of_formation="MA", status="active",
                                      locator="row 1")],
                            snap)
        reg.link_owners()
        reg.close()

    def sql(self, statement: str, *args):
        db = sqlite3.connect(self.db)
        db.execute("PRAGMA foreign_keys = OFF")
        db.execute(statement, args)
        db.commit()
        db.close()

    def source(self, report, source_id="ma-boston-assessing"):
        return next(s for s in report["sources"] if s["source_id"] == source_id)

    def test_clean_registry_measures_counts_links_and_age(self):
        report = audit_mod.audit_db(self.db, today=TODAY)
        self.assertEqual(report["violations"], [])
        s = self.source(report)
        # Residential row out of scope; the person-owned warehouse is kept without its owner.
        self.assertEqual(s["parcels"]["count"], 4)
        self.assertEqual(s["parcels"]["missing_address"], 0)
        self.assertEqual(s["parcels"]["no_organisation_owner"], 1)
        self.assertEqual(s["parcels"]["fields"]["year_built"]["missing"], 1)
        self.assertEqual(s["owners"]["person_like"], 0)
        self.assertEqual(s["lookups"], {"parcels_with_account_crosswalk": 4, "parcels_with_address_index": 4})
        self.assertEqual(s["links"]["organisation_owner_parcels"], 3)
        self.assertEqual(s["links"]["linked_parcels"], 1)
        self.assertAlmostEqual(s["links"]["link_rate_pct"], 33.33)
        self.assertEqual(s["links"]["by_confidence"], {"0.90+": 1})
        self.assertEqual(s["links"]["by_rule"], {"exact_name_registered_in_parcel_state": 1})
        self.assertEqual(s["links"]["entity_registry_loaded_for"], ["ma"])
        named = self.source(audit_mod.audit_db(self.db, today=TODAY, entity_names=True), "ma-test-entities")
        self.assertEqual(named["entities"], {"count": 1, "names_read_as_persons": 0})
        # Two unlinked organisation owners, neither with an exact entity name.
        self.assertEqual(s["links"]["unlinked"], {"no_exact_name": 2})
        self.assertEqual(s["snapshots"][0]["age_days"], 671)
        self.assertTrue(any("671 days old" in w for w in report["warnings"]))
        self.assertEqual(s["citations"]["without_locator"], 0)
        self.assertEqual(report["entity_registries_by_state"], {"ma": 1})

    def test_unlinked_owner_whose_name_exists_in_another_state_is_counted_as_queued(self):
        reg = Registry(self.db)
        ents = self.tmp / "ny.csv"
        ents.write_text("synthetic ny")
        reg.add_source(Source("ny-test-entities", "Example NY (synthetic)", "Entities", "https://example.invalid/n", "36",
                              license="Synthetic", terms_reviewed="2026-11-03"))
        snap = reg.add_snapshot("ny-test-entities", ents, as_of="2026-10-30", retrieved_at="2026-11-03T00:00:00+00:00")
        reg.ingest_entities([EntityRecord("Unlinked Holdings LLC", "us-ny", "77", state_of_formation="NY",
                                          status="active", locator="row 1")], snap)
        reg.link_owners()
        reg.close()
        s = self.source(audit_mod.audit_db(self.db, today=TODAY))
        self.assertEqual(s["links"]["unlinked"], {"exact_name_in_another_state_queued": 1, "no_exact_name": 1})
        self.assertEqual(s["review_queue"]["pending"], 1)
        self.assertEqual(s["review_queue"]["pending_by_rule"], {"exact_name_other_state": 1})

    def test_a_later_snapshot_of_the_same_source_counts_each_parcel_once_and_retires_the_missing_one(self):
        # A supplement lists the same roll without one parcel and with a changed owner.
        later = write_roll(self.tmp, "fy2026-supp.csv", [r.replace("EXAMPLE APARTMENTS LP", "RENAMED APARTMENTS LP")
                                                         for r in ROWS if not r.startswith("0300050000")])
        ma_boston.build(later, self.db, as_of="2025-06-01", retrieved_at="2026-11-03T00:00:00+00:00")
        reg = Registry(self.db)
        reg.link_owners()
        reg.close()
        report = audit_mod.audit_db(self.db, today=TODAY, files={"ma-boston-assessing": [str(later)]}, reread=True)
        s = self.source(report)
        self.assertEqual(s["parcels"]["count"], 3, "the retired parcel is not current")
        self.assertEqual(s["parcels"]["absent_from_latest_snapshot"], 1)
        self.assertEqual([x["parcels"] for x in s["snapshots"]], [4, 3], "the retired parcel is not counted for the later snapshot")
        self.assertEqual(s["links"]["organisation_owner_parcels"], 2)
        self.assertEqual(s["parcels"]["conflicting_facts"], 0, "the earlier snapshot's owner is history, not a conflict")
        self.assertEqual(report["violations"], [])

    def test_a_city_or_district_owner_is_counted_apart_from_real_gaps(self):
        grown = write_roll(self.tmp, "fy2026-more.csv", [*ROWS, "0300070000,1,CITY ST,BOSTON,02118,345,EXAMPLE CITY OF,,,,,,,1,"])
        ma_boston.build(grown, self.db, as_of="2025-01-01", retrieved_at="2026-11-03T00:00:00+00:00")
        reg = Registry(self.db)
        reg.link_owners()
        reg.close()
        s = self.source(audit_mod.audit_db(self.db, today=TODAY))
        self.assertEqual(s["links"]["unlinked"], {"no_exact_name": 2, "public_body_not_registered": 1})

    def test_person_owner_fact_is_a_violation(self):
        self.sql("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", "x1", "fl:parcel:us-25025:0300040000",
                 "ownership.owner_of_record", json.dumps("SMITH JOHN A"), None, "2025-01-01", "public_record", None,
                 self.snapshot_doc(), "PID 0300040000")
        report = audit_mod.audit_db(self.db, today=TODAY)
        self.assertEqual(self.source(report)["owners"]["person_like"], 1)
        self.assertEqual(self.source(report)["owners"]["sample_parcels"], ["fl:parcel:us-25025:0300040000"])
        self.assertTrue(any("natural persons" in v for v in report["violations"]))

    def test_uncited_and_malformed_facts_are_violations(self):
        doc = self.snapshot_doc()
        urn = "fl:parcel:us-25025:0300010000"
        self.sql("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", "x2", urn, "parcel.year_built", "1990", None,
                 "2025-01-01", "public_record", None, doc, "")  # no locator
        self.sql("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", "x3", urn, "parcel.tax_year", "2026", None,
                 "last week", "public_record", None, doc, "PID 1")  # bad date
        self.sql("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", "x4", urn, "parcel.land_area_sf", "1", "sf",
                 "2025-01-01", "public_record", None, "fl:document:sha256-" + "0" * 64, "PID 1")  # no snapshot
        report = audit_mod.audit_db(self.db, today=TODAY)
        c = self.source(report)["citations"]
        self.assertEqual((c["without_locator"], c["without_valid_as_of"]), (1, 1))
        self.assertEqual(self.source(report)["parcels"]["missing_as_of"], 1)
        self.assertTrue(any("different values for one single-valued fact" in v for v in report["violations"]))
        self.assertTrue(any("not snapshots" in v for v in report["violations"]))

    def test_implausible_figures_and_out_of_scope_categories_are_warnings(self):
        doc = self.snapshot_doc()
        urn = "fl:parcel:us-25025:0300010000"
        for i, (pred, value) in enumerate([("parcel.year_built", "1492"), ("parcel.land_area_sf", "0"),
                                           ("parcel.market_value", "-5"), ("parcel.tax_year", "1999"),
                                           ("parcel.state_property_category", '"A1"')]):
            self.sql("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", f"p{i}", urn, pred, value, None, "2025-01-01",
                     "public_record", None, doc, "PID 1")
        report = audit_mod.audit_db(self.db, today=TODAY)
        self.assertEqual(self.source(report)["implausible_facts"],
                         {"year_built": 1, "area": 1, "value": 1, "tax_year": 1, "out_of_scope_category": 1})
        self.assertEqual(len([w for w in report["warnings"] if "implausible" in w]), 5)

    def test_link_without_basis_or_snapshot_is_a_violation(self):
        doc = self.snapshot_doc()
        self.sql("UPDATE relationships SET basis = '' WHERE type = 'owns'")
        self.assertTrue(any("links have no basis" in v for v in audit_mod.audit_db(self.db, today=TODAY)["violations"]))
        self.sql("UPDATE relationships SET document_id = ? WHERE type = 'owns'", "fl:document:sha256-" + "1" * 64)
        report = audit_mod.audit_db(self.db, today=TODAY)
        self.assertTrue(any("ownership links cite a document that is not a snapshot" in v for v in report["violations"]))
        del doc

    def test_snapshot_that_is_not_a_content_address_is_flagged(self):
        self.sql("UPDATE snapshots SET document_id = 'doc-1' WHERE source_id = 'ma-boston-assessing'")
        report = audit_mod.audit_db(self.db, today=TODAY)
        self.assertTrue(any("not a sha256 content address" in v for v in report["violations"]))

    def test_reread_matches_registry_and_detects_a_stale_database(self):
        collected = self.tmp / "collected"
        files = {"ma-boston-assessing": [str(self.csv)]}
        report = audit_mod.audit_db(self.db, today=TODAY, files=files, reread=True, all_categories=True)
        f = self.source(report)["source_file"][0]
        self.assertEqual((f["records_in_scope"], f["distinct_parcel_ids"], f["records_all_categories"]), (4, 4, 5))
        light = self.source(audit_mod.audit_db(self.db, today=TODAY, files=files, reread=True))["source_file"][0]
        self.assertNotIn("records_all_categories", light)
        self.assertTrue(f["matches_registry"])
        # The publisher's file gained a commercial parcel the registry does not hold.
        grown = write_roll(self.tmp, "fy2026.csv", [*ROWS, "0300060000,3,ELM ST,BOSTON,02119,112,ELM HOLDINGS LLC,,,,,,,1,"])
        report = audit_mod.audit_db(self.db, today=TODAY, files={"ma-boston-assessing": [str(grown)]}, reread=True)
        self.assertFalse(self.source(report)["source_file"][0]["matches_registry"])
        self.assertTrue(any("registry holds 4" in v for v in report["violations"]))
        del collected

    def test_reread_flags_header_like_apns_and_colliding_apns(self):
        rows = [*ROWS, "PID,1,X ST,BOSTON,02118,345,HEADER LLC,,,,,,,1,",  # a header row read as data
                "03-0009-0000,2,Y ST,BOSTON,02118,345,COLLIDE ONE LLC,,,,,,,1,",
                "030009-0000,2,Y ST,BOSTON,02118,345,COLLIDE TWO LLC,,,,,,,1,"]
        csv_path = write_roll(self.tmp, "fy2026.csv", rows)
        report = audit_mod.audit_db(self.db, today=TODAY, files={"ma-boston-assessing": [str(csv_path)]}, reread=True)
        f = self.source(report)["source_file"][0]
        self.assertEqual(f["header_like_apns"], ["PID"])
        self.assertEqual(f["distinct_apns"] - f["distinct_parcel_ids"], 1)
        self.assertTrue(any("column headings" in v for v in report["violations"]))
        self.assertTrue(any("normalize to" in w for w in report["warnings"]))

    def test_reread_of_an_entity_file_counts_rows_without_a_registry_number_as_skipped(self):
        csv_path = self.tmp / "dc-entities.csv"
        csv_path.write_text("FILE_NUMBER,BUSINESS_NAME,SUFFIX,LOCALE,ENTITY_STATUS\n"
                            "100,EXAMPLE ONE,LLC,DOMESTIC,Active\n200,EXAMPLE TWO,INC,FOREIGN,Active\n,NO NUMBER,LLC,DOMESTIC,Active\n")
        db = self.tmp / "dc.db"
        dc_dlcp_entities.build(csv_path, db, as_of="2026-11-02", link=False)
        report = audit_mod.audit_db(db, today=TODAY, files={"dc-dlcp-entities": [str(csv_path)]}, reread=True)
        f = self.source(report, "dc-dlcp-entities")["source_file"][0]
        self.assertEqual((f["records_in_scope"], f["skipped_without_registry_number"], f["distinct_entity_ids"]), (3, 1, 2))
        self.assertTrue(f["matches_registry"])
        self.assertEqual(report["violations"], [])

    def test_cli_json_markdown_and_exit_status(self):
        out = self.tmp / "report.json"
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(audit_mod.main([str(self.db), "--today", "2026-11-03", "--out", str(out)]), 0)
        self.assertEqual(json.loads(out.read_text())["sources"][0]["source_id"], "ma-boston-assessing")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            audit_mod.main([str(self.db), "--today", "2026-11-03", "--format", "markdown"])
        self.assertIn("| ma-boston-assessing | 4 |", buf.getvalue())
        self.sql("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", "x1", "fl:parcel:us-25025:0300040000",
                 "ownership.owner_of_record", json.dumps("SMITH JOHN A"), None, "2025-01-01", "public_record", None,
                 self.snapshot_doc(), "PID 0300040000")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(audit_mod.main([str(self.db), "--today", "2026-11-03"]), 1)

    def test_maintain_purges_persons_rekeys_and_relinks_so_the_audit_comes_clean(self):
        doc = self.snapshot_doc()
        urn = "fl:parcel:us-25025:0300040000"
        # A file built under an older rule: a person-like owner stored, an old-style entity key, no link for it.
        self.sql("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", "x1", urn, "ownership.owner_of_record",
                 json.dumps("SMITH JOHN A"), None, "2025-01-01", "public_record", None, doc, "PID 0300040000")
        self.sql("UPDATE name_index SET key = 'EXAMPLE TOWER LLC'")  # (unchanged key: nothing to re-key here)
        self.assertEqual(self.source(audit_mod.audit_db(self.db, today=TODAY))["owners"]["person_like"], 1)
        steps: list[str] = []
        result = maintain.run(str(self.db), purge_persons=True, rebuild_names=True, link=True,
                              log=lambda name, r: steps.append(name))
        self.assertEqual(steps, ["purge_person_owners", "rebuild_name_index", "rebuild_review_keys", "link_owners", "stats"])
        self.assertEqual(result["purge_person_owners"]["owner_facts"], 1)
        self.assertEqual(result["link_owners"]["linked"], 1)
        report = audit_mod.audit_db(self.db, today=TODAY)
        self.assertEqual(report["violations"], [])
        self.assertEqual(self.source(report)["links"]["linked_parcels"], 1)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(maintain.main([str(self.db), "--all"]), 0)
            with self.assertRaises(SystemExit):
                maintain.main([str(self.db)])

    def test_missing_file_is_an_error(self):
        with self.assertRaises(FileNotFoundError):
            audit_mod.audit_db(self.tmp / "nope.db", today=TODAY)

    def snapshot_doc(self) -> str:
        db = sqlite3.connect(self.db)
        try:
            return db.execute("SELECT document_id FROM snapshots WHERE source_id = 'ma-boston-assessing'").fetchone()[0]
        finally:
            db.close()


class LinkRuleLabels(unittest.TestCase):
    def test_basis_text_maps_to_rule(self):
        from factlot.registry.store import EXACT_MATCH_BASIS

        self.assertEqual(audit_mod._link_rule(EXACT_MATCH_BASIS), "exact_name_legacy")
        self.assertEqual(audit_mod._link_rule(f"{EXACT_MATCH_BASIS} (registered in the parcel's state)"),
                         "exact_name_registered_in_parcel_state")
        self.assertEqual(audit_mod._link_rule(f"{EXACT_MATCH_BASIS} (formed in the parcel's state)"),
                         "exact_name_formed_in_parcel_state")
        self.assertEqual(audit_mod._link_rule(f"{EXACT_MATCH_BASIS} (x; the only one of 2 same-name entities)"),
                         "exact_name_standing")
        self.assertEqual(audit_mod._link_rule("... accepted by someone in owner_match_review #1"), "reviewed_fuzzy_name")


if __name__ == "__main__":
    unittest.main()
