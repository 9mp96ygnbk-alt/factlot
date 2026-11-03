"""Montgomery County, PA "Montgomery County Parcels" adapter tests on a SYNTHETIC fixture.

The header is the real 122-column header of the Hub CSV export (layer 6); every parcel id, name,
address, and value below is invented to exercise the mapping.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import pa_montgomery

HEADER = (
    "OBJECTID,OBJECTID_1,TAXPIN,ALTERNATEI,PARCELTYPE,Shape_Leng,LOCATION_C,CLASS,NBHD,LIV_UNITS,UTIL1,UTIL2,UTIL3,"
    "TRAFFIC,ROADS1,ROADS2,BLOCK,UNIT,ALT_ID,PROP_INFO_,TOTAL_APPR,TOTAL_ASSE,RESTRICTIO,FARMLAND,OBYVAL,LAND_USE,"
    "ASMT_CHGDA,OWN1,OWN2,CAREOF,ADDR1,ADDR2,ADDR3,ZIP1_ZIP2,OWN_INFO_C,MUNI_CODE,SCH_DIST,SUBDIVISIO,LOT_NO,FRONTFT,"
    "LEGAL1,LEGAL2,LEGAL3,LOC_NO,LOC_ADD,LOC_DIR,LOC_STR,LOC_SUF,LOC_SUF2,LOC_UNITDE,LOC_UNITNO,LOCATION1,LOCATION2,"
    "LOC_ZIP1_Z,LEGAL_CHGD,EST_CO_TAX,EST_MUNI_T,EST_SCH_TA,DEED_BOOK,DEED_PAGE,SALE_DATE,CONSIDERAT,STATE_TAX_,STEB,"
    "LAND_SF,LAND_ACRES,LAND_CHGDA,POOL,OBY_CHGDAT,CONDITION,DEGREE_REM,YR_REM,SFLA,FINBSMT_SF,STORIES,EXTWALL,"
    "BASEMENT,FUEL,HEAT,YEAR_BUILT,STYLE,BEDROOMS,BATHS,HALF_BATHS,RM_TOT,PREFAB_FRP,FRPL_OPEN,FRPL_STACK,BSMT_CAR,"
    "DWEL_CHGDA,COMM_AREA,COMM_NLA,STRUCTURE,USE_TYPE,COMM_BSMT,COMM_HEAT,COMM_AIR,COMM_YR_BL,COMM_UNITS,COMM_IDENT,"
    "PARK_COV,PARK_UNCOV,PARTITION,RESIDUAL,ELEV,COMM_CHGDA,ASSESSMENT,PROP_INFO1,ASSMT_CHGD,OWN_INFO_1,LEGAL_CH_1,"
    "SALE_DATE_,LAND_CHDAT,OBY_CHGD_1,DWEL_CHG_1,COMM_CHG_1,PARCEL,LANDSF,EST_MCCC_T,Muni_Name,Shape__Area,"
    "Shape__Length"
)
COLUMNS = HEADER.split(",")


def row(**values: str) -> str:
    cells = []
    for c in COLUMNS:
        v = values.get(c, "")
        cells.append(f'"{v}"' if "," in v or '"' in v else v)
    return ",".join(cells)


ROWS = [
    # commercial: owner, mailing address with city and ZIP in ADDR3, acres only for one, commercial year built
    row(TAXPIN="340002470007", PARCELTYPE="BASE PARCEL", CLASS="C", LAND_USE="4237", OWN1="EXAMPLE REALTY CO", OWN2=" ",
        CAREOF="C/O PAT EXAMPLE", ADDR1="462 EXAMPLE PIKE", ADDR2=" ", ADDR3="SOUDERTON PA 18964", ZIP1_ZIP2="18964",
        LOCATION1="430 EXAMPLE PIKE", LOC_ZIP1_Z=" ", Muni_Name="Franconia Township", LAND_SF="595465", LAND_ACRES="13.67",
        COMM_AREA="95494", COMM_YR_BL="1960", YEAR_BUILT="0", TOTAL_APPR="4517110", TOTAL_ASSE="4000000"),
    # apartments: class A, a unit, second address line, ZIP missing from ADDR3
    row(TAXPIN="010000514007", PARCELTYPE="BASE PARCEL", CLASS="A", LAND_USE="4202", OWN1="SAMPLE APARTMENTS LP",
        ADDR1="905 SAMPLE LN", ADDR2="PO BOX 370", ADDR3="SPRING HOUSE PA", ZIP1_ZIP2="19477",
        LOCATION1="174 S SAMPLE PIKE", LOC_UNITDE="STE", LOC_UNITNO="200", LOC_ZIP1_Z="19002", Muni_Name="Ambler Borough",
        LAND_SF="0", LAND_ACRES="1.498", COMM_AREA="59080", COMM_YR_BL="0", YEAR_BUILT="1970", TOTAL_APPR="1434200",
        TOTAL_ASSE="1434200"),
    # the same parcel drawn twice (two polygons): kept once
    row(TAXPIN="010000514007", PARCELTYPE="BASE PARCEL", CLASS="A", LAND_USE="4202", OWN1="SAMPLE APARTMENTS LP",
        LOCATION1="174 S SAMPLE PIKE", Muni_Name="Ambler Borough", TOTAL_APPR="1434200"),
    # industrial, natural-person owner (yielded by the adapter, dropped by the registry), a bare unit number
    row(TAXPIN="090001852002", PARCELTYPE="CONDOMINIUM", CLASS="I", LAND_USE="3500", OWN1="EXAMPLE JOHN Q",
        ADDR1="245 UNION ST", ADDR3="HATFIELD PA 19440", ZIP1_ZIP2="19440", LOCATION1="245 UNION ST", LOC_UNITNO="3",
        Muni_Name="Hatfield Borough", LAND_SF="45738", COMM_AREA="31599", COMM_YR_BL="1900", TOTAL_APPR="414010",
        TOTAL_ASSE="414010"),
    # commercial vacant land: zeros and blanks everywhere, placeholder owner
    row(TAXPIN="230000772006", PARCELTYPE="BASE PARCEL", CLASS="C", LAND_USE="2201", OWN1="UNKNOWN", LOCATION1=" ",
        Muni_Name="Trappe Borough", LAND_SF="0", LAND_ACRES="0", COMM_AREA="0", TOTAL_APPR="0", TOTAL_ASSE="0"),
    # residential, exempt, utility, agricultural: out of scope
    row(TAXPIN="500000000001", CLASS="R", LAND_USE="1101", OWN1="DOE JANE", LOCATION1="1 HOME ST", TOTAL_APPR="300000"),
    row(TAXPIN="500000000002", CLASS="E", LAND_USE="5500", OWN1="BOROUGH OF EXAMPLE", LOCATION1="2 CIVIC ST"),
    row(TAXPIN="500000000003", CLASS="U", LAND_USE="6000", OWN1="EXAMPLE ELECTRIC CO", LOCATION1="3 POLE RD"),
    row(TAXPIN="500000000004", CLASS="F", LAND_USE="0319", OWN1="EXAMPLE FARMS LLC", LOCATION1="4 FARM RD"),
    row(TAXPIN="", CLASS="C", LAND_USE="4100", OWN1="NO PIN LLC"),
]


def montco_csv(tmp: Path) -> Path:
    p = tmp / "Montgomery_County_Parcels.csv"
    p.write_text("﻿" + "\n".join([HEADER, *ROWS, ""]), encoding="utf-8")
    return p


class MontgomeryPa(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = montco_csv(self.tmp)

    def test_state_category(self):
        self.assertEqual(pa_montgomery.state_category("A"), "B")
        self.assertEqual(pa_montgomery.state_category("C"), "F1")
        self.assertEqual(pa_montgomery.state_category("I"), "F2")
        for klass in ("R", "E", "U", "F", " ", "", None):
            self.assertIsNone(pa_montgomery.state_category(klass), str(klass))

    def test_read_roll_in_scope(self):
        recs = {r.apn: r for r in pa_montgomery.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["010000514007", "090001852002", "230000772006", "340002470007"])
        shop = recs["340002470007"]
        self.assertEqual((shop.county_fips, shop.state_category, shop.local_use_code), ("091", "F1", "4237"))
        self.assertEqual(shop.situs_address, "430 EXAMPLE PIKE, FRANCONIA TOWNSHIP PA")
        self.assertEqual(shop.owner_name, "EXAMPLE REALTY CO")
        self.assertEqual(shop.owner_mailing_address, "462 EXAMPLE PIKE, SOUDERTON PA 18964", "ZIP already in ADDR3; care-of dropped")
        self.assertEqual((shop.land_area_sf, shop.improvement_area_sf, shop.year_built), (595465, 95494, 1960))
        self.assertEqual((shop.market_value, shop.appraised_value, shop.tax_year), (4517110, 4000000, None))
        self.assertFalse(shop.owner_confidential)
        self.assertEqual(shop.locator, "Montgomery_County_Parcels.csv TAXPIN 340002470007")
        apartments = recs["010000514007"]
        self.assertEqual(apartments.state_category, "B")
        self.assertEqual(apartments.situs_address, "174 S SAMPLE PIKE STE 200, AMBLER BOROUGH PA 19002")
        self.assertEqual(apartments.owner_mailing_address, "905 SAMPLE LN, PO BOX 370, SPRING HOUSE PA, 19477", "ZIP appended")
        self.assertEqual(apartments.land_area_sf, 65252.88, "1.498 acres when LAND_SF is 0")
        self.assertEqual(apartments.year_built, 1970, "the dwelling year when there is no commercial year")
        industrial = recs["090001852002"]
        self.assertEqual((industrial.state_category, industrial.situs_address),
                         ("F2", "245 UNION ST UNIT 3, HATFIELD BOROUGH PA"))
        self.assertEqual(industrial.owner_name, "EXAMPLE JOHN Q", "the adapter passes people through; the registry drops them")
        land = recs["230000772006"]
        self.assertIsNone(land.situs_address, "blank location")
        self.assertIsNone(land.owner_name, "UNKNOWN is a placeholder")
        self.assertIsNone(land.owner_mailing_address)
        self.assertEqual((land.land_area_sf, land.improvement_area_sf, land.market_value, land.appraised_value),
                         (None, None, None, None))

    def test_duplicates_and_all_categories(self):
        every = list(pa_montgomery.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 8, "the repeated TAXPIN and the row without one are skipped")
        self.assertEqual([r.local_use_code for r in every if r.state_category is None], ["1101", "5500", "6000", "0319"])
        self.assertEqual([r.apn for r in pa_montgomery.read_roll(self.csv, categories=["B"])], ["010000514007"])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = pa_montgomery.build(self.csv, db, as_of="2026-10-05")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (4, 4, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'pa-montgomery-parcels'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("42", "091"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'montco_taxpin' AND external_id = '340002470007'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-42091:340002470007")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE REALTY", owner[0])
            person = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = 'fl:parcel:us-42091:090001852002' "
                "AND predicate = 'ownership.owner_of_record'").fetchone()
            self.assertIsNone(person, "a natural person's name is never stored")
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM crosswalk WHERE system = 'montco_taxpin'").fetchone()[0], 4)
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
