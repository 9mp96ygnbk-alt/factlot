# FactLot examples

Each example runs against the free hosted endpoint `https://api.factlot.com` (no key, 60 requests a
minute) unless it says otherwise. Set `FACTLOT_API_URL` to use your own server, and
`FACTLOT_API_KEY` to send a paid key.

| File                                                               | What it shows                                                                           | Needs                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`curl.sh`](curl.sh)                                               | Loan sizing, net effective rent, a CAM reconciliation and a parcel ID over REST         | `curl`, `python3` (to pretty-print)          |
| [`rest_python.py`](rest_python.py)                                 | The same calls from Python's standard library, printing value, formula ID and steps     | Python 3.10+                                 |
| [`mcp_client.mjs`](mcp_client.mjs)                                 | A Model Context Protocol client: list tools, call one, read the cited answer            | Node.js 22+, `@modelcontextprotocol/sdk`     |
| [`local_tools.py`](local_tools.py)                                 | The Python SDK with no network: tool definitions for a model and `run_tool`             | `pip install` from the repository            |
| [`document_verification.py`](document_verification.py)             | Your agent extracts, FactLot verifies: a synthetic lease, amendment and estoppel        | `pip install` from the repository            |
| [`claude_api_remote_mcp.py`](claude_api_remote_mcp.py)             | Claude calls the hosted FactLot server itself through the MCP connector                 | `anthropic`, `ANTHROPIC_API_KEY`, your model |
| [`openai_responses_remote_mcp.py`](openai_responses_remote_mcp.py) | An OpenAI Responses call that uses the hosted FactLot server as a remote MCP tool       | `openai`, `OPENAI_API_KEY`, your model       |
| [`reconciliation/`](reconciliation/)                               | Excel workbooks reconciled to FactLot calculators at zero difference (synthetic inputs) | Python 3.10+ (Excel to open)                 |

The first four are run against the live endpoint before each release; `document_verification.py`
runs offline with the Python SDK. The two model examples
need your own API key and model name (`MODEL=...`), so they are not run automatically.
