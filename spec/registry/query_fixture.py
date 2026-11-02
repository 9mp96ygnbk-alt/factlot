"""Run the shared registry tool calls through the Python SDK and print JSON results.
Usage: python query_fixture.py REGISTRY.db  (the TypeScript test compares its own results to these)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "src"))
import factlot  # noqa: E402
from factlot.tools import configure_registry  # noqa: E402

CALLS = json.loads((Path(__file__).parent / "calls.json").read_text())
configure_registry(sys.argv[1])
print(json.dumps([factlot.run_tool(c["tool"], c["arguments"]) for c in CALLS]))
