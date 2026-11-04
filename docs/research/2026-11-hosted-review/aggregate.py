"""Score the hosted review panel. Run: python3 aggregate.py <dir with batches/>

Compares with the previous live review (a different, evenly weighted panel), so the
comparison is by role group, not by persona."""

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
prior = []
for f in sorted(glob.glob(str(D.parent / "2026-11-live-product-review" / "batches" / "*.jsonl"))):
    for line in open(f):
        if line.strip():
            prior.append(json.loads(line))
GROUPS = [("lease admin", "lease admin"), ("underwriting", "acquisitions"), ("valuation", "appraisal"),
          ("lending", "lender"), ("tenant rep", "tenant-rep"), ("occupier", "occupier"), ("small owner / 1031", "owner-operator"),
          ("asset management", "asset management"), ("property management", "property management"),
          ("due diligence", "due diligence"), ("investment sales", "investment_sales|investment sales"),
          ("ESG / energy", "esg"), ("tax appeal", "tax appeal"), ("insurance", "insurance"),
          ("site selection", "site selection"), ("development", "development")]


def group(role):
    r = role.lower().replace("_", " ")
    for name, keys in GROUPS:
        if any(k.replace("_", " ") in r for k in keys.split("|")):
            return name
    return "other"
print(f"N = {n} personas from {len(glob.glob(str(D / 'batches' / '*.jsonl')))} batches\n")


def pct(x, d=None):
    return f"{x / (d or n):.0%}"


# --- evidence integrity ---------------------------------------------------------------------
print("## Evidence integrity")
REQUIRED = ["id", "tier", "onboarding", "first_impression", "marketing", "task_tried", "calls", "output_quality", "outcome",
            "adoption_score", "would_pay_monthly_usd", "must_have_lever", "honest_reaction"]
missing = [(r.get("id"), k) for r in rows for k in REQUIRED if k not in r]
few = [r["id"] for r in rows if len(r.get("calls", [])) < 3]
ids = Counter(r["id"] for r in rows)
print(f"missing fields: {len(missing)} {missing[:10]}")
print(f"personas with fewer than 3 calls: {len(few)} {few}")
print(f"duplicate ids: {[i for i, c in ids.items() if c > 1]}")
skel = [json.loads(l)["id"] for l in open(D / "personas" / "skeletons.jsonl")]
print(f"skeletons not reviewed: {sorted(set(skel) - set(ids))}")
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
for t in ("core", "adjacent", "edge"):
    vals = [r["adoption_score"] for r in rows if r.get("tier") == t]
    if vals:
        print(f"  tier {t:<9} n={len(vals):<3} mean {st.mean(vals):.2f}  %>=4 {pct(sum(x >= 4 for x in vals), len(vals))}")
for t in ("skeptical", "pragmatic", "eager"):
    vals = [r["adoption_score"] for r in rows if str(r.get("temperament", "")).startswith(t)]
    if vals:
        print(f"  {t:<14} n={len(vals):<3} mean {st.mean(vals):.2f}")
if prior:
    ps = [r["adoption_score"] for r in prior]
    print(f"previous live review (v0.1.1, local server, evenly weighted, n={len(ps)}): mean {st.mean(ps):.2f}, %>=4 {pct(sum(x >= 4 for x in ps), len(ps))}")
    print("by role group, previous → now (n now):")
    pg, ng = defaultdict(list), defaultdict(list)
    for r in prior:
        pg[group(r["role"])].append(r["adoption_score"])
    for r in rows:
        ng[group(r["role"])].append(r["adoption_score"])
    for name, _ in GROUPS + [("other", "")]:
        if ng.get(name) or pg.get(name):
            a = f"{st.mean(pg[name]):.2f}" if pg.get(name) else "  - "
            b = f"{st.mean(ng[name]):.2f}" if ng.get(name) else "  - "
            print(f"  {name:<20} {a} → {b}  (n={len(ng.get(name, []))})")
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

# --- onboarding -----------------------------------------------------------------------------
print("## Onboarding (0–5 ease; calls to first useful answer)")
bysurf = defaultdict(list)
for r in rows:
    ob = r.get("onboarding", {})
    if isinstance(ob.get("ease"), (int, float)):
        bysurf[str(r.get("connects_via", ""))[:60]].append((ob["ease"], ob.get("calls_to_first_useful_answer")))
allease = [e for v in bysurf.values() for e, _ in v]
if allease:
    print(f"ease mean {st.mean(allease):.2f}, distribution {dict(sorted(Counter(allease).items()))}")
for k, v in sorted(bysurf.items(), key=lambda kv: -len(kv[1])):
    c = [x for _, x in v if isinstance(x, (int, float))]
    print(f"  {st.mean(e for e, _ in v):.2f}  n={len(v):<3} calls~{st.median(c) if c else '-'}  {k}")
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
    ("Onboarding stuck points", lambda r: r.get("onboarding", {}).get("stuck_points", [])),
    ("Onboarding not tested", lambda r: r.get("onboarding", {}).get("not_tested", [])),
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
