"""Usage: python compare.py CASES.json TS.json PY.json — exits 1 on any difference."""

import collections
import json
import sys

cases, ts, py = (json.load(open(p)) for p in sys.argv[1:4])


def walk(a, b, path, out):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            walk(a.get(k, "<missing>"), b.get(k, "<missing>"), f"{path}.{k}", out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append((path, f"len {len(a)}", f"len {len(b)}"))
            return
        for i, (x, y) in enumerate(zip(a, b)):
            walk(x, y, f"{path}.{i}", out)
    elif a != b:
        out.append((path, a, b))


bad = collections.Counter()
examples = {}
for c, t, y in zip(cases, ts, py):
    diffs = []
    if ("error" in t) != ("error" in y):
        diffs.append(("error", t.get("error"), y.get("error")))
    else:
        walk(t.get("value"), y.get("value"), "value", diffs)
        if len(t.get("warnings", [])) != len(y.get("warnings", [])):
            diffs.append(("warnings", len(t.get("warnings", [])), len(y.get("warnings", []))))
    if diffs:
        bad[c["calc"]] += 1
        examples.setdefault(c["calc"], (c["input"], diffs[:3]))
print(f"{len(cases)} cases, {sum(bad.values())} mismatched")
for calc, (inp, diffs) in examples.items():
    print(f"  {calc}: {diffs}\n    input: {json.dumps(inp)[:400]}")
sys.exit(1 if bad else 0)
