"""Sacramento County parcel-layer adapter tests on a SYNTHETIC fixture that copies the real layout.

Every APN, address and value here is invented to exercise the mapping; none is real data. The header is the
column list of the county's Hub CSV export of the hosted layer ``Parcels`` (field aliases).
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ca_sacramento

HEADER = [
    "OBJECTID", "APN", "Lot Size", "Neighborhood Code", "Jurisdiction", "Street Number", "Street Name", "City",
    "Zip", "Tax Rate Area", "Subdivision", "Lot", "Landuse", "Landuse General", "Landuse Specific",
    "Landuse Detail", "Landuse Use", "Landuse Secondary Use", "Level", "Type", "Shape__Area", "Shape__Length",
]


def row(**f: str) -> dict[str, str]:
    r = {c: "" for c in HEADER}
    r.update({"City": "SACRAMENTO", "Zip": "95899", "Jurisdiction": "SACRAMENTO", "Landuse Use": "Most probable use",
              "Level": "1", "Type": "LND", **f})
    return r


ROWS = [
    row(APN="99900100010000", **{"Lot Size": "20000", "Street Number": "100", "Street Name": "EXAMPLE ST",
                                  "Landuse": "AAA00A", "Landuse General": "Retail / Commercial",
                                  "Landuse Specific": "Small Retail", "Landuse Detail": "Multi-Tenant"}),
    row(APN="99900200020000", **{"Lot Size": "40000", "Street Number": "200", "Street Name": "SAMPLE AVE  BLDG C",
                                  "Zip": "95898.0", "Landuse": "BBB00B", "Landuse General": "Office",
                                  "Landuse Specific": "Office (General)", "Landuse Detail": "Two Story"}),
    row(APN="99900300030000", **{"Lot Size": "30000", "Street Number": "300", "Street Name": "MAPLE CT",
                                  "Landuse": "CCC00C", "Landuse General": "Residential",
                                  "Landuse Specific": "Low Rise Apartment"}),
    row(APN="99900400040000", **{"Lot Size": "30000", "Street Number": "400", "Street Name": "MAPLE CT",
                                  "Landuse General": "Residential", "Landuse Specific": "Single Family",
                                  "Landuse Detail": "Subdivision"}),  # single family: out
    row(APN="99900500050000", **{"Lot Size": "30000", "Street Number": "500", "Street Name": "FOURPLEX WAY",
                                  "Landuse General": "Residential", "Landuse Specific": "Four Family",
                                  "Landuse Detail": "Fourplex"}),  # under five units: out
    row(APN="99900600060000", **{"Lot Size": "50000", "Street Name": "INDUSTRIAL BLVD",
                                  "Landuse General": "Industrial", "Landuse Specific": "Warehouse",
                                  "Landuse Detail": "Distribution"}),  # no street number
    row(APN="99900700070000", **{"Lot Size": "0", "Street Number": "700", "Street Name": "CONDO ST",
                                  "Landuse General": "Office", "Landuse Specific": "Office (General)",
                                  "Landuse Detail": "Condominium", "Type": "SUB"}),  # zero lot size
    row(APN="99900800080000", **{"Lot Size": "900", "Street Number": "800", "Street Name": "COMMON DR",
                                  "Landuse General": "Office", "Landuse Specific": "Common Area",
                                  "Landuse Detail": "Condominium", "Type": "COM"}),  # common area: out
    row(APN="99900900090000", **{"Lot Size": "9000", "Street Number": "900", "Street Name": "PIT RD",
                                  "Landuse General": "Industrial", "Landuse Specific": "Mining",
                                  "Landuse Detail": "Gravel Pit"}),  # mining: out
    row(APN="99901000100000", **{"Lot Size": "8000", "Street Number": "1000", "Street Name": "VACANT ST",
                                  "Landuse General": "Vacant", "Landuse Detail": "Site (Under 2ac)"}),  # vacant: out
    row(APN="99900100010000", **{"Lot Size": "1", "Street Name": "REPEAT ST", "Landuse General": "Office",
                                  "Landuse Specific": "Office (General)"}),  # repeat APN: collapses
    row(APN="99901100110000", **{"Lot Size": "70000", "Street Number": "1100", "Street Name": "HEALTH WAY",
                                  "Landuse General": "Care / Health", "Landuse Specific": "Skilled Nursing Facility"}),
    row(APN="99901200120000", **{"Lot Size": "7000", "Street Number": "1200", "Street Name": "DAYCARE WAY",
                                  "Landuse General": "Care / Health", "Landuse Specific": "Day Nursery"}),  # out
    row(APN="99901300130000", **{"Lot Size": "9000", "Street Number": "1300", "Street Name": "MOTEL ST",
                                  "Landuse General": "Residential", "Landuse Specific": "Motel"}),
    row(APN="99901400140000", **{"Lot Size": "9000", "Street Number": "1400", "Street Name": "LANES AVE",
                                  "Landuse General": "Recreational", "Landuse Specific": "Bowling"}),
    row(APN="", **{"Street Name": "NO APN ST", "Landuse General": "Office", "Landuse Specific": "Office (General)"}),
]


def write_csv(tmp: Path) -> Path:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADER, lineterminator="\r\n")
    w.writeheader()
    w.writerows(ROWS)
    p = tmp / "parcels.csv"
    p.write_text("﻿" + buf.getvalue(), encoding="utf-8")  # the Hub export starts with a BOM
    return p


class Sacramento(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_csv(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in ca_sacramento.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["99900100010000", "99900200020000", "99900300030000", "99900600060000",
                                        "99900700070000", "99901100110000", "99901300130000", "99901400140000"])
        shop = recs["99900100010000"]
        self.assertEqual(shop.county_fips, "067")
        self.assertEqual((shop.state_category, shop.account, shop.local_use_code), ("F1", "999-0010-001-0000", "AAA00A"))
        self.assertEqual(shop.situs_address, "100 EXAMPLE ST, SACRAMENTO, CA 95899")
        self.assertEqual(shop.land_area_sf, 20000)
        self.assertIsNone(shop.appraised_value, "the layer has no values")
        office = recs["99900200020000"]
        self.assertEqual(office.situs_address, "200 SAMPLE AVE BLDG C, SACRAMENTO, CA 95898", "float ZIP, spaces squeezed")
        self.assertEqual(recs["99900300030000"].state_category, "B")
        warehouse = recs["99900600060000"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.situs_address, "INDUSTRIAL BLVD, SACRAMENTO, CA 95899", "no street number")
        self.assertIsNone(warehouse.local_use_code, "blank code is not stored")
        self.assertIsNone(recs["99900700070000"].land_area_sf, "zero lot size is not a figure")
        self.assertEqual(recs["99901100110000"].state_category, "F1")
        self.assertEqual(recs["99901300130000"].state_category, "F1")
        self.assertEqual(recs["99901400140000"].state_category, "F1")
        self.assertEqual(recs["99900100010000"].situs_address, "100 EXAMPLE ST, SACRAMENTO, CA 95899",
                         "the first row of a repeated APN wins")
        # No owner names are published.
        self.assertTrue(all(r.owner_name is None and r.owner_mailing_address is None and not r.owner_confidential
                            for r in recs.values()))

    def test_raw_field_names(self):
        """The raw ArcGIS field names (as in a FeatureServer export) map the same way as the aliases."""
        text = self.csv.read_text(encoding="utf-8-sig")
        for alias, raw in [("Street Number", "STREET_NBR"), ("Street Name", "STREET_NAM"), ("Landuse General", "LU_GENERAL"),
                           ("Landuse Specific", "LU_SPECIF"), ("Landuse Detail", "LU_DETAIL"), ("Lot Size", "LOT_SIZE")]:
            text = text.replace(alias, raw, 1)
        alt = self.tmp / "raw.csv"
        alt.write_text(text, encoding="utf-8")
        self.assertEqual(len(list(ca_sacramento.read_roll(alt))), 8)

    def test_category(self):
        c = ca_sacramento.category
        self.assertEqual(c("Residential", "High Rise Apartment"), "B")
        self.assertIsNone(c("Residential", "Triplex"))
        self.assertIsNone(c("Residential", "Mobile Home", "MH/Private Land/Perm Foundation/MH & Lan"))
        self.assertEqual(c("Residential", "Mobile Home Park"), "F1")
        self.assertEqual(c("Retail / Commercial", "Restaurant", "Dining"), "F1")
        self.assertIsNone(c("Retail / Commercial", "Nursery"))
        self.assertIsNone(c("Retail / Commercial", "Advertising"))
        self.assertEqual(c("Office", "Medical / Dental", "One Story"), "F1")
        self.assertIsNone(c("Office", "Common Area", "Condominium"))
        self.assertEqual(c("Industrial", "Mini-storage"), "F2")
        self.assertIsNone(c("Industrial", "Mining", "Gravel Pit"))
        self.assertEqual(c("Recreational", "Private Club", "Health Spa"), "F1")
        self.assertIsNone(c("Recreational", "Private Club", "Fraternal"))
        self.assertIsNone(c("Church / Welfare", "Church", "Exempt"))
        self.assertIsNone(c("Vacant", "", "Site (Under 2ac)"))
        self.assertIsNone(c(None))
        self.assertEqual(c(" office ", " Office (General) "), "F1")

    def test_account(self):
        self.assertEqual(ca_sacramento.account("00100110010000"), "001-0011-001-0000")
        self.assertEqual(ca_sacramento.account("123"), "123")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ca_sacramento.build(self.csv, db, as_of="2026-11-01")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (8, 8, 0, 0))
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ca-sacramento-assessor'").fetchone()
            self.assertEqual(src["county_fips"], "067")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'sacramento_apn' AND external_id = '999-0030-003-0000'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-06067:99900300030000")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"B"')
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
