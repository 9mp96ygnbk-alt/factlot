"""rent_roll_certify: the Python port gives, to the letter, the answers the TypeScript tool gives on the same
invented rent roll (fixtures dumped from packages/tools/src/rentroll_case.ts; the figures are worked by hand in
packages/tools/src/rentroll.test.ts). Every organisation and figure is invented."""

import copy
import json
import pathlib
import unittest

from factlot import configure_exchange, run_tool
from factlot.audit import set_full_audit
from factlot.docverify import DocInputError
from factlot.rentroll import certify_rent_roll

FIX = pathlib.Path(__file__).parent / "fixtures" / "rentroll"


def load(name):
    return json.loads((FIX / name).read_text())


def same(a, b, path=""):
    """Deep equality, numbers by value."""
    if isinstance(a, dict) and isinstance(b, dict):
        assert a.keys() == b.keys(), f"{path}: keys {sorted(set(a) ^ set(b))}"
        for k in a:
            same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        assert len(a) == len(b), f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, f"{path}.{i}")
    else:
        assert a == b and isinstance(a, bool) == isinstance(b, bool), f"{path}: {a!r} != {b!r}"


def run(args):
    o = run_tool("rent_roll_certify", args)
    assert "error" not in o, json.dumps(o)[:600]
    return o


def grade(r, line):
    return next(x for x in r["lines"] if x["line_id"] == line)["grade"]


class RentRollTests(unittest.TestCase):
    def test_same_answers_as_typescript(self):
        for name in ("plain", "estoppel"):
            same(run(load(f"{name}_args.json")), load(f"{name}_result.json"), name)

    def test_grades_and_totals(self):
        r = run(load("estoppel_args.json"))
        self.assertEqual(grade(r, "L1"), "matches_lease_confirmed_by_tenant")
        self.assertEqual(sum(r["totals"]["grades"].values()), r["totals"]["occupied_lines"])
        self.assertEqual(r["walt"]["formula"], {"id": "calc.walt", "version": 1})
        self.assertTrue(r["notes"][2].startswith("The certifying party's certification, not FactLot"))
        plain = run(load("plain_args.json"))
        self.assertEqual(grade(plain, "L1"), "matches_lease")

    def test_disputed_estoppel_statement_makes_the_line_differ(self):
        a = load("estoppel_args.json")
        a["leases"][0]["estoppel"]["statements"][0]["decision"] = "disputed"
        a["leases"][0]["estoppel"]["statements"][0]["tenants_own_version"] = "a different date"
        r = run(a)
        self.assertEqual(grade(r, "L1"), "differs")
        self.assertIn("ESTOPPEL_DISPUTED", [f["code"] for f in r["flags"]])

    def test_refusals(self):
        a = load("plain_args.json")
        b = copy.deepcopy(a)
        b["roll_lines"][0]["facts"][0]["provenance"]["sources"] = []
        self.assertIn("error", run_tool("rent_roll_certify", b))
        c = copy.deepcopy(a)
        c["roll_lines"][1]["line_id"] = c["roll_lines"][0]["line_id"]
        self.assertIn("error", run_tool("rent_roll_certify", c))
        d = copy.deepcopy(a)
        d["parties"]["relying_party"] = {"organisation": d["parties"]["certifier"]["organisation"], "role": "lender"}
        with self.assertRaises(DocInputError):
            certify_rent_roll(d)

    def test_plan_rule(self):
        a = load("plain_args.json")
        token = set_full_audit(False)
        try:
            r = run(a)
        finally:
            set_full_audit(None)
        self.assertTrue(r["limited"])
        self.assertNotIn("lines", r)
        self.assertEqual(r["rent_roll_available"], "pro")
        self.assertEqual(r["summary"]["totals"], load("plain_result.json")["totals"])


class RentRollSendTests(unittest.TestCase):
    def tearDown(self):
        configure_exchange()

    def build(self):
        args = load("estoppel_args.json")
        r = run(args)
        facts = {}
        for grp in args["roll_lines"] + args["leases"]:
            for f in grp["facts"]:
                facts[f["id"]] = f
        made = run_tool("fact_package_create", {"facts": [facts[i] for i in r["package_facts"]], "title": "Rent roll",
                                                "created_at": "2026-11-20T12:00:00Z"})
        assert "error" not in made, made
        return r, made["package"]

    def test_send_rent_roll_and_refusals(self):
        r, pkg = self.build()
        seen = []

        def transport(url, headers, body):
            seen.append(json.loads(body))
            return 200, {"ok": True, "result": {
                "id": "00000000-0000-4000-8000-0000000000aa", "digest": "d", "package_root": "r", "status": "confirmed",
                "sandbox": True, "test_mode_reason": "x", "owner_token": "o" * 20, "counterparty_token": "c" * 20,
                "reliances_recorded": [], "relier_tokens": [{"label": "Second lender", "token": "t" * 20}]}}

        configure_exchange(url="http://exchange.test/x", site_url="http://site.test", transport=transport)
        base = {
            "package": pkg, "kind": "rent_roll", "title": "Rent roll, Alder Court",
            "subject": {"label": "Alder Court Office Building"},
            "from": {"organisation": "Alder Court Holdings LLC", "person": "Dana Example"},
            "to": {"organisation": "Northfield Credit Partners LLC"},
            "items": r["package_items"], "calculation": r["package_calculation"],
            "relying_parties": ["Second lender"],
            "estoppel_links": ["https://cre-record.vercel.app/#/r/00000000-0000-4000-8000-000000000001/" + "a" * 20],
            "approved_by": "Dana Example", "approval_confirmed": True,
        }
        ok = run_tool("fact_package_send", base)
        assert "error" not in ok, json.dumps(ok)[:500]
        self.assertEqual(len(ok["links_for_relying_parties"]), 1)
        self.assertEqual(ok["recorded"]["items_awaiting_answer"], [])
        self.assertIn("lender or buyer", ok["note"])
        self.assertEqual(seen[0]["linked_estoppels"], [{"id": "00000000-0000-4000-8000-000000000001", "token": "a" * 20}])
        self.assertEqual(seen[0]["relying_parties"], ["Second lender"])

        def refused(mutate, text):
            x = copy.deepcopy(base)
            x["package"] = pkg
            mutate(x)
            o = run_tool("fact_package_send", x)
            self.assertIn("error", o)
            self.assertIn(text, json.dumps(o))

        refused(lambda x: x["items"][0].pop("grade"), "give the line's grade")
        refused(lambda x: x.pop("estoppel_links"), "status link of that estoppel")
        refused(lambda x: x["items"][1].update(text="t"), "for kind estoppel only")
        refused(lambda x: x["items"][2].update(estoppel_package_id="x"), "only a line graded confirmed")
        refused(lambda x: x.update(kind="fact_confirmation"), "for kind rent_roll only")
        refused(lambda x: x["items"][3].update(position="accept_theirs"), "state_ours")

    def test_status_shows_grade_and_asserted_by_sender(self):
        def transport(url, headers, body):
            return 200, {"ok": True, "result": {
                "id": "00000000-0000-4000-8000-0000000000aa", "title": "t", "status": "confirmed", "sandbox": True,
                "to": {"organisation": "Lender"}, "package_root": "r", "integrity": {},
                "items": [{"key": "L1", "label": "Suite 210", "position": "state_ours", "value": 1, "their_value": 1,
                           "grade": "matches_lease", "grade_label": "Matches lease"}],
                "reliances": [], "reliers": []}}

        configure_exchange(url="http://exchange.test/x", site_url="http://site.test", transport=transport)
        s = run_tool("fact_package_status", {"package_id": "00000000-0000-4000-8000-0000000000aa", "token": "o" * 20})
        assert "error" not in s, s
        row = s["items"][0]
        self.assertEqual((row["grade"], row["answer"]), ("matches_lease", {"decision": "asserted_by_sender"}))


if __name__ == "__main__":
    unittest.main()
