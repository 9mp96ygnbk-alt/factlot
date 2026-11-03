"""Allegheny County (WPRDC "Property Assessments") adapter tests on a SYNTHETIC fixture.

The header is the real 86-column header of the "for downloads" CSV (``data.csv``); every parcel id,
address, and value below is invented to exercise the mapping.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import pa_allegheny

HEADER = (
    "PARID,PROPERTYHOUSENUM,PROPERTYFRACTION,PROPERTYADDRESS,PROPERTYCITY,PROPERTYSTATE,PROPERTYUNIT,PROPERTYZIP,"
    "MUNICODE,MUNIDESC,SCHOOLCODE,SCHOOLDESC,LEGAL1,LEGAL2,LEGAL3,NEIGHCODE,NEIGHDESC,TAXCODE,TAXDESC,TAXSUBCODE,"
    "TAXSUBCODE_DESC,OWNERCODE,OWNERDESC,CLASS,CLASSDESC,USECODE,USEDESC,LOTAREA,HOMESTEADFLAG,FARMSTEADFLAG,"
    "CLEANGREEN,ABATEMENTFLAG,RECORDDATE,SALEDATE,SALEPRICE,SALECODE,SALEDESC,DEEDBOOK,DEEDPAGE,PREVSALEDATE,"
    "PREVSALEPRICE,PREVSALEDATE2,PREVSALEPRICE2,CHANGENOTICEADDRESS1,CHANGENOTICEADDRESS2,CHANGENOTICEADDRESS3,"
    "CHANGENOTICEADDRESS4,COUNTYBUILDING,COUNTYLAND,COUNTYTOTAL,COUNTYEXEMPTBLDG,LOCALBUILDING,LOCALLAND,LOCALTOTAL,"
    "FAIRMARKETBUILDING,FAIRMARKETLAND,FAIRMARKETTOTAL,STYLE,STYLEDESC,STORIES,YEARBLT,EXTERIORFINISH,EXTFINISH_DESC,"
    "ROOF,ROOFDESC,BASEMENT,BASEMENTDESC,GRADE,GRADEDESC,CONDITION,CONDITIONDESC,CDU,CDUDESC,TOTALROOMS,BEDROOMS,"
    "FULLBATHS,HALFBATHS,HEATINGCOOLING,HEATINGCOOLINGDESC,FIREPLACES,BSMTGARAGE,FINISHEDLIVINGAREA,CARDNUMBER,"
    "ALT_ID,TAXYEAR,ASOFDATE"
)
COLUMNS = HEADER.split(",")


def row(**values: str) -> str:
    cells = []
    for c in COLUMNS:
        v = values.get(c, "")
        cells.append(f'"{v}"' if "," in v else v)
    return ",".join(cells)


ROWS = [
    # office tower: corporation owner type, floats in the house number and ZIP, mailing address (must not be copied)
    row(PARID="0001A00001000000", PROPERTYHOUSENUM="444.0", PROPERTYADDRESS="LIBERTY AVE", PROPERTYCITY="PITTSBURGH",
        PROPERTYSTATE="PA", PROPERTYZIP="15222.0", TAXCODE="T", OWNERCODE="20", OWNERDESC="CORPORATION", CLASS="C",
        CLASSDESC="COMMERCIAL", USECODE="449", USEDESC="OFFICE-ELEVATOR -3 + STORIES", LOTAREA="54582",
        CHANGENOTICEADDRESS1="1 EXAMPLE PLAZA", CHANGENOTICEADDRESS3="NEW YORK NY", CHANGENOTICEADDRESS4="10001",
        COUNTYTOTAL="17,535,000", FAIRMARKETTOTAL="17535000", TAXYEAR="2026", ASOFDATE="30-OCT-26"),
    # apartments 20-39 units, a number range in the fraction, a unit
    row(PARID="0002B00002000000", PROPERTYHOUSENUM="69.0", PROPERTYFRACTION="-73", PROPERTYADDRESS="STROUSS RD",
        PROPERTYCITY="IMPERIAL", PROPERTYSTATE="PA", PROPERTYUNIT="3C", PROPERTYZIP="15126.0", TAXCODE="T", CLASS="C",
        USECODE="402", USEDESC="APART:20-39 UNITS", LOTAREA="9215", COUNTYTOTAL="2400000", FAIRMARKETTOTAL="2600000",
        YEARBLT="1962", TAXYEAR="2026"),
    # apartments 5-19 units, a letter suffix
    row(PARID="0003C00003000000", PROPERTYHOUSENUM="12.0", PROPERTYFRACTION="A", PROPERTYADDRESS="E OHIO ST",
        PROPERTYCITY="PITTSBURGH", PROPERTYZIP="15212.0", TAXCODE="T", CLASS="C", USECODE="401", USEDESC="APART: 5-19 UNITS",
        FAIRMARKETTOTAL="800000", COUNTYTOTAL="0", TAXYEAR="2026"),
    # retail with apartments over: the county classes it commercial, so F1
    row(PARID="0004D00004000000", PROPERTYHOUSENUM="3.0", PROPERTYFRACTION="1/2", PROPERTYADDRESS="MAIN ST",
        PROPERTYCITY="PITTSBURGH", PROPERTYZIP="15201.0", TAXCODE="T", CLASS="C", USECODE="404", USEDESC="RETL/APT'S OVER",
        LOTAREA="2000", FAIRMARKETTOTAL="300000", TAXYEAR="2026"),
    # warehouse: industrial, zero house number and ZIP, blank values
    row(PARID="0005E00005000000", PROPERTYHOUSENUM="0.0", PROPERTYADDRESS="MILL RD", PROPERTYCITY="PITTSBURGH",
        PROPERTYZIP="0.0", TAXCODE="T", CLASS="I", USECODE="350", USEDESC="WAREHOUSE", LOTAREA="0",
        FAIRMARKETTOTAL="", COUNTYTOTAL="", TAXYEAR="2026"),
    # exempt church filed under class C: out of scope
    row(PARID="0006F00006000000", PROPERTYHOUSENUM="1.0", PROPERTYADDRESS="CHURCH ST", PROPERTYCITY="PITTSBURGH",
        PROPERTYZIP="15222.0", TAXCODE="E", CLASS="C", USECODE="685", USEDESC="CHURCHES, PUBLIC WORSHIP",
        FAIRMARKETTOTAL="500000", TAXYEAR="2026"),
    # single family, government, and utility parcels: out of scope
    row(PARID="0007G00007000000", PROPERTYHOUSENUM="5.0", PROPERTYADDRESS="OAK ST", PROPERTYCITY="PITTSBURGH",
        PROPERTYZIP="15212.0", TAXCODE="T", CLASS="R", USECODE="10", USEDESC="SINGLE FAMILY", YEARBLT="1980",
        FAIRMARKETTOTAL="150000", TAXYEAR="2026"),
    row(PARID="0008H00008000000", PROPERTYHOUSENUM="1.0", PROPERTYADDRESS="MARKET SQ", PROPERTYCITY="PITTSBURGH",
        PROPERTYZIP="15222.0", TAXCODE="E", CLASS="G", USECODE="640", USEDESC="MUNICIPAL GOVERNMENT", TAXYEAR="2026"),
    row(PARID="0009J00009000000", PROPERTYADDRESS="RAIL RD", PROPERTYCITY="PITTSBURGH", TAXCODE="T", CLASS="U",
        USECODE="489", USEDESC="COMMERCIAL/UTILITY", TAXYEAR="2026"),
    # commercial land with no street name: no situs
    row(PARID="0010K00010000000", PROPERTYADDRESS="", PROPERTYCITY="PITTSBURGH", TAXCODE="T", CLASS="C", USECODE="400",
        USEDESC="VACANT COMMERCIAL LAND", LOTAREA="43560", FAIRMARKETTOTAL="50000", COUNTYTOTAL="50000", TAXYEAR="2026"),
]


def allegheny_csv(tmp: Path) -> Path:
    p = tmp / "data.csv"
    p.write_text("\n".join([HEADER, *ROWS, ""]), encoding="utf-8")
    return p


class Allegheny(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = allegheny_csv(self.tmp)

    def test_state_category(self):
        self.assertEqual(pa_allegheny.state_category("C", "449", "T"), "F1")
        self.assertEqual(pa_allegheny.state_category("C", "400", "T"), "F1", "vacant commercial land is class C")
        self.assertEqual(pa_allegheny.state_category("C", "404", "T"), "F1", "retail with apartments over")
        for code in ("401", "402", "403"):
            self.assertEqual(pa_allegheny.state_category("C", code, "T"), "B")
        self.assertEqual(pa_allegheny.state_category("I", "350", "T"), "F2")
        self.assertIsNone(pa_allegheny.state_category("C", "685", "E"), "exempt")
        self.assertIsNone(pa_allegheny.state_category("C", "449", "P"), "PURTA is not taxable commercial")
        for klass in ("R", "U", "G", "F", "O", "", None):
            self.assertIsNone(pa_allegheny.state_category(klass, "10", "T"), str(klass))

    def test_read_roll_in_scope(self):
        recs = {r.apn: r for r in pa_allegheny.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["0001A00001000000", "0002B00002000000", "0003C00003000000",
                                        "0004D00004000000", "0005E00005000000", "0010K00010000000"])
        tower = recs["0001A00001000000"]
        self.assertEqual((tower.county_fips, tower.state_category, tower.local_use_code), ("003", "F1", "449"))
        self.assertEqual(tower.situs_address, "444 LIBERTY AVE, PITTSBURGH PA 15222", "floats become integers")
        self.assertEqual((tower.land_area_sf, tower.tax_year), (54582, 2026))
        self.assertEqual((tower.market_value, tower.appraised_value), (17535000, 17535000), "thousands separators")
        self.assertIsNone(tower.owner_name, "the county excludes owner names")
        self.assertIsNone(tower.owner_mailing_address, "the change-notice address is not copied")
        self.assertFalse(tower.owner_confidential)
        self.assertEqual(tower.locator, "data.csv PARID 0001A00001000000")
        apartments = recs["0002B00002000000"]
        self.assertEqual(apartments.state_category, "B")
        self.assertEqual(apartments.situs_address, "69-73 STROUSS RD UNIT 3C, IMPERIAL PA 15126")
        self.assertEqual((apartments.market_value, apartments.appraised_value, apartments.year_built), (2600000, 2400000, 1962))
        self.assertEqual(recs["0003C00003000000"].situs_address, "12A E OHIO ST, PITTSBURGH PA 15212", "letter suffix joins")
        self.assertIsNone(recs["0003C00003000000"].appraised_value, "0 is not a figure")
        self.assertEqual(recs["0004D00004000000"].situs_address, "3 1/2 MAIN ST, PITTSBURGH PA 15201", "a fraction is spaced")
        self.assertEqual(recs["0004D00004000000"].state_category, "F1")
        warehouse = recs["0005E00005000000"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.situs_address, "MILL RD, PITTSBURGH PA", "house number 0.0 and ZIP 0.0 are none")
        self.assertEqual((warehouse.land_area_sf, warehouse.market_value, warehouse.appraised_value), (None, None, None))
        self.assertIsNone(recs["0010K00010000000"].situs_address, "no street name, no situs")

    def test_all_categories(self):
        every = list(pa_allegheny.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 10)
        self.assertEqual([r.apn for r in every if r.state_category is None],
                         ["0006F00006000000", "0007G00007000000", "0008H00008000000", "0009J00009000000"])
        self.assertEqual([r.local_use_code for r in every if r.state_category is None], ["685", "10", "640", "489"])
        self.assertEqual([r.apn for r in pa_allegheny.read_roll(self.csv, categories=["B"])],
                         ["0002B00002000000", "0003C00003000000"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = pa_allegheny.build(self.csv, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'pa-allegheny-assessments'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("42", "003"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'allegheny_parid' AND external_id = '0001A00001000000'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-42003:0001a00001000000")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIsNone(owner)
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM crosswalk WHERE system = 'allegheny_parid'").fetchone()[0], 6)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
