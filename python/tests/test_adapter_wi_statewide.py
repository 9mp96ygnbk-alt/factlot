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
        self.assertEqual(other.county_fips, "025", "Dane, from CONAME")
        self.assertEqual(shop.account, "079:0000001000", "the account names the county: PARCELIDs repeat across counties")
        self.assertEqual(other.situs_address, "9 MENDOTA CT, MADISON WI 53200")

    def test_county_is_where_the_parcel_is(self):
        # CONAME is the county the parcel is part of; PARCELFIPS the county that contributed it (V12: Appleton's
        # parcels in Calumet and Winnebago carry Outagamie's 087, Menasha's in Calumet carry Winnebago's 139).
        cf = wi_statewide.county_fips
        self.assertEqual(cf({"CONAME": "CALUMET", "PARCELFIPS": "087", "STATEID": "087311234500"}), "015")
        self.assertEqual(cf({"CONAME": "CALUMET", "PARCELFIPS": "139", "STATEID": "1397012345"}), "015")
        self.assertEqual(cf({"CONAME": "WINNEBAGO", "PARCELFIPS": "087", "STATEID": "087319876500"}), "139")
        self.assertEqual(cf({"CONAME": "ST CROIX", "PARCELFIPS": "109"}), "109")
        self.assertEqual(cf({"CONAME": "St. Croix"}), "109")
        self.assertEqual(cf({"CONAME": "FOND DU LAC", "PARCELFIPS": "039"}), "039")
        self.assertEqual(cf({"CONAME": "MENOMINEE", "PARCELFIPS": "078"}), "078", "the one even county FIPS")
        self.assertEqual(cf({"CONAME": "", "PARCELFIPS": "55025"}), "025", "no name: a 5-digit PARCELFIPS loses 55")
        self.assertEqual(cf({"CONAME": None, "PARCELFIPS": None, "STATEID": "0790000001000"}), "079")
        self.assertIsNone(cf({"CONAME": "MENOMONIE", "PARCELFIPS": "999"}), "V12's one stray row names no county")
        self.assertEqual(len(wi_statewide.COUNTY_FIPS), 72)

    def test_apn_keeps_punctuation_differences(self):
        apn = wi_statewide.apn_for
        self.assertEqual(apn("0000001000"), "0000001000", "Milwaukee tax keys are unchanged")
        self.assertEqual(apn("11-109"), "11x2dx109")
        self.assertNotEqual(apn("11-109"), apn("1-1109"), "two Brown County parcels")
        self.assertNotEqual(apn("21-161-4"), apn("21-16-1-4"))
        self.assertNotEqual(apn("010-0640.01"), apn("0100-640.01"))
        self.assertEqual(apn("VH-747-E-28"), "vhx2dx747x2dxex2dx28")
        self.assertNotEqual(apn("A-X"), apn("ax"), "a literal x is escaped")
        self.assertEqual(apn(" 12 34 "), "12x20x34", "outer spaces are trimmed, inner ones kept")

    def test_brown_county_ids_stay_apart(self):
        page = {"features": [
            feature(STATEID="00911-109", PARCELID="11-109", CONAME="BROWN", PARCELFIPS="009", PROPCLASS="2",
                    OWNERNME1="EXAMPLE ONE LLC", SITEADRESS="1 MAIN ST", PLACENAME="CITY OF GREEN BAY"),
            feature(STATEID="0091-1109", PARCELID="1-1109", CONAME="BROWN", PARCELFIPS="009", PROPCLASS="3",
                    OWNERNME1="EXAMPLE TWO INC", SITEADRESS="2 MAIN ST", PLACENAME="CITY OF GREEN BAY"),
            # Jackson County writes the redaction twice; a placeholder owner is no owner.
            feature(STATEID="053000123", PARCELID="000123", CONAME="JACKSON", PARCELFIPS="053", PROPCLASS="2",
                    OWNERNME1="NOT AVAILABLE NOT AVAILABLE", PSTLADRESS="1 ELM ST"),
            feature(STATEID="073000456", PARCELID="000456", CONAME="MARATHON", PARCELFIPS="073", PROPCLASS="2",
                    OWNERNME1="UNKNOWN", PSTLADRESS="1 ELM ST"),
            # Kenosha redacts every owner.
            feature(STATEID="05912-3-456", PARCELID="12-3-456", CONAME="KENOSHA", PARCELFIPS="059", PROPCLASS="2",
                    OWNERNME1="NOT AVAILABLE"),
        ]}
        f = self.tmp / "brown.json"
        f.write_text(json.dumps(page), encoding="utf-8")
        recs = list(wi_statewide.read_roll(f))
        self.assertEqual([(r.county_fips, r.apn, r.account, r.state_category) for r in recs],
                         [("009", "11x2dx109", "009:11-109", "F1"), ("009", "1x2dx1109", "009:1-1109", "F2"),
                          ("053", "000123", "053:000123", "F1"), ("073", "000456", "073:000456", "F1"),
                          ("059", "12x2dx3x2dx456", "059:12-3-456", "F1")])
        self.assertEqual([(r.owner_name, r.owner_confidential) for r in recs[2:]],
                         [(None, True), (None, False), (None, True)])
        db = self.tmp / "brown.db"
        stats = wi_statewide.build(f, db, as_of="2026-06-30")
        self.assertEqual((stats.kept, stats.skipped_invalid), (5, 0))
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.resolve_external("wi_parcelid", "009:11-109"), "fl:parcel:us-55009:11x2dx109")
            self.assertEqual(reg.resolve_external("wi_parcelid", "009:1-1109"), "fl:parcel:us-55009:1x2dx1109")
        finally:
            reg.close()

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
                "SELECT urn FROM crosswalk WHERE system = 'wi_parcelid' AND external_id = '079:0000001000'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-55079:0000001000", "a Milwaukee tax key is its own APN")
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
