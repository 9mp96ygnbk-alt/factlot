"""Wisconsin statewide parcel adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel id, name, address and value here is invented to exercise the mapping; none is real
Wisconsin data. The fixture copies the shape of a V12 ArcGIS ``f=json`` page (fields as in the
published schema documentation).
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import wi_statewide


def feature(**f):
    base = {"STATEID": "0790000001000", "PARCELID": "0000001000", "TAXPARCELID": None, "TAXROLLYEAR": "2025",
            "OWNERNME1": None, "OWNERNME2": None, "PSTLADRESS": None, "SITEADRESS": None,
            "PLACENAME": "CITY OF EXAMPLEVILLE", "ZIPCODE": "53200", "CNTASSDVALUE": 0, "LNDVALUE": 0, "IMPVALUE": 0,
            "ESTFMKVALUE": 0, "PROPCLASS": "2", "AUXCLASS": None, "ASSDACRES": None, "DEEDACRES": None,
            "GISACRES": None, "CONAME": "MILWAUKEE", "LOADDATE": "2/19/2026", "PARCELFIPS": "079",
            "PARCELSRC": "MILWAUKEE"}
    base.update(f)
    return {"attributes": base}


PAGE_1 = {"objectIdFieldName": "OBJECTID", "exceededTransferLimit": True, "features": [
    # A shop owned by a company, with all the usual figures.
    feature(STATEID="0790000001000", PARCELID="0000001000", OWNERNME1="EXAMPLE SHOPS LLC", OWNERNME2="C/O AGENT",
            PSTLADRESS="PO BOX 1 EXAMPLEVILLE, WI 53201", SITEADRESS="100 N MAIN ST", CNTASSDVALUE=1125200,
            ESTFMKVALUE=1125900, DEEDACRES=14.33, GISACRES=14.59, PROPCLASS="2"),
    # A factory (manufacturing, class 3); deeded acres missing, so GIS acres are used.
    feature(STATEID="0790000002000", PARCELID="0000002000", OWNERNME1="SAMPLE FOUNDRY INC", SITEADRESS="200 S LAKE RD",
            PLACENAME="VILLAGE OF SAMPLEVILLE", CNTASSDVALUE=500000, ESTFMKVALUE=510000, GISACRES=2.5, PROPCLASS="3"),
    # Residential and commercial on one parcel: commercial is among its classes.
    feature(STATEID="0790000003000", PARCELID="0000003000", OWNERNME1="MIXED USE PROPERTIES LLC", PROPCLASS="1,2",
            SITEADRESS="300 E OAK ST", ESTFMKVALUE=250000),
    # Owner redacted by the county: withheld, never a name.
    feature(STATEID="0790000004000", PARCELID="0000004000", OWNERNME1="NOT AVAILABLE", OWNERNME2="NOT AVAILABLE",
            PSTLADRESS="12 ELM ST", SITEADRESS="400 W PINE AVE", PROPCLASS="2", ESTFMKVALUE=90000),
    # A natural person: passed through; the registry drops the name.
    feature(STATEID="0790000005000", PARCELID="0000005000", OWNERNME1="EXAMPLE, ALEX", PROPCLASS="2",
            SITEADRESS="", ESTFMKVALUE=0, CNTASSDVALUE=0, DEEDACRES=0),
    # Out of scope: residential, agricultural, exempt (null class).
    feature(STATEID="0790000006000", PARCELID="0000006000", OWNERNME1="HOME OWNER", PROPCLASS="1"),
    feature(STATEID="0790000007000", PARCELID="0000007000", OWNERNME1="FARM CO", PROPCLASS="4"),
    feature(STATEID="0790000008000", PARCELID="0000008000", OWNERNME1="EXAMPLE COUNTY", PROPCLASS=None,
            AUXCLASS="X4"),
]}
PAGE_2 = {"objectIdFieldName": "OBJECTID", "features": [
    # A repeat of the first parcel (pages overlap when the layer changes between requests): kept once.
    feature(STATEID="0790000001000", PARCELID="0000001000", OWNERNME1="EXAMPLE SHOPS LLC", PROPCLASS="2",
            ESTFMKVALUE=1),
    # Another county, from the 5-digit form of the FIPS.
    feature(STATEID="0250000009000", PARCELID="0000009000", OWNERNME1="DANE EXAMPLE LLC", PROPCLASS="2",
            PARCELFIPS="55025", CONAME="DANE", SITEADRESS="9 MENDOTA CT", PLACENAME="CITY OF MADISON"),
]}


class WiStatewideTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for i, page in enumerate((PAGE_1, PAGE_2), start=1):
            d = self.tmp / "wi-statewide-parcels" / f"{i:016x}"
            d.mkdir(parents=True)
            (d / "query").write_text(json.dumps(page), encoding="utf-8")
        (self.tmp / "wi-statewide-parcels" / "manifest.jsonl").write_text("{}\n")

    def recs(self):
        return {r.apn: r for r in wi_statewide.read_roll(self.tmp)}

    def test_state_category(self):
        sc = wi_statewide.state_category
        self.assertEqual(sc("2"), "F1")
        self.assertEqual(sc("3"), "F2")
        self.assertEqual(sc("1,2"), "F1")
        self.assertEqual(sc("2,3"), "F1", "commercial wins when both are listed")
        self.assertEqual(sc("1,3"), "F2")
        self.assertEqual(sc("1"), "A")
        self.assertEqual(sc("4"), "D1")
        self.assertEqual(sc("5M"), "D1")
        self.assertIsNone(sc(None), "tax-exempt parcels have no class")
        self.assertIsNone(sc(""))
        self.assertIsNone(sc("9"), "an unlisted code")

    def test_pages_found_in_collector_layout(self):
        names = [p.parent.name for p in wi_statewide.pages(self.tmp)]
        self.assertEqual(names, ["0000000000000001", "0000000000000002"], "the manifest is not a page")

    def test_records(self):
        recs = self.recs()
        self.assertEqual(sorted(recs), ["0000001000", "0000002000", "0000003000", "0000004000", "0000005000",
                                        "0000009000"])
        shop = recs["0000001000"]
        self.assertEqual((shop.county_fips, shop.state_category, shop.local_use_code), ("079", "F1", "2"))
        self.assertEqual(shop.situs_address, "100 N MAIN ST, EXAMPLEVILLE WI 53200", "the CITY OF prefix is dropped")
        self.assertEqual(shop.owner_name, "EXAMPLE SHOPS LLC", "owner line 1 only")
        self.assertEqual(shop.owner_mailing_address, "PO BOX 1 EXAMPLEVILLE, WI 53201")
        self.assertEqual((shop.market_value, shop.appraised_value, shop.tax_year), (1125900, 1125200, 2025))
        self.assertEqual(shop.land_area_sf, round(14.33 * 43560, 2), "deeded acres win")
        self.assertEqual(shop.locator, "0000000000000001/query STATEID 0790000001000")
        self.assertEqual(shop.market_value, 1125900, "the first row for a repeated parcel wins")
        factory = recs["0000002000"]
        self.assertEqual(factory.state_category, "F2")
        self.assertEqual(factory.land_area_sf, round(2.5 * 43560, 2), "GIS acres when no deeded or assessed acres")
        self.assertEqual(factory.situs_address, "200 S LAKE RD, SAMPLEVILLE WI 53200")
        self.assertEqual(recs["0000003000"].state_category, "F1")
        redacted = recs["0000004000"]
        self.assertIsNone(redacted.owner_name)
        self.assertTrue(redacted.owner_confidential, "NOT AVAILABLE is a redaction, not a name")
        self.assertIsNone(redacted.owner_mailing_address, "no mailing address without an owner")
        person = recs["0000005000"]
        self.assertEqual(person.owner_name, "EXAMPLE, ALEX", "the adapter passes persons through")
        self.assertIsNone(person.situs_address, "a blank street is no situs")
        self.assertEqual((person.market_value, person.appraised_value, person.land_area_sf), (None, None, None),
                         "zeros are not figures")
        other = recs["0000009000"]
        self.assertEqual(other.county_fips, "025", "a 5-digit PARCELFIPS loses the state prefix")
        self.assertEqual(other.situs_address, "9 MENDOTA CT, MADISON WI 53200")

    def test_all_categories(self):
        everything = list(wi_statewide.read_roll(self.tmp, categories=None))
        self.assertEqual(len(everything), 9)
        self.assertEqual([r.apn for r in wi_statewide.read_roll(self.tmp, categories=["F2"])], ["0000002000"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = wi_statewide.build(self.tmp, db, as_of="2026-06-30")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (6, 6, 0))
        self.assertEqual(stats.owners_person_or_withheld, 2, "the person and the redacted owner are counted, not stored")
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'wi_parcelid' AND external_id = '0000001000'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-55079:0000001000")
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["DANE EXAMPLE LLC", "EXAMPLE SHOPS LLC", "MIXED USE PROPERTIES LLC",
                                      "SAMPLE FOUNDRY INC"])
            snaps = reg.db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
            self.assertEqual(snaps, 2, "one snapshot per page")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
