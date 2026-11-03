"""An OpenAI Responses call that uses the hosted FactLot server as a remote MCP tool.

    pip install openai
    OPENAI_API_KEY=... MODEL=<a current model> python3 examples/openai_responses_remote_mcp.py
"""

import os

from openai import OpenAI

client = OpenAI()
response = client.responses.create(
    model=os.environ["MODEL"],
    tools=[
        {
            "type": "mcp",
            "server_label": "factlot",
            "server_url": "https://api.factlot.com/mcp",
            "require_approval": "never",
        }
    ],
    input="A tenant is offered 10,000 SF for 10 years at $40/SF/yr with 6 months free, "
    "$50/SF of TI and $100,000 of commissions. What is the net effective rent? Use FactLot.",
)
print(response.output_text)
