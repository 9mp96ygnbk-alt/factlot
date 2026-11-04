"""DC zoning-map join tests on SYNTHETIC geometry in the layout of DC GIS's GeoJSON and JSON query results.

Every polygon, SSL and name here is invented. Coordinates are a toy grid near (-77.0, 38.9); one lot is
0.001 degrees square.
"""

import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import ParcelRecord, Registry
from factlot.registry.adapters import dc_otr, dc_zoning as z

X0, Y0, D = -77.0, 38.9, 0.001


def square(i: int, j: int, w: float = 1, h: float = 1) -> list:
    x, y = X0 + i * D, Y0 + j * D
    return [[[x, y], [x + w * D, y], [x + w * D, y + h * D], [x, y + h * D], [x, y]]]


def feature(props: dict, rings: list, kind: str = "Polygon") -> dict:
    return {"type": "Feature", "properties": props, "geometry": {"type": kind, "coordinates": rings}}


def collection(*features: dict) -> dict:
    return {"type": "FeatureCollection", "features": list(features)}


# Zoning: MU-4 on the west (x 0..5), R-3 on the east (x 5..10), a hole of PDR-1 inside MU-4 at (2,2).
ZONING = collection(
    feature(dict(ZONING="MU-4", ZONE_DESCRIPTION="Permits moderate density mixed use development", ZONING_STATUS="Final"),
            [square(0, 0, 5, 5)[0], [[X0 + 2 * D, Y0 + 2 * D], [X0 + 2 * D, Y0 + 3 * D], [X0 + 3 * D, Y0 + 3 * D],
                                     [X0 + 3 * D, Y0 + 2 * D], [X0 + 2 * D, Y0 + 2 * D]]]),
    feature(dict(ZONING="R-3", ZONE_DESCRIPTION="Allows attached rowhouses", ZONING_STATUS="Final"), square(5, 0, 5, 5)),
    feature(dict(ZONING="PDR-1", ZONE_DESCRIPTION="Production, distribution, and repair", ZONING_STATUS="Final"), square(2, 2)),
)
OVERLAYS = collection(feature(dict(OVERLAY_NAME="Example Arts Overlay", OVERLAY_SHORT="ARTS"), square(0, 0, 2, 5)))
LOTS = collection(
    feature(dict(SSL="0100    0001"), square(0, 0)),                  # wholly MU-4, in the overlay
    feature(dict(SSL="0100    0002"), square(4.8, 0.2, 0.4, 0.6)),     # 50/50 across MU-4 and R-3
    feature(dict(SSL="0100    0003"), square(7, 0)),                   # wholly R-3
    feature(dict(SSL="0100    0004"), square(20, 20)),                 # outside every district
    feature(dict(SSL="0100E   0005"), square(1, 3)),                   # suffix; MU-4, overlay
    feature(dict(SSL="0100    0006"), square(2, 2)),                   # the PDR-1 hole
)
CONDO_UNITS = {"features": [{"attributes": {"SSL": "0100    2001", "MAT_SSL": "0100    0003"}},
                            {"attributes": {"SSL": "0100    2002", "MAT_SSL": "0999    0099"}}]}


class TestGeometry(unittest.TestCase):
    def test_point_in_polygon_with_hole(self):
        poly = [[(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)], [(1, 1), (1, 2), (2, 2), (2, 1), (1, 1)]]
        self.assertTrue(z.point_in_polygon(3, 3, poly))
        self.assertFalse(z.point_in_polygon(1.5, 1.5, poly))
        self.assertFalse(z.point_in_polygon(5, 5, poly))

    def test_polygons_of_multipolygon(self):
        g = {"type": "MultiPolygon", "coordinates": [square(0, 0), square(3, 3)]}
        self.assertEqual(len(z.polygons_of(g)), 2)
        self.assertEqual(z.polygons_of(None), [])
        self.assertEqual(z.polygons_of({"type": "Point", "coordinates": [0, 0]}), [])

    def test_sample_points_fall_inside_even_for_a_sliver(self):
        pts = z.sample_points(z.polygons_of({"type": "Polygon", "coordinates": square(0, 0, 3, 1)}))
        self.assertGreater(len(pts), 50)
        sliver = z.polygons_of({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [2, 0], [0, 0]]]})
        self.assertEqual(len(z.sample_points(sliver)), 1)

    def test_raw_ssl(self):
        self.assertEqual(z.raw_ssl("0123 0045"), "0123    0045")
        self.assertEqual(z.raw_ssl("0123E 0045"), "0123E   0045")
        self.assertEqual(z.raw_ssl("0123    0045"), "0123    0045")
        self.assertIsNone(z.raw_ssl("PAR 01430099"))
        self.assertIsNone(z.raw_ssl("PI0002570045"))

    def test_urls(self):
        urls = z.lot_urls([z.raw_ssl("0123 0045"), z.raw_ssl("0123 0046")])
        self.assertEqual(len(urls), 2)  # record lots and tax lots
        self.assertIn("MapServer/35/query", urls[0])
        self.assertIn("SSL%20IN", urls[0])
        self.assertIn("f=geojson", urls[0])
        condo = z.condo_urls(["0123    2001"])[0]
        self.assertIn("MapServer/52/query", condo)
        self.assertIn("outFields=SSL%2CMAT_SSL", condo)  # no owner, address or sale columns
        self.assertNotIn("OWNERNAME", condo)
        self.assertEqual(len(z.lot_urls([f"{n:04d}    0001" for n in range(250)])), 6)  # 3 batches x 2 layers


class TestJoin(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        self.paths = {}
        for name, doc in (("zoning", ZONING), ("overlays", OVERLAYS), ("lots", LOTS), ("condos", CONDO_UNITS)):
            self.paths[name] = d / f"{name}.json"
            self.paths[name].write_text(json.dumps(doc))
        self.db = d / "r.db"
        reg = Registry(self.db)
        reg.add_source(dc_otr.SOURCE)
        roll = d / "roll.csv"
        roll.write_text("synthetic")
        snap = reg.add_snapshot(dc_otr.SOURCE.source_id, roll, as_of="2026-09-04")
        reg.ingest_parcels([ParcelRecord(dc_otr.COUNTY_FIPS, apn, "F1", account=apn) for apn in (
            "0100 0001", "0100 0002", "0100 0003", "0100 0004", "0100E 0005", "0100 0006", "0100 2001", "0100 2002",
            "0100 0099")], snap, state_fips="11", account_system="dc_ssl")
        reg.close()

    def run_join(self):
        return z.build(self.db, self.paths["zoning"], [self.paths["lots"]], as_of="2026-11-04",
                       overlay_path=self.paths["overlays"], condo_paths=[self.paths["condos"]])

    def facts(self, apn: str) -> dict:
        reg = Registry(self.db)
        try:
            return {f["predicate"]: f for f in reg.get(reg.resolve_external("dc_ssl", apn))["facts"]}
        finally:
            reg.close()

    def test_districts_overlays_and_splits(self):
        stats = self.run_join()
        # Lots 1, 2, 3, 5, 6 and the condo unit 2001 (via lot 3) get facts; lot 4 is outside every district;
        # unit 2002's underlying lot has no polygon; parcel 0099 has no polygon.
        self.assertEqual((stats.seen, stats.kept, stats.skipped_out_of_scope), (6, 6, 0))
        a = self.facts("0100 0001")
        self.assertEqual(a["zoning.district"]["value"], "MU-4")
        self.assertEqual(a["zoning.district_description"]["value"], "Permits moderate density mixed use development")
        self.assertEqual(a["zoning.special_district"]["value"], ["Example Arts Overlay"])
        self.assertNotIn("zoning.split_zone", a)
        b = self.facts("0100 0002")
        self.assertIn(b["zoning.district"]["value"], {"MU-4", "R-3"})
        other = {"MU-4", "R-3"} - {b["zoning.district"]["value"]}
        self.assertEqual(b["zoning.other_districts"]["value"], sorted(other))
        self.assertIs(b["zoning.split_zone"]["value"], True)
        self.assertLess(b["zoning.district"]["provenance"]["confidence"], 0.6)
        c = self.facts("0100 0003")
        self.assertEqual(c["zoning.district"]["value"], "R-3")
        self.assertNotIn("zoning.special_district", c)
        self.assertEqual(self.facts("0100E 0005")["zoning.district"]["value"], "MU-4")
        self.assertEqual(self.facts("0100 0006")["zoning.district"]["value"], "PDR-1")  # the hole in MU-4
        self.assertNotIn("zoning.district", self.facts("0100 0004"))
        self.assertNotIn("zoning.district", self.facts("0100 2002"))
        self.assertNotIn("zoning.district", self.facts("0100 0099"))

    def test_condo_unit_takes_the_underlying_lots_district_and_says_so(self):
        self.run_join()
        unit = self.facts("0100 2001")["zoning.district"]
        self.assertEqual(unit["value"], "R-3")
        self.assertIn("condominium unit, polygon of underlying lot 0100 0003", unit["provenance"]["sources"][0]["section"])

    def test_facts_are_inferred_capped_cited_and_carry_rights(self):
        self.run_join()
        f = self.facts("0100 0003")["zoning.district"]
        self.assertEqual(f["provenance"]["method"], "inferred")
        self.assertEqual(f["provenance"]["confidence"], z.MAX_CONFIDENCE)
        src = f["provenance"]["sources"][0]
        self.assertTrue(src["document_id"].startswith("fl:document:sha256-"))
        self.assertIn("lot polygon in fl:document:sha256-", src["section"])  # the lot file, by document ID
        self.assertIn("and overlays fl:document:sha256-", src["section"])
        self.assertEqual(f["rights"]["redistribution"], "attribution_required")
        self.assertIn("Open Data DC", f["rights"]["attribution"])

    def test_cited_lot_and_overlay_files_are_registered_snapshots(self):
        self.run_join()
        reg = Registry(self.db)
        try:
            docs = {r[0] for r in reg.db.execute("SELECT document_id FROM snapshots WHERE source_id = ?", (z.SOURCE_ID,))}
            cited = {s.split(" ")[0] for s in (f["provenance"]["sources"][0]["section"].split("polygon in ")[1]
                                               for f in reg.get(reg.resolve_external("dc_ssl", "0100 0001"))["facts"]
                                               if f["predicate"] == "zoning.district")}
            self.assertTrue(cited <= docs)
            self.assertEqual(len(docs), 4)  # zoning, lots, overlays, condo relate
        finally:
            reg.close()

    def test_roll_facts_untouched_and_rerun_changes_nothing(self):
        self.run_join()
        reg = Registry(self.db)
        before = reg.stats()
        reg.close()
        stats = self.run_join()
        self.assertEqual(stats.facts_written, 0)
        reg = Registry(self.db)
        try:
            self.assertEqual(reg.stats(), before)
        finally:
            reg.close()

    def test_condo_relate_urls_request_no_person_columns_and_reader_ignores_them(self):
        p = Path(self.tmp.name) / "condo2.json"
        p.write_text(json.dumps({"features": [{"attributes": {"SSL": "0100    2001", "MAT_SSL": "0100    0003",
                                                              "OWNERNAME": "J EXAMPLE"}}]}))
        self.assertEqual(z.read_condo_units([p]), {"01002001": "01000003"})


if __name__ == "__main__":
    unittest.main()
