"""Florida DOR NAL adapter tests on a SYNTHETIC fixture that copies the real 2026 NAL layout.

The header below is the real 167-column header of the Department's NAL files (``NAL<nn>F<year>01.csv``);
every parcel number, name, address, and value is invented to exercise the mapping. None is real
Florida data.
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import fl_dor

NAL_HEADER = (
    "CO_NO,PARCEL_ID,FILE_T,ASMNT_YR,BAS_STRT,ATV_STRT,GRP_NO,DOR_UC,PA_UC,SPASS_CD,JV,JV_CHNG,JV_CHNG_CD,AV_SD,"
    "AV_NSD,TV_SD,TV_NSD,JV_HMSTD,AV_HMSTD,JV_NON_HMSTD_RESD,AV_NON_HMSTD_RESD,JV_RESD_NON_RESD,AV_RESD_NON_RESD,"
    "JV_CLASS_USE,AV_CLASS_USE,JV_H2O_RECHRGE,AV_H2O_RECHRGE,JV_CONSRV_LND,AV_CONSRV_LND,JV_HIST_COM_PROP,"
    "AV_HIST_COM_PROP,JV_HIST_SIGNF,AV_HIST_SIGNF,JV_WRKNG_WTRFNT,AV_WRKNG_WTRFNT,NCONST_VAL,DEL_VAL,PAR_SPLT,"
    "DISTR_CD,DISTR_YR,LND_VAL,LND_UNTS_CD,NO_LND_UNTS,LND_SQFOOT,DT_LAST_INSPT,IMP_QUAL,CONST_CLASS,EFF_YR_BLT,"
    "ACT_YR_BLT,TOT_LVG_AREA,NO_BULDNG,NO_RES_UNTS,SPEC_FEAT_VAL,MULTI_PAR_SAL1,QUAL_CD1,VI_CD1,SALE_PRC1,SALE_YR1,"
    "SALE_MO1,OR_BOOK1,OR_PAGE1,CLERK_NO1,SAL_CHNG_CD1,MULTI_PAR_SAL2,QUAL_CD2,VI_CD2,SALE_PRC2,SALE_YR2,SALE_MO2,"
    "OR_BOOK2,OR_PAGE2,CLERK_NO2,SAL_CHNG_CD2,OWN_NAME,OWN_ADDR1,OWN_ADDR2,OWN_CITY,OWN_STATE,OWN_ZIPCD,"
    "OWN_STATE_DOM,FIDU_NAME,FIDU_ADDR1,FIDU_ADDR2,FIDU_CITY,FIDU_STATE,FIDU_ZIPCD,FIDU_CD,S_LEGAL,APP_STAT,"
    "CO_APP_STAT,MKT_AR,NBRHD_CD,PUBLIC_LND,TAX_AUTH_CD,TWN,RNG,SEC,CENSUS_BK,PHY_ADDR1,PHY_ADDR2,PHY_CITY,"
    "PHY_ZIPCD,ALT_KEY,ASS_TRNSFR_FG,PREV_HMSTD_OWN,ASS_DIF_TRNS,CONO_PRV_HM,PARCEL_ID_PRV_HMSTD,YR_VAL_TRNSF,"
    + ",".join(f"EXMPT_{i:02d}" for i in range(1, 49)) + ",EXMPT_80,EXMPT_81,EXMPT_82,"
    "SEQ_NO,RS_ID,MP_ID,STATE_PAR_ID,SPC_CIR_CD,SPC_CIR_YR,SPC_CIR_TXT"
)
NAL_COLUMNS = NAL_HEADER.split(",")
assert len(NAL_COLUMNS) == 167


def _row(**cols: str) -> str:
    """One CSV line in the real column order; unnamed columns are blank, as the Department leaves them."""
    unknown = set(cols) - set(NAL_COLUMNS)
    assert not unknown, unknown
    return ",".join(cols.get(c, "") for c in NAL_COLUMNS)


COMMON = dict(FILE_T="R", ASMNT_YR="2026", PA_UC="00")
NAL_ROWS = [
    # Miami-Dade (23 → 086), multifamily 10+ units, organisation owner with a suite line.
    _row(CO_NO="23", PARCEL_ID="0131230120020", DOR_UC="003", JV="50000000", AV_NSD="48000000", TV_NSD="48000000",
         LND_UNTS_CD="2", NO_LND_UNTS="40000", LND_SQFOOT="40000", ACT_YR_BLT="2005", EFF_YR_BLT="2015",
         TOT_LVG_AREA="250000", NO_BULDNG="1", NO_RES_UNTS="200", OWN_NAME="EXAMPLE TOWERS LLC",
         OWN_ADDR1="100 MAIN ST", OWN_ADDR2="STE 500", OWN_CITY="MIAMI", OWN_STATE="FL", OWN_ZIPCD="33131",
         OWN_STATE_DOM="FL", PHY_ADDR1="100 MAIN ST", PHY_CITY="MIAMI", PHY_ZIPCD="33131", **COMMON),
    # One-storey store owned by a person; LND_SQFOOT 0 but the land units are square feet; no building figures.
    _row(CO_NO="23", PARCEL_ID="0131230120030", DOR_UC="011", JV="900000", AV_NSD="900000", TV_NSD="900000",
         LND_UNTS_CD="2", NO_LND_UNTS="5000", LND_SQFOOT="0", ACT_YR_BLT="", TOT_LVG_AREA="0",
         OWN_NAME="J EXAMPLE", OWN_ADDR1="5 OAK LN", OWN_CITY="MIAMI", OWN_STATE="FL", OWN_ZIPCD="33133",
         PHY_ADDR1="200 ELM ST", PHY_ADDR2="UNIT 2", PHY_CITY="MIAMI", PHY_ZIPCD="33133", **COMMON),
    # Single family: out of scope.
    _row(CO_NO="23", PARCEL_ID="0131230120040", DOR_UC="001", JV="300000", AV_NSD="250000", LND_SQFOOT="7000",
         ACT_YR_BLT="1990", TOT_LVG_AREA="2000", OWN_NAME="A EXAMPLE", OWN_ADDR1="7 PINE ST", OWN_CITY="MIAMI",
         OWN_STATE="FL", OWN_ZIPCD="33134", PHY_ADDR1="7 PINE ST", PHY_CITY="MIAMI", PHY_ZIPCD="33134", **COMMON),
    # Light manufacturing whose owner the county published as a placeholder for a withheld record.
    _row(CO_NO="23", PARCEL_ID="0131230120050", DOR_UC="041", JV="1000000", AV_NSD="1000000", LND_SQFOOT="8000",
         ACT_YR_BLT="2000", TOT_LVG_AREA="5000", OWN_NAME="CONFIDENTIAL", PHY_ADDR1="7 SHIELD ST",
         PHY_CITY="HIALEAH", PHY_ZIPCD="33010", **COMMON),
    # Vacant commercial land: out of scope (as Texas C1 is).
    _row(CO_NO="23", PARCEL_ID="0131230120060", DOR_UC="010", JV="400000", AV_NSD="400000", LND_SQFOOT="12000",
         OWN_NAME="EXAMPLE LAND CO", OWN_ADDR1="1 BAY RD", OWN_CITY="MIAMI", OWN_STATE="FL", OWN_ZIPCD="33131",
         PHY_ADDR1="BISCAYNE BLVD", PHY_CITY="MIAMI", PHY_ZIPCD="33131", **COMMON),
    # Broward (16 → 011): small multifamily with an unpadded use code, no owner of record, no situs,
    # land valued per acre with a whole-number entry (ambiguous, so no square footage is derived).
    _row(CO_NO="16", PARCEL_ID="494221010010", DOR_UC="8", JV="800000", AV_NSD="700000", LND_UNTS_CD="1",
         NO_LND_UNTS="25", LND_SQFOOT="", ACT_YR_BLT="1972", TOT_LVG_AREA="4800", NO_RES_UNTS="6",
         OWN_NAME="UNKNOWN", PHY_CITY="FORT LAUDERDALE", PHY_ZIPCD="33301", **COMMON),
    # Warehouse owned from abroad: OWN_STATE carries the country and OWN_ZIPCD is blank.
    _row(CO_NO="23", PARCEL_ID="30-3122-001-0010", DOR_UC="048", JV="12000000", AV_NSD="11000000", LND_SQFOOT="200000",
         ACT_YR_BLT="2018", TOT_LVG_AREA="150000", OWN_NAME="EXAMPLE LOGISTICS LP", OWN_ADDR1="1 KING ST W",
         OWN_CITY="TORONTO", OWN_STATE="CANADA", OWN_STATE_DOM="FC", PHY_ADDR1="9000 NW 100TH ST",
         PHY_CITY="MEDLEY", PHY_ZIPCD="33178", **COMMON),
]


def nal_zip(tmp: Path) -> Path:
    p = tmp / "Dade 23 Final NAL 2026.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("NAL23F202601.csv", "\r\n".join([NAL_HEADER, *NAL_ROWS, ""]))
    return p


class FloridaDor(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = nal_zip(self.tmp)

    def test_use_code_mapping(self):
        self.assertEqual(fl_dor.state_category("003"), "B")
        self.assertEqual(fl_dor.state_category("008"), "B")
        self.assertEqual(fl_dor.state_category("8"), "B", "codes are padded to three digits")
        self.assertEqual(fl_dor.state_category("011"), "F1")
        self.assertEqual(fl_dor.state_category("039"), "F1")
        self.assertEqual(fl_dor.state_category("041"), "F2")
        self.assertEqual(fl_dor.state_category("049"), "F2")
        for vacant_or_other in ("000", "001", "004", "010", "040", "050", "071", "086", "099", ""):
            self.assertIsNone(fl_dor.state_category(vacant_or_other), vacant_or_other)
        self.assertEqual(sum(1 for c in fl_dor._STATE_CATEGORY.values() if c == "F1"), 29)
        self.assertEqual(sum(1 for c in fl_dor._STATE_CATEGORY.values() if c == "F2"), 9)

    def test_county_numbers(self):
        self.assertEqual(fl_dor.county_fips("11"), "001", "Alachua")
        self.assertEqual(fl_dor.county_fips("16"), "011", "Broward")
        self.assertEqual(fl_dor.county_fips("23"), "086", "Miami-Dade keeps Dade's number but not Dade's FIPS")
        self.assertEqual(fl_dor.county_fips("24"), "027", "DeSoto")
        self.assertEqual(fl_dor.county_fips("26"), "031", "Duval")
        self.assertEqual(fl_dor.county_fips("39"), "057", "Hillsborough")
        self.assertEqual(fl_dor.county_fips("58"), "095", "Orange")
        self.assertEqual(fl_dor.county_fips("60"), "099", "Palm Beach")
        self.assertEqual(fl_dor.county_fips("77"), "133", "Washington")
        self.assertEqual(len(fl_dor._COUNTY_FIPS), 67)
        self.assertNotIn("025", fl_dor._COUNTY_FIPS.values(), "025 was Dade's FIPS and is retired")
        self.assertIsNone(fl_dor.county_fips("99"))
        self.assertIsNone(fl_dor.county_fips(""))

    def test_mapping_from_the_zip(self):
        recs = {r.apn: r for r in fl_dor.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["0131230120020", "0131230120030", "0131230120050", "30-3122-001-0010",
                                        "494221010010"],
                         "003, 008, 011, 041, 048 kept; 001 single family and 010 vacant commercial dropped")
        tower = recs["0131230120020"]
        self.assertEqual((tower.county_fips, tower.state_category, tower.local_use_code), ("086", "B", "003"))
        self.assertEqual(tower.account, "0131230120020")
        self.assertEqual(tower.situs_address, "100 MAIN ST, MIAMI FL 33131")
        self.assertEqual(tower.owner_name, "EXAMPLE TOWERS LLC")
        self.assertEqual(tower.owner_mailing_address, "100 MAIN ST, STE 500, MIAMI, FL 33131")
        self.assertFalse(tower.owner_confidential)
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (40000, 250000, 2005))
        self.assertEqual((tower.market_value, tower.appraised_value, tower.tax_year), (50000000, 48000000, 2026))
        self.assertEqual(tower.locator, "NAL23F202601.csv PARCEL_ID 0131230120020")
        store = recs["0131230120030"]
        self.assertEqual((store.state_category, store.local_use_code), ("F1", "011"))
        self.assertEqual(store.situs_address, "200 ELM ST UNIT 2, MIAMI FL 33133")
        self.assertEqual(store.owner_name, "J EXAMPLE", "persons pass through; the registry drops them at ingest")
        self.assertEqual(store.owner_mailing_address, "5 OAK LN, MIAMI, FL 33133")
        self.assertEqual(store.land_area_sf, 5000, "LND_SQFOOT 0 falls back to NO_LND_UNTS when the unit code is square feet")
        self.assertIsNone(store.improvement_area_sf, "0 sf is 'no figure', not a fact")
        self.assertIsNone(store.year_built)
        withheld = recs["0131230120050"]
        self.assertEqual((withheld.state_category, withheld.local_use_code), ("F2", "041"))
        self.assertTrue(withheld.owner_confidential)
        self.assertIsNone(withheld.owner_name)
        self.assertIsNone(withheld.owner_mailing_address)
        self.assertEqual(withheld.situs_address, "7 SHIELD ST, HIALEAH FL 33010")
        small = recs["494221010010"]
        self.assertEqual((small.county_fips, small.state_category, small.local_use_code), ("011", "B", "008"))
        self.assertIsNone(small.owner_name, "'UNKNOWN' is a placeholder, not an owner")
        self.assertFalse(small.owner_confidential)
        self.assertIsNone(small.situs_address, "no PHY_ADDR1 means no situs, whatever the city and ZIP say")
        self.assertIsNone(small.land_area_sf, "acres entries are ambiguous (25 may mean 0.25), so none is derived")
        self.assertEqual((small.improvement_area_sf, small.year_built), (4800, 1972))
        abroad = recs["30-3122-001-0010"]
        self.assertEqual((abroad.state_category, abroad.local_use_code), ("F2", "048"))
        self.assertEqual(abroad.owner_mailing_address, "1 KING ST W, TORONTO, CANADA")
        self.assertEqual(abroad.situs_address, "9000 NW 100TH ST, MEDLEY FL 33178")

    def test_owner_placeholders_and_withholding(self):
        self.assertEqual(fl_dor._owner("EXAMPLE TOWERS LLC"), ("EXAMPLE TOWERS LLC", False))
        self.assertEqual(fl_dor._owner("  EXAMPLE   TOWERS LLC "), ("EXAMPLE TOWERS LLC", False))
        for placeholder in ("", "   ", "UNKNOWN", "Unknown Owner", "CURRENT OWNER"):
            self.assertEqual(fl_dor._owner(placeholder), (None, False), placeholder)
        for withheld in ("CONFIDENTIAL", "Confidential", "NAME WITHHELD", "CONFIDENTIAL PER 119.071",
                         "EXEMPT PER S. 119.071 F.S.", "119.071 EXEMPT"):
            self.assertEqual(fl_dor._owner(withheld), (None, True), withheld)
        self.assertEqual(fl_dor._owner("CONFIDENTIAL TRUST SERVICES LLC"), ("CONFIDENTIAL TRUST SERVICES LLC", False),
                         "a name that merely starts with the word is an owner")

    def test_unpacked_directory_reads_the_same(self):
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        a = [r.apn for r in fl_dor.read_roll(self.zip)]
        b = [r.apn for r in fl_dor.read_roll(self.tmp / "unpacked")]
        self.assertEqual(a, b)

    def test_all_categories(self):
        every = list(fl_dor.read_roll(self.zip, categories=None))
        self.assertEqual(len(every), 7)
        self.assertEqual([r.local_use_code for r in every if r.state_category is None], ["001", "010"])
        self.assertEqual([r.apn for r in fl_dor.read_roll(self.zip, categories=["F2"])],
                         ["0131230120050", "30-3122-001-0010"])

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = fl_dor.build(self.zip, db, as_of="2026-10-28")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (5, 5, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 2, "the person and the withheld owner; placeholders are not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'fl-dor-nal'").fetchone()
            self.assertEqual(src["state_fips"], "12")
            self.assertIsNone(src["county_fips"], "a statewide source: the county is per parcel")
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'fl_parcel_id' AND external_id = '0131230120020'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-12086:0131230120020")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE TOWERS LLC", owner[0])
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("003", code[0])
            broward = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'fl_parcel_id' AND external_id = '494221010010'").fetchone()[0]
            self.assertEqual(broward, "fl:parcel:us-12011:494221010010")
            dashed = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'fl_parcel_id' AND external_id = '30-3122-001-0010'").fetchone()[0]
            self.assertEqual(dashed, "fl:parcel:us-12086:30-3122-001-0010",
                             "the ID keeps where the county's separators fall (parcel rule 2)")
            persons = reg.db.execute(
                "SELECT COUNT(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(persons, 2, "the LLC and the LP; the person and the withheld owner are not stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
