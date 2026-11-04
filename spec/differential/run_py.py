"""Usage: python run_py.py CASES.json OUT.json"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "src"))
from factlot import CALCULATORS, RULES, CalcInputError, run_draft_rule, run_tool  # noqa: E402

out = []
for c in json.load(open(sys.argv[1])):
    if "tool" in c:
        r = run_tool(c["tool"], c["arguments"])
        out.append({"error": r["error"], "issues": [i["path"] for i in r["issues"]]}
                   if set(r) == {"error", "message", "issues"} else {"result": r})
        continue
    try:
        if "draft" in c:
            out.append(run_draft_rule(c["draft"], c["input"], acknowledge_draft=True))
            continue
        fn = RULES[c["rule"]][0] if "rule" in c else CALCULATORS[c["calc"]][0]
        out.append(fn(c["input"]))
    except CalcInputError:
        out.append({"error": "CalcInputError"})
json.dump(out, open(sys.argv[2], "w"))
