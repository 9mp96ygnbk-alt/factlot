"""Statewide NC OneMap adapter tests on SYNTHETIC fixtures that copy the real layout of the layer's
export (70 lower-case columns; 2026-11-03). Every parcel number, name, and value here is invented. The
use codes and their meanings are the real ones from each county's published tables (see
docs/registry/sources/nc-onemap-parcels.md); the parcels carrying them are made up."""

import tempfile
import unittest
from pathlib import Path
from urllib.parse import unquote

from factlot.registry import Registry
from factlot.registry.adapters import nc_onemap

HEADER = (
    "objectid,parno,altparno,ownname,improvval,landval,parval,mailadd,munit,mcity,mstate,mzip,siteadd,sunit,scity,"
    "gisacres,struct,multistruc,saledate,saledatetx,legdecfull,parusecode,parusedesc,parusecd2,parusedsc2,parvaltype,"
    "owntype,recareano,recareatx,revisedate,sourceref,sourcedate,sourcedatx,subdivisio,nparno,cntyname,cntyfips,stfips,"
    "stcntyfips,gnisid,sourceagnt,transfdate,maddpref,maddrno,maddstname,maddstr,maddstsuf,maddsttyp,ownfrst,ownlast,"
    "revdatetx,reviseyear,saddno,saddpref,saddstname,saddstr,saddstsuf,saddsttyp,sstate,stname,subowntype,subsurfown,"
    "szip,structno,structyear,ownname2,presentval,mapref,st_areashape,st_perimetershape"
)
COLUMNS = HEADER.split(",")

COUNTY = {"021": "Buncombe", "071": "Gaston", "097": "Iredell", "183": "Wake", "081": "Guilford", "067": "Forsyth",
          "051": "Cumberland", "101": "Johnston", "129": "New Hanover"}


def row(fips: str, **kw: str) -> str:
    """One CSV line for a county with the given columns filled and every other column blank."""
    values = {c: "" for c in COLUMNS}
    values.update(cntyname=COUNTY[fips], cntyfips=fips, stfips="37", stcntyfips="37" + fips,
                  sourceagnt=f"{COUNTY[fips]} County Assessor", parvaltype="Assessed", sstate="NC", stname="NC")
    values.update(kw)
    out = []
    for c in COLUMNS:
        v = values[c]
        out.append(f'"{v}"' if "," in v or '"' in v else v)
    return ",".join(out)


def write(tmp: Path, name: str, rows: list[str]) -> Path:
    p = tmp / name
    p.write_text("﻿" + "\n".join([HEADER, *rows, ""]), encoding="utf-8")
    return p


def codes(path: Path, fips: str) -> dict[str, str | None]:
    return {r.apn: r.state_category for r in nc_onemap.read_roll(path, fips)}


# --- Buncombe: Parcel Class Code table; 4xx commercial block, 7xx industrial block, 411 APT ---------------
BUNCOMBE = [
    row("021", objectid="1", parno="900000000100000", altparno="900000000100000", ownname="EXAMPLE APARTMENTS LLC",
        improvval="5000000", landval="500000", parval="5500000", mailadd="1 SAMPLE WAY", mcity="ASHEVILLE", mstate="NC",
        mzip="28801", siteadd="10 EXAMPLE  ST", recareano="3.5", parusecode="411", parusedesc="APARTMENTS",
        parusedsc2="Improved"),
    row("021", objectid="2", parno="900000000200000", altparno="900000000200000", ownname="EXAMPLE OFFICE PARTNERS LP",
        improvval="900000", landval="100000", parval="1000000", siteadd="20 EXAMPLE  AVE", gisacres="0.8",
        parusecode="464", parusedesc="OFFICE BLDG"),
    row("021", objectid="3", parno="900000000300000", altparno="900000000300000", ownname="DOE, JANE", parval="700000",
        improvval="600000", siteadd="30 EXAMPLE  RD", gisacres="2.0", parusecode="710", parusedesc="IND/MANUFACTURING"),
    # warehouse is in the 4xx commercial block → F1
    row("021", objectid="4", parno="900000000400000", ownname="EXAMPLE STORAGE INC", parval="300000", siteadd="40 EXAMPLE  DR",
        parusecode="440", parusedesc="WAREHOUSE/STORAGE"),
    # out of scope: manufactured home park, camps, commercial parking lot, 442 (table and layer disagree), 439 (not in table),
    # commercial vacant land, residential, townhome, church, mining/quarry, multiple residences
    *[row("021", objectid=str(10 + i), parno=f"9000000009{i:02d}000", ownname="EXAMPLE LAND LLC", parval="100000",
          siteadd=f"{i} OUT ST", parusecode=code, parusedesc=desc)
      for i, (code, desc) in enumerate([
          ("416", "MFGHOME PARK =>3 UN"), ("417", "CAMPS,COTTAGES,RV PK"), ("438", "PARKING LOT/COM."),
          ("442", "OTHER COMMERCIAL"), ("439", ""), ("340", "COMM VAC"), ("101", "Residential"), ("121", "TOWNHOME"),
          ("621", "CHURCH BUILDING"), ("721", "SAND & GRAVEL"), ("180", "MULTIPLE RESIDENCES"), ("", "")], 1)],
    # another county's row in the statewide layer is not part of this source
    row("097", objectid="40", parno="9000000010", ownname="OTHER COUNTY LLC", parval="1", parusecode="464"),
]

# --- Gaston: Property Use Codes (Schedule of Values 2023, chapter 4) -------------------------------------
GASTON = [
    row("071", objectid="1", parno="9999-11-0001", altparno="900001", ownname="EXAMPLE GARDEN APARTMENTS LP",
        improvval="3000000", landval="600000", parval="3600000", mailadd="PO BOX 5", mcity="GASTONIA", mstate="NC",
        mzip="280520005", siteadd="1 SAMPLE AVE", scity="GASTONIA CITY", gisacres="2.5", parusecode="2100",
        parusedesc="Apt Complex/Multi-Family", structyear="1983"),
    row("071", objectid="2", parno="9999-11-0002", altparno="900002", ownname="EXAMPLE OFFICE LLC", improvval="400000",
        landval="100000", parval="500000", siteadd="2 SAMPLE AVE", scity="BELMONT CITY", gisacres="0.5", parusecode="2060",
        parusedesc="Office", structyear="2001"),
    row("071", objectid="3", parno="9999-11-0003", altparno="900003", ownname="DOE, JOHN Q", improvval="1500000",
        landval="200000", parval="1700000", siteadd="3 SAMPLE AVE", gisacres="4.0", parusecode="3020", parusedesc="Warehouse",
        structyear="1999"),
    row("071", objectid="4", parno="9999-11-0004", altparno="900004", ownname="EXAMPLE MFG CO", parval="2500000",
        siteadd="4 SAMPLE AVE", parusecode="3010", parusedesc="Industrial"),
    # out of scope: commercial land, cell tower, parking lot, billboard, mobile home park, golf course, house on commercial
    # land, live/work, Section 42 housing, industrial land, mining, solar farm, 4 family, residential, office condo (not in
    # the 2023 table), exempt
    *[row("071", objectid=str(10 + i), parno=f"9999-22-{i:04d}", altparno=f"91{i:04d}", ownname="EXAMPLE LAND LLC",
          parval="100000", siteadd=f"{i} OUT ST", parusecode=code, parusedesc=desc)
      for i, (code, desc) in enumerate([
          ("2000", "Commercial Land"), ("2001", "Cell Tower Site"), ("2002", "Parking Lot"), ("2003", "Billboard Site"),
          ("2004", "Mobile Home Park"), ("2005", "Golf Course"), ("2007", "House on Commercial Site"), ("2240", "Live/Work"),
          ("2250", "Section 42 Housing"), ("3000", "Industrial Land"), ("3001", "Mining/Minerals"), ("3005", "Solar Farm"),
          ("1035", "Residential 4 Family"), ("1010", "Residential 1 Family"), ("2061", "Office Condo"), ("4040", "Church/Religious")], 1)],
]

# --- Iredell: Land Use Codes (2019 Reappraisal schedule of values, chapter 4) ----------------------------
IREDELL = [
    row("097", objectid="1", parno="9900000001.000", altparno="9900A0001", ownname="EXAMPLE APARTMENTS LLC",
        improvval="2000000", landval="300000", parval="2300000", mailadd="1 SAMPLE LN", mcity="MOORESVILLE", mstate="NC",
        mzip="28117", siteadd="  1 SAMPLE LN ", gisacres="3.0", parusecode="0500", parusedesc="MULTI FAMILY"),
    row("097", objectid="2", parno="9900000002.000", altparno="9900A0002", ownname="EXAMPLE OFFICE LLC", improvval="800000",
        landval="200000", parval="1000000", siteadd="  2 SAMPLE LN ", gisacres="0.7", parusecode="0400", parusedesc="OFFICE"),
    row("097", objectid="3", parno="9900000003.000", altparno="9900A0003", ownname="EXAMPLE SHOPS INC", improvval="1200000",
        landval="300000", parval="1500000", siteadd="  3 SAMPLE LN ", gisacres="1.1", parusecode="0700", parusedesc="COMMERCIAL"),
    row("097", objectid="4", parno="9900000004.000", altparno="9900A0004", ownname="EXAMPLE PLANT CORP", improvval="9000000",
        landval="1000000", parval="10000000", siteadd="  4 SAMPLE LN ", gisacres="12", parusecode="0600", parusedesc="INDUSTRIAL"),
    row("097", objectid="5", parno="9900000005.000", altparno="9900A0005", ownname="EXAMPLE WAREHOUSE LLC", improvval="500000",
        landval="100000", parval="600000", siteadd="  5 SAMPLE LN ", parusecode="0647", parusedesc="WAREHOUSE CONDOMINIUM"),
    # commercial and multi-family land without improvements (the code has no vacant split) → dropped
    row("097", objectid="6", parno="9900000006.000", altparno="9900A0006", ownname="EXAMPLE LAND LLC", improvval="0",
        landval="2250", parval="2250", siteadd="  ISLE OF PINES RD ", parusecode="0500", parusedesc="MULTI FAMILY"),
    row("097", objectid="7", parno="9900000007.000", altparno="9900A0007", ownname="EXAMPLE LAND LLC", improvval="0",
        landval="90000", parval="90000", siteadd="  7 SAMPLE LN ", parusecode="0700", parusedesc="COMMERCIAL"),
    # out of scope: common area, duplex/triplex, parking, marina land, residential, institutional, farm
    *[row("097", objectid=str(10 + i), parno=f"99000001{i:02d}.000", altparno=f"99B{i:04d}", ownname="EXAMPLE LAND LLC",
          improvval="1000", landval="1000", parval="2000", siteadd=f"  {i} OUT ST ", parusecode=code, parusedesc=desc)
      for i, (code, desc) in enumerate([
          ("0501", "MULTI FAMILY COMMON AREA"), ("0562", "MULTI FAMILY DUPLEX/TRIPLEX"), ("0728", "PARKING"),
          ("0780", "MARINA LAND"), ("0100", "SINGLE FAMILY RESIDENTIAL"), ("7100", "CHURCHES"), ("6850", "FARM - M/FAM"),
          ("0300", "CONDOMINIUM"), ("0210", "MOBILE HOME PARK")], 1)],
]


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())


class Buncombe(Fixtures):
    def test_mapping(self):
        csv = write(self.tmp, "buncombe.csv", BUNCOMBE)
        recs = {r.apn: r for r in nc_onemap.read_roll(csv, "021")}
        self.assertEqual(sorted(recs), ["900000000100000", "900000000200000", "900000000300000", "900000000400000"],
                         "411 B, 464 F1, 710 F2, 440 F1 kept; park/camps/parking lot/442/439/land/residential/church/"
                         "quarry/multiple residences/blank and the Iredell row dropped")
        apts = recs["900000000100000"]
        self.assertEqual((apts.state_category, apts.local_use_code, apts.county_fips), ("B", "411", "021"))
        self.assertEqual(apts.account, "900000000100000")
        self.assertEqual(apts.situs_address, "10 EXAMPLE ST, NC", "double spaces squeezed; no situs city in the layer")
        self.assertEqual(apts.owner_mailing_address, "1 SAMPLE WAY, ASHEVILLE, NC 28801")
        self.assertEqual(apts.land_area_sf, round(3.5 * 43560, 2))
        self.assertEqual((apts.appraised_value, apts.market_value, apts.year_built), (5500000, None, None))
        self.assertEqual(apts.locator, "nc-parcels cntyfips 021 parno 900000000100000")
        self.assertEqual(recs["900000000200000"].state_category, "F1")
        self.assertEqual(recs["900000000300000"].state_category, "F2")
        self.assertEqual(recs["900000000300000"].owner_name, "DOE, JANE", "persons pass through; the registry drops them")
        self.assertEqual(recs["900000000400000"].state_category, "F1", "warehouse sits in the county's commercial block")

    def test_state_category(self):
        sc = lambda code: nc_onemap.state_category("021", code)  # noqa: E731
        for code in ("400", "405", "414", "421", "426", "433", "440", "450", "464", "466", "468", "480", "481", "492", "495"):
            self.assertEqual(sc(code), "F1", code)
        self.assertEqual(sc("411"), "B")
        for code in ("700", "701", "710"):
            self.assertEqual(sc(code), "F2", code)
        for code in ("416", "417", "438", "442", "439", "340", "341", "100", "101", "120", "121", "180", "300", "500",
                     "552", "620", "621", "650", "720", "721", "800", "", None):
            self.assertIsNone(sc(code), code)


class Gaston(Fixtures):
    def test_mapping(self):
        csv = write(self.tmp, "gaston.csv", GASTON)
        recs = {r.apn: r for r in nc_onemap.read_roll(csv, "071")}
        self.assertEqual(sorted(recs), ["9999-11-0001", "9999-11-0002", "9999-11-0003", "9999-11-0004"])
        apts = recs["9999-11-0001"]
        self.assertEqual((apts.state_category, apts.local_use_code, apts.account), ("B", "2100", "900001"))
        self.assertEqual(apts.situs_address, "1 SAMPLE AVE, GASTONIA CITY NC")
        self.assertEqual(apts.owner_mailing_address, "PO BOX 5, GASTONIA, NC 280520005")
        self.assertEqual(apts.year_built, 1983)
        self.assertEqual(apts.land_area_sf, round(2.5 * 43560, 2), "no recorded acreage → polygon acres")
        self.assertEqual(recs["9999-11-0002"].state_category, "F1")
        self.assertEqual(recs["9999-11-0003"].state_category, "F2")
        self.assertEqual(recs["9999-11-0004"].state_category, "F2")

    def test_state_category(self):
        sc = lambda code: nc_onemap.state_category("071", code)  # noqa: E731
        self.assertEqual(sc("2100"), "B")
        for code in ("2006", "2010", "2020", "2040", "2050", "2060", "2070", "2110", "2120", "2150", "2160", "2230", "2260", "2280"):
            self.assertEqual(sc(code), "F1", code)
        for code in ("3010", "3020", "3030", "3040", "3050", "3060"):
            self.assertEqual(sc(code), "F2", code)
        for code in ("2000", "2001", "2002", "2003", "2004", "2005", "2007", "2240", "2250", "3000", "3001", "3002", "3003",
                     "3004", "3005", "3006", "3007", "2061", "2155", "2270", "1010", "1030", "1035", "1050", "1060",
                     "4010", "4040", "9999", "", None):
            self.assertIsNone(sc(code), code)


class Iredell(Fixtures):
    def test_mapping(self):
        csv = write(self.tmp, "iredell.csv", IREDELL)
        recs = {r.apn: r for r in nc_onemap.read_roll(csv, "097")}
        self.assertEqual(sorted(recs), ["9900000001.000", "9900000002.000", "9900000003.000", "9900000004.000",
                                        "9900000005.000"],
                         "B, F1, F1, F2, F2 kept; land-only 0500 and 0700 rows (no improvements) and the "
                         "out-of-scope codes dropped")
        self.assertEqual(recs["9900000001.000"].state_category, "B")
        self.assertEqual(recs["9900000001.000"].local_use_code, "0500")
        self.assertEqual(recs["9900000001.000"].account, "9900A0001")
        self.assertEqual(recs["9900000001.000"].situs_address, "1 SAMPLE LN, NC", "padded street squeezed")
        self.assertEqual(recs["9900000002.000"].state_category, "F1", "OFFICE group")
        self.assertEqual(recs["9900000003.000"].state_category, "F1", "COMMERCIAL group")
        self.assertEqual(recs["9900000004.000"].state_category, "F2", "INDUSTRIAL group")
        self.assertEqual(recs["9900000005.000"].state_category, "F2", "warehouse condominium is listed under INDUSTRIAL")

    def test_state_category(self):
        sc = lambda code: nc_onemap.state_category("097", code)  # noqa: E731
        for code in ("0500", "0510", "0560", "0561", "0563"):
            self.assertEqual(sc(code), "B", code)
        for code in ("0400", "0419", "0424", "0431", "0700", "0701", "0711", "0716", "0722", "0723", "0735", "0739", "0765"):
            self.assertEqual(sc(code), "F1", code)
        for code in ("0600", "0628", "0641", "0647", "0648", "0652", "0657"):
            self.assertEqual(sc(code), "F2", code)
        for code in ("0501", "0562", "0728", "0780", "0100", "0200", "0210", "0300", "0309", "5000", "6850", "7000", "7100",
                     "8300", "9101", "", None):
            self.assertIsNone(sc(code), code)


class Wake(Fixtures):
    def test_wake_rules_through_the_statewide_module(self):
        sc = lambda code, cd2="": nc_onemap.state_category("183", code, cd2)  # noqa: E731
        self.assertEqual((sc("COM", "34"), sc("IND", "83"), sc("APT", "07")), ("F1", "F2", "B"))
        self.assertIsNone(sc("APT", "01"))
        self.assertIsNone(sc("RES"), "RES is not a Wake code")
        csv = write(self.tmp, "wake.csv", [row("183", objectid="1", parno="0700000001", altparno="0100001", parval="5000000",
                                                parusecode="COM", parusedesc="C", parusecd2="34")])
        (rec,) = nc_onemap.read_roll(csv, "183")
        self.assertEqual(rec.local_use_code, "COM/34", "Wake keeps the main-building code in the local code")


# --- Counties whose class is text in parusedesc (parusecode blank): Guilford, Forsyth, Cumberland, Johnston, New Hanover ------
def trow(fips, n, desc, improv="500000", **kw):
    return row(fips, objectid=str(n), parno=f"9{fips}{n:05d}", altparno=f"A{fips}{n:05d}", ownname=kw.pop("ownname", "EXAMPLE HOLDINGS LLC"),
               improvval=improv, parval="900000", siteadd=f"{n} SAMPLE ST", gisacres="1.5", parusecode="", parusedesc=desc, **kw)


class TextClasses(Fixtures):
    def cats(self, fips, descs, **kw):
        rows = [trow(fips, i, d, **kw) for i, d in enumerate(descs, 1)]
        return {r.local_use_code: r.state_category for r in nc_onemap.read_roll(write(self.tmp, f"{fips}.csv", rows), fips)}

    def test_guilford(self):
        got = self.cats("081", ["COMM", "OFFICE", "RETAIL", "HOTEL/MOTEL", "PETROL/GAS", "IND", "APART", "MULTI-FAMILY5>",
                                "MULTI-FAMILY<4", "RESIDENTIAL", "VACANT", "INSTITUTIONAL", "GOV OWNED", ""])
        self.assertEqual(got, {"COMM": "F1", "OFFICE": "F1", "RETAIL": "F1", "HOTEL/MOTEL": "F1", "PETROL/GAS": "F1",
                               "IND": "F2", "APART": "B", "MULTI-FAMILY5>": "B"})

    def test_forsyth(self):
        got = self.cats("067", ["2.01-Com Retail-WS", "2.02-Com Services", "2.03-Hotels-Lodging", "7.02-Office Park",
                                "7.03-Shopp Cntr-Mall", "4.01-Light Manuf", "4.02-Heavy Manuf", "7.01-Industrial Park",
                                "1.07-Apt Buildings", "1.06-MF Dwellings", "1.04-Quadraplex", "93.00-Vacant Com",
                                "3.04-Medical-HCFac", "1.01-SFD Dwelling"])
        self.assertEqual(sorted(got), sorted(x.upper() for x in ("1.07-Apt Buildings", "2.01-Com Retail-WS", "2.02-Com Services",
                                                                  "2.03-Hotels-Lodging", "4.01-Light Manuf", "4.02-Heavy Manuf",
                                                                  "7.01-Industrial Park", "7.02-Office Park", "7.03-Shopp Cntr-Mall")))
        self.assertEqual((got["1.07-APT BUILDINGS"], got["4.02-HEAVY MANUF"], got["7.02-OFFICE PARK"]), ("B", "F2", "F1"))

    def test_cumberland_prefixes(self):
        got = self.cats("051", ["A101-APART", "C101-COMMERC", "C300-OFFICE", "C358-SHOP/RE", "C454-STORAGE", "H104-HOTEL/M",
                                "I100-INDUSTR", "R101-RES", "F100-RURAL", "E100-EXEMPT", "M101-MH PARK", "U102-COMMUNI", ""])
        self.assertEqual(got, {"A101-APART": "B", "C101-COMMERC": "F1", "C300-OFFICE": "F1", "C358-SHOP/RE": "F1",
                               "C454-STORAGE": "F1", "H104-HOTEL/M": "F1", "I100-INDUSTR": "F2"})

    def test_johnston(self):
        got = self.cats("101", ["Commercial", "Office", "Warehouse", "Mini-Warehouses", "Light Manufacturing", "Garden Apartment",
                                "Restaurants", "Churches", "Vacant", "Single Family Residential", "Townhouse Apartment",
                                "Mobile Home Park", "Homes for Aged", "Duplex/Triplex"])
        self.assertEqual(got, {"COMMERCIAL": "F1", "OFFICE": "F1", "WAREHOUSE": "F2", "MINI-WAREHOUSES": "F1",
                               "LIGHT MANUFACTURING": "F2", "GARDEN APARTMENT": "B", "RESTAURANTS": "F1"})

    def test_new_hanover_and_the_improvement_test(self):
        got = self.cats("129", ["Commercial", "Industrial", "Apartment", "Residential", "Exempt Governmental", "Homeowners Association"])
        self.assertEqual(got, {"COMMERCIAL": "F1", "INDUSTRIAL": "F2", "APARTMENT": "B"})
        self.assertEqual(self.cats("129", ["Commercial", "Apartment"], improv="0"), {}, "land only: dropped")

    def test_record_fields(self):
        rows = [trow("081", 1, "APART", mailadd="1 OWNER WAY", mcity="GREENSBORO", mstate="NC", mzip="27401")]
        (rec,) = nc_onemap.read_roll(write(self.tmp, "g.csv", rows), "081")
        self.assertEqual((rec.county_fips, rec.apn, rec.account, rec.state_category), ("081", "908100001", "A08100001", "B"))
        self.assertEqual(rec.owner_mailing_address, "1 OWNER WAY, GREENSBORO, NC 27401")
        self.assertEqual(nc_onemap.source("081").source_id, "nc-onemap-guilford")


class Table(unittest.TestCase):
    def test_counties_and_source_ids(self):
        self.assertEqual(sorted(nc_onemap.COUNTIES), ["021", "051", "067", "071", "081", "097", "101", "129", "183"])
        ids = [c.source_id for c in nc_onemap.COUNTIES.values()]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(nc_onemap.COUNTIES["183"].source_id, "nc-wake-parcels", "Wake keeps its own source id")
        for c in nc_onemap.COUNTIES.values():
            self.assertTrue(c.definitions_url.startswith("https://"), c.name)
            self.assertTrue(set(c.categories.values()) <= {"B", "F1", "F2"}, c.name)

    def test_counties_without_a_table(self):
        for fips in ("119", "063", "179", "025", "133"):
            with self.assertRaises(KeyError, msg=fips):
                nc_onemap.state_category(fips, "COM")
        self.assertEqual(nc_onemap.county_map("37021").name, "Buncombe", "5-digit codes are accepted")

    def test_where_clause_and_download_url(self):
        w = nc_onemap.COUNTIES["071"].where()
        self.assertTrue(w.startswith("cntyfips='071' AND parusecode IN ('2006',"))
        self.assertIn("'2100'", w)
        self.assertNotIn("'2000'", w)
        self.assertNotIn("improvval", w)
        self.assertTrue(nc_onemap.COUNTIES["097"].where().endswith(" AND improvval>0"))
        guilford = nc_onemap.COUNTIES["081"].where()
        self.assertTrue(guilford.startswith("cntyfips='081' AND parusedesc IN ('APART',"), guilford)
        self.assertEqual(nc_onemap.COUNTIES["051"].where(),
                         "cntyfips='051' AND (parusedesc LIKE 'A%' OR parusedesc LIKE 'C%' OR parusedesc LIKE 'H%' OR "
                         "parusedesc LIKE 'I%') AND improvval>0")
        url = nc_onemap.COUNTIES["021"].hub_url()
        self.assertTrue(url.startswith(nc_onemap.HUB_DOWNLOAD))
        self.assertEqual(unquote(url[len(nc_onemap.HUB_DOWNLOAD):]), nc_onemap.COUNTIES["021"].where())


class Build(Fixtures):
    def test_build_registry_per_county(self):
        db = self.tmp / "registry.db"
        for fips, name, rows, kept, persons, urn, account_system, account in (
            ("021", "buncombe.csv", BUNCOMBE, 4, 1, "fl:parcel:us-37021:900000000100000", "buncombe_pin", "900000000100000"),
            ("071", "gaston.csv", GASTON, 4, 1, "fl:parcel:us-37071:9999-11-0001", "gaston_altparno", "900001"),
            ("097", "iredell.csv", IREDELL, 5, 0, "fl:parcel:us-37097:9900000001-000", "iredell_altparno", "9900A0001"),
        ):
            stats = nc_onemap.build(write(self.tmp, name, rows), db, fips, as_of="2026-05-07")
            self.assertEqual((stats.kept, stats.skipped_invalid), (kept, 0), fips)
            self.assertEqual(stats.owners_person_or_withheld, persons, fips)
            reg = Registry.open_readonly(db)
            try:
                src = reg.db.execute("SELECT * FROM sources WHERE source_id = ?",
                                     (nc_onemap.COUNTIES[fips].source_id,)).fetchone()
                self.assertEqual((src["state_fips"], src["county_fips"]), ("37", fips))
                found = reg.db.execute("SELECT urn FROM crosswalk WHERE system = ? AND external_id = ?",
                                       (account_system, account)).fetchone()
                self.assertIsNotNone(found, f"{fips}: crosswalk row {account_system} {account}")
                self.assertEqual(found[0], urn)
            finally:
                reg.close()

    def test_natural_person_owner_is_not_stored(self):
        # a parcel number's hyphens and dots become hyphens in the parcel URN (9999-11-0003 → 9999-11-0003)
        db = self.tmp / "registry.db"
        nc_onemap.build(write(self.tmp, "gaston.csv", GASTON), db, "071", as_of="2026-05-07")
        reg = Registry.open_readonly(db)
        try:
            n = reg.db.execute(
                "SELECT COUNT(*) FROM current_facts WHERE subject = 'fl:parcel:us-37071:9999-11-0003' "
                "AND predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(n, 0)
            org = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = 'fl:parcel:us-37071:9999-11-0002' "
                "AND predicate = 'ownership.owner_of_record'").fetchone()
            self.assertIn("EXAMPLE OFFICE LLC", org[0])
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
