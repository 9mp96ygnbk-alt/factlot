"""Cook County Assessor adapter tests on a SYNTHETIC fixture that copies the real CSV layouts.

Every PIN, name, and value here is invented to exercise the mapping; none is real Cook County data.
The headers are those of the SODA ``/resource/<id>.csv`` exports archived on 2026-11-02.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import il_cook

UNIVERSE_HEADER = '"pin","pin10","year","class","triad_name","township_code","township_name","nbhd_code","zip_code"'
UNIVERSE_ROWS = [
    # commercial, one-story building; incentive industrial; multifamily 7+; residential (out of scope);
    # industrial 5B; class-8 office (commercial half of the incentive class); PIN with a lost leading zero;
    # class 9 incentive multifamily; exempt
    '"17031000010000","1703100001","2026","517","City","74","North Chicago","74022","60610"',
    '"17031000020000","1703100002","2026","663A","City","74","North Chicago","74022","60610"',
    '"17031000030000","1703100003","2026","391","City","74","North Chicago","74022","60610"',
    '"17031000040000","1703100004","2026","209","City","74","North Chicago","74022","60610"',
    '"17031000050000","1703100005","2026","593","City","74","North Chicago","74022","60610"',
    '"17031000060000","1703100006","2026","891","City","74","North Chicago","74022","60610"',
    '"4023010270000","0402301027","2026","500","North","25","Northfield","25320","60062"',
    '"17031000080000","1703100008","2026","913","City","74","North Chicago","74022","60610"',
    '"17031000090000","1703100009","2026","EX","City","74","North Chicago","74022","60610"',
]
VALUES_HEADER = '"pin","year","class","township_code","mailed_tot","certified_tot","board_tot"'
VALUES_ROWS = [
    # certified wins over mailed; board absent for the year
    '"17031000010000","2026","517","74","446001.0","450292.0",""',
    # mailed only
    '"17031000020000","2026","663A","74","20000.0","",""',
    # no value published yet: all stages blank
    '"17031000030000","2026","391","74","","",""',
    '"17031000050000","2026","593","74","0.0","",""',
    '"04023010270000","2026","500","25","5000.0","",""',
]
ADDRESSES_HEADER = ('"pin","pin10","year","prop_address_full","prop_address_city_name","prop_address_state","prop_address_zipcode_1",'
                    '"mail_address_name","mail_address_full","mail_address_city_name","mail_address_state","mail_address_zipcode_1",'
                    '"owner_address_name","owner_address_full","owner_address_city_name","owner_address_state","owner_address_zipcode_1","row_id"')
ADDRESSES_ROWS = [
    '"17031000010000","1703100001","2026","100 N MAIN ST","CHICAGO","IL","60610","EXAMPLE TOWER LLC","100 N MAIN ST STE 1","CHICAGO","IL","60610","EXAMPLE TOWER LLC","100 N MAIN ST STE 1","CHICAGO","IL","60610","170310000100002026"',
    # taxpayer differs from the owner; owner name truncated as iasWorld does
    '"17031000020000","1703100002","2026","200 W ELM ST","CHICAGO","IL","60610","CHICAGO TITLE LAND TRU","PO BOX 9","CHICAGO","IL","60601","EXAMPLE INDUSTRIAL PART","1 PARK AVE","NEW YORK","NY","10001","170310000200002026"',
    # natural person
    '"17031000030000","1703100003","2026","900 RIVER RD","CHICAGO","IL","60610","J EXAMPLE","900 RIVER RD","CHICAGO","IL","60610","J EXAMPLE","900 RIVER RD","CHICAGO","IL","60610","170310000300002026"',
    # placeholder owner; no situs
    '"17031000050000","1703100005","2026","","","","","TAXPAYER OF","PO BOX 1","CHICAGO","IL","60601","UNKNOWN","","","","","170310000500002026"',
    '"17031000060000","1703100006","2026","5 OAK LN","EVANSTON","IL","60201","EXAMPLE OFFICE INC","5 OAK LN","EVANSTON","IL","60201","EXAMPLE OFFICE INC","5 OAK LN","EVANSTON","IL","60201","170310000600002026"',
    '"4023010270000","0402301027","2026","7 SHIELD ST","NORTHBROOK","IL","60062","","","","","","","","","","","040230102700002026"',
]
COMMERCIAL_HEADER = '"keypin","pins","year","township","class_es","address","property_type_use","bldgsf","gross_building_area","landsf","yearbuilt"'
COMMERCIAL_ROWS = [
    # an older and a newer workbook row for the same PIN: the newer wins
    '"17-03-100-001-0000","17-03-100-001-0000","2021","North Chicago","5-17","100 N MAIN CHICAGO","Retail","2400.0","","6000.0","1950.0"',
    '"17-03-100-001-0000","17-03-100-001-0000","2024","North Chicago","5-17","100 N MAIN CHICAGO","Retail","2500.0","","6000.0","1950.0"',
    # a property spanning two PINs: the figures describe the whole, so neither PIN takes them
    '"17-03-100-002-0000","17-03-100-002-0000, 17-03-100-005-0000","2024","North Chicago","6-63, 5-93","200 W ELM CHICAGO","Industrial","90000.0","","120000.0","1965.0"',
    # bldgsf blank, gross_building_area used; zeros are not figures
    '"17-03-100-006-0000","17-03-100-006-0000","2024","North Chicago","8-91","5 OAK EVANSTON","Office","","30000.0","0.0","0.0"',
]


def write_members(tmp: Path) -> Path:
    """Lay the four CSVs out as the collector does: collected/<id>/<sha16>/<name>."""
    base = tmp / "il-cook-assessor"
    for folder, name, header, rows in (("1111111111111111", "pabr-t5kh.csv", UNIVERSE_HEADER, UNIVERSE_ROWS),
                                       ("2222222222222222", "uzyt-m557.csv", VALUES_HEADER, VALUES_ROWS),
                                       ("3333333333333333", "3723-97qp.csv", ADDRESSES_HEADER, ADDRESSES_ROWS),
                                       ("4444444444444444", "csik-bsws.csv", COMMERCIAL_HEADER, COMMERCIAL_ROWS)):
        (base / folder).mkdir(parents=True)
        (base / folder / name).write_text("\n".join([header, *rows, ""]), encoding="utf-8")
    (base / "manifest.jsonl").write_text("{}\n")
    return base


class Cook(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.dir = write_members(self.tmp)

    def test_class_mapping(self):
        self.assertEqual(il_cook.state_category("517"), "F1")
        self.assertEqual(il_cook.state_category("500"), "F1", "commercial land")
        self.assertEqual(il_cook.state_category("599"), "F1", "commercial condominium")
        self.assertEqual(il_cook.state_category("593"), "F2", "class 5B industrial building")
        self.assertEqual(il_cook.state_category("550"), "F2", "industrial land")
        self.assertEqual(il_cook.state_category("663A"), "F2", "6B industrial incentive, with its letter suffix")
        self.assertEqual(il_cook.state_category("638"), "F2", "6C industrial brownfield")
        self.assertEqual(il_cook.state_category("791"), "F1", "7A commercial incentive office")
        self.assertEqual(il_cook.state_category("774"), "F1", "7B")
        self.assertEqual(il_cook.state_category("893B"), "F2", "class 8 industrial building")
        self.assertEqual(il_cook.state_category("891"), "F1", "class 8 office building")
        self.assertEqual(il_cook.state_category("899"), "F1", "class 8 commercial/industrial condominium: commercial by default")
        self.assertEqual(il_cook.state_category("313"), "B")
        self.assertEqual(il_cook.state_category("399"), "B", "rental condominium")
        self.assertEqual(il_cook.state_category("913"), "B", "class 9 incentive multifamily")
        self.assertEqual(il_cook.state_category("OA5"), "F1", "omitted assessment on a class 5 parcel")
        for out in ("211", "299", "100", "190", "400", "EX", "RR", "OA2", "", None):
            self.assertIsNone(il_cook.state_category(out), out)

    def test_pin14(self):
        self.assertEqual(il_cook.pin14("17-03-100-001-0000"), "17031000010000")
        self.assertEqual(il_cook.pin14("4023010270000"), "04023010270000", "a lost leading zero is restored")
        self.assertEqual(il_cook.pin14(" 17031000010000 "), "17031000010000")
        self.assertIsNone(il_cook.pin14(""))
        self.assertIsNone(il_cook.pin14("170310000100001"), "15 digits is not a PIN")

    def test_members_found_by_header(self):
        found = il_cook.members(self.dir)
        self.assertEqual(sorted(found), ["addresses", "commercial", "universe", "values"])
        self.assertEqual(found["universe"].name, "pabr-t5kh.csv")
        with self.assertRaises(FileNotFoundError):
            il_cook.members(self.dir / "2222222222222222")
        narrow = self.tmp / "narrow.csv"
        narrow.write_text('"pin","class","township_code"\n"17031000010000","517","74"\n', encoding="utf-8")
        self.assertEqual(il_cook.members(narrow)["universe"], narrow, "a narrower select of the universe is still the universe")
        self.assertEqual([r.local_use_code for r in il_cook.read_roll(narrow)], ["517"])

    def test_mapping(self):
        recs = {r.apn: r for r in il_cook.read_roll(self.dir)}
        self.assertEqual(sorted(recs), ["04023010270000", "17031000010000", "17031000020000", "17031000030000",
                                        "17031000050000", "17031000060000", "17031000080000"],
                         "classes 5, 6, 3, 8, 9 kept; 209 and EX dropped; leading zero restored")
        tower = recs["17031000010000"]
        self.assertEqual((tower.county_fips, tower.account, tower.tax_year), ("031", "17031000010000", 2026))
        self.assertEqual((tower.state_category, tower.local_use_code), ("F1", "517"))
        self.assertEqual(tower.situs_address, "100 N MAIN ST, CHICAGO IL 60610")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC")
        self.assertEqual(tower.owner_mailing_address, "100 N MAIN ST STE 1, CHICAGO, IL 60610")
        self.assertEqual(tower.appraised_value, 450292.0, "certified wins over mailed when published")
        self.assertIsNone(tower.market_value, "Cook County publishes assessed values, not market values")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (6000.0, 2500.0, 1950),
                         "the 2024 workbook row wins over 2021")
        self.assertEqual(tower.locator, "pabr-t5kh.csv pin 17031000010000")
        industrial = recs["17031000020000"]
        self.assertEqual((industrial.state_category, industrial.local_use_code), ("F2", "663A"))
        self.assertEqual(industrial.owner_name, "EXAMPLE INDUSTRIAL PART", "the owner of record, not the taxpayer")
        self.assertEqual(industrial.owner_mailing_address, "1 PARK AVE, NEW YORK, NY 10001")
        self.assertEqual(industrial.appraised_value, 20000.0, "mailed is the only stage published")
        self.assertEqual((industrial.land_area_sf, industrial.improvement_area_sf, industrial.year_built), (None, None, None),
                         "a multi-PIN workbook row describes the whole property, so no PIN takes its figures")
        apartments = recs["17031000030000"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "391"))
        self.assertEqual(apartments.owner_name, "J EXAMPLE", "persons are passed through; the registry drops them")
        self.assertIsNone(apartments.appraised_value, "no stage published yet")
        unknown = recs["17031000050000"]
        self.assertIsNone(unknown.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(unknown.owner_mailing_address)
        self.assertIsNone(unknown.situs_address, "blank situs")
        self.assertEqual(unknown.appraised_value, 0.0, "a published 0 assessed value is the publisher's figure")
        office = recs["17031000060000"]
        self.assertEqual((office.state_category, office.local_use_code), ("F1", "891"))
        self.assertEqual(office.situs_address, "5 OAK LN, EVANSTON IL 60201")
        self.assertEqual((office.land_area_sf, office.improvement_area_sf, office.year_built), (None, 30000.0, None),
                         "gross_building_area when bldgsf is blank; zeros are not figures")
        northfield = recs["04023010270000"]
        self.assertEqual(northfield.situs_address, "7 SHIELD ST, NORTHBROOK IL 60062")
        self.assertIsNone(northfield.owner_name, "blank owner")
        self.assertEqual(northfield.appraised_value, 5000.0)
        self.assertEqual(recs["17031000080000"].state_category, "B")
        self.assertEqual(recs["17031000080000"].situs_address, None, "no address row")
        self.assertFalse(any(r.owner_confidential for r in recs.values()), "the datasets carry no confidentiality flag")

    def test_all_categories_and_explicit_files(self):
        every = list(il_cook.read_roll(self.dir, categories=None))
        self.assertEqual(len(every), 9, "every PIN in the universe file")
        self.assertEqual([r.apn for r in il_cook.read_roll(self.dir, categories=["F2"])],
                         ["17031000020000", "17031000050000"])
        found = il_cook.members(self.dir)
        self.assertEqual([r.apn for r in il_cook.read_roll(list(found.values()))],
                         [r.apn for r in il_cook.read_roll(self.dir)])
        only_universe = [r for r in il_cook.read_roll(found["universe"])]
        self.assertEqual(len(only_universe), 7)
        self.assertTrue(all(r.situs_address is None and r.appraised_value is None for r in only_universe),
                        "without the other members the universe alone gives PIN and class")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = il_cook.build(self.dir, db, as_of="2026-11-01")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (7, 7, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 2,
                         "the natural person and the truncated name with no entity token; placeholders and blanks are not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'il-cook-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("17", "031"))
            snaps = reg.db.execute("SELECT filename FROM snapshots ORDER BY filename").fetchall()
            self.assertEqual([s[0] for s in snaps], ["3723-97qp.csv", "csik-bsws.csv", "pabr-t5kh.csv", "uzyt-m557.csv"],
                             "every member is a snapshot")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'cook_pin' AND external_id = '17031000010000'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-17031:17031000010000")
            facts = {r[0]: r[1] for r in reg.db.execute(
                "SELECT predicate, value_json FROM current_facts WHERE subject = ?", (urn,)).fetchall()}
            self.assertEqual(facts["parcel.state_property_category"], '"F1"')
            self.assertEqual(facts["parcel.local_use_code"], '"517"')
            self.assertEqual(facts["parcel.appraised_value"], "450292.0")
            self.assertNotIn("parcel.market_value", facts)
            universe_doc = reg.db.execute("SELECT document_id FROM snapshots WHERE filename = 'pabr-t5kh.csv'").fetchone()[0]
            cited = reg.db.execute("SELECT DISTINCT document_id FROM facts").fetchall()
            self.assertEqual([c[0] for c in cited], [universe_doc], "facts cite the Parcel Universe snapshot")
            owners = reg.db.execute("SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 2, "tower and office; not the person, the placeholder, or the truncated name without an entity token")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
