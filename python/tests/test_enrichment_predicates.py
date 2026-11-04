"""The predicates the registry's enrichment sources write: valid names, in step with the TypeScript vocabulary."""

import re
import unittest
from pathlib import Path

from factlot.facts import validate_fact
from factlot.registry.adapters import ny_pluto
from factlot.registry.store import ENRICHMENT_PREDICATES, MULTI_VALUED_PREDICATES

TS_SCHEMA = Path(__file__).resolve().parents[2] / "packages" / "schema" / "src" / "index.ts"


class TestEnrichmentPredicates(unittest.TestCase):
    def test_every_name_is_a_valid_predicate(self):
        for predicate in sorted(ENRICHMENT_PREDICATES):
            fact = {
                "subject": "fl:parcel:us-36061:1000090001", "predicate": predicate, "value": True, "as_of": "2026-11-04",
                "provenance": {"method": "public_record", "sources": [{"document_id": "fl:document:sha256-" + "0" * 64}]},
            }
            self.assertEqual(validate_fact(fact)["valid"], True, predicate)

    def test_typescript_vocabulary_lists_the_same_names(self):
        text = TS_SCHEMA.read_text()
        listed = set(re.findall(r'"((?:zoning|transaction|parcel|debt|entity)\.[a-z_]+)"', text))
        self.assertTrue(ENRICHMENT_PREDICATES <= listed, sorted(ENRICHMENT_PREDICATES - listed))

    def test_many_valued_predicates_are_known_predicates(self):
        self.assertTrue(MULTI_VALUED_PREDICATES <= ENRICHMENT_PREDICATES)

    def test_sec_predicates_are_registered(self):
        # debt.cmbs_loan: one fact per trust that holds a note of a building's loan; entity.parent: one per registrant
        # that lists the entity (two registrants may list one joint venture).
        for predicate in ("debt.cmbs_loan", "entity.parent"):
            self.assertIn(predicate, MULTI_VALUED_PREDICATES)
            self.assertIn(predicate, ENRICHMENT_PREDICATES)

    def test_pluto_writes_only_known_predicates(self):
        row = {c: "1" for c in ny_pluto.COLUMNS}
        row.update(landmark="x", splitzone="true", histdist="d", edesignum="E-1", ltdheight="LH", version="26v2")
        written = {p for p, _v, _u in ny_pluto.facts_of(row)}
        self.assertTrue(written <= ENRICHMENT_PREDICATES, sorted(written - ENRICHMENT_PREDICATES))
