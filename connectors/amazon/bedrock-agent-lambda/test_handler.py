import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "python" / "src"))
sys.path.insert(0, str(HERE))

from handler import lambda_handler, to_arguments  # noqa: E402


def event(api_path, props):
    return {
        "messageVersion": "1.0",
        "actionGroup": "factlot",
        "apiPath": api_path,
        "httpMethod": "POST",
        "requestBody": {"content": {"application/json": {"properties": props}}},
        "sessionAttributes": {"s": "1"},
        "promptSessionAttributes": {},
    }


class BedrockAgentHandler(unittest.TestCase):
    def test_typed_and_nested_properties(self):
        e = event("/v1/calc/net_effective_rent", [
            {"name": "schedule", "type": "object", "value": json.dumps({
                "commencement_date": "2026-01-01", "term_months": 120, "area_sf": 10000,
                "starting_rent_psf_annual": 40, "abated_months": [1, 2, 3, 4, 5, 6]})},
            {"name": "ti_allowance_psf", "type": "number", "value": "50"},
            {"name": "leasing_commissions", "type": "number", "value": "100000"},
            {"name": "discount_rate_annual", "type": "number", "value": "0.08"},
        ])
        out = lambda_handler(e)
        r = out["response"]
        self.assertEqual(r["httpStatusCode"], 200)
        self.assertEqual(r["apiPath"], "/v1/calc/net_effective_rent")
        body = json.loads(r["responseBody"]["application/json"]["body"])
        self.assertEqual(body["value"]["discounted_net_effective_rent_psf"], 28.4772)
        self.assertEqual(out["sessionAttributes"], {"s": "1"})

    def test_id_tool_and_errors(self):
        ok = lambda_handler(event("/v1/id/parcel", [
            {"name": "state_fips", "type": "string", "value": "06"},
            {"name": "county_fips", "type": "string", "value": "037"},
            {"name": "apn", "type": "string", "value": "5432-001-012"}]))
        body = json.loads(ok["response"]["responseBody"]["application/json"]["body"])
        self.assertEqual(body["urn"], "fl:parcel:us-06037:5432001012")
        bad = lambda_handler(event("/v1/calc/debt_sizing", [{"name": "noi", "type": "number", "value": "1"}]))
        self.assertEqual(bad["response"]["httpStatusCode"], 400)
        missing = lambda_handler(event("/v1/nope", []))
        self.assertEqual(missing["response"]["httpStatusCode"], 404)

    def test_coercion(self):
        args = to_arguments(event("/x", [
            {"name": "i", "type": "integer", "value": "12"},
            {"name": "n", "type": "number", "value": "1.5"},
            {"name": "b", "type": "boolean", "value": "TRUE"},
            {"name": "a", "type": "array", "value": "[1, 2]"},
            {"name": "s", "type": "string", "value": "06"},
        ]))
        self.assertEqual(args, {"i": 12, "n": 1.5, "b": True, "a": [1, 2], "s": "06"})


if __name__ == "__main__":
    unittest.main()
