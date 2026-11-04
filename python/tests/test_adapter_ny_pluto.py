"""NYC Department of City Planning PLUTO adapter tests on a SYNTHETIC fixture that copies the real layout.

Every BBL and value here is invented to exercise the mapping; none is real New York City data.
The layout is the NYC Open Data CSV (Socrata export) of dataset 64uk-42ks with the adapter's $select.
"""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import ParcelFacts, ParcelRecord, Registry, Source
from factlot.registry.adapters import ny_nyc, ny_pluto


def pluto_csv(rows: list[dict[str, str]]) -> str:
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL)
    w.writerow(ny_pluto.COLUMNS)
    for r in rows:
        w.writerow([r.get(c, "") for c in ny_pluto.COLUMNS])
    return out.getvalue()


ROWS = [
    # Manhattan office tower split by a district boundary, in a special district, landmarked.
    dict(bbl="1000090001.00000000", zonedist1="C5-3", zonedist2="C6-4.5", spdist1="MiD", splitzone="true",
         landuse="5", comarea="500000", officearea="450000", retailarea="50000", resarea="0", numbldgs="1",
         numfloors="40.0000000", unitsres="0", unitstotal="12", yearalter1="1999", yearalter2="2011",
         histdist="Example Historic District", landmark="Example Tower", builtfar="17.5",
         residfar="10.0", commfar="15.0", facilfar="15.0", mnffar="0.0", affresfar="12.0", version="26v2"),
    # Brooklyn apartment building: residential district, overlay, no commercial FAR, 2.5 floors.
    dict(bbl="3001230045.00000000", zonedist1="R6B", overlay1="C1-3", overlay2="C2-3", splitzone="false",
         landuse="02", resarea="20000", numbldgs="1", numfloors="2.5", unitsres="24", unitstotal="24",
         builtfar="2.0", residfar="2.0", commfar="0", facilfar="2.0", ltdheight="LH-1", edesignum="E-999",
         version="26v2"),
    # Queens warehouse in a manufacturing district.
    dict(bbl="4005670089.00000000", zonedist1="M1-1", landuse="6", factryarea="30000", numbldgs="2",
         numfloors="1.0", builtfar="1.0", commfar="1.0", facilfar="2.4", mnffar="1.0", version="26v2"),
    # A lot the registry does not hold (one-family house): skipped as out of scope.
    dict(bbl="2034560012.00000000", zonedist1="R3A", landuse="01", residfar="0.5", version="26v2"),
    # No BBL, and a row with a BBL but nothing to say: both yield nothing.
    dict(bbl="", zonedist1="R1"),
    dict(bbl="4005670090.00000000"),
    # Lot of a borough digit that does not exist.
    dict(bbl="9000000001.00000000", zonedist1="R1"),
]


class TestPlutoFacts(unittest.TestCase):
    def test_full_row(self):
        facts = {p: (v, u) for p, v, u in ny_pluto.facts_of(ROWS[0])}
        self.assertEqual(facts["zoning.district"], ("C5-3", None))
        self.assertEqual(facts["zoning.other_districts"], (["C6-4.5"], None))
        self.assertEqual(facts["zoning.special_district"], (["MiD"], None))
        self.assertEqual(facts["zoning.split_zone"], (True, None))
        self.assertEqual(facts["zoning.max_far_residential"], (10, None))
        self.assertEqual(facts["zoning.max_far_commercial"], (15, None))
        self.assertEqual(facts["zoning.max_far_affordable_residential"], (12, None))
        self.assertNotIn("zoning.max_far_manufacturing", facts)  # 0 means none listed
        self.assertEqual(facts["parcel.built_far"], (17.5, None))
        self.assertEqual(facts["parcel.num_floors"], (40, None))
        self.assertEqual(facts["parcel.num_buildings"], (1, None))
        self.assertNotIn("parcel.units_residential", facts)
        self.assertEqual(facts["parcel.units_total"], (12, None))
        self.assertEqual(facts["parcel.area_by_use_sf"], ({"commercial": 500000, "office": 450000, "retail": 50000}, "sf"))
        self.assertEqual(facts["parcel.land_use_code"], ("05", None))
        self.assertEqual(facts["parcel.year_altered"], (2011, None))
        self.assertEqual(facts["parcel.historic_district"], ("Example Historic District", None))
        # The landmark's name is not stored (some are named for people): only that it is designated.
        self.assertEqual(facts["parcel.landmark_designated"], (True, None))
        self.assertNotIn("Example Tower", json.dumps(facts))

    def test_second_row(self):
        facts = {p: v for p, v, _u in ny_pluto.facts_of(ROWS[1])}
        self.assertEqual(facts["zoning.district"], "R6B")
        self.assertNotIn("zoning.other_districts", facts)
        self.assertEqual(facts["zoning.commercial_overlay"], ["C1-3", "C2-3"])
        self.assertNotIn("zoning.split_zone", facts)  # "false"
        self.assertNotIn("zoning.max_far_commercial", facts)
        self.assertEqual(facts["parcel.num_floors"], 2.5)
        self.assertEqual(facts["zoning.limited_height_district"], "LH-1")
        self.assertEqual(facts["zoning.e_designation"], "E-999")
        self.assertEqual(facts["parcel.land_use_code"], "02")

    def test_lot_area_building_area_and_year_built_are_left_to_the_roll(self):
        row = dict(ROWS[0], lotarea="30000", bldgarea="500000", yearbuilt="1970", ownername="EXAMPLE OWNER LLC")
        predicates = {p for p, _v, _u in ny_pluto.facts_of(row)}
        self.assertFalse(predicates & {"parcel.land_area_sf", "parcel.improvement_area_sf", "parcel.year_built"})
        self.assertFalse(any("owner" in p for p in predicates))

    def test_bbl(self):
        self.assertEqual(ny_pluto.bbl("1000090001.00000000"), ("061", "1000090001"))
        self.assertEqual(ny_pluto.bbl("5000010001"), ("085", "5000010001"))
        self.assertIsNone(ny_pluto.bbl(""))
        self.assertIsNone(ny_pluto.bbl("9000090001.0"))
        self.assertIsNone(ny_pluto.bbl("100009"))

    def test_columns_never_include_owner_or_geometry(self):
        self.assertFalse({"ownername", "ownertype", "geom", "address"} & set(ny_pluto.COLUMNS))


class TestPlutoIngest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        reg.add_source(ny_nyc.SOURCE)
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic roll")
        snap = reg.add_snapshot("ny-nyc-dof", roll, as_of="2026-05-15")
        reg.ingest_parcels([
            ParcelRecord("061", "1000090001", "F1", account="1000090001", situs_address="1 EXAMPLE STREET, NEW YORK NY 10004",
                         land_area_sf=29481, year_built=1970),
            ParcelRecord("047", "3001230045", "B", account="3001230045", situs_address="100 EXAMPLE AVENUE, BROOKLYN NY 11201"),
            ParcelRecord("081", "4005670089", "F2", account="4005670089"),
        ], snap, state_fips="36", account_system="nyc_bbl", full_roll=True)
        reg.close()
        self.csv = self.dir / "pluto.csv"
        self.csv.write_text(pluto_csv(ROWS))

    def facts(self, bbl: str) -> dict:
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_external("nyc_bbl", bbl))["facts"]}
        finally:
            reg.close()

    def test_adds_facts_to_known_parcels_and_creates_none(self):
        stats = ny_pluto.build(self.csv, self.db, as_of="2026-08-24", retrieved_at="2026-11-04T03:51:37+00:00")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope, stats.skipped_invalid), (4, 3, 1, 0))
        reg = Registry(self.db)
        try:
            self.assertEqual(reg.stats()["parcels"], 3)
        finally:
            reg.close()
        f = self.facts("1000090001")
        self.assertEqual(f["zoning.district"]["value"], "C5-3")
        self.assertEqual(f["zoning.district"]["as_of"], "2026-08-24")
        # Roll facts are untouched and still cited to the roll.
        self.assertEqual(f["parcel.land_area_sf"]["value"], 29481)
        self.assertEqual(f["parcel.year_built"]["provenance"]["sources"][0]["title"].split(":")[0],
                         "New York City Department of Finance")

    def test_every_fact_cites_the_file_the_record_and_carries_rights(self):
        ny_pluto.build(self.csv, self.db, as_of="2026-08-24", retrieved_at="2026-11-04T03:51:37+00:00")
        fact = self.facts("3001230045")["zoning.district"]
        src = fact["provenance"]["sources"][0]
        self.assertTrue(src["document_id"].startswith("fl:document:sha256-"))
        self.assertEqual(src["section"], "line 3 BBL 3001230045 (PLUTO 26v2)")
        self.assertEqual(fact["provenance"]["method"], "public_record")
        self.assertEqual(fact["rights"]["redistribution"], "permitted")
        self.assertIn("City Planning", fact["rights"]["attribution"])

    def test_reingest_changes_nothing(self):
        ny_pluto.build(self.csv, self.db, as_of="2026-08-24")
        reg = Registry(self.db)
        before = reg.stats()
        reg.close()
        stats = ny_pluto.build(self.csv, self.db, as_of="2026-08-24")
        self.assertEqual(stats.facts_written, 0)
        reg = Registry(self.db)
        try:
            self.assertEqual(reg.stats(), before)
        finally:
            reg.close()

    def test_a_newer_file_replaces_and_a_dropped_lot_becomes_history(self):
        ny_pluto.build(self.csv, self.db, as_of="2026-08-24")
        newer = self.dir / "pluto2.csv"
        newer.write_text(pluto_csv([dict(ROWS[0], zonedist1="C6-4", zonedist2=""), ROWS[1]]))
        stats = ny_pluto.build(newer, self.db, as_of="2026-11-24")
        self.assertEqual(stats.retired, 1)  # the Queens warehouse is not in the newer file
        self.assertEqual(self.facts("1000090001")["zoning.district"]["value"], "C6-4")
        self.assertNotIn("zoning.other_districts", self.facts("1000090001"))
        self.assertNotIn("zoning.district", self.facts("4005670089"))  # history now
        reg = Registry(self.db)
        try:
            urn = reg.resolve_external("nyc_bbl", "4005670089")
            self.assertEqual(reg.status(urn), "current")  # the roll still lists it
            hist = [f for f in reg.facts(urn, history=True) if f["predicate"] == "zoning.district"]
            self.assertEqual([f["value"] for f in hist], ["M1-1"])
        finally:
            reg.close()


class TestIngestParcelFacts(unittest.TestCase):
    def test_invalid_and_unknown_parcels_are_counted_and_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            reg = Registry(Path(d) / "r.db")
            reg.add_source(Source("x", "Example", "Example", "https://example.invalid", "36", license="synthetic"))
            f = Path(d) / "f.txt"
            f.write_text("x")
            snap = reg.add_snapshot("x", f, as_of="2026-01-01")
            stats = reg.ingest_parcel_facts([
                ParcelFacts("061", "1000090001", [("zoning.district", "R1", None)]),
                ParcelFacts("06", "1000090002", [("zoning.district", "R1", None)]),
            ], snap, state_fips="36")
            self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope, stats.skipped_invalid), (2, 0, 1, 1))
            self.assertEqual(reg.stats()["facts"], 0)
            reg.close()

    def test_an_enrichment_source_does_not_keep_a_retired_parcel_current(self):
        with tempfile.TemporaryDirectory() as d:
            reg = Registry(Path(d) / "r.db")
            reg.add_source(Source("roll", "Example", "Roll", "https://example.invalid", "36", license="synthetic"))
            reg.add_source(Source("zoning", "Example", "Zoning", "https://example.invalid", "36", license="synthetic"))
            for name in ("roll1", "roll2", "zone"):
                (Path(d) / name).write_text(name)
            r1 = reg.add_snapshot("roll", Path(d) / "roll1", as_of="2026-01-01")
            reg.ingest_parcels([ParcelRecord("061", "1000090001", "F1")], r1, state_fips="36", full_roll=True)
            reg.ingest_parcel_facts([ParcelFacts("061", "1000090001", [("zoning.district", "C5-3", None)])],
                                    reg.add_snapshot("zoning", Path(d) / "zone", as_of="2026-02-01"), state_fips="36")
            urn = reg.resolve_parcel("36", "061", "1000090001")
            self.assertEqual(reg.status(urn), "current")
            r2 = reg.add_snapshot("roll", Path(d) / "roll2", as_of="2027-01-01")
            reg.ingest_parcels([], r2, state_fips="36", full_roll=True)  # the roll no longer lists the lot
            self.assertEqual(reg.status(urn), "not_in_latest_snapshot")
            reg.close()


if __name__ == "__main__":
    unittest.main()
