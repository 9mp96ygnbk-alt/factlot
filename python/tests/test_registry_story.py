"""Data stories (factlot.registry.story) on a small synthetic registry file built in the test.

Every parcel, value and owner here is invented. Nothing reads a real registry file.
"""

import copy
import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from factlot.registry import story
from factlot.registry.story import Params, StoryRefused
from factlot.registry.store import Registry

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = ROOT / "scripts" / "site" / "fixtures" / "stories"
COUNTY = "48301"  # Loving County: a real name for the title; every figure below is invented
YEARS = (2022, 2023, 2024)
DOCS = {2022: "fl:document:sha256-" + "a" * 64, 2023: "fl:document:sha256-" + "b" * 64, 2024: "fl:document:sha256-" + "c" * 64,
        "cur": "fl:document:sha256-" + "d" * 64, "ent": "fl:document:sha256-" + "e" * 64}
# What the fixture roll gives for owners the registry does not keep, and a name that must never reach a story.
PERSON_STYLE_OWNER = "ZANE FAMILY HOLDINGS LP"


def parcel_rows():
    """(apn, category, nbhd, class, owner, {year: (market, appraised)}) for 32 in-scope parcels and a few outside it."""
    rows = []
    # 12 commercial parcels (F1): values 1,000,000 + 10,000*i in 2022; +10% in 2023; 2024 down 5% on odd i, unchanged on i % 4 == 0.
    for i in range(12):
        base = 1_000_000 + 10_000 * i
        v23 = base * 11 // 10
        v24 = v23 if i % 4 == 0 else (v23 * 95 // 100 if i % 2 else v23 * 103 // 100)
        owner = "ACME HOLDINGS LLC" if i < 11 else PERSON_STYLE_OWNER
        rows.append((f"F1{i:03d}", "F10", "NB-A" if i < 11 else "NB-B", "C", owner, {2022: (base, base), 2023: (v23, v23), 2024: (v24, v24)}))
    # 11 multifamily parcels (B): flat 2022 to 2023, +30% in 2024.
    for i in range(11):
        base = 2_000_000 + 5_000 * i
        rows.append((f"B{i:03d}", "B2", "NB-A", "S", "RIVER APARTMENTS LP" if i < 10 else None,
                     {2022: (base, base), 2023: (base, base), 2024: (base * 13 // 10, base * 13 // 10)}))
    # 3 industrial parcels (F2): too few for a group row.
    for i in range(3):
        base = 5_000_000 + 100_000 * i
        rows.append((f"F2{i:03d}", "F20", "NB-C", "W", "STEEL WORKS INC", {2022: (base, base), 2023: (base * 12 // 10, base * 12 // 10), 2024: (base, base)}))
    return rows


class Fixture:
    """Builds the synthetic registry file with plain inserts (Registry would also work, but this is explicit)."""

    def __init__(self, path, *, market_only_2024=False, appraised_only_2024=False, tarrant=False, redistribution="unknown",
                 extra_year_doc=False, sub_cent=False, rows=None):
        county = "48439" if tarrant else COUNTY
        self.county = county
        reg = Registry(path)
        db = reg.db
        db.execute("INSERT OR REPLACE INTO meta VALUES ('schema_version', '2')")
        for y in YEARS:
            sid = f"tx-fixture-cad-{y}" if y != 2024 else "tx-fixture-cad"
            db.execute("INSERT INTO sources VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                sid, "Fixture Central Appraisal District", f"Roll export, tax year {y}", "https://example.test/roll", "48", county[2:],
                "Public record; no licence stated", "unknown", redistribution, "Fixture Central Appraisal District", "2026-01-01"))
            db.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?)", (DOCS[y], sid, "2026-11-01T00:00:00+00:00", f"{y}-07-25", f"roll{y}.zip", 1))
        db.execute("UPDATE snapshots SET source_id = 'tx-fixture-cad' WHERE document_id = ?", (DOCS[2024],))
        db.execute("INSERT INTO sources VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
            "tx-comptroller-franchise", "Texas Comptroller of Public Accounts", "Active Franchise Taxpayers", "https://example.test/c", "48", None,
            "Public domain", "unknown", "attribution_required", "Texas Comptroller of Public Accounts", "2026-01-01"))
        db.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?)", (DOCS["ent"], "tx-comptroller-franchise", "2026-11-01T00:00:00+00:00", "2026-10-31", "e.csv", 1))
        # The "current" file is the 2024 roll's source (its as_of is the newest for that source).
        rows = rows if rows is not None else parcel_rows()
        entities = {"ACME HOLDINGS LLC": "fl:entity:us-tx:0000000001", "RIVER APARTMENTS LP": "fl:entity:us-tx:0000000002"}
        for urn in entities.values():
            self._subject(db, urn, "entity")
            self._fact(db, urn, "entity.legal_name", "X", DOCS["ent"], "2026-10-31")
        n = 0
        for apn, cat, nb, bc, owner, vals in rows:
            urn = f"fl:parcel:us-{county}:{apn}"
            self._subject(db, urn, "parcel")
            db.execute("INSERT INTO coverage VALUES (?,?,?,?,1)", (urn, "tx-fixture-cad", f"{2024}-07-25", DOCS[2024]))
            cur = DOCS[2024]
            asof = "2024-07-25"
            self._fact(db, urn, "parcel.state_property_category", cat, cur, asof)
            self._fact(db, urn, "parcel.neighborhood_code", nb, cur, asof)
            self._fact(db, urn, "parcel.building_class", bc, cur, asof)
            if owner:
                self._fact(db, urn, "ownership.owner_of_record", owner, cur, asof)
            if owner in entities:
                db.execute("INSERT INTO relationships VALUES (?,?,?,?,?,?,?,?)", (entities[owner], "owns", urn, asof, "inferred", 0.9, cur, "exact"))
            for y, (mv, av) in vals.items():
                d = DOCS[y]
                self._fact(db, urn, "parcel.tax_year", y, d, f"{y}-07-25")
                if sub_cent and apn == "F1000" and y == 2023:
                    mv = 1000000.004
                if not (appraised_only_2024 and y == 2024):
                    self._fact(db, urn, "parcel.market_value", mv, d, f"{y}-07-25")
                if not (market_only_2024 and y == 2024):
                    self._fact(db, urn, "parcel.appraised_value", av, d, f"{y}-07-25")
            n += 1
        if extra_year_doc:
            extra = "fl:document:sha256-" + "f" * 64
            db.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?)", (extra, "tx-fixture-cad-2022", "2026-11-01T00:00:00+00:00", "2022-09-01", "roll2022b.zip", 1))
            self._fact(db, f"fl:parcel:us-{county}:F1000", "parcel.tax_year", 2022, extra, "2022-09-01")
            self._fact(db, f"fl:parcel:us-{county}:F1000", "parcel.market_value", 1.0e6 + 1, extra, "2022-09-01")
        db.commit()
        db.close()

    @staticmethod
    def _subject(db, urn, kind):
        db.execute("INSERT INTO subjects VALUES (?,?,?,?)", (urn, kind, hashlib.sha256(urn.encode()).hexdigest()[:16], None))

    @staticmethod
    def _fact(db, subject, pred, value, doc, as_of):
        vj = json.dumps(value)
        fid = hashlib.sha256(f"{subject}|{pred}|{vj}|{doc}".encode()).hexdigest()
        db.execute("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?)", (fid, subject, pred, vj, None, as_of, "test", None, doc, "row"))


def make_db(tmp, name="reg.db", **kw):
    path = os.path.join(tmp, name)
    Fixture(path, **kw)
    return path


def params(**kw):
    base = dict(county=COUNTY, years=YEARS, thresholds=("10", "25"))
    base.update(kw)
    return Params(**base)


def figs(doc):
    return {f["id"]: f["value"] for f in doc["figures"]}


class StoryFigures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = make_db(cls.tmp.name)
        cls.doc = story.generate(cls.db, params())
        cls.f = figs(cls.doc)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_scope_and_totals(self):
        f = self.f
        self.assertEqual(f["scope.parcels"], 26)
        self.assertEqual(f["scope.excluded"], 0)
        self.assertEqual(f["y2022.parcels"], 26)
        want = sum(1_000_000 + 10_000 * i for i in range(12)) + sum(2_000_000 + 5_000 * i for i in range(11)) + sum(5_000_000 + 100_000 * i for i in range(3))
        self.assertEqual(f["y2022.total"], want)

    def test_direction_counts(self):
        f = self.f
        self.assertEqual(f["p2022_2023.both"], 26)
        self.assertEqual(f["p2022_2023.rose"], 12 + 3)  # commercial +10%, industrial +20%
        self.assertEqual(f["p2022_2023.same"], 11)  # multifamily flat
        self.assertEqual(f["p2022_2023.fell"], 0)
        self.assertEqual(f["p2022_2023.rose_pct"], 57.7)  # 15 / 26 = 57.69...
        # 2023 to 2024: commercial i%4==0 unchanged (3), odd i down 5% (6), other even up 3% (3); multifamily +30%; industrial back down.
        self.assertEqual(f["p2023_2024.fell"], 6 + 3)
        self.assertEqual(f["p2023_2024.same"], 3)
        self.assertEqual(f["p2023_2024.rose"], 3 + 11)

    def test_threshold_counts_are_strictly_more_than(self):
        f = self.f
        # +10% exactly (1.1x in integer arithmetic) is not "more than 10 percent"; the industrial +20% parcels are.
        self.assertEqual(f["p2022_2023.rose_gt_10"], 3)
        self.assertEqual(f["p2022_2023.rose_gt_25"], 0)
        self.assertEqual(f["p2023_2024.rose_gt_25"], 11)  # multifamily +30%
        self.assertEqual(f["p2023_2024.fell_gt_10"], 3)  # industrial 6,000,000 -> 5,000,000 is -16.7% (3 parcels)
        self.assertEqual(f["p2023_2024.fell_gt_25"], 0)

    def test_quartiles_and_median(self):
        f = self.f
        # 2023 to 2024 changes (26): 3 x 0.0, 6 x -5.0, 3 x +3.0, 11 x +30.0, 3 x about -16.7. Sorted: -16.7 x3, -5 x6, 0 x3, 3 x3, 30 x11.
        self.assertEqual(f["p2023_2024.median"], 3.0)
        self.assertEqual(f["p2023_2024.q1"], -5.0)
        self.assertEqual(f["p2023_2024.q3"], 30.0)

    def test_group_rows_leave_out_a_group_below_the_minimum(self):
        rows = [r for r in self.doc["tables"][0]["rows"] if r[1] == 2022]
        self.assertEqual([r[0] for r in rows], [story.ALL_LABEL, story.GROUP_LABELS["F1"], story.GROUP_LABELS["B"]])
        self.assertEqual(rows[0][2], 26)  # the county total counts all three groups
        self.assertEqual(rows[1][2], 12)
        self.assertEqual(rows[2][2], 11)

    def test_group_change_blanks_small_cells(self):
        rows = {(r[0], r[1]): r for r in next(t for t in self.doc["tables"] if t["id"] == "t.group_change")["rows"]}
        total = rows[(story.ALL_LABEL, "2023 to 2024")]
        self.assertTrue(all(isinstance(c, (int, float)) for c in total[2:]))  # a county total is never blanked
        fixed = rows[(story.GROUP_LABELS["F1"], "2023 to 2024")]
        self.assertEqual(fixed[2], 12)
        self.assertEqual(fixed[3:6], [None, None, None])  # 3 rose, 6 fell, 3 unchanged: each below the minimum
        self.assertEqual(fixed[6], -2.5)  # the median is built from the 12 parcels
        for r in (r for r in rows.values() if r[0] != story.ALL_LABEL):
            for c in r[3:6]:
                self.assertTrue(c is None or c >= story.MIN_CELL)

    def test_dimension_tables_need_ten_parcels(self):
        t = next(t for t in self.doc["tables"] if t["id"] == "t.dim.neighborhood")
        self.assertEqual([r[0] for r in t["rows"]], ["NB-A"])  # NB-B (1) and NB-C (3) are below the minimum
        self.assertEqual(t["rows"][0][1], 22)
        t = next(t for t in self.doc["tables"] if t["id"] == "t.dim.building_class")
        self.assertEqual([r[0] for r in t["rows"]], ["C", "S"])

    def test_owner_shares(self):
        f = self.f
        self.assertEqual(f["owner.org_stated"], 11 + 1 + 10 + 3)  # every parcel but one multifamily parcel states an organisation
        self.assertEqual(f["owner.registered"], 11 + 10)  # ACME and RIVER are registered; the person-style owner and STEEL are not
        self.assertEqual(f["owner.registered_pct"], 80.8)  # 21 / 26

    def test_sentences_use_only_their_figures(self):
        self.assertEqual(story.stray_numbers(self.doc), [])
        texts = [s["text"] for s in self.doc["sentences"]]
        self.assertIn("Of 26 parcels with a value in both 2022 and 2023, 15 (57.7%) were higher in 2023 than in 2022, 0 (0.0%) were lower and 11 were unchanged.", texts)

    def test_sources_carry_as_of_and_attribution(self):
        fig = next(f for f in self.doc["figures"] if f["id"] == "y2023.total")
        self.assertEqual([s["source_id"] for s in fig["sources"]], ["tx-fixture-cad-2023", "tx-fixture-cad"])
        self.assertEqual(fig["sources"][0]["as_of"], "2023-07-25")
        self.assertEqual(fig["sources"][0]["attribution"], "Fixture Central Appraisal District")
        reg = next(f for f in self.doc["figures"] if f["id"] == "owner.registered")
        self.assertIn("tx-comptroller-franchise", [s["source_id"] for s in reg["sources"]])

    def test_build_identity_is_not_a_path(self):
        ident = self.doc["registry"]
        self.assertEqual(ident["schema_version"], "2")
        self.assertEqual(len(ident["inputs_sha256"]), 64)
        self.assertNotIn(self.tmp.name, json.dumps(self.doc))

    def test_output_is_deterministic(self):
        self.assertEqual(story.dumps(story.generate(self.db, params())), story.dumps(self.doc))

    def test_no_owner_name_unless_asked(self):
        text = json.dumps(self.doc)
        for name in ("ACME", "RIVER APARTMENTS", "STEEL", "ZANE"):
            self.assertNotIn(name, text)
        self.assertNotIn("t.owners", [t["id"] for t in self.doc["tables"]])

    def test_named_organisations_exclude_small_and_personal_style_owners(self):
        doc = story.generate(self.db, params(name_organisations=True))
        owners = next(t for t in doc["tables"] if t["id"] == "t.owners")["rows"]
        self.assertEqual([r[0] for r in owners], ["ACME HOLDINGS LLC", "RIVER APARTMENTS LP"])  # STEEL has 3; the family-style owner has 1
        self.assertNotIn("ZANE", json.dumps(doc))


class StoryRefusals(unittest.TestCase):
    def test_withheld_county_refuses(self):
        with self.assertRaisesRegex(StoryRefused, "withheld"):
            story.normalize_params("48439", [2022, 2023], None, "market", False, None)

    def test_withheld_county_in_a_file_refuses_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp)
            doc = story.generate(db, params())
            doc["county"]["fips"] = "48439"
            with self.assertRaisesRegex(StoryRefused, "withheld"):
                story.verify_document(doc, db)

    def test_mixed_value_types_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp, market_only_2024=True)
            with self.assertRaisesRegex(StoryRefused, "market values only; refusing to compare appraised"):
                story.generate(db, params(value_type="appraised"))
            # the type the three files all share still works
            self.assertEqual(story.generate(db, params())["figures"][0]["id"], "param.min_cell")

    def test_year_with_only_the_other_type_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp, appraised_only_2024=True)
            with self.assertRaisesRegex(StoryRefused, "appraised values only; refusing to compare market"):
                story.generate(db, params())

    def test_missing_roll_year_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp)
            with self.assertRaisesRegex(StoryRefused, "no roll file with values for tax year 2019"):
                story.generate(db, params(years=(2019, 2022)))

    def test_two_files_for_one_year_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp, extra_year_doc=True)
            with self.assertRaisesRegex(StoryRefused, "more than one file"):
                story.generate(db, params())

    def test_prohibited_redistribution_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp, redistribution="prohibited")
            with self.assertRaisesRegex(StoryRefused, "prohibits redistribution"):
                story.generate(db, params())

    def test_a_fraction_of_a_cent_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp, sub_cent=True)
            with self.assertRaisesRegex(StoryRefused, "fraction of a cent"):
                story.generate(db, params())

    def test_parcels_outside_the_commercial_scope_are_left_out_and_counted(self):
        rows = parcel_rows() + [("R001", "A1", "NB-A", "C", None, {2022: (1, 1), 2023: (1, 1), 2024: (1, 1)})]
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp, rows=rows)
            doc = story.generate(db, params())
            f = figs(doc)
            self.assertEqual((f["scope.parcels"], f["scope.excluded"], f["y2022.parcels"]), (26, 1, 26))

    def test_preliminary_year_is_labelled(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp)
            doc = story.generate(db, params(preliminary=(2024,)))
            self.assertEqual([y["preliminary"] for y in doc["period"]["years"]], [False, False, True])
            self.assertTrue(any("(preliminary roll)" in s["text"] for s in doc["sentences"]))

    def test_preliminary_by_year_of_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp)
            c = sqlite3.connect(db)
            c.execute("UPDATE snapshots SET as_of = '2023-01-05' WHERE document_id = ?", (DOCS[2024],))
            c.commit()
            c.close()
            doc = story.generate(db, params())
            self.assertEqual([y["preliminary"] for y in doc["period"]["years"]], [False, False, True])

    def test_a_current_working_file_name_marks_the_year_preliminary_but_a_source_title_does_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp)
            c = sqlite3.connect(db)
            c.execute("UPDATE sources SET title = 'Appraisal data export (CAD<year>_CURRENT.ZIP), tax year 2023' WHERE source_id = 'tx-fixture-cad-2023'")
            c.execute("UPDATE snapshots SET filename = 'CAD2022_CURRENT.zip' WHERE document_id = ?", (DOCS[2022],))
            c.commit()
            c.close()
            doc = story.generate(db, params())
            self.assertEqual([y["preliminary"] for y in doc["period"]["years"]], [True, False, False])

    def test_thresholds_and_years_are_validated(self):
        for bad in ("0", "-5", "abc", "1001", "1.234"):
            with self.assertRaises(StoryRefused, msg=bad):
                story.normalize_params(COUNTY, [2022, 2023], [bad], "market", False, None)
        with self.assertRaises(StoryRefused):
            story.normalize_params(COUNTY, [2022], None, "market", False, None)
        with self.assertRaises(StoryRefused):
            story.normalize_params("201", [2022, 2023], None, "market", False, None)


class StoryVerifier(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = make_db(cls.tmp.name)
        cls.doc = story.generate(cls.db, params())

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def verify(self, doc):
        return story.verify_document(doc, self.db)[0]

    def test_an_untouched_story_passes_by_the_second_route(self):
        failures, nf, nt = story.verify_document(self.doc, self.db)
        self.assertEqual(failures, [])
        self.assertEqual(nf, len(self.doc["figures"]))
        self.assertEqual(nt, len(self.doc["tables"]))

    def test_a_tampered_figure_fails_with_its_id(self):
        doc = copy.deepcopy(self.doc)
        next(f for f in doc["figures"] if f["id"] == "p2023_2024.rose_gt_25")["value"] += 1
        failures = self.verify(doc)
        self.assertTrue(any(line.startswith("figure p2023_2024.rose_gt_25:") for line in failures), failures)

    def test_a_tampered_total_fails(self):
        doc = copy.deepcopy(self.doc)
        next(f for f in doc["figures"] if f["id"] == "y2022.total")["value"] -= 100
        self.assertTrue(any(line.startswith("figure y2022.total:") for line in self.verify(doc)))

    def test_a_stray_number_in_a_sentence_fails(self):
        doc = copy.deepcopy(self.doc)
        doc["sentences"][1]["text"] += " Another 4,242 parcels changed hands."
        failures = self.verify(doc)
        self.assertTrue(any("number 4,242 is not one of its figures" in line for line in failures), failures)

    def test_a_sentence_that_names_a_figure_it_does_not_cite_fails(self):
        doc = copy.deepcopy(self.doc)
        s = doc["sentences"][1]
        s["figures"] = [i for i in s["figures"] if i != "y2022.total"]
        self.assertTrue(any("is not one of its figures" in line for line in self.verify(doc)))

    def test_a_tampered_table_cell_fails(self):
        doc = copy.deepcopy(self.doc)
        doc["tables"][0]["rows"][0][2] += 1
        self.assertTrue(any(line.startswith("table t.group_year:") for line in self.verify(doc)))

    def test_a_small_cell_in_a_group_row_fails(self):
        doc = copy.deepcopy(self.doc)
        t = next(t for t in doc["tables"] if t["id"] == "t.group_change")
        row = next(r for r in t["rows"] if r[0] == story.GROUP_LABELS["F1"] and r[1] == "2023 to 2024")
        row[3] = 3
        self.assertTrue(any("a cell built from 3 parcels" in line for line in self.verify(doc)))

    def test_owner_names_in_a_file_that_did_not_ask_for_them_fail(self):
        doc = copy.deepcopy(self.doc)
        doc["tables"].append({"id": "t.owners", "title": "x", "columns": [], "rule": "x", "rows": [["ACME HOLDINGS LLC", 11, 1]],
                              "suppressed_cells": 0, "sources": []})
        self.assertTrue(any("t.owners" in line for line in self.verify(doc)))

    def test_a_changed_input_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = make_db(tmp, "other.db")
            c = sqlite3.connect(db)
            c.execute("UPDATE facts SET value_json = '2300000' WHERE subject = ? AND predicate = 'parcel.market_value' AND document_id = ?",
                      (f"fl:parcel:us-{COUNTY}:B000", DOCS[2023]))
            c.commit()
            c.close()
            failures = story.verify_document(self.doc, db)[0]
            self.assertTrue(any(line.startswith("figure ") for line in failures), failures)

    def test_a_story_from_another_generator_version_fails(self):
        doc = copy.deepcopy(self.doc)
        doc["generator"]["version"] = "0"
        self.assertTrue(any(line.startswith("generator:") for line in self.verify(doc)))

    def test_the_command_line_writes_a_stamp_only_when_the_story_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "s.json"
            self.assertEqual(story.main(["--db", self.db, "--county", COUNTY, "--years", "2022", "2023", "2024", "--threshold", "10",
                                         "--threshold", "25", "--out", str(out)]), 0)
            self.assertEqual(story.main(["--db", self.db, "--verify", str(out)]), 0)
            stamp = json.loads((Path(tmp) / "s.stamp.json").read_text())
            self.assertEqual(stamp["story_sha256"], hashlib.sha256(out.read_bytes()).hexdigest())
            self.assertEqual(stamp["result"], "pass")
            doc = json.loads(out.read_text())
            doc["figures"][3]["value"] += 1
            bad = Path(tmp) / "bad.json"
            bad.write_text(story.dumps(doc))
            self.assertEqual(story.main(["--db", self.db, "--verify", str(bad)]), 1)
            self.assertFalse((Path(tmp) / "bad.stamp.json").exists())

    def test_the_command_line_refuses_a_withheld_county(self):
        self.assertEqual(story.main(["--db", self.db, "--county", "48439", "--years", "2022", "2023", "--out", "/dev/null"]), 3)


class SiteFixture(unittest.TestCase):
    """scripts/site/fixtures/stories holds a story made from this synthetic file, for the site build's tests.

    Regenerate it with:  PYTHONPATH=python/src python3 python/tests/test_registry_story.py --write-fixture
    """

    def make(self, tmp):
        db = make_db(tmp)
        doc = story.generate(db, params())
        return doc

    def test_committed_fixture_matches_the_generator(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = self.make(tmp)
            name = doc["slug"] + ".json"
            committed = FIXTURE_DIR / name
            self.assertTrue(committed.exists(), f"run the fixture writer: {name} is missing")
            self.assertEqual(committed.read_text(), story.dumps(doc))
            stamp = json.loads(story.stamp_path(committed).read_text())
            self.assertEqual(stamp["story_sha256"], hashlib.sha256(committed.read_bytes()).hexdigest())


def write_fixture():
    with tempfile.TemporaryDirectory() as tmp:
        db = make_db(tmp)
        doc = story.generate(db, params())
        FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
        for old in FIXTURE_DIR.glob("*.json"):
            old.unlink()
        path = FIXTURE_DIR / (doc["slug"] + ".json")
        path.write_text(story.dumps(doc))
        failures, nf, nt = story.verify_document(doc, db)
        assert not failures, failures
        stamp = story.write_stamp(path, doc, nf, nt)
        s = json.loads(stamp.read_text())
        s["verified_on"] = "2026-11-12"  # fixed so the committed stamp does not change from day to day
        stamp.write_text(json.dumps(s, indent=2) + "\n")
        print("wrote", path, stamp)


if __name__ == "__main__":
    import sys

    if "--write-fixture" in sys.argv:
        write_fixture()
    else:
        unittest.main()
