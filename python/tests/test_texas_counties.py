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
