#!/usr/bin/env python3
"""Generate docs/registry/coverage-counties.json: one entry per county (5-digit FIPS) that the registry's
records give a whole-county commercial load for, with its evidence class. Every other county is grey.

    python3 scripts/registry/gen_coverage_map.py           # rewrite the file
    python3 scripts/registry/gen_coverage_map.py --check   # fail if it is out of date

Python standard library only, and nothing is invented. The rows come from gen_coverage_docs.coverage_rows()
(the same quote-checked rows coverage.md is made from); county identity comes from spec/registry/county-names.tsv
(US Census 2020 FIPS codes); audit results are parsed from the Tier 1 quality audit table as written.

Classes (the reference date is the latest `reviewed` date among the source configs, so the file is stable):

* published_sample: the county's registry data is published for download today (coverage-data.json "queryable").
* audited_load: a whole-county load from a verified source that the Tier 1 quality audit re-read against the
  archived publisher file (the registry holds exactly the parcels the adapter yields), with 0 audit violations
  after the pass and a data as-of date no more than MAX_AGE_DAYS before the reference date. Not hosted.
* cited_load: a whole-county load from a verified source with a per-county parcel count and an as-of date in the
  record, within MAX_AGE_DAYS, that the quality audit has not covered. Not hosted.
* grey (not in the file's `counties`): everything else. Loaded rows that do not qualify are listed in
  `not_counted` with the reason.

Natural-person names never appear: the file holds counts, dates, source ids and publisher terms only.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_coverage_docs as g  # noqa: E402

ROOT = g.ROOT
OUT = os.path.join(ROOT, "docs", "registry", "coverage-counties.json")
TSV = os.path.join(ROOT, "spec", "registry", "county-names.tsv")
AUDIT = "docs/registry/quality/tier1-2026-11-03.md"
MAX_AGE_DAYS = 400  # the quality audit's own age warning threshold

STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11", "FL": "12",
    "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23",
    "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
    "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55",
    "WY": "56",
}

# Curated rows whose area is not a plain "<Name> County": the scope as the record states it. Anything not plain and
# not listed here makes the script fail, so a new row is classified by a person, not guessed.
AREA_SCOPE = {
    ("DC", "District of Columbia"): ("whole", ["11001"], "docs/registry/sources/dc-otr-real-property.md"),
    ("CO", "Denver County (City and County of Denver)"): ("whole", ["08031"], "docs/registry/sources/co-denver-assessor.md"),
    ("OR", "Multnomah County (Portland metro layer)"): ("whole", ["41051"], "docs/registry/sources/or-metro-rlis-taxlots.md"),
    ("OR", "Clackamas County (Portland metro layer)"): ("whole", ["41005"], "docs/registry/sources/or-metro-rlis-taxlots.md"),
    ("OR", "Washington County (Portland metro layer)"): ("whole", ["41067"], "docs/registry/sources/or-metro-rlis-taxlots.md"),
    ("NY", "New York, Kings, Queens, Bronx and Richmond (New York City)"): ("split", None, "docs/registry/sources/ny-nyc-dof.md"),
    ("MA", "Suffolk County (Boston only)"): ("partial", None, "the row covers the City of Boston only, not all of Suffolk County"),
}
AGGREGATE_HINT = re.compile(r"^(all \d+|\d+ (of \d+ )?|\d+ opt-in|\d+ Connecticut)|Counties$|, .* and ", re.I)

# Per-county split of a multi-county row, quoted from its record (the quote is checked against the document).
SPLITS = {
    "ny-nyc-dof": {
        "doc": "docs/registry/sources/ny-nyc-dof.md",
        "quote": "Manhattan 42,087; Brooklyn 60,100; Queens 40,080; Bronx 17,331; Staten Island 5,035",
        "parts": {"36061": 42087, "36047": 60100, "36081": 40080, "36005": 17331, "36085": 5035},
    },
}

# Counties whose record says the count is incomplete, quoted (the quote is checked against the document).
INCOMPLETE = {
    "49039": ("docs/registry/sources/ut-ugrc-lir.md", "Sanpete's layer leaves 9,620 of 12,976 rows without a class, so its 33 commercial parcels are a floor."),
}


def county_names() -> dict[str, str]:
    out = {}
    with open(TSV, encoding="utf-8") as f:
        for ln in f:
            if ln.startswith("#") or not ln.strip():
                continue
            fips, name = ln.rstrip("\n").split("\t")
            out[fips] = name
    return out


def audit_table() -> dict[str, dict]:
    """The Tier 1 audit's before/after table: per source, the after-pass violations, link rate and snapshot dates."""
    rows = {}
    for ln in g.read(AUDIT).split("\n"):
        if not ln.startswith("| ") or "---" in ln:
            continue
        c = [x.strip() for x in ln.strip().strip("|").split("|")]
        if len(c) != 9 or c[0] == "Source":
            continue
        after = lambda v: v.split("→")[-1].strip()  # noqa: E731
        viol = after(c[8])
        rate = after(c[4])
        rows[c[0]] = {
            "violations_after": int(viol) if viol.isdigit() else None,
            "owner_link_rate_after": rate if rate != "n/a" else None,
            "snapshot_as_of": sorted(set(re.findall(r"\d{4}-\d{2}-\d{2}", after(c[7])))),
        }
    if "re-read" not in g.read(AUDIT) and "run again on the archived file" not in g.read(AUDIT):
        raise SystemExit("audit page no longer states the re-read check")
    return rows


def reread_exact_sources() -> set[str]:
    """Sources the audit page names under 'yields exactly the parcels the registry holds'."""
    text = g.norm(g.read(AUDIT))
    m = re.search(r"Every source's adapter, run again on the archived file, yields exactly the parcels the registry holds \((.*?)\)", text)
    if not m:
        raise SystemExit("audit page: re-read sentence not found")
    names = m.group(1)
    keys = {
        "tx-harris-cad": "Texas", "tx-dallas-cad": "Texas", "tx-tarrant-ad": "Texas", "tx-travis-cad": "Texas",
        "tx-collin-cad": "Texas", "ny-nyc-dof": "NYC", "ca-los-angeles-assessor": "LA", "co-denver-assessor": "Denver",
        "dc-otr-real-property": "DC", "mn-hennepin-assessor": "Hennepin", "nc-mecklenburg-assessor": "Mecklenburg",
        "ma-boston-assessing": "Boston", "ca-san-francisco-assessor": "San Francisco", "pa-philadelphia-opa": "Philadelphia",
    }
    return {sid for sid, k in keys.items() if k in names}


def main(argv: list[str]) -> int:
    configs = g.load_configs()
    cfg, data, rows_by_state = g.coverage_rows(configs)
    names = county_names()
    audit = audit_table()
    reread = reread_exact_sources()
    ref = max(s["reviewed"] for s in configs if re.match(r"\d{4}-\d{2}-\d{2}$", s.get("reviewed") or ""))
    ref_d = date.fromisoformat(ref)
    queryable = data["queryable"]

    for sid, sp in SPLITS.items():
        if g.norm(sp["quote"]) not in g.doc_norm(sp["doc"]):
            raise SystemExit(f"split quote for {sid} not found in {sp['doc']}")
        for n in sp["parts"].values():
            if f"{n:,}" not in sp["quote"]:
                raise SystemExit(f"split count {n} for {sid} not in its quote")

    def as_of_dates(r: dict) -> list[str]:
        if r.get("as_of_override"):
            return re.findall(r"\d{4}-\d{2}-\d{2}", r["as_of_override"])
        d = g.record_info(r["source_id"])["as_of"]
        if not d and r["source_id"] in audit:
            d = audit[r["source_id"]]["snapshot_as_of"]
        return d

    counties: dict[str, dict] = {}
    not_counted: list[dict] = []
    used_sources: set[str] = set()

    def skip(r, reason):
        not_counted.append({"area": r["area"], "state": r["state"], "source_id": r["source_id"], "reason": reason})

    for st in sorted(rows_by_state):
        for r in rows_by_state[st]:
            sid = r["source_id"]
            s = cfg[g.CFG_ALIAS.get(sid, sid)]
            if r["kind"] != "load":
                skip(r, "sample only, not a whole-county load")
                continue
            # where the row is
            parts: dict[str, int | None]
            evidence = r["cites"][0]["doc"]
            if r.get("fips"):
                parts = {r["fips"]: r["parcels"]}
            else:
                key = (st, r["area"])
                if key in AREA_SCOPE:
                    scope, fips_list, ev = AREA_SCOPE[key]
                    if scope == "partial":
                        skip(r, f"partial county: {ev}")
                        continue
                    if scope == "split":
                        parts = dict(SPLITS[sid]["parts"])
                        evidence = SPLITS[sid]["doc"]
                    else:
                        parts = {fips_list[0]: r["parcels"]}
                        evidence = ev
                elif re.fullmatch(r"[A-Z][A-Za-z.' ]+ County", r["area"]) and not AGGREGATE_HINT.search(r["area"]):
                    sf = STATE_FIPS[st]
                    hits = [f for f, n in names.items() if f.startswith(sf) and n == r["area"]]
                    if len(hits) != 1:
                        raise SystemExit(f"cannot resolve {r['area']} in {st} to one FIPS: {hits}")
                    parts = {hits[0]: r["parcels"]}
                elif AGGREGATE_HINT.search(r["area"]) or "(" in r["area"]:
                    skip(r, "statewide or multi-county aggregate: the record gives no per-county count")
                    continue
                else:
                    raise SystemExit(f"unclassified area {key}: add it to AREA_SCOPE")
            for f in parts:
                if f not in names:
                    raise SystemExit(f"{r['area']}: FIPS {f} not in county-names.tsv")
            hit = [f for f in parts if f in INCOMPLETE]
            if hit:
                doc, quote = INCOMPLETE[hit[0]]
                if g.norm(quote) not in g.doc_norm(doc):
                    raise SystemExit(f"INCOMPLETE quote for {hit[0]} not found in {doc}")
                skip(r, f"record says the count is incomplete: {quote}")
                continue
            # what it is worth
            if not s.get("verified"):
                skip(r, "source not verified (publisher terms gate open)")
                continue
            if not (s.get("license") and s.get("terms_url") and s.get("reviewed")):
                skip(r, "publisher terms not fully recorded (licence, terms URL, reviewed date)")
                continue
            dates = as_of_dates(r)
            if not dates:
                skip(r, "no data as-of date recorded")
                continue
            age = (ref_d - date.fromisoformat(dates[-1])).days
            if age > MAX_AGE_DAYS:
                skip(r, f"data as-of {dates[-1]} is {age} days before {ref} (over {MAX_AGE_DAYS})")
                continue
            if any(not n for n in parts.values()):
                skip(r, "no commercial parcel count recorded")
                continue
            a = audit.get(sid)
            if sid in queryable and str(queryable[sid]).startswith("Yes"):
                cls = "published_sample"
            elif a and a["violations_after"] == 0 and sid in reread:
                cls = "audited_load"
            else:
                cls = "cited_load"
            used_sources.add(g.CFG_ALIAS.get(sid, sid))
            for f, n in parts.items():
                if f in counties:
                    raise SystemExit(f"{f} counted twice")
                counties[f] = {
                    "name": names[f],
                    "state": st,
                    "class": cls,
                    "source_id": sid,
                    "commercial_parcels": n,
                    "organisation_owners_row": r["org_owners"] if len(parts) == 1 else None,
                    "owner_names": r["owner_names"],
                    "entity_links": r["entity_links"] if len(parts) == 1 else r["entity_links"] + " (whole row)",
                    "owner_link_rate_audited": a["owner_link_rate_after"] if a else None,
                    "data_as_of": dates[-1],
                    "hosted": False if cls != "published_sample" else "download only (hosted lookups not open)",
                    "evidence": evidence,
                }

    sources = {}
    for sid in sorted(used_sources):
        s = cfg[sid]
        sources[sid] = {k: s.get(k) for k in ("publisher", "license", "redistribution", "ai_use", "terms_url", "reviewed")}
        sources[sid]["record"] = g.record_path(sid)
    by_class = {}
    for c in counties.values():
        by_class[c["class"]] = by_class.get(c["class"], 0) + 1
    out = {
        "_about": "FactLot registry coverage by county (5-digit FIPS strings). Generated by scripts/registry/gen_coverage_map.py "
                  "from the quote-checked coverage rows (docs/registry/coverage.md), the Tier 1 quality audit and the source configs; "
                  "do not edit by hand. A county not listed is grey: not reviewed, not loaded, gated, sample only, partial, an aggregate "
                  "with no per-county count, or stale. Counts are commercial parcels (categories B, F1, F2). No natural-person names.",
        "reference_date": ref,
        "max_age_days": MAX_AGE_DAYS,
        "classes": {
            "published_sample": "Published for download today (CC BY 4.0 sample database). Hosted lookups are not open.",
            "audited_load": "Whole-county load from a verified source; the quality audit re-read the archived publisher file and "
                            "found the registry holds exactly its in-scope parcels, with 0 violations. Built, not yet hosted.",
            "cited_load": "Whole-county load from a verified source with a per-county count and as-of date in the record; not yet "
                          "covered by the quality audit. Built, not yet hosted.",
        },
        "counts": dict(sorted(by_class.items())),
        "geography": "US Census 2020 county FIPS codes (spec/registry/county-names.tsv, 3,235 county equivalents incl. territories)",
        "counties": dict(sorted(counties.items())),
        "not_counted": sorted(not_counted, key=lambda x: (x["state"], x["area"])),
        "sources": sources,
    }
    text = json.dumps(out, indent=2, ensure_ascii=False) + "\n"
    rel = os.path.relpath(OUT, ROOT)
    if "--check" in argv:
        cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else None
        if cur != text:
            print(f"STALE  {rel} (run scripts/registry/gen_coverage_map.py)")
            return 1
        print(f"ok     {rel}")
        return 0
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote  {rel}: {len(counties)} counties {out['counts']}, {len(not_counted)} rows not counted")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
