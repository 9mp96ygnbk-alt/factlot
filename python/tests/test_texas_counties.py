"""The Texas county matrix is a status list, not a parcel inventory."""

import unittest

from factlot.registry.texas_counties import matrix, texas_fips


class TexasCountyMatrix(unittest.TestCase):
    def test_every_texas_county_is_listed_once(self):
        rows = matrix()
        fips = [r["fips"] for r in rows]
        self.assertEqual(len(rows), 254)
        self.assertEqual(len(set(fips)), 254)
        self.assertEqual(len(texas_fips()), 254)
        self.assertTrue(all(code.startswith("48") and len(code) == 5 for code in fips))

    def test_unknown_counties_have_no_invented_parcel_total(self):
        unknown = [r for r in matrix() if r["reuse"] == "unknown"]
        self.assertGreater(len(unknown), 200)
        for row in unknown:
            self.assertIsNone(row["commercial_universe"])
            self.assertIsNone(row["staged_parcels"])
            self.assertIsNone(row["source_id"])

    def test_harris_and_bexar_are_not_eligible_refetches(self):
        by = {r["fips"]: r for r in matrix()}
        self.assertEqual(by["48201"]["reuse"], "blocked")
        self.assertEqual(by["48201"]["source_id"], "tx-harris-cad")
        self.assertEqual(by["48029"]["reuse"], "blocked")
        self.assertIsNone(by["48029"]["staged_parcels"])
        self.assertEqual(by["48439"]["source_id"], "tx-tarrant-ad")
        self.assertEqual(by["48439"]["reuse"], "eligible")
        self.assertIsNone(by["48439"]["staged_parcels"])
        self.assertIsNone(by["48439"]["commercial_universe"])

    def test_measured_extracts_are_not_called_complete(self):
        by = {r["fips"]: r for r in matrix()}
        # Dallas, Travis, Collin, Denton, Fort Bend, Williamson. Counts are local extracts.
        self.assertEqual(by["48113"]["staged_parcels"], 59645)
        self.assertEqual(by["48453"]["staged_parcels"], 30555)
        self.assertEqual(by["48085"]["staged_parcels"], 18039)
        self.assertEqual(by["48121"]["staged_parcels"], 13304)
        self.assertEqual(by["48157"]["staged_parcels"], 9698)
        self.assertEqual(by["48491"]["staged_parcels"], 11758)
        for fips in ("48113", "48453", "48085", "48121", "48157", "48491"):
            self.assertEqual(by[fips]["unique_ids"], by[fips]["staged_parcels"])
            self.assertIsNone(by[fips]["commercial_universe"])
            self.assertIsNotNone(by[fips]["org_owner_facts"])

    def test_located_files_without_a_rights_reading_are_not_ingested(self):
        by = {r["fips"]: r for r in matrix()}
        self.assertEqual(by["48039"]["reuse"], "reviewed")
        self.assertIsNone(by["48039"]["staged_parcels"])
        self.assertIsNone(by["48039"]["commercial_universe"])
        self.assertEqual(by["48167"]["reuse"], "private")
        self.assertEqual(by["48167"]["staged_parcels"], 9065)
        self.assertEqual(by["48355"]["reuse"], "private")
        self.assertEqual(by["48355"]["staged_parcels"], 12093)
        for fips in ("48167", "48355"):
            self.assertIsNone(by[fips]["commercial_universe"])
            self.assertNotEqual(by[fips]["reuse"], "eligible")
        self.assertEqual(by["48215"]["reuse"], "blocked")
        self.assertEqual(by["48339"]["reuse"], "blocked")
        self.assertEqual(by["48141"]["reuse"], "blocked")
        self.assertIsNone(by["48303"]["source_id"])
        self.assertEqual(by["48303"]["reuse"], "unknown")
