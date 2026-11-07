"""The Texas county matrix is a status list, not a parcel inventory."""

import unittest

from factlot.registry.texas_counties import matrix, texas_fips
from factlot.registry.texas_extracts import EXTRACTS, conserved


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
        self.assertGreater(len(unknown), 150)
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
        self.assertEqual(by["48061"]["reuse"], "private")
        self.assertEqual(by["48061"]["staged_parcels"], 14173)
        self.assertEqual(by["48187"]["staged_parcels"], 4021)
        self.assertEqual(by["48041"]["staged_parcels"], 7580)
        self.assertEqual(by["48181"]["staged_parcels"], 6613)
        self.assertEqual(by["48329"]["staged_parcels"], 7641)
        self.assertEqual(by["48441"]["staged_parcels"], 6688)
        self.assertEqual(by["48005"]["staged_parcels"], 2778)
        self.assertEqual(by["48005"]["reuse"], "private")
        self.assertEqual(by["48257"]["staged_parcels"], 3429)
        self.assertEqual(by["48021"]["reuse"], "private")
        self.assertEqual(by["48021"]["staged_parcels"], 1987)
        self.assertEqual(by["48245"]["staged_parcels"], 9454)
        self.assertEqual(by["48291"]["staged_parcels"], 2685)
        self.assertEqual(by["48485"]["staged_parcels"], 5359)
        self.assertEqual(by["48409"]["staged_parcels"], 2886)
        self.assertEqual(by["48471"]["staged_parcels"], 1604)
        self.assertEqual(by["48221"]["staged_parcels"], 1726)
        self.assertEqual(by["48055"]["staged_parcels"], 1349)
        self.assertEqual(by["48013"]["staged_parcels"], 2337)
        self.assertEqual(by["48199"]["staged_parcels"], 1419)
        self.assertEqual(by["48493"]["staged_parcels"], 1092)
        self.assertEqual(by["48347"]["reuse"], "blocked")
        self.assertIsNone(by["48349"]["staged_parcels"])
        self.assertIsNone(by["48071"]["staged_parcels"])
        self.assertIsNone(by["48401"]["staged_parcels"])
        self.assertIsNone(by["48265"]["staged_parcels"])
        self.assertIsNone(by["48373"]["staged_parcels"])
        self.assertEqual(by["48213"]["reuse"], "blocked")
        self.assertEqual(by["48361"]["staged_parcels"], 2348)
        self.assertEqual(by["48183"]["staged_parcels"], 6435)
        self.assertEqual(by["48251"]["staged_parcels"], 4416)
        self.assertEqual(by["48219"]["staged_parcels"], 1475)
        self.assertEqual(by["48285"]["staged_parcels"], 1371)
        self.assertEqual(by["48165"]["staged_parcels"], 1292)
        self.assertEqual(by["48019"]["staged_parcels"], 888)
        self.assertIsNone(by["48231"]["staged_parcels"])
        self.assertIsNone(by["48397"]["staged_parcels"])
        self.assertIsNone(by["48139"]["staged_parcels"])
        self.assertIsNone(by["48375"]["staged_parcels"])
        self.assertIsNone(by["48381"]["staged_parcels"])
        self.assertIsNone(by["48001"]["staged_parcels"])
        self.assertIsNone(by["48037"]["staged_parcels"])
        self.assertIsNone(by["48367"]["staged_parcels"])
        self.assertEqual(by["48135"]["staged_parcels"], 7036)
        self.assertEqual(by["48135"]["reuse"], "private")
        self.assertEqual(by["48217"]["staged_parcels"], 1494)
        self.assertEqual(by["48499"]["staged_parcels"], 1867)
        self.assertEqual(by["48049"]["staged_parcels"], 1615)
        self.assertEqual(by["48321"]["staged_parcels"], 2004)
        self.assertEqual(by["48277"]["staged_parcels"], 2825)
        self.assertEqual(by["48477"]["staged_parcels"], 1352)
        self.assertEqual(by["48227"]["staged_parcels"], 2298)
        self.assertEqual(by["48171"]["staged_parcels"], 2396)
        self.assertEqual(by["48449"]["staged_parcels"], 1844)
        self.assertEqual(by["48025"]["staged_parcels"], 1018)
        self.assertEqual(by["48419"]["staged_parcels"], 1359)
        self.assertEqual(by["48407"]["staged_parcels"], 586)
        self.assertIsNone(by["48331"]["staged_parcels"])
        self.assertEqual(by["48185"]["reuse"], "blocked")
        self.assertIsNone(by["48465"]["staged_parcels"])
        self.assertEqual(by["48061"]["staged_parcels"], 14173)
        self.assertEqual(by["48187"]["staged_parcels"], 4021)
        self.assertEqual(by["48041"]["staged_parcels"], 7580)
        for fips in ("48061", "48187", "48041"):
            self.assertIsNone(by[fips]["commercial_universe"])
        for fips in ("48167", "48355"):
            self.assertIsNone(by[fips]["commercial_universe"])
            self.assertNotEqual(by[fips]["reuse"], "eligible")
        self.assertEqual(by["48215"]["reuse"], "blocked")
        self.assertEqual(by["48339"]["reuse"], "blocked")
        self.assertEqual(by["48141"]["reuse"], "blocked")
        self.assertIsNone(by["48303"]["source_id"])
        self.assertEqual(by["48303"]["reuse"], "unknown")

    def test_dates_are_labeled_and_extract_rows_balance(self):
        by = {r["fips"]: r for r in matrix()}
        self.assertIsNone(by["48121"]["snapshot_as_of"])
        self.assertIn("retrieval", by["48121"]["as_of_basis"])
        self.assertNotIn("2026-11-06", by["48121"]["snapshot_as_of"] or "")
        self.assertIn("zip member", by["48113"]["as_of_basis"])
        self.assertIsNone(by["48491"]["snapshot_as_of"])
        self.assertIn("2026-11-01", by["48491"]["as_of_basis"])
        self.assertIn("2026-11-05", by["48491"]["as_of_basis"])
        self.assertGreaterEqual(len(EXTRACTS), 5)
        for row in EXTRACTS:
            self.assertTrue(conserved(row), row["source_id"])
            self.assertEqual(row["duplicate_stored_ids"], 0)
            self.assertNotIn("rejection_ids", row)
            for value in row["drops"].values():
                self.assertIsInstance(value, int)
