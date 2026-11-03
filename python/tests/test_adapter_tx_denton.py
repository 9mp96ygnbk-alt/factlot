"""Denton CAD adapter tests on a SYNTHETIC fixture that copies the ``Parcels_FC`` query-page layout.

Every property id, name and value here is invented to exercise the mapping; none is real Denton
County data. The fixture has the shape of the ArcGIS ``query`` response the collector archives
(``features[].attributes`` with the layer's field names, null for missing values).
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_denton


def parcel(**fields):
    a = {"pid": 0, "pYear": 2027, "name": None, "propType": "R", "stateCodes": "", "situs_street_address": None,
         "situsCity": None, "situsState": "TX", "situsZip": None, "confidential": 0, "addrDeliveryLine": None,
         "addrUnitDesignator": None, "addrFreeForm3": None, "landTotalSqft": 0.0, "land_sqft": 0.0,
         "legalAcreage": 0.0, "imprvActualYearBuilt": None, "imprvMainArea": None, "imprvTotalArea": None,
         "ownerMarketValue": None, "ownerAppraisedValue": None, "dba": None}
    a.update(fields)
    return {"attributes": a}


FEATURES = [
    # Office (F1): the full set of attributes.
    parcel(pid=100001, name="EXAMPLE OFFICE PARTNERS LLC", stateCodes="F1", situs_street_address="100 EXAMPLE PKWY",
           situsCity="FLOWER MOUND", situsZip="75028-1111", addrDeliveryLine="1 SAMPLE PLZ", addrUnitDesignator="STE 5",
           addrFreeForm3="DALLAS, TX 75201-0001", landTotalSqft=45555.0, land_sqft=45555.048, legalAcreage=1.0458,
           imprvActualYearBuilt=2006, imprvMainArea=8630.0, imprvTotalArea=26230.0, ownerMarketValue=1496572,
           ownerAppraisedValue=1400000),
    # Apartments (B1) with no square-foot figure, only acreage.
    parcel(pid=100002, name="EXAMPLE APARTMENTS LP", stateCodes="B1", situs_street_address="200 SAMPLE DR",
           situsCity="DENTON", situsZip="76201", legalAcreage=2.0, imprvMainArea=120000.0, imprvActualYearBuilt=2005,
           ownerMarketValue=9000000, ownerAppraisedValue=9000000),
    # A duplex (B2) owned by a natural person.
    parcel(pid=100003, name="J EXAMPLE", stateCodes="B2", situs_street_address="300 OAK ST", situsCity="DENTON",
           situsZip="76205", landTotalSqft=10890.0, imprvMainArea=2400.0, ownerMarketValue=400000, ownerAppraisedValue=400000),
    # Industrial (F2) and commercial in one account: F2 wins.
    parcel(pid=100004, name="EXAMPLE LOGISTICS INC", stateCodes="F1,F2", situs_street_address="400 FREIGHT RD",
           situsCity="LEWISVILLE", situsZip="75067", landTotalSqft=87120.0, ownerMarketValue=2500000, ownerAppraisedValue=2500000),
    # A house with a small commercial improvement (A1,F1): category F1, the code list is kept verbatim.
    parcel(pid=100005, name="EXAMPLE FAMILY TRUST", stateCodes="A1,F1", situs_street_address="500 ELM LN",
           situsCity="DENTON", situsZip="76209", landTotalSqft=7000.0, ownerMarketValue=300000, ownerAppraisedValue=300000),
    # A house (A1): out of scope.
    parcel(pid=100006, name="A PERSON", stateCodes="A1", situs_street_address="600 ELM LN", situsCity="DENTON",
           ownerMarketValue=250000),
    # Vacant land (C1): out of scope.
    parcel(pid=100007, name="EXAMPLE LAND LLC", stateCodes="C1", legalAcreage=5.0, ownerMarketValue=100000),
    # A code the table does not cover (F3): kept verbatim, out of scope until the district's table is read.
    parcel(pid=100008, name="EXAMPLE CONDO LLC", stateCodes="F3", situs_street_address="700 CENTRAL EXPY",
           situsCity="DENTON", ownerMarketValue=100000),
    # A withheld owner (Tax Code 25.025): the row's name and situs are not kept.
    parcel(pid=100009, name="WITHHELD NAME LLC", stateCodes="B1", confidential=1, situs_street_address="800 HIDDEN WAY",
           situsCity="DENTON", addrDeliveryLine="PO BOX 1", addrFreeForm3="DENTON, TX 76201", landTotalSqft=1000.0,
           ownerMarketValue=500000, ownerAppraisedValue=500000),
    # No owner name and no figures; a repeated pid within the page collapses to the first.
    parcel(pid=100010, name=None, stateCodes="F1", situs_street_address="900 BLANK ST", situsCity="DENTON",
           situsZip="76201"),
    parcel(pid=100010, name="LATER DUPLICATE LLC", stateCodes="F1"),
    # Not real property.
    parcel(pid=100011, name="EXAMPLE BPP INC", propType="P", stateCodes="F1"),
]


def page(tmp: Path, name: str, features) -> Path:
    p = tmp / name
    p.write_text(json.dumps({"displayFieldName": "name", "fieldAliases": {}, "fields": [], "features": features,
                             "exceededTransferLimit": False}), "utf-8")
    return p


class Denton(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.page = page(self.tmp, "query", FEATURES)

    def test_mapping(self):
        recs = {r.apn: r for r in tx_denton.read_roll(self.page)}
        self.assertEqual(sorted(recs), ["100001", "100002", "100003", "100004", "100005", "100009", "100010"],
                         "F1, B1, B2, F2, A1+F1, withheld B1 and the blank F1 kept; A1, C1, F3 and personal property dropped")
        office = recs["100001"]
        self.assertEqual(office.county_fips, "121")
        self.assertEqual((office.account, office.state_category, office.local_use_code, office.tax_year),
                         ("100001", "F1", "F1", 2027))
        self.assertEqual(office.situs_address, "100 EXAMPLE PKWY, FLOWER MOUND TX 75028-1111")
        self.assertEqual(office.owner_name, "EXAMPLE OFFICE PARTNERS LLC")
        self.assertEqual(office.owner_mailing_address, "1 SAMPLE PLZ, STE 5, DALLAS, TX 75201-0001")
        self.assertEqual((office.land_area_sf, office.improvement_area_sf, office.year_built), (45555.0, 8630.0, 2006),
                         "main area, not the total that counts porches and pavement")
        self.assertEqual((office.market_value, office.appraised_value), (1496572, 1400000))
        self.assertEqual(office.locator, "Parcels_FC pid 100001")
        apartments = recs["100002"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "B1"))
        self.assertEqual(apartments.land_area_sf, 87120, "acres convert when there is no square-foot figure")
        self.assertIsNone(apartments.owner_mailing_address, "no mailing address attributes")
        duplex = recs["100003"]
        self.assertEqual((duplex.state_category, duplex.owner_name), ("B", "J EXAMPLE"),
                         "persons are dropped later, by the registry")
        mixed = recs["100004"]
        self.assertEqual((mixed.state_category, mixed.local_use_code), ("F2", "F1,F2"), "industrial wins over commercial")
        self.assertEqual(recs["100005"].state_category, "F1")
        self.assertEqual(recs["100005"].local_use_code, "A1,F1")

    def test_withheld_and_blank_owners(self):
        recs = {r.apn: r for r in tx_denton.read_roll(self.page)}
        hidden = recs["100009"]
        self.assertTrue(hidden.owner_confidential)
        self.assertIsNone(hidden.owner_name)
        self.assertIsNone(hidden.owner_mailing_address)
        self.assertIsNone(hidden.situs_address, "a withheld record keeps no address either")
        blank = recs["100010"]
        self.assertIsNone(blank.owner_name, "the first row of a repeated pid wins")
        self.assertFalse(blank.owner_confidential)
        self.assertEqual((blank.land_area_sf, blank.improvement_area_sf, blank.year_built, blank.market_value),
                         (None, None, None, None), "zeros and nulls are not figures")

    def test_state_category(self):
        self.assertEqual(tx_denton.state_category("F1"), "F1")
        self.assertEqual(tx_denton.state_category("B2"), "B")
        self.assertEqual(tx_denton.state_category("A1,B2"), "B")
        self.assertEqual(tx_denton.state_category("D1,D2,E1"), "D1", "no commercial code: the first code")
        self.assertEqual(tx_denton.state_category("F1,F2,B1"), "F2")
        self.assertEqual(tx_denton.state_category("F3"), "F3", "an unmapped code passes through")
        self.assertIsNone(tx_denton.state_category(None))
        self.assertIsNone(tx_denton.state_category(""))

    def test_all_categories_and_directory(self):
        self.assertEqual(len(list(tx_denton.read_roll(self.page, categories=None))), 10,
                         "every real property; the personal property row is dropped")
        self.assertEqual([r.apn for r in tx_denton.read_roll(self.page, categories=["C1"])], ["100007"])
        sub = self.tmp / "archive" / "abc"
        sub.mkdir(parents=True)
        page(sub, "query", FEATURES[:2])
        (sub / "manifest.jsonl").write_text('{"status": "archived"}\n', "utf-8")  # not a page: ignored
        self.assertEqual([r.apn for r in tx_denton.read_roll(self.tmp / "archive")], ["100001", "100002"],
                         "a directory reads every page in it")

    def test_build(self):
        second = page(self.tmp, "query2", [parcel(pid=200001, name="EXAMPLE SHOPS LLC", stateCodes="F1",
                                                  situs_street_address="1 MAIN ST", situsCity="DENTON"),
                                           parcel(pid=100001, name="EXAMPLE OFFICE PARTNERS LLC", stateCodes="F1",
                                                  situs_street_address="102 EXAMPLE PKWY", situsCity="FLOWER MOUND")])
        db = self.tmp / "registry.db"
        stats = tx_denton.build([self.page, second], db, as_of="2026-11-03")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (8, 8, 0, 0),
                         "an account repeated on a later page (a second parcel polygon) is read once")
        self.assertEqual(stats.owners_person_or_withheld, 3, "the person, the family trust and the withheld owner; the blank owner is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-denton-cad'").fetchone()
            self.assertEqual(src["county_fips"], "121")
            self.assertEqual(reg.db.execute("SELECT count(*) FROM snapshots").fetchone()[0], 2, "one snapshot per page")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'dcad_prop_id' AND external_id = '100001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48121:100001")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"F1"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 4, "four companies; not the person, the trust, the withheld owner or the blank")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
