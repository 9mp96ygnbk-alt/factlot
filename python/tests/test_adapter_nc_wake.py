"""Wake County (NC) adapter tests on a SYNTHETIC fixture that copies the real layout of the NC OneMap
Hub CSV export (70 lower-case columns, 2026-11-03). Every parcel number, name, and value here is invented."""

import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import nc_wake

HEADER = (
    "objectid,parno,altparno,ownname,improvval,landval,parval,mailadd,munit,mcity,mstate,mzip,siteadd,sunit,scity,"
    "gisacres,struct,multistruc,saledate,saledatetx,legdecfull,parusecode,parusedesc,parusecd2,parusedsc2,parvaltype,"
    "owntype,recareano,recareatx,revisedate,sourceref,sourcedate,sourcedatx,subdivisio,nparno,cntyname,cntyfips,stfips,"
    "stcntyfips,gnisid,sourceagnt,transfdate,maddpref,maddrno,maddstname,maddstr,maddstsuf,maddsttyp,ownfrst,ownlast,"
    "revdatetx,reviseyear,saddno,saddpref,saddstname,saddstr,saddstsuf,saddsttyp,sstate,stname,subowntype,subsurfown,"
    "szip,structno,structyear,ownname2,presentval,mapref,st_areashape,st_perimetershape"
)
COLUMNS = HEADER.split(",")


def row(**kw: str) -> str:
    """One CSV line with the given columns filled and every other column blank (Wake County, state 37)."""
    values = {c: "" for c in COLUMNS}
    values.update(cntyname="Wake", cntyfips="183", stfips="37", stcntyfips="37183", sourceagnt="Wake County Assessor",
                  parvaltype="Assessed", sstate="NC", stname="NC")
    values.update(kw)
    out = []
    for c in COLUMNS:
        v = values[c]
        out.append(f'"{v}"' if "," in v or '"' in v else v)
    return ",".join(out)


ROWS = [
    # office building: class COM, type and use 34 → F1; the mailing city carries state and ZIP
    row(objectid="1", parno="0700000001", altparno="0100001", ownname="EXAMPLE OFFICE PARTNERS LLC", improvval="4000000",
        landval="1000000", parval="5000000", mailadd="1 EXAMPLE PLZ", munit="STE 5", mcity="RICHMOND VA 23226-3791",
        siteadd="100 EXAMPLE ST", scity="RALEIGH", gisacres="1.5", recareano="1.49", legdecfull="LO1 EXAMPLE BM2020 -00001",
        parusecode="COM", parusedesc="C", parusecd2="34", parusedsc2="OFC GROSS", structyear="1998", structno="1"),
    # garden apartments: class APT, type and use 07 → B; unincorporated (no situs city)
    row(objectid="2", parno="0700000002", altparno="0100002", ownname="EXAMPLE APARTMENTS HOLDINGS LP", improvval="9000000",
        landval="2000000", parval="11000000", mailadd="PO BOX 9", mcity="WAKE FOREST", mstate="NC", mzip="27587",
        siteadd="7 GARDEN WAY", sunit="BLDG 2", scity="", gisacres="4.0", recareano="0", parusecode="APT", parusedesc="G",
        parusecd2="07", parusedsc2="GRDN APT", structyear="2005"),
    # warehouse: class IND → F2; natural-person owner (kept as a record; the registry drops the name)
    row(objectid="3", parno="0700000003", altparno="0100003", ownname="DOE, JANE Q", improvval="800000", landval="300000",
        parval="1100000", mailadd="9 SAMPLE LN", mcity="CARY NC 27511", siteadd="5 DEPOT RD", scity="GARNER",
        gisacres="2.0", parusecode="IND", parusedesc="D", parusecd2="83", parusedsc2="WAREHSE", structyear="2010"),
    # a one-family house on an apartment-class parcel → out of scope
    row(objectid="4", parno="0700000004", altparno="0100004", ownname="EXAMPLE APARTMENTS HOLDINGS LP", parval="250000",
        siteadd="9 GARDEN WAY", scity="WAKE FOREST", gisacres="0.5", parusecode="APT", parusedesc="G", parusecd2="01",
        parusedsc2="SINGLFAM"),
    # single-family residential, vacant, manufactured home ("MFG" is not manufacturing), condo master account → out of scope
    row(objectid="5", parno="0700000005", altparno="0100005", ownname="ROE, RICHARD", parval="400000", siteadd="1 ELM ST",
        scity="CARY", parusecode="RHS", parusedesc="R"),
    row(objectid="6", parno="0700000006", altparno="0100006", ownname="EXAMPLE LAND LLC", parval="90000", siteadd="0 MAIN ST",
        parusecode="VAC", parusedesc="V"),
    row(objectid="7", parno="0700000007", altparno="0100007", ownname="DOE, JOHN", parval="30000", siteadd="3 TRAILER RD",
        parusecode="MFG", parusedesc="M"),
    row(objectid="8", parno="0700000008", altparno="0100008", ownname="EXAMPLE CONDOMINIUM ASSOC", parval="0",
        siteadd="8 CONDO CT", scity="MORRISVILLE", parusecode="COX", parusedesc="O"),
    # commercial with zero value and acres (not figures), no owner, placeholder structure year 0
    row(objectid="9", parno="0700000009", altparno="0100009", ownname="", parval="0", improvval="0", landval="0",
        siteadd="12 SHOP ST", scity="APEX", gisacres="0", recareano="0", parusecode="COM", parusedesc="C", parusecd2="",
        structyear="0"),
    # the same parcel repeated (a second polygon) collapses to the first
    row(objectid="10", parno="0700000001", altparno="0100001", ownname="EXAMPLE OFFICE PARTNERS LLC", parval="5000000",
        siteadd="100 EXAMPLE ST", scity="RALEIGH", parusecode="COM", parusedesc="C", parusecd2="34"),
    # a row from another county in the statewide layer is not part of this source
    row(objectid="11", parno="0800000001", altparno="9", ownname="OTHER COUNTY LLC", parval="1", siteadd="1 X ST",
        cntyname="Durham", cntyfips="063", stcntyfips="37063", parusecode="COM", parusedesc="C", parusecd2="34"),
]


def fixture(tmp: Path) -> Path:
    p = tmp / "North_Carolina_Parcels_(Polygons).csv"
    p.write_text("﻿" + "\n".join([HEADER, *ROWS, ""]), encoding="utf-8")
    return p


class Wake(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = fixture(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in nc_wake.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["0700000001", "0700000002", "0700000003", "0700000009"],
                         "F1, B, F2, F1 kept; house on apartment class, residential, vacant, manufactured home, "
                         "condo master, other county and the repeated polygon dropped")
        office = recs["0700000001"]
        self.assertEqual(office.county_fips, "183")
        self.assertEqual((office.state_category, office.local_use_code, office.account), ("F1", "COM/34", "0100001"))
        self.assertEqual(office.situs_address, "100 EXAMPLE ST, RALEIGH NC")
        self.assertEqual(office.owner_name, "EXAMPLE OFFICE PARTNERS LLC")
        self.assertEqual(office.owner_mailing_address, "1 EXAMPLE PLZ, STE 5, RICHMOND VA 23226-3791")
        self.assertEqual(office.land_area_sf, round(1.49 * 43560, 2), "the recorded acreage wins over the polygon's")
        self.assertEqual((office.appraised_value, office.market_value, office.year_built), (5000000, None, 1998))
        self.assertIsNone(office.improvement_area_sf)
        self.assertIsNone(office.tax_year)
        self.assertFalse(office.owner_confidential)
        self.assertEqual(office.locator, "nc-parcels cntyfips 183 parno 0700000001")
        apartments = recs["0700000002"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "APT/07"))
        self.assertEqual(apartments.situs_address, "7 GARDEN WAY, BLDG 2, NC", "no situs city for unincorporated parcels")
        self.assertEqual(apartments.land_area_sf, round(4.0 * 43560, 2), "a zero recorded acreage falls back to the polygon")
        self.assertEqual(apartments.owner_mailing_address, "PO BOX 9, WAKE FOREST, NC 27587")
        warehouse = recs["0700000003"]
        self.assertEqual((warehouse.state_category, warehouse.local_use_code), ("F2", "IND/83"))
        self.assertEqual(warehouse.owner_name, "DOE, JANE Q", "the adapter passes persons through; the registry drops them")

    def test_blank_and_zero_values_are_not_facts(self):
        shop = {r.apn: r for r in nc_wake.read_roll(self.csv)}["0700000009"]
        self.assertEqual(shop.state_category, "F1")
        self.assertEqual(shop.local_use_code, "COM")
        self.assertIsNone(shop.owner_name)
        self.assertIsNone(shop.owner_mailing_address)
        self.assertEqual((shop.appraised_value, shop.land_area_sf, shop.year_built), (None, None, None))
        self.assertEqual(shop.situs_address, "12 SHOP ST, APEX NC")

    def test_state_category(self):
        sc = nc_wake.state_category
        self.assertEqual(sc("COM", "47"), "F1")
        self.assertEqual(sc("com", ""), "F1")
        self.assertEqual(sc("IND", "85"), "F2")
        self.assertEqual(sc("APT", "100"), "B", "student apartments")
        self.assertEqual(sc("APT", "05"), "B", "multi-family")
        self.assertEqual(sc("APT", ""), "B")
        self.assertIsNone(sc("APT", "02"), "a two-family house on an apartment-class parcel")
        for code in ("RHS", "AHS", "AWI", "VAC", "HOA", "XMT", "PTX", "AGR", "MFG", "COX", "", None):
            self.assertIsNone(sc(code), code)

    def test_all_wake_parcels_option(self):
        every = list(nc_wake.read_roll(self.csv, categories=None))
        self.assertEqual(len(every), 9, "ten Wake rows minus the repeated polygon; the Durham row is still excluded")
        self.assertEqual(sum(1 for r in every if r.state_category is None), 5)

    def test_build_registry_from_the_snapshot(self):
        db = self.tmp / "registry.db"
        stats = nc_wake.build(self.csv, db, as_of="2026-05-17")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.skipped_out_of_scope), (4, 4, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the warehouse's natural-person owner")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'nc-wake-parcels'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("37", "183"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'wake_reid' AND external_id = '0100001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-37183:0700000001")
            owner = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'", (urn,)).fetchone()
            self.assertIn("EXAMPLE OFFICE PARTNERS LLC", owner[0])
            person = reg.db.execute(
                "SELECT COUNT(*) FROM current_facts WHERE subject = 'fl:parcel:us-37183:0700000003' "
                "AND predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(person, 0, "natural persons are not stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
