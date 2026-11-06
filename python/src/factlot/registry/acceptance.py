"""Acceptance checks for the registry coverage matrix and the row classifier.

These checks encode rules the product already has. They do not require the external
draft's ``flr1`` identifier or its five unset decisions. A null draft threshold is
not a failure.

``python -m factlot.registry.acceptance`` prints any failure and exits 1.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from .matrix import SAMPLE_PARCELS, SAMPLE_TAG, build, render_json, render_markdown
from .normalize import STATE_BY_FIPS

_BANNED = re.compile(r"\b(available|leased|availability)\b", re.I)
# Folklore strings that must not be pass thresholds. The cited pipeline sum may appear
# when it is computed from quotes and labeled as not live.
_THRESHOLD_BANS = ("1.95 million", "1.95M", "21 states+DC", "21 states + DC", "1950000")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def structural_failures(matrix: dict) -> list[str]:
    problems = []
    if matrix.get("nationally_complete") is not False:
        problems.append("nationally_complete must be false")
    if matrix.get("live_count") is not False:
        problems.append("live_count must be false")
    if matrix.get("folklore_used_as_target") is not False:
        problems.append("folklore_used_as_target must be false")
    if "flr1" in matrix.get("identifier_scheme", "") and "not adopted" not in matrix["identifier_scheme"]:
        problems.append("flr1 must not be the identifier scheme")
    postals = {j["admin1"].lower() for j in matrix["jurisdictions"]}
    expected = {postal.lower() for postal in STATE_BY_FIPS.values()}
    if postals != expected:
        problems.append(f"jurisdiction postal codes {sorted(expected - postals)} missing, extra {sorted(postals - expected)}")
    for j in matrix["jurisdictions"]:
        if j["status"] == "not_reviewed" and j["cited_pipeline_parcels"] is not None:
            problems.append(f"{j['display_name']} is not reviewed but has a parcel count")
        if j["status"] == "not_reviewed" and j["cited_pipeline_parcels"] == 0:
            problems.append(f"{j['display_name']} uses zero for an unknown parcel count")
        if j["published_queryable"] and j["admin1"].lower() != "dc":
            problems.append(f"{j['display_name']} is marked queryable")
        for s in j["sources"]:
            if s.get("residual_block") and s["ingestion"] == "loaded_verified":
                problems.append(f"{s['source_id']} is {s['residual_block']} and loaded_verified")
            if s["gate_class"].startswith("blocked_") and s["ingestion"] == "loaded_verified":
                problems.append(f"{s['source_id']} is blocked and loaded_verified")
            if s["cost_usd"] != 0:
                problems.append(f"{s['source_id']} has a non-zero data cost")
            if s.get("cited_source_rows") is not None and s.get("cited_pipeline_parcels") is not None:
                if s["cited_source_rows"] < s["cited_pipeline_parcels"]:
                    problems.append(f"{s['source_id']} source rows are below the kept parcel count")
    pipe = matrix["pipeline"]
    got = sum(j["cited_pipeline_parcels"] or 0 for j in matrix["jurisdictions"])
    if got != pipe["verified_sources_parcels"] + pipe["unverified_sources_parcels"]:
        problems.append("pipeline sum does not equal the state rows")
    if pipe["sample_parcels_excluded_from_pipeline"] and pipe["sample_parcels_excluded_from_pipeline"] == pipe["verified_sources_parcels"]:
        problems.append("sample rows were folded into the verified pipeline sum")
    if matrix["published_sample"]["commercial_parcels"] != SAMPLE_PARCELS:
        problems.append("published sample parcel count changed without a quote")
    if matrix["published_sample"]["release_tag"] != SAMPLE_TAG:
        problems.append("published sample tag changed")
    if matrix["geography_denominator"]["county_equivalents"] <= 0:
        problems.append("census county denominator missing")
    text = render_markdown(matrix)
    if _BANNED.search(text):
        problems.append("coverage matrix uses a banned public word")
    if "http://" in text or "https://" in text:
        problems.append("coverage matrix names a source host")
    if "not a live" not in text or "not nationally complete" not in text:
        problems.append("coverage matrix does not say it is not live and not nationally complete")
    blob = render_json(matrix)
    for ban in _THRESHOLD_BANS:
        if ban in blob:
            problems.append(f"matrix carries folklore literal {ban}")
    return problems


def public_copy_failures(root: Path, matrix: dict) -> list[str]:
    """The marked registry-trust regions must label the pipeline sum and avoid banned words."""
    problems = []
    verified = f"{matrix['pipeline']['verified_sources_parcels']:,}"
    entities = f"{matrix['pipeline']['cited_entities']:,}"
    regions = []
    for rel in ("site/index.html", "README.md", "llms.txt", "site/llms.txt"):
        text = (root / rel).read_text(encoding="utf-8")
        parts = re.findall(r"<!-- registry-trust -->(.*?)<!-- /registry-trust -->", text, re.S)
        if not parts:
            problems.append(f"{rel} has no registry-trust region")
            continue
        regions.append((rel, "\n".join(parts)))
    for rel, region in regions:
        if _BANNED.search(region):
            problems.append(f"{rel} registry-trust region uses a banned word")
        if verified not in region:
            problems.append(f"{rel} does not show the cited verified pipeline sum")
        if "not a live count" not in region:
            problems.append(f"{rel} does not label the pipeline sum as not a live count")
        if "18,077" not in region or "2026-11-04" not in region:
            problems.append(f"{rel} does not date the DC sample and its size")
        if rel == "site/index.html" and entities not in region:
            problems.append("site registry card does not show the cited entity sum")
    return problems


def disk_failures(root: Path, matrix: dict) -> list[str]:
    """The committed matrix must match the builder. JSON is compared as data, so Prettier may wrap it."""
    problems = []
    docs = root / "docs" / "registry"
    js = docs / "coverage-matrix.json"
    md = docs / "coverage-matrix.md"
    if not js.exists():
        problems.append("docs/registry/coverage-matrix.json is missing")
    else:
        try:
            got = json.loads(js.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            got = None
        if got != matrix:
            problems.append("docs/registry/coverage-matrix.json does not match the builder")
    if not md.exists():
        problems.append("docs/registry/coverage-matrix.md is missing")
        return problems
    text = md.read_text(encoding="utf-8")
    if _BANNED.search(text) or "http://" in text or "https://" in text:
        problems.append("committed coverage matrix names a host or uses a banned word")
    if "not nationally complete" not in text or "not a live" not in text:
        problems.append("committed coverage matrix dropped the not-live label")
    shown = f"{matrix['pipeline']['verified_sources_parcels']:,}"
    if shown not in text:
        problems.append("committed coverage matrix dropped the verified pipeline sum")
    for j in matrix["jurisdictions"]:
        if j["display_name"] not in text:
            problems.append(f"committed coverage matrix is missing {j['display_name']}")
            break
    return problems


def failures(root: Path | None = None) -> list[str]:
    root = Path(root) if root is not None else _repo_root()
    matrix = build(root)
    return structural_failures(matrix) + public_copy_failures(root, matrix) + disk_failures(root, matrix)


def main(argv: list[str] | None = None) -> int:
    del argv
    found = failures()
    if found:
        for item in found:
            print(f"FAIL {item}")
        return 1
    print("ok registry acceptance")
    return 0


if __name__ == "__main__":
    sys.exit(main())
