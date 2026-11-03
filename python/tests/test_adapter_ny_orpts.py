"""New York ORPTS assessment-roll adapter tests on a SYNTHETIC fixture.

The header is the column subset the collector requests from Open NY dataset 7vem-aaz7 (2026-11-03);
every SWIS, print key, name, address, and value below is invented to exercise the mapping.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ny_orpts

HEADER = (
    "roll_year,county_name,municipality_code,municipality_name,swis_code,tax_class,roll_section,property_class,"
    "property_class_description,print_key_code,parcel_address_number,parcel_address_street,parcel_address_suff,front,"
    "depth,primary_owner_first_name,primary_owner_mi,primary_owner_last_name,primary_owner_suffix,"
    "mailing_address_prefix,mailing_address_number,mailing_address_street,mailing_address_suff,mailing_address_city,"
    "mailing_address_state,mailing_address_zip,mailing_address_country,mailing_address_po_box,full_market_value,"
    "assessment_land,assessment_total"
)
COLUMNS = HEADER.split(",")


def row(**values: str) -> str:
    cells = []
    for c in COLUMNS:
        v = values.get(c, "")
        cells.append(f'"{v}"' if v or c in values else "")
    return ",".join(cells)


ROWS = [
    # apartment building, company owner, full market value, mailing PO box and city
    row(roll_year="2025", county_name="Monroe", municipality_code="261400", municipality_name="Rochester",
        swis_code="261400", roll_section="1", property_class="411", property_class_description="Apartments",
        print_key_code="047.30-1-24", parcel_address_number="425", parcel_address_street="BEACH", parcel_address_suff="AVE",
        primary_owner_last_name="EXAMPLE APARTMENTS LLC", mailing_address_number="69", mailing_address_street="LOWDEN POINT",
        mailing_address_suff="RD", mailing_address_city="ROCHESTER", mailing_address_state="NY", mailing_address_zip="14612",
        full_market_value="4000000", assessment_total="1500000"),
    # the same print key without the dot is a different parcel: must not collide
    row(roll_year="2025", county_name="Monroe", municipality_name="Rochester", swis_code="261400", property_class="482",
        property_class_description="Downtown Row Type (detached)", print_key_code="047.301-24", parcel_address_number="7",
        parcel_address_street="MAIN", parcel_address_suff="ST", primary_owner_last_name="MAIN STREET HOLDINGS INC",
        mailing_address_po_box="123", mailing_address_city="ROCHESTER", mailing_address_state="NY", mailing_address_zip="14604",
        full_market_value="0"),
    # warehouse, person split across first/last (Monroe style): kept, owner dropped by the registry
    row(roll_year="2025", county_name="Monroe", municipality_name="Gates", swis_code="262000", property_class="449",
        property_class_description="Other Storage, Warehouse and Distribution Facilities", print_key_code="101-1-2",
        parcel_address_number="1", parcel_address_street="INDUSTRIAL", parcel_address_suff="PKWY",
        primary_owner_first_name="Pat", primary_owner_mi="Q", primary_owner_last_name="Example", primary_owner_suffix="Jr",
        full_market_value="650000"),
    # manufacturing: industrial
    row(roll_year="2025", county_name="Monroe", municipality_name="Chili", swis_code="261800", property_class="710",
        property_class_description="Manufacturing and Processing", print_key_code="12.-1-3", parcel_address_number="9",
        parcel_address_street="FACTORY", primary_owner_last_name="EXAMPLE MFG CORP", full_market_value="2200000"),
    # Suffolk style: whole person name in the last-name column
    row(roll_year="2025", county_name="Suffolk", municipality_name="Islip", swis_code="473200", property_class="411",
        print_key_code="500.-1-1", parcel_address_number="10", parcel_address_street="OCEAN", parcel_address_suff="AVE",
        primary_owner_last_name="EXAMPLE, PAT & CHRIS", full_market_value="0"),
    # Suffolk 410 Living Accomodations: residential in practice, out of scope; 412 condominium: out of scope
    row(roll_year="2025", county_name="Suffolk", municipality_name="Babylon", swis_code="472001", property_class="410",
        property_class_description="Living Accomodations", print_key_code="10.1-1-1", parcel_address_number="1",
        parcel_address_street="HARBOR RD N", primary_owner_last_name="EXAMPLE, LINDA"),
    row(roll_year="2025", county_name="Nassau", municipality_name="Glen Cove", swis_code="280500", property_class="412",
        property_class_description="Condominium", print_key_code="21-19.-135", parcel_address_number="29",
        parcel_address_street="SUNSET AVE", primary_owner_last_name="EXAMPLE CONDO LLC"),
    # vacant land in a commercial area (330) and gas well (733): out of scope
    row(roll_year="2025", county_name="Erie", municipality_name="Amherst", swis_code="140200", property_class="330",
        property_class_description="Vacant Land Located in Commercial Areas", print_key_code="101.27-6-11",
        primary_owner_last_name="EXAMPLE LAND LLC"),
    row(roll_year="2025", county_name="Erie", municipality_name="Amherst", swis_code="140200", property_class="733",
        property_class_description="Gas (for production)", print_key_code="101.27-6-1.1", primary_owner_last_name="EXAMPLE GAS CO"),
    # a hotel with no street and no owner name: kept, no situs, no owner
    row(roll_year="2025", county_name="Erie", municipality_name="Amherst", swis_code="140200", property_class="414",
        property_class_description="Hotel", print_key_code="101.27-6-1.2", primary_owner_last_name=""),
    # a row with no print key cannot be keyed; an unknown county is skipped
    row(roll_year="2025", county_name="Erie", municipality_name="Amherst", swis_code="140200", property_class="411",
        print_key_code="", primary_owner_last_name="NO KEY LLC"),
    row(roll_year="2025", county_name="Atlantis", municipality_name="Nowhere", swis_code="990000", property_class="411",
        print_key_code="1-1-1", primary_owner_last_name="NOWHERE LLC"),
]


def roll_csv(tmp: Path, name: str = "7vem-aaz7.csv", header: str = HEADER) -> Path:
    p = tmp / name
    p.write_text("\n".join([header, *ROWS, ""]), encoding="utf-8")
    return p


class OrptsRolls(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = roll_csv(self.tmp)

    def test_category(self):
        self.assertEqual(ny_orpts.category("411"), "B", "Apartments")
        self.assertEqual(ny_orpts.category("413"), "B", "Co-operative")
        for code in ("400", "414", "415", "416", "421", "438", "449", "464", "482", "485", "499"):
            self.assertEqual(ny_orpts.category(code), "F1", code)
        for code in ("700", "710", "712", "714", "715", "720", "721"):
            self.assertEqual(ny_orpts.category(code), "F2", code)
        for code in ("410", "412", "210", "230", "280", "281", "311", "330", "340", "533", "612", "733", "740", "744",
                     "822", "910", "", "41", "4111", "abc"):
            self.assertIsNone(ny_orpts.category(code), code)
        self.assertIsNone(ny_orpts.category(None))
        self.assertEqual(ny_orpts.category("411.0"), "B", "a numeric export writes 411.0")

    def test_apn_keeps_punctuation_differences(self):
        self.assertEqual(ny_orpts.apn("472003", "10.-1-22"), "47200310x2ex2d1x2d22")
        self.assertNotEqual(ny_orpts.apn("140200", "101.27-6-11"), ny_orpts.apn("140200", "101.27-6-1.1"),
                            "11 and 1.1 are different parcels")
        self.assertNotEqual(ny_orpts.apn("1", "a-b"), ny_orpts.apn("1", "axb"), "a literal x is escaped")
        self.assertEqual(ny_orpts.apn("261400", "047.30-1-24"), "261400047x2e30x2d1x2d24")
        self.assertEqual(ny_orpts.apn("280500", "31-F.-79.306-209/1"), "28050031x2dfx2ex2d79x2e306x2d209x2f1")
        self.assertIsNone(ny_orpts.apn("261400", ""))
        self.assertIsNone(ny_orpts.apn("", "1-1-1"))

    def test_county_fips(self):
        self.assertEqual([ny_orpts.county_fips(c) for c in ("Suffolk", "NASSAU", "Westchester", "Erie", "Monroe")],
                         ["103", "059", "119", "029", "055"])
        self.assertEqual(ny_orpts.county_fips("St. Lawrence"), "089")
        self.assertEqual(ny_orpts.county_fips("St Lawrence"), "089")
        self.assertIsNone(ny_orpts.county_fips("Kings"), "New York City is in ny_nyc")
        self.assertIsNone(ny_orpts.county_fips(""))

    def test_mapping(self):
        recs = {r.account: r for r in ny_orpts.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["140200-101.27-6-1.2", "261400-047.30-1-24", "261400-047.301-24", "261800-12.-1-3",
                                        "262000-101-1-2", "473200-500.-1-1"],
                         "commercial and industrial kept; residential-type, vacant, wells and unkeyed rows dropped")
        apt = recs["261400-047.30-1-24"]
        self.assertEqual((apt.county_fips, apt.state_category, apt.local_use_code, apt.tax_year), ("055", "B", "411", 2025))
        self.assertEqual(apt.apn, "261400047x2e30x2d1x2d24")
        self.assertEqual(apt.situs_address, "425 BEACH AVE, ROCHESTER NY")
        self.assertEqual(apt.owner_name, "EXAMPLE APARTMENTS LLC")
        self.assertEqual(apt.owner_mailing_address, "69 LOWDEN POINT RD, ROCHESTER, NY 14612")
        self.assertEqual(apt.market_value, 4000000)
        self.assertIsNone(apt.appraised_value, "assessment_total is a fractional assessed value and is not stored")
        self.assertEqual((apt.land_area_sf, apt.improvement_area_sf, apt.year_built), (None, None, None), "the roll has none")
        self.assertEqual(apt.locator, "7vem-aaz7.csv SWIS 261400 print key 047.30-1-24")
        self.assertFalse(apt.owner_confidential)
        row_house = recs["261400-047.301-24"]
        self.assertNotEqual(row_house.apn, apt.apn)
        self.assertIsNone(row_house.market_value, "0 means no figure")
        self.assertEqual(row_house.owner_mailing_address, "PO BOX 123, ROCHESTER, NY 14604")
        person = recs["262000-101-1-2"]
        self.assertEqual((person.state_category, person.local_use_code), ("F1", "449"))
        self.assertEqual(person.owner_name, "Pat Q Example Jr", "first, middle, last and suffix are joined")
        mfg = recs["261800-12.-1-3"]
        self.assertEqual((mfg.state_category, mfg.county_fips), ("F2", "055"))
        suffolk = recs["473200-500.-1-1"]
        self.assertEqual((suffolk.county_fips, suffolk.owner_name), ("103", "EXAMPLE, PAT & CHRIS"))
        hotel = recs["140200-101.27-6-1.2"]
        self.assertEqual(hotel.state_category, "F1")
        self.assertIsNone(hotel.situs_address, "no street, no situs")
        self.assertIsNone(hotel.owner_name)
        self.assertIsNone(hotel.owner_mailing_address)

    def test_all_categories_and_display_headers(self):
        every = list(ny_orpts.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 10, "unkeyed and unknown-county rows are still skipped")
        self.assertEqual(sorted(r.local_use_code for r in every if r.state_category is None), ["330", "410", "412", "733"])
        self.assertEqual([r.apn for r in ny_orpts.read_roll(self.csv, categories=["F2"])], [ny_orpts.apn("261800", "12.-1-3")])
        display = ",".join(h.replace("_", " ").title().replace("Swis", "SWIS").replace("Po Box", "PO Box") for h in COLUMNS)
        recs = list(ny_orpts.read_roll(roll_csv(self.tmp, "export.csv", display)))
        self.assertEqual(len(recs), 6, "the portal export's display names map to the same columns")
        self.assertEqual(recs[0].owner_name, "EXAMPLE APARTMENTS LLC")

    def test_tax_year_override(self):
        self.assertEqual({r.tax_year for r in ny_orpts.read_roll(self.csv, tax_year=2024)}, {2024})

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ny_orpts.build(self.csv, db, as_of="2026-04-24", tax_year=2025)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 2, "the person (Monroe style) and the Suffolk 'LAST, FIRST' name; the blank owner is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ny-orpts-rolls'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("36", None))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'ny_swis_printkey' AND external_id = '261400-047.30-1-24'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-36055:261400047x2e30x2d1x2d24")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE APARTMENTS LLC", owner[0])
            person = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
                ("fl:parcel:us-36055:" + ny_orpts.apn("262000", "101-1-2"),)).fetchone()
            self.assertIsNone(person, "a natural person's name is never stored")
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM crosswalk WHERE system = 'ny_swis_printkey'").fetchone()[0], 6,
                             "11 and 1.1 style print keys would have merged; these six stay six")
        finally:
            reg.close()

    def test_county_files_do_not_retire_each_other(self):
        db = self.tmp / "registry.db"
        monroe = self.tmp / "monroe.csv"
        monroe.write_text("\n".join([HEADER, ROWS[0], ""]), encoding="utf-8")
        suffolk = self.tmp / "suffolk.csv"
        suffolk.write_text("\n".join([HEADER, ROWS[4], ""]), encoding="utf-8")
        ny_orpts.build(monroe, db, as_of="2026-04-24")
        stats = ny_orpts.build(suffolk, db, as_of="2026-04-25")
        self.assertEqual(stats.retired, 0, "a county file is not the whole roll")
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.status("fl:parcel:us-36055:" + ny_orpts.apn("261400", "047.30-1-24")), "current")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
