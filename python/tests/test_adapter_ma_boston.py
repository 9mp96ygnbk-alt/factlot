"""Boston (Analyze Boston "Property Assessment") adapter tests on a SYNTHETIC fixture.

The header is the real FY2026 header (67 columns, including the padded `` GROSS_TAX `` name);
every parcel id, name, address, and value below is invented to exercise the mapping.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ma_boston

HEADER = (
    "PID,CM_ID,GIS_ID,ST_NUM,ST_ALPHA,ST_NUM2,ST_NAME,UNIT_NUM,CITY,ZIP_CODE,BLDG_SEQ,NUM_BLDGS,LUC,LU,LU_DESC,"
    "BLDG_TYPE,OWN_OCC,OWNER,MAIL_ADDRESSEE,MAIL_STREET_ADDRESS,MAIL_CITY,MAIL_STATE,MAIL_ZIP_CODE,RES_FLOOR,"
    "CD_FLOOR,RES_UNITS,COM_UNITS,RC_UNITS,LAND_SF,GROSS_AREA,LIVING_AREA,LAND_VALUE,BLDG_VALUE,SFYI_VALUE,"
    "TOTAL_VALUE, GROSS_TAX ,YR_BUILT,YR_REMODEL,STRUCTURE_CLASS,ROOF_STRUCTURE,ROOF_COVER,INT_WALL,EXT_FNISHED,"
    "INT_COND,EXT_COND,OVERALL_COND,BED_RMS,FULL_BTH,HLF_BTH,KITCHENS,TT_RMS,BDRM_COND,BTHRM_STYLE1,BTHRM_STYLE2,"
    "BTHRM_STYLE3,KITCHEN_TYPE,KITCHEN_STYLE1,KITCHEN_STYLE2,KITCHEN_STYLE3,HEAT_TYPE,HEAT_SYSTEM,AC_TYPE,"
    "FIREPLACES,ORIENTATION,NUM_PARKING,PROP_VIEW,CORNER_UNIT"
)
COLUMNS = HEADER.split(",")


def row(**values: str) -> str:
    """One CSV line with the given columns filled and the rest blank, quoting fields with commas."""
    cells = []
    for c in COLUMNS:
        v = values.get(c.strip(), "")
        cells.append(f'"{v}"' if "," in v else v)
    return ",".join(cells)


ROWS = [
    # office tower: commercial code, organisation owner, thousands separators, care-of line
    row(PID="0300010000", GIS_ID="0300010000", ST_NUM="100", ST_NAME="Example ST", CITY="BOSTON", ZIP_CODE="02110",
        BLDG_SEQ="1", NUM_BLDGS="1", LUC="345", LU="C", LU_DESC="OFFICE BUILDING", OWNER="EXAMPLE  TOWER LLC",
        MAIL_ADDRESSEE="C/O PAT EXAMPLE", MAIL_STREET_ADDRESS="100 EXAMPLE ST STE 1", MAIL_CITY="BOSTON",
        MAIL_STATE="MA", MAIL_ZIP_CODE="02110", LAND_SF="40,000", GROSS_AREA="250,000", TOTAL_VALUE="52,000,000",
        GROSS_TAX=" $1,000,000.00 ", YR_BUILT="1985"),
    # apartment building, two building rows (areas summed, earliest year kept), number range, underscored ids
    row(PID="0300020000_", GIS_ID="0300020000_", ST_NUM="226", ST_NUM2="228", ST_NAME="RIVER RD", CITY="EAST BOSTON",
        ZIP_CODE="02128_", BLDG_SEQ="1", NUM_BLDGS="2", LUC="112", LU="A", LU_DESC="APT 7-30 UNITS",
        OWNER="EXAMPLE APARTMENTS LP", MAIL_STREET_ADDRESS="1 PARK AVE", MAIL_CITY="NEW YORK", MAIL_STATE="NY",
        MAIL_ZIP_CODE="10001", LAND_SF="9,000", GROSS_AREA="18,000", TOTAL_VALUE="9,000,000", YR_BUILT="1920"),
    row(PID="0300020000_", GIS_ID="0300020000_", ST_NUM="226", ST_NUM2="228", ST_NAME="RIVER RD", CITY="EAST BOSTON",
        ZIP_CODE="02128_", BLDG_SEQ="2", NUM_BLDGS="2", LUC="112", LU="A", LU_DESC="APT 7-30 UNITS",
        OWNER="EXAMPLE APARTMENTS LP", MAIL_STREET_ADDRESS="1 PARK AVE", MAIL_CITY="NEW YORK", MAIL_STATE="NY",
        MAIL_ZIP_CODE="10001", LAND_SF="9,000", GROSS_AREA="6,000", TOTAL_VALUE="9,000,000", YR_BUILT="1965"),
    # three-family: residential, out of scope
    row(PID="0300030000", ST_NUM="5", ST_NAME="OAK LN", CITY="DORCHESTER", ZIP_CODE="02124", BLDG_SEQ="1", NUM_BLDGS="1",
        LUC="105", LU="R3", LU_DESC="THREE-FAM DWELLING", OWNER="EXAMPLE JANE", MAIL_STREET_ADDRESS="5 OAK LN",
        MAIL_CITY="DORCHESTER", MAIL_STATE="MA", MAIL_ZIP_CODE="02124", LAND_SF="3,000", GROSS_AREA="4,200",
        TOTAL_VALUE="900,000", YR_BUILT="1905"),
    # warehouse: industrial, natural-person owner (yielded by the adapter, dropped by the registry), zeros and blanks
    row(PID="0300040000", ST_NUM="7", ST_ALPHA="A", ST_NAME="SHIELD ST", CITY="BOSTON", ZIP_CODE="02118", BLDG_SEQ="1",
        NUM_BLDGS="1", LUC="401", LU="I", LU_DESC="WHSE: INDUSTRIAL", OWNER="EXAMPLE JOHN Q", MAIL_STREET_ADDRESS="7A SHIELD ST",
        MAIL_CITY="BOSTON", MAIL_STATE="MA", MAIL_ZIP_CODE="02118", LAND_SF="8,000", GROSS_AREA="0", TOTAL_VALUE="",
        YR_BUILT=""),
    # commercial land: 3xx, no street name, placeholder owner
    row(PID="0300050000", ST_NUM="0", ST_NAME="", CITY="BOSTON", ZIP_CODE="02118", BLDG_SEQ="1", NUM_BLDGS="1", LUC="390",
        LU="CL", LU_DESC="COMMERCIAL LAND", OWNER="UNKNOWN", LAND_SF="12,000", TOTAL_VALUE="1,200,000"),
    # 4-6 unit apartment, which Boston files under its residential class R4: kept as B
    row(PID="0300060000", ST_NUM="12", ST_NAME="ELM ST", UNIT_NUM="", CITY="ROXBURY", ZIP_CODE="02119", BLDG_SEQ="1",
        NUM_BLDGS="1", LUC="111", LU="R4", LU_DESC="APT 4-6 UNITS", OWNER="ELM STREET HOLDINGS LLC",
        MAIL_STREET_ADDRESS="PO BOX 9", MAIL_CITY="BOSTON", MAIL_STATE="MA", MAIL_ZIP_CODE="02119", LAND_SF="4,000",
        GROSS_AREA="7,500", TOTAL_VALUE="2,500,000", YR_BUILT="1900"),
    # commercial condo unit: 3xx with a unit number and a condo main
    row(PID="0300070002", CM_ID="0300070000", GIS_ID="0300070000", ST_NUM="50", ST_NAME="MAIN ST", UNIT_NUM="2",
        CITY="BOSTON", ZIP_CODE="02110", BLDG_SEQ="1", NUM_BLDGS="1", LUC="357", LU="CC", LU_DESC="RETAIL CONDO",
        OWNER="MAIN STREET RETAIL INC", MAIL_STREET_ADDRESS="50 MAIN ST UNIT 2", MAIL_CITY="BOSTON", MAIL_STATE="MA",
        MAIL_ZIP_CODE="02110", GROSS_AREA="1,800", TOTAL_VALUE="950,000", YR_BUILT="2010"),
    # mixed use (0xx) and an exempt warehouse (9xx): out of scope
    row(PID="0300080000", ST_NUM="9", ST_NAME="MIXED ST", CITY="BOSTON", ZIP_CODE="02118", BLDG_SEQ="1", NUM_BLDGS="1",
        LUC="031", LU="RC", LU_DESC="COMM MULTI-USE", OWNER="MIXED USE LLC", TOTAL_VALUE="3,000,000"),
    row(PID="0300090000", ST_NUM="11", ST_NAME="CITY ST", CITY="BOSTON", ZIP_CODE="02118", BLDG_SEQ="1", NUM_BLDGS="1",
        LUC="968", LU="E", LU_DESC="WAREHOUSE", OWNER="CITY OF BOSTON", TOTAL_VALUE="3,000,000"),
    # billboard: a 4xx code the publisher files under its commercial land-use class; the code decides
    row(PID="0300100000", ST_NUM="13", ST_NAME="SIGN ST", CITY="BOSTON", ZIP_CODE="02118", BLDG_SEQ="1", NUM_BLDGS="1",
        LUC="465", LU="C", LU_DESC="COM BILLBOARD", OWNER="SIGN CO", TOTAL_VALUE="100,000"),
]


def boston_csv(tmp: Path) -> Path:
    p = tmp / "fy2026-property-assessment-data_rev.csv"
    p.write_text("\n".join([HEADER, *ROWS, ""]), encoding="utf-8")
    return p


class Boston(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = boston_csv(self.tmp)

    def test_state_category(self):
        self.assertEqual(ma_boston.state_category("345"), "F1")
        self.assertEqual(ma_boston.state_category("390"), "F1", "commercial land is a 3xx code")
        self.assertEqual(ma_boston.state_category("401"), "F2")
        self.assertEqual(ma_boston.state_category("465"), "F2")
        for code in ("111", "112", "113", "114", "115", "120", "125", "126", "127", "128"):
            self.assertEqual(ma_boston.state_category(code), "B", code)
        for code in ("101", "102", "105", "116", "121", "124", "130", "013", "031", "968", "985", "995", ""):
            self.assertIsNone(ma_boston.state_category(code), code)
        self.assertIsNone(ma_boston.state_category(None))

    def test_mapping(self):
        recs = {r.apn: r for r in ma_boston.read_roll(self.csv, fiscal_year=2026)}
        self.assertEqual(sorted(recs), ["0300010000", "0300020000", "0300040000", "0300050000", "0300060000",
                                        "0300070002", "0300100000"],
                         "3xx, 4xx and apartment codes kept; residential, mixed use, exempt dropped; building rows merged")
        tower = recs["0300010000"]
        self.assertEqual((tower.county_fips, tower.account, tower.state_category, tower.local_use_code),
                         ("025", "0300010000", "F1", "345"))
        self.assertEqual(tower.situs_address, "100 Example ST, BOSTON MA 02110")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWER LLC", "doubled spaces collapse")
        self.assertEqual(tower.owner_mailing_address, "100 EXAMPLE ST STE 1, BOSTON, MA 02110",
                         "the care-of addressee is not copied")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (40000, 250000, 1985))
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (52000000, None, 2026))
        self.assertEqual(tower.locator, "fy2026-property-assessment-data_rev.csv PID 0300010000")
        self.assertFalse(tower.owner_confidential, "the file has no confidentiality flag")
        apartments = recs["0300020000"]
        self.assertEqual(apartments.state_category, "B")
        self.assertEqual(apartments.situs_address, "226-228 RIVER RD, EAST BOSTON MA 02128", "underscores stripped")
        self.assertEqual(apartments.improvement_area_sf, 24000, "building rows of one parcel are summed")
        self.assertEqual(apartments.year_built, 1920, "earliest building")
        self.assertEqual((apartments.land_area_sf, apartments.market_value), (9000, 9000000), "not doubled")
        self.assertEqual(apartments.owner_mailing_address, "1 PARK AVE, NEW YORK, NY 10001")
        warehouse = recs["0300040000"]
        self.assertEqual((warehouse.state_category, warehouse.local_use_code), ("F2", "401"))
        self.assertEqual(warehouse.situs_address, "7A SHIELD ST, BOSTON MA 02118", "ST_ALPHA joins the number")
        self.assertEqual(warehouse.owner_name, "EXAMPLE JOHN Q", "the adapter passes people through; the registry drops them")
        self.assertEqual((warehouse.improvement_area_sf, warehouse.year_built, warehouse.market_value), (None, None, None),
                         "0 and blank are not figures")
        land = recs["0300050000"]
        self.assertIsNone(land.situs_address, "no street name, no situs")
        self.assertIsNone(land.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(land.owner_mailing_address)
        self.assertEqual((land.land_area_sf, land.market_value), (12000, 1200000))
        self.assertEqual(recs["0300060000"].state_category, "B", "111 APT 4-6 UNITS is multifamily though Boston files it as R4")
        condo = recs["0300070002"]
        self.assertEqual(condo.situs_address, "50 MAIN ST UNIT 2, BOSTON MA 02110")
        self.assertEqual((condo.state_category, condo.land_area_sf), ("F1", None), "a unit has no land of its own")
        self.assertEqual(recs["0300100000"].state_category, "F2")

    def test_all_categories(self):
        every = list(ma_boston.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 10, "one record per parcel, building rows merged")
        self.assertEqual([r.apn for r in every if r.state_category is None],
                         ["0300030000", "0300080000", "0300090000"])
        self.assertEqual([r.local_use_code for r in every if r.state_category is None], ["105", "031", "968"],
                         "the publisher's code is kept even when out of scope")
        self.assertEqual([r.apn for r in ma_boston.read_roll(self.csv, categories=["F2"])], ["0300040000", "0300100000"])
        self.assertIsNone(every[0].tax_year, "no fiscal year given, none invented")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ma_boston.build(self.csv, db, as_of="2025-01-01", fiscal_year=2026)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (7, 7, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ma-boston-assessing'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("25", "025"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'boston_pid' AND external_id = '0300010000'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-25025:0300010000")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWER LLC", owner[0])
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("345", code[0])
            person = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = 'fl:parcel:us-25025:0300040000' "
                "AND predicate = 'ownership.owner_of_record'").fetchone()
            self.assertIsNone(person, "a natural person's name is never stored")
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM crosswalk WHERE system = 'boston_pid'").fetchone()[0], 7)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
