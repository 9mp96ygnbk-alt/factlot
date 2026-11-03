"""Connecticut business registry adapter tests on a SYNTHETIC fixture that copies the real column subset.

Every account number, name, and address here is invented; none is a real Connecticut registration. The
header is the column subset the collector requests from dataset n7gp-d28j (2026-11-03).
"""

import csv
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ct_sos_entities

HEADER = (
    "name,business_type,status,sub_status,accountnumber,billingstreet,billing_unit,billingcity,billingcountry,"
    "billingpostalcode,billingstate,citizenship,state_or_territory_formation,formation_place,date_registration,"
    "dissolution_date,mailing_address"
).split(",")

ROWS = [
    # active domestic LLC with a business address
    dict(name="Example Holdings LLC", business_type="LLC", status="Active", accountnumber="1234567",
         billingstreet="100 Main St", billing_unit="Ste 2", billingcity="Hartford", billingcountry="United States",
         billingpostalcode="06103", billingstate="CT", citizenship="Domestic", state_or_territory_formation="Connecticut",
         formation_place="Connecticut", date_registration="2020-01-02T00:00:00.000",
         mailing_address="100 Main St ,Ste 2 ,Hartford ,CT ,United States ,06103"),
    # foreign corporation formed in Delaware (postal code), authorised in Connecticut
    dict(name="Example Foods, Inc.", business_type="Stock", status="Active", sub_status="Annual report due",
         accountnumber="0987654", billingstreet="1 Park Ave", billingcity="New York", billingcountry="UNITED STATES",
         billingpostalcode="10001", billingstate="NY", citizenship="Foreign", state_or_territory_formation="DE"),
    # old forfeited company: the Division wrote placeholders in the business address; the mailing address is used
    dict(name="Example Machine Co", business_type="Stock", status="Forfeited", accountnumber="0000092",
         billingstreet="No information provided", billingcity="", billingstate="", billingpostalcode="",
         citizenship="Domestic", state_or_territory_formation="", formation_place="CT",
         mailing_address="12 MILL RD P O BOX 5 , ,MILLDALE ,CT , ,06467"),
    # dissolved, formed in a state written as a full name
    dict(name="Example Dissolved Partners LP", business_type="Limited Partnership", status="Dissolved",
         accountnumber="2222222", citizenship="Foreign", state_or_territory_formation="NEW YORK",
         billingstreet="NONE", mailing_address=", , , , ,", dissolution_date="2019-06-30T00:00:00.000"),
    # an 'Unauthorized' foreign company has the placeholder account number: not a registry number
    dict(name="Example Unauthorized Corp", business_type="Unauthorized", status="Active", accountnumber="0000000",
         citizenship="Foreign", state_or_territory_formation="MI"),
    # domestic with no state of formation recorded: formed in Connecticut; a foreign country is not a state
    dict(name="Example Domestic Trust", business_type="Statutory Trust", status="Merged", sub_status="",
         accountnumber="3333333", citizenship="Domestic", state_or_territory_formation=""),
    dict(name="Example Overseas Ltd", business_type="Stock", status="Some New Status", accountnumber="4444444",
         citizenship="Foreign", state_or_territory_formation="UNITED KINGDOM", formation_place="England"),
]

DISPLAY_HEADER = [h for h in (
    "Name,Business_Type,Status,Sub_status,AccountNumber,Business_Street,Business_Unit,Business_City,Business_Country,"
    "Business_ZIP,Business_State,Citizenship,State_or_Territory_Formation,Formation_Place,Date_Registration,"
    "Dissolution_date,Mailing_Address").split(",")]


def write_csv(path: Path, header: list[str], rows: list[dict[str, str]], keys: list[str]) -> Path:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(header)
        for r in rows:
            w.writerow([r.get(k, "") for k in keys])
    return path


class CtEntities(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_csv(self.tmp / "n7gp-d28j.csv", HEADER, ROWS, HEADER)

    def test_mapping(self):
        recs = list(ct_sos_entities.read_entities(self.csv))
        self.assertEqual(len(recs), 7)
        llc, foods, machine, partners, unauthorized, trust, overseas = recs
        self.assertEqual((llc.legal_name, llc.registry_jurisdiction, llc.registry_number),
                         ("Example Holdings LLC", "us-ct", "1234567"))
        self.assertEqual((llc.state_of_formation, llc.status), ("CT", "active"))
        self.assertEqual(llc.mailing_address, "100 Main St, Ste 2, Hartford, CT 06103")
        self.assertEqual(llc.locator, "n7gp-d28j.csv accountnumber 1234567")
        self.assertIsNone(llc.taxpayer_number)
        self.assertEqual((foods.state_of_formation, foods.status, foods.registry_number), ("DE", "active", "0987654"),
                         "a leading zero is part of the id")
        self.assertEqual(foods.mailing_address, "1 Park Ave, New York, NY 10001", "the country 'UNITED STATES' is left out")
        self.assertEqual((machine.status, machine.state_of_formation), ("forfeited", "CT"), "formation_place when the state column is blank")
        self.assertEqual(machine.mailing_address, "12 MILL RD P O BOX 5, MILLDALE, CT, 06467",
                         "placeholders in the business address fall back to the mailing address")
        self.assertEqual((partners.state_of_formation, partners.status), ("NY", "dissolved"), "a state written as a name")
        self.assertIsNone(partners.mailing_address, "'NONE' and empty segments are not an address")
        self.assertIsNone(unauthorized.registry_number, "0000000 is a placeholder")
        self.assertIsNone(unauthorized.locator)
        self.assertEqual((trust.state_of_formation, trust.status), ("CT", "merged"), "domestic with no recorded state")
        self.assertEqual((overseas.state_of_formation, overseas.status), (None, "some_new_status"),
                         "a foreign country is not a US state; an unknown status is slugged, not dropped")

    def test_helpers(self):
        self.assertEqual(ct_sos_entities.state_of_formation(" de "), "DE")
        self.assertEqual(ct_sos_entities.state_of_formation("", "New Jersey"), "NJ")
        self.assertIsNone(ct_sos_entities.state_of_formation("England", "Canada"))
        self.assertIsNone(ct_sos_entities.state_of_formation(None))
        self.assertEqual(ct_sos_entities.status("Active - Pending Domestication"), "active_pending_domestication")
        self.assertIsNone(ct_sos_entities.status(""))
        self.assertIsNone(ct_sos_entities.registry_number("0000000"))
        self.assertIsNone(ct_sos_entities.registry_number(""))
        self.assertEqual(ct_sos_entities.registry_number("1234567.0"), "1234567")

    def test_portal_export_display_names(self):
        keys = HEADER
        p = write_csv(self.tmp / "export.csv", DISPLAY_HEADER, ROWS, keys)
        recs = list(ct_sos_entities.read_entities(p))
        self.assertEqual(recs[0].mailing_address, "100 Main St, Ste 2, Hartford, CT 06103", "Business_Street and friends")
        self.assertEqual((recs[0].registry_number, recs[0].status), ("1234567", "active"))

    def test_build(self):
        db = self.tmp / "registry.db"
        stats, links = ct_sos_entities.build(self.csv, db, as_of="2026-11-03", link=False)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (7, 6, 1), "the unauthorized placeholder has no id")
        self.assertEqual(links, {})
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ct-sos-entities'").fetchone()
            self.assertEqual(src["state_fips"], "09")
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            n = reg.db.execute("SELECT COUNT(DISTINCT subject) FROM current_facts WHERE subject LIKE 'fl:entity:us-ct:%'").fetchone()[0]
            self.assertEqual(n, 6)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
