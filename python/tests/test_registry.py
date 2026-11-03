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
        self.assertEqual(links, {"linked": 1, "linked_by_review": 0, "ambiguous": 1, "unmatched": 1})
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


# --- fuzzy owner matching with human review (backlog C2) -----------------------------------------
# SYNTHETIC fixtures: every name below is invented. Expected scores are worked out by hand in the
# comments, from the documented rule (0.7 * token-sorted difflib ratio + 0.3 * distinctive-token
# overlap), not by running the code.

ROLL_FUZZY = [
    ParcelRecord("999", "0002-000-0001", "F1", account="F1", situs_address="1 Acme Way",
                 owner_name="ACME PROPERTIES L.L.C.", tax_year=2025),
    ParcelRecord("999", "0002-000-0002", "F1", account="F2", situs_address="2 Acme Way",
                 owner_name="Acme Properties LLC", tax_year=2025),  # same owner, second parcel
    ParcelRecord("999", "0002-000-0003", "F2", account="F3", situs_address="3 Dock Road",
                 owner_name="Gulf Logistics LP", tax_year=2025),  # transposed words in the registry
    ParcelRecord("999", "0002-000-0004", "F1", account="F4", situs_address="4 Storage Lane",
                 owner_name="Bluebonnet Storage Partners LP", tax_year=2025),  # typo in the registry
    ParcelRecord("999", "0002-000-0005", "B", account="F5", situs_address="5 Skyline Drive",
                 owner_name="Zenith Towers LP", tax_year=2025),  # shares no distinctive token with anyone
    ParcelRecord("999", "0002-000-0006", "F1", account="F6", situs_address="6 Twin Street",
                 owner_name="Twin Name Properties LLC", tax_year=2025),  # exact but ambiguous (two entities)
]

ENTITIES_FUZZY = [
    EntityRecord("ACME PROPERTY LLC", "us-tx", "0805000001"),  # singular/plural drift from the owner name
    EntityRecord("ACME PROPERTIES II LLC", "us-tx", "0805000002"),  # a series entity: must NOT be a candidate
    EntityRecord("ACME WIDGET MANUFACTURING CORP", "us-tx", "0805000003"),  # shares ACME only: must NOT be one
    EntityRecord("Logistics Gulf, L.P.", "us-tx", "0805000004"),
    EntityRecord("BLUEBONET STORAGE PARTNERS LP", "us-tx", "0805000005"),
    EntityRecord("Twin Name Properties, LLC", "us-tx", "0802222222"),
    EntityRecord("Twin Name Properties LLC", "us-tx", "0803333333"),
]

ACME_PROPERTY = factlot.entity_id("us-tx", "0805000001").urn
ACME_II = factlot.entity_id("us-tx", "0805000002").urn
ACME_WIDGET = factlot.entity_id("us-tx", "0805000003").urn
LOGISTICS_GULF = factlot.entity_id("us-tx", "0805000004").urn
BLUEBONET = factlot.entity_id("us-tx", "0805000005").urn
TWIN_A = factlot.entity_id("us-tx", "0802222222").urn
TWIN_B = factlot.entity_id("us-tx", "0803333333").urn

# Hand-computed expectations (sorted-token strings, longest common blocks counted by hand):
#   "ACME LLC PROPERTIES" (19) vs "ACME LLC PROPERTY" (17): common "ACME LLC PROPERT" = 16 chars
#     ratio = 2*16/36 = 0.8889; distinctive tokens {ACME} vs {ACME}: overlap 1
#     score = 0.7*32/36 + 0.3 = 0.9222
#   "BLUEBONNET LP PARTNERS STORAGE" (30) vs "BLUEBONET LP PARTNERS STORAGE" (29): one deleted N
#     ratio = 2*29/59 = 0.9831; {BLUEBONNET, STORAGE} vs {BLUEBONET, STORAGE} alike: overlap 1
#     score = 0.7*58/59 + 0.3 = 0.9881
#   "GULF LOGISTICS LP" vs "LOGISTICS GULF LP": identical once sorted: ratio 1, overlap 1, score 1
#   "ACME II LLC PROPERTIES" (22) vs "ACME LLC PROPERTIES" (19): common 19 chars
#     ratio = 2*19/41 = 0.9268; {ACME, II} vs {ACME}: overlap 1/2
#     score = 0.7*38/41 + 0.15 = 0.7988  (below the 0.85 threshold)
ACME_SCORE = 0.9222
BLUEBONNET_SCORE = 0.9881
ACME_II_SCORE = 0.7988


class FuzzyOwnerMatching(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.path = self.tmp / "registry.db"
        self.reg = self.build(self.path)

    def build(self, path: Path) -> Registry:
        reg = Registry(path)
        reg.add_source(SRC_ROLL)
        reg.add_source(SRC_ENT)
        roll = reg.add_snapshot("test-county-roll", write(self.tmp, "roll-fuzzy.txt", "synthetic fuzzy roll"), as_of="2025-07-25")
        ent = reg.add_snapshot("test-entities", write(self.tmp, "entities-fuzzy.csv", "synthetic fuzzy entities"), as_of="2026-10-01")
        reg.ingest_parcels(ROLL_FUZZY, roll, state_fips="48", account_system="test-account")
        reg.ingest_entities(ENTITIES_FUZZY, ent)
        reg.link_owners()
        return reg

    def tearDown(self):
        self.reg.close()

    def parcel(self, account: str) -> str:
        return self.reg.resolve_external("test-account", account)

    def test_similarity_rule_matches_hand_computation(self):
        from factlot.registry.normalize import name_similarity

        acme = name_similarity(normalize_name("ACME PROPERTIES L.L.C."), normalize_name("ACME PROPERTY LLC"))
        self.assertEqual((acme["score"], acme["ratio"], acme["token_overlap"], acme["shared_tokens"]),
                         (ACME_SCORE, 0.8889, 1.0, ["ACME"]))
        typo = name_similarity(normalize_name("Bluebonnet Storage Partners LP"), "BLUEBONET STORAGE PARTNERS LP")
        self.assertEqual((typo["score"], typo["ratio"], typo["token_overlap"]), (BLUEBONNET_SCORE, 0.9831, 1.0))
        swapped = name_similarity("GULF LOGISTICS LP", normalize_name("Logistics Gulf, L.P."))
        self.assertEqual((swapped["score"], swapped["ratio"], swapped["token_overlap"]), (1.0, 1.0, 1.0))
        series = name_similarity("ACME PROPERTIES LLC", "ACME PROPERTIES II LLC")
        self.assertEqual((series["score"], series["ratio"], series["token_overlap"]), (ACME_II_SCORE, 0.9268, 0.5))
        self.assertEqual(name_similarity("ACME PROPERTIES LLC", "ACME PROPERTIES LLC")["score"], 1.0)
        self.assertEqual(acme["rule"], "fuzzy_name_v1")

    def test_candidates_for_near_misses(self):
        acme = self.reg.fuzzy_owner_candidates("ACME PROPERTIES L.L.C.")
        self.assertEqual([(c["entity_urn"], c["score"]) for c in acme], [(ACME_PROPERTY, ACME_SCORE)])
        self.assertEqual(acme[0]["reason"], {"rule": "fuzzy_name_v1", "ratio": 0.8889, "token_overlap": 1.0,
                                             "shared_tokens": ["ACME"]})
        swapped = self.reg.fuzzy_owner_candidates("Gulf Logistics LP")
        self.assertEqual([(c["entity_urn"], c["score"]) for c in swapped], [(LOGISTICS_GULF, 1.0)])
        typo = self.reg.fuzzy_owner_candidates("Bluebonnet Storage Partners LP")
        self.assertEqual([(c["entity_urn"], c["score"]) for c in typo], [(BLUEBONET, BLUEBONNET_SCORE)])
        for c in acme + swapped + typo:
            self.assertTrue(0.0 <= c["score"] <= 1.0)

    def test_non_candidates(self):
        acme = {c["entity_urn"] for c in self.reg.fuzzy_owner_candidates("ACME PROPERTIES L.L.C.")}
        self.assertNotIn(ACME_WIDGET, acme, "sharing one distinctive token is not a match")
        self.assertNotIn(ACME_II, acme, "a series entity (II) is not a candidate for the parent name")
        self.assertEqual(self.reg.fuzzy_owner_candidates("Zenith Towers LP"), [], "no shared token: no pool")
        self.assertEqual(self.reg.fuzzy_owner_candidates("Texas Properties LLC"), [], "stop tokens only: never matched")
        # A lower threshold admits the series entity, so the threshold is what keeps it out.
        self.assertIn(ACME_II, {c["entity_urn"] for c in self.reg.fuzzy_owner_candidates("ACME PROPERTIES L.L.C.", threshold=0.75)})
        # Tokens shared by more entities than the cap are too common to form a pool (ACME: 3 entities).
        self.assertEqual(self.reg.fuzzy_owner_candidates("ACME PROPERTIES L.L.C.", max_token_frequency=2), [])

    def test_ambiguous_exact_names_are_queued_with_every_match(self):
        twins = self.reg.fuzzy_owner_candidates("Twin Name Properties LLC")
        self.assertEqual([(c["entity_urn"], c["score"]) for c in twins], [(TWIN_A, 1.0), (TWIN_B, 1.0)])

    def test_queue_lifecycle(self):
        before = self.reg.stats()
        self.assertEqual(before["ownership_links"], 0, "nothing matched exactly and unambiguously")
        counts = self.reg.queue_fuzzy_owner_matches()
        # Unlinked owners: ACME, GULF, BLUEBONNET, ZENITH, TWIN. Candidates: 1 + 1 + 1 + 0 + 2.
        self.assertEqual(counts, {"owners_considered": 5, "owners_with_candidates": 4, "queued": 5, "already_queued": 0})
        self.assertEqual(self.reg.stats()["ownership_links"], 0, "queueing never links anything")
        self.assertEqual(self.reg.stats()["owner_matches_pending_review"], 5)
        pending = self.reg.review_queue()
        self.assertEqual(len(pending), 5)
        self.assertTrue(all(r["status"] == "pending" and r["decided_at"] is None for r in pending))
        acme = next(r for r in pending if r["entity_urn"] == ACME_PROPERTY)
        self.assertEqual((acme["owner_name"], acme["owner_key"], acme["parcel_count"], acme["score"]),
                         ("ACME PROPERTIES L.L.C.", "ACME PROPERTIES LLC", 2, ACME_SCORE))
        self.assertEqual(acme["parcel_urn"], self.parcel("F1"))
        self.assertEqual(acme["entity_label"], "ACME PROPERTY LLC")
        self.assertEqual(acme["reason"]["shared_tokens"], ["ACME"])

        # Accept: links every parcel with that owner name, confidence capped at 0.8, note names the reviewer.
        decision = self.reg.decide_owner_match(acme["review_id"], True, "reviewer-one")
        self.assertEqual(decision, {"review_id": acme["review_id"], "status": "accepted", "decided_by": "reviewer-one",
                                    "links_created": 2})
        owned = self.reg.parcels_owned_by(ACME_PROPERTY)
        self.assertEqual({o["urn"] for o in owned}, {self.parcel("F1"), self.parcel("F2")})
        self.assertTrue(all(o["confidence"] == 0.8 for o in owned))
        rel = self.reg.get(self.parcel("F1"))["relationships"]
        self.assertEqual(len(rel), 1)
        self.assertEqual((rel[0]["from_urn"], rel[0]["type"], rel[0]["method"], rel[0]["confidence"]),
                         (ACME_PROPERTY, "owns", "inferred", 0.8))
        self.assertLess(rel[0]["confidence"], 0.9, "a reviewed link ranks below an exact match")
        self.assertIn("reviewer-one", rel[0]["basis"])
        self.assertIn("fuzzy_name_v1", rel[0]["basis"])
        self.assertIn(str(ACME_SCORE), rel[0]["basis"])
        self.assertEqual(self.reg.stats()["ownership_links"], 2)
        for fact in self.reg.get(self.parcel("F1"))["facts"]:
            self.assertEqual(factlot.validate_fact(fact)["valid"], True)
        accepted = self.reg.review_queue(status="accepted")
        self.assertEqual([(r["review_id"], r["decided_by"]) for r in accepted], [(acme["review_id"], "reviewer-one")])
        self.assertIsNotNone(accepted[0]["decided_at"])

        # Reject: no link, and the pair is never queued again.
        gulf = next(r for r in self.reg.review_queue() if r["entity_urn"] == LOGISTICS_GULF)
        self.assertEqual(self.reg.decide_owner_match(gulf["review_id"], False, "reviewer-two")["links_created"], 0)
        self.assertEqual(self.reg.parcels_owned_by(LOGISTICS_GULF), [])
        again = self.reg.queue_fuzzy_owner_matches()
        self.assertEqual(again["queued"], 0)
        self.assertEqual(again["owners_considered"], 4, "the accepted owner is no longer considered")
        self.assertNotIn(LOGISTICS_GULF, {r["entity_urn"] for r in self.reg.review_queue()})
        self.assertEqual([r["entity_urn"] for r in self.reg.review_queue(status="rejected")], [LOGISTICS_GULF])

        # Choosing one of two ambiguous candidates rejects the other.
        twin = next(r for r in self.reg.review_queue() if r["entity_urn"] == TWIN_A)
        self.reg.decide_owner_match(twin["review_id"], True, "reviewer-one")
        self.assertEqual({r["entity_urn"] for r in self.reg.review_queue(status="rejected")}, {LOGISTICS_GULF, TWIN_B})
        self.assertEqual([o["urn"] for o in self.reg.parcels_owned_by(TWIN_A)], [self.parcel("F6")])
        self.assertEqual(self.reg.parcels_owned_by(TWIN_B), [])

        # Decisions are final.
        with self.assertRaises(ValueError):
            self.reg.decide_owner_match(acme["review_id"], False, "reviewer-two")
        with self.assertRaises(ValueError):
            self.reg.decide_owner_match(twin["review_id"], True, "reviewer-two")
        with self.assertRaises(ValueError):
            self.reg.decide_owner_match(999999, True, "reviewer-two")
        with self.assertRaises(ValueError):
            self.reg.decide_owner_match(next(r for r in self.reg.review_queue())["review_id"], True, "  ")

        # link_owners() re-applies accepted decisions (e.g. after a newer roll) and stays idempotent.
        links = self.reg.link_owners()
        self.assertEqual(links, {"linked": 0, "linked_by_review": 3, "ambiguous": 0, "unmatched": 3})
        self.assertEqual(self.reg.stats()["ownership_links"], 3)
        self.assertEqual(self.reg.link_owners(), links)
        roll26 = self.reg.add_snapshot("test-county-roll", write(self.tmp, "roll-fuzzy-26.txt", "synthetic fuzzy 2026"), as_of="2026-07-25")
        self.reg.ingest_parcels([ParcelRecord("999", "0002-000-0001", "F1", account="F1", situs_address="1 Acme Way",
                                              owner_name="Acme Properties, LLC", tax_year=2026)], roll26, state_fips="48")
        self.reg.link_owners()
        rel = self.reg.get(self.parcel("F1"))["relationships"]
        self.assertEqual([(r["from_urn"], r["as_of"], r["confidence"]) for r in rel], [(ACME_PROPERTY, "2026-07-25", 0.8)])

    def test_rejected_pairs_are_never_requeued_even_at_a_lower_threshold(self):
        self.reg.queue_fuzzy_owner_matches()
        for row in self.reg.review_queue():
            self.reg.decide_owner_match(row["review_id"], False, "reviewer-one")
        self.assertEqual(self.reg.review_queue(), [])
        counts = self.reg.queue_fuzzy_owner_matches(threshold=0.5, limit_per_owner=10)
        self.assertEqual(counts["already_queued"], 5, "every rejected pair was found again and skipped")
        rejected = {(r["owner_key"], r["entity_urn"]) for r in self.reg.review_queue(status="rejected", limit=1000)}
        pending = {(r["owner_key"], r["entity_urn"]) for r in self.reg.review_queue(limit=1000)}
        self.assertEqual(rejected & pending, set())
        self.assertIn(("ACME PROPERTIES LLC", ACME_II), pending, "the lower threshold adds new pairs only")
        self.assertEqual(self.reg.stats()["ownership_links"], 0)

    def test_candidates_are_deterministic(self):
        first = self.reg.fuzzy_owner_candidates("ACME PROPERTIES L.L.C.", threshold=0.5)
        second = self.reg.fuzzy_owner_candidates("ACME PROPERTIES L.L.C.", threshold=0.5)
        self.assertEqual(first, second)
        self.assertGreater(len(first), 1)
        self.assertEqual([c["score"] for c in first], sorted((c["score"] for c in first), reverse=True))
        other = self.build(self.tmp / "other.db")
        try:
            other.queue_fuzzy_owner_matches()
            self.reg.queue_fuzzy_owner_matches()
            strip = lambda rows: [(r["owner_key"], r["entity_urn"], r["score"], r["reason"]) for r in rows]  # noqa: E731
            self.assertEqual(strip(self.reg.review_queue()), strip(other.review_queue()))
        finally:
            other.close()

    def test_older_registry_file_is_upgraded_in_place(self):
        # Simulate a file written before schema version 2: no token index, no review queue.
        self.reg.db.executescript("DROP TABLE owner_match_review; DROP TABLE name_tokens; "
                                  "UPDATE meta SET value = '1' WHERE key = 'schema_version';")
        self.reg.db.commit()
        self.reg.close()
        self.reg = Registry(self.path)
        self.assertEqual(self.reg.db.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()[0], "2")
        self.assertEqual(self.reg.stats()["entities"], 7, "existing data is untouched")
        counts = self.reg.queue_fuzzy_owner_matches()
        self.assertEqual(counts["queued"], 5, "the token index is rebuilt from name_index on demand")
        self.assertEqual(self.reg.rebuild_name_tokens(), 7)


if __name__ == "__main__":
    unittest.main()
