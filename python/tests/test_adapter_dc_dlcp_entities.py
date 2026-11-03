"""District of Columbia DLCP entity adapter tests on a SYNTHETIC fixture that copies the real layout.

The header is the Open Data DC "Corporate Registration" CSV export's; every file number, name,
and address is invented. None of it is real District data.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import dc_dlcp_entities, dc_otr

# A one-parcel ITSPE fixture (the columns the adapter reads) so owner linking can be exercised.
ITSPE = (
    "SSL,USECODE,LANDAREA,PREMISEADD,UNITNUMBER,OWNERNAME,ADDRESS1,ADDRESS2,CITYSTZIP,NEWTOTAL,DELCODE,ASSESSMENT,CY1YEAR\n"
    "0100    0010,052,20000,1200 EXAMPLE ST NW,,EXAMPLE TOWER LLC,100 MAIN ST,STE 400,NEW YORK NY 10001,11000000,N,10000000,2026\n"
)

HEADER = (
    "FILE_NUMBER,ENTITY_STATUS,LOCALE,MODELTYPE,BUSINESS_NAME,BUSNIESS_ADDRESS_LINE1,BUSNIESS_ADDRESS_LINE2,"
    "BUSNIESS_ADDRESS_LINE3,BUSNIESS_ADDRESS_LINE4,BUSINESS_CITY,BUSINESS_STATE,ZIPCODE,BUSINESS_COUNTRY,SUFFIX,"
    "RA_NAME,RA_ADDRESS1,RA_ADDRESS2,RA_ADDRESS3,RA_ADDRESS4,RA_CITY,RA_STATE,RA_ZIPCODE,EFFECTIVE_DATE,"
    "FOREIGN_DATEOF_ORGANIZATION,NEXT_REPORTYEAR_DUE,DCS_LAST_MOD_DTTM,DATE_LAST_REPORT_FILED,NEXT_REPORTYEAR,"
    "LATESTFILED_REPORTDATE,LATESTREPORT_YEARFILED,OBJECTID,GLOBALID"
)
ROWS = [
    # domestic LLC whose name already carries the suffix
    'L00000001,Active,Domestic,Limited Liability Company,EXAMPLE TOWER LLC,100 MAIN ST,STE 400,,,NEW YORK,NY,10001,'
    'USA,LLC,EXAMPLE AGENTS INC,1 AGENT ST NW,,,,WASHINGTON,DC,20001,2015/03/02 00:00:00+00,,2027,'
    '2026/10/01 00:00:00+00,2025/04/01 00:00:00+00,2027,2025/04/01 00:00:00+00,2025,1,{1}',
    # foreign corporation: the suffix is appended to the name; the country is not the US
    'C00000002,Revoked for Failure to File,Foreign,Corporation,EXAMPLE HOLDINGS,"22 EXAMPLE QUAY",,,,LONDON,,'
    'SW1A 1AA,UNITED KINGDOM,INC.,,,,,,,,,2010/01/15 00:00:00+00,2009/12/01 00:00:00+00,2026,'
    '2026/10/01 00:00:00+00,,2026,,2024,2,{2}',
    # a row with no file number: not a registered entity
    ',Active,Domestic,Trade Name,EXAMPLE TRADE NAME,,,,,,,,,,,,,,,,,,,,,,,,,,3,{3}',
]


class Entities(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = self.tmp / "corporate_registration.csv"
        self.csv.write_text("﻿" + "\n".join([HEADER, *ROWS, ""]), encoding="utf-8")

    def test_mapping(self):
        recs = list(dc_dlcp_entities.read_entities(self.csv))
        self.assertEqual(len(recs), 3)
        domestic, foreign, trade = recs
        self.assertEqual((domestic.legal_name, domestic.registry_number, domestic.registry_jurisdiction),
                         ("EXAMPLE TOWER LLC", "L00000001", "us-dc"))
        self.assertEqual((domestic.state_of_formation, domestic.status), ("DC", "active"))
        self.assertIsNone(domestic.taxpayer_number, "the file carries no taxpayer number")
        self.assertEqual(domestic.mailing_address, "100 MAIN ST, STE 400, NEW YORK, NY 10001")
        self.assertEqual(domestic.locator, "Corporate Registration FILE_NUMBER L00000001")
        self.assertEqual(foreign.legal_name, "EXAMPLE HOLDINGS INC.", "the registrar keeps the suffix in its own column")
        self.assertEqual((foreign.registry_number, foreign.state_of_formation, foreign.status),
                         ("C00000002", None, "revoked_for_failure_to_file"),
                         "a foreign entity's state of formation is not in the file")
        self.assertEqual(foreign.mailing_address, "22 EXAMPLE QUAY, LONDON, SW1A 1AA, UNITED KINGDOM")
        self.assertIsNone(trade.registry_number)
        self.assertIsNone(trade.locator)
        self.assertIsNone(trade.mailing_address)

    def test_build_links_owners_to_entities(self):
        db = self.tmp / "registry.db"
        itspe = self.tmp / "itspe.csv"
        itspe.write_text(ITSPE, encoding="utf-8")
        dc_otr.build(itspe, db, as_of="2026-11-02")
        stats, links = dc_dlcp_entities.build(self.csv, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (3, 2, 1))
        self.assertEqual(links.get("linked"), 1, links)
        reg = Registry.open_readonly(db)
        try:
            owned = reg.db.execute(
                "SELECT to_urn FROM relationships WHERE type = 'owns' AND from_urn = 'fl:entity:us-dc:l00000001'").fetchall()
            self.assertEqual([r[0] for r in owned], ["fl:parcel:us-11001:01000010"])
            source = reg.db.execute("SELECT attribution FROM sources WHERE source_id = 'dc-dlcp-entities'").fetchone()[0]
            self.assertIn("Open Data DC", source)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
