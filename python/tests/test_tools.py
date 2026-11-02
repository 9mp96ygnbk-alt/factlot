import json
import sys
import unittest
from pathlib import Path

import factlot

SPEC = Path(__file__).resolve().parents[2] / "spec" / "schemas"


class Definitions(unittest.TestCase):
    def test_every_provider_lists_the_same_tools(self):
        names = [t["name"] for t in factlot.tool_definitions()]
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("id_parcel", names)
        self.assertIn("fact_validate", names)
        self.assertEqual([t["name"] for t in factlot.anthropic_tools()], names)
        self.assertEqual([t["function"]["name"] for t in factlot.openai_tools()], names)
        self.assertEqual([t["name"] for t in factlot.openai_responses_tools()], names)
        self.assertEqual([f["name"] for f in factlot.gemini_tools()[0]["functionDeclarations"]], names)
        self.assertEqual([t["toolSpec"]["name"] for t in factlot.bedrock_tool_config()["tools"]], names)
        ops = sorted(p["post"]["operationId"] for p in factlot.openapi("3.1")["paths"].values())
        self.assertEqual(ops, sorted(names))
        self.assertEqual(factlot.openapi("3.0", "https://x.example")["servers"], [{"url": "https://x.example"}])

    def test_packaged_schemas_match_spec(self):
        packaged = Path(factlot.__file__).parent / "schemas"
        for f in SPEC.rglob("*.json"):
            rel = f.relative_to(SPEC)
            self.assertEqual(json.loads(f.read_text()), json.loads((packaged / rel).read_text()), str(rel))


class RunTool(unittest.TestCase):
    def test_calculator_with_provenance(self):
        r = factlot.run_tool("calc_percentage_rent", {"gross_sales": 5_000_000, "rate": 0.06, "base_rent_annual": 240_000})
        self.assertEqual(r["value"]["percentage_rent"], 60_000)
        self.assertEqual(r["provenance"]["formula"], "calc.percentage_rent@1")

    def test_id_and_fact_tools(self):
        p = factlot.run_tool("id_parcel", {"state_fips": "06", "county_fips": "037", "apn": "5432-001-012"})
        self.assertEqual(p["urn"], "fl:parcel:us-06037:5432001012")
        self.assertEqual(factlot.run_tool("id_parse", {"urn": p["urn"]})["short"], p["short"])
        d1 = factlot.run_tool("id_document", {"text": "lease text"})
        d2 = factlot.run_tool("id_document", {"content_base64": "bGVhc2UgdGV4dA=="})
        self.assertEqual(d1, d2)
        v = factlot.run_tool("fact_validate", {"fact": {"subject": "fl:parcel:us-06037:1", "predicate": "parcel.zoning_district",
                                                         "value": "M2", "as_of": "2026-11-02",
                                                         "provenance": {"method": "extracted", "sources": []}}})
        self.assertFalse(v["valid"])

    def test_errors_match_typescript_names(self):
        self.assertEqual(factlot.run_tool("calc_debt_sizing", {"noi": 1, "rate_annual": 0.05, "amortization_years": 0})["error"], "CalcInputError")
        self.assertEqual(factlot.run_tool("id_parcel", {"state_fips": "6", "county_fips": "037", "apn": "1"})["error"], "FactLotIdError")
        self.assertEqual(factlot.run_tool("id_parcel", {})["error"], "InputError")
        self.assertEqual(factlot.run_tool("id_document", {"text": "a", "content_base64": "YQ=="})["error"], "InputError")
        self.assertEqual(factlot.run_tool("calc_nope", {})["error"], "UnknownTool")


class RegistryTools(unittest.TestCase):
    def test_registry_tools_against_fixture(self):
        import subprocess
        import tempfile

        from factlot.tools import configure_registry

        db = Path(tempfile.mkdtemp()) / "fixture.db"
        subprocess.run([sys.executable, str(SPEC.parent / "registry" / "build_fixture.py"), str(db)], check=True,
                       capture_output=True)
        configure_registry(str(db))
        try:
            rec = factlot.run_tool("registry_get", {"urn": "fl:parcel:us-48999:00010000002"})
            self.assertEqual(rec["status"], "not_in_latest_snapshot")
            self.assertEqual(rec["facts"], [])
            owned = factlot.run_tool("registry_owned_by", {"entity_urn": "fl:entity:us-tx:0801111111"})
            self.assertEqual([r["urn"] for r in owned["results"]], ["fl:parcel:us-48999:00010000001"])
            self.assertEqual(factlot.run_tool("registry_get", {"urn": "fl:parcel:us-48999:404"})["error"], "NotFound")
        finally:
            configure_registry(None)
        self.assertEqual(factlot.run_tool("registry_get", {"urn": "x"})["error"], "RegistryUnavailable")


class Facts(unittest.TestCase):
    def test_validate_fact(self):
        fact = {
            "subject": "fl:parcel:us-06037:5432001012",
            "predicate": "parcel.zoning_district",
            "value": "M2",
            "as_of": "2026-11-02",
            "provenance": {"method": "public_record", "sources": [{"document_id": "la-zimas-2026-11-02"}]},
            "rights": {"ai_use": "permitted", "redistribution": "attribution_required"},
        }
        self.assertEqual(factlot.validate_fact(fact), {"valid": True, "issues": []})
        self.assertFalse(factlot.validate_fact({**fact, "predicate": "Zoning"})["valid"])


if __name__ == "__main__":
    unittest.main()
