"""DeKalb County (GA) adapter tests on a SYNTHETIC fixture that copies the real layout of the Hub CSV export of
"Tax Parcels Current" (91 columns, 2026-11-03). Every parcel number, name, and value here is invented."""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ga_dekalb

HEADER = (
    "OBJECTID,LOWPARCELID,PARCELID,BUILDING,UNIT,STATEDAREA,LGLSTARTDT,CVTTXCD,CVTTXDSCRP,SCHLTXCD,SCHLDSCRP,USECD,"
    "USEDSCRP,NGHBRHDCD,CLASSCD,CLASSDSCRP,SITEADDRESS,PRPRTYDSCRP,CNVYNAME,OWNERNME1,OWNERNME2,PSTLADDRESS,PSTLCITY,"
    "PSTLSTATE,PSTLZIP5,PSTLZIP4,FLOORCOUNT,BLDGAREA,RESFLRAREA,RESYRBLT,RESSTRTYP,STRCLASS,CLASSMOD,LNDVALUE,PRVASSDVAL,"
    "CNTASSDVAL,ASSDVALYRCG,ASSDPCNTCG,PRVTXBLVAL,CNTTXBLVAL,TXBLVALYRCHG,TXBLPCNTCHG,PRVWNTTXOD,PRVSMRTXOD,TOTPRVTXTOD,"
    "CNTWNTTXOD,CNTSMRTXOD,TOTCNTTXOD,TXODYRCHG,TXODPCNTCHG,WATERSERV,SEWERSERV,LASTUPDATE,PLAT_BOOK_NUMBER,"
    "PLAT_PAGE_NUMBER,SUBDIVISION_TYPE,COMMON_AREA,CREATED_BY,CREATION_DATE,DEPTH,DIMENSIONS,FRONTAGE,LAST_UPDATED_BY,"
    "LEGAL_BLOCK_NUMBER,LEGAL_LOT_NUMBER,SUBDIVISION_ID,REASCD,STATUS,TOTAPR1,CONDITION,HISTDESC,HISTDISTRICT,LANDUSE,"
    "OVLDESC,OVLDISTRICT,ZONING,ADDRESS_NUMBER,CITY,FULL_STREET_NAME,STATE,UNIT_NO,UNIT_TYPE,ZIP,ZIP_EXTENSION,PRCLKEY,"
    "PSTLCITYSTATEZIP,ACREAGE,Shape__Area,Shape__Length,Lat,Longitude"
)
COLUMNS = HEADER.split(",")


def row(**kw: str) -> str:
    """One CSV line with the given columns filled and every other column blank."""
    values = {c: "" for c in COLUMNS}
    values.update(STATUS="7", CREATED_BY="SDE")
    values.update(kw)
    out = []
    for c in COLUMNS:
        v = values[c]
        out.append(f'"{v}"' if "," in v or '"' in v else v)
    return ",".join(out)


ROWS = [
    # office/retail parcel: class C3 → F1; organisation owner, mailing address with ZIP+4
    row(OBJECTID="1", PARCELID="06 001 01 001", CLASSDSCRP="C3", SITEADDRESS="100 Example Highway Doraville, GA 30340",
        OWNERNME1="EXAMPLE RETAIL LLC", PSTLADDRESS="1 SAMPLE PLZ", PSTLCITY="DECATUR", PSTLSTATE="GA", PSTLZIP5="30033",
        PSTLZIP4="1234", CNTASSDVAL="400000", TOTAPR1="1000000", ACREAGE="1.2"),
    # industrial small tract: I4 → F2; two owner names
    row(OBJECTID="2", PARCELID="06 001 02 002", CLASSDSCRP="I4", SITEADDRESS="2 Factory Road Tucker, GA 30084",
        OWNERNME1="EXAMPLE WORKS INC", OWNERNME2="EXAMPLE HOLDINGS LP", PSTLADDRESS="PO BOX 9", PSTLCITY="TUCKER",
        PSTLSTATE="GA", PSTLZIP5="30084", TOTAPR1="2500000", ACREAGE="5", BLDGAREA="80000"),
    # natural-person owner of a commercial lot
    row(OBJECTID="3", PARCELID="06 001 03 003", CLASSDSCRP="C5", SITEADDRESS="3 Lot Lane Atlanta, GA 30340",
        OWNERNME1="DOE JANE", PSTLADDRESS="9 HOME ST", PSTLCITY="ATLANTA", PSTLSTATE="GA", PSTLZIP5="30303",
        TOTAPR1="90000", ACREAGE="12.5"),
    # no site address (parts used), no owner, zero value and acres, placeholder
    row(OBJECTID="4", PARCELID="06 001 04 004", CLASSDSCRP="C9", OWNERNME1="UNKNOWN", ADDRESS_NUMBER="44",
        FULL_STREET_NAME="Side Street", CITY="Chamblee", STATE="GA", ZIP="30341", TOTAPR1="0", ACREAGE="0"),
    row(OBJECTID="5", PARCELID="06 001 05 005", CLASSDSCRP="C1", ADDRESS_NUMBER="", FULL_STREET_NAME="", TOTAPR1="5000",
        ACREAGE="0.1", RESYRBLT="1999"),
    # out of scope classes: residential, exempt, utility, conservation, brownfield, historic, blank
    row(OBJECTID="6", PARCELID="06 001 06 006", CLASSDSCRP="R3", OWNERNME1="ROE RICHARD", TOTAPR1="300000"),
    row(OBJECTID="7", PARCELID="06 001 07 007", CLASSDSCRP="E1", OWNERNME1="EXAMPLE CHURCH INC", TOTAPR1="900000"),
    row(OBJECTID="8", PARCELID="06 001 08 008", CLASSDSCRP="U2", OWNERNME1="EXAMPLE POWER CO", TOTAPR1="900000"),
    row(OBJECTID="9", PARCELID="06 001 09 009", CLASSDSCRP="V5", OWNERNME1="EXAMPLE FARM LLC", TOTAPR1="9000"),
    row(OBJECTID="10", PARCELID="06 001 10 010", CLASSDSCRP="B3", OWNERNME1="EXAMPLE SITE LLC", TOTAPR1="9000"),
    row(OBJECTID="11", PARCELID="06 001 11 011", CLASSDSCRP="H3", OWNERNME1="EXAMPLE HOUSE LLC", TOTAPR1="9000"),
    row(OBJECTID="12", PARCELID="06 001 12 012", CLASSDSCRP="", OWNERNME1="EXAMPLE NOCLASS LLC", TOTAPR1="9000"),
    # the office parcel again (a second row for the same parcel number) collapses to the first
    row(OBJECTID="13", PARCELID="06 001 01 001", CLASSDSCRP="C3", SITEADDRESS="100 Example Highway Doraville, GA 30340",
        OWNERNME1="EXAMPLE RETAIL LLC", TOTAPR1="1000000"),
]


def fixture(tmp: Path) -> Path:
    p = tmp / "csv"
    p.write_text("﻿" + "\n".join([HEADER, *ROWS, ""]), encoding="utf-8")
    return p


class DeKalb(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = fixture(self.tmp)

    def test_mapping(self):
        recs = {x.apn: x for x in ga_dekalb.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["06 001 01 001", "06 001 02 002", "06 001 03 003", "06 001 04 004",
                                        "06 001 05 005"],
                         "classes C and I kept; residential, exempt, utility, conservation, brownfield, historic and "
                         "classless dropped; the repeated parcel collapsed")
        retail = recs["06 001 01 001"]
        self.assertEqual((retail.county_fips, retail.state_category, retail.local_use_code), ("089", "F1", "C3"))
        self.assertEqual(retail.account, "06 001 01 001")
        self.assertEqual(retail.situs_address, "100 Example Highway Doraville, GA 30340")
        self.assertEqual(retail.owner_name, "EXAMPLE RETAIL LLC")
        self.assertEqual(retail.owner_mailing_address, "1 SAMPLE PLZ, DECATUR, GA 30033-1234")
        self.assertEqual(retail.land_area_sf, round(1.2 * 43560, 2))
        self.assertEqual((retail.market_value, retail.appraised_value), (1000000, 1000000), "TOTAPR1; not the 40 % assessed value")
        self.assertIsNone(retail.improvement_area_sf)
        self.assertEqual(retail.locator, "TaxParcelsOD PARCELID 06 001 01 001")
        self.assertFalse(retail.owner_confidential)
        works = recs["06 001 02 002"]
        self.assertEqual((works.state_category, works.local_use_code), ("F2", "I4"))
        self.assertEqual(works.owner_name, "EXAMPLE WORKS INC EXAMPLE HOLDINGS LP")
        self.assertEqual(works.improvement_area_sf, 80000)
        self.assertEqual(recs["06 001 03 003"].owner_name, "DOE JANE",
                         "the adapter passes persons through; the registry drops them")

    def test_blank_and_zero_values_are_not_facts(self):
        recs = {x.apn: x for x in ga_dekalb.read_roll(self.csv)}
        parts = recs["06 001 04 004"]
        self.assertEqual(parts.state_category, "F1")
        self.assertIsNone(parts.owner_name, "UNKNOWN is a placeholder")
        self.assertIsNone(parts.owner_mailing_address)
        self.assertEqual(parts.situs_address, "44 Side Street, Chamblee, GA 30341", "built from its parts")
        self.assertEqual((parts.market_value, parts.land_area_sf), (None, None))
        bare = recs["06 001 05 005"]
        self.assertIsNone(bare.situs_address)
        self.assertEqual((bare.year_built, bare.market_value), (1999, 5000))

    def test_state_category(self):
        sc = ga_dekalb.state_category
        for code in ("C1", "C3", "C4", "C5", "C9", "c3", " C3 "):
            self.assertEqual(sc(code), "F1", code)
        for code in ("I1", "I3", "I4", "I5", "I9"):
            self.assertEqual(sc(code), "F2", code)
        for code in ("R1", "R3", "R4", "R5", "R9", "E0", "E3", "U1", "U3", "V3", "H3", "B3", "", None):
            self.assertIsNone(sc(code), code)

    def test_all_parcels_option(self):
        every = list(ga_dekalb.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 12, "thirteen rows minus the repeated parcel")
        self.assertEqual(sum(1 for x in every if x.state_category is None), 7)

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = ga_dekalb.build(self.csv, db, as_of="2026-11-01")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (5, 5, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the commercial lot's natural-person owner")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ga-dekalb-parcels'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("13", "089"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'dekalb_parcel_id' AND external_id = '06 001 01 001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-13089:06-001-01-001")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE RETAIL LLC", owner[0])
            person = reg.db.execute(
                "SELECT COUNT(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record' "
                "AND value_json LIKE '%DOE JANE%'").fetchone()[0]
            self.assertEqual(person, 0, "natural persons are not stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
