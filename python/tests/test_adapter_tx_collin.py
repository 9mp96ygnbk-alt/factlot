"""Collin CAD adapter tests on a SYNTHETIC fixture that copies the ``AD_Public`` table layout.

Every property id, name and value here is invented to exercise the mapping; none is real Collin
County data. The fixture is a CSV as ``mdb-export`` writes it from ``AD_Public.mdb`` (the real
header, quoted text, bare numbers, blank for null), which is the form the adapter reads from the
database; the ``.mdb`` itself can only be read where mdbtools is installed.
"""

import csv
import io
import shutil
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_collin

# The 94 columns of AD_Public, in table order, as mdb-export prints the header.
COLLIN_HEADER = (
    "prop_id,geo_id,file_as_name,pct_ownership,dba_name,addr_line1,addr_line2,addr_line3,addr_city,addr_state,"
    "addr_zip,ml_deliverable,abs_subdv_cd,abs_subdv_ref,abs_subdv_desc,block,tract_or_lot,legal_desc,legal_desc_2,"
    "mapsco,condo_pct,situs_num,situs_street_prefx,situs_street,situs_street_sufix,situs_city,situs_state,situs_zip,"
    "situs_display,city,school,tif,exemptions,all_entities,deed_book_id,deed_book_page,deed_num,deed_dt,deed_type_cd,"
    "legal_acreage,eff_size_acres,land_sqft,land_total_sqft,living_area,state_cd,class_cd,property_use_cd,"
    "prop_type_cd,commercial_flag,eff_yr_blt,yr_blt,zoning,land_type_cd,beds,baths,stories,units,percent_complete,"
    "pool,prop_create_dt,property_status,curr_val_yr,curr_imprv_hstd_val,curr_imprv_non_hstd_val,curr_land_hstd_val,"
    "curr_land_non_hstd_val,curr_ag_use_val,curr_ag_market,curr_market,curr_ag_loss,curr_appraised_val,"
    "curr_ten_percent_cap,curr_assessed_val,cert_val_yr,cert_imprv_hstd_val,cert_imprv_non_hstd_val,"
    "cert_land_hstd_val,cert_land_non_hstd_val,cert_ag_use_val,cert_ag_market,cert_market,cert_ag_loss,"
    "cert_appraised_val,cert_ten_percent_cap,cert_assessed_val,parent_year,parent_id,parent_block,parent_tract,"
    "parent_acres"
)
COLLIN_COLUMNS = COLLIN_HEADER.split(",")


def collin_row(**fields: str) -> dict[str, str]:
    """One row with the table's usual padding, blanks and zeros where a value is not given."""
    r = {c: "" for c in COLLIN_COLUMNS}
    r.update(pct_ownership="100.0000000000", ml_deliverable="Y", situs_state="TX", prop_type_cd="R    ",
             commercial_flag="T", eff_yr_blt="0", yr_blt="0", land_sqft="0.00", land_total_sqft="0.00",
             living_area="0", percent_complete="100.00", pool="N", property_status="InProgress", curr_val_yr="2027",
             cert_val_yr="2026", cert_market="0", cert_appraised_val="0", cert_assessed_val="0")
    r.update(fields)
    if r["situs_street"] and not r["situs_display"]:
        line = " ".join(x for x in (r["situs_num"], r["situs_street_prefx"], r["situs_street"], r["situs_street_sufix"]) if x)
        r["situs_display"] = f"{line} \n{r['situs_city']}, {r['situs_state']} {r['situs_zip']}"
    return r


COLLIN_ROWS = [
    # An office building (F3, reported as F1) with a care-of line in the mailing address.
    collin_row(prop_id="37", geo_id="R-0002-00A-0030-1", file_as_name="EXAMPLE HEALTH SERVICES INC",
               dba_name="EXAMPLE CLINIC", addr_line1="% EXAMPLE INC", addr_line2="PO BOX 1504", addr_city="NASHVILLE",
               addr_state="TN", addr_zip="37202-1504", situs_num="1630", situs_street="COIT", situs_street_sufix="RD",
               situs_city="PLANO", situs_zip="75075", land_total_sqft="49262.00", living_area="15136", state_cd="F3",
               class_cd="MM2", property_use_cd="MDO", eff_yr_blt="1998", yr_blt="1989", stories="2", units="0",
               cert_imprv_non_hstd_val="1762546", cert_land_non_hstd_val="837454", cert_market="2600000",
               cert_appraised_val="2600000", cert_assessed_val="2600000"),
    # Vacant commercial land (C3 → C1): out of scope even with the commercial flag set.
    collin_row(prop_id="55", geo_id="R-0005-001-0010-1", file_as_name="EXAMPLE AIR PARK LTD",
               addr_line2="1722 EXAMPLE ST STE 770", addr_city="DALLAS", addr_state="TX", addr_zip="75201-2588",
               situs_street="PIPER", situs_street_sufix="ST", situs_city="PLANO", situs_zip="75093",
               eff_size_acres="0.3560", state_cd="C3", commercial_flag="T", cert_land_non_hstd_val="63000",
               cert_market="63000", cert_appraised_val="63000", cert_assessed_val="63000"),
    # Apartments (B1) on acreage with no square-foot figure; a directional prefix; agricultural
    # loss makes the appraised value lower than market.
    collin_row(prop_id="1001", geo_id="R-1001-000-0010-1", file_as_name="EXAMPLE APARTMENTS LP",
               addr_line1="ATTN: TAX DEPT", addr_line2="1 PARK AVE", addr_city="NEW YORK", addr_state="NY",
               addr_zip="10001", situs_num="2300", situs_street_prefx="W", situs_street="PLANO", situs_street_sufix="PKWY",
               situs_city="PLANO", situs_zip="75075", legal_acreage="2.0000", eff_size_acres="2.0000",
               living_area="180000", state_cd="B1", yr_blt="2005", eff_yr_blt="2010", stories="4", units="200",
               cert_market="31000000", cert_appraised_val="30000000", cert_assessed_val="30000000"),
    # A duplex (B2) owned by a natural person; residential division (commercial_flag F).
    collin_row(prop_id="1002", geo_id="R-1002-000-0010-1", file_as_name="J EXAMPLE", addr_line1="200 OAK ST",
               addr_city="MCKINNEY", addr_state="TX", addr_zip="75069", situs_num="200", situs_street="OAK",
               situs_street_sufix="ST", situs_city="MCKINNEY", situs_zip="75069", commercial_flag="F",
               land_total_sqft="10890.00", living_area="2400", state_cd="B2", yr_blt="1960", eff_yr_blt="1975",
               cert_market="1000000", cert_appraised_val="1000000", cert_assessed_val="1000000"),
    # Industrial (F2) with the placeholder owner, no building figures and a new account: no
    # certified year yet, so the current (preliminary) values are used.
    collin_row(prop_id="1003", geo_id="R-1003-000-0010-1", file_as_name="OWNER OF RECORD", situs_num="9",
               situs_street="SHIELD", situs_street_sufix="RD", situs_city="FRISCO", situs_zip="75034",
               land_total_sqft="87120.00", state_cd="F2", property_status="Preliminary", cert_val_yr="",
               cert_market="", cert_appraised_val="", cert_assessed_val="", curr_market="2500000",
               curr_appraised_val="2500000", curr_assessed_val="2500000"),
    # A house (A1): out of scope.
    collin_row(prop_id="1004", geo_id="R-1004-000-0010-1", file_as_name="EXAMPLE FAMILY TRUST", addr_line1="5 ELM LN",
               addr_city="ALLEN", addr_state="TX", addr_zip="75002", situs_num="5", situs_street="ELM",
               situs_street_sufix="LN", situs_city="ALLEN", situs_zip="75002", commercial_flag="F",
               land_total_sqft="7000.00", living_area="2000", state_cd="A1", yr_blt="1990", cert_market="400000",
               cert_appraised_val="400000", cert_assessed_val="400000"),
    # City-owned land (EX4): exempt, out of scope.
    collin_row(prop_id="1005", geo_id="R-1005-000-0010-1", file_as_name="EXAMPLE CITY OF", addr_line1="1 CITY HALL",
               addr_city="PLANO", addr_state="TX", addr_zip="75074", situs_street="15TH", situs_street_sufix="ST",
               situs_city="PLANO", situs_zip="75074", land_total_sqft="435.60", state_cd="EX4",
               exemptions="EX", cert_market="1000", cert_appraised_val="1000", cert_assessed_val="1000"),
    # Business personal property at the office: not a parcel.
    collin_row(prop_id="900001", geo_id="P-900001", file_as_name="EXAMPLE CLINIC INC", prop_type_cd="P    ",
               situs_num="1630", situs_street="COIT", situs_street_sufix="RD", situs_city="PLANO", situs_zip="75075",
               state_cd="L1", cert_market="50000", cert_appraised_val="50000", cert_assessed_val="50000"),
    # A commercial condo (F4 → F1) with a situs but no situs state and no mailing address.
    collin_row(prop_id="1006", geo_id="R-1006-000-0010-1", file_as_name="EXAMPLE CONDO HOLDINGS LLC",
               situs_num="500", situs_street="CENTRAL", situs_street_sufix="EXPY", situs_city="PLANO", situs_state="",
               situs_zip="75074", land_total_sqft="0.00", living_area="1500", state_cd="F4", yr_blt="2001",
               cert_market="400000", cert_appraised_val="400000", cert_assessed_val="400000"),
]


def collin_csv(tmp: Path) -> Path:
    """The fixture as mdb-export writes it: text quoted, numbers bare, nulls blank, CRLF kept inside quotes."""
    p = tmp / "AD_Public.csv"
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(COLLIN_COLUMNS)
    for r in COLLIN_ROWS:
        w.writerow([r[c] for c in COLLIN_COLUMNS])
    p.write_text(buf.getvalue(), encoding="utf-8")
    return p


class Collin(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = collin_csv(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in tx_collin.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["1001", "1002", "1003", "1006", "37"],
                         "F3, B1, B2, F2, F4 kept; C3, A1, EX4 and personal property dropped")
        office = recs["37"]
        self.assertEqual(office.county_fips, "085")
        self.assertEqual((office.account, office.state_category, office.local_use_code, office.tax_year), ("37", "F1", "F3", 2026))
        self.assertEqual(office.situs_address, "1630 COIT RD, PLANO TX 75075")
        self.assertEqual(office.owner_name, "EXAMPLE HEALTH SERVICES INC")
        self.assertEqual(office.owner_mailing_address, "% EXAMPLE INC, PO BOX 1504, NASHVILLE, TN 37202-1504")
        self.assertEqual((office.land_area_sf, office.improvement_area_sf, office.year_built), (49262, 15136, 1989),
                         "actual year built, not the effective year")
        self.assertEqual((office.market_value, office.appraised_value), (2600000, 2600000))
        self.assertEqual(office.locator, "AD_Public prop_id 37")
        self.assertFalse(office.owner_confidential)
        apartments = recs["1001"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "B1"))
        self.assertEqual(apartments.situs_address, "2300 W PLANO PKWY, PLANO TX 75075")
        self.assertEqual(apartments.owner_mailing_address, "ATTN: TAX DEPT, 1 PARK AVE, NEW YORK, NY 10001")
        self.assertEqual(apartments.land_area_sf, 87120, "acres convert when there is no square-foot figure")
        self.assertEqual((apartments.improvement_area_sf, apartments.year_built), (180000, 2005))
        self.assertEqual((apartments.market_value, apartments.appraised_value), (31000000, 30000000))
        duplex = recs["1002"]
        self.assertEqual((duplex.state_category, duplex.owner_name), ("B", "J EXAMPLE"), "persons are dropped later, by the registry")
        self.assertEqual((duplex.land_area_sf, duplex.improvement_area_sf, duplex.year_built), (10890, 2400, 1960))
        placeholder = recs["1003"]
        self.assertIsNone(placeholder.owner_name, "'OWNER OF RECORD' is a placeholder, not an owner")
        self.assertIsNone(placeholder.owner_mailing_address)
        self.assertFalse(placeholder.owner_confidential)
        self.assertEqual((placeholder.improvement_area_sf, placeholder.year_built), (None, None), "zeros are not figures")
        self.assertEqual((placeholder.market_value, placeholder.appraised_value, placeholder.tax_year), (2500000, 2500000, 2027),
                         "no certified year yet: the current preliminary values")
        condo = recs["1006"]
        self.assertEqual((condo.state_category, condo.local_use_code), ("F1", "F4"))
        self.assertEqual(condo.situs_address, "500 CENTRAL EXPY, PLANO TX 75074", "a blank situs state is Texas")
        self.assertIsNone(condo.owner_mailing_address, "no mailing address lines")
        self.assertIsNone(condo.land_area_sf, "0.00 square feet and no acreage is no figure")
        # The file carries no confidentiality flag, so no record can be marked confidential from it.
        self.assertFalse(any(r.owner_confidential for r in recs.values()))

    def test_building_class(self):
        facts = {r.apn: r.extra_facts for r in tx_collin.read_roll(self.csv)}
        self.assertEqual(facts["37"], [("parcel.building_class", "MM2", None)])
        self.assertTrue(all(f == [] for apn, f in facts.items() if apn != "37"), "a blank class_cd is no class")
        self.assertFalse(any(p == "parcel.neighborhood_code" for f in facts.values() for p, _v, _u in f),
                         "the file has no neighborhood code")

    def test_state_category(self):
        self.assertEqual(tx_collin.state_category("F3"), "F1")
        self.assertEqual(tx_collin.state_category("F4"), "F1")
        self.assertEqual(tx_collin.state_category("F2"), "F2")
        self.assertEqual(tx_collin.state_category("B6"), "B")
        self.assertEqual(tx_collin.state_category("C4"), "C1")
        self.assertEqual(tx_collin.state_category("EX9"), "X", "exempt codes are X, whatever the sheet's description column says")
        self.assertEqual(tx_collin.state_category("J3A"), "J3")
        self.assertEqual(tx_collin.state_category("ZZ9"), "ZZ9", "an unlisted code passes through")
        self.assertIsNone(tx_collin.state_category(""))

    def test_all_categories_and_directory(self):
        self.assertEqual(len(list(tx_collin.read_roll(self.csv, categories=None))), 8,
                         "every real property; personal property still dropped")
        self.assertEqual([r.apn for r in tx_collin.read_roll(self.csv, categories=["C1"])], ["55"])
        self.assertEqual([r.apn for r in tx_collin.read_roll(self.csv, categories=["X"])], ["1005"])
        self.assertEqual([r.apn for r in tx_collin.read_roll(self.tmp)], [r.apn for r in tx_collin.read_roll(self.csv)],
                         "a directory holding AD_Public.csv reads the same")

    def test_mdb_needs_mdbtools(self):
        mdb = self.tmp / "AD_Public.mdb"
        mdb.write_bytes(b"\x00" * 16)
        if shutil.which("mdb-export"):
            with self.assertRaises(RuntimeError):
                list(tx_collin.read_roll(mdb))
        else:
            with self.assertRaisesRegex(RuntimeError, "mdbtools"):
                list(tx_collin.read_roll(mdb))

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = tx_collin.build(self.csv, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (5, 5, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-collin-cad'").fetchone()
            self.assertEqual(src["county_fips"], "085")
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'ccad_prop_id' AND external_id = '37'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48085:37")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"F1"')
            local = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'",
                (urn,)).fetchone()[0]
            self.assertEqual(local, '"F3"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 3, "office, apartments, condo; not the person or the placeholder")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
