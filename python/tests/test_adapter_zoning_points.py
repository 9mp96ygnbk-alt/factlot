"""Zoning-by-point adapter tests on a SYNTHETIC fixture that copies the real layouts.

The districts, polygons, parcel IDs and coordinates here are invented to exercise the join; none is Minneapolis or
Hennepin County data. Layouts: the ArcGIS ``query`` response as GeoJSON (``f=geojson``) of *Planning Primary Zoning*
(``Land_Use``, ``Land_Use_Code``) and the county's ``County_Parcels.csv`` (``PID``, ``LAT``, ``LON``, and others).
"""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import ParcelRecord, Registry, Source
from factlot.registry.adapters import zoning_points as zp


def square(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


# Longitude then latitude, as GeoJSON writes them. Two districts side by side, an overlap, and a hole.
ZONING = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"OBJECTID": 1, "Land_Use": "Invented Corridor Mixed Use", "Land_Use_Code": "CM9"},
     "geometry": square(-93.30, 44.90, -93.20, 45.00)},
    {"type": "Feature", "properties": {"OBJECTID": 2, "Land_Use": "Invented Production", "Land_Use_Code": "PR9"},
     "geometry": square(-93.20, 44.90, -93.10, 45.00)},
    {"type": "Feature", "properties": {"OBJECTID": 3, "Land_Use": "Invented Overlap One", "Land_Use_Code": "XX1"},
     "geometry": square(-93.50, 45.10, -93.40, 45.20)},
    {"type": "Feature", "properties": {"OBJECTID": 4, "Land_Use": "Invented Overlap Two", "Land_Use_Code": "XX2"},
     "geometry": square(-93.45, 45.10, -93.35, 45.20)},
    {"type": "Feature", "properties": {"OBJECTID": 5, "Land_Use": "", "Land_Use_Code": ""}, "geometry": square(-93.0, 44.0, -92.9, 44.1)},
]}
COLUMNS = ["OBJECTID", "PID", "PROPERTY_STATUS_CD", "MUNIC_NM", "LAT", "LON"]
POINTS = [
    dict(PID="0100000000001", LAT="44.95", LON="-93.25", MUNIC_NM="MINNEAPOLIS"),      # in CM9
    dict(PID="0100000000002", LAT="44.95", LON="-93.15", MUNIC_NM="MINNEAPOLIS"),      # in PR9
    dict(PID="0100000000003", LAT="45.50", LON="-93.60", MUNIC_NM="EDINA"),            # outside every polygon
    dict(PID="0100000000004", LAT="45.15", LON="-93.42", MUNIC_NM="MINNEAPOLIS"),      # in both overlapping polygons
    dict(PID="0100000000005", LAT="", LON="", MUNIC_NM="MINNEAPOLIS"),                 # no coordinate
    dict(PID="0100000000001", LAT="45.50", LON="-93.60", MUNIC_NM="MINNEAPOLIS"),      # PID repeated: the first row wins
    dict(PID="0100000000006", LAT="0", LON="0", MUNIC_NM="MINNEAPOLIS"),               # zero is not a coordinate
]


def points_csv(rows):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(COLUMNS)
    for r in rows:
        w.writerow([r.get(c, "") for c in COLUMNS])
    return "﻿" + out.getvalue()


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.zoning = self.dir / "planning-primary-zoning.geojson"
        self.zoning.write_text(json.dumps(ZONING))
        self.points = self.dir / "County_Parcels.csv"
        self.points.write_text(points_csv(POINTS), encoding="utf-8")


class TestReader(Fixture):
    def read(self):
        counts = zp.Counts()
        layer, counts.zoning_polygons = zp.read_zoning(self.zoning, zp.MINNEAPOLIS)
        out = {p.apn: p for p in zp.read_parcels(layer, zp.read_points(self.points, zp.MINNEAPOLIS), zp.MINNEAPOLIS,
                                                  zoning_name="planning-primary-zoning.geojson", points_doc="fl:document:sha256-abcd", counts=counts)}
        return out, counts

    def test_points_land_in_their_polygons(self):
        out, counts = self.read()
        self.assertEqual(sorted(out), ["0100000000001", "0100000000002"])
        a = out["0100000000001"]
        self.assertEqual([(p, v) for p, v, _u in a.facts], [("zoning.district", "CM9"), ("zoning.district_description", "Invented Corridor Mixed Use")])
        self.assertEqual((a.county_fips, a.method, a.confidence), ("053", "inferred", 0.8))
        self.assertEqual(out["0100000000002"].facts[0][1], "PR9")
        self.assertEqual(counts.zoning_polygons, 4)  # the polygon without a code is not a district

    def test_unplaceable_points_get_nothing_and_are_counted(self):
        out, counts = self.read()
        self.assertEqual((counts.points_read, counts.points_without_coordinates, counts.points_in_no_polygon,
                          counts.points_in_several_polygons, counts.parcels_with_district), (6, 2, 1, 1, 2))
        self.assertEqual(counts.districts, {"CM9": 1, "PR9": 1})

    def test_the_first_row_of_a_repeated_pid_wins(self):
        out, _ = self.read()
        self.assertIn("line 2 of fl:document:sha256-abcd", out["0100000000001"].locator)
        self.assertIn("(44.950000, -93.250000)", out["0100000000001"].locator)

    def test_missing_columns_are_an_error(self):
        bad = self.dir / "bad.csv"
        bad.write_text("PID,LATITUDE\n1,2\n")
        with self.assertRaises(ValueError):
            list(zp.read_points(bad, zp.MINNEAPOLIS))


class TestIngest(Fixture):
    def setUp(self):
        super().setUp()
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        reg.add_source(Source("test-hennepin", "Example", "Parcels", "https://example.invalid", "27", county_fips="053", license="synthetic"))
        snap = reg.add_snapshot("test-hennepin", self.points, as_of="2026-10-01")
        reg.ingest_parcels([ParcelRecord("053", "0100000000001", "F1", account="1"), ParcelRecord("053", "0100000000003", "F1", account="3")],
                           snap, state_fips="27", account_system="test-pid", full_roll=True)
        reg.close()

    def facts(self, apn):
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_parcel("27", "053", apn))["facts"]}
        finally:
            reg.close()

    def test_zoning_is_added_to_known_parcels_and_cited(self):
        counts = zp.Counts()
        stats = zp.build(zp.MINNEAPOLIS, self.zoning, self.points, self.db, as_of="2026-10-30", counts=counts)
        self.assertEqual((stats.kept, stats.skipped_out_of_scope), (1, 1))  # the second parcel with a district is not in the registry
        f = self.facts("0100000000001")["zoning.district"]
        self.assertEqual(f["value"], "CM9")
        prov = f["provenance"]
        self.assertEqual((prov["method"], prov["confidence"]), ("inferred", 0.8))
        self.assertTrue(prov["sources"][0]["document_id"].startswith("fl:document:sha256-"))
        self.assertIn("lies in planning-primary-zoning.geojson feature 1", prov["sources"][0]["section"])
        self.assertEqual(f["rights"]["ai_use"], "permitted")
        self.assertNotIn("zoning.district", self.facts("0100000000003"))  # outside every polygon: nothing, not a guess
        # The points file is a snapshot of the parcel source, and the locator names it by document ID.
        points_doc = self.facts("0100000000001")["parcel.apn"]["provenance"]["sources"][0]["document_id"]
        self.assertIn(points_doc, prov["sources"][0]["section"])

    def test_reingest_changes_nothing(self):
        zp.build(zp.MINNEAPOLIS, self.zoning, self.points, self.db, as_of="2026-10-30")
        self.assertEqual(zp.build(zp.MINNEAPOLIS, self.zoning, self.points, self.db, as_of="2026-10-30").facts_written, 0)


if __name__ == "__main__":
    unittest.main()
