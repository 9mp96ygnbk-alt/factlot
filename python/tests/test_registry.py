"""Registry core tests.

All records here are SYNTHETIC test fixtures (invented names, accounts, and values) used only
to exercise code paths. They are not real Texas data and must never be published as such.
"""

import tempfile
import unittest
from pathlib import Path

import factlot
from factlot.registry import (
    EntityRecord,
    ParcelRecord,
    Registry,
    Source,
    is_organization,
    normalize_address,
    normalize_name,
)

SRC_ROLL = Source("test-county-roll", "Example County Appraisal District (synthetic)", "Appraisal roll",
                  "https://example.invalid/roll", "48", county_fips="999", license="Synthetic test data",
                  ai_use="permitted", redistribution="permitted", terms_reviewed="2026-11-02")
SRC_ENT = Source("test-entities", "Example State Comptroller (synthetic)", "Entity list",
                 "https://example.invalid/entities", "48", license="Synthetic test data",
                 ai_use="permitted", redistribution="attribution_required", attribution="Example State")


def write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text)
    return p


ROLL_2025 = [
    ParcelRecord("999", "0001-000-0001", "F1", account="A1", situs_address="100 Main Street, Suite 400",
                 owner_name="Lonestar Office Holdings, L.L.C.", owner_mailing_address="PO Box 1, Example TX",
                 land_area_sf=40000, improvement_area_sf=120000, year_built=1998, market_value=21_000_000, tax_year=2025),
    ParcelRecord("999", "0001-000-0002", "F2", account="A2", situs_address="5 Industrial Boulevard",
                 owner_name="Gulf Logistics LP", market_value=9_500_000, tax_year=2025),
    ParcelRecord("999", "0001-000-0003", "A", account="A3", situs_address="12 Elm Street",
                 owner_name="Jane Q Example", market_value=350_000, tax_year=2025),  # single-family: out of scope
    ParcelRecord("999", "0001-000-0004", "B", account="A4", situs_address="200 River Road",
                 owner_name="John Example", market_value=4_000_000, tax_year=2025),  # person owner: not stored
    ParcelRecord("999", "0001-000-0005", "F1", account="A5", situs_address="7 Market Street",
                 owner_confidential=True, market_value=1_000_000, tax_year=2025),  # withheld under §25.025
    ParcelRecord("999", "0001-000-0006", "F1", account="A6", situs_address="9 Commerce Drive",
                 owner_name="Twin Name Properties LLC", tax_year=2025),
    ParcelRecord("999", "--", "F1", account="BAD"),  # invalid APN
]

ENTITIES = [
    EntityRecord("LONESTAR OFFICE HOLDINGS LLC", "us-tx", "0801111111", taxpayer_number="32000000001",
                 state_of_formation="TX", status="ACTIVE"),
    EntityRecord("Twin Name Properties, LLC", "us-tx", "0802222222"),
    EntityRecord("Twin Name Properties LLC", "us-tx", "0803333333"),  # same normalized name: ambiguous
    EntityRecord("No File Number Inc", "us-tx", None),  # no registry number: skipped
]


class Normalization(unittest.TestCase):
    def test_names_and_addresses(self):
        self.assertEqual(normalize_name("The Acme Properties, L.L.C."), "ACME PROPERTIES LLC")
        self.assertEqual(normalize_name("Gulf Logistics, Limited Partnership"), "GULF LOGISTICS LP")
        self.assertEqual(normalize_name("Smith & Sons Incorporated"), "SMITH AND SONS INC")
        self.assertEqual(normalize_address("100 Main Street, Suite 400"), "100 MAIN ST STE 400")

    def test_person_detection_is_conservative(self):
        self.assertTrue(is_organization("Gulf Logistics LP"))
        self.assertTrue(is_organization("Example Real Estate Investment Trust"))
        self.assertFalse(is_organization("Jane Q Example"))
        self.assertFalse(is_organization("Smith Family Trust"))


class RegistryCore(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.reg = Registry(self.tmp / "registry.db")
        self.reg.add_source(SRC_ROLL)
        self.reg.add_source(SRC_ENT)
        self.snap25 = self.reg.add_snapshot("test-county-roll", write(self.tmp, "roll-2025.txt", "synthetic 2025"), as_of="2025-07-25")
        self.ent = self.reg.add_snapshot("test-entities", write(self.tmp, "entities.csv", "synthetic entities"), as_of="2026-10-01")

    def tearDown(self):
        self.reg.close()

    def test_scope_privacy_and_stats(self):
        s = self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48", account_system="test-account")
        self.assertEqual((s.seen, s.kept, s.skipped_out_of_scope, s.skipped_invalid), (7, 5, 1, 1))
        self.assertEqual(s.owners_person_or_withheld, 2)
        # Single-family parcel never enters the registry.
        self.assertIsNone(self.reg.resolve_parcel("48", "999", "0001-000-0003"))
        # Person-owned multifamily parcel is kept, but the person's name is not.
        person_parcel = self.reg.get(self.reg.resolve_parcel("48", "999", "0001-000-0004"))
        self.assertNotIn("ownership.owner_of_record", {f["predicate"] for f in person_parcel["facts"]})
        self.assertNotIn("JOHN", str(person_parcel))
        withheld = self.reg.get(self.reg.resolve_parcel("48", "999", "0001-000-0005"))
        self.assertNotIn("ownership.owner_of_record", {f["predicate"] for f in withheld["facts"]})

    def test_every_fact_is_cited_and_valid(self):
        self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48", account_system="test-account")
        urn = self.reg.resolve_external("test-account", "A1")
        self.assertEqual(urn, factlot.parcel_id("48", "999", "0001-000-0001").urn)
        record = self.reg.get(urn)
        self.assertEqual(record["kind"], "parcel")
        self.assertGreater(len(record["facts"]), 5)
        for fact in record["facts"]:
            self.assertEqual(factlot.validate_fact(fact), {"valid": True, "issues": []}, fact)
            src = fact["provenance"]["sources"][0]
            self.assertEqual(src["document_id"], self.snap25.document_id)
            self.assertEqual(src["section"], "account A1")
            self.assertEqual(fact["rights"]["ai_use"], "permitted")
        value = next(f for f in record["facts"] if f["predicate"] == "parcel.market_value")
        self.assertEqual((value["value"], value["unit"], value["as_of"]), (21_000_000, "USD", "2025-07-25"))

    def test_entities_and_owner_linking_in_either_order(self):
        self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48")
        es = self.reg.ingest_entities(ENTITIES, self.ent)
        self.assertEqual((es.kept, es.skipped_invalid), (3, 1))
        links = self.reg.link_owners()
        self.assertEqual(links, {"linked": 1, "ambiguous": 1, "unmatched": 1})
        self.assertEqual(self.reg.link_owners(), links, "linking is idempotent")
        lonestar = factlot.entity_id("us-tx", "0801111111").urn
        owned = self.reg.parcels_owned_by(lonestar)
        self.assertEqual([o["urn"] for o in owned], [factlot.parcel_id("48", "999", "0001-000-0001").urn])
        self.assertEqual(owned[0]["confidence"], 0.9)
        rel = self.reg.get(lonestar)["relationships"][0]
        self.assertEqual((rel["type"], rel["method"]), ("owns", "inferred"))
        self.assertEqual(self.reg.resolve_external("us-tx-taxpayer", "32000000001"), lonestar)
        ent_fact = next(f for f in self.reg.get(lonestar)["facts"] if f["predicate"] == "entity.legal_name")
        self.assertEqual(ent_fact["rights"]["redistribution"], "attribution_required")
        self.assertEqual(ent_fact["rights"]["attribution"], "Example State")

    def test_reingest_is_idempotent_and_newer_snapshot_wins(self):
        self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48")
        before = self.reg.stats()
        again = self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48")
        self.assertEqual(again.facts_written, 0)
        self.assertEqual(self.reg.stats(), before)
        snap26 = self.reg.add_snapshot("test-county-roll", write(self.tmp, "roll-2026.txt", "synthetic 2026"), as_of="2026-07-25")
        updated = [ParcelRecord("999", "0001-000-0001", "F1", account="A1", situs_address="100 Main Street, Suite 400",
                                owner_name="Lonestar Office Holdings LLC", market_value=19_750_000, tax_year=2026)]
        self.reg.ingest_parcels(updated, snap26, state_fips="48")
        urn = factlot.parcel_id("48", "999", "0001-000-0001").urn
        current = {f["predicate"]: f for f in self.reg.facts(urn)}
        self.assertEqual(current["parcel.market_value"]["value"], 19_750_000)
        self.assertEqual(current["parcel.market_value"]["as_of"], "2026-07-25")
        self.assertNotIn("parcel.year_built", current, "facts the newer roll did not restate become history, not current")
        history = [f for f in self.reg.facts(urn, history=True) if f["predicate"] == "parcel.market_value"]
        self.assertEqual([f["value"] for f in history], [19_750_000, 21_000_000])

    def test_sale_to_a_person_retires_the_old_owner(self):
        self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48")
        self.reg.ingest_entities(ENTITIES, self.ent)
        self.reg.link_owners()
        lonestar = factlot.entity_id("us-tx", "0801111111").urn
        self.assertEqual(len(self.reg.parcels_owned_by(lonestar)), 1)
        snap26 = self.reg.add_snapshot("test-county-roll", write(self.tmp, "roll-2026b.txt", "synthetic 2026b"), as_of="2026-07-25")
        sold = [ParcelRecord("999", "0001-000-0001", "F1", account="A1", situs_address="100 Main Street, Suite 400",
                             owner_name="Pat Example", market_value=19_750_000, tax_year=2026)]
        self.reg.ingest_parcels(sold, snap26, state_fips="48")
        self.reg.link_owners()
        urn = factlot.parcel_id("48", "999", "0001-000-0001").urn
        current = {f["predicate"] for f in self.reg.facts(urn)}
        self.assertNotIn("ownership.owner_of_record", current)
        self.assertEqual(self.reg.parcels_owned_by(lonestar), [], "stale ownership link is no longer current")
        self.assertEqual(self.reg.stats()["ownership_links"], 0)
        self.assertNotIn("PAT", str(self.reg.get(urn)))
        history = [f["value"] for f in self.reg.facts(urn, history=True) if f["predicate"] == "ownership.owner_of_record"]
        self.assertEqual(history, ["Lonestar Office Holdings, L.L.C."])

    def test_full_roll_retires_parcels_that_disappear(self):
        self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48", full_roll=True)
        snap26 = self.reg.add_snapshot("test-county-roll", write(self.tmp, "roll-2026c.txt", "synthetic 2026c"), as_of="2026-07-25")
        roll26 = [
            ParcelRecord("999", "0001-000-0001", "F1", situs_address="100 Main Street, Suite 400", market_value=20_000_000),
            ParcelRecord("999", "0001-000-0002", "A", situs_address="5 Industrial Boulevard"),  # reclassified out of scope
            # 0001-000-0004, -0005, -0006 no longer listed (e.g. merged into a new parcel)
        ]
        s = self.reg.ingest_parcels(roll26, snap26, state_fips="48", full_roll=True)
        self.assertEqual(s.retired, 4)
        kept = self.reg.get(factlot.parcel_id("48", "999", "0001-000-0001").urn)
        self.assertEqual(kept["status"], "current")
        gone = self.reg.get(factlot.parcel_id("48", "999", "0001-000-0002").urn)
        self.assertEqual(gone["status"], "not_in_latest_snapshot")
        self.assertEqual(gone["facts"], [], "no stale facts are presented as current")
        self.assertGreater(len(self.reg.facts(gone["urn"], history=True)), 0, "history is kept")
        again = self.reg.ingest_parcels(roll26, snap26, state_fips="48", full_roll=True)
        self.assertEqual(again.retired, 0, "retiring is idempotent")
        snap27 = self.reg.add_snapshot("test-county-roll", write(self.tmp, "roll-2027.txt", "synthetic 2027"), as_of="2027-07-25")
        self.reg.ingest_parcels([ParcelRecord("999", "0001-000-0002", "F2", situs_address="5 Industrial Boulevard")], snap27,
                                state_fips="48")
        self.assertEqual(self.reg.get(gone["urn"])["status"], "current", "a parcel that returns is current again")

    def test_search(self):
        self.reg.ingest_parcels(ROLL_2025, self.snap25, state_fips="48")
        self.reg.ingest_entities(ENTITIES, self.ent)
        hits = self.reg.search_address("100 main st")
        self.assertEqual([h["urn"] for h in hits], [factlot.parcel_id("48", "999", "0001-000-0001").urn])
        self.assertEqual(len(self.reg.search_entities("twin name properties")), 2)
        self.assertEqual(self.reg.search_entities("John Example"), [], "people are not searchable")

    def test_snapshot_ids_are_content_addressed(self):
        same = self.reg.add_snapshot("test-county-roll", write(self.tmp, "copy.txt", "synthetic 2025"), as_of="2025-07-25")
        self.assertEqual(same.document_id, self.snap25.document_id)
        self.assertEqual(same.document_id, factlot.document_id("synthetic 2025").urn)


if __name__ == "__main__":
    unittest.main()
