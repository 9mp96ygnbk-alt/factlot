"""Document verification tools: the shared vectors (spec/vectors/documents.json, also run by
TypeScript) and unit tests for the parts the vectors do not reach."""

import json
import unittest
from pathlib import Path

import factlot
from factlot.docverify import DOC_LIMITS, check_consistency_any, js_json
from factlot.factpackage import canonical_json
from factlot.facts import validate_fact
from factlot.ingest.verify import _norm

try:
    import cryptography  # noqa: F401  (optional: factlot[signing])
    HAVE_SIGNING = True
except ImportError:
    HAVE_SIGNING = False
SPEC = json.loads((Path(__file__).resolve().parents[2] / "spec" / "vectors" / "documents.json").read_text("utf-8"))
_ABSENT = object()


def resolve(v):
    """Replaces {"$pages": name} with the named document's pages."""
    if isinstance(v, list):
        return [resolve(x) for x in v]
    if isinstance(v, dict):
        if isinstance(v.get("$pages"), str):
            return SPEC["documents"][v["$pages"]]
        return {k: resolve(x) for k, x in v.items()}
    return v


def at(obj, path):
    for part in path.split("."):
        if isinstance(obj, list) and part.isdigit() and int(part) < len(obj):
            obj = obj[int(part)]
        elif isinstance(obj, dict) and part in obj:
            obj = obj[part]
        else:
            return _ABSENT
    return obj


class Vectors(unittest.TestCase):
    def test_written_forms(self):
        for c in SPEC["consistency"]:
            with self.subTest(predicate=c["predicate"], value=c["value"], quote=c["quote"]):
                self.assertEqual(check_consistency_any(c["predicate"], js_json(c["value"]), c["quote"]), c["expect"])

    def test_canonical_json(self):
        for c in SPEC["canonical_json"]:
            with self.subTest(value=c["value"]):
                self.assertEqual(canonical_json(js_json(c["value"])), c["expect"])

    def test_tools(self):
        for c in SPEC["cases"]:
            if c.get("requires") == "signing" and not HAVE_SIGNING:
                continue  # Ed25519 needs the cryptography package (factlot[signing]); test_fact_packages says so
            with self.subTest(case=c["name"]):
                out = factlot.run_tool(c["tool"], resolve(c["arguments"]))
                if "expect_error" in c:
                    self.assertEqual(out.get("error"), c["expect_error"], out)
                    if "expect_issues" in c:
                        self.assertEqual(out.get("issues"), c["expect_issues"])
                    continue
                self.assertNotIn("error", out, out)
                for path, expected in c["expect"].items():
                    self.assertEqual(at(out, path), _ABSENT if expected is None else expected, path)


LEASE = SPEC["documents"]["lease"]


class Tools(unittest.TestCase):
    def test_every_verified_fact_passes_fact_validate(self):
        out = factlot.run_tool("doc_verify_facts", resolve(SPEC["cases"][0]["arguments"]))
        for v in out["verified"]:
            self.assertEqual(factlot.run_tool("fact_validate", {"fact": v["fact"]}), {"valid": True, "issues": []})
            self.assertEqual(validate_fact(v["fact"]), {"valid": True, "issues": []})

    def test_span_slices_the_quote_out_of_the_joined_pages(self):
        quote = "TENANT’S PRO- PORTIONATE SHARE IS 4.25%"
        out = factlot.run_tool("doc_verify_facts", {"document": {"pages": LEASE}, "as_of": "2026-11-03", "candidates": [
            {"predicate": "lease.pro_rata_share", "value": 0.0425, "quote": quote, "page": 2}]})
        span = out["verified"][0]["fact"]["provenance"]["sources"][0]["span"]
        piece = "\f".join(LEASE)[span["start"]:span["end"]]
        self.assertEqual(piece, "Tenant’s Pro-\nportionate Share is 4.25%")
        self.assertEqual(_norm(piece), _norm(quote))

    def test_no_span_rather_than_a_wrong_one(self):
        # Final sigma: lowercasing "ΟΔΟΣ" as a word gives a final ς; letter by letter, σ.
        out = factlot.run_tool("doc_verify_facts", {"document": {"pages": ["Address: ΟΔΟΣ ΑΘΗΝΑΣ 12, synthetic text."]},
                                                    "as_of": "2026-11-03", "candidates": [
            {"predicate": "lease.premises_street", "value": "ΟΔΟΣ ΑΘΗΝΑΣ", "quote": "Address: ΟΔΟΣ ΑΘΗΝΑΣ 12", "page": 1}]})
        self.assertNotIn("span", out["verified"][0]["fact"]["provenance"]["sources"][0])

    def test_whole_number_floats_are_ints_as_in_javascript(self):
        out = factlot.run_tool("doc_verify_facts", {"document": {"pages": LEASE}, "as_of": "2026-11-03", "candidates": [
            {"predicate": "lease.rentable_area_sf", "value": 12500.0, "quote": "containing approximately 12,500 rentable square feet",
             "page": 1}]})
        value = out["verified"][0]["fact"]["value"]
        self.assertEqual((value, type(value)), (12500, int))

    def test_size_caps(self):
        pages = ["x" * DOC_LIMITS["characters_per_page"]] * (DOC_LIMITS["characters_per_call"] // DOC_LIMITS["characters_per_page"] + 1)
        out = factlot.run_tool("doc_verify_claim", {"document": {"pages": pages}, "claim": {"text": "about 5 things"},
                                                    "quote": "x" * 16, "page": 1})
        self.assertEqual(out["error"], "InputError")
        self.assertIn("2000000 per call", out["message"])
        out = factlot.run_tool("doc_verify_claim", {"document": {"pages": ["x" * (DOC_LIMITS["characters_per_page"] + 1)]},
                                                    "claim": {"text": "about 5 things"}, "quote": "x" * 16, "page": 1})
        self.assertEqual(out["error"], "InputError")

    def test_schema_errors_are_input_errors(self):
        for args in ({}, {"document": {"pages": []}, "as_of": "2026-11-03", "candidates": [{}]},
                     {"document": {"pages": ["a"]}, "as_of": "2026-13-01", "candidates": [
                         {"predicate": "lease.tenant", "value": "x", "quote": "q", "page": 1}]},
                     {"document": {"pages": ["a"]}, "as_of": "2026-11-03", "candidates": [
                         {"predicate": "lease.tenant", "value": "x", "quote": "q", "page": 1.5}]}):
            with self.subTest(args=args):
                self.assertEqual(factlot.run_tool("doc_verify_facts", args)["error"], "InputError")


if __name__ == "__main__":
    unittest.main()


class FactSchema(unittest.TestCase):
    def test_date_patterns_are_the_published_ones(self):
        from factlot import facts

        published = json.loads((Path(__file__).resolve().parents[2] / "spec" / "schemas" / "fact.json").read_text("utf-8"))
        props = published["schemas"]["Fact"]["properties"]
        as_js = lambda p: p.pattern.replace("[0-9]", "\\d")  # noqa: E731
        self.assertEqual("^" + as_js(facts._ISO_DATE) + "$", props["as_of"]["pattern"])
        verified_at = published["schemas"]["Provenance"]["properties"]["verified_at"]["pattern"]
        self.assertEqual("^" + as_js(facts._ISO_DATETIME) + "$", verified_at)

    def test_ingest_facts_still_validate(self):
        fact = {"id": "flf_x", "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "predicate": "lease.expiration_date",
                "value": "2031-06-30", "as_of": "2026-11-03", "valid_from": "2026-03-01",
                "provenance": {"method": "extracted", "producer": {"name": "x", "version": "1"}, "confidence": 0.9,
                               "verified_by": "A. Reviewer", "verified_at": "2026-11-03T10:00:00+00:00",
                               "sources": [{"document_id": "d", "title": "t", "page": 2, "section": "1.2",
                                            "quote": "expire on June 30, 2031", "ocr": True}]},
                "rights": {"ai_use": "permitted", "redistribution": "prohibited"}, "supersedes": ["flf_y"]}
        self.assertEqual(validate_fact(fact), {"valid": True, "issues": []})
