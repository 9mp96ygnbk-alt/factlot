"""San Francisco Assessor-Recorder adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel number, address and value here is invented to exercise the mapping; none is real data.
The header is the column projection the collector archives from DataSF dataset wv5m-vpq2.
"""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import ca_san_francisco

HEADER = [
    "closed_roll_year", "property_location", "parcel_number", "block", "lot", "use_code", "use_definition",
    "property_class_code", "property_class_code_definition", "year_property_built", "number_of_units",
    "number_of_stories", "zoning_code", "property_area", "lot_area", "status_code", "current_sales_date",
    "assessed_improvement_value", "assessed_land_value", "assessed_fixtures_value",
    "assessed_personal_property_value", "row_id", "data_as_of",
]


def loc(high: str, low: str, name: str, suffix: str, unit: str) -> str:
    """The publisher's fixed-width situs string: high number, low number, name padded to 20, suffix, unit."""
    return f"{high} {low} {name:<20}{suffix:<2}{unit}"


def row(**f: str) -> dict[str, str]:
    r = {c: "" for c in HEADER}
    r.update({"closed_roll_year": "2025", "status_code": "NA", "data_as_of": "2026-06-26T12:56:13.000", **f})
    r["row_id"] = r.get("row_id") or "2025" + r["parcel_number"]
    r["block"], r["lot"] = r["parcel_number"][:4], r["parcel_number"][4:]
    return r


ROWS = [
    # 1: office tower, single street number
    row(parcel_number="9001001", property_location=loc("0000", "0100", "EXAMPLE", "ST", "0000"), use_code="COMO",
        zoning_code="C3O", use_definition="Commercial Office", property_class_code="O", property_class_code_definition="Office",
        year_property_built="1985", number_of_units="0.0", property_area="250000.0", lot_area="40000.0",
        assessed_improvement_value="30000000.0", assessed_land_value="20000000.0",
        assessed_fixtures_value="500.0", assessed_personal_property_value="900.0"),
    # 2: apartments, 15+ units, street-number range
    row(parcel_number="9002002A", property_location=loc("0210", "0200", "SAMPLE", "AV", "0000"), use_code="MRES",
        zoning_code="rm2 ", use_definition="Multi-Family Residential", property_class_code="A15",
        property_class_code_definition="Apartment 15 Units or more", year_property_built="1962",
        number_of_units="40.0", property_area="30000.0", lot_area="9000.5",
        assessed_improvement_value="4000000.0", assessed_land_value="6000000.0"),
    # 3: apartments, 4 units or less: out of scope
    row(parcel_number="9003003", property_location=loc("0000", "0300", "MAPLE", "ST", "0000"), use_code="MRES",
        property_class_code="A", number_of_units="4.0", assessed_land_value="1000.0"),
    # 4: Flat & Store with 6 units: no unit band in the class, so the unit count decides
    row(parcel_number="9004004", property_location=loc("0000", "0400", "CLAY", "ST", "0000"), use_code="MRES",
        zoning_code="NA", property_class_code="F2", number_of_units="6.0", assessed_land_value="2000.0",
        assessed_improvement_value="3000.0"),
    # 5: Flat & Store with 2 units: out
    row(parcel_number="9005005", property_location=loc("0000", "0500", "CLAY", "ST", "0000"), use_code="MRES",
        property_class_code="F2", number_of_units="2.0", assessed_land_value="2000.0"),
    # 6: warehouse, no building area or year recorded (zeros), unit with leading zeros and a letter
    row(parcel_number="9006006", property_location=loc("0000", "0600", "INDUSTRIAL", "RD", "0007B"), use_code="IND",
        use_definition="Industrial", property_class_code="IW", year_property_built="0", number_of_units="0.0",
        property_area="0.0", lot_area="0.0", assessed_improvement_value="0.0", assessed_land_value="0.0"),
    # 7: government-owned industrial class: out
    row(parcel_number="9007007", property_location=loc("0000", "0700", "PORT", "ST", "0000"), use_code="IND",
        property_class_code="IG", assessed_land_value="0.0"),
    # 8: commercial but non-taxable (status N): out
    row(parcel_number="9008008", property_location=loc("0000", "0800", "CIVIC", "ST", "0000"), use_code="COMR",
        property_class_code="C", status_code="N", assessed_land_value="0.0"),
    # 9: vacant commercial/industrial lot: out
    row(parcel_number="9009009", property_location=loc("0000", "0900", "EMPTY", "ST", "0000"), use_code="MISC",
        property_class_code="VCI", assessed_land_value="5000.0"),
    # 10: street without a suffix and a five-character unit
    row(parcel_number="9010010", property_location=loc("0000", "1000", "BROADWAY", "", "0001G"), use_code="COMR",
        property_class_code="CZ", assessed_land_value="100.0", assessed_improvement_value="200.0"),
    # 11: hotel with no street number
    row(parcel_number="9011011", property_location=loc("0000", "0000", "TEST HOTEL", "WY", "0000"), use_code="COMH",
        property_class_code="H2", assessed_land_value="100.0"),
    # 12: single-family condominium: out
    row(parcel_number="9012012", property_location=loc("0000", "1200", "OAK", "ST", "0101"), use_code="SRES",
        property_class_code="Z", assessed_land_value="100.0"),
    # 13: a repeated parcel number collapses to the first row
    row(parcel_number="9001001", property_location=loc("0000", "0100", "EXAMPLE", "ST", "0000"), use_code="COMO",
        property_class_code="O", assessed_land_value="1.0", row_id="duplicate"),
    # 14: an unknown future class code: out, not guessed
    row(parcel_number="9014014", property_location=loc("0000", "1400", "NEW", "ST", "0000"), use_code="COMR",
        property_class_code="ZZZ", assessed_land_value="100.0"),
]


def write_csv(tmp: Path) -> Path:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADER, lineterminator="\n")
    w.writeheader()
    w.writerows(ROWS)
    p = tmp / "wv5m-vpq2.csv"
    p.write_text(buf.getvalue(), encoding="utf-8")
    return p


class SanFrancisco(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = write_csv(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in ca_san_francisco.read_roll(self.csv)}
        self.assertEqual(sorted(recs), ["9001001", "9002002A", "9004004", "9006006", "9010010", "9011011"],
                         "office, 15+ apartments, 6-unit Flat & Store, warehouse, condo store, hotel kept")
        tower = recs["9001001"]
        self.assertEqual(tower.county_fips, "075")
        self.assertEqual((tower.account, tower.state_category, tower.tax_year), ("9001001", "F1", 2025))
        self.assertEqual(tower.situs_address, "100 EXAMPLE ST, SAN FRANCISCO, CA")
        self.assertEqual((tower.land_area_sf, tower.improvement_area_sf, tower.year_built), (40000, 250000, 1985))
        self.assertEqual(tower.appraised_value, 50000000, "land + improvements; fixtures and personal property excluded")
        self.assertIsNone(tower.market_value, "the Assessor publishes assessed values, not market values")
        self.assertEqual(tower.local_use_code, "COMO/O")
        self.assertEqual(tower.locator, "row_id 20259001001")
        self.assertEqual(recs["9002002A"].state_category, "B")
        self.assertEqual(recs["9002002A"].situs_address, "200-210 SAMPLE AV, SAN FRANCISCO, CA", "range, lowest first")
        self.assertEqual(recs["9002002A"].local_use_code, "MRES/A15")
        self.assertEqual(recs["9004004"].state_category, "B", "F2 has no band: 6 units")
        warehouse = recs["9006006"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.situs_address, "600 INDUSTRIAL RD #7B, SAN FRANCISCO, CA", "leading zeros dropped from the unit")
        self.assertEqual((warehouse.year_built, warehouse.improvement_area_sf, warehouse.land_area_sf),
                         (None, None, None), "zeros are not figures")
        self.assertIsNone(warehouse.appraised_value, "no assessed value recorded")
        self.assertEqual(recs["9010010"].situs_address, "1000 BROADWAY #1G, SAN FRANCISCO, CA", "blank suffix, 5-char unit")
        self.assertEqual(recs["9011011"].situs_address, "TEST HOTEL WY, SAN FRANCISCO, CA", "no street number")
        # The dataset publishes no owner names, so no record carries one or is marked confidential.
        self.assertTrue(all(r.owner_name is None and not r.owner_confidential for r in recs.values()))

    def test_zoning_code_becomes_the_zoning_district(self):
        recs = {r.apn: r for r in ca_san_francisco.read_roll(self.csv)}
        self.assertEqual(recs["9001001"].extra_facts, [("zoning.district", "C3O", None)])
        self.assertEqual(recs["9002002A"].extra_facts, [("zoning.district", "RM2", None)], "squeezed and upper-cased")
        self.assertEqual(recs["9004004"].extra_facts, [], "NA is no code")
        self.assertEqual(recs["9006006"].extra_facts, [], "a blank code writes nothing")

    def test_category(self):
        c = ca_san_francisco.category
        self.assertEqual(c("A5"), "B")
        self.assertEqual(c("A"), None, "4 units or less")
        self.assertEqual(c("CO", 20), "B")
        self.assertEqual(c("CO", 4), None)
        self.assertEqual(c("CO", None), None, "no unit count, not guessed")
        self.assertEqual(c("AC"), "F1")
        self.assertEqual(c("IX"), "F2")
        self.assertIsNone(c("IXG"), "government")
        self.assertIsNone(c("V"))
        self.assertIsNone(c(""))
        self.assertIsNone(c(None))
        self.assertEqual(c(" oz "), "F1", "case and spaces ignored")

    def test_situs(self):
        s = ca_san_francisco.situs
        self.assertEqual(s(loc("0000", "2130", "STOCKTON", "ST", "0000")), "2130 STOCKTON ST, SAN FRANCISCO, CA")
        self.assertEqual(s(loc("0550", "0544", "FILBERT", "ST", "0000")), "544-550 FILBERT ST, SAN FRANCISCO, CA")
        self.assertEqual(s(loc("0000", "0033", "MIDWAY", "ST", "0204")), "33 MIDWAY ST #204, SAN FRANCISCO, CA")
        self.assertEqual(s(loc("0329", "0327", "FULTON", "ST", "A-07")), "327-329 FULTON ST #A-07, SAN FRANCISCO, CA")
        self.assertEqual(s(loc("0000", "0088", "BROADWAY", "", "0000")), "88 BROADWAY, SAN FRANCISCO, CA")
        self.assertIsNone(s(""))
        self.assertIsNone(s(None))
        self.assertIsNone(s(loc("0000", "0000", "", "ST", "0000")), "no street name")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = ca_san_francisco.build(self.csv, db, as_of="2026-06-26")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (6, 6, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 0)
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'ca-san-francisco-assessor'").fetchone()
            self.assertEqual(src["county_fips"], "075")
            self.assertEqual(src["license"], ca_san_francisco.SOURCE.license)
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'sf_parcel' AND external_id = '9002002A'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-06075:9002002a")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"B"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 0)
            zoning = [f for f in reg.facts(urn) if f["predicate"] == "zoning.district"]
            self.assertEqual([f["value"] for f in zoning], ["RM2"])
            self.assertEqual(zoning[0]["provenance"]["method"], "public_record")
            self.assertEqual(zoning[0]["provenance"]["sources"][0]["section"], "row_id 20259002002A")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()
