"""Building energy benchmarking adapter tests (NYC Local Law 84, DC) on a SYNTHETIC fixture with the real layouts.

Every BBL, SSL, property ID and figure here is invented to exercise the mapping; none is real benchmarking data.
Layouts: the NYC Open Data CSV (Socrata export) of dataset 5zyy-y8am with the adapter's ``$select``, and the ArcGIS
``query`` response (``f=json``) of DC GIS layer 45 with the adapter's ``outFields``.
"""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import ParcelRecord, Registry
from factlot.registry.adapters import energy_benchmark as eb
from factlot.registry.adapters import ny_nyc


def nyc_csv(rows):
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL)
    w.writerow(eb.NYC_COLUMNS)
    for r in rows:
        w.writerow([r.get(c, "") for c in eb.NYC_COLUMNS])
    return out.getvalue()


def nyc(year, pid, bbl, eui, **kw):
    return dict(report_year=str(year), property_id=pid, nyc_borough_block_and_lot=bbl, primary_property_type=kw.get("type", "Office"),
                year_ending=f"{year}-12-31T00:00:00.000", site_eui_kbtu_ft=str(eui), weather_normalized_site_eui=kw.get("wn", "50.1"),
                source_eui_kbtu_ft=kw.get("src", "120.5"), energy_star_score=kw.get("score", "75"),
                total_location_based_ghg=kw.get("ghg", "2610.8"), total_location_based_ghg_1=kw.get("gi", "3.8"),
                property_gfa_calculated=kw.get("gfa", "686838"), number_of_buildings="1")


NYC_ROWS = [
    nyc(2022, "9001", "1000090001", 60.0), nyc(2023, "9001", "1000090001", 55.5, score="Not Available", wn="Not Available"),
    nyc(2024, "9001", "1000090001", "Not Available"),  # the newest year has no usable report: 2023 stands
    nyc(2024, "9002", "3001230045 ; 3001230046", 40.25, type="Multifamily Housing", gfa="76846"),  # one property, two lots
    nyc(2024, "9003", "4005670089", 30), nyc(2024, "9004", "4005670089", 31),  # two properties on one lot
    nyc(2024, "9005", "1000090002, 1000090003", 0),  # zero EUI: not usable
    nyc(2024, "9006", "9999999999", 10),  # not a BBL
    nyc(2024, "9007", "2034560012", 12.5),  # a lot the registry does not hold
]


class TestNyc(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.csv = self.dir / "ll84.csv"
        self.csv.write_text(nyc_csv(NYC_ROWS))
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        reg.add_source(ny_nyc.SOURCE)
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic roll")
        snap = reg.add_snapshot("ny-nyc-dof", roll, as_of="2026-05-15")
        reg.ingest_parcels([
            ParcelRecord("061", "1000090001", "F1", account="1000090001"), ParcelRecord("047", "3001230045", "B", account="3001230045"),
            ParcelRecord("047", "3001230046", "B", account="3001230046"), ParcelRecord("081", "4005670089", "F2", account="4005670089"),
            ParcelRecord("061", "1000090002", "F1", account="1000090002"),
        ], snap, state_fips="36", account_system="nyc_bbl", full_roll=True)
        reg.close()

    def facts(self, bbl):
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_external("nyc_bbl", bbl))["facts"]}
        finally:
            reg.close()

    def test_report_facts(self):
        facts = {p: (v, u) for p, v, u in eb.report_facts(2023, "Office", "55.5", "Not Available", "120.5", "88", "3394", "4.9", "686838", 1)}
        self.assertEqual(facts["energy.reporting_year"], (2023, None))
        self.assertEqual(facts["energy.site_eui"], (55.5, "kBtu/ft2"))
        self.assertNotIn("energy.weather_normalized_site_eui", facts)  # "Not Available"
        self.assertEqual(facts["energy.energy_star_score"], (88, None))
        self.assertEqual(facts["energy.ghg_emissions"], (3394, "tCO2e"))
        self.assertEqual(facts["energy.ghg_intensity"], (4.9, "kgCO2e/ft2"))
        self.assertEqual(facts["energy.floor_area_sf"], (686838, "sf"))
        self.assertNotIn("energy.property_lot_count", facts)
        self.assertEqual(eb.report_facts(2023, "Office", "0", None, None, None, None, None, None, 1), [])
        self.assertEqual(eb.report_facts(2023, "Office", "Not Available", None, None, None, None, None, None, 1), [])
        self.assertEqual({p for p, _v, _u in eb.report_facts(2023, "", "10", None, None, "101", None, None, None, 3)},
                         {"energy.reporting_year", "energy.site_eui", "energy.property_lot_count"})  # a score over 100 is not one

    def test_bbl_lists(self):
        self.assertEqual(eb._bbls("3004650033 ; 3004650029"), ["3004650033", "3004650029"])
        self.assertEqual(eb._bbls("1004720015, 1004720010,1004720015"), ["1004720015", "1004720010"])
        self.assertEqual(eb._bbls("Not Available"), [])
        self.assertEqual(eb._bbls("9000000001"), [])

    def test_latest_usable_year_wins_and_a_multi_lot_property_is_flagged(self):
        counts = eb.Counts()
        stats = eb.build_nyc(self.csv, self.db, as_of="2025-11-25", retrieved_at="2026-11-04T05:59:00+00:00", counts=counts)
        f = self.facts("1000090001")
        self.assertEqual(f["energy.reporting_year"]["value"], 2023)  # 2024 had no usable report
        self.assertEqual(f["energy.site_eui"]["value"], 55.5)
        self.assertEqual(f["energy.site_eui"]["unit"], "kBtu/ft2")
        self.assertNotIn("energy.energy_star_score", f)  # "Not Available" in that year
        g = self.facts("3001230046")
        self.assertEqual(g["energy.property_lot_count"]["value"], 2)
        self.assertEqual(g["energy.property_type"]["value"], "Multifamily Housing")
        self.assertEqual(self.facts("3001230045")["energy.floor_area_sf"]["value"], 76846)
        self.assertEqual((counts.parcels_with_a_report, counts.parcels_multi_lot_property, counts.parcels_skipped_several_properties), (4, 2, 1))  # the reader counts every lot in the file; the registry drops one
        self.assertEqual(stats.skipped_out_of_scope, 1)  # the lot the registry does not hold

    def test_two_properties_on_one_lot_give_that_lot_nothing(self):
        eb.build_nyc(self.csv, self.db, as_of="2025-11-25")
        self.assertNotIn("energy.site_eui", self.facts("4005670089"))
        self.assertNotIn("energy.site_eui", self.facts("1000090002"))

    def test_citation_rights_and_no_names(self):
        eb.build_nyc(self.csv, self.db, as_of="2025-11-25")
        f = self.facts("1000090001")["energy.site_eui"]
        self.assertEqual(f["provenance"]["method"], "public_record")
        self.assertTrue(f["provenance"]["sources"][0]["document_id"].startswith("fl:document:sha256-"))
        self.assertIn("ll84.csv line 3: Portfolio Manager property 9001, report year 2023", f["provenance"]["sources"][0]["section"])
        self.assertEqual(f["rights"]["redistribution"], "permitted")
        self.assertFalse({"property_name", "address_1", "owner", "ownername"} & set(eb.NYC_COLUMNS))

    def test_reingest_changes_nothing(self):
        eb.build_nyc(self.csv, self.db, as_of="2025-11-25")
        self.assertEqual(eb.build_nyc(self.csv, self.db, as_of="2025-11-25").facts_written, 0)


def dc_rec(ssl, year, pid, status="In Compliance", eui="81.5", **kw):
    return {"SSL": ssl, "PMPROPERTYID": pid, "REPORTINGYEAR": year, "REPORTSTATUS": status,
            "PRIMARYPROPERTYTYPE_EPACALC": kw.get("type", "Office"), "PRIMARYPROPERTYTYPE_SELFSELECT": "Office",
            "ENERGYSTARSCORE": "73", "SITEEUI_KBTU_FT": eui, "WEATHERNORMALZEDSITEEUI_KBTUFT": "83.1",
            "SOURCEEUI_KBTU_FT": "138.6", "TOTGHGEMISSIONS_METRICTONSCO2E": "1342.55", "TOTGHGEMISSINTENSITY_KGCO2EFT": "5.67",
            "REPORTEDBUILDINGGROSSFLOORAREA": "236720", "TAXRECORDFLOORAREA": "286113"}


class TestDc(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        pages = [
            [dc_rec("0123 0045", 2024, "5001"), dc_rec("0123 0045", 2025, "5001", status="Incomplete Report"),
             dc_rec("0123 0046", 2025, "5002", eui="0"), dc_rec("0123 0046", 2024, "5002", eui="64.2")],
            [dc_rec("0123 0047; 0123 0048", 2025, "5003", type="Multifamily Housing"), dc_rec("0123 0049", 2025, "5004"),
             dc_rec("0123 0049", 2025, "5005"), dc_rec("0999 0001", 2025, "5006"), dc_rec("", 2025, "5007")],
        ]
        self.pages = []
        for i, recs in enumerate(pages, 1):
            p = self.dir / f"dc-energy-page-{i}.json"
            p.write_text(json.dumps({"features": [{"attributes": a} for a in recs]}))
            self.pages.append(p)
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        reg.add_source(ny_nyc.SOURCE)
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic roll")
        snap = reg.add_snapshot("ny-nyc-dof", roll, as_of="2026-05-15")
        reg.ingest_parcels([ParcelRecord("001", s, "F1", account=s) for s in
                            ("0123 0045", "0123 0046", "0123 0047", "0123 0048", "0123 0049")],
                           snap, state_fips="11", account_system="dc_ssl", full_roll=True)
        reg.close()

    def facts(self, ssl):
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_parcel("11", "001", ssl))["facts"]}
        finally:
            reg.close()

    def test_only_in_compliance_reports_and_latest_usable_year(self):
        counts = eb.Counts()
        eb.build_dc([str(p) for p in self.pages], self.db, as_of="2026-11-02", counts=counts)
        a = self.facts("0123 0045")
        self.assertEqual(a["energy.reporting_year"]["value"], 2024)  # the 2025 report is incomplete
        self.assertEqual(a["energy.site_eui"]["value"], 81.5)
        self.assertEqual(a["energy.property_type"]["value"], "Office")
        self.assertEqual(self.facts("0123 0046")["energy.site_eui"]["value"], 64.2)  # 2025 has a zero EUI
        self.assertEqual(a["energy.site_eui"]["rights"]["ai_use"], "permitted")
        self.assertEqual(counts.parcels_skipped_several_properties, 1)  # 0123 0049: two properties in 2025

    def test_a_report_for_several_ssls_goes_to_each_and_is_flagged(self):
        eb.build_dc([str(p) for p in self.pages], self.db, as_of="2026-11-02")
        for ssl in ("0123 0047", "0123 0048"):
            f = self.facts(ssl)
            self.assertEqual(f["energy.property_lot_count"]["value"], 2)
            self.assertEqual(f["energy.property_type"]["value"], "Multifamily Housing")
        self.assertNotIn("energy.site_eui", self.facts("0123 0049"))

    def test_pages_are_snapshots_and_facts_name_the_page_and_record(self):
        eb.build_dc([str(p) for p in self.pages], self.db, as_of="2026-11-02")
        reg = Registry(self.db)
        try:
            names = sorted(r[0] for r in reg.db.execute("SELECT filename FROM snapshots WHERE source_id = ?", (eb.DC_SOURCE.source_id,)))
        finally:
            reg.close()
        self.assertEqual(names, ["dc-energy-page-1.json", "dc-energy-page-2.json"])
        self.assertIn("dc-energy-page-1.json record 4: Portfolio Manager property 5002",
                      self.facts("0123 0046")["energy.site_eui"]["provenance"]["sources"][0]["section"])

    def test_no_owner_or_name_column_is_requested(self):
        self.assertFalse({"OWNEROFRECORD", "PROPERTYNAME", "ADDRESSOFRECORD", "REPORTEDADDRESS", "VERIFIER_NAME"} & set(eb.DC_FIELDS))


if __name__ == "__main__":
    unittest.main()


class TestDenver(unittest.TestCase):
    """The Denver workbook has no parcel number: a row goes to the one parcel at its street address."""

    HEADER = ["Building ID", "Compliance Status", "Property Name", "Street", "Zipcode", "Primary Property Type EPA Calculated",
              "Master Sq Ft", "Reporting Year", "Energy Star Score", "Site EUI (kBtu/sq ft)",
              "Weather Normalized Site EUI (kBtu/sq ft)", "Total GHG Emissions (Metric Tons Co2e)"]

    def setUp(self):
        from tests.test_adapter_ny_sales import write_xlsx

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        rows = [
            ["Energize Denver SYNTHETIC master dataset"],
            self.HEADER,
            [1001.0, "in compliance", "invented hotel one", "6805 n argonne st", 80233.0, "Hotel", 58929.0, 2026.0, 93.0, 64.4, 63.0, 576.85],
            [1002.0, "not submitted", "invented hotel two", "100 main st", 80202.0, "Hotel", 1000.0, None, None, None, None, None],
            [1003.0, "in compliance", "invented office", "200 elm st", 80202.0, "Office", 90000.0, 2026.0, None, 52.0, None, None],
            [1004.0, "in compliance", "invented shop", "300 oak st", 80202.0, "Retail", 5000.0, 2026.0, 50.0, 70.5, None, 10.0],
            [1005.0, "in compliance", "invented unknown", "999 nowhere rd", 80202.0, "Office", 5000.0, 2026.0, 50.0, 40.0, None, 10.0],
            [1006.0, "in compliance", "invented twin a", "400 pine st", 80202.0, "Office", 5000.0, 2026.0, 50.0, 40.0, None, 10.0],
            [1007.0, "in compliance", "invented twin b", "400 pine st", 80202.0, "Office", 6000.0, 2026.0, 50.0, 41.0, None, 11.0],
        ]
        self.xlsx = self.dir / "2025_Master_Data_Set.xlsx"
        write_xlsx(self.xlsx, rows)
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        from factlot.registry.adapters import co_denver

        reg.add_source(co_denver.SOURCE)
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic")
        snap = reg.add_snapshot("co-denver-assessor", roll, as_of="2026-10-29")
        site = lambda n, s: ParcelRecord("031", n, "F1", account=n, situs_address=s)  # noqa: E731
        reg.ingest_parcels([
            site("0003100025000", "6805 N ARGONNE ST, DENVER CO"), site("0003100026000", "200 ELM ST, DENVER CO"),
            site("0003100027000", "300 OAK ST, DENVER CO"), site("0003100028000", "300 OAK ST, DENVER CO"),  # two parcels, one address
            site("0003100029000", "400 PINE ST, DENVER CO"),
        ], snap, state_fips="08", account_system="denver_schednum", full_roll=True)
        reg.close()

    def facts(self, apn):
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_parcel("08", "031", apn))["facts"]}
        finally:
            reg.close()

    def test_rows_go_to_the_one_parcel_at_their_address_and_are_labelled_inferred(self):
        counts = eb.Counts()
        eb.build_denver(self.xlsx, self.db, as_of="2026-09-22", counts=counts)
        f = self.facts("0003100025000")
        self.assertEqual(f["energy.site_eui"]["value"], 64.4)
        self.assertEqual(f["energy.reporting_year"]["value"], 2026)
        self.assertEqual(f["energy.floor_area_sf"]["value"], 58929)
        self.assertEqual(f["energy.property_type"]["value"], "Hotel")
        prov = f["energy.site_eui"]["provenance"]
        self.assertEqual((prov["method"], prov["confidence"]), ("inferred", 0.85))
        self.assertIn("Energize Denver building 1001, reporting year 2026, matched on street address 6805 N ARGONNE ST", prov["sources"][0]["section"])
        self.assertEqual(f["energy.site_eui"]["rights"]["redistribution"], "attribution_required")
        self.assertEqual(self.facts("0003100026000")["energy.site_eui"]["value"], 52)
        self.assertNotIn("energy.energy_star_score", self.facts("0003100026000"))

    def test_ambiguous_missing_and_unreported_rows_are_left_out(self):
        counts = eb.Counts()
        eb.build_denver(self.xlsx, self.db, as_of="2026-09-22", counts=counts)
        self.assertNotIn("energy.site_eui", self.facts("0003100027000"))  # two parcels share the address
        self.assertNotIn("energy.site_eui", self.facts("0003100029000"))  # two buildings on one parcel
        self.assertEqual((counts.reports_read, counts.reports_usable, counts.rows_matched_to_one_parcel,
                          counts.rows_address_matches_no_parcel, counts.rows_address_matches_several_parcels), (7, 6, 4, 1, 1))
        self.assertEqual(counts.parcels_skipped_several_properties, 1)

    def test_property_names_are_never_read(self):
        self.assertNotIn("Property Name", eb.DENVER_COLUMNS)
        reg = Registry(self.db)
        eb.build_denver(self.xlsx, self.db, as_of="2026-09-22")
        try:
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM facts WHERE value_json LIKE '%invented%' OR locator LIKE '%invented%'").fetchone()[0], 0)
        finally:
            reg.close()
