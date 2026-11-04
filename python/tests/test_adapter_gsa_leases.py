"""GSA lease inventory adapter tests on a SYNTHETIC workbook that copies the published layout.

Every lease number, address, lessor and amount here is invented. The workbook is written with the standard
library (inline strings, numeric Excel dates), as the publisher's is read.
"""

import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

from factlot import ids
from factlot.comps import validate_lease_comp
from factlot.facts import validate_fact
from factlot.registry import ParcelRecord, Registry
from factlot.registry.adapters import gsa_leases as g
from factlot.registry.counties import county_fips

HEADER = ["Region", "Lease Num", "Location Code", "City", "County", "Address", "State", "ZipCode", "Latitude", "Longitude",
          "Field Office Name", "Cen Bus Unit Ind", "Lease Effective", "Lease Expiration", "Termination Right Date",
          "Latest Action affecting Term", "Fully Serviced", "Lease Agreement RSF", "Lease Structured Parking",
          "Lease Surface parking", "Percent Building", "Current Annual Rent", "Percent Office", "Percent Warehouse",
          "Percent Special", "Renewal Option Term left", "Renewal Options Left", "Lessor name"]


def serial(d: date) -> int:
    return (d - date(1899, 12, 30)).days


def lease(num, *, county="TRAVIS", street="100 EXAMPLE ST", city="AUSTIN", state="TX", zip_="78701-1234", eff=date(2022, 10, 1),
          exp=date(2032, 9, 30), term_right=None, action="New", serviced="Y", rsf=10000, rent=300000, office=1.0,
          warehouse=None, special=None, options=1, lessor="EXAMPLE PLAZA LLC"):
    return [6, num, "TX0001", city, county, street, state, zip_, 30.0, -97.0, "FIELD OFFICE", "Y", serial(eff), serial(exp),
            serial(term_right or exp), action, serviced, rsf, 0, 0, 100.0, rent, office, warehouse, special, 60, options, lessor]


def write_xlsx(path: Path, rows: list[list]) -> None:
    def cell(ref, v):
        if v is None:
            return ""
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>'

    def col(i):
        return chr(65 + i) if i < 26 else "A" + chr(65 + i - 26)

    body = "".join(f'<row r="{n}">' + "".join(cell(f"{col(i)}{n}", v) for i, v in enumerate(row)) + "</row>"
                   for n, row in enumerate(rows, 1))
    sheet = f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{body}</sheetData></worksheet>'
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                    '<sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>')
        zf.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        zf.writestr("xl/worksheets/sheet1.xml", sheet)


class TestGsaLeases(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.reg = Registry(self.dir / "r.db")
        self.addCleanup(self.reg.close)

    def load(self, rows, name="inv.xlsx", as_of="2026-11-01"):
        write_xlsx(self.dir / name, [HEADER, *rows])
        return g.ingest(self.reg, self.dir / name, as_of, retrieved_at="2026-11-04T00:00:00+00:00")

    def facts(self, number):
        return {f["predicate"]: f for f in self.reg.facts(g.lease_urn(number))}

    def test_a_lease_becomes_a_comp_with_rent_per_rsf_term_and_the_government_caveat(self):
        stats = self.load([lease("LTX00001", term_right=date(2027, 9, 30), options=2)])
        self.assertEqual((stats.leases, stats.comps), (1, 1))
        facts = self.facts("LTX00001")
        comp = facts["lease.comp"]["value"]
        self.assertEqual(comp["current_rent_psf_yr"], 30.0)
        self.assertEqual((comp["term_months"], comp["commencement_date"], comp["expiration_date"]), (120, "2022-10-01", "2032-09-30"))
        self.assertEqual(comp["early_termination_date"], "2027-09-30")
        self.assertEqual((comp["tenant_type"], comp["expense_basis"], comp["property_type"]), ("government_federal", "full_service", "office"))
        self.assertEqual((comp["confirming_party"], comp["verification"]), ("public_record", "public_record"))
        self.assertEqual(comp["renewal_options"], {"count": 2})
        self.assertIn("not market comps for every use", comp["notes"])
        self.assertIn("2026-11-01", comp["notes"])
        self.assertNotIn("starting_rent_psf_yr", comp)
        self.assertEqual(facts["lease.landlord"]["value"], "EXAMPLE PLAZA LLC")
        self.assertEqual(facts["lease.rentable_area_sf"]["value"], 10000)

    def test_every_fact_passes_fact_validate_and_the_comp_passes_lease_comp_validate(self):
        self.load([lease("LTX00001"), lease("LTX00002", serviced="N", rent=500000, warehouse=0.9, office=0.1)])
        for number in ("LTX00001", "LTX00002"):
            for fact in self.reg.facts(g.lease_urn(number)):
                self.assertEqual(validate_fact(fact), {"valid": True, "issues": []}, fact["predicate"])
                self.assertEqual(fact["provenance"]["method"], "public_record")
                self.assertEqual(fact["rights"]["redistribution"], "permitted")
            comp = self.facts(number)["lease.comp"]
            result = validate_lease_comp({"fact": comp, "profile": "observed"}, {"name": "t", "version": "1"})
            self.assertEqual(result["issues"], [], number)
            self.assertIsNone(result["ner"])  # an observed current rent has no starting rent to derive an NER from
        self.assertEqual(self.facts("LTX00002")["lease.comp"]["value"]["property_type"], "industrial")
        self.assertEqual(self.facts("LTX00002")["lease.comp"]["value"]["expense_basis"], "not_full_service")

    def test_lease_id_is_reproducible_and_a_valid_lease_urn(self):
        urn = g.lease_urn("LTX00001")
        self.assertEqual(urn, g.lease_urn("LTX00001"))
        self.assertNotEqual(urn, g.lease_urn("LTX00002"))
        self.assertEqual(ids.parse(urn)[0], "lease")
        self.assertTrue(urn.startswith("fl:lease:0000000000"))

    def test_building_id_comes_from_address_zip_and_county_fips(self):
        self.load([lease("LTX00001", street="100 Example Street Suite 4")])
        self.assertEqual(county_fips("TX", "TRAVIS"), ("48", "453"))
        expected = ids.building_id("48", "453", "78701", "100 Example St").urn
        self.assertEqual(self.facts("LTX00001")["lease.comp"]["value"]["building"], expected)
        rel = self.reg.db.execute("SELECT to_urn, method FROM relationships WHERE from_urn = ? AND type = 'leases'",
                                  (g.lease_urn("LTX00001"),)).fetchone()
        self.assertEqual((rel[0], rel[1]), (expected, "public_record"))

    def test_person_lessors_are_dropped_and_organisations_kept(self):
        stats = self.load([lease("L1", lessor="DOE, JANE Q"), lease("L2", lessor="DOE REALTY INC"), lease("L3", lessor=None)])
        self.assertEqual((stats.lessors_stored, stats.lessors_dropped_not_organization, stats.lessors_blank), (1, 1, 1))
        self.assertNotIn("lease.landlord", self.facts("L1"))
        self.assertEqual(self.facts("L2")["lease.landlord"]["value"], "DOE REALTY INC")
        stored = " ".join(r[0] for r in self.reg.db.execute("SELECT value_json FROM facts"))
        self.assertNotIn("JANE", stored)

    def test_rows_that_cannot_be_comps_are_counted_not_guessed(self):
        stats = self.load([
            lease("L1", rsf=None), lease("L2", street=None), lease("L3", eff=date(2030, 1, 1), exp=date(2029, 1, 1)),
            lease("L4", rent=None), lease("L5", rent=400), lease("L6", rent=9_000_000),
            lease("L7", county="NOT A COUNTY"), lease("L8", street="BRADLEY FIELD"), lease("L9", zip_=None),
        ])
        self.assertEqual(stats.skipped_rows, {"no_rsf": 1, "no_address_or_state": 1, "bad_dates": 1})
        self.assertEqual(stats.comps_not_published, {"no_rent": 1, "rent_psf_outside_bounds": 2})
        self.assertEqual(stats.leases, 6)
        self.assertEqual(stats.comps, 3)
        self.assertEqual(stats.building_id_missing, {"county_not_matched": 1, "street_has_no_house_number": 1, "no_zip": 1})
        self.assertNotIn("lease.comp", self.facts("L5"))
        self.assertIn("lease.expiration_date", self.facts("L5"))

    def test_zip_extension_cut_off_by_gsa_is_read(self):
        self.load([lease("L1", zip_="78701-")])
        self.assertIn(":78701:", self.facts("L1")["lease.comp"]["value"]["building"])

    def test_reload_is_idempotent_and_a_dropped_lease_is_retired(self):
        rows = [lease("L1"), lease("L2")]
        first = self.load(rows)
        again = self.load(rows)
        self.assertEqual(again.facts_written, 0)
        n = self.reg.db.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        self.assertEqual(n, first.facts_written)
        later = self.load([lease("L1", rent=330000)], name="inv2.xlsx", as_of="2026-12-01")
        self.assertEqual(later.retired, 1)
        self.assertEqual(self.facts("L1")["lease.comp"]["value"]["current_rent_psf_yr"], 33.0)
        self.assertEqual(self.reg.status(g.lease_urn("L2")), "not_in_latest_snapshot")
        self.assertEqual(self.facts("L2"), {})  # retired: no current facts
        self.assertGreater(len(self.reg.facts(g.lease_urn("L2"), history=True)), 0)

    def test_crosswalk_address_search_and_registry_get(self):
        self.load([lease("LTX00001")])
        urn = g.lease_urn("LTX00001")
        self.assertEqual(self.reg.resolve_external("gsa-lease-number", "LTX00001"), urn)
        self.assertEqual([r["urn"] for r in self.reg.search_address("100 Example St")], [urn])
        record = self.reg.get(urn)
        self.assertEqual(record["kind"], "lease")
        self.assertEqual(record["crosswalk"], [{"system": "gsa-lease-number", "external_id": "LTX00001"}])

    def test_a_lease_links_to_the_parcel_at_its_address(self):
        self.reg.add_source(g.Source("tx-test", "Test CAD", "roll", "https://example.test", "48", "test", county_fips="453"))
        snap = self.reg.add_snapshot("tx-test", self.dir / "r.db", "2026-01-01")
        self.reg.ingest_parcels([
            ParcelRecord("453", "P1", state_category="F1", situs_address="100 EXAMPLE ST, AUSTIN, TX 78701"),
            ParcelRecord("453", "P2", state_category="F1", situs_address="200 OTHER ST, AUSTIN, TX 78701"),
        ], snap, state_fips="48")
        self.load([lease("LTX00001")])
        counts = g.link_parcels(self.reg)
        self.assertEqual(counts, {"leases_with_building_id": 1, "leases_linked": 1, "links": 1})
        rel = self.reg.db.execute("SELECT to_urn, method, confidence FROM relationships WHERE from_urn = ? AND to_urn LIKE 'fl:parcel:%'",
                                  (g.lease_urn("LTX00001"),)).fetchone()
        self.assertEqual(tuple(rel), (ids.parcel_id("48", "453", "P1").urn, "inferred", 0.8))
        self.assertEqual(g.link_parcels(self.reg), counts)  # rebuilt, not duplicated
        self.assertEqual(self.reg.db.execute("SELECT COUNT(*) FROM relationships WHERE type = 'leases' AND to_urn LIKE 'fl:parcel:%'").fetchone()[0], 1)

    def test_counties_resolve_names_gsa_writes(self):
        for state, name, expected in [("VA", "RICHMOND (CITY)", ("51", "760")), ("VA", "RICHMOND", ("51", "159")),
                                      ("CT", "SOUTH CENTRAL CONNECTICUT PLAN", ("09", "170")), ("NM", "DONA ANA", ("35", "013")),
                                      ("DC", "DISTRICT OF COLUMBIA", ("11", "001")), ("MS", "DE SOTO", ("28", "033")),
                                      ("TX", "NOWHERE", None), ("TX", None, None)]:
            self.assertEqual(county_fips(state, name), expected, (state, name))


if __name__ == "__main__":
    unittest.main()
