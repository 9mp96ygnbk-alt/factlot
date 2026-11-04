"""DC zoning development standards adapter tests on a SYNTHETIC fixture that copies the real layout.

Zone names are real DC zone names, but every number, parcel and SSL here is invented to exercise the mapping; none is
the Office of Zoning's data. The layout is the ArcGIS ``query`` response (``f=json``) of layer 36 with ``outFields=*``.
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import ParcelFacts, ParcelRecord, Registry, Source
from factlot.registry.adapters import dc_zoning_standards as dzs

COLUMNS = ("ZONE", "DESCRIPTION", "BUILDING_CATEGORY", "HEIGHT_FT", "FLOOR_AREA_RATIO", "LOT_CCUPANCY_PERCENT")


def row(zone, category, height, far, lot="NULL"):
    return {"ZONE": zone, "DESCRIPTION": "synthetic", "BUILDING_CATEGORY": category, "HEIGHT_FT": height,
            "FLOOR_AREA_RATIO": far, "LOT_CCUPANCY_PERCENT": lot, "OBJECTID": 1}


ROWS = [
    # A mixed-use zone with the three categories; the IZ row is 5 ft taller and the trailing space is as published.
    row("MU-4", "Residential ", "50", "2.5"), row("MU-4", "Residential (IZ)", "55", "3"), row("MU-4", "Non-Residential", "50", "1.5"),
    # Height by street width (prose): no height; FAR still read. FAR in prose: skipped.
    row("D-5", "Residential", "110 ft if the street is under 110 ft wide; 130 ft if wider", "6.5"),
    row("D-5", "Non-Residential", "110 ft if the street is under 110 ft wide; 130 ft if wider", "As achievable by permitted height and bulk"),
    # An apartment zone with the one catch-all row, and a zone with only prose.
    row("RA-2", "All Other Buildings & Structures", "50", "1.8"), row("HE-1", "Non-Residential", "50", "See Subtitle K Chapter 402"),
    # A residential zone: the institutional height is a special use and is left out of the zone's height.
    row("R-3", "All Other Buildings & Structures", "40", "NULL"), row("R-3", "Institutional", "90", "NULL"),
    # A category listed twice with different numbers: that predicate is skipped.
    row("PDR-1", "Industrial", "50", "3.5"), row("PDR-1", "Industrial", "50", "4"),
    # A zone name written the old way.
    row("R-1-B", "All Other Buildings & Structures", "40", "NULL"),
    # Nothing usable.
    row("UNZONED", "NULL", "NULL", "NULL"),
    # A FAR written with a leading dot and a zero (not a standard).
    row("NC-1", "Residential", "40", ".5"), row("NC-1", "Non-Residential", "40", "0"),
]


def standards_file(d: Path, rows=ROWS) -> Path:
    p = d / "standards.json"
    p.write_text(json.dumps({"displayFieldName": "ZONE", "fields": [{"name": c} for c in COLUMNS], "features": [{"attributes": r} for r in rows]}))
    return p


class TestStandards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.std = dzs.read_standards(standards_file(self.dir))

    def test_far_by_category_and_height(self):
        f = self.std["MU4"]["facts"]
        self.assertEqual(f["zoning.max_far_residential"], 2.5)
        self.assertEqual(f["zoning.max_far_affordable_residential"], 3)
        self.assertEqual(f["zoning.max_far_nonresidential"], 1.5)
        self.assertEqual(f["zoning.max_height_ft"], 55)  # the greatest, the inclusionary row's

    def test_prose_is_not_parsed(self):
        f = self.std["D5"]["facts"]
        self.assertEqual(f, {"zoning.max_far_residential": 6.5})  # no height (prose), no non-residential FAR (prose)
        self.assertEqual(self.std["HE1"]["facts"], {"zoning.max_height_ft": 50})  # its FAR is prose
        self.assertNotIn("UNZONED", self.std)

    def test_ra_zone_catch_all_row_is_residential_and_other_zones_are_not(self):
        self.assertEqual(self.std["RA2"]["facts"], {"zoning.max_far_residential": 1.8, "zoning.max_height_ft": 50})
        self.assertEqual(self.std["R3"]["facts"], {"zoning.max_height_ft": 40})  # catch-all row of an R zone gives no FAR

    def test_special_use_heights_are_left_out(self):
        self.assertEqual(self.std["R3"]["facts"]["zoning.max_height_ft"], 40)  # not the institutional 90

    def test_conflicting_duplicates_skip_that_predicate(self):
        self.assertEqual(self.std["PDR1"]["facts"], {"zoning.max_height_ft": 50})

    def test_zero_far_is_not_a_standard(self):
        self.assertEqual(self.std["NC1"]["facts"], {"zoning.max_far_residential": 0.5, "zoning.max_height_ft": 40})

    def test_zone_names_match_without_hyphens(self):
        self.assertEqual(dzs.zone_key("R-1-B"), dzs.zone_key("R-1B"))
        self.assertEqual(dzs.match("R-1B", self.std)[0]["zone"], "R-1-B")

    def test_overlay_suffix_falls_back_to_the_base_zone_and_nothing_else_does(self):
        std, via_base = dzs.match("RA-2/CAP", self.std)
        self.assertTrue(via_base)
        self.assertEqual(std["zone"], "RA-2")
        self.assertEqual(dzs.match("MU-4", self.std)[1], False)
        self.assertIsNone(dzs.match("NMU-4/GA", self.std))
        self.assertIsNone(dzs.match("ZZ-9", self.std))


class TestIngest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.db = self.dir / "r.db"
        self.file = standards_file(self.dir)
        reg = Registry(self.db)
        reg.add_source(Source("test-dc-roll", "Example", "Roll", "https://example.invalid", "11", county_fips="001", license="synthetic"))
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic")
        snap = reg.add_snapshot("test-dc-roll", roll, as_of="2026-09-04")
        reg.ingest_parcels([
            ParcelRecord("001", "0123 0045", "F1", account="A1", situs_address="1 EXAMPLE ST NW"),
            ParcelRecord("001", "0123 0046", "B", account="A2"),
            ParcelRecord("001", "0123 0047", "F1", account="A3"),
            ParcelRecord("001", "0123 0048", "F1", account="A4"),
            ParcelRecord("001", "0123 0049", "F1", account="A5"),
        ], snap, state_fips="11", account_system="test-dc-ssl", full_roll=True)
        reg.add_source(Source("test-dc-zoning", "Example", "Zoning", "https://example.invalid", "11", county_fips="001", license="synthetic"))
        zfile = self.dir / "zoning.txt"
        zfile.write_text("synthetic zoning")
        zsnap = reg.add_snapshot("test-dc-zoning", zfile, as_of="2026-11-04")
        reg.ingest_parcel_facts([
            ParcelFacts("001", "0123 0045", [("zoning.district", "MU-4", None)], method="inferred", confidence=0.95),
            ParcelFacts("001", "0123 0046", [("zoning.district", "RA-2/CAP", None)], method="inferred", confidence=0.8),
            ParcelFacts("001", "0123 0047", [("zoning.district", "NMU-4/GA", None)], method="inferred", confidence=0.95),
            ParcelFacts("001", "0123 0048", [("zoning.district", "R-1B", None)], method="inferred", confidence=0.4),
        ], zsnap, state_fips="11")
        reg.close()

    def facts(self, apn):
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_parcel("11", "001", apn))["facts"]}
        finally:
            reg.close()

    def test_standards_attach_to_parcels_by_district_and_say_so(self):
        counts = dzs.Counts()
        stats = dzs.build(self.file, self.db, as_of="2026-11-03", retrieved_at="2026-11-04T06:00:00+00:00", counts=counts)
        self.assertEqual(stats.skipped_out_of_scope, 0)
        self.assertEqual((counts.parcels_with_district, counts.parcels_matched_exact, counts.parcels_matched_base_zone,
                          counts.parcels_district_not_in_table), (4, 2, 1, 1))
        self.assertEqual(counts.unmatched_districts, {"NMU-4/GA": 1})
        f = self.facts("0123 0045")
        self.assertEqual(f["zoning.max_far_residential"]["value"], 2.5)
        self.assertEqual(f["zoning.max_height_ft"]["value"], 55)
        self.assertEqual(f["zoning.max_height_ft"]["unit"], "ft")
        prov = f["zoning.max_height_ft"]["provenance"]
        self.assertEqual((prov["method"], prov["confidence"]), ("inferred", 0.9))  # capped at 0.9 though the district is 0.95
        self.assertIn("zoning district MU-4 takes the ZR16 standards of zone MU-4", prov["sources"][0]["section"])
        self.assertTrue(prov["sources"][0]["document_id"].startswith("fl:document:sha256-"))
        self.assertEqual(f["zoning.max_height_ft"]["rights"]["ai_use"], "permitted")
        self.assertEqual(f["zoning.max_height_ft"]["as_of"], "2026-11-03")

    def test_overlay_district_has_lower_confidence_and_a_note(self):
        dzs.build(self.file, self.db, as_of="2026-11-03")
        f = self.facts("0123 0046")["zoning.max_far_residential"]
        self.assertEqual(f["value"], 1.8)
        self.assertEqual(f["provenance"]["confidence"], 0.6)
        self.assertIn("an overlay is not applied", f["provenance"]["sources"][0]["section"])

    def test_confidence_never_exceeds_the_districts_own(self):
        dzs.build(self.file, self.db, as_of="2026-11-03")
        self.assertEqual(self.facts("0123 0048")["zoning.max_height_ft"]["provenance"]["confidence"], 0.4)

    def test_unlisted_district_and_parcel_without_district_get_nothing(self):
        dzs.build(self.file, self.db, as_of="2026-11-03")
        self.assertNotIn("zoning.max_height_ft", self.facts("0123 0047"))
        self.assertNotIn("zoning.max_height_ft", self.facts("0123 0049"))

    def test_reingest_changes_nothing(self):
        dzs.build(self.file, self.db, as_of="2026-11-03")
        self.assertEqual(dzs.build(self.file, self.db, as_of="2026-11-03").facts_written, 0)


if __name__ == "__main__":
    unittest.main()
