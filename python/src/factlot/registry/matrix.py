"""Jurisdiction coverage matrix for the registry, from the files already in the repository.

Nothing here is downloaded, guessed, or treated as a live count. Parcel figures are the
quote-checked rows the coverage page already assembles. A state with no such row has a
null parcel count, not zero. Census county counts are a geographic denominator from the
public-domain county file, not a count of commercial parcels.

The proposed ``flr1:`` identifier and the five unset product decisions in the external
quality draft are recorded under ``rejected_proposals``. They are not gates.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
from pathlib import Path
from typing import Any

from .normalize import STATE_BY_FIPS

COMPILED = "2026-11-06"
# Release tag cited in llms.txt for the one redistributable sample. Not a publisher as-of date.
SAMPLE_TAG = "registry-sample-dc-2026-11-04"
SAMPLE_PARCELS = 18077

REJECTED_PROPOSALS = [
    {
        "id": "flr1",
        "proposal": "Replace parcel identity with flr1:{country}:{admin1}:{jurisdiction_key}:{parcel_key}.",
        "disposition": "rejected",
        "reason": "FactLot parcel IDs (fl:parcel:) are permanent. The same input must keep the same ID.",
    },
    {
        "id": "D1-D5-fail-closed",
        "proposal": "Block implementation until five unset decisions (jurisdiction list, freshness days, missing coordinates, owner display, coverage fractions) are signed, and treat null as quarantining the publish tier.",
        "disposition": "rejected",
        "reason": "Those decisions are not product policy. Scope, owner handling, coordinates and cited assessment figures already exist in the registry. Unset draft thresholds are not new gates.",
    },
    {
        "id": "omit-monetary-facts",
        "proposal": "Drop market value, appraised value and sale price from the registry.",
        "disposition": "rejected",
        "reason": "Those are cited source figures, not an appraisal opinion. The fact model and the Texas unequal-appraisal tools already publish them with citations.",
    },
    {
        "id": "parcel-only-v1",
        "proposal": "Limit the registry to cadastral parcels and drop entities, buildings and ownership links.",
        "disposition": "rejected",
        "reason": "Entities, buildings and ownership links are current registry subjects.",
    },
    {
        "id": "quarantine-missing-coordinates",
        "proposal": "Quarantine every parcel that has no coordinate.",
        "disposition": "rejected",
        "reason": "Most appraisal rolls do not publish coordinates. Missing coordinates stay unknown; a present but impossible coordinate is counted, and the row is still stored.",
    },
    {
        "id": "ban-cited-pipeline-total",
        "proposal": "Treat the cited pipeline parcel sum as folklore that cannot appear even when dated and labeled.",
        "disposition": "rejected",
        "reason": "The sum of quote-checked rows is evidence of what scratch loads recorded. It is not a live count, not a national total, and not a pass threshold.",
    },
]


def _generator(root: Path) -> Any:
    path = root / "scripts" / "registry" / "gen_coverage_docs.py"
    spec = importlib.util.spec_from_file_location("gen_coverage_docs", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _census(path: Path) -> tuple[dict[str, list[tuple[str, str]]], int]:
    by: dict[str, list[tuple[str, str]]] = {}
    n = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fips, name = line.split("\t", 1)
        if not re.fullmatch(r"\d{5}", fips):
            raise ValueError(f"county file has a bad FIPS code {fips!r}")
        by.setdefault(fips[:2], []).append((fips[2:], name))
        n += 1
    return by, n


def _residual_block(catalog: str | None, gate: str | None) -> str | None:
    """A hard block that remains worth naming even if a person later sets verified."""
    blob = f"{catalog or ''} {gate or ''}".lower()
    if "purchase" in blob:
        return "blocked_purchase"
    if "click-through" in blob or "click through" in blob:
        return "blocked_click_through"
    if "automated" in blob or "host blocks" in blob:
        return "blocked_automated_access"
    if "records request" in blob:
        return "blocked_records_request"
    return None


def _gate_class(verified: bool, catalog: str | None, gate: str | None, redistribution: str | None) -> str:
    if verified:
        return "verified"
    blob = f"{catalog or ''} {gate or ''}".lower()
    if "purchase" in blob:
        return "blocked_purchase"
    if "click-through" in blob or "click through" in blob:
        return "blocked_click_through"
    if "automated" in blob or "host blocks" in blob:
        return "blocked_automated_access"
    if "records request" in blob:
        return "blocked_records_request"
    if re.match(r"none\b", blob.strip()):
        return "blocked_no_bulk_source"
    if "gated" in blob or (gate or "").strip():
        return "blocked_terms_or_other"
    text = (redistribution or "").lower()
    if re.search(r"prohibit|non-commercial|personal use|reserves all rights|no redistribution", text):
        return "blocked_redistribution_text"
    return "not_verified_no_gate_recorded"


def _role(sid: str, gen: Any) -> str:
    if "entities" in sid or sid == "tx-comptroller-franchise":
        return "entities"
    if sid in gen.ENRICHMENT or sid in gen.HOLDS_OVERRIDES:
        return "enrichment"
    if any(part in sid for part in ("zoning", "energy", "sales", "acris", "condo", "pluto", "ll84", "gsa-", "sec-", "iolp")):
        return "enrichment"
    if sid.startswith("gsa-") or sid.startswith("sec-"):
        return "enrichment"
    return "parcels"


def _match_fips(area: str, counties: list[tuple[str, str]]) -> str | None:
    """A 3-digit county code when ``area`` is exactly one Census county name, else None."""
    name = re.sub(r"\s*\(.*\)$", "", area).strip().lower()
    named = [code for code, county_name in counties if county_name.lower() == name]
    return named[0] if len(named) == 1 else None


def build(root: Path) -> dict[str, Any]:
    """The matrix. Raises if a cited count is not in the document it quotes."""
    root = Path(root)
    gen = _generator(root)
    configs = gen.load_configs()
    rows, data = gen.assemble_rows(configs)
    cfg = {s["source_id"]: s for s in configs}
    counties, county_n = _census(root / "spec" / "registry" / "county-names.tsv")
    names = dict(gen.STATES)
    names["PR"] = "Puerto Rico"
    fips_of = {postal.upper(): fips for fips, postal in STATE_BY_FIPS.items()}

    qc = data["queryable_cite"]
    if f"{SAMPLE_PARCELS:,}" not in gen.norm(qc["quote"]):
        raise SystemExit("queryable sample parcel count is not in its quote")
    if SAMPLE_TAG not in gen.read("llms.txt"):
        raise SystemExit(f"{SAMPLE_TAG} is not in llms.txt")

    by_state_rows: dict[str, list[dict]] = {}
    for row in rows:
        by_state_rows.setdefault(row["state"], []).append(row)

    def verified(sid: str) -> bool:
        return bool(cfg.get(gen.CFG_ALIAS.get(sid, sid), {}).get("verified"))

    verified_pipeline = 0
    unverified_pipeline = 0
    for row in rows:
        if row.get("kind") != "load":
            continue
        n = row.get("parcels") or 0
        if verified(row["source_id"]):
            verified_pipeline += n
        else:
            unverified_pipeline += n

    sample_total = sum((row.get("parcels") or 0) for row in rows if row.get("kind") == "sample")
    entity_total = sum(e["entities"] for e in data["entity_registries"])

    loads_by_source: dict[str, list[dict]] = {}
    for row in rows:
        loads_by_source.setdefault(row["source_id"], []).append(row)

    jurisdictions = []
    for fips, postal in sorted(STATE_BY_FIPS.items(), key=lambda item: names.get(item[1].upper(), item[1])):
        st = postal.upper()
        state_rows = by_state_rows.get(st, [])
        load_rows = [r for r in state_rows if r.get("kind") == "load"]
        sample_rows = [r for r in state_rows if r.get("kind") == "sample"]
        sources = []
        for s in configs:
            if s["_state"] != st:
                continue
            sid = s["source_id"]
            role = _role(sid, gen)
            own = list(loads_by_source.get(sid, []))
            group_lead = False
            counted_under = None
            for grp, members in gen.GROUP_MEMBERS.items():
                if sid not in members:
                    continue
                lead = gen.CFG_ALIAS.get(grp, members[0])
                if sid == lead:
                    group_lead = True
                    own.extend(loads_by_source.get(grp, []))
                else:
                    counted_under = lead
            kinds = {r.get("kind") for r in own if r.get("state") == st}
            if "load" in kinds and s.get("verified"):
                ingestion = "loaded_verified"
            elif "load" in kinds:
                ingestion = "loaded_unverified"
            elif "sample" in kinds:
                ingestion = "sample_not_a_load"
            elif counted_under:
                ingestion = "included_in_group"
            else:
                ingestion = "not_loaded"
            cited = sum((r.get("parcels") or 0) for r in own if r.get("state") == st and r.get("kind") == "load")
            sources.append({
                "source_id": sid,
                "role": role,
                "verified": bool(s.get("verified")),
                "gate_class": _gate_class(bool(s.get("verified")), gen.catalog_status(sid), s.get("gate"), s.get("redistribution")),
                "residual_block": _residual_block(gen.catalog_status(sid), s.get("gate")),
                "reviewed": s.get("reviewed") or "not recorded",
                "ingestion": ingestion,
                "cited_pipeline_parcels": cited if "load" in kinds else None,
                "cited_source_rows": next((r.get("source_rows") for r in own if r.get("source_rows") is not None), None),
                "counted_under": counted_under,
                "group_lead": group_lead,
                "cost_usd": 0,
            })
        parcel_sources = [s for s in sources if s["role"] == "parcels"]
        matched: set[str] = set()
        unmatched: list[str] = []
        state_counties = counties.get(fips, [])
        for row in load_rows + sample_rows:
            code = row.get("fips")
            if code and len(str(code)) == 5:
                matched.add(str(code))
                continue
            if code and len(str(code)) == 3:
                matched.add(fips + str(code))
                continue
            found = _match_fips(row["area"], state_counties)
            if found:
                matched.add(fips + found)
            else:
                unmatched.append(row["area"])
        if load_rows and not unmatched:
            counties_without_row: int | None = len(state_counties) - len(matched)
        else:
            counties_without_row = None
        pipeline = sum((r.get("parcels") or 0) for r in load_rows) if load_rows else None
        pipeline_verified = sum((r.get("parcels") or 0) for r in load_rows if verified(r["source_id"])) if load_rows else None
        if any(s["ingestion"] == "loaded_unverified" for s in sources) and load_rows:
            status = "pipeline_load_includes_unverified"
        elif load_rows:
            status = "pipeline_load"
        elif sample_rows:
            status = "sample_only"
        elif parcel_sources:
            status = "reviewed_not_loaded"
        else:
            status = "not_reviewed"
        dates = []
        for row in load_rows:
            dates.extend(gen.record_info(row["source_id"])["as_of"])
            if row.get("as_of_override"):
                dates.append(row["as_of_override"])
        dates = sorted({d for d in dates if d and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d))})
        jurisdictions.append({
            "admin1": postal,
            "state_fips": fips,
            "display_name": names.get(st, st),
            "census_county_equivalents": len(state_counties),
            "census_county_equivalents_as_of": "2026-11-03",
            "status": status,
            "cited_pipeline_parcels": pipeline,
            "cited_pipeline_parcels_verified_sources": pipeline_verified,
            "cited_sample_parcels": sum((r.get("parcels") or 0) for r in sample_rows) if sample_rows else None,
            "counties_with_a_fips_row": len(matched),
            "counties_without_a_row": counties_without_row,
            "areas_not_a_single_county": unmatched,
            "as_of_recorded": (dates[0] if len(dates) == 1 else f"{dates[0]} to {dates[-1]}") if dates else None,
            "published_queryable": st == "DC",
            "sources": sources,
        })

    outside = []
    for prefix, items in sorted(counties.items()):
        if prefix not in {f for f, _ in STATE_BY_FIPS.items()}:
            outside.append({"state_fips": prefix, "census_county_equivalents": len(items),
                            "status": "outside_product_state_table", "cited_pipeline_parcels": None})

    other = []
    for s in configs:
        if s["_state"] in names:
            continue
        other.append({"source_id": s["source_id"], "area": s["_state"], "role": _role(s["source_id"], gen),
                      "verified": bool(s.get("verified")),
                      "gate_class": _gate_class(bool(s.get("verified")), gen.catalog_status(s["source_id"]), s.get("gate"), s.get("redistribution")),
                      "ingestion": "not_a_state_parcel_roll"})

    return {
        "compiled": COMPILED,
        "compiled_note": "Compiled from the review records, source configs and Census county file in this repository. No publisher file was downloaded to produce these figures.",
        "nationally_complete": False,
        "live_count": False,
        "folklore_used_as_target": False,
        "identifier_scheme": "fl:parcel / fl:entity / fl:building, per the ID spec. flr1 was not adopted.",
        "scope": {
            "geography": "The product state table is the 50 states, the District of Columbia and Puerto Rico (STATE_BY_FIPS in the registry). Census county equivalents outside that table are listed and are not treated as reviewed.",
            "parcels": "Commercial, industrial and multifamily only (state categories B, F1, F2 and subclasses). Single-family and other residential classes are out of scope.",
            "owners": "Organisation owners of record only. Natural-person names are not stored.",
            "entities": "Registered legal entities used to resolve organisation owners, where a state file has been loaded.",
            "values": "Market, appraised and sale figures are stored only when the source states them, with a citation. They are not an appraisal opinion.",
            "queryable_published": "One downloadable District of Columbia sample. Hosted registry lookups are not open.",
        },
        "geography_denominator": {
            "source": "US Census Bureau 2020 county file, public domain, retrieved 2026-11-03 (spec/registry/county-names.tsv)",
            "county_equivalents": county_n,
            "note": "A count of county equivalents, not of commercial parcels.",
        },
        "pipeline": {
            "label": "Sum of cited commercial-parcel rows in scratch loads. Not deduplicated, not live, not a national total.",
            "verified_sources_parcels": verified_pipeline,
            "unverified_sources_parcels": unverified_pipeline,
            "sample_parcels_excluded_from_pipeline": sample_total,
            "cited_entities": entity_total,
            "cited_entities_label": "Sum of cited entity-registry loads. Not a live count.",
        },
        "published_sample": {
            "release_tag": SAMPLE_TAG,
            "commercial_parcels": SAMPLE_PARCELS,
            "release_tag_date": "2026-11-04",
            "geography": "District of Columbia",
            "live_hosted_lookups": False,
            "cite": qc["doc"],
        },
        "jurisdictions": jurisdictions,
        "outside_product_state_table": outside,
        "sources_outside_state_table": other,
        "rejected_proposals": REJECTED_PROPOSALS,
        "decisions": [
            {
                "id": "2026-11-06-cited-facts",
                "date": "2026-11-06",
                "effect": "Withdrawn. A general surge message is not a redistribution grant. The eight terms-gated sources stay gated. Staging counts from them are not publishable totals.",
                "publishable": False,
            }
        ],
    }


def _cell(value: Any) -> str:
    if value is None:
        return "not recorded"
    return str(value).replace("|", "/")


def render_markdown(matrix: dict[str, Any]) -> str:
    pipe = matrix["pipeline"]
    sample = matrix["published_sample"]
    lines = [
        "# Registry coverage matrix",
        "",
        f"Compiled {matrix['compiled']} from the review records, source configs and the Census county file already in this repository.",
        "No publisher file was read to produce this page. It is not a live inventory and it is not nationally complete.",
        "",
        "## Scope",
        "",
        matrix["scope"]["geography"],
        "",
        matrix["scope"]["parcels"],
        "",
        matrix["scope"]["owners"] + " " + matrix["scope"]["entities"],
        "",
        matrix["scope"]["values"],
        "",
        matrix["scope"]["queryable_published"],
        "",
        "## What can be queried",
        "",
        f"Published sample: {sample['geography']}, release tag `{sample['release_tag']}`, "
        f"{sample['commercial_parcels']:,} commercial parcels. Hosted registry lookups are not open. "
        "This sample is not the pipeline sum below.",
        "",
        "## Pipeline row sum",
        "",
        f"Verified-source rows: {pipe['verified_sources_parcels']:,}. "
        f"Unverified-source rows: {pipe['unverified_sources_parcels']:,}. "
        f"Sample rows, excluded from both: {pipe['sample_parcels_excluded_from_pipeline']:,}. "
        f"Cited registered entities: {pipe['cited_entities']:,}.",
        "",
        pipe["label"] + " " + pipe["cited_entities_label"],
        "",
        f"Census county equivalents in the 2020 file: {matrix['geography_denominator']['county_equivalents']:,} "
        "(retrieved 2026-11-03). That is not a parcel count.",
        "",
        "A state with no cited load shows `not recorded` rather than zero. "
        "`counties without a row` is filled only when every cited area is one county. "
        "A statewide phrase does not invent a county remainder.",
        "",
        "## States",
        "",
        "| State | Census counties | Status | Cited pipeline parcels | Sample parcels | Counties without a row | As-of recorded | Published sample |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for j in matrix["jurisdictions"]:
        lines.append("| " + " | ".join([
            _cell(j["display_name"]),
            f"{j['census_county_equivalents']:,}",
            _cell(j["status"]),
            _cell(f"{j['cited_pipeline_parcels']:,}" if j["cited_pipeline_parcels"] is not None else None),
            _cell(f"{j['cited_sample_parcels']:,}" if j["cited_sample_parcels"] is not None else None),
            _cell(f"{j['counties_without_a_row']:,}" if j["counties_without_a_row"] is not None else None),
            _cell(j["as_of_recorded"]),
            "yes, DC sample" if j["published_queryable"] else "no",
        ]) + " |")
    lines += [
        "",
        "## Gates",
        "",
        "A source is `loaded_verified` only when a person set `verified` and a cited load exists. "
        "Purchase, click-through, automated-access and records-request gates stay blocked. "
        "Public access is not a redistribution grant. Nothing below was fetched for this page.",
        "",
        "| State | Source | Role | Gate | Ingestion | Cited source rows |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for j in matrix["jurisdictions"]:
        for s in j["sources"]:
            if s["ingestion"] == "not_loaded" and s["gate_class"] == "verified" and s["role"] == "enrichment":
                continue
            if s["role"] == "enrichment" and s["ingestion"] == "not_loaded":
                continue
            lines.append("| " + " | ".join([
                _cell(j["display_name"]),
                f"`{s['source_id']}`",
                s["role"],
                s["gate_class"],
                s["ingestion"],
                _cell(f"{s['cited_source_rows']:,}" if s["cited_source_rows"] is not None else None),
            ]) + " |")
    lines += [
        "",
        "## Outside the product state table",
        "",
        "These Census prefixes are in the county file and are not in the registry state table. No parcel count is implied.",
        "",
    ]
    for item in matrix["outside_product_state_table"]:
        lines.append(f"- FIPS {item['state_fips']}: {item['census_county_equivalents']} county equivalents, {item['status']}.")
    lines += [
        "",
        "## Terms gates",
        "",
        "A general request to finish the registry is not a redistribution grant. Sources whose own terms do not grant redistribution stay gated. "
        "Paid extracts, click-through gates, automated-access blocks, Arizona's commercial-purpose filing, and a roll the publisher sells stay closed. "
        "A staging count is not a publishable total.",
        "",
        "## Proposals not adopted",
        "",
    ]
    for item in matrix["rejected_proposals"]:
        lines.append(f"- `{item['id']}` ({item['disposition']}): {item['reason']}")
    lines.append("")
    return "\n".join(lines)


def render_json(matrix: dict[str, Any]) -> str:
    return json.dumps(matrix, indent=2, sort_keys=True) + "\n"


def write(root: Path, matrix: dict[str, Any] | None = None) -> dict[str, Any]:
    root = Path(root)
    matrix = matrix if matrix is not None else build(root)
    docs = root / "docs" / "registry"
    (docs / "coverage-matrix.json").write_text(render_json(matrix), encoding="utf-8")
    (docs / "coverage-matrix.md").write_text(render_markdown(matrix), encoding="utf-8")
    return matrix
