"""Claude calls the hosted FactLot server itself, through the Claude API's MCP connector (beta).

    pip install anthropic
    ANTHROPIC_API_KEY=... MODEL=<a current Claude model> python3 examples/claude_api_remote_mcp.py

The beta header below may change; check the MCP connector page in the Claude API docs.
"""

import os

import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model=os.environ["MODEL"],
    max_tokens=4000,
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{"type": "url", "url": "https://api.factlot.com/mcp", "name": "factlot"}],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "factlot"}],
    messages=[
        {
            "role": "user",
            "content": "Size a loan: NOI $1.0M, value $15M, 6.5% rate, 30-year amortization, "
            "65% max LTV, 1.25x min DSCR. Use FactLot and cite the formula ID.",
        }
    ],
)
for block in response.content:
    if block.type == "text":
        print(block.text)
