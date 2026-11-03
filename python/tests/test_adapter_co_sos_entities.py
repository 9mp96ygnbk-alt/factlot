"""Colorado business entities adapter tests on a SYNTHETIC fixture that copies the real export layout.

Every entity id, name, and address here is invented; none is a real Colorado registration. The
header is the real column list of dataset 4ykn-tg5h (2026-11-02).
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import co_denver, co_sos_entities
from test_adapter_co_denver import COMMERCIAL_HEADER, COMMERCIAL_ROWS, write_csv

ENTITIES_HEADER = (
    "entityid,entityname,principaladdress1,principaladdress2,principalcity,principalstate,principalzipcode,"
    "principalcountry,mailingaddress1,mailingaddress2,mailingcity,mailingstate,mailingzipcode,mailingcountry,"
    "entitystatus,jurisdictonofformation,entitytype,agentfirstname,agentmiddlename,agentlastname,agentsuffix,"
    "agentorganizationname,agentprincipaladdress1,agentprincipaladdress2,agentprincipalcity,agentprincipalstate,"
    "agentprincipalzipcode,agentprincipalcountry,agentmailingaddress1,agentmailingaddress2,agentmailingcity,"
    "agentmailingstate,agentmailingzipcode,agentmailingcountry,entityformdate"
).split(",")

ENTITIES_ROWS = [
    dict(entityid="20211234567", entityname="Example Hospitality LLC", principaladdress1="100 N Main St",
         principaladdress2="Ste 200", principalcity="Denver", principalstate="CO", principalzipcode="80202",
         principalcountry="US", entitystatus="Good Standing", jurisdictonofformation="CO", entitytype="DLLC",
         agentfirstname="Pat", agentlastname="Example", entityformdate="2021-03-01T00:00:00.000"),
    # foreign LLC formed in Delaware (written as a name), principal address blank so the mailing address is used
    dict(entityid="20229876543", entityname="Example Apartments Owner LLC", mailingaddress1="1 Park Ave",
         mailingcity="New York", mailingstate="NY", mailingzipcode="10001", mailingcountry="US",
         entitystatus="Delinquent", jurisdictonofformation="Delaware", entitytype="FLLC",
         entityformdate="2022-07-15T00:00:00.000"),
    # dissolved corporation with a historical name suffix, formed abroad
    dict(entityid="18751000001", entityname="Silver Example Mining Company, Dissolved January 1, 1880",
         principalcountry="GB", entitystatus="Administratively Dissolved", jurisdictonofformation="United Kingdom",
         entitytype="DPC", entityformdate="1875-12-06T00:00:00.000"),
    # a status the map does not know is slugged, not dropped
    dict(entityid="20230000001", entityname="Example Foods Inc", principaladdress1="4655 Humboldt St",
         principalcity="Denver", principalstate="CO", principalzipcode="80216", entitystatus="Some New Status",
         jurisdictonofformation="colorado", entitytype="DPC"),
    # no entity id: not a registered entity record
    dict(entityid="", entityname="Nameless Example", entitystatus="Good Standing", jurisdictonofformation="CO"),
]


class Entities(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_csv(self.tmp / "export.csv", ENTITIES_HEADER, ENTITIES_ROWS)

    def test_mapping(self):
        recs = list(co_sos_entities.read_entities(self.csv))
        self.assertEqual(len(recs), 5)
        hotel, apartments, mining, foods, nameless = recs
        self.assertEqual((hotel.legal_name, hotel.registry_jurisdiction, hotel.registry_number),
                         ("Example Hospitality LLC", "us-co", "20211234567"))
        self.assertEqual((hotel.state_of_formation, hotel.status), ("CO", "good_standing"))
        self.assertEqual(hotel.mailing_address, "100 N Main St, Ste 200, Denver, CO 80202")
        self.assertIsNone(hotel.taxpayer_number)
        self.assertEqual(hotel.locator, "export.csv entityid 20211234567")
        self.assertEqual((apartments.state_of_formation, apartments.status), ("DE", "delinquent"), "a state written as a name")
        self.assertEqual(apartments.mailing_address, "1 Park Ave, New York, NY 10001", "mailing address when the principal address is blank")
        self.assertIsNone(mining.state_of_formation, "a foreign country is not a US state")
        self.assertEqual(mining.status, "administratively_dissolved")
        self.assertEqual(mining.mailing_address, "GB", "a non-US country is kept as the address line")
        self.assertEqual((foods.state_of_formation, foods.status), ("CO", "some_new_status"))
        self.assertIsNone(nameless.registry_number)

    def test_helpers(self):
        self.assertEqual(co_sos_entities.state_of_formation(" de "), "DE")
        self.assertIsNone(co_sos_entities.state_of_formation("FC"))
        self.assertIsNone(co_sos_entities.state_of_formation("United States"))
        self.assertIsNone(co_sos_entities.state_of_formation(""))
        self.assertEqual(co_sos_entities.status("Dissolved (Term Expired)"), "dissolved_term_expired")
        self.assertIsNone(co_sos_entities.status(""))

    def test_build_links_owners_to_entities(self):
        db = self.tmp / "registry.db"
        co_denver.build(write_csv(self.tmp / "commercial.csv", COMMERCIAL_HEADER, COMMERCIAL_ROWS), db, as_of="2026-10-29")
        stats, links = co_sos_entities.build(self.csv, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (5, 4, 1))
        self.assertEqual(links.get("linked"), 3, links)  # hotel, apartments owner, foods
        reg = Registry.open_readonly(db)
        try:
            hotel = "fl:entity:us-co:20211234567"
            owned = reg.db.execute("SELECT to_urn FROM relationships WHERE type = 'owns' AND from_urn = ?", (hotel,)).fetchall()
            self.assertEqual([r[0] for r in owned], ["fl:parcel:us-08031:0003100025000"])
            facts = {f["predicate"]: f["value"] for f in reg.facts(hotel)}
            self.assertEqual(facts.get("entity.status"), "good_standing")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
