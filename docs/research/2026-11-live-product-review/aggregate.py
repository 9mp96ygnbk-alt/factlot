"""Score the live product review. Run: python3 aggregate.py <dir with batches/>"""

import glob
import json
import statistics as st
import sys
from collections import Counter, defaultdict
from pathlib import Path

D = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
rows = []
for f in sorted(glob.glob(str(D / "batches" / "*.jsonl"))):
    for line in open(f):
        if line.strip():
            rows.append(json.loads(line))
n = len(rows)
prior = {}
for f in sorted(glob.glob(str(D.parent / "2026-11-product-feedback" / "batches" / "*.jsonl"))):
    for line in open(f):
        if line.strip():
            r = json.loads(line)
            prior[r["id"]] = r
print(f"N = {n} personas from {len(glob.glob(str(D / 'batches' / '*.jsonl')))} batches\n")


def pct(x, d=None):
    return f"{x / (d or n):.0%}"


# --- evidence integrity ---------------------------------------------------------------------
print("## Evidence integrity")
REQUIRED = ["id", "first_impression", "marketing", "task_tried", "calls", "output_quality", "outcome",
            "adoption_score", "would_pay_monthly_usd", "must_have_lever", "honest_reaction"]
missing = [(r.get("id"), k) for r in rows for k in REQUIRED if k not in r]
few = [r["id"] for r in rows if len(r.get("calls", [])) < 3]
ids = Counter(r["id"] for r in rows)
print(f"missing fields: {len(missing)} {missing[:10]}")
print(f"personas with fewer than 3 calls: {len(few)} {few}")
print(f"duplicate ids: {[i for i, c in ids.items() if c > 1]}")
print(f"personas from the survey not reviewed: {sorted(set(prior) - set(ids))}")
calls = [c for r in rows for c in r.get("calls", [])]
print(f"calls: {len(calls)} total, {len(calls) / max(n, 1):.1f} per persona; "
      f"surfaces {dict(Counter(c.get('surface') for c in calls))}")
print()

# --- output quality -------------------------------------------------------------------------
print("## Output quality (reviewers recomputed each number in python3)")
v = Counter(c.get("verified") for c in calls)
print(dict(v.most_common()))
mism = [(r["id"], c) for r in rows for c in r.get("calls", []) if c.get("verified") == "mismatch"]
for pid, c in mism:
    print(f"  MISMATCH {pid} {c.get('tool')}: {c.get('input_summary', '')[:160]} | observed {c.get('observed', '')[:160]} | {c.get('note', '')[:200]}")
conv = [(r["id"], c) for r in rows for c in r.get("calls", []) if c.get("verified") == "convention"]
for pid, c in conv:
    print(f"  CONVENTION {pid} {c.get('tool')}: {c.get('note', '')[:220]}")
tools = Counter(c.get("tool") for c in calls)
print("tools called:", dict(tools.most_common()))
for k in ("clarity", "citability"):
    vals = [r["output_quality"][k] for r in rows if isinstance(r.get("output_quality", {}).get(k), (int, float))]
    if vals:
        print(f"{k}: mean {st.mean(vals):.2f}, median {st.median(vals)}, %>=4 {pct(sum(x >= 4 for x in vals), len(vals))}")
print()

# --- adoption -------------------------------------------------------------------------------
print("## Adoption score (0–5)")
s = [r["adoption_score"] for r in rows]
print(f"mean {st.mean(s):.2f}, median {st.median(s)}, distribution {dict(sorted(Counter(s).items()))}, "
      f"%>=4 {pct(sum(x >= 4 for x in s))}, %<=1 {pct(sum(x <= 1 for x in s))}")
both = [(r["adoption_score"], prior[r["id"]]["adoption_score"]) for r in rows if r["id"] in prior]
if both:
    print(f"same personas, earlier brief-only round: mean {st.mean(p for _, p in both):.2f} → live {st.mean(a for a, _ in both):.2f}; "
          f"up {sum(a > p for a, p in both)}, same {sum(a == p for a, p in both)}, down {sum(a < p for a, p in both)}")
for fs in ("institutional", "mid-market", "small"):
    vals = [r["adoption_score"] for r in rows if str(r.get("firm_size", "")).split(":")[0] == fs]
    if vals:
        print(f"  {fs:<14} n={len(vals):<3} mean {st.mean(vals):.2f}  %>=4 {pct(sum(x >= 4 for x in vals), len(vals))}")
print("outcome:", dict(Counter(r["outcome"] for r in rows).most_common()))
print()
byrole = defaultdict(list)
for r in rows:
    byrole[r["role"]].append(r["adoption_score"])
top = sorted(byrole.items(), key=lambda kv: -st.mean(kv[1]))
print("## Highest-scoring roles")
for role, vals in top[:15]:
    print(f"  {st.mean(vals):.1f}  {role}")
print("## Lowest-scoring roles")
for role, vals in top[-10:]:
    print(f"  {st.mean(vals):.1f}  {role}")
print()

# --- money ----------------------------------------------------------------------------------
print("## Willingness to pay (USD per month)")
pay = [r["would_pay_monthly_usd"] for r in rows if isinstance(r.get("would_pay_monthly_usd"), (int, float))]
print(f"median {st.median(pay)}, mean {st.mean(pay):.0f}, $0: {pct(sum(p == 0 for p in pay), len(pay))}, "
      f">=49: {pct(sum(p >= 49 for p in pay), len(pay))}, >=599: {pct(sum(p >= 599 for p in pay), len(pay))}")
print()


# --- free text (full lists go to the appendix file) -------------------------------------------
def dump(title, key_fn):
    items = [(r["id"], x) for r in rows for x in key_fn(r)]
    print(f"## {title}: {len(items)} items")
    return items


appendix = []
for title, fn in [
    ("Must-have levers", lambda r: [r.get("must_have_lever", "")]),
    ("Marketing: unclear or unconvincing", lambda r: r.get("marketing", {}).get("unclear_or_unconvincing", [])),
    ("Marketing: contradicted by the product", lambda r: r.get("marketing", {}).get("contradicted_by_product", [])),
    ("Marketing: missing proof", lambda r: r.get("marketing", {}).get("missing_proof", [])),
    ("Marketing: headline for my role", lambda r: [r.get("marketing", {}).get("headline_for_my_role", "")]),
    ("Marketing: where I would look for it", lambda r: r.get("marketing", {}).get("where_i_would_look_for_it", [])),
    ("Problems", lambda r: r.get("problems", [])),
    ("What worked", lambda r: r.get("what_worked", [])),
    ("Blocked by", lambda r: r.get("blocked_by", [])),
    ("Honest reactions", lambda r: [r.get("honest_reaction", "")]),
]:
    items = dump(title, fn)
    appendix.append(f"\n## {title} ({len(items)})\n")
    appendix.extend(f"- {pid}: {str(x).strip()}" for pid, x in items if str(x).strip())
(D / "appendix.md").write_text("# Appendix: every free-text answer, by persona\n" + "\n".join(appendix) + "\n")
print("\nfree text written to appendix.md")
