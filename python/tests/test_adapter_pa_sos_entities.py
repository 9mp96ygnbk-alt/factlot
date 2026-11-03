"""Synthetic fixture for the Pennsylvania Department of State registered-business adapter: the real
export header (data.pa.gov dataset 3urc-uaba) and a few invented rows. No row describes a real entity."""

import tempfile
import unittest
from pathlib import Path

from factlot.registry.adapters import pa_sos_entities
from factlot.registry.store import Registry

HEADER = (
    "business_name,filing_number,address_line1,address_line2,city,state,zip,typeofbusinessregistration,"
    "shortcountyname,county_code,georeferenced_latitude__longitude"
)
ROWS = [
    # domestic LLC with a full address and a point
    'Example Tower Llc,0009000001,100 Main St,Ste 1,Philadelphia,PA,19147,Domestic Limited Liability Company,'
    'Philadelphia,51,"{""type"":""Point"",""coordinates"":[-75.15,39.94]}"',
    # foreign corporation, no second address line, no point
    "Out Of State Holdings Inc,0009000002,1 Park Ave,,New York,NY,10016-1000,Foreign Business Corporation,Philadelphia,51,",
    # public authority: not prefixed Domestic/Foreign, formed in Pennsylvania
    "Example County Redevelopment Authority,0009000003,5 Oak Ln,,Pittsburgh,PA,15222,Authority,Allegheny,02,",
    # no address at all
    "Example Social Club,0009000004,,,,,,Domestic Nonprofit Corporation,Erie,25,",
    # blank filing number: not a registered entity record
    "No Number Corp,,9 Elm St,,Erie,PA,16501,Domestic Business Corporation,Erie,25,",
]


class PaSosEntities(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = self.tmp / "export.csv"
        self.csv.write_text("\n".join([HEADER, *ROWS, ""]))

    def test_mapping(self):
        recs = list(pa_sos_entities.read_entities(self.csv))
        self.assertEqual(len(recs), 5)
        llc, foreign, authority, club, blank = recs
        self.assertEqual((llc.legal_name, llc.registry_number, llc.registry_jurisdiction),
                         ("Example Tower Llc", "0009000001", "us-pa"))
        self.assertEqual((llc.state_of_formation, llc.status, llc.taxpayer_number), ("PA", "listed", None))
        self.assertEqual(llc.mailing_address, "100 Main St, Ste 1, Philadelphia, PA 19147")
        self.assertEqual(llc.locator, "export.csv filing number 0009000001")
        self.assertEqual(llc.registry_number[:3], "000", "leading zeros of the filing number are kept")
        self.assertIsNone(foreign.state_of_formation, "a foreign entity's state of formation is not in the dataset")
        self.assertEqual(foreign.mailing_address, "1 Park Ave, New York, NY 10016-1000")
        self.assertEqual(authority.state_of_formation, "PA")
        self.assertIsNone(club.mailing_address)
        self.assertEqual(club.status, "listed")
        self.assertIsNone(blank.registry_number)
        self.assertIsNone(blank.locator)

    def test_status_is_not_a_good_standing_claim(self):
        self.assertEqual(pa_sos_entities.LISTED, "listed")
        self.assertNotIn("active", pa_sos_entities.LISTED)

    def test_state_of_formation(self):
        f = pa_sos_entities.state_of_formation
        self.assertEqual(f("Domestic Limited Partnership (LP/LLLP)"), "PA")
        self.assertEqual(f("Domestic Land Bank"), "PA")
        self.assertEqual(f("Authority"), "PA")
        self.assertIsNone(f("Foreign Limited Liability General Partnership"))
        self.assertIsNone(f("Foreign Business Trust"))
        self.assertIsNone(f(""))
        self.assertIsNone(f(None))

    def test_portal_display_names_are_accepted(self):
        alt = self.tmp / "display.csv"
        alt.write_text('"Business Name","Filing Number","Address Line1","Address Line2","City","State","Zip",'
                       '"TypeOfBusinessRegistration"\n'
                       '"Example Plaza Lp","0009000005","9 Oak Ln","","Harrisburg","PA","17101","Domestic Limited Partnership (LP/LLLP)"\n')
        (rec,) = pa_sos_entities.read_entities(alt)
        self.assertEqual((rec.registry_number, rec.state_of_formation, rec.mailing_address),
                         ("0009000005", "PA", "9 Oak Ln, Harrisburg, PA 17101"))

    def test_no_person_columns_are_read(self):
        """The parent dataset (xvd7-5r2c) repeats a business per officer with person-name columns;
        if such a file is passed in, those names must not reach the record."""
        parent = self.tmp / "parent.csv"
        parent.write_text("business_name,filing_number,typeofbusinessregistration,party_type,last_name,middle_name,first_name\n"
                          "Example Plaza Lp,0009000005,Domestic Limited Partnership (LP/LLLP),Governor,Exampleperson,,Pat\n")
        (rec,) = pa_sos_entities.read_entities(parent)
        self.assertNotIn("Exampleperson", repr(rec))
        self.assertNotIn("Pat", repr(rec))

    def test_build(self):
        db = self.tmp / "registry.db"
        stats, links = pa_sos_entities.build(self.csv, db, as_of="2026-10-31", link=False)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (5, 4, 1))
        self.assertEqual(links, {})
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.db.execute("SELECT source_id FROM sources").fetchall()[0][0], "pa-sos-entities")
            name = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = 'fl:entity:us-pa:0009000001' "
                "AND predicate = 'entity.legal_name'").fetchone()
            self.assertIn("Example Tower Llc", name[0])
            self.assertEqual(reg.db.execute("SELECT count(*) FROM crosswalk").fetchone()[0], 0,
                             "no taxpayer numbers in this source")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
