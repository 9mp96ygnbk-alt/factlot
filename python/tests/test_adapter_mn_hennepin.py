"""Hennepin County adapter tests on a SYNTHETIC fixture that copies the real ``County_Parcels.csv`` layout.

Every PID, name, address and value here is invented to exercise the mapping; none is real
Minnesota data. The header is the real 121-column header of the Hub export (read 2026-11-02);
the padding of string fields (trailing spaces to the column width) copies the real file.
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import mn_hennepin

HEADER = (
    "OBJECTID,PID,PID_TEXT,DIV_STATUS_DATE,FEATURECODE,STATE_CD,TORRENS_TYP,HOUSE_NO,FRAC_HOUSE_NO,STREET_NM,"
    "CONDO_NO,MAILING_MUNIC_CD,MAILING_MUNIC_NM,ZIP_CD,MULTI_ADDR_IND,OWNER_NM,TAXPAYER_NM,TAXPAYER_NM_1,"
    "TAXPAYER_NM_2,TAXPAYER_NM_3,MUNIC_CD,MUNIC_NM,SCHOOL_DIST_NO,WATERSHED_NO,SEWER_DIST_NO,TIF_PROJECT_NO,"
    "PROPERTY_STATUS_CD,FORFEIT_LAND_IND,CO_OP_IND,PRI_SEC_CODE,ABBREV_ADDN_NM,ADDITION_NO,LOT,BLOCK,METES_BNDS1,"
    "METES_BNDS2,METES_BNDS3,METES_BNDS4,MORE_METES_BNDS_IND,ABSTR_TORRENS_CD,BUILD_YR,SALE_DATE,SALE_PRICE,"
    "SALE_CODE,SALE_CODE_NAME,PARCEL_AREA,MKT_VAL_TOT,TAXABLE_VAL_TOT,NET_IMPRV_AMT,TOT_NET_TAX,TOT_SPEC_TAX,"
    "TAX_TOT,NET_TAX_PD,TOT_PENALTY_PD,EARLIEST_DELQ_YR,COMP_JUDG_IND,MTG_CO_NBR,GR_ACRE_OPEN_SPACE_CD,"
    "PETITION_REVIEW_IND,TAX_ADJ_PEND_IND,DIV_PEND_IND,"
    + ",".join(
        f"PR_TYP_CD{i},PR_TYP_NM{i},HMSTD_CD{i},OWNER_PCT{i},CONT_IND{i},LAND_MV{i},BLDG_MV{i},MACH_MV{i},TOTAL_MV{i},"
        f"QUAL_IMPR{i},VET_EXCL{i},HMS_EXCL{i},NET_TC{i},NET_TAX{i}" for i in (1, 2, 3, 4))
    + ",LAT,LON,ShapeSTArea,ShapeSTLength"
)
COLUMNS = HEADER.split(",")


def row(**values: str) -> dict[str, str]:
    """A blank 121-column row with the given columns filled, padded like the real file."""
    r = {c: "" for c in COLUMNS}
    r.update({
        "PID_TEXT": "(1)", "FEATURECODE": "1", "STATE_CD": "0", "TORRENS_TYP": " ", "FRAC_HOUSE_NO": "   ",
        "CONDO_NO": "     ", "MULTI_ADDR_IND": " ", "PROPERTY_STATUS_CD": "0", "CO_OP_IND": " ", "BUILD_YR": "0000",
        "SALE_PRICE": "0", "PARCEL_AREA": "0", "MKT_VAL_TOT": "0", "TAXABLE_VAL_TOT": "0", "NET_IMPRV_AMT": "0",
        "TAXPAYER_NM_3": " " * 28, "MUNIC_NM": "MINNEAPOLIS     ", "MUNIC_CD": "01", "ZIP_CD": "55401",
        "LAT": "44.98", "LON": "-93.27",
    })
    r.update(values)
    return r


# Invented parcels. OWNER_NM is 35 wide and TAXPAYER_NM 28 wide in the real file.
ROWS = [
    # commercial, owner is the taxpayer: full mapping
    row(OBJECTID="1", PID="0102724110003", HOUSE_NO="2901", STREET_NM="78TH ST E           ", ZIP_CD="55425",
        MUNIC_NM="BLOOMINGTON     ", OWNER_NM="EXAMPLE PLAZA LLC                  ", TAXPAYER_NM="EXAMPLE PLAZA LLC           ",
        TAXPAYER_NM_1="1340 CORPORATE CENTER CURVE ", TAXPAYER_NM_2="EAGAN MN   55121            ", BUILD_YR="1965",
        SALE_DATE="201412", SALE_PRICE="2300000", PARCEL_AREA="79902.43116816", MKT_VAL_TOT="3444700",
        TAXABLE_VAL_TOT="3444700", PR_TYP_CD1="C", PR_TYP_NM1="COMMERCIAL-PREFERRED", HMSTD_CD1="N",
        LAND_MV1="1347000", BLDG_MV1="2097700", TOTAL_MV1="3444700"),
    # apartment with a condo/unit number and a fractional house number; taxpayer is a manager, not the owner
    row(OBJECTID="2", PID="0102724110004", HOUSE_NO="7800", FRAC_HOUSE_NO="1/2", STREET_NM="METRO PKWY          ",
        CONDO_NO="A    ", OWNER_NM="EXAMPLE APARTMENTS LP              ", TAXPAYER_NM="C/O EXAMPLE MGMT CO         ",
        TAXPAYER_NM_1="PO BOX 9                    ", TAXPAYER_NM_2="MINNEAPOLIS MN   55401      ", BUILD_YR="1968",
        PARCEL_AREA="82703.97665228", MKT_VAL_TOT="2534400", TAXABLE_VAL_TOT="2534400", PR_TYP_CD1="A ",
        PR_TYP_NM1="APARTMENT", HMSTD_CD1="N", TOTAL_MV1="2534400"),
    # industrial, natural-person owner (the registry drops the name), no house number, unknown year
    row(OBJECTID="3", PID="0102724110005", HOUSE_NO="0", STREET_NM="METRO DR            ",
        OWNER_NM="J EXAMPLE                          ", TAXPAYER_NM="J EXAMPLE                   ",
        TAXPAYER_NM_1="5 OAK LN                    ", TAXPAYER_NM_2="BLOOMINGTON MN   55425      ", BUILD_YR="0000",
        PARCEL_AREA="0", MKT_VAL_TOT="1949000", TAXABLE_VAL_TOT="1900000", PR_TYP_CD1="I",
        PR_TYP_NM1="INDUSTRIAL-PREFERRED", HMSTD_CD1="N"),
    # residential: out of scope
    row(OBJECTID="4", PID="0102724110006", HOUSE_NO="12", STREET_NM="ELM ST              ",
        OWNER_NM="A EXAMPLE                          ", TAXPAYER_NM="A EXAMPLE                   ", BUILD_YR="1950",
        PARCEL_AREA="6000", MKT_VAL_TOT="300000", TAXABLE_VAL_TOT="280000", PR_TYP_CD1="R", PR_TYP_NM1="RESIDENTIAL",
        HMSTD_CD1="H"),
    # vacant commercial land and low income rental: out of scope
    row(OBJECTID="5", PID="0102724110007", HOUSE_NO="0", STREET_NM="METRO PKWY          ",
        OWNER_NM="EXAMPLE LAND CO                    ", PARCEL_AREA="40000", MKT_VAL_TOT="500000",
        TAXABLE_VAL_TOT="500000", PR_TYP_CD1="LC", PR_TYP_NM1="LAND-COMMERCIAL"),
    row(OBJECTID="6", PID="0102724110008", HOUSE_NO="900", STREET_NM="RIVER RD            ",
        OWNER_NM="EXAMPLE HOUSING LLC                ", MKT_VAL_TOT="4000000", TAXABLE_VAL_TOT="4000000",
        PR_TYP_CD1="HL", PR_TYP_NM1="LOW INCOME RENTAL"),
    # non-current PID (divided): skipped even though commercial
    row(OBJECTID="7", PID="0102724110009", PROPERTY_STATUS_CD="3", HOUSE_NO="7851", STREET_NM="METRO PKWY          ",
        OWNER_NM="EXAMPLE PLAZA LLC                  ", MKT_VAL_TOT="100", PR_TYP_CD1="C", PR_TYP_NM1="COMMERCIAL-PREFERRED"),
    # commercial with a placeholder owner, no street name, zero values
    row(OBJECTID="8", PID="0102724110010", HOUSE_NO="0", STREET_NM="                    ",
        OWNER_NM="UNKNOWN                            ", TAXPAYER_NM="UNKNOWN                     ", MKT_VAL_TOT="0",
        TAXABLE_VAL_TOT="0", PR_TYP_CD1="C", PR_TYP_NM1="COMMERCIAL-PREFERRED"),
    # a repeated PID (second address of a multi-address parcel) collapses to the first row
    row(OBJECTID="9", PID="0102724110003", HOUSE_NO="2903", STREET_NM="78TH ST E           ", MULTI_ADDR_IND="Y",
        OWNER_NM="EXAMPLE PLAZA LLC                  ", MKT_VAL_TOT="3444700", PR_TYP_CD1="C",
        PR_TYP_NM1="COMMERCIAL-PREFERRED"),
    # mixed use: residential primary with a commercial secondary subrecord stays out of scope
    row(OBJECTID="10", PID="0102724110011", HOUSE_NO="40", STREET_NM="MAIN ST             ",
        OWNER_NM="EXAMPLE CORNER LLC                 ", MKT_VAL_TOT="800000", TAXABLE_VAL_TOT="800000",
        PR_TYP_CD1="R", PR_TYP_NM1="RESIDENTIAL", PR_TYP_CD2="C", PR_TYP_NM2="COMMERCIAL-PREFERRED"),
]


def write_csv(tmp: Path) -> Path:
    p = tmp / "County_Parcels.csv"
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    w.writeheader()
    w.writerows(ROWS)
    p.write_bytes(b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8"))  # the real file starts with a BOM
    return p


class Hennepin(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_csv(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in mn_hennepin.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["0102724110003", "0102724110004", "0102724110005", "0102724110010"],
                         "C, A, I kept; R, LC, HL dropped; non-current PID dropped; repeated PID collapsed")
        plaza = recs["0102724110003"]
        self.assertEqual(plaza.county_fips, "053")
        self.assertEqual((plaza.account, plaza.state_category, plaza.local_use_code), ("0102724110003", "F1", "C"))
        self.assertEqual(plaza.situs_address, "2901 78TH ST E, BLOOMINGTON MN 55425", "padding stripped; first row wins")
        self.assertEqual(plaza.owner_name, "EXAMPLE PLAZA LLC")
        self.assertEqual(plaza.owner_mailing_address, "1340 CORPORATE CENTER CURVE, EAGAN MN 55121")
        self.assertEqual((plaza.land_area_sf, plaza.improvement_area_sf, plaza.year_built), (79902.43, None, 1965))
        self.assertEqual((plaza.market_value, plaza.appraised_value, plaza.tax_year), (3444700, 3444700, None))
        self.assertEqual(plaza.locator, "County_Parcels.csv line 2 PID 0102724110003")
        apartments = recs["0102724110004"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "A"), "the padded code 'A ' is A")
        self.assertEqual(apartments.situs_address, "7800 1/2 METRO PKWY #A, MINNEAPOLIS MN 55401")
        self.assertEqual(apartments.owner_name, "EXAMPLE APARTMENTS LP")
        self.assertIsNone(apartments.owner_mailing_address, "the taxpayer is a manager, not the owner")
        plant = recs["0102724110005"]
        self.assertEqual((plant.state_category, plant.local_use_code), ("F2", "I"))
        self.assertEqual(plant.situs_address, "METRO DR, MINNEAPOLIS MN 55401", "house number 0 is no number")
        self.assertEqual(plant.owner_name, "J EXAMPLE", "the adapter passes persons through; the registry drops them")
        self.assertEqual(plant.owner_mailing_address, "5 OAK LN, BLOOMINGTON MN 55425")
        self.assertEqual((plant.year_built, plant.land_area_sf), (None, None), "0000 and 0 are not figures")
        self.assertEqual((plant.market_value, plant.appraised_value), (1949000, 1900000))
        unknown = recs["0102724110010"]
        self.assertIsNone(unknown.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(unknown.owner_mailing_address)
        self.assertIsNone(unknown.situs_address, "no street name, no situs")
        self.assertEqual((unknown.market_value, unknown.appraised_value), (None, None), "zero values are not figures")
        self.assertFalse(any(r.owner_confidential for r in recs.values()), "the export carries no confidentiality flag")

    def test_state_category(self):
        self.assertEqual(mn_hennepin.state_category("A"), "B")
        self.assertEqual(mn_hennepin.state_category("C "), "F1")
        self.assertEqual(mn_hennepin.state_category("i"), "F2")
        self.assertIsNone(mn_hennepin.state_category("LC"), "vacant commercial land is out of scope")
        self.assertIsNone(mn_hennepin.state_category("HL"))
        self.assertIsNone(mn_hennepin.state_category(""))
        self.assertIsNone(mn_hennepin.state_category(None))

    def test_all_categories_and_directory(self):
        every = list(mn_hennepin.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 8, "every current parcel once; the non-current PID and the repeat still dropped")
        self.assertEqual([r.apn for r in mn_hennepin.read_roll(self.csv, categories=["B"])], ["0102724110004"])
        unmapped = {r.apn: r.state_category for r in every if r.local_use_code in ("R", "LC", "HL")}
        self.assertEqual(set(unmapped.values()), {None}, "unmapped codes carry no category")
        self.assertEqual([r.apn for r in mn_hennepin.read_roll(self.tmp)], [r.apn for r in mn_hennepin.read_roll(self.csv)],
                         "a directory of csv files reads the same")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = mn_hennepin.build(self.csv, db, as_of="2026-10-22")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (4, 4, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'mn-hennepin-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("27", "053"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'hennepin_pid' AND external_id = '0102724110003'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-27053:0102724110003")
            facts = {r["predicate"]: r["value_json"] for r in reg.db.execute(
                "SELECT predicate, value_json FROM current_facts WHERE subject = ?", (urn,))}
            self.assertIn("EXAMPLE PLAZA LLC", facts["ownership.owner_of_record"])
            self.assertEqual(facts["parcel.state_property_category"], '"F1"')
            self.assertEqual(facts["parcel.local_use_code"], '"C"')
            person = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'hennepin_pid' AND external_id = '0102724110005'").fetchone()[0]
            self.assertIsNone(reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
                (person,)).fetchone(), "a natural person's name is never stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
