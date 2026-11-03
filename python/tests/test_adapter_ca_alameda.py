"""Alameda County Assessor adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel number, address and value here is invented to exercise the mapping; none is real data.
The header is the field list of the county's hosted table Assessor_Office_Secured_Tax_Roll_2025_to_2026.
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ca_alameda

HEADER = [
    "OBJECTID", "Sort_Parcel", "Print_Parcel", "TRA_Primary", "TRA_Secondary", "Situs_Street_Number",
    "Situs_Street_Name", "Situs_Unit", "Situs_City", "Situs_Zip", "Situs_Zip___4", "Land", "Imps", "CLCA_Land",
    "CLCA_Imps", "Fixtures", "BPP", "HPP", "HOEX", "OTEX", "Total_Net_Value", "Latest_Document_Prefix",
    "Latest_Document_Series", "Latest_Document_Date", "Latest_Document_Input_Date", "Attention_Name",
    "Mailing_Address_Street", "Mailing_Address_Unit", "Mailing_Address_City_State", "Mailing_Address_Zip",
    "Mailing_Address_Zip___4", "WSEQ", "CKDIGIT", "Mailing_Address_Effective_Date", "Source", "Use_Code",
    "Econ_Unit", "Delete_Date",
]


def row(**f: str) -> dict[str, str]:
    r = {c: "" for c in HEADER}
    r.update({"Situs_City": "OAKLAND", "Situs_Zip": "94601", "Mailing_Address_Street": "1 EXAMPLE WAY",
              "Mailing_Address_City_State": "OAKLAND CA", "Source": "D", **f})
    return r


ROWS = [
    row(Sort_Parcel="099 000100100", Print_Parcel="99-1-1", Situs_Street_Number="100",
        Situs_Street_Name="EXAMPLE ST", Land="1000000", Imps="2000000", Fixtures="500", Use_Code="3600"),
    row(Sort_Parcel="099 000200100", Print_Parcel="99-2-1", Situs_Street_Number="200",
        Situs_Street_Name="SAMPLE AVE", Situs_Unit="5", Situs_City="BERKELEY", Situs_Zip="94702.0",
        Land="500000", Imps="0", Use_Code="7700"),
    row(Sort_Parcel="099 000300100", Print_Parcel="99-3-1", Situs_Street_Number="300",
        Situs_Street_Name="MAPLE ST", Land="100", Use_Code="1100"),  # single-family: out
    row(Sort_Parcel="099 000400100", Print_Parcel="99-4-1", Situs_Street_Name="INDUSTRIAL BLVD", Land="0", Imps="0",
        Use_Code="4100"),
    row(Sort_Parcel="099 000500100", Print_Parcel="99-5-1", Situs_Street_Number="500", Situs_Street_Name="OLD ST",
        Land="100", Use_Code="9400", Delete_Date="2025-03-04"),  # deleted: out
    row(Sort_Parcel="099 000600100", Print_Parcel="99-6-1", Situs_Street_Number="600", Situs_Street_Name="LOT ST",
        Land="100", Use_Code="3000"),  # vacant commercial land: out
    row(Sort_Parcel="099 000700100", Print_Parcel="99-7-1", Situs_Street_Number="700", Situs_Street_Name="CONDO ST",
        Land="100", Use_Code="7305"),  # residential condominium: out
    row(Sort_Parcel="099 000800100", Print_Parcel="99-8-1", Situs_Street_Number="800", Situs_Street_Name="NEW ST",
        Land="100", Use_Code=""),  # no use code: out
    row(Sort_Parcel="099 000100100", Print_Parcel="99-1-1", Land="1", Use_Code="3600"),  # repeat: collapses
    row(Sort_Parcel="099 000900100", Print_Parcel="99-9-1", Situs_Street_Number="900", Situs_Street_Name="HOTEL WAY",
        Land="100", Imps="200", Use_Code="8900"),
    row(Sort_Parcel="099 001000100", Print_Parcel="99-10-1", Situs_Street_Number="1000", Situs_Street_Name="MALL RD",
        Land="100", Use_Code="not-a-number"),  # unparseable: out
]


def write_csv(tmp: Path) -> Path:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADER, lineterminator="\r\n")
    w.writeheader()
    w.writerows(ROWS)
    p = tmp / "roll.csv"
    p.write_text(buf.getvalue(), encoding="utf-8")
    return p


class Alameda(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_csv(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in ca_alameda.read_roll(self.csv, tax_year=2025)}
        self.assertEqual(sorted(recs), ["099000100100", "099000200100", "099000400100", "099000900100"])
        cafe = recs["099000100100"]
        self.assertEqual(cafe.county_fips, "001")
        self.assertEqual((cafe.account, cafe.state_category, cafe.tax_year, cafe.local_use_code), ("99-1-1", "F1", 2025, "3600"))
        self.assertEqual(cafe.situs_address, "100 EXAMPLE ST, OAKLAND, CA 94601")
        self.assertEqual(cafe.appraised_value, 3000000, "land + improvements; fixtures excluded")
        self.assertIsNone(cafe.market_value)
        apartments = recs["099000200100"]
        self.assertEqual(apartments.state_category, "B")
        self.assertEqual(apartments.situs_address, "200 SAMPLE AVE #5, BERKELEY, CA 94702", "float ZIP and unit")
        self.assertEqual(apartments.appraised_value, 500000)
        warehouse = recs["099000400100"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.situs_address, "INDUSTRIAL BLVD, OAKLAND, CA 94601", "no street number")
        self.assertIsNone(warehouse.appraised_value, "zero values are not figures")
        self.assertEqual(recs["099000900100"].state_category, "F1")
        # The table publishes no owner names; the mailing address is not stored without one.
        self.assertTrue(all(r.owner_name is None and r.owner_mailing_address is None and not r.owner_confidential
                            for r in recs.values()))

    def test_header_variants(self):
        """Hub exports may use the field aliases ("Sort Parcel") instead of the field names."""
        text = self.csv.read_text().replace("Sort_Parcel", "Sort Parcel", 1).replace("Use_Code", "Use Code", 1)
        alt = self.tmp / "alias.csv"
        alt.write_text(text)
        self.assertEqual(len(list(ca_alameda.read_roll(alt, tax_year=2025))), 4)

    def test_category(self):
        c = ca_alameda.category
        self.assertEqual(c("7700"), "B")
        self.assertEqual(c(7705), "B")
        self.assertIsNone(c("7300"), "condominium residential unit")
        self.assertIsNone(c("7790"), "apartment common area")
        self.assertEqual(c("9905"), "F1")
        self.assertEqual(c("4202"), "F2")
        self.assertIsNone(c("4601"), "landfill")
        self.assertIsNone(c("5300"))
        self.assertIsNone(c(""))
        self.assertIsNone(c(None))
        self.assertEqual(c(" 3600 "), "F1")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ca_alameda.build(self.csv, db, as_of="2025-07-07", tax_year=2025)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (4, 4, 0, 0))
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ca-alameda-assessor'").fetchone()
            self.assertEqual(src["county_fips"], "001")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'alameda_apn' AND external_id = '99-2-1'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-06001:099000200100")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"B"')
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
