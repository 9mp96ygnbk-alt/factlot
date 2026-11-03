"""Pierce County Data Mart adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel number, address and value here is invented to exercise the mapping; none is real Pierce
County data. The tables have no header row; the field order is the one in the County's table
descriptions (cfapps/atr/datamart/metadata/*.pdf, 2026-11-03).
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import wa_pierce


def tax_row(parcel, account="REAL", ptype="LNDIM", address="", use="0000", desc="UNKNOWN", ex_prior="", ex_cur="",
            tax_year="2027", land="0", imp="0", total="0", taxable="0"):
    """A 28-field tax_account row (prior-year values are filled with decoys)."""
    return "|".join([parcel, account, ptype, address, use, desc, "2026", "471", ex_prior, "", "1", "1", "1", "1",
                     tax_year, "471", ex_cur, "", land, imp, total, taxable, "00", "19", "01", "21", "", ""])


TAX = [
    tax_row("0319011001", address="1201 EXAMPLE AVE", use="1305", desc="MULTI FAM APTS 5 UNITS OR MORE",
            land="1000000", imp="9000000", total="10000000", taxable="10000000"),
    tax_row("0319011002", address="55 SAMPLE ST E", use="5300", desc="GEN MERCHANDISE RETAIL TRADE",
            land="500000", imp="1500000", total="2000000", taxable="2000000"),
    tax_row("0319011003", address="9 FACTORY RD", use="3400", desc="FAB METAL PRODUCTS",
            land="300000", imp="2700000", total="3000000", taxable="3000000"),
    tax_row("0319011004", address="3 HOTEL WAY", use="1600", desc="HOTELS/MOTELS", total="8000000", taxable="8000000"),
    tax_row("0319011005", address="10 OFFICE CT", use="5020", desc="OFFICE CONDO", total="400000", taxable="400000"),
    # multi-family with a private tax-relief exemption: kept
    tax_row("0319011006", address="77 TAXRELIEF LN", use="1305", ex_cur="Multi-Family Housing", ex_prior="Multi-Family Housing",
            total="5000000", taxable="2500000"),
    # commercial use but owned by a non-profit or a public body: out of scope
    tax_row("0319011007", address="1 CHURCH ST", use="6199", ex_cur="Non-Profit Church Property", total="900000"),
    tax_row("0319011008", address="2 COUNTY RD", use="5300", ex_prior="County Owned Property", total="900000"),
    # excluded commercial-looking codes: cemetery, religious services, marina slip condo, detached-garage condo
    tax_row("0319011009", address="3 GRAVE RD", use="6242", desc="CEMETERIES", total="100000"),
    tax_row("0319011010", address="4 CHAPEL RD", use="6910", desc="RELIGIOUS SERVICES", total="100000"),
    tax_row("0319011011", address="5 SLIP DR", use="5050", desc="MARINA SLIP CONDOS", total="100000"),
    tax_row("0319011012", address="6 GARAGE DR", use="5030", desc="DET GARAGE CONDO", total="100000"),
    # residential, duplex, condo, vacant, government, school, parks: out of scope
    tax_row("0319011013", address="7 HOME ST", use="1101", desc="SINGLE FAMILY DWELLING", total="500000"),
    tax_row("0319011014", address="8 DUPLEX ST", use="1202", desc="DUPLEX 2 UNITS", total="600000"),
    tax_row("0319011015", address="9 CONDO ST", use="1405", desc="APT/CONDO 3 STOR OR LESS", total="300000"),
    tax_row("0319011016", address="XXX VACANT LN", use="9100", desc="VACANT LAND UNDEVELOPED", total="100000"),
    tax_row("0319011017", address="10 CITY HALL", use="6700", desc="GOVERNMENTAL SERVICES", total="900000"),
    tax_row("0319011018", address="11 SCHOOL RD", use="6810", desc="ELEM SCHOOLS 1 TO 6", total="900000"),
    tax_row("0319011019", address="12 PARK RD", use="7600", desc="PARKS", total="900000"),
    # commercial use but not real property (personal property), and a state-assessed account
    tax_row("0319011020", account="PERS", ptype="SAPP", use="5300", total="50000"),
    tax_row("0000185005", ptype="SARP", address="OP PROP", use="0000", total="6093245"),
    # commercial with an estimated address ("XXX") and zero values
    tax_row("0319011021", address="XXX UNKNOWN RD", use="6500", desc="PROFESSIONAL SERVICES"),
    # no parcel number: dropped
    tax_row("", use="5300"),
]

APPRAISAL = [
    "|".join(["0319011001", "Com Multi Unit", "", "PI1", "LEA1", "1", "", "1.0", "0.9", "43560.0", "39204.0", "100", "100", "90", "", "", ""]),
    "|".join(["0319011002", "Commercial", "SAMPLE SHOP", "PI1", "LEA2", "1", "", "0.5", "0.5", "21780.0", "21780.0", "100", "100", "90", "", "", ""]),
]
IMPROVEMENT = [
    "|".join(["0319011001", "1", "Multiple Unit", "N1", "0", "40000", "36000", "1.0000", "Average", "Good", "100", "Apartment"] + [""] * 13),
    "|".join(["0319011001", "2", "Multiple Unit", "N1", "0", "12000", "0", "1.0000", "Average", "Good", "100", "Apartment"] + [""] * 13),
    "|".join(["0319011002", "1", "Commercial", "N2", "0", "9000", "8000", "1.0000", "Good", "Good", "100", "Retail"] + [""] * 13),
]
BUILTAS = [
    "|".join(["0319011001", "1", "1", "5", "Apartment", "40000", "", "", "", "", "3.00", "9", "0", "", "", "", "40", "", "", "1985", "2005", "2005", "41", "0", "0", ""]),
    "|".join(["0319011001", "2", "1", "5", "Apartment", "12000", "", "", "", "", "2.00", "9", "0", "", "", "", "12", "", "", "1999", "1999", "1999", "27", "0", "0", ""]),
    "|".join(["0319011002", "1", "1", "6", "Retail", "9000", "", "", "", "", "1.00", "12", "0", "", "", "", "1", "", "", "0", "0", "0", "0", "0", "0", ""]),
]


def write_zip(path: Path, rows: list[str]) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(path.stem + ".txt", "\n".join(rows) + "\n")
    return path


class Pierce(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.tax = write_zip(self.tmp / "tax_account.zip", TAX)
        self.appraisal = write_zip(self.tmp / "appraisal_account.zip", APPRAISAL)
        self.improvement = write_zip(self.tmp / "improvement.zip", IMPROVEMENT)
        self.builtas = write_zip(self.tmp / "improvement_builtas.zip", BUILTAS)

    def roll(self, **kw):
        return {r.apn: r for r in wa_pierce.read_roll(self.tax, **kw)}

    def test_category_mapping(self):
        recs = self.roll()
        self.assertEqual(len(recs), 22, "a row without a parcel number is dropped")
        self.assertEqual(recs["0319011001"].state_category, "B")
        self.assertEqual(recs["0319011002"].state_category, "F1")
        self.assertEqual(recs["0319011003"].state_category, "F2")
        self.assertEqual(recs["0319011004"].state_category, "F1", "hotels/motels")
        self.assertEqual(recs["0319011005"].state_category, "F1", "a non-residential condominium")
        self.assertEqual(recs["0319011006"].state_category, "B", "tax relief for a private owner does not exclude")
        for apn in ("0319011007", "0319011008"):
            self.assertIsNone(recs[apn].state_category, "public bodies and non-profits are out of scope")
        for apn in ("0319011009", "0319011010", "0319011011", "0319011012"):
            self.assertIsNone(recs[apn].state_category, apn)
        for apn in ("0319011013", "0319011014", "0319011015", "0319011016", "0319011017", "0319011018", "0319011019"):
            self.assertIsNone(recs[apn].state_category, apn)
        self.assertIsNone(recs["0319011020"].state_category, "personal property")
        self.assertIsNone(recs["0000185005"].state_category, "state-assessed, use code 0000")
        self.assertEqual(recs["0319011001"].local_use_code, "1305")
        for args, expected in ((("6100",), "F1"), (("6200",), "F1"), (("6900",), "F1"), (("7410",), "F1"), (("2100",), "F2"),
                               (("3900",), "F2"), (("3600",), None), (("5100",), "F1"), (("1306",), "B"), (("1300",), None),
                               ((None,), None), (("130",), None), (("1305", "MOBIL"), None)):
            self.assertEqual(wa_pierce.category(*args), expected, args)

    def test_addresses_and_values(self):
        recs = self.roll()
        apts = recs["0319011001"]
        self.assertEqual(apts.county_fips, "053")
        self.assertEqual(apts.account, "0319011001")
        self.assertEqual(apts.situs_address, "1201 EXAMPLE AVE, WA")
        self.assertEqual((apts.market_value, apts.appraised_value), (10000000, 10000000), "the current-year columns, not the prior-year decoys")
        self.assertEqual(apts.tax_year, 2027)
        self.assertEqual(apts.locator, "tax_account parcel 0319011001")
        taxrelief = recs["0319011006"]
        self.assertEqual((taxrelief.market_value, taxrelief.appraised_value), (5000000, 2500000))
        self.assertIsNone(recs["0319011016"].situs_address, "'XXX' marks an address the County estimated from GIS")
        self.assertIsNone(recs["0319011021"].situs_address)

    def test_zero_blank_and_owners(self):
        recs = self.roll()
        empty = recs["0319011021"]
        self.assertEqual(empty.state_category, "F1")
        self.assertIsNone(empty.market_value, "0 is 'no figure', not a fact")
        for r in recs.values():
            self.assertIsNone(r.owner_name, "the Data Mart has no ownership table")
            self.assertFalse(r.owner_confidential)

    def test_companion_tables(self):
        recs = self.roll(appraisal_path=self.appraisal, improvement_path=self.improvement, builtas_path=self.builtas)
        apts, shop = recs["0319011001"], recs["0319011002"]
        self.assertEqual(apts.land_area_sf, 39204.0, "Land Net Square Feet")
        self.assertEqual(apts.improvement_area_sf, 52000.0, "square feet summed over the buildings on the parcel")
        self.assertEqual(apts.year_built, 1985, "the year built of the largest built-as segment")
        self.assertEqual(shop.improvement_area_sf, 9000.0)
        self.assertIsNone(shop.year_built, "year built 0 is 'no figure'")
        self.assertIsNone(recs["0319011003"].land_area_sf)

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = wa_pierce.build(self.tax, db, as_of="2026-10-30", appraisal_path=self.appraisal,
                                improvement_path=self.improvement, builtas_path=self.builtas)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (22, 7, 15))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        reg = Registry.open_readonly(db)
        try:
            urn = reg.resolve_external("pierce_parcel", "0319011001")
            self.assertEqual(urn, "fl:parcel:us-53053:0319011001")
            facts = {f["predicate"]: f["value"] for f in reg.facts(urn)}
            self.assertEqual(facts["parcel.state_property_category"], "B")
            self.assertEqual(facts["parcel.local_use_code"], "1305")
            self.assertEqual(facts["parcel.market_value"], 10000000)
            self.assertEqual(facts["parcel.improvement_area_sf"], 52000)
            self.assertEqual(facts["parcel.tax_year"], 2027)
            self.assertNotIn("ownership.owner_of_record", facts)
            self.assertEqual(reg.status(urn), "current")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
