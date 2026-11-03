"""Smoke test of an installed `factlot` Python package, as an agent developer would use it.

Run it with the interpreter of a fresh virtual environment that has `factlot` installed from a
wheel, an sdist, or git, and NOT from the source tree:

    python -I scripts/e2e/python_smoke.py [expected-version]

`-I` keeps the current directory off sys.path, so the import must come from site-packages.
"""

import json
import sys

import factlot

expected = sys.argv[1] if len(sys.argv) > 1 else None
if expected:
    assert factlot.__version__ == expected, (factlot.__version__, expected)
assert "site-packages" in (factlot.__file__ or ""), f"imported from {factlot.__file__}"

# Tool definitions for the Claude Messages API and OpenAI-style APIs.
anthropic = factlot.anthropic_tools()
openai = factlot.openai_tools()
names = {t["name"] for t in anthropic}
for required in ("calc_debt_sizing", "id_parcel", "fact_validate", "calc_npv"):
    assert required in names, required
for t in anthropic:
    assert t["input_schema"]["type"] == "object", t["name"]
    assert t["description"], t["name"]
assert len(openai) == len(anthropic)
assert all(t["type"] == "function" and t["function"]["name"] for t in openai)
json.dumps(anthropic)  # serializable as sent on the wire

# A calculator, an ID, and fact validation through the tool runner.
loan = factlot.run_tool(
    "calc_debt_sizing",
    {
        "noi": 1_000_000,
        "value": 15_000_000,
        "rate_annual": 0.06,
        "amortization_years": 30,
        "max_ltv": 0.65,
        "min_dscr": 1.25,
    },
)
assert loan["value"]["max_loan"] == 9_750_000, loan["value"]
assert loan["steps"], "audit trail"

parcel = factlot.run_tool(
    "id_parcel", {"state_fips": "06", "county_fips": "037", "apn": "5432-001-012"}
)
assert parcel["urn"] == "fl:parcel:us-06037:5432001012", parcel

fact = {
    "subject": parcel["urn"],
    "predicate": "parcel.zoning_district",
    "value": "M2",
    "as_of": "2026-11-02",
    "provenance": {
        "method": "public_record",
        "sources": [{"document_id": "la-county-assessor-roll-2026", "page": 1}],
    },
}
assert factlot.run_tool("fact_validate", {"fact": fact}) == {"valid": True, "issues": []}

# Input errors come back as data the model can correct.
bad = factlot.run_tool("calc_debt_sizing", {"noi": "a lot"})
assert bad["error"].endswith("InputError") and bad["issues"], bad

# Schemas ship inside the package (package data, not the repository).
assert factlot.openapi()["openapi"].startswith("3.1")

print(
    f"factlot {factlot.__version__} from {factlot.__file__}: "
    f"{len(anthropic)} tools, run_tool, anthropic_tools, openai_tools OK"
)
