"""Score the simulated product-feedback round. Run: python3 aggregate.py <dir with batches/>"""

import glob
import json
import statistics as st
import sys
from collections import Counter, defaultdict

D = sys.argv[1] if len(sys.argv) > 1 else "."
rows = []
for f in sorted(glob.glob(D + "/batches/*.jsonl")):
    for line in open(f):
        if line.strip():
            rows.append(json.loads(line))
n = len(rows)
print(f"N = {n} simulated agents from {len(glob.glob(D + '/batches/*.jsonl'))} batches\n")


def pct(x):
    return f"{x / n:.0%}"


scores = [r["adoption_score"] for r in rows]
print("## Adoption score (0–5: likelihood of adopting FactLot v0.1 as a default tool)")
print(f"mean {st.mean(scores):.2f}, median {st.median(scores)}, %>=4 {pct(sum(s >= 4 for s in scores))}, "
      f"%<=1 {pct(sum(s <= 1 for s in scores))}")
for fs in ("institutional", "mid-market", "small"):
    v = [r["adoption_score"] for r in rows if r.get("firm_size") == fs]
    if v:
        print(f"  {fs:<14} n={len(v):<3} mean {st.mean(v):.2f}  %>=4 {sum(s >= 4 for s in v) / len(v):.0%}")
print()

print("## Outcome of the hardest task with v0.1")
print(dict(Counter(r["outcome"] for r in rows).most_common()))
print()

print("## Adoption by role")
byrole = defaultdict(list)
for r in rows:
    byrole[r["role"]].append(r)
for role, rs in sorted(byrole.items(), key=lambda x: -st.mean(r["adoption_score"] for r in x[1])):
    outc = Counter(r["outcome"] for r in rs)
    print(f"- {st.mean(r['adoption_score'] for r in rs):.1f}  {role[:66]:<66} n={len(rs)}  {dict(outc)}")
print()

print("## Tools used (share of agents that called each)")
tools = Counter(t for r in rows for t in set(r.get("tools_used", [])))
for t, c in tools.most_common():
    print(f"  {t:<40}{pct(c)}")
print()


def tally(title, key, top=25):
    c = Counter()
    for r in rows:
        items = r
        for k in key.split("."):
            items = items.get(k, {}) if isinstance(items, dict) else []
        for it in items or []:
            c[it.strip().lower()] += 1
    print(f"## {title} (count of agents)")
    for item, k in c.most_common(top):
        print(f"  {k:>3}  {item}")
    print()


tally("Gaps: data", "gaps.data")
tally("Gaps: tools and calculators", "gaps.tools")
tally("Gaps: docs, onboarding, deployment", "gaps.docs")
tally("Bugs and confusions", "bugs_or_confusions")
tally("Dealbreakers hit", "dealbreakers_hit")
tally("Top request", "top_request_tags", 30)

print("## Willingness to pay (monthly USD, for the hosted parts; self-hosting is free)")
pay = [r.get("would_pay_monthly_usd") or 0 for r in rows]
print(f"median {st.median(pay):,.0f}, mean {st.mean(pay):,.0f}, %zero {pct(sum(p == 0 for p in pay))}")
for fs in ("institutional", "mid-market", "small"):
    v = [r.get("would_pay_monthly_usd") or 0 for r in rows if r.get("firm_size") == fs]
    if v:
        print(f"  {fs:<14} median {st.median(v):,.0f}")
print(dict(Counter(r.get("pricing_model_preferred") for r in rows).most_common()))
print()

print("## Quotes (one per role, highest and lowest adopter)")
for role, rs in sorted(byrole.items()):
    hi = max(rs, key=lambda r: r["adoption_score"])
    lo = min(rs, key=lambda r: r["adoption_score"])
    print(f"- {role[:60]}")
    print(f"    {hi['adoption_score']}  {hi['id']}: {hi['quote']}")
    if lo is not hi:
        print(f"    {lo['adoption_score']}  {lo['id']}: {lo['quote']}")
