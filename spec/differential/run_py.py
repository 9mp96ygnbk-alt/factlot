"""Usage: python run_py.py CASES.json OUT.json"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "src"))
from factlot import CALCULATORS, CalcInputError  # noqa: E402

out = []
for c in json.load(open(sys.argv[1])):
    try:
        out.append(CALCULATORS[c["calc"]][0](c["input"]))
    except CalcInputError:
        out.append({"error": "CalcInputError"})
json.dump(out, open(sys.argv[2], "w"))
