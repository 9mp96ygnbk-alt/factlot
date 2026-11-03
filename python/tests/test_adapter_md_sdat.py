"""Maryland SDAT (opendata.maryland.gov "Real Property Assessments") adapter tests on a SYNTHETIC fixture.

The header is the real column list of the SoQL export the config requests (33 of the dataset's 223
columns); every account id, address, and value below is invented to exercise the mapping.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import md_sdat

COLUMNS = [
    "account_id_mdp_field_acctid",
    "jurisdiction_code_mdp_field_jurscode",
    "county_name_mdp_field_cntyname",
    "record_key_owner_occupancy_code_mdp_field_ooi_sdat_field_6",
    "premise_address_number_mdp_field_premsnum_sdat_field_20",
    "premise_address_number_suffix_sdat_field_21",
    "premise_address_direction_mdp_field_premsdir_sdat_field_22",
    "premise_address_name_mdp_field_premsnam_sdat_field_23",
    "premise_address_type_mdp_field_premstyp_sdat_field_24",
    "premise_address_city_mdp_field_premcity_sdat_field_25",
    "premise_address_zip_code_mdp_field_premzip_sdat_field_26",
    "premise_address_condominium_unit_no_sdat_field_28",
    "mdp_street_address_mdp_field_address",
    "mdp_street_address_city_mdp_field_city",
    "mdp_street_address_zip_code_mdp_field_zipcode",
    "zoning_code_mdp_field_zoning_sdat_field_45",
    "exempt_class_mdp_field_exclass_descexcl_sdat_field_49",
    "land_use_code_mdp_field_lu_desclu_sdat_field_50",
    "county_system_property_code_sdat_field_56",
    "tax_class_sdat_field_58",
    "bpruc_public_use_code_mdp_field_ciuse_descciuse_sdat_field_61",
    "current_cycle_data_land_value_mdp_field_names_nfmlndvl_curlndvl_and_sallndvl_sdat_field_164",
    "current_cycle_data_improvements_value_mdp_field_names_nfmimpvl_curimpvl_and_salimpvl_sdat_field_165",
    "current_assessment_year_total_assessment_sdat_field_172",
    "c_a_m_a_system_data_year_built_yyyy_mdp_field_yearblt_sdat_field_235",
    "c_a_m_a_system_data_number_of_dwelling_units_mdp_field_bldg_units_sdat_field_239",
    "c_a_m_a_system_data_structure_area_sq_ft_mdp_field_sqftstrc_sdat_field_241",
    "c_a_m_a_system_data_land_area_mdp_field_landarea_sdat_field_242",
    "c_a_m_a_system_data_land_unit_of_measure_mdp_field_luom_sdat_field_243",
    "record_deletion_date_yyyy_mm_dd_sdat_field_398",
    "assessment_cycle_year_sdat_field_399",
    "last_activity_date_yyyy_mm_dd_sdat_field_392",
    "date_of_most_recent_open_data_portal_record_update",
]
SHORT = {
    "acct": COLUMNS[0], "county": COLUMNS[2], "num": COLUMNS[4], "sfx": COLUMNS[5], "dir": COLUMNS[6],
    "name": COLUMNS[7], "type": COLUMNS[8], "city": COLUMNS[9], "zip": COLUMNS[10], "unit": COLUMNS[11],
    "maddr": COLUMNS[12], "mcity": COLUMNS[13], "mzip": COLUMNS[14], "lu": COLUMNS[17],
    "land": COLUMNS[21], "impr": COLUMNS[22], "total": COLUMNS[23], "year": COLUMNS[24],
    "struct": COLUMNS[26], "area": COLUMNS[27], "luom": COLUMNS[28], "deleted": COLUMNS[29],
}


def row(**values: str) -> str:
    """One CSV line with the given (short-named) columns filled and the rest blank."""
    cells = {SHORT[k]: v for k, v in values.items()}
    cells.setdefault(COLUMNS[29], "0000.00.00")
    return ",".join(f'"{cells.get(c, "")}"' for c in COLUMNS)


ROWS = [
    # office building in Montgomery: leading zeros, direction, acres, full values
    row(acct="160100000001", county="Montgomery", num="01234", dir="N", name="EXAMPLE", type="AVE", city="ROCKVILLE",
        zip="20850", lu="Commercial (C)", land="1000000", impr="4000000", total="4700000", year="1985",
        struct="25000", area="1.500", luom="A"),
    # apartments in Prince George's
    row(acct="17010000002", county="Prince George's", num="00099", name="SAMPLE", type="RD", city="HYATTSVILLE",
        zip="20781", lu="Apartments (M)", land="500000", impr="2500000", total="2900000", year="1962",
        struct="40000", area="87120", luom="S"),
    # industrial in Baltimore County: premise city and ZIP blank, MDP city used; sq ft land
    row(acct="04010101500003", county="Baltimore", num="05612", name="EXAMPLE PARK", type="PIKE", city="", zip="00000",
        mcity="CATONSVILLE", mzip="21228", lu="Industrial (I)", land="729500", impr="491000", total="1220500",
        year="0000", struct="2320", area="40179", luom="S"),
    # commercial condominium with a unit number and a suffix
    row(acct="160100000004", county="Montgomery", num="00500", sfx="A", name="MAIN", type="ST", city="BETHESDA", zip="20814",
        unit="204", lu="Commercial Condominium (CC)", land="0", impr="350000", total="350000", struct="1200"),
    # residential and exempt and mixed use: out of scope
    row(acct="160100000005", county="Montgomery", num="00001", name="HOME", type="CT", lu="Residential (R)", land="1", impr="1"),
    row(acct="160100000006", county="Montgomery", num="00002", name="CHURCH", type="LN", lu="Exempt Commercial (EC)", land="9", impr="9"),
    row(acct="160100000007", county="Montgomery", num="00003", name="MIXED", type="LN", lu="Commercial Residential (CR)", land="9", impr="9"),
    row(acct="160100000008", county="Montgomery", num="00004", name="TOWN", type="LN", lu="Town House (TH)", land="9", impr="9"),
    # land-only commercial parcel: zeros everywhere, no street name, only the MDP address
    row(acct="160100000009", county="Montgomery", num="00000", name="", maddr="", city="", lu="Commercial (C)", land="0", impr="0",
        total="0", year="0000", struct="0", area="4.000", luom=""),
    # premise number zero with a name: street only
    row(acct="160100000010", county="Montgomery", num="00000", name="ZION", type="RD", city="GAITHERSBURG", zip="20882",
        lu="Commercial (C)", land="0", impr="0", total="0", area="4.000", luom="A"),
    # deleted account
    row(acct="160100000011", county="Montgomery", num="00005", name="GONE", type="ST", lu="Commercial (C)", land="1", impr="1",
        deleted="2026.08.06"),
    # unknown jurisdiction
    row(acct="990100000012", county="Atlantis", num="00006", name="LOST", type="ST", lu="Commercial (C)", land="1", impr="1"),
    # Baltimore City: three-digit county FIPS 510
    row(acct="040100000013", county="Baltimore City", num="00700", name="HARBOR", type="ST", city="BALTIMORE", zip="21202",
        lu="Commercial (C)", land="100", impr="200", total="300"),
    # MDP street address only
    row(acct="160100000014", county="Montgomery", num="00000", name="", maddr="77 FALLBACK RD", mcity="SILVER SPRING",
        mzip="20901", lu="Industrial (I)", land="10", impr="10", total="20"),
]


def sdat_csv(tmp: Path) -> Path:
    p = tmp / "ed4q-f8tm.csv"
    p.write_text("\n".join([",".join(COLUMNS), *ROWS, ""]), encoding="utf-8")
    return p


class MarylandSdat(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = sdat_csv(self.tmp)

    def test_state_category(self):
        self.assertEqual(md_sdat.state_category("Commercial (C)"), "F1")
        self.assertEqual(md_sdat.state_category("Commercial Condominium (CC)"), "F1")
        self.assertEqual(md_sdat.state_category("Industrial (I)"), "F2")
        self.assertEqual(md_sdat.state_category("Apartments (M)"), "B")
        for out in ("Residential (R)", "Residential Condominium (U)", "Town House (TH)", "Exempt (E)",
                    "Exempt Commercial (EC)", "Agricultural (A)", "Commercial Residential (CR)",
                    "Residential Commercial (RC)", "Country Club (CA)", "Marsh Land (MA)", "", None):
            self.assertIsNone(md_sdat.state_category(out), out)
        self.assertEqual(md_sdat.lu_code("Commercial Condominium (CC)"), "CC")

    def test_read_roll_in_scope(self):
        recs = {r.apn: r for r in md_sdat.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["040100000013", "04010101500003", "160100000001", "160100000004",
                                        "160100000009", "160100000010", "160100000014", "17010000002"])
        office = recs["160100000001"]
        self.assertEqual((office.county_fips, office.state_category, office.local_use_code), ("031", "F1", "C"))
        self.assertEqual(office.situs_address, "1234 N EXAMPLE AVE, ROCKVILLE MD 20850", "leading zeros dropped")
        self.assertEqual(office.land_area_sf, 65340.0, "1.5 acres")
        self.assertEqual((office.improvement_area_sf, office.year_built), (25000, 1985))
        self.assertEqual((office.market_value, office.appraised_value), (5000000, 4700000), "land + improvements; phase-in total")
        self.assertIsNone(office.owner_name, "the publisher withholds owner names")
        self.assertIsNone(office.owner_mailing_address)
        self.assertFalse(office.owner_confidential)
        self.assertEqual(office.locator, "ed4q-f8tm.csv account 160100000001")
        apartments = recs["17010000002"]
        self.assertEqual((apartments.county_fips, apartments.state_category), ("033", "B"))
        self.assertEqual(apartments.land_area_sf, 87120, "square feet kept as given")
        industrial = recs["04010101500003"]
        self.assertEqual((industrial.county_fips, industrial.state_category), ("005", "F2"))
        self.assertEqual(industrial.situs_address, "5612 EXAMPLE PARK PIKE, CATONSVILLE MD 21228",
                         "blank premise city and 00000 ZIP fall back to MDP's")
        self.assertIsNone(industrial.year_built, "0000 is not a year")
        condo = recs["160100000004"]
        self.assertEqual(condo.situs_address, "500A MAIN ST UNIT 204, BETHESDA MD 20814")
        self.assertEqual((condo.market_value, condo.land_area_sf), (350000, None), "0 land value is not added; no area")
        self.assertEqual(recs["040100000013"].county_fips, "510", "Baltimore City")

    def test_zero_and_blank_handling(self):
        recs = {r.apn: r for r in md_sdat.read_roll(self.csv)}
        blank = recs["160100000009"]
        self.assertIsNone(blank.situs_address, "no street name and no MDP address")
        self.assertEqual((blank.market_value, blank.appraised_value, blank.improvement_area_sf, blank.year_built),
                         (None, None, None, None))
        self.assertIsNone(blank.land_area_sf, "an area with no unit of measure is not recorded")
        zion = recs["160100000010"]
        self.assertEqual(zion.situs_address, "ZION RD, GAITHERSBURG MD 20882", "house number 00000 is no number")
        self.assertEqual(zion.land_area_sf, 174240.0, "4 acres")
        self.assertEqual(recs["160100000014"].situs_address, "77 FALLBACK RD, SILVER SPRING MD 20901")

    def test_deleted_and_unknown_county_skipped(self):
        apns = [r.apn for r in md_sdat.read_roll(self.csv, categories=None)]
        self.assertNotIn("160100000011", apns, "deletion date set")
        self.assertNotIn("990100000012", apns, "unknown jurisdiction")
        self.assertEqual(len(apns), 12)

    def test_all_categories(self):
        every = list(md_sdat.read_roll(self.csv, categories=None))
        self.assertEqual([r.apn for r in every if r.state_category is None],
                         ["160100000005", "160100000006", "160100000007", "160100000008"])
        self.assertEqual([r.local_use_code for r in every if r.state_category is None], ["R", "EC", "CR", "TH"])
        self.assertEqual([r.apn for r in md_sdat.read_roll(self.csv, categories=["B"])], ["17010000002"])
        self.assertIsNone(every[0].tax_year, "no tax year given, none invented")
        self.assertEqual(next(md_sdat.read_roll(self.csv, tax_year=2027)).tax_year, 2027)

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = md_sdat.build(self.csv, db, as_of="2026-10-05")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (8, 8, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 0, "no owner is passed through, so none is counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'md-sdat-real-property'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("24", None))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'sdat_account' AND external_id = '160100000001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-24031:160100000001")
            code = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'", (urn,)).fetchone()
            self.assertIn("C", code[0])
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIsNone(owner, "no owner name in this source")
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM crosswalk WHERE system = 'sdat_account'").fetchone()[0], 8)
            city = reg.db.execute("SELECT urn FROM crosswalk WHERE external_id = '040100000013'").fetchone()[0]
            self.assertEqual(city, "fl:parcel:us-24510:040100000013")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
