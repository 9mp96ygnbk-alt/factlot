"""SEC Exhibit 21 (subsidiaries of the registrant) adapter tests on SYNTHETIC exhibits that copy the layouts in use.

The registrant, its subsidiaries, accession numbers and every entity file number here are invented; nothing is SEC
data or a real company's list.
"""

import tempfile
import unittest
from pathlib import Path

from factlot.facts import validate_fact
from factlot.registry import EntityRecord, Registry
from factlot.registry.adapters import sec_exhibit21 as ex

TABLE = """<html><body><p>EX-21 3 example-ex21.htm EX-21</p>
<p>Exhibit 21</p><p>SUBSIDIARIES OF EXAMPLE RETAIL HOLDINGS, INC.</p>
<p>Pursuant to Item 601(b)(21) of Regulation S-K, the names of other subsidiaries are omitted.</p>
<table>
<tr><td>Name of Subsidiary</td><td>Jurisdiction of Organization</td><td>Percent Owned</td></tr>
<tr><td>Example Stores Texas, LLC</td><td>Texas</td><td>100%</td></tr>
<tr><td>Example Property Holdings, LLC</td><td>Delaware, U.S.</td><td>100%</td></tr>
<tr><td>Example Twin Holdings LLC</td><td>State of Texas</td><td>100%</td></tr>
<tr><td>Example Dissolved Co</td><td>Texas</td><td>100%</td></tr>
<tr><td>Example Elsewhere Ltd</td><td>England and Wales</td><td>100%</td></tr>
<tr><td>Example Registrant Holdings, Inc.</td><td>Delaware</td><td>100%</td></tr>
<tr><td>Example Nowhere LLC</td><td>Ohio</td><td>100%</td></tr>
<tr><td>Example Mismatch LLC</td><td>Nevada</td><td>100%</td></tr>
<tr><td>Example Shell LLC</td><td>Texas</td><td>100%</td></tr>
</table></body></html>"""


def write(tmp: Path, name: str, text: str) -> Path:
    p = tmp / name
    p.write_text(text, encoding="utf-8")
    return p


class TestParsing(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def names(self, text: str):
        subs, stats = ex.read_subsidiaries(write(self.tmp, "e.htm", text))
        return [(s.name, s.state) for s in subs], stats

    def test_a_table_with_a_jurisdiction_column(self):
        subs, stats = self.names(TABLE)
        self.assertIn(("Example Stores Texas, LLC", "tx"), subs)
        self.assertIn(("Example Property Holdings, LLC", "de"), subs)  # "Delaware, U.S."
        self.assertIn(("Example Twin Holdings LLC", "tx"), subs)  # "State of Texas"
        self.assertIn(("Example Elsewhere Ltd", None), subs)  # England and Wales: recognised, not a US state
        self.assertEqual(stats.foreign, 1)
        # the header row, the title and the prose line are not subsidiaries
        self.assertFalse([n for n, _ in subs if n.startswith(("Name of", "SUBSIDIARIES", "Pursuant", "Exhibit", "EX-21"))])

    def test_names_followed_by_a_bracketed_or_parenthesised_jurisdiction(self):
        subs, _ = self.names("<p>Alpha Stores LLC [Ohio]</p><p>Beta Brands, Inc. (MN)</p><p>Gamma Holdings, a Delaware limited liability company</p>"
                             "<p>Delta Realty LP - Texas</p>")
        self.assertEqual(subs, [("Alpha Stores LLC", "oh"), ("Beta Brands, Inc.", "mn"), ("Gamma Holdings", "de"),
                                ("Delta Realty LP", "tx")])

    def test_names_listed_under_jurisdiction_headings(self):
        subs, _ = self.names("<p>Delaware</p><p>Epsilon One LLC</p><p>Epsilon Two LLC</p><p>Texas:</p><p>Epsilon Three LP</p>"
                             "<p>Canada</p><p>Epsilon Four ULC</p>")
        self.assertEqual(subs, [("Epsilon One LLC", "de"), ("Epsilon Two LLC", "de"), ("Epsilon Three LP", "tx"),
                                ("Epsilon Four ULC", None)])

    def test_an_incorporated_state_line_after_the_name(self):
        subs, stats = self.names("<p>Zeta Health LLC</p><p>Incorporated State: Virginia</p><p>Business Name: Zeta Hospital</p>"
                                 "<p>Eta Health Inc.</p><p>Incorporated State: South Carolina</p>")
        self.assertEqual(subs, [("Zeta Health LLC", "va"), ("Eta Health Inc.", "sc")])
        self.assertEqual((stats.subsidiaries, stats.with_jurisdiction, stats.no_jurisdiction), (2, 2, 0))

    def test_a_default_jurisdiction_statement_and_trade_name_sections(self):
        subs, _ = self.names("<p>(The state of incorporation of each subsidiary is Virginia, except as noted below)</p>"
                             "<p>Theta Hotels, LLC</p><p>Iota Hotels, LLC</p><p>Also Doing Business As:</p><p>Hotel Brand</p>")
        self.assertEqual(subs, [("Theta Hotels, LLC", "va"), ("Iota Hotels, LLC", "va")])

    def test_dates_after_the_jurisdiction_and_stacked_lines_in_one_cell(self):
        subs, _ = self.names("<table><tr><td>Kappa Corp.</td><td>Maryland (6/28/2005)</td></tr>"
                             "<tr><td>Lambda Corp.</td><td>California, October 11, 1984</td></tr>"
                             "<tr><td>Mu One LLC<br>Mu Two LLC</td><td>Georgia<br>Florida</td></tr></table>")
        self.assertEqual(subs, [("Kappa Corp.", "md"), ("Lambda Corp.", "ca"), ("Mu One LLC", "ga"), ("Mu Two LLC", "fl")])

    def test_jurisdiction_words(self):
        self.assertEqual(ex.jurisdiction_of("DE"), ("DE", "de"))
        self.assertIsNone(ex.jurisdiction_of("Or"))  # an ordinary word, not Oregon
        self.assertEqual(ex.jurisdiction_of("Delaware limited liability company"), ("Delaware limited liability company", "de"))
        self.assertEqual(ex.jurisdiction_of("Cayman Islands"), ("Cayman Islands", None))
        self.assertIsNone(ex.jurisdiction_of("Walmart"))

    def test_plain_text_exhibit(self):
        p = write(self.tmp, "e.txt", "Acme Stores LLC (Texas)\nAcme Land LP (Delaware)\n")
        subs, _ = ex.read_subsidiaries(p)
        self.assertEqual([(s.name, s.state) for s in subs], [("Acme Stores LLC", "tx"), ("Acme Land LP", "de")])


class TestMatching(unittest.TestCase):
    FILING = ex.Filing("999001", "Example Retail Holdings, Inc.", "DE", "0000999001-26-000007", "10-K", "2026-03-14", "2026-01-31",
                       "EX-21")

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "registry.db"
        reg = Registry(self.db)
        reg.add_source(ex_source := ex.Source("test-entities", "Example State (synthetic)", "Entities",
                                              "https://example.invalid/entities", "48", license="Synthetic",
                                              ai_use="permitted", redistribution="permitted"))
        p = write(self.tmp, "entities.csv", "synthetic entities")
        snap = reg.add_snapshot(ex_source.source_id, p, "2026-10-01")
        reg.ingest_entities([
            EntityRecord("EXAMPLE STORES TEXAS LLC", "us-tx", "0800000001", state_of_formation="TX", status="ACTIVE"),
            # a Delaware company registered in Texas as a foreign entity
            EntityRecord("Example Property Holdings, L.L.C.", "us-tx", "0800000002", state_of_formation="DE", status="ACTIVE"),
            # two same-name Texas entities: ambiguous
            EntityRecord("Example Twin Holdings LLC", "us-tx", "0800000003", state_of_formation="TX", status="ACTIVE"),
            EntityRecord("Example Twin Holdings, LLC", "us-tx", "0800000004", state_of_formation="TX", status="ACTIVE"),
            EntityRecord("Example Dissolved Co", "us-tx", "0800000005", state_of_formation="TX", status="DISSOLVED"),
            EntityRecord("Example Mismatch LLC", "us-tx", "0800000006", state_of_formation="TX", status="ACTIVE"),
            EntityRecord("Example Registrant Holdings, Inc.", "us-tx", "0800000007", state_of_formation="DE", status="ACTIVE"),
            # unrelated
            EntityRecord("Example Unrelated LLC", "us-tx", "0800000008", state_of_formation="TX", status="ACTIVE"),
        ], snap)
        reg.close()
        self.path = write(self.tmp, "ex21.htm", TABLE)

    def facts(self, urn: str, predicate: str = "entity.parent"):
        reg = Registry.open_readonly(self.db)
        try:
            return [f for f in reg.facts(urn) if f["predicate"] == predicate]
        finally:
            reg.close()

    def test_links_need_an_exact_name_and_the_jurisdiction(self):
        stats = ex.build(self.path, self.db, self.FILING)
        m = stats.match
        self.assertEqual(m.subsidiaries, 9)
        self.assertEqual(m.matched, 3)  # stores (registry state); property holdings and registrant holdings (formation state)
        self.assertEqual((m.matched_registry_state, m.matched_formation_state), (1, 2))
        self.assertEqual(m.foreign_or_unknown_jurisdiction, 1)
        self.assertEqual(m.ambiguous, 1)  # two Twin Holdings
        self.assertEqual(m.entity_ended, 1)  # Example Dissolved Co
        self.assertEqual(m.jurisdiction_differs, 1)  # Example Mismatch: the exhibit says Nevada, the registry Texas
        self.assertEqual(m.not_in_registry, 2)  # Example Nowhere, Example Shell
        self.assertEqual(stats.ingest.kept, 3)

        (f,) = self.facts("fl:entity:us-tx:0800000001")
        self.assertEqual(f["provenance"]["method"], "inferred")
        self.assertEqual(f["provenance"]["confidence"], 0.9)
        self.assertEqual(f["value"]["parent"], {"name": "Example Retail Holdings, Inc.", "cik": "0000999001",
                                                "urn": "fl:entity:us-sec:0000999001"})
        self.assertEqual(f["value"]["listed_as"], {"name": "Example Stores Texas, LLC", "jurisdiction": "Texas"})
        self.assertEqual(f["value"]["filing"]["accession"], "0000999001-26-000007")
        self.assertEqual(f["value"]["match"], {"rule": "registry_state", "registry_jurisdiction_state": "tx"})
        self.assertIn("line", f["provenance"]["sources"][0]["section"])
        self.assertTrue(validate_fact(f)["valid"], validate_fact(f))
        self.assertEqual(f["as_of"], "2026-01-31")

        (g,) = self.facts("fl:entity:us-tx:0800000002")
        self.assertEqual(g["provenance"]["confidence"], 0.85)
        self.assertEqual(g["value"]["match"]["rule"], "formation_state")
        self.assertEqual(self.facts("fl:entity:us-tx:0800000003"), [])
        self.assertEqual(self.facts("fl:entity:us-tx:0800000005"), [])
        self.assertEqual(self.facts("fl:entity:us-tx:0800000006"), [])

    def test_the_registrant_is_an_entity_and_controls_the_subsidiaries(self):
        ex.build(self.path, self.db, self.FILING)
        reg = Registry.open_readonly(self.db)
        try:
            parent = reg.get("fl:entity:us-sec:0000999001")
            self.assertEqual((parent["kind"], parent["label"]), ("entity", "Example Retail Holdings, Inc."))
            self.assertEqual({(f["predicate"], f["value"]) for f in parent["facts"]},
                             {("entity.legal_name", "Example Retail Holdings, Inc."), ("entity.registry_number", "0000999001"),
                              ("entity.state_of_formation", "DE")})
            links = [r for r in parent["relationships"] if r["type"] == "controls"]
            self.assertEqual(sorted(r["to_urn"] for r in links),
                             ["fl:entity:us-tx:0800000001", "fl:entity:us-tx:0800000002", "fl:entity:us-tx:0800000007"])
            self.assertEqual({r["method"] for r in links}, {"inferred"})
            self.assertEqual({r["from_urn"] for r in links}, {"fl:entity:us-sec:0000999001"})
            self.assertEqual(reg.resolve_external("sec-cik", "0000999001"), "fl:entity:us-sec:0000999001")
            self.assertEqual([e["urn"] for e in reg.search_entities("Example Retail Holdings")],
                             ["fl:entity:us-sec:0000999001"])
            sub = reg.get("fl:entity:us-tx:0800000001")
            self.assertIn("controls", {r["type"] for r in sub["relationships"]})
        finally:
            reg.close()

    def test_reingesting_changes_nothing_and_a_newer_list_replaces_the_links(self):
        ex.build(self.path, self.db, self.FILING)
        again = ex.build(self.path, self.db, self.FILING)
        self.assertEqual(again.ingest.facts_written, 0)
        newer = ex.Filing("999001", "Example Retail Holdings, Inc.", "DE", "0000999001-27-000003", "10-K", "2027-03-13", "2027-01-30")
        shorter = write(self.tmp, "ex21-2027.htm", TABLE.replace("<tr><td>Example Registrant Holdings, Inc.</td><td>Delaware</td><td>100%</td></tr>", ""))
        ex.build(shorter, self.db, newer)
        reg = Registry.open_readonly(self.db)
        try:
            now = {r["to_urn"] for r in reg.get("fl:entity:us-sec:0000999001")["relationships"] if r["type"] == "controls"}
            self.assertEqual(now, {"fl:entity:us-tx:0800000001", "fl:entity:us-tx:0800000002"})
            # the dropped subsidiary's earlier parent fact is history, not current
            self.assertEqual([f for f in reg.facts("fl:entity:us-tx:0800000007") if f["predicate"] == "entity.parent"], [])
            self.assertEqual(len([f for f in reg.facts("fl:entity:us-tx:0800000007", history=True) if f["predicate"] == "entity.parent"]), 1)
            (f,) = [f for f in reg.facts("fl:entity:us-tx:0800000001") if f["predicate"] == "entity.parent"]
            self.assertEqual(f["as_of"], "2027-01-30")
        finally:
            reg.close()

    def test_the_registrant_is_never_its_own_subsidiary(self):
        own = write(self.tmp, "own.htm", "<table><tr><td>Example Registrant Holdings, Inc.</td><td>Delaware</td></tr></table>")
        stats = ex.build(own, self.db, ex.Filing("999001", "Example Registrant Holdings, Inc.", "DE", "0000999001-26-000008", "10-K",
                                                 "2026-03-14", "2026-01-31"))
        self.assertEqual(stats.match.matched, 0)
        self.assertEqual(stats.match.registrant_itself, 1)


if __name__ == "__main__":
    unittest.main()
