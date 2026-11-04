"""Builds the 165 persona skeletons for the hosted review panel (seeded, reproducible).

Role counts are weighted to FactLot's core buyers (owner decision, 2026-11-04):
about 110 core, 40 adjacent, 15 edge. The reviewer agents flesh each skeleton
out into a full persona record before using the product.

    python3 generate.py > skeletons.jsonl
"""
import json, random

rng = random.Random(20261104)

ROLES = [  # (tier, role, count, firm-size weights inst/mid/small, asset pool)
    ("core", "Lease administration and abstraction agent", 22, (4, 4, 2), "leased"),
    ("core", "Acquisitions underwriting agent", 18, (4, 4, 2), "invest"),
    ("core", "Appraisal and valuation agent", 14, (3, 4, 3), "invest"),
    ("core", "CRE lender and debt underwriting agent", 14, (4, 4, 2), "invest"),
    ("core", "Tenant-representation broker copilot agent", 8, (3, 4, 3), "leased"),
    ("core", "Corporate occupier and real estate portfolio agent", 8, (6, 4, 0), "leased"),
    ("core", "Small owner-operator, private investor and 1031 agent", 14, (0, 2, 8), "small"),
    ("core", "Asset management agent", 12, (5, 4, 1), "invest"),
    ("adjacent", "Property management, operations and CAM agent", 12, (3, 4, 3), "leased"),
    ("adjacent", "Due diligence and legal review agent", 10, (4, 4, 2), "invest"),
    ("adjacent", "Investment sales broker agent", 10, (3, 4, 3), "invest"),
    ("adjacent", "ESG, energy benchmarking and building-performance compliance agent", 8, (5, 4, 1), "esg"),
    ("edge", "Property tax appeal and assessment agent", 4, (1, 2, 2), "invest"),
    ("edge", "Insurance underwriting and climate-risk agent", 4, (3, 2, 0), "invest"),
    ("edge", "Retail, restaurant and healthcare site selection agent", 4, (2, 3, 1), "site"),
    ("edge", "Development and land feasibility agent", 3, (1, 2, 1), "dev"),
]
ASSETS = {
    "leased": ["office", "office", "suburban office", "medical office", "industrial / logistics", "industrial / logistics",
               "flex / R&D", "grocery-anchored retail", "strip retail", "single-tenant net lease", "life science", "mixed-use"],
    "invest": ["multifamily 5+", "multifamily 5+", "industrial / logistics", "industrial / logistics", "office", "medical office",
               "self-storage", "grocery-anchored retail", "single-tenant net lease", "hospitality", "data center",
               "manufactured housing", "student housing", "mixed-use"],
    "small": ["multifamily 5-50 units", "multifamily 5-50 units", "single-tenant net lease", "strip retail", "small-bay industrial",
              "self-storage", "small office", "mixed-use main street"],
    "esg": ["office", "office", "multifamily 5+", "mixed-use", "life science", "hospitality"],
    "site": ["quick-service restaurant", "urgent care / medical retail", "grocery and specialty retail", "fitness"],
    "dev": ["multifamily ground-up", "industrial ground-up", "mixed-use infill", "build-to-rent"],
}
GEOS = [  # weighted; mixes metros FactLot's public data touches with ones it does not
    ("New York City", 9), ("Washington, DC", 5), ("Dallas-Fort Worth, TX", 7), ("Houston, TX", 5), ("Austin / San Antonio, TX", 4),
    ("Los Angeles", 6), ("San Francisco Bay Area", 4), ("Chicago", 6), ("Atlanta", 5), ("Phoenix", 4), ("Denver", 3),
    ("Seattle", 3), ("Boston", 4), ("Miami / South Florida", 4), ("Tampa / Orlando", 3), ("Charlotte / Raleigh", 3),
    ("Nashville", 2), ("Minneapolis", 2), ("Philadelphia", 3), ("Northern New Jersey", 3), ("Columbus / Ohio", 2),
    ("Salt Lake City", 1), ("Kansas City / St. Louis", 2), ("national, multi-market", 10), ("Sun Belt portfolio", 4),
    ("secondary and tertiary Midwest markets", 2),
]
SURFACES = [
    ("Remote MCP from a Claude client (Claude Desktop / Claude.ai connector)", 25),
    ("Claude Code with the FactLot plugin", 10),
    ("REST calls from the deployer's own Python or TypeScript agent code", 25),
    ("ChatGPT Custom GPT importing the OpenAPI 3.0 spec as Actions", 15),
    ("Agent framework (LangGraph, OpenAI Agents SDK, CrewAI) wired to the MCP endpoint", 15),
    ("Microsoft Copilot Studio or Gemini via the published connector docs", 10),
]
TEMPERAMENTS = [
    ("skeptical: has been burned by confident-but-wrong tools; assumes a claim is false until a call proves it", 35),
    ("pragmatic: cares only whether it saves time on the job this week", 45),
    ("eager early adopter: wants this to work but will not ignore defects", 20),
]


def pick(weighted):
    items, w = zip(*weighted)
    return rng.choices(items, weights=w)[0]


rows = []
for tier, role, n, sizes, pool in ROLES:
    for _ in range(n):
        rows.append({
            "tier": tier, "role": role,
            "firm_size": rng.choices(["institutional", "mid-market", "small"], weights=sizes)[0],
            "asset_class": rng.choice(ASSETS[pool]),
            "geography": pick(GEOS),
            "connects_via": pick(SURFACES),
            "temperament": pick(TEMPERAMENTS),
        })
rng.shuffle(rows)  # mix roles across batches
for i, r in enumerate(rows):
    r["id"] = f"H{i // 11 + 1:02d}-P{i % 11 + 1:02d}"
for r in sorted(rows, key=lambda r: r["id"]):
    print(json.dumps({"id": r.pop("id"), **r}))
