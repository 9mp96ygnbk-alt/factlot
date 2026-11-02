import json, glob, sys, statistics as st
from collections import Counter, defaultdict

D = sys.argv[1]
NAMES = {
 "A":"Canonical IDs / entity resolution","B":"Lease fact layer w/ citations","C":"Lease comps (agent-licensed)",
 "D":"Sales comps","E":"Ownership & debt","F":"Zoning/permits","G":"Tenant credit","H":"Deterministic CRE calculators",
 "I":"Doc ingestion -> structured","J":"Listings feed","K":"Contacts","L":"Foot traffic/demographics",
 "M":"Verified building specs","N":"Tax/insurance/climate","O":"Action rails","P":"Agent-to-agent protocol",
 "Q":"Provenance/verification layer","R":"Open CRE ontology/schema"}
rows=[]
for f in sorted(glob.glob(D+"/*.jsonl")):
    for l in open(f):
        l=l.strip()
        if l: rows.append(json.loads(l))
n=len(rows); print(f"N = {n} personas from {len(glob.glob(D+'/*.jsonl'))} batches\n")

def table(rs,label):
    print(f"## {label} (n={len(rs)})")
    print(f"{'opt':<4}{'name':<36}{'mean':>6}{'%>=4':>7}{'%=5':>6}{'%<=1':>7}")
    out=[]
    for k in NAMES:
        v=[r["scores"].get(k,0) for r in rs]
        out.append((st.mean(v),k,sum(x>=4 for x in v)/len(v),sum(x==5 for x in v)/len(v),sum(x<=1 for x in v)/len(v)))
    for m,k,a,b,c in sorted(out,reverse=True):
        print(f"{k:<4}{NAMES[k]:<36}{m:6.2f}{a:7.0%}{b:6.0%}{c:7.0%}")
    print()
table(rows,"All personas")

# per role: top 4 options
print("## Top 4 options by role")
byrole=defaultdict(list)
for r in rows: byrole[r["role"]].append(r)
for role,rs in sorted(byrole.items(), key=lambda x:x[0]):
    means=sorted(((st.mean(r["scores"][k] for r in rs),k) for k in NAMES),reverse=True)[:4]
    print(f"- {role[:70]:<70} (n={len(rs)}): "+", ".join(f"{k} {m:.1f}" for m,k in means))
print()
for fs in ["institutional","mid-market","small"]:
    rs=[r for r in rows if r.get("firm_size")==fs]
    if rs:
        means=sorted(((st.mean(r["scores"][k] for r in rs),k) for k in NAMES),reverse=True)[:6]
        print(f"firm_size={fs} (n={len(rs)}): "+", ".join(f"{k} {m:.1f}" for m,k in means))
print()
# breadth: # of distinct roles where option is top-3
top3=Counter()
for role,rs in byrole.items():
    for m,k in sorted(((st.mean(r["scores"][k] for r in rs),k) for k in NAMES),reverse=True)[:3]: top3[k]+=1
print("## Breadth: # of roles (of %d) where option ranks top-3:"%len(byrole), dict(top3.most_common()))
print()
# pricing
pm=Counter(r["pricing"]["model"] for r in rows)
budgets=[r["pricing"].get("monthly_budget_usd") or 0 for r in rows]
print("## Pricing models:",dict(pm.most_common()))
print(f"monthly budget USD: median {st.median(budgets):,.0f}, mean {st.mean(budgets):,.0f}, p25 {sorted(budgets)[n//4]:,.0f}, p75 {sorted(budgets)[3*n//4]:,.0f}, sum {sum(budgets):,.0f}")
for fs in ["institutional","mid-market","small"]:
    b=[r["pricing"].get("monthly_budget_usd") or 0 for r in rows if r.get("firm_size")==fs]
    if b: print(f"  {fs}: median {st.median(b):,.0f}")
osi=[r.get("open_source_importance",0) for r in rows]
print(f"open_source_importance mean {st.mean(osi):.2f}, %>=4 {sum(x>=4 for x in osi)/n:.0%}, %<=1 {sum(x<=1 for x in osi)/n:.0%}")
print()
# co-occurrence: pairs both >=4
pair=Counter()
ks=list(NAMES)
for r in rows:
    hi=[k for k in ks if r["scores"][k]>=4]
    for i in range(len(hi)):
        for j in range(i+1,len(hi)): pair[hi[i]+hi[j]]+=1
print("## Most common high-score pairs:",pair.most_common(10))
print()
# keyword tallies across free text
kw={"citation/provenance":["citation","provenance","source","cite","audit trail"],"licens":["licens","terms of use","tos","redistribut"],
    "PDF":["pdf","scanned"],"entity/ID":["entity","parcel id","apn","identifier","resolve","resolution","llc"],
    "stale/freshness":["stale","fresh","as-of","as of","outdated","timestamp"],"API missing":["no api","api"],
    "math":["math","calculat","arithmetic"],"CAM":["cam ","cam,","cam reconcil","operating expense"],"estoppel":["estoppel"],
    "rent roll":["rent roll"],"county/assessor":["county","assessor","recorder"],"human-in-loop":["human","approval","review"]}
def text(r): return json.dumps({k:r[k] for k in ["hardest_task_walkthrough","missing_data","missing_tools_or_actions","current_workarounds","dealbreakers","trust_requirements","single_wish","default_criteria"]}).lower()
print("## Free-text keyword prevalence (% of personas mentioning)")
for k,ws in kw.items():
    c=sum(any(w in text(r) for w in ws) for r in rows); print(f"  {k:<20}{c/n:5.0%}")
print()
dl=Counter()
for r in rows:
    for d in r["dealbreakers"]: dl[d.lower()[:90]]+=1
print("## Sample dealbreakers (first 40 unique):")
for d,_ in list(dl.items())[:40]: print("  -",d)
