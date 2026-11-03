"""Synthetic fixture for the New York DOS "Active Corporations" adapter: the real export header
(portal display names) and a few invented rows. No row describes a real entity."""

import tempfile
import unittest
from pathlib import Path

from factlot.registry.adapters import ny_dos_entities
from factlot.registry.store import Registry

HEADER = (
    '"DOS ID","Current Entity Name","Initial DOS Filing Date","County","Jurisdiction","Entity Type",'
    '"DOS Process Name","DOS Process Address 1","DOS Process Address 2","DOS Process City","DOS Process State",'
    '"DOS Process Zip","CEO Name","CEO Address 1","CEO Address 2","CEO City","CEO State","CEO Zip",'
    '"Registered Agent Name","Registered Agent Address 1","Registered Agent Address 2","Registered Agent City",'
    '"Registered Agent State","Registered Agent Zip","Location Name","Location Address 1","Location Address 2",'
    '"Location City","Location State","Location Zip"'
)
ROWS = [
    # domestic LLC with a process address
    '"9000001","EXAMPLE TOWER LLC","2015-03-02T00:00:00.000","New York","New York","DOMESTIC LIMITED LIABILITY COMPANY",'
    '"EXAMPLE TOWER LLC","100 MAIN ST","STE 1","NEW YORK","NY","10001",,,,,,,,,,,,,,,,,,',
    # foreign (Delaware) corporation, no process address, registered agent address instead; CEO is a person
    '"9000002","OUT OF STATE HOLDINGS INC","2010-01-01T00:00:00.000","Kings","Delaware","FOREIGN BUSINESS CORPORATION",'
    ',,,,,,"J EXAMPLE","1 PARK AVE",,"NEW YORK","NY","10016","EXAMPLE AGENTS INC","2 BROADWAY",,"NEW YORK","NY","10004",,,,,,',
    # formed abroad: no USPS code
    '"9000003","EXAMPLE OVERSEAS LTD","2001-06-06T00:00:00.000","New York","ENGLAND","FOREIGN BUSINESS CORPORATION",'
    '"EXAMPLE OVERSEAS LTD","5 WALL ST",,"NEW YORK","NY","10005",,,,,,,,,,,,,,,,,,',
    # no addresses at all (common for old not-for-profits)
    '"9000004","EXAMPLE SOCIAL CLUB, INC.","1958-04-28T00:00:00.000","Queens","New York","DOMESTIC NOT-FOR-PROFIT CORPORATION",'
    ',,,,,,,,,,,,,,,,,,,,,,,',
    # blank DOS ID: not a registered entity record
    '"","NO NUMBER CORP","1990-01-01T00:00:00.000","Bronx","New York","DOMESTIC BUSINESS CORPORATION",'
    ',,,,,,,,,,,,,,,,,,,,,,,',
]


class NyDosEntities(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = self.tmp / "export.csv"
        self.csv.write_text("\n".join([HEADER, *ROWS, ""]))

    def test_mapping(self):
        recs = list(ny_dos_entities.read_entities(self.csv))
        self.assertEqual(len(recs), 5)
        llc, foreign, overseas, club, blank = recs
        self.assertEqual((llc.legal_name, llc.registry_number, llc.registry_jurisdiction), ("EXAMPLE TOWER LLC", "9000001", "us-ny"))
        self.assertEqual((llc.state_of_formation, llc.status, llc.taxpayer_number), ("NY", "active", None))
        self.assertEqual(llc.mailing_address, "100 MAIN ST, STE 1, NEW YORK, NY 10001")
        self.assertEqual(llc.locator, "export.csv DOS ID 9000001")
        self.assertEqual(foreign.state_of_formation, "DE")
        self.assertEqual(foreign.mailing_address, "2 BROADWAY, NEW YORK, NY 10004",
                         "with no process address the registered agent's address is used, never the CEO's")
        self.assertIsNone(overseas.state_of_formation, "a non-US jurisdiction has no USPS code")
        self.assertEqual(overseas.mailing_address, "5 WALL ST, NEW YORK, NY 10005")
        self.assertIsNone(club.mailing_address)
        self.assertEqual(club.status, "active", "the dataset holds active entities only")
        self.assertIsNone(blank.registry_number)
        self.assertIsNone(blank.locator)

    def test_soda_field_names_are_accepted(self):
        soda = self.tmp / "resource.csv"
        soda.write_text('"dos_id","current_entity_name","jurisdiction","entity_type","dos_process_address_1","dos_process_city",'
                        '"dos_process_state","dos_process_zip","chairman_name"\n'
                        '"9000005","EXAMPLE PLAZA LP","New Jersey","FOREIGN LIMITED PARTNERSHIP","9 OAK LN","ALBANY","NY","12207","P EXAMPLE"\n')
        (rec,) = ny_dos_entities.read_entities(soda)
        self.assertEqual((rec.registry_number, rec.state_of_formation, rec.mailing_address), ("9000005", "NJ", "9 OAK LN, ALBANY, NY 12207"))
        (row,) = ny_dos_entities.read_rows(soda)
        self.assertEqual(row["entity_type"], "FOREIGN LIMITED PARTNERSHIP")
        self.assertEqual(row["chairman_name"], "P EXAMPLE", "CEO columns are read under the SODA name but never stored")

    def test_state_of_formation(self):
        self.assertEqual(ny_dos_entities.state_of_formation("District of Columbia"), "DC")
        self.assertEqual(ny_dos_entities.state_of_formation("  new   york "), "NY")
        self.assertIsNone(ny_dos_entities.state_of_formation("Ontario"))
        self.assertIsNone(ny_dos_entities.state_of_formation(""))
        self.assertIsNone(ny_dos_entities.state_of_formation(None))

    def test_build(self):
        db = self.tmp / "registry.db"
        stats, links = ny_dos_entities.build(self.csv, db, as_of="2026-10-30", link=False)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (5, 4, 1))
        self.assertEqual(links, {})
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.db.execute("SELECT source_id FROM sources").fetchall()[0][0], "ny-dos-entities")
            name = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = 'fl:entity:us-ny:9000001' AND predicate = 'entity.legal_name'").fetchone()
            self.assertIn("EXAMPLE TOWER LLC", name[0])
            self.assertEqual(reg.db.execute("SELECT count(*) FROM crosswalk").fetchone()[0], 0, "no taxpayer numbers in this source")
            people = reg.db.execute("SELECT count(*) FROM current_facts WHERE value_json LIKE '%J EXAMPLE%'").fetchone()[0]
            self.assertEqual(people, 0, "CEO names are never stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
