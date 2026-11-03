"""Philadelphia OPA adapter tests on a SYNTHETIC fixture that copies the real ``opa_properties_public.csv`` header.

Every account, name, address, and value here is invented to exercise the mapping; none is real
Philadelphia data. The header row is the real one (nightly file of 2026-11-02).
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import pa_philadelphia

OPA_HEADER = (
    "assessment_date,basements,beginning_point,book_and_page,building_code,building_code_description,category_code,"
    "category_code_description,census_tract,central_air,cross_reference,date_exterior_condition,depth,exempt_building,"
    "exempt_land,exterior_condition,fireplaces,frontage,fuel,garage_spaces,garage_type,general_construction,geographic_ward,"
    "homestead_exemption,house_extension,house_number,interior_condition,location,mailing_address_1,mailing_address_2,"
    "mailing_care_of,mailing_city_state,mailing_street,mailing_zip,market_value,market_value_date,number_of_bathrooms,"
    "number_of_bedrooms,number_of_rooms,number_stories,off_street_open,other_building,owner_1,owner_2,parcel_number,"
    "parcel_shape,quality_grade,recording_date,registry_number,sale_date,sale_price,separate_utilities,sewer,site_type,"
    "state_code,street_code,street_designation,street_direction,street_name,suffix,taxable_building,taxable_land,topography,"
    "total_area,total_livable_area,type_heater,unfinished,unit,utility,view_type,year_built,year_built_estimate,zip_code,"
    "zoning,pin,building_code_new,building_code_description_new,shape"
).split(",")


def row(**fields: str) -> dict[str, str]:
    base = {k: "" for k in OPA_HEADER}
    base.update(assessment_date="2026-04-29 15:45:42+00", mailing_city_state="PHILADELPHIA PA",
                shape="SRID=2272;POINT(2695000.0 236000.0)")
    base.update(fields)
    return base


OPA_ROWS = [
    # Office building, organisation owner; c/o line and an addressee line that differs from the owner;
    # ZIP+4 without hyphen in the mailing ZIP.
    row(parcel_number="881000001", location="100 EXAMPLE ST", unit="", zip_code="19103", category_code="4",
        category_code_description="COMMERCIAL", building_code="DE0", building_code_description="OFF BLD N/COM W/PKG MASON",
        owner_1="EXAMPLE TOWER LLC", owner_2="", mailing_care_of="EXAMPLE MGMT CO", mailing_address_1="EXAMPLE TOWER OWNER",
        mailing_address_2="STE 400", mailing_street="100 EXAMPLE ST", mailing_city_state="PHILADELPHIA PA",
        mailing_zip="191031234", market_value="52000000.00", total_area="40000.000", total_livable_area="250000.000",
        year_built="1985"),
    # Warehouse coded COMMERCIAL by category but industrial by building code → F2; natural-person owner;
    # the addressee line only repeats the owner.
    row(parcel_number="881000002", location="1312-14 S EXAMPLE ST", zip_code="19147", category_code="4",
        category_code_description="COMMERCIAL", building_code="LC0", building_code_description="IND WAREHOUSE MASONRY",
        owner_1="DOE JANE", owner_2="DOE JOHN", mailing_address_1="DOE JANE", mailing_street="1313 S EXAMPLE ST",
        mailing_zip="19147", market_value="436400.00", total_area="2420.000", total_livable_area="4156.000",
        year_built="1925"),
    # Single family: out of scope.
    row(parcel_number="881000003", location="5 OAK LN", zip_code="19104", category_code="1",
        category_code_description="SINGLE FAMILY", building_code="O30", building_code_description="ROW 2 STY MASONRY",
        owner_1="ROE RICHARD", mailing_street="5 OAK LN", mailing_zip="19104", market_value="300000.00",
        total_area="900.000", total_livable_area="1200.000", year_built="1920"),
    # Apartment house in the publisher's multifamily class; unit and ZIP+4 on the situs; year built unknown (0000).
    row(parcel_number="881000004", location="900 RIVER RD", unit="BLDG A", zip_code="191231234", category_code="2",
        category_code_description="MULTI FAMILY", building_code="CA0", building_code_description="APTS 5-50 UNITS MASONRY",
        owner_1="EXAMPLE APARTMENTS LP", mailing_address_1="EXAMPLE APARTMENTS MGMT", mailing_street="1 PARK AVE",
        mailing_city_state="NEW YORK NY", mailing_zip="10001", market_value="30000000.00", total_area="90000.000",
        total_livable_area="180000.000", year_built="0000", year_built_estimate="Y"),
    # Industrial category; blank owner; zero areas are "no figure".
    row(parcel_number="881000005", location="7 SHIELD ST", zip_code="19148", category_code="5",
        category_code_description="INDUSTRIAL", building_code="LB0", building_code_description="IND. LGHT MFG MASONRY",
        owner_1="", owner_2="", mailing_street="", mailing_city_state="", market_value="1000000.00", total_area="0.000",
        total_livable_area="", year_built=""),
    # Mixed use row house with a store: F1 (building code S30 is not an industrial L-code).
    row(parcel_number="881000006", location="2200 EXAMPLE AVE", zip_code="19125", category_code="3",
        category_code_description="MIXED USE", building_code="S30", building_code_description="ROW W/OFF STR 2 STY MASON",
        owner_1="CORNER STORE HOLDINGS LLC", mailing_street="PO BOX 9", mailing_zip="19125-0009",
        market_value="650000.00", total_area="1100.000", total_livable_area="2600.000", year_built="1915"),
    # Vacant land: out of scope even with a commercial building code.
    row(parcel_number="881000007", location="2300 EXAMPLE AVE", zip_code="19125", category_code="6",
        category_code_description="VACANT LAND", building_code="SC", building_code_description="VACANT LAND COMMER < ACRE",
        owner_1="LOT HOLDINGS LLC", mailing_street="PO BOX 10", mailing_zip="19125", market_value="90000.00",
        total_area="1500.000", total_livable_area="0.000", year_built="0000"),
    # Commercial category with an apartment-house building code → B; office/store L-code with a digit stays F1.
    row(parcel_number="881000008", location="400 EXAMPLE BLVD", zip_code="19130", category_code="4",
        category_code_description="COMMERCIAL", building_code="CB0", building_code_description="APTS 51-100 UNITS MASONRY",
        owner_1="EXAMPLE RESIDENCES INC", mailing_street="400 EXAMPLE BLVD", mailing_zip="19130",
        market_value="12000000.00", total_area="20000.000", total_livable_area="80000.000", year_built="1965"),
    row(parcel_number="881000009", location="410 EXAMPLE BLVD", zip_code="19130", category_code="3",
        category_code_description="MIXED USE", building_code="L30", building_code_description="S/D OFF/STR 2 STY MASONRY",
        owner_1="SMALL OFFICE PARTNERS LP", mailing_street="410 EXAMPLE BLVD", mailing_zip="19130",
        market_value="700000.00", total_area="1800.000", total_livable_area="3000.000", year_built="1930"),
    # Duplicate account number: the first row wins.
    row(parcel_number="881000001", location="100 EXAMPLE ST", zip_code="19103", category_code="4",
        category_code_description="COMMERCIAL", building_code="DE0", owner_1="SOMEONE ELSE LLC", market_value="1.00"),
]


def opa_csv(tmp: Path) -> Path:
    p = tmp / "opa_properties_public.csv"
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=OPA_HEADER, lineterminator="\n")
    w.writeheader()
    for r in OPA_ROWS:
        w.writerow(r)
    p.write_text(buf.getvalue(), encoding="utf-8")
    return p


class Philadelphia(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = opa_csv(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in pa_philadelphia.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["881000001", "881000002", "881000004", "881000005", "881000006", "881000008",
                                        "881000009"],
                         "commercial scope: single family (1) and vacant land (6) dropped; duplicate account collapsed")
        tower = recs["881000001"]
        self.assertEqual(tower.county_fips, "101")
        self.assertEqual(tower.state_category, "F1")
        self.assertEqual(tower.local_use_code, "4/DE0")
        self.assertEqual(tower.situs_address, "100 EXAMPLE ST, PHILADELPHIA PA 19103")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC", "the first row for an account wins")
        self.assertEqual(tower.owner_mailing_address,
                         "EXAMPLE MGMT CO, EXAMPLE TOWER OWNER, STE 400, 100 EXAMPLE ST, PHILADELPHIA PA 19103-1234",
                         "c/o, addressee, second line, street, city/state ZIP (hyphen inserted)")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (40000, 250000, 1985))
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (52000000, None, None))
        self.assertEqual(tower.locator, "opa_properties_public.csv parcel_number 881000001")
        self.assertFalse(tower.owner_confidential)
        warehouse = recs["881000002"]
        self.assertEqual(warehouse.state_category, "F2", "an industrial building code moves a commercial row to F2")
        self.assertEqual(warehouse.local_use_code, "4/LC0")
        self.assertEqual(warehouse.owner_name, "DOE JANE", "owner_1 only; owner_2 is not carried")
        self.assertEqual(warehouse.owner_mailing_address, "1313 S EXAMPLE ST, PHILADELPHIA PA 19147",
                         "an addressee line that repeats the owner is dropped")
        apartments = recs["881000004"]
        self.assertEqual(apartments.state_category, "B")
        self.assertEqual(apartments.situs_address, "900 RIVER RD BLDG A, PHILADELPHIA PA 19123-1234")
        self.assertEqual(apartments.owner_mailing_address, "EXAMPLE APARTMENTS MGMT, 1 PARK AVE, NEW YORK NY 10001")
        self.assertIsNone(apartments.year_built, "0000 is 'unknown', not a year")
        industrial = recs["881000005"]
        self.assertEqual(industrial.state_category, "F2")
        self.assertIsNone(industrial.owner_name, "blank owner stays blank")
        self.assertIsNone(industrial.owner_mailing_address)
        self.assertIsNone(industrial.land_area_sf, "0 sf is 'no figure', not a fact")
        self.assertIsNone(industrial.improvement_area_sf)
        self.assertIsNone(industrial.year_built)
        self.assertEqual(industrial.market_value, 1000000)
        self.assertEqual(recs["881000006"].state_category, "F1")
        self.assertEqual(recs["881000006"].owner_mailing_address, "PO BOX 9, PHILADELPHIA PA 19125-0009")
        self.assertEqual(recs["881000008"].state_category, "B", "an apartment-house building code moves a commercial row to B")
        self.assertEqual(recs["881000009"].state_category, "F1", "L30 (S/D OFF/STR) is an office/store, not industrial")

    def test_state_category(self):
        sc = pa_philadelphia.state_category
        self.assertEqual(sc("2", "W30"), "B")
        self.assertEqual(sc("14", "CA0"), "B")
        self.assertEqual(sc("2", "LC0"), "B", "multifamily categories are taken as published")
        self.assertEqual(sc("5", "CA0"), "F2", "the industrial category is taken as published")
        self.assertEqual(sc("3", ""), "F1")
        self.assertEqual(sc("4", None), "F1")
        self.assertEqual(sc("4", "7"), "F2", "INDUS CONDO")
        self.assertEqual(sc("4", "7C1"), "F2")
        self.assertEqual(sc("10", "LE1"), "F2")
        self.assertEqual(sc("15", "AA0"), "F1")
        self.assertEqual(sc("9", "FK0"), "F1")
        self.assertEqual(sc("7", "OB0"), "F1")
        for out in ("1", "6", "8", "11", "12", "13", "16", "", None):
            self.assertIsNone(sc(out, "LC0"), f"category {out!r} is out of scope whatever the building")
        self.assertEqual(pa_philadelphia.local_use_code("4", "aa0"), "4/AA0")
        self.assertEqual(pa_philadelphia.local_use_code("6", ""), "6")
        self.assertIsNone(pa_philadelphia.local_use_code("", "SC"))

    def test_all_categories_and_unpacked_directory(self):
        every = list(pa_philadelphia.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 9, "every distinct account, out-of-scope rows included")
        self.assertIsNone({r.apn: r for r in every}["881000003"].state_category)
        self.assertEqual([r.apn for r in pa_philadelphia.read_roll(self.csv, categories=["B"])], ["881000004", "881000008"])
        unpacked = self.tmp / "unpacked"
        unpacked.mkdir()
        (unpacked / "opa_properties_public.csv").write_bytes(self.csv.read_bytes())
        self.assertEqual([r.apn for r in pa_philadelphia.read_roll(unpacked)],
                         [r.apn for r in pa_philadelphia.read_roll(self.csv)])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = pa_philadelphia.build(self.csv, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (7, 7, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "DOE JANE is a person; the blank owner is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'pa-philadelphia-opa'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("42", "101"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'opa_account' AND external_id = '881000001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-42101:881000001")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWER LLC", owner[0])
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("4/DE0", code[0])
            person = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'opa_account' AND external_id = '881000002'").fetchone()[0]
            self.assertIsNone(reg.db.execute(
                "SELECT 1 FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (person,)).fetchone(),
                "a natural person's name is never stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
