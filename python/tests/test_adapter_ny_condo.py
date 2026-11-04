"""NYC condominium unit-to-billing-lot adapter tests on a SYNTHETIC fixture that copies the real layout.

Every BBL, condominium key and value here is invented to exercise the mapping; none is real New York City data.
Layouts: NYC Open Data CSV (Socrata export) of Digital Tax Map: Condominium Units (eguu-7ie3) and Condominiums
(p8u6-a6it) with the adapter's ``$select``, and the PLUTO CSV of ``ny_pluto.COLUMNS``.
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import ParcelRecord, Registry
from factlot.registry.adapters import ny_condo, ny_nyc, ny_pluto


def csv_text(columns, rows):
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL)
    w.writerow(columns)
    for r in rows:
        w.writerow([r.get(c, "") for c in columns])
    return out.getvalue()


CONDOS = [
    dict(condo_key="100835", condo_base_bbl="1000090001", condo_billing_bbl="1000097501"),
    dict(condo_key="300001", condo_base_bbl="3001230045", condo_billing_bbl="3001237501"),
    dict(condo_key="400002", condo_base_bbl="4005670089", condo_billing_bbl=""),  # no billing lot recorded
    dict(condo_key="100777", condo_base_bbl="1000100001", condo_billing_bbl="1000107501"),  # billing lot not in PLUTO
]
UNITS = [
    dict(unit_bbl="1000091001", condo_key="100835", condo_base_bbl="1000090001"),
    dict(unit_bbl="1000091002", condo_key="100835", condo_base_bbl="1000090001"),
    dict(unit_bbl="1000091003", condo_key="100835", condo_base_bbl="1000090001"),  # has a PLUTO row of its own
    dict(unit_bbl="3001231001", condo_key="300001", condo_base_bbl="3001230045"),
    dict(unit_bbl="4005671001", condo_key="400002", condo_base_bbl="4005670089"),
    dict(unit_bbl="1000101001", condo_key="100777", condo_base_bbl="1000100001"),
    dict(unit_bbl="1000102001", condo_key="999999", condo_base_bbl="1000100001"),  # a condominium the table does not list
    dict(unit_bbl="", condo_key="100835"),
]
PLUTO = [
    dict(bbl="1000097501.00000000", zonedist1="C5-3", zonedist2="C6-4.5", spdist1="MiD", splitzone="true", landuse="5",
         comarea="500000", officearea="450000", numbldgs="1", numfloors="40.0", unitsres="0", unitstotal="120",
         yearalter1="1999", histdist="Example Historic District", landmark="Example Tower", builtfar="17.5",
         residfar="10.0", commfar="15.0", facilfar="15.0", version="26v2"),
    dict(bbl="3001237501.00000000", zonedist1="R6B", overlay1="C1-3", landuse="02", resarea="20000", numbldgs="1",
         numfloors="2.5", unitsres="24", unitstotal="24", builtfar="2.0", residfar="2.0", version="26v2"),
    dict(bbl="1000091003.00000000", zonedist1="C1-1", landuse="5", version="26v2"),  # a unit with its own row
]


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.units = self.dir / "units.csv"
        self.condos = self.dir / "condos.csv"
        self.pluto = self.dir / "pluto.csv"
        self.units.write_text(csv_text(ny_condo.UNIT_COLUMNS, UNITS))
        self.condos.write_text(csv_text(ny_condo.CONDO_COLUMNS, CONDOS))
        self.pluto.write_text(csv_text(ny_pluto.COLUMNS, PLUTO))


class TestReader(Fixture):
    def read(self):
        counts = ny_condo.Counts()
        out = {p.apn: p for p in ny_condo.read_inherited(self.units, self.condos, self.pluto, pluto_doc_prefix="(fl:document:sha256-abcd…)", counts=counts)}
        return out, counts

    def test_a_unit_gets_zoning_and_building_facts_from_its_billing_lot(self):
        out, counts = self.read()
        self.assertEqual(sorted(out), ["1000091001", "1000091002", "3001231001"])
        facts = {p: v for p, v, _u in out["1000091001"].facts}
        self.assertEqual(facts["zoning.district"], "C5-3")
        self.assertEqual(facts["zoning.other_districts"], ["C6-4.5"])
        self.assertEqual(facts["zoning.special_district"], ["MiD"])
        self.assertEqual(facts["zoning.max_far_commercial"], 15)
        self.assertEqual(facts["parcel.num_floors"], 40)
        self.assertEqual(facts["parcel.year_altered"], 1999)
        self.assertEqual(facts["parcel.historic_district"], "Example Historic District")
        self.assertTrue(facts["parcel.landmark_designated"])
        self.assertEqual(out["1000091001"].county_fips, "061")
        self.assertEqual(out["3001231001"].county_fips, "047")
        self.assertEqual((counts.units_in_table, counts.units_inheriting, counts.billing_lots_used), (7, 3, 2))

    def test_complex_wide_totals_are_not_copied_to_a_unit(self):
        out, _ = self.read()
        for p in out.values():
            predicates = {pred for pred, _v, _u in p.facts}
            self.assertFalse(predicates & {"parcel.built_far", "parcel.num_buildings", "parcel.units_residential",
                                           "parcel.units_total", "parcel.area_by_use_sf", "parcel.land_use_code"}, predicates)

    def test_inherited_facts_are_labelled_inferred_and_say_where_from(self):
        out, _ = self.read()
        p = out["1000091002"]
        self.assertEqual((p.method, p.confidence), ("inferred", 0.9))
        self.assertIn("inherits from billing lot 1000097501", p.locator)
        self.assertIn("condo 100835", p.locator)
        self.assertIn("PLUTO 26v2 line 2", p.locator)
        self.assertIn("fl:document:sha256-abcd", p.locator)

    def test_skips_units_with_a_pluto_row_no_billing_lot_or_no_pluto_row(self):
        out, counts = self.read()
        self.assertNotIn("1000091003", out)  # its own PLUTO row stands
        self.assertNotIn("4005671001", out)  # the condominium has no billing lot
        self.assertNotIn("1000101001", out)  # the billing lot is not in PLUTO
        self.assertNotIn("1000102001", out)  # the condominium is not in the condominiums table
        self.assertEqual((counts.units_with_own_pluto_row, counts.units_billing_lot_not_in_pluto), (1, 1))
        self.assertEqual(counts.units_without_billing_lot, 2)

    def test_inheritance_rule(self):
        self.assertTrue(ny_condo.inherited("zoning.max_far_residential"))
        self.assertTrue(ny_condo.inherited("parcel.num_floors"))
        self.assertFalse(ny_condo.inherited("parcel.area_by_use_sf"))
        self.assertFalse(ny_condo.inherited("transaction.sale"))


class TestIngest(Fixture):
    def setUp(self):
        super().setUp()
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        reg.add_source(ny_nyc.SOURCE)
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic roll")
        snap = reg.add_snapshot("ny-nyc-dof", roll, as_of="2026-05-15")
        reg.ingest_parcels([
            ParcelRecord("061", "1000091001", "F1", account="1000091001"),
            ParcelRecord("061", "1000091003", "F1", account="1000091003"),
            ParcelRecord("047", "3001231001", "B", account="3001231001"),
        ], snap, state_fips="36", account_system="nyc_bbl", full_roll=True)
        reg.close()
        ny_pluto.build(self.pluto, self.db, as_of="2026-08-24")

    def facts(self, bbl):
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_external("nyc_bbl", bbl))["facts"]}
        finally:
            reg.close()

    def test_unit_inherits_and_the_unit_with_its_own_row_keeps_it(self):
        stats = ny_condo.build(self.units, self.condos, self.pluto, self.db, as_of="2026-08-24")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (3, 2, 1))  # the 1000091002 unit is not in the registry
        f = self.facts("1000091001")
        self.assertEqual(f["zoning.district"]["value"], "C5-3")
        self.assertEqual(f["zoning.district"]["provenance"]["method"], "inferred")
        self.assertEqual(f["zoning.district"]["provenance"]["confidence"], 0.9)
        self.assertEqual(f["zoning.district"]["as_of"], "2026-08-24")
        self.assertIn("inherits from billing lot 1000097501", f["zoning.district"]["provenance"]["sources"][0]["section"])
        self.assertEqual(f["parcel.num_floors"]["value"], 40)
        self.assertNotIn("parcel.area_by_use_sf", f)
        own = self.facts("1000091003")
        self.assertEqual(own["zoning.district"]["value"], "C1-1")
        self.assertEqual(own["zoning.district"]["provenance"]["method"], "public_record")
        self.assertEqual(self.facts("3001231001")["zoning.district"]["value"], "R6B")

    def test_rights_and_citation(self):
        ny_condo.build(self.units, self.condos, self.pluto, self.db, as_of="2026-08-24")
        f = self.facts("3001231001")["zoning.district"]
        self.assertTrue(f["provenance"]["sources"][0]["document_id"].startswith("fl:document:sha256-"))
        self.assertIn("Digital Tax Map", f["provenance"]["sources"][0]["title"])
        self.assertEqual(f["rights"]["redistribution"], "permitted")
        self.assertIn("PLUTO", f["rights"]["attribution"])

    def test_reingest_changes_nothing(self):
        ny_condo.build(self.units, self.condos, self.pluto, self.db, as_of="2026-08-24")
        self.assertEqual(ny_condo.build(self.units, self.condos, self.pluto, self.db, as_of="2026-08-24").facts_written, 0)


if __name__ == "__main__":
    unittest.main()
