"""Run the shared registry tool calls through the Python SDK and print JSON results.
Usage: python query_fixture.py REGISTRY.db  (the TypeScript test compares its own results to these)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "src"))
import factlot  # noqa: E402
from factlot.tools import configure_registry  # noqa: E402

# calls.json is what every surface answers (the registry Worker replays it too); calls_tx_batch.json holds
# registry_tx_equity_candidates_batch, which the SDKs answer and the Worker does not yet; calls_lookup_batch.json
# holds registry_lookup_batch, which the SDKs answer and the hosted API answers by fanning out single calls.
CALLS = [c for name in ("calls.json", "calls_tx_batch.json", "calls_lookup_batch.json")
         for c in json.loads((Path(__file__).parent / name).read_text())]
configure_registry(sys.argv[1])
print(json.dumps([factlot.run_tool(c["tool"], c["arguments"]) for c in CALLS]))
