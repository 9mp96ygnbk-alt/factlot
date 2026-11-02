import unittest

import factlot


class Tools(unittest.TestCase):
    def test_definitions_cover_every_calculator(self):
        names = {t["name"] for t in factlot.anthropic_tools()}
        self.assertEqual(names, {f"calc_{n}" for n in factlot.CALCULATORS})
        for t in factlot.anthropic_tools():
            self.assertEqual(t["input_schema"]["type"], "object")
            self.assertNotIn("$schema", t["input_schema"])
            self.assertIn("Deterministic", t["description"])
        fn = factlot.openai_tools()[0]
        self.assertEqual(fn["type"], "function")
        self.assertIn("parameters", fn["function"])

    def test_run_tool_returns_result_with_provenance(self):
        r = factlot.run_tool("calc_percentage_rent", {"gross_sales": 5_000_000, "rate": 0.06, "base_rent_annual": 240_000})
        self.assertEqual(r["value"]["percentage_rent"], 60_000)
        self.assertEqual(r["provenance"]["formula"], "calc.percentage_rent@1")

    def test_run_tool_reports_errors_instead_of_raising(self):
        r = factlot.run_tool("calc_debt_sizing", {"noi": 1, "rate_annual": 0.05, "amortization_years": 0})
        self.assertEqual(r["error"], "CalcInputError")
        self.assertEqual(factlot.run_tool("calc_nope", {})["error"], "UnknownTool")


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
        uncited = {**fact, "provenance": {"method": "extracted", "sources": []}}
        self.assertFalse(factlot.validate_fact(uncited)["valid"])
        self.assertFalse(factlot.validate_fact({**fact, "predicate": "Zoning"})["valid"])


if __name__ == "__main__":
    unittest.main()
