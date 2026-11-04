"""SEC CMBS asset data (Form ABS-EE, Exhibit 102) adapter tests on SYNTHETIC files that copy the published layout.

Every trust, loan, address, tenant and figure here is invented, and the "Census" files are tiny tables written for the
test (real county codes, invented ZIP-code areas). Nothing is SEC or Census data.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.facts import validate_fact
from factlot.registry import ParcelRecord, Registry
from factlot.registry.adapters import sec_cmbs as sc

NS = "http://www.sec.gov/edgar/document/absee/cmbs/assetdata"

COUNTIES = """STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT
TX|48|201|1|Harris County|H1|A
TX|48|113|2|Dallas County|H1|A
MO|29|189|3|St. Louis County|H1|A
MO|29|510|4|St. Louis city|C7|F
NY|36|061|5|New York County|H6|A
MA|25|017|6|Middlesex County|H1|A
"""
ZCTA_HEAD = ("OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|"
             "CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_COUNTY_20|GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|"
             "AREAWATER_COUNTY_20|MTFCC_COUNTY_20|CLASSFP_COUNTY_20|FUNCSTAT_COUNTY_20|AREALAND_PART|AREAWATER_PART")


def zrow(zcta: str, county: str, land: int) -> str:
    return f"1|{zcta}|ZCTA5 {zcta}|100|0|G6350|B5|S|2|{county}|County|100|0|G4020|H1|A|{land}|0"


ZCTA = "\n".join([
    "﻿" + ZCTA_HEAD,
    "||||||||27590114112812|01003|Baldwin County|1|1|G4020|H1|A|5|5",  # the part of a county in no ZCTA: skipped
    zrow("77002", "48201", 1000), zrow("77002", "48113", 3),  # 0.3% in Dallas: a sliver
    zrow("63104", "29510", 1000),  # a ZCTA inside St. Louis city
    zrow("75999", "48113", 600), zrow("75999", "48201", 400),  # synthetic ZCTA in two counties
    zrow("75998", "48113", 970), zrow("75998", "48201", 30),  # 97% Dallas
    zrow("10001", "36061", 500),
    zrow("02141", "25017", 500),
]) + "\n"


def locator(tmp: Path) -> sc.CountyLocator:
    (tmp / "counties.txt").write_text(COUNTIES, encoding="utf-8")
    (tmp / "zcta.txt").write_text(ZCTA, encoding="utf-8")
    return sc.CountyLocator.from_files(tmp / "zcta.txt", tmp / "counties.txt")


def prop(name="Example Tower", address="300 Main Street", city="Houston", state="TX", zip_="77002", county="Harris",
         ptype="OF", **kw) -> str:
    fields = {"propertyName": name, "propertyAddress": address, "propertyCity": city, "propertyState": state,
              "propertyZip": zip_, "propertyCounty": county, "propertyTypeCode": ptype,
              "netRentableSquareFeetNumber": 120000, "yearBuiltNumber": 1990,
              "physicalOccupancySecuritizationPercentage": ".92000000", "mostRecentPhysicalOccupancyPercentage": ".88500000",
              "netOperatingIncomeSecuritizationAmount": "7000000.00", "mostRecentNetOperatingIncomeAmount": "6500000.50",
              "debtServiceCoverageNetOperatingIncomeSecuritizationPercentage": "1.80000000",
              "mostRecentDebtServiceCoverageNetOperatingIncomePercentage": "1.65000000",
              "mostRecentFinancialsStartDate": "01-01-2025", "mostRecentFinancialsEndDate": "12-31-2025",
              "propertyStatusCode": "6", "DefeasedStatusCode": "N", "largestTenant": "Acme Widgets LLC",
              "squareFeetLargestTenantNumber": 40000, "leaseExpirationLargestTenantDate": "06-30-2031",
              "secondLargestTenant": "Jane Q Example", "thirdLargestTenant": "Zed Stores"}
    fields.update(kw)
    return "<property>" + "".join(f"<{k}>{v}</{k}>" for k, v in fields.items() if v is not None) + "</property>"


def loan(number, props, *, balance="10000000.00", status="0", transfer=None, returned=None, workout=None, rate=".05250000",
         period=("09-12-2026", "10-13-2026"), maturity="11-06-2031", servicer="Example Servicing Bank", structure="WL") -> str:
    fields = {"assetTypeNumber": "Prospectus Loan ID", "assetNumber": number, "reportingPeriodBeginningDate": period[0],
              "reportingPeriodEndDate": period[1], "originatorName": "Example Mortgage Originator LLC",
              "originationDate": "10-14-2021", "originalLoanAmount": "12000000.00000000", "originalTermLoanNumber": 120,
              "maturityDate": maturity, "originalAmortizationTermNumber": 360, "interestOnlyIndicator": "false",
              "paymentTypeCode": "2", "loanStructureCode": structure, "NumberProperties": len(props),
              "reportPeriodInterestRatePercentage": rate, "reportPeriodEndScheduledLoanBalanceAmount": balance,
              "reportPeriodEndActualBalanceAmount": balance, "paymentStatusLoanCode": status,
              "primaryServicerName": servicer, "modifiedIndicator": "false"}
    if transfer:
        fields["mostRecentSpecialServicerTransferDate"] = transfer
    if returned:
        fields["mostRecentMasterServicerReturnDate"] = returned
    if workout:
        fields["workoutStrategyCode"] = workout
    head = "".join(f"<{k}>{v}</{k}>" for k, v in fields.items())
    return f"<assets>{head}{''.join(props)}</assets>"


def exhibit(*loans: str, ns: str = NS) -> str:
    return f'<?xml version="1.0" encoding="utf-8"?>\n<assetData xmlns="{ns}">{"".join(loans)}</assetData>'


class TestReading(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def write(self, text: str, name="exh_102.xml") -> Path:
        p = self.tmp / name
        p.write_text(text, encoding="utf-8")
        return p

    def test_loans_and_properties_are_read(self):
        p = self.write(exhibit(loan("1", [prop(), prop(name="Annex", address="302 Main Street")]), loan("2", [prop()])))
        loans = list(sc.read_loans(p))
        self.assertEqual([l.number for l in loans], [1, 2])
        self.assertEqual(len(loans[0].properties), 2)
        self.assertEqual(loans[0].fields["assetNumber"], "1")
        self.assertEqual(loans[0].properties[1]["propertyName"], "Annex")

    def test_a_doctype_or_the_wrong_namespace_is_refused(self):
        bad = self.write('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]>' + exhibit(), "bad.xml")
        with self.assertRaises(ValueError):
            list(sc.read_loans(bad))
        auto = self.write(exhibit(loan("1", []), ns="http://www.sec.gov/edgar/document/absee/autoloan/assetdata"), "auto.xml")
        with self.assertRaises(ValueError):
            list(sc.read_loans(auto))

    def test_number_and_date_readers(self):
        self.assertEqual(sc._pct(sc._dec(".05250000")), 5.25)
        self.assertEqual(sc._pct(sc._dec("1.00000000")), 100)
        self.assertEqual(sc._num(sc._dec("12000000.00000000")), 12000000)
        self.assertEqual(sc._num(sc._dec("6500000.505")), 6500000.5)
        self.assertEqual(sc._date("02-29-2028"), "2028-02-29")
        self.assertIsNone(sc._date("02-30-2027"))
        self.assertIsNone(sc._dec("not a number"))


class TestCountyLocator(unittest.TestCase):
    def setUp(self):
        self.loc = locator(Path(tempfile.mkdtemp()))

    def test_a_zip_code_area_in_one_county_decides(self):
        p, why = self.loc.locate("TX", "77002", "Harris")
        self.assertEqual((p.state_fips, p.county_fips, p.method), ("48", "201", "zip_code_area+county_name"), why)
        p, _ = self.loc.locate("TX", "77002-1234", None)  # ZIP+4; the 0.3% Dallas sliver is ignored
        self.assertEqual((p.county_fips, p.method), ("201", "zip_code_area"))

    def test_the_zip_code_beats_a_county_name_that_names_another_county(self):
        # the filing says "St. Louis" (the county), the ZIP code area lies in St. Louis city
        p, _ = self.loc.locate("MO", "63104", "St. Louis")
        self.assertEqual((p.county_fips, p.method), ("510", "zip_code_area_county_name_differs"))
        self.assertEqual(self.loc.conflicts, 1)
        p, _ = self.loc.locate("MO", "63104", "St. Louis City")
        self.assertEqual((p.county_fips, p.method), ("510", "zip_code_area+county_name"))

    def test_a_zip_code_area_in_two_counties_needs_the_name_or_a_clear_majority(self):
        p, _ = self.loc.locate("TX", "75999", "Harris County")
        self.assertEqual((p.county_fips, p.method), ("201", "county_name_in_zip_code_area"))
        p, why = self.loc.locate("TX", "75999", None)
        self.assertIsNone(p)
        self.assertEqual(why, "zip_code_in_several_counties")
        p, why = self.loc.locate("TX", "75999", "Travis")  # a county that is not one of the area's
        self.assertEqual(why, "zip_code_in_several_counties")
        p, _ = self.loc.locate("TX", "75998", None)
        self.assertEqual((p.county_fips, p.method), ("113", "zip_code_area_majority"))

    def test_a_four_digit_zip_gets_its_leading_zero_and_no_zip_falls_back_to_the_county_name(self):
        p, _ = self.loc.locate("MA", "2141", "Middlesex")
        self.assertEqual((p.state_fips, p.county_fips), ("25", "017"))
        p, _ = self.loc.locate("TX", None, "Dallas")
        self.assertEqual((p.county_fips, p.method), ("113", "county_name"))
        self.assertEqual(self.loc.locate("TX", None, None)[1], "no_zip_code_and_no_county")
        self.assertEqual(self.loc.locate("TX", "00000", None)[1], "no_zip_code_area_or_county")
        self.assertEqual(self.loc.locate("ON", "N7M1X3", None)[1], "no_state")
        # a ZIP code area in another state than the property's is not used
        self.assertEqual(self.loc.locate("NY", "77002", None)[1], "no_zip_code_area_or_county")

    def test_county_names(self):
        self.assertEqual(sc.county_key("St. Louis County"), "SAINT LOUIS")
        self.assertEqual(sc.county_key("St. Louis city"), "SAINT LOUIS CITY")
        self.assertEqual(sc.county_key("Doña Ana County"), "DONA ANA")
        self.assertEqual(sc.county_key("Anchorage Municipality"), "ANCHORAGE")

    def test_street_lines(self):
        self.assertEqual(sc.street_line("48371, 48377, 48383 & 48389 FREMONT BOULEVARD"), ("48371 FREMONT BOULEVARD", True))
        self.assertEqual(sc.street_line("1822, 1824 AND 1830 112TH STREET EAST"), ("1822 112TH STREET EAST", True))
        self.assertEqual(sc.street_line("9449, 9469 RICHMOND PLACE, 9450 BUFFALO AVENUE"), ("9449 RICHMOND PLACE", True))
        self.assertEqual(sc.street_line("11202,11208 El Camino Real"), ("11202 El Camino Real", True))
        self.assertEqual(sc.street_line("300 Main Street, Suite 4"), ("300 Main Street, Suite 4", False))
        self.assertEqual(sc.street_line("1801-1835 La Cienega Blvd"), ("1801-1835 La Cienega Blvd", False))
        self.assertEqual(sc.street_line("7425-7719 EAST ILIFF AVENUE; 2150 SOUTH QUEBEC STREET"),
                         ("7425-7719 EAST ILIFF AVENUE", True))
        self.assertEqual(sc.street_line("131 Orchard Street a/k/a 130 Allen Street"), ("131 Orchard Street", True))


class TestBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.loc = locator(self.tmp)
        self.db = self.tmp / "registry.db"

    def write(self, name: str, text: str) -> Path:
        p = self.tmp / name
        p.write_text(text, encoding="utf-8")
        return p

    def run_build(self, xml: Path, trust="Example 2026-C1 Mortgage Trust", cik=1900001, accession="0001900001-26-000001",
                  recurring=frozenset(), unplaced=None, link=True):
        return sc.build(xml, self.db, trust=trust, cik=cik, accession=accession, locator=self.loc,
                        recurring_tenants=recurring, unplaced_log=unplaced, link=link, retrieved_at="2026-11-04T00:00:00+00:00")

    def facts(self, urn, predicate=sc.PREDICATE):
        reg = Registry.open_readonly(self.db)
        try:
            return [f for f in reg.facts(urn) if f["predicate"] == predicate]
        finally:
            reg.close()

    URN = "fl:building:us-48201:77002:300-main-st"

    def basic(self):
        return self.write("exh1.xml", exhibit(
            loan("1", [prop()], transfer="08-05-2026", workout="2", status="3"),
            loan("2", [prop(name="Park Apts", address="9 Park Lane", ptype="MF", largestTenant=None, secondLargestTenant=None,
                            thirdLargestTenant=None)], balance="5000000.00"),
            loan("3", [prop(name="A and B", address="1 Oak Road", city="Dallas", zip_="75998", county="Dallas"),
                       prop(name="Defeased", address=None, city=None, state="NA", zip_=None, county=None, ptype="SE"),
                       prop(name="Unknown use", address="2 Oak Road", ptype="98"),
                       prop(name="No ZIP", address="3 Oak Road", zip_=None, county=None, state="TX"),
                       prop(name="Portfolio", address="Various", zip_="77002", county="Harris")]),
        ))

    def test_loan_facts_land_on_the_building_id(self):
        log: list = []
        stats = self.run_build(self.basic(), unplaced=log)
        self.assertEqual((stats.loans, stats.properties), (3, 7))
        self.assertEqual(stats.facts, 3)
        self.assertEqual(stats.buildings, 3)
        self.assertEqual(stats.placeholder_property, 1)  # "Defeased": no address, state NA
        self.assertEqual(dict(stats.out_of_scope_type), {"Other": 1})
        self.assertEqual(dict(stats.unplaced), {"no_zip_code_and_no_county": 1, "street_without_house_number": 1})
        self.assertEqual({u["reason"] for u in log}, {"no_zip_code_and_no_county", "street_without_house_number"})
        (fact,) = self.facts(self.URN)
        self.assertEqual(fact["as_of"], "2026-10-13")
        self.assertEqual(fact["provenance"]["method"], "public_record")
        self.assertIn("exh1.xml", fact["provenance"]["sources"][0]["title"])
        self.assertEqual(fact["provenance"]["sources"][0]["section"], "0001900001-26-000001 exh1.xml asset 1 property 1")
        self.assertEqual(fact["rights"]["redistribution"], "permitted")
        v = fact["value"]
        self.assertEqual((v["current_balance_usd"], v["original_balance_usd"], v["interest_rate_pct"]), (10000000, 12000000, 5.25))
        self.assertEqual(v["maturity_date"], "2031-11-06")
        self.assertEqual(v["payment_status"], {"code": "3", "description": "90+ days delinquent"})
        self.assertEqual(v["workout_strategy"], {"code": "2", "description": "Foreclosure"})
        self.assertEqual(v["special_servicer_transfer_date"], "2026-08-05")
        self.assertIs(v["specially_serviced"], True)
        self.assertEqual(v["loan_structure"]["code"], "WL")
        self.assertEqual(v["primary_servicer"], "Example Servicing Bank")
        self.assertEqual(v["trust"], "Example 2026-C1 Mortgage Trust")
        self.assertEqual(v["trust_cik"], "0001900001")
        p = v["property"]
        self.assertEqual((p["occupancy_pct"], p["occupancy_at_securitization_pct"]), (88.5, 92))
        self.assertEqual((p["noi_usd"], p["dscr_noi"], p["dscr_noi_at_securitization"]), (6500000.5, 1.65, 1.8))
        self.assertEqual(p["type"], {"code": "OF", "description": "Office"})
        self.assertEqual(p["financials_period_end"], "2025-12-31")
        self.assertEqual(v["placement"], {"state_fips": "48", "county_fips": "201", "method": "zip_code_area+county_name"})
        self.assertNotIn("watchlist", str(v).lower())
        # the registry fact passes the FactLot validator
        self.assertTrue(validate_fact(fact)["valid"], validate_fact(fact))

    def test_the_building_label_matches_the_roll_up_label(self):
        self.run_build(self.basic())
        reg = Registry.open_readonly(self.db)
        try:
            rec = reg.get(self.URN)
        finally:
            reg.close()
        self.assertEqual(rec["kind"], "building")
        self.assertEqual(rec["label"], "300 MAIN ST, TX 77002")
        self.assertEqual(rec["building"]["parcel_count"], 0)

    def test_tenants_keep_organisations_and_recurring_chains_and_drop_people(self):
        stats = self.run_build(self.basic(), recurring=frozenset({sc.tenant_key("Zed Stores")}))
        (fact,) = self.facts(self.URN)
        names = [t["name"] for t in fact["value"]["property"]["largest_tenants"]]
        self.assertEqual(names, ["Acme Widgets LLC", "Zed Stores"])  # "Jane Q Example" is not an organisation
        self.assertNotIn("Jane Q Example", str(fact))
        self.assertEqual((stats.tenants_kept, stats.tenants_kept_recurring, stats.tenants_dropped), (4, 2, 2))

    def test_without_the_recurring_set_a_bare_brand_name_is_dropped(self):
        self.run_build(self.basic())
        (fact,) = self.facts(self.URN)
        self.assertEqual([t["name"] for t in fact["value"]["property"]["largest_tenants"]], ["Acme Widgets LLC"])

    def test_reingesting_changes_nothing_and_a_newer_month_replaces_the_current_facts(self):
        first = self.basic()
        self.run_build(first)
        again = self.run_build(first)
        self.assertEqual(again.ingest.facts_written, 0)
        # next month: the loan is paid down, the second loan has paid off
        nxt = self.write("exh2.xml", exhibit(
            loan("1", [prop()], balance="9900000.00", period=("10-13-2026", "11-12-2026"), transfer="08-05-2026",
                 returned="10-20-2026"),
            loan("3", [prop(name="A and B", address="1 Oak Road", city="Dallas", zip_="75998", county="Dallas")])))
        stats = self.run_build(nxt, accession="0001900001-26-000009")
        self.assertEqual(stats.ingest.retired, 1)  # 9 Park Lane is no longer in the trust's report
        (fact,) = self.facts(self.URN)
        self.assertEqual(fact["value"]["current_balance_usd"], 9900000)
        self.assertEqual(fact["as_of"], "2026-11-12")
        self.assertIs(fact["value"]["specially_serviced"], False)  # returned to the master servicer after the transfer
        self.assertEqual(self.facts("fl:building:us-48201:77002:9-park-ln"), [])
        reg = Registry.open_readonly(self.db)
        try:
            self.assertEqual(len([f for f in reg.facts(self.URN, history=True) if f["predicate"] == sc.PREDICATE]), 2)
        finally:
            reg.close()

    def test_two_trusts_holding_notes_of_one_building_keep_both_facts_newest_first(self):
        a = self.write("a.xml", exhibit(loan("7", [prop()], balance="30000000.00", structure="PP")))
        b = self.write("b.xml", exhibit(loan("2", [prop()], balance="20000000.00", structure="PP",
                                             period=("10-01-2026", "11-02-2026"))))
        self.run_build(a, trust="Example 2026-C1 Mortgage Trust", cik=1900001)
        self.run_build(b, trust="Other 2026-C2 Mortgage Trust", cik=1900002, accession="0001900002-26-000001")
        facts = self.facts(self.URN)
        self.assertEqual([f["value"]["trust"] for f in facts], ["Other 2026-C2 Mortgage Trust", "Example 2026-C1 Mortgage Trust"])
        self.assertEqual([f["value"]["current_balance_usd"] for f in facts], [20000000, 30000000])

    def test_a_list_of_house_numbers_is_placed_at_the_first_one(self):
        x = self.write("x.xml", exhibit(loan("1", [prop(address="300, 302 &amp; 304 Main Street")])))
        stats = self.run_build(x)
        self.assertEqual((stats.street_reduced, stats.buildings), (1, 1))
        (fact,) = self.facts(self.URN)
        self.assertEqual(fact["value"]["property"]["address"], "300, 302 & 304 Main Street")  # as filed
        self.assertEqual(fact["value"]["placement"]["address_used"], "300 Main Street")

    def roll(self, parcels):
        reg = Registry(self.db)
        reg.add_source(sc.Source("test-roll", "Example County (synthetic)", "Roll", "https://example.invalid", "48",
                                 county_fips="201", license="Synthetic", ai_use="permitted", redistribution="permitted"))
        p = self.tmp / "roll.txt"
        p.write_text("synthetic roll")
        snap = reg.add_snapshot("test-roll", p, "2026-07-01")
        reg.ingest_parcels(parcels, snap, state_fips="48")
        reg.close()

    def test_a_building_links_to_the_one_registry_parcel_at_its_address(self):
        self.roll([
            ParcelRecord("201", "0001", "F1", situs_address="300 MAIN ST STE 100, HOUSTON TX 77002", owner_name="Example Holdings LLC"),
            ParcelRecord("201", "0003", "F1", situs_address="9 Park Lane, Houston TX 77002"),
            ParcelRecord("201", "0004", "F1", situs_address="400 Other Street, Houston TX 77002"),
        ])
        stats = self.run_build(self.basic())
        self.assertEqual((stats.parcels_linked, stats.buildings_with_parcels, stats.buildings_with_several_parcels), (2, 2, 0))
        reg = Registry.open_readonly(self.db)
        try:
            rec = reg.get(self.URN)
            (link,) = [r for r in rec["relationships"] if r["type"] == "located_on"]
            self.assertEqual((link["to_urn"], link["method"], link["confidence"]), ("fl:parcel:us-48201:0001", "inferred", 0.8))
            parcel = reg.get("fl:parcel:us-48201:0001")
            self.assertEqual([r["from_urn"] for r in parcel["relationships"] if r["type"] == "located_on"], [self.URN])
            self.assertIsNone(reg.get("fl:parcel:us-48201:0004")["building"])
        finally:
            reg.close()
        # linking again leaves one link per building
        again = Registry(self.db)
        sc.link_parcels(again)
        again.close()
        reg = Registry.open_readonly(self.db)
        try:
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM relationships WHERE type = 'located_on'").fetchone()[0], 2)
        finally:
            reg.close()

    def test_numbered_streets_match_with_and_without_the_ordinal_suffix(self):
        self.roll([ParcelRecord("201", "0001", "F1", situs_address="23 WEST 68 STREET, HOUSTON TX 77002"),
                   ParcelRecord("201", "0002", "F1", situs_address="110 4 AVENUE, HOUSTON TX 77002"),
                   ParcelRecord("201", "0003", "F1", situs_address="5 ST MARKS PL, HOUSTON TX 77002")])
        x = self.write("ord.xml", exhibit(loan("1", [prop(address="23 W 68th Street")]), loan("2", [prop(address="110 4th Avenue")]),
                                          loan("3", [prop(address="5 St Marks Place")])))
        stats = self.run_build(x)
        self.assertEqual(stats.parcels_linked, 3)  # "5 ST MARKS PL" keeps its first word: a house number is never an ordinal
        self.assertEqual(sc.ordinal_street("23 WEST 68 STREET"), "23 WEST 68th STREET")
        self.assertEqual(sc.ordinal_street("5 ST MARKS PL"), "5 ST MARKS PL")
        self.assertEqual(sc.ordinal_street("12 EAST 22 STREET #4"), "12 EAST 22nd STREET #4")

    def test_several_parcels_reached_only_through_the_ordinal_reading_are_linked(self):
        self.roll([ParcelRecord("201", "0001", "F1", situs_address="23 WEST 68 STREET UNIT 1, HOUSTON TX 77002"),
                   ParcelRecord("201", "0002", "F1", situs_address="23 WEST 68 STREET UNIT 2, HOUSTON TX 77002")])
        stats = self.run_build(self.write("ord2.xml", exhibit(loan("1", [prop(address="23 W 68th Street")]))))
        self.assertEqual((stats.parcels_linked, stats.buildings_with_parcels, stats.buildings_with_several_parcels), (2, 1, 0))

    def test_a_building_with_several_parcels_is_left_to_the_roll_up(self):
        self.roll([ParcelRecord("201", f"U{n:03d}", "F1", situs_address=f"300 Main Street Unit {n}, Houston TX 77002")
                   for n in range(3)])
        stats = self.run_build(self.basic())
        self.assertEqual((stats.parcels_linked, stats.buildings_with_several_parcels), (0, 1))
        reg = Registry(self.db)
        reg.rollup_buildings()
        reg.close()
        reg = Registry.open_readonly(self.db)
        try:
            rec = reg.get(self.URN)  # the roll-up made this very building subject, now holding both the parcels and the loan
            self.assertEqual(rec["building"]["parcel_count"], 3)
            self.assertEqual(len([f for f in rec["facts"] if f["predicate"] == sc.PREDICATE]), 1)
        finally:
            reg.close()

    def test_only_loans_in_the_trust_at_period_end_become_facts(self):
        def row(number, balance=None, begin=None, secbal=None, **extra):
            """A loan row with the balance fields given (None leaves the element out), as the files list old loans."""
            xml = loan(number, [prop(address=f"{number} Elm Street")], balance=balance or "0.00")
            for tag, v in (("reportPeriodEndScheduledLoanBalanceAmount", balance), ("reportPeriodBeginningScheduleLoanBalanceAmount", begin),
                           ("scheduledPrincipalBalanceSecuritizationAmount", secbal)):
                xml = xml.replace(f"<{tag}>0.00</{tag}>", "") if v is None else xml
                if v is not None and f"<{tag}>" not in xml:
                    xml = xml.replace("</assets>", f"<{tag}>{v}</{tag}></assets>").replace("<property>", "<property>", 1)
            for tag, v in extra.items():
                xml = xml.replace("<property>", f"<{tag}>{v}</{tag}><property>", 1)
            return xml
        x = self.write("old.xml", exhibit(
            row("11", balance="9000000.00", begin="9100000.00", secbal="10000000.00"),  # outstanding
            row("12", balance="0.00", begin="0.00", secbal="5000000.00"),  # left the trust earlier, still listed
            row("13", balance="0.00", begin="4000000.00", secbal="5000000.00", liquidationPrepaymentCode="2",
                liquidationPrepaymentDate="10-02-2026"),  # paid off during the period
            row("14"),  # a bare row: no balance at all
            row("15", secbal="7000000.00"),  # the trust's first report: only the balance at securitization
        ))
        stats = self.run_build(x)
        self.assertEqual((stats.loans, stats.loans_not_in_trust, stats.loans_paid_off_in_period, stats.facts), (5, 2, 1, 3))
        by = {f["value"]["loan_id"]: f["value"] for urn in ("11", "13", "15")
              for f in self.facts(f"fl:building:us-48201:77002:{urn}-elm-st")}
        self.assertEqual(by["11"]["current_balance_usd"], 9000000)
        self.assertEqual(by["11"]["balance_at_securitization_usd"], 10000000)
        self.assertNotIn("paid_off_in_period", by["11"])
        self.assertEqual((by["13"]["current_balance_usd"], by["13"]["paid_off_in_period"]), (0, True))
        self.assertEqual(by["13"]["liquidation_prepayment"], {"code": "2", "description": "Payoff Prior to Maturity"})
        self.assertEqual(by["13"]["liquidation_prepayment_date"], "2026-10-02")
        self.assertNotIn("current_balance_usd", by["15"])
        self.assertEqual(by["15"]["balance_at_securitization_usd"], 7000000)

    def test_a_missing_reporting_period_needs_as_of(self):
        text = exhibit(loan("1", [prop()])).replace("<reportingPeriodEndDate>10-13-2026</reportingPeriodEndDate>", "")
        with self.assertRaises(ValueError):
            sc.build(self.write("nodate.xml", text), self.db, trust="T", cik=1, accession="0000000001-26-000001", locator=self.loc)


if __name__ == "__main__":
    unittest.main()
