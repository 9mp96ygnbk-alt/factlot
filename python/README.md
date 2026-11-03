# factlot (Python)

The open fact layer for commercial real estate AI agents. This is a pure-Python, dependency-free
port of [`@factlot/calc`](../packages/calc) and [`@factlot/id`](../packages/id). It is held to the
same [conformance vectors](../spec) as the TypeScript packages. Requires Python 3.10 or newer.

```bash
pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git#subdirectory=python"
# or a release wheel: pip install https://github.com/9mp96ygnbk-alt/factlot/releases/download/v0.1.0/factlot-0.1.0-py3-none-any.whl
# after first publish to PyPI: pip install factlot
```

```python
import factlot

# Drop-in tools for the Claude Messages API (or openai_tools() for OpenAI-style APIs)
tools = factlot.anthropic_tools()
# ...when the model calls a tool:
result = factlot.run_tool("calc_debt_sizing", {
    "noi": 1_000_000, "value": 15_000_000, "rate_annual": 0.06,
    "amortization_years": 30, "max_ltv": 0.65, "min_dscr": 1.25,
})
result["value"]["max_loan"]            # 9750000
result["value"]["binding_constraint"]  # "ltv"
result["steps"]                        # audit trail
result["provenance"]                   # ready to attach to a FactLot computed fact

factlot.parcel_id("06", "037", "5432-001-012").urn  # "fl:parcel:us-06037:5432001012"
```

Run the tests from this directory with `PYTHONPATH=src python3 -m unittest discover -s tests`, or
`npm run test:python` from the repository root (no dependencies needed).

License: Apache-2.0.
