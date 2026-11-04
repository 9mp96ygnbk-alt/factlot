"""The FactLot Python SDK, fully offline: give a model the tool definitions, run its calls locally.

    pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git@v0.2.0#subdirectory=python"
    python3 examples/local_tools.py
"""

import factlot

# Hand these to your model: Anthropic, OpenAI Chat Completions or Responses formats.
anthropic_tools = factlot.anthropic_tools()
openai_tools = factlot.openai_tools()
print(f"{len(anthropic_tools)} tool definitions ready for a model")

# When the model calls a tool, run it by name with the model's arguments:
result = factlot.run_tool(
    "calc_debt_sizing",
    {
        "noi": 1_000_000,
        "value": 15_000_000,
        "rate_annual": 0.065,
        "amortization_years": 30,
        "max_ltv": 0.65,
        "min_dscr": 1.25,
    },
)
print(result["value"]["max_loan"], result["value"]["binding_constraint"], result["formula"])
