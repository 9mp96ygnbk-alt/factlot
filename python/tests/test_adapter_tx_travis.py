"""Travis CAD adapter tests on a SYNTHETIC fixture that copies the Legacy 8.0.33 fixed-width layout.

Every property id, name and value here is invented to exercise the mapping; none is real Travis
County data. The column positions are copied from the publisher's layout spreadsheet
(Website_Legacy8.0.33-AppraisalExportLayout.xlsx), not from the adapter, so a wrong offset in the
adapter fails here.
"""

import re
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_travis

# (start, end) columns, 1-based inclusive, from the "Property" sheet of the published layout.
PROP = {
    "prop_id": (1, 12), "prop_type_cd": (13, 17), "prop_val_yr": (18, 22), "sup_num": (23, 34), "sup_action": (35, 36),
    "geo_id": (547, 596), "py_owner_id": (597, 608), "py_owner_name": (609, 678), "partial_owner": (679, 679),
    "py_addr_line1": (694, 753), "py_addr_line2": (754, 813), "py_addr_line3": (814, 873),
    "py_addr_city": (874, 923), "py_addr_state": (924, 973), "py_addr_country": (974, 978),
    "py_addr_zip": (979, 983), "py_addr_zip_cass": (984, 987),
    "py_confidential_flag": (990, 990), "py_address_suppress_flag": (991, 991),
    "situs_street_prefx": (1040, 1049), "situs_street": (1050, 1099), "situs_street_suffix": (1100, 1109),
    "situs_city": (1110, 1139), "situs_zip": (1140, 1149), "legal_desc": (1150, 1404),
    "legal_acreage": (1660, 1675), "land_non_hstd_val": (1811, 1825), "imprv_non_hstd_val": (1841, 1855),
    "appraised_val": (1916, 1930), "assessed_val": (1946, 1960),
    "imprv_state_cd": (2732, 2741), "land_state_cd": (2742, 2751), "land_acres": (2772, 2791),
    "ownership_pct": (4022, 4027), "prop_owner_sequence": (4051, 4090), "dba": (4136, 4175),
    "market_value": (4214, 4227), "situs_num": (4460, 4474), "situs_unit": (4475, 4479),
    "appr_owner_name": (4492, 4561), "py_confidential_name": (4931, 5000),
}
PROP_LENGTH = 9922
STATE_CD = {"state_cd": (1, 10), "state_cd_description": (11, 60), "ptd_state_cd": (61, 70),
            "ptd_state_cd_description": (71, 120), "state_cd_year": (121, 125)}
STATE_CD_LENGTH = 125
LAND_DET = {"prop_id": (1, 12), "prop_val_yr": (13, 16), "land_seg_id": (17, 28), "land_type_cd": (29, 38),
            "land_type_desc": (39, 63), "state_cd": (64, 68), "land_seg_homesite": (69, 69),
            "size_acres": (70, 83), "size_square_feet": (84, 97), "land_seg_mkt_val": (141, 154)}
LAND_DET_LENGTH = 199
IMP_DET = {"prop_id": (1, 12), "prop_val_yr": (13, 16), "imprv_id": (17, 28), "imprv_det_id": (29, 40),
           "imprv_det_type_cd": (41, 50), "imprv_det_type_desc": (51, 75), "imprv_det_class_cd": (76, 85),
           "yr_built": (86, 89), "depreciation_yr": (90, 93), "imprv_det_area": (94, 108), "imprv_det_val": (109, 122)}
IMP_DET_LENGTH = 622


# Numeric fields are right-aligned and zero-filled in the export; text fields are left-aligned.
NUMERIC = re.compile(r"^(prop_id|prop_val_yr|sup_num|.*_id|.*_val|.*_value|legal_acreage|land_acres|size_.*|"
                     r"yr_built|depreciation_yr|imprv_det_area)$")


def fixed(layout: dict, length: int, **fields: str) -> str:
    """One fixed-width record laid out by the (start, end) columns of ``layout``."""
    buf = [" "] * length
    for name, value in fields.items():
        start, end = layout[name]
        width = end - start + 1
        cell = value.rjust(width, "0") if NUMERIC.match(name) else value.ljust(width)
        assert len(cell) <= width, (name, value)
        buf[start - 1:start - 1 + width] = list(cell)
    return "".join(buf)


def prop(**fields: str) -> str:
    base = dict(prop_type_cd="R", prop_val_yr="2026", sup_num="0", partial_owner="F", py_confidential_flag="F",
                py_address_suppress_flag="F", py_addr_state="TX", appraised_val="0", market_value="0",
                land_acres="0", ownership_pct="100.00")
    base.update(fields)
    base.setdefault("prop_owner_sequence", base["prop_id"])
    base.setdefault("appr_owner_name", base.get("py_owner_name", ""))
    return fixed(PROP, PROP_LENGTH, **base)


def land(**fields: str) -> str:
    base = dict(prop_val_yr="2026", land_type_cd="LAND", land_type_desc="Land", land_seg_homesite="F",
                size_acres="0", size_square_feet="0")
    base.update(fields)
    return fixed(LAND_DET, LAND_DET_LENGTH, **base)


def detail(**fields: str) -> str:
    base = dict(prop_val_yr="2026", yr_built="0", imprv_det_area="0.000000", imprv_det_val="0.000000")
    base.update(fields)
    return fixed(IMP_DET, IMP_DET_LENGTH, **base)


PROP_ROWS = [
    # A restaurant on commercial land; the situs has no city, as on most TCAD records.
    prop(prop_id="100008", geo_id="0100030105", py_owner_name="EXAMPLE INVESTMENT PROPERTY LLC",
         py_addr_line1="41 EXAMPLE DR", py_addr_city="WOODCREEK", py_addr_zip="78676", py_addr_zip_cass="2530",
         situs_street_prefx="S", situs_street="LAMAR", situs_street_suffix="BLVD", situs_zip="78704", situs_num="1201",
         imprv_state_cd="F1", land_state_cd="F1", land_acres="5398", appraised_val="4336640", market_value="4336640",
         dba="EXAMPLE CAFE"),
    # Apartments (B1 → B) with a care-of mailing line and a city on the situs.
    prop(prop_id="100012", py_owner_name="EXAMPLE LAMAR VENTURE LLC", py_addr_line1="% EXAMPLE ADVISORS",
         py_addr_line2="400 EXAMPLE ST", py_addr_city="SAN FRANCISCO", py_addr_state="CA", py_addr_zip="94105",
         situs_street_prefx="S", situs_street="LAMAR", situs_street_suffix="BLVD", situs_city="AUSTIN",
         situs_zip="78704", situs_num="1219", imprv_state_cd="B1", land_state_cd="B1", land_acres="23553",
         appraised_val="55410000", market_value="55410000"),
    # A commercial condo (F4, reported to the Comptroller as F2); no land segment, so the acreage on
    # the property record converts; a unit number; a foreign mailing address.
    prop(prop_id="100040", py_owner_name="EXAMPLE CONDO HOLDINGS LTD", py_addr_line1="1840 RUE EXEMPLE",
         py_addr_city="DORVAL", py_addr_state="QC", py_addr_country="CA", py_addr_zip="",
         situs_street="CONGRESS", situs_street_suffix="AVE", situs_zip="78701", situs_num="500", situs_unit="200",
         imprv_state_cd="F4", land_state_cd="F4", land_acres="1000", appraised_val="900000", market_value="900000"),
    # A house (A1): out of scope.
    prop(prop_id="100050", py_owner_name="J EXAMPLE", py_addr_line1="5 OAK LN", py_addr_city="AUSTIN",
         py_addr_zip="78704", situs_street="OAK", situs_street_suffix="LN", situs_zip="78704", situs_num="5",
         imprv_state_cd="A1", land_state_cd="A1", land_acres="1607", appraised_val="300000", market_value="300000"),
    # Vacant land coded C1 with no improvement code: out of scope.
    prop(prop_id="100060", py_owner_name="VACANT LOT LLC", py_addr_line1="1 LOT ST", py_addr_city="AUSTIN",
         py_addr_zip="78701", situs_street="ELM", situs_street_suffix="ST", situs_zip="78701", situs_num="0",
         imprv_state_cd="", land_state_cd="C1", land_acres="5000", appraised_val="300000", market_value="300000"),
    # Industrial (F2) owned by a natural person whose information is confidential (Tax Code §25.025).
    prop(prop_id="100070", py_owner_name="", py_confidential_name="CONFIDENTIAL OWNER", py_confidential_flag="T",
         py_address_suppress_flag="T", situs_street="SHIELD", situs_street_suffix="RD", situs_zip="78744",
         situs_num="9", imprv_state_cd="F2", land_state_cd="F2", land_acres="20000", appraised_val="2500000",
         market_value="2500000"),
    # A duplex (B2 → B) with two owners: two records, the second with a dashed owner sequence.
    prop(prop_id="100080", py_owner_name="EXAMPLE DUPLEX LLC", partial_owner="T", ownership_pct="50.00",
         py_addr_line1="2 OAK ST", py_addr_city="AUSTIN", py_addr_zip="78702", situs_street="OAK",
         situs_street_suffix="ST", situs_num="200", situs_zip="78702", imprv_state_cd="B2", land_state_cd="B2",
         land_acres="2500", appraised_val="1000000", market_value="1000000"),
    prop(prop_id="100080", py_owner_name="OTHER HALF LLC", partial_owner="T", ownership_pct="50.00",
         prop_owner_sequence="100080-1", py_addr_line1="3 OAK ST", py_addr_city="AUSTIN", py_addr_zip="78702",
         situs_street="OAK", situs_street_suffix="ST", situs_num="200", situs_zip="78702", imprv_state_cd="B2",
         land_state_cd="B2", land_acres="2500", appraised_val="1000000", market_value="1000000"),
    # Business personal property at the restaurant: not a parcel.
    prop(prop_id="900001", prop_type_cd="P", py_owner_name="EXAMPLE CAFE INC", situs_street="LAMAR",
         situs_street_suffix="BLVD", situs_num="1201", situs_zip="78704", imprv_state_cd="", land_state_cd="",
         appraised_val="50000", market_value="50000"),
    # A property a supplement deleted (sup_action D): gone from the roll.
    prop(prop_id="100095", sup_num="3", sup_action="D", py_owner_name="GONE LLC", situs_street="OLD",
         situs_street_suffix="RD", situs_num="1", situs_zip="78701", imprv_state_cd="F1", land_state_cd="F1",
         appraised_val="1", market_value="1"),
    # An address-suppressed owner (name published, mailing address withheld), a one-acre lot with
    # an appraised value below market (agricultural use on part of the land).
    prop(prop_id="100090", py_owner_name="EXAMPLE STORAGE LP", py_address_suppress_flag="T",
         py_addr_line1="PO BOX 9", py_addr_city="AUSTIN", py_addr_zip="78767", situs_street="AIRPORT",
         situs_street_suffix="BLVD", situs_num="0", situs_zip="78702", imprv_state_cd="F1", land_state_cd="F1",
         land_acres="10000", appraised_val="800000", market_value="1000000"),
]
STATE_CD_ROWS = [
    fixed(STATE_CD, STATE_CD_LENGTH, state_cd=c, state_cd_description=d, ptd_state_cd=p, ptd_state_cd_description=pd,
          state_cd_year="2026")
    for c, d, p, pd in (("A1", "SINGLE FAMILY RESIDENCE", "A", "SINGLE-FAMILY RESIDENTIAL"),
                        ("B1", "MULTIFAMILY", "B", "MULTIFAMILY RESIDENTIAL"),
                        ("B2", "DUPLEX", "B", "MULTIFAMILY RESIDENTIAL"),
                        ("C1", "VACANT LOT", "C1", "VACANT LOTS AND TRACTS"),
                        ("F1", "COMMERCIAL IMPROVED", "F1", "COMMERCIAL REAL PROPERTY"),
                        ("F2", "INDUSTRIAL MAJOR MANUFACTURING IMPROVED", "F2", "INDUSTRIAL REAL PROPERTY"),
                        ("F4", "COMMERCIAL CONDO", "F2", "INDUSTRIAL REAL PROPERTY"))
]
LAND_ROWS = [
    land(prop_id="100008", land_seg_id="8024994", state_cd="F1", size_acres="5398", size_square_feet="23512",
         land_seg_mkt_val="4232160"),
    land(prop_id="100012", land_seg_id="7997607", state_cd="B1", size_acres="23553", size_square_feet="102597"),
    land(prop_id="100050", land_seg_id="1", state_cd="A1", size_acres="1607", size_square_feet="7000"),
    # Two segments, square feet on one and only acres on the other: both count.
    land(prop_id="100070", land_seg_id="2", state_cd="F2", size_acres="10000", size_square_feet="43560"),
    land(prop_id="100070", land_seg_id="3", state_cd="F2", size_acres="10000", size_square_feet="0"),
    land(prop_id="100080", land_seg_id="4", state_cd="B2", size_acres="2500", size_square_feet="10890"),
    land(prop_id="100090", land_seg_id="5", state_cd="F1", size_acres="10000", size_square_feet="43560"),
]
IMP_ROWS = [
    # The restaurant: paved area and a canopy are not building area; the floor is.
    detail(prop_id="100008", imprv_id="7943589", imprv_det_id="66064305", imprv_det_type_cd="551",
           imprv_det_type_desc="PAVED AREA", imprv_det_class_cd="AA", yr_built="1984", imprv_det_area="00017100.000000"),
    detail(prop_id="100008", imprv_id="7943590", imprv_det_id="66064306", imprv_det_type_cd="1ST",
           imprv_det_type_desc="1st Floor", imprv_det_class_cd="C", yr_built="2013", imprv_det_area="00002986.000000"),
    detail(prop_id="100008", imprv_id="7943590", imprv_det_id="66064307", imprv_det_type_cd="501",
           imprv_det_type_desc="CANOPY", imprv_det_class_cd="A", yr_built="2013", imprv_det_area="00000402.000000"),
    # The apartments: five floors and a parking garage; the garage is not building area.
    *[detail(prop_id="100012", imprv_id="7943591", imprv_det_id=str(66064400 + i), imprv_det_type_cd=t,
             imprv_det_type_desc=f"{t.title()} Floor", imprv_det_class_cd="WV", yr_built="2013", imprv_det_area=a)
      for i, (t, a) in enumerate((("1ST", "00023603.000000"), ("2ND", "00039339.000000"), ("3RD", "00039339.000000"),
                                   ("4TH", "00039339.000000"), ("5TH", "00015618.000000")))],
    detail(prop_id="100012", imprv_id="7943591", imprv_det_id="66064410", imprv_det_type_cd="187",
           imprv_det_type_desc="PARKING GARAGE", imprv_det_class_cd="B", yr_built="2013", imprv_det_area="00011489.000000"),
    # The duplex: two floors built in different years; the older dates the parcel.
    detail(prop_id="100080", imprv_id="3701", imprv_det_id="1", imprv_det_type_cd="1ST", imprv_det_type_desc="1st Floor",
           imprv_det_class_cd="R5", yr_built="1984", imprv_det_area="00001188.000000"),
    detail(prop_id="100080", imprv_id="3701", imprv_det_id="2", imprv_det_type_cd="2ND", imprv_det_type_desc="2nd Floor",
           imprv_det_class_cd="R5", yr_built="1960", imprv_det_area="00001188.000000"),
    # The storage lot: only a fence, with a year but no floor, so the year still dates the parcel.
    detail(prop_id="100090", imprv_id="5", imprv_det_id="3", imprv_det_type_cd="541", imprv_det_type_desc="FENCE COMM LF",
           imprv_det_class_cd="C6", yr_built="1999", imprv_det_area="00000300.000000"),
    # A house detail: out of scope, ignored.
    detail(prop_id="100050", imprv_id="6", imprv_det_id="4", imprv_det_type_cd="1ST", imprv_det_type_desc="1st Floor",
           imprv_det_class_cd="R4", yr_built="1990", imprv_det_area="00002000.000000"),
]


def travis_zip(tmp: Path) -> Path:
    p = tmp / "2026 Certified Appraisal Export Supp 0.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("APPR_HDR.TXT", "07/18/2026 16:27Appraisal Export - 2026".ljust(244) + "\r\n")
        zf.writestr("PROP.TXT", "\r\n".join([*PROP_ROWS, ""]))
        zf.writestr("STATE_CD.TXT", "\r\n".join([*STATE_CD_ROWS, ""]))
        zf.writestr("LAND_DET.TXT", "\r\n".join([*LAND_ROWS, ""]))
        zf.writestr("IMP_DET.TXT", "\r\n".join([*IMP_ROWS, ""]))
    return p


class Travis(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = travis_zip(self.tmp)

    def test_fixture_records_have_the_layout_length(self):
        self.assertTrue(all(len(r) == PROP_LENGTH for r in PROP_ROWS))
        self.assertTrue(all(len(r) == LAND_DET_LENGTH for r in LAND_ROWS))
        self.assertTrue(all(len(r) == IMP_DET_LENGTH for r in IMP_ROWS))
        self.assertEqual(PROP_ROWS[0][:17], "000000100008R    ")

    def test_mapping(self):
        recs = {r.apn: r for r in tx_travis.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["100008", "100012", "100040", "100070", "100080", "100090"],
                         "F1, B1, F4 (→F2), F2, B2, F1 kept; A1, C1 and personal property dropped; "
                         "the second owner record and the deleted property dropped; leading zeros stripped from prop_id")
        cafe = recs["100008"]
        self.assertEqual(cafe.county_fips, "453")
        self.assertEqual((cafe.account, cafe.state_category, cafe.local_use_code, cafe.tax_year), ("100008", "F1", "F1", 2026))
        self.assertEqual(cafe.situs_address, "1201 S LAMAR BLVD, TX 78704", "no situs city on the record")
        self.assertEqual(cafe.owner_name, "EXAMPLE INVESTMENT PROPERTY LLC")
        self.assertEqual(cafe.owner_mailing_address, "41 EXAMPLE DR, WOODCREEK, TX 78676-2530", "ZIP and CASS add-on joined")
        self.assertEqual((cafe.land_area_sf, cafe.improvement_area_sf, cafe.year_built), (23512, 2986, 2013),
                         "land from the segment's square feet; only the floor is building area; the floor's year")
        self.assertEqual((cafe.market_value, cafe.appraised_value), (4336640, 4336640))
        self.assertEqual(cafe.locator, "PROP.TXT prop_id 100008")
        self.assertFalse(cafe.owner_confidential)
        flats = recs["100012"]
        self.assertEqual((flats.state_category, flats.local_use_code), ("B", "B1"))
        self.assertEqual(flats.situs_address, "1219 S LAMAR BLVD, AUSTIN TX 78704")
        self.assertEqual(flats.owner_mailing_address, "% EXAMPLE ADVISORS, 400 EXAMPLE ST, SAN FRANCISCO, CA 94105")
        self.assertEqual((flats.land_area_sf, flats.improvement_area_sf, flats.year_built), (102597, 157238, 2013),
                         "five floors summed; the parking garage is not building area")
        condo = recs["100040"]
        self.assertEqual((condo.state_category, condo.local_use_code), ("F2", "F4"), "TCAD reports commercial condos as F2")
        self.assertEqual(condo.situs_address, "500 CONGRESS AVE 200, TX 78701")
        self.assertEqual(condo.owner_mailing_address, "1840 RUE EXEMPLE, DORVAL, QC, CA", "foreign country kept")
        self.assertEqual(condo.land_area_sf, 4356, "no land segment: the property's acreage (4 decimals) converts")
        self.assertEqual((condo.improvement_area_sf, condo.year_built), (None, None))
        withheld = recs["100070"]
        self.assertTrue(withheld.owner_confidential)
        self.assertIsNone(withheld.owner_name)
        self.assertIsNone(withheld.owner_mailing_address)
        self.assertEqual(withheld.land_area_sf, 43560 + 43560, "square feet where given, acres × 43560 where not")
        duplex = recs["100080"]
        self.assertEqual(duplex.owner_name, "EXAMPLE DUPLEX LLC", "the first owner record wins")
        self.assertEqual((duplex.state_category, duplex.local_use_code), ("B", "B2"))
        self.assertEqual((duplex.improvement_area_sf, duplex.year_built), (2376, 1960))
        storage = recs["100090"]
        self.assertEqual(storage.owner_name, "EXAMPLE STORAGE LP")
        self.assertIsNone(storage.owner_mailing_address, "address suppression keeps the name, drops the address")
        self.assertFalse(storage.owner_confidential)
        self.assertEqual((storage.improvement_area_sf, storage.year_built), (None, 1999),
                         "a fence is not building area, but its year still dates the parcel")
        self.assertEqual((storage.market_value, storage.appraised_value), (1000000, 800000))

    def test_state_category(self):
        table = tx_travis.read_state_codes(self.zip)
        self.assertEqual(tx_travis.state_category("F4", table), "F2")
        self.assertEqual(tx_travis.state_category("B2", table), "B")
        self.assertEqual(tx_travis.state_category("F5", table), "F2", "codes missing from the file fall back to the table")
        self.assertEqual(tx_travis.state_category("ZZ9", table), "ZZ9", "an unlisted code passes through")
        self.assertIsNone(tx_travis.state_category("", table))
        self.assertEqual(tx_travis.state_category("J3"), "J3")

    def test_all_categories_and_unpacked_directory(self):
        self.assertEqual(len(list(tx_travis.read_roll(self.zip, categories=None))), 8,
                         "every real property once; personal property still dropped")
        self.assertEqual([r.apn for r in tx_travis.read_roll(self.zip, categories=["C1"])], ["100060"])
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        self.assertEqual([r.apn for r in tx_travis.read_roll(self.tmp / "unpacked")],
                         [r.apn for r in tx_travis.read_roll(self.zip)])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = tx_travis.build(self.zip, db, as_of="2026-07-18")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the confidential owner")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-travis-cad'").fetchone()
            self.assertEqual(src["county_fips"], "453")
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'tcad_prop_id' AND external_id = '100040'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48453:100040")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"F2"')
            local = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'",
                (urn,)).fetchone()[0]
            self.assertEqual(local, '"F4"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 5, "every organisation owner; not the confidential one")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
