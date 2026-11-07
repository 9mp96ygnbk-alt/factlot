#!/usr/bin/env python3
"""Generate docs/registry/coverage.md and docs/registry/rights.md.

    python3 scripts/registry/gen_coverage_docs.py           # rewrite both pages
    python3 scripts/registry/gen_coverage_docs.py --check   # fail if either page is out of date

Python standard library only. Nothing is invented here:

* rights.md is read from the machine-readable source configs (registry/sources/**/*.json: license,
  ai_use, redistribution, terms_url, gate, verified, reviewed) and links each source's review record;
* coverage.md joins those configs with (a) the counts in docs/registry/coverage-data.json, each of which
  quotes the review record or catalog it was read from (this script fails if a quote is not in the
  document, or a number is not in its quote), (b) the per-county tables of the statewide review records,
  parsed as written, (c) as-of dates found in each record's run commands, and (d) which parcel fields
  each adapter maps (read from its source code).
"""

from __future__ import annotations

import ast
import glob
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DOCS = os.path.join(ROOT, "docs", "registry")
CONFIGS = os.path.join(ROOT, "registry", "sources")
ADAPTERS = os.path.join(ROOT, "python", "src", "factlot", "registry", "adapters")

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
# A record that covers several configs (the NC OneMap counties share one review record and licence).
CFG_ALIAS = {"nc-onemap-parcels": "nc-onemap-guilford"}
GROUP_MEMBERS = {"nc-onemap-parcels": ["nc-onemap-guilford", "nc-onemap-forsyth", "nc-onemap-cumberland", "nc-onemap-johnston", "nc-onemap-newhanover"]}
ENRICHMENT = {"dc-dcgis-zoning", "ny-nyc-dcp-pluto", "ny-nyc-dof-sales"}
# What a source holds when it is neither a parcel roll nor an entity file (SEC filings, not loaded as parcels).
HOLDS_OVERRIDES = {"sec-edgar-cmbs-abs-ee": "building loan facts", "sec-edgar-exhibit-21": "entity parent links"}
# Where a source's review record is not <id>.md.
RECORD_OVERRIDES = {
    "tx-harris-cad": "texas-sources.md", "tx-dallas-cad": "texas-sources.md", "tx-tarrant-ad": "texas-sources.md",
    "tx-bexar-ad": "texas-sources.md", "tx-comptroller-franchise": "texas-sources.md", "tx-txgio-parcels": "texas-sources.md",
}
for _c in ("buncombe", "gaston", "iredell", "guilford", "forsyth", "cumberland", "johnston", "newhanover"):
    RECORD_OVERRIDES[f"nc-onemap-{_c}"] = "sources/nc-onemap-parcels.md"
ADAPTER_OVERRIDES = {
    "tx-harris-cad": "tx_harris", "tx-dallas-cad": "tx_dallas", "tx-tarrant-ad": "tx_tarrant", "tx-comptroller-franchise": "tx_comptroller",
    "pa-philadelphia-opa": "pa_philadelphia", "ma-boston-assessing": "ma_boston", "ny-nyc-dof": "ny_nyc",
    "ny-nyc-dcp-pluto": "ny_pluto", "ny-nyc-dof-sales": "ny_sales", "dc-dcgis-zoning": "dc_zoning",
    "mn-opt-in-parcels": "mn_opt_in", "ct-parcel-cama-layer": "ct_parcel_cama", "ct-parcel-cama": "ct_parcel_cama",
    "ut-ugrc-lir": "ut_ugrc", "mt-msl-cadastral": "mt_msl", "or-metro-rlis-taxlots": "or_metro_rlis",
    "nc-mecklenburg-assessor": "nc_mecklenburg", "tn-davidson-assessor": "tn_davidson", "md-sdat-real-property": "md_sdat",
    "md-sdat-entities": "md_sdat", "wi-statewide-parcels": "wi_statewide", "pa-allegheny-assessments": "pa_allegheny",
    "pa-montgomery-parcels": "pa_montgomery", "wa-pierce-assessor": "wa_pierce", "wa-king-assessor": "wa_king",
    "ga-dekalb-parcels": "ga_dekalb", "ga-fulton-assessor": "ga_fulton", "mi-oakland-parcels": "mi_oakland",
    "mi-wayne-parcels": "mi_wayne", "in-marion-parcels": "in_marion", "az-maricopa-assessor": "az_maricopa",
    "il-cook-assessor": "il_cook", "fl-dor-nal": "fl_dor", "nc-wake-parcels": "nc_wake", "nc-onemap-parcels": "nc_onemap",
    "ca-sacramento-assessor": "ca_sacramento", "va-fairfax-assessor": "va_fairfax", "oh-franklin-auditor": "oh_franklin",
    "oh-cuyahoga-parcels": "oh_cuyahoga", "ar-gis-parcels": "ar_gis", "vt-vcgi-parcels": "vt_vcgi",
    "ny-orpts-rolls": "ny_orpts", "mn-hennepin-assessor": "mn_hennepin", "co-denver-assessor": "co_denver",
    "dc-otr-real-property": "dc_otr",
}
for _c in ("buncombe", "gaston", "iredell", "guilford", "forsyth", "cumberland", "johnston", "newhanover"):
    ADAPTER_OVERRIDES[f"nc-onemap-{_c}"] = "nc_onemap"


# ------------------------------------------------------------------ text helpers


def norm(s: str) -> str:
    """For quote matching: drop markup the docs use, collapse whitespace."""
    s = s.replace("`", "").replace("*", "").replace("’", "'")
    return re.sub(r"\s+", " ", s).strip()


def width(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def cell(s) -> str:
    """Make text safe and stable for a Markdown table cell (so Prettier leaves it alone)."""
    s = "" if s is None else str(s)
    s = s.replace("\n", " ").replace("|", "/").replace("*", "").replace("`", "").replace("<", "(").replace(">", ")")
    s = s.replace("_", " ") if re.search(r"(^|\s)_|_($|\s)", s) else s
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\[([^\]]*)\]\(([^)]*)\)", r"\1", s) if "](" in s and not s.startswith("[") else s
    return s


def table(headers: list[str], rows: list[list[str]]) -> str:
    """A pipe table padded the way Prettier formats it."""
    cols = len(headers)
    w = [max(3, width(headers[i]), *(width(r[i]) for r in rows)) for i in range(cols)]

    def line(vals):
        return "| " + " | ".join(v + " " * (w[i] - width(v)) for i, v in enumerate(vals)) + " |"

    out = [line(headers), "| " + " | ".join("-" * w[i] for i in range(cols)) + " |"]
    out += [line(r) for r in rows]
    return "\n".join(out)


def clause(text: str | None, limit: int = 110) -> str:
    """The first clause of a recorded statement, cut at a natural break and marked when shortened."""
    if not text:
        return "not recorded"
    t = norm(text)
    if len(t) <= limit:
        return t
    cut = max((t.rfind(sep, 0, limit) for sep in ("; ", ". ", ": ", " (", ", ")), default=-1)
    if cut < 40:
        cut = t.rfind(" ", 0, limit)
    return t[:cut].rstrip(" ;:,.(") + " ..."


def num(n) -> str:
    return "not recorded" if n is None else f"{n:,}"


# ------------------------------------------------------------------ inputs


def load_configs() -> list[dict]:
    out = []
    for path in sorted(glob.glob(os.path.join(CONFIGS, "**", "*.json"), recursive=True)):
        rel = os.path.relpath(path, CONFIGS)
        state = rel.split(os.sep)[0].upper() if os.sep in rel else rel.split(".")[0][:2].upper()
        state = "TX" if rel == "texas.json" else state
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for s in data["sources"]:
            s = dict(s)
            s["_state"] = state
            s["_config"] = os.path.relpath(path, ROOT)
            out.append(s)
    out.sort(key=lambda s: (s["_state"], s["source_id"]))
    return out


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


_doc_cache: dict[str, str] = {}


def doc_norm(rel: str) -> str:
    if rel not in _doc_cache:
        _doc_cache[rel] = norm(read(rel))
    return _doc_cache[rel]


def record_path(sid: str) -> str | None:
    if sid in RECORD_OVERRIDES:
        p = RECORD_OVERRIDES[sid]
        p = p if p.startswith("sources/") else p
        return f"docs/registry/{p}"
    p = f"docs/registry/sources/{sid}.md"
    return p if os.path.exists(os.path.join(ROOT, p)) else None


def record_info(sid: str) -> dict:
    p = record_path(sid)
    info = {"path": p, "title": None, "area": None, "as_of": []}
    if not p:
        return info
    text = read(p)
    first = text.split("\n", 1)[0].lstrip("# ").strip()
    info["title"] = first
    m = re.match(r"^`?[a-z0-9-]+`?\s*(?::|—|-)\s*(.+)$", first)
    area = m.group(1) if m else first
    info["area"] = re.sub(r"\s*\(access review\)|:\s*access review$", "", area)
    # as-of dates from the record's own run commands
    dates = sorted(set(re.findall(r"--as-of[ =](\d{4}-\d{2}-\d{2})", text)))
    info["as_of"] = dates
    return info


def adapter_module(sid: str) -> str | None:
    if sid in ADAPTER_OVERRIDES:
        return ADAPTER_OVERRIDES[sid]
    # tx-collin-cad -> tx_collin: the longest leading run of the id (at least state + name) that is an adapter module
    parts = sid.split("-")
    for k in range(len(parts), 1, -1):
        mod = "_".join(parts[:k])
        if os.path.exists(os.path.join(ADAPTERS, mod + ".py")):
            return mod
    return None


_adapter_cache: dict[str, dict] = {}


def adapter_fields(mod: str | None, _seen: frozenset = frozenset()) -> dict:
    """What an adapter maps, from its source code: ParcelRecord keyword arguments and fact predicates."""
    empty = {"kw": set(), "preds": set(), "module": mod}
    if not mod:
        return empty
    if mod in _adapter_cache:
        return _adapter_cache[mod]
    with open(os.path.join(ADAPTERS, mod + ".py"), encoding="utf-8") as f:
        tree = ast.parse(f.read())
    kw, preds = set(), set()
    siblings = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            name = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if name == "ParcelRecord":
                kw.update(k.arg for k in n.keywords if k.arg)
        elif isinstance(n, ast.Constant) and isinstance(n.value, str) and re.fullmatch(r"(zoning|parcel|transaction)\.[a-z_]+", n.value):
            preds.add(n.value)
        elif isinstance(n, ast.ImportFrom) and n.level >= 1 and n.module and os.path.exists(os.path.join(ADAPTERS, n.module + ".py")):
            siblings.append(n.module)
    if not kw:
        for sib in siblings:
            if sib not in _seen and sib not in ("arcgis_pages", "dbf_reader", "xlsx_reader"):
                sub = adapter_fields(sib, _seen | {mod})
                kw |= sub["kw"]
                preds |= sub["preds"]
    res = {"kw": kw, "preds": preds, "module": mod}
    _adapter_cache[mod] = res
    return res


def building_facts(f: dict) -> str:
    parts = []
    if "year_built" in f["kw"]:
        parts.append("year built")
    if "improvement_area_sf" in f["kw"]:
        parts.append("building area")
    return ", ".join(parts) if parts else "not mapped"


def sales_facts(f: dict) -> str:
    return "mapped" if ("sales" in f["kw"] or "transaction.sale" in f["preds"]) else "not mapped"


def zoning_facts(f: dict) -> str:
    return "mapped" if any(p.startswith("zoning.") for p in f["preds"]) else "not mapped"


# ------------------------------------------------------------------ verified counts


def verify_cites(entry: dict, label: str) -> None:
    quotes = []
    for c in entry["cites"]:
        doc = doc_norm(c["doc"])
        q = norm(c["quote"])
        if q not in doc:
            raise SystemExit(f"coverage-data.json: {label}: quote not found in {c['doc']}: {c['quote']!r}")
        quotes.append(q)
    blob = " ".join(quotes)
    for key in ("parcels", "org_owners", "entities"):
        v = entry.get(key)
        if isinstance(v, int) and v != 0 and f"{v:,}" not in blob:
            raise SystemExit(f"coverage-data.json: {label}: {key} {v:,} is not in its quotes")
        if v == 0 and key == "org_owners" and not re.search(r"\b0\b", blob):
            raise SystemExit(f"coverage-data.json: {label}: org_owners 0 is not in its quotes")
    for c in entry.get("enrichment", {}).get("cites", []):
        if norm(c["quote"]) not in doc_norm(c["doc"]):
            raise SystemExit(f"coverage-data.json: {label}: enrichment quote not found in {c['doc']}: {c['quote']!r}")


def parse_county_tables(rec_path: str, heading_has: str = "Statewide full load") -> list[dict]:
    """Rows of the 'County (FIPS)' table under a heading, as the record wrote them."""
    lines = read(rec_path).split("\n")
    head, rows, i = "", [], 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("#"):
            head = ln
        if ln.startswith("|") and heading_has in head and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1]):
            hdr = [norm(c) for c in ln.strip().strip("|").split("|")]
            if hdr[0].startswith("County (FIPS)"):
                col = {h: k for k, h in enumerate(hdr)}
                pk = next((h for h in ("Parcels", "Distinct parcels") if h in col), None)
                ok = next((h for h in hdr if h.startswith("Organisation owners")), None)
                lk = next((h for h in hdr if h.startswith("Ownership links")), None)
                ak = next((h for h in hdr if h.startswith("As-of")), None)
                j = i + 2
                while j < len(lines) and lines[j].startswith("|"):
                    vals = [norm(c) for c in lines[j].strip().strip("|").split("|")]
                    m = re.match(r"^(.*?)\s*\((\d{5})\)$", vals[0])
                    if m and pk:
                        def n(h):
                            return int(vals[col[h]].replace(",", "")) if h and vals[col[h]].replace(",", "").isdigit() else None
                        rows.append({"county": m.group(1), "fips": m.group(2), "parcels": n(pk), "org": n(ok), "links": n(lk),
                                     "as_of": vals[col[ak]] if ak else None})
                    j += 1
                i = j
                continue
        i += 1
    return rows


# ------------------------------------------------------------------ rights.md


_catalog_status: dict[str, str] | None = None


def catalog_status(sid: str) -> str | None:
    """The status word the source catalog and Tier 2 region tables give an unverified source ('gated: terms')."""
    global _catalog_status
    if _catalog_status is None:
        _catalog_status = {}
        files = [os.path.join("docs", "registry", "sources", "README.md")] + sorted(
            os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(DOCS, "tier2", "*.md")))
        ids = [c["source_id"] for c in load_configs()]
        for f in files:
            for ln in read(f).split("\n"):
                if not ln.startswith("|"):
                    continue
                cells = [c.strip() for c in ln.strip().strip("|").split("|")]
                for known in ids:
                    if any(re.search(r"(^|[`\[])" + re.escape(known) + r"([`\]\s(]|$)", c) for c in cells[:2]):
                        for c in cells[1:]:
                            cc = norm(c)
                            if re.match(r"^(gated|none)\b", cc, re.I):
                                _catalog_status.setdefault(known, cc)
    return _catalog_status.get(sid)


def short_status(s: dict) -> str:
    if s.get("verified"):
        return "verified"
    cat = catalog_status(s["source_id"])
    if cat:
        return "no bulk source found (see record)" if cat.lower().startswith("none") else clause(cat, 60)
    g = s.get("gate")
    return f"gated: {clause(g, 70)}" if g else "not verified (see record)"


def attribution(s: dict) -> str:
    for field in ("redistribution", "license"):
        t = s.get(field) or ""
        m = re.search(r"[Aa]ttribution:\s*(.+?)(?:\s*$|;\s)", t)
        if m:
            return norm(m.group(1)).rstrip(".")
        m = re.search(r"[Aa]ttribution(?: is)? not required[^;.]*[;.]?\s*(credit [^;.]*)?", t)
        if m:
            return "not required" + (f"; {norm(m.group(1))}" if m.group(1) else "")
        m = re.search(r"([Cc]redit [^;.]+)", t)
        if m and "ttribution" in t:
            return norm(m.group(1))
    return "not recorded"


def gen_rights(configs: list[dict]) -> str:
    n_ver = sum(1 for s in configs if s.get("verified"))
    ai_flag = [s for s in configs if re.search(r"ai-train=no|AI training|AI-training|prohibit", s.get("ai_use") or "", re.I)]
    lines = [
        "# Source rights table",
        "",
        "Generated by [`scripts/registry/gen_coverage_docs.py`](../../scripts/registry/gen_coverage_docs.py) from the machine-readable",
        "source configs in [`registry/sources/`](../../registry/sources/) (the `license`, `ai_use`, `redistribution`, `terms_url`, `gate`,",
        "`verified` and `reviewed` fields). Do not edit this page by hand; edit the config and the review record, then regenerate.",
        "",
        "This is a record of what each publisher says, as FactLot's reviewers read it on the date shown. It is **not legal advice**, and",
        "it is not a grant of any right. Cells are shortened at a natural break and end in `...` when cut; the complete text is in the",
        "config linked in the last column, and the reasoning is in the review record.",
        "",
        "How to read the columns:",
        "",
        "- **Status.** `verified` means a person can rely on the recorded terms, the file URLs were confirmed by a real download, and",
        "  the licence permits redistribution of the facts (data policy section 5). A `gated` source has an adapter or a review but",
        "  nothing is collected until the gate is cleared by a person; the gate is named.",
        "- **AI use.** What the publisher says about use for AI or machine learning. Most publishers say nothing; the cell then reads",
        '  "Not addressed". Where a publisher signals a reservation (for example a `robots.txt` content signal `ai-train=no`, or an',
        "  acceptable-use list that names AI training), it is shown here and FactLot does not train models on that data.",
        "- **Redistribution.** Whether the published terms allow FactLot to redistribute the facts, in the publisher's terms or the",
        "  reviewer's reading.",
        "- **Attribution.** The credit line the record gives, when it gives one.",
        "",
        f"{len(configs)} sources, {n_ver} verified. {len(ai_flag)} sources carry an AI-use reservation or restriction in their recorded",
        "`ai_use` text: " + ", ".join(f"`{s['source_id']}`" for s in ai_flag) + ".",
        "",
    ]
    by_state: dict[str, list[dict]] = {}
    for s in configs:
        by_state.setdefault(s["_state"], []).append(s)
    for st in sorted(by_state, key=lambda c: STATES.get(c, c)):
        lines += [f"## {STATES.get(st, st)}", ""]
        rows = []
        for s in by_state[st]:
            rec = record_path(s["source_id"])
            link = f"[record]({os.path.relpath(os.path.join(ROOT, rec), DOCS)})" if rec else "no separate record"
            cfg = f"[config]({os.path.relpath(os.path.join(ROOT, s['_config']), DOCS)})"
            terms = f"[terms]({s['terms_url']})" if s.get("terms_url") else "no terms URL"
            rows.append([
                f"`{s['source_id']}`", cell(short_status(s)), cell(clause(s.get("license"), 130)), cell(clause(s.get("ai_use"), 110)),
                cell(clause(s.get("redistribution"), 130)), cell(attribution(s)), s.get("reviewed", "not recorded"),
                f"{link}, {cfg}, {terms}",
            ])
        lines += [table(["Source", "Status", "Licence", "AI use", "Redistribution", "Attribution", "Reviewed", "Links"], rows), ""]
    return "\n".join(lines).rstrip("\n") + "\n"


# ------------------------------------------------------------------ coverage.md


def hosted_area(data: dict, sid: str, area: str) -> dict | None:
    """The coverage-data.json `hosted_areas` entry for `sid` when it covers the county row `area` (None if not hosted)."""
    h = data.get("hosted_areas", {}).get(sid)
    if not h:
        return None
    if h["areas"] == "all":
        return h
    m = re.search(r"\((\d{5})\)", area or "")
    return h if m and m.group(1) in h["areas"] else None


def coverage_rows(configs: list[dict]) -> tuple[dict, dict, dict[str, list[dict]]]:
    """The checked coverage rows, by state: curated loads plus the per-county tables of the statewide records.

    Also used by gen_coverage_map.py, so the map and coverage.md are read from the same rows."""
    cfg = {s["source_id"]: s for s in configs}
    with open(os.path.join(DOCS, "coverage-data.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    for i, e in enumerate(data["loads"]):
        verify_cites(e, f"loads[{i}] {e['source_id']} {e['area']}")
    for i, e in enumerate(data["entity_registries"]):
        verify_cites(e, f"entity_registries[{i}] {e['source_id']}")
    qc = data["queryable_cite"]
    if norm(qc["quote"]) not in doc_norm(qc["doc"]):
        raise SystemExit("coverage-data.json: queryable_cite quote not found")
    for sid in list(data["queryable"]) + [e["source_id"] for e in data["loads"]] + [e["source_id"] for e in data["entity_registries"]]:
        if CFG_ALIAS.get(sid, sid) not in cfg:
            raise SystemExit(f"coverage-data.json: unknown source_id {sid}")

    # rows per state: curated loads + per-county tables of the statewide records
    rows_by_state: dict[str, list[dict]] = {}
    seen = set()

    def add_row(r: dict) -> None:
        key = (r["state"], r["area"].lower())
        if key in seen:
            raise SystemExit(f"duplicate coverage row {key}")
        seen.add(key)
        rows_by_state.setdefault(r["state"], []).append(r)

    for e in data["loads"]:
        add_row({**e, "fips": None, "as_of_override": None})
    table_sources = {"ny-orpts-rolls": "NY", "md-sdat-real-property": "MD", "ut-ugrc-lir": "UT", "wi-statewide-parcels": "WI",
                     "ma-massgis-parcels": "MA"}
    owners_note = {"md-sdat-real-property": "no (withheld by the publisher)", "ut-ugrc-lir": "no (not in the file)"}
    for sid, st in table_sources.items():
        rp = record_path(sid)
        for t in parse_county_tables(rp):
            name = t["county"]
            if not re.search(r"(City|County|Borough|Parish)$", name):
                name += " County"
            org = t["org"]
            if sid in owners_note:
                owners = owners_note[sid]
            else:
                owners = "yes" if (org or 0) > 0 else "none stored in this load"
            add_row({
                "source_id": sid, "state": st, "area": f"{name} ({t['fips']})", "kind": "load", "parcels": t["parcels"],
                "org_owners": org, "owner_names": owners,
                "entity_links": ("%s ownership links" % f"{t['links']:,}") if t["links"] is not None else "not recorded",
                "notes": "", "cites": [{"doc": rp, "quote": "County (FIPS)"}], "fips": t["fips"], "as_of_override": t["as_of"],
            })
    return cfg, data, rows_by_state


def gen_coverage(configs: list[dict]) -> str:
    cfg, data, rows_by_state = coverage_rows(configs)

    loaded_sources = {r["source_id"] for rows in rows_by_state.values() for r in rows}
    for grp, members in GROUP_MEMBERS.items():
        if grp in loaded_sources:
            loaded_sources.update(members)
    loaded_entities = {e["source_id"]: e for e in data["entity_registries"]}
    parcel_sources = [s for s in configs if "entities" not in s["source_id"] and s["source_id"] not in ENRICHMENT
                      and s["source_id"] != "tx-comptroller-franchise"]
    entity_sources = [s for s in configs if "entities" in s["source_id"] or s["source_id"] == "tx-comptroller-franchise"]
    queryable = data["queryable"]

    def queryable_text(sid: str, area: str = "") -> str | None:
        """The 'Queryable today' cell for a source (and, for a partly hosted source, a county row), or None."""
        if sid in queryable:
            return queryable[sid]
        h = hosted_area(data, sid, area)
        return h["text"] if h else None

    def hosted_state(st: str, state_rows: list[dict]) -> str:
        """The state's 'Queryable today' cell in the summary table: 'Yes', 'Partly' (some counties) or 'No'."""
        flags = [queryable_text(r["source_id"], r["area"]) is not None for r in state_rows]
        if not any(flags):
            return "No: not hosted"
        if st == "DC":
            return "Yes: hosted (and a downloadable sample)"
        if all(flags):
            return "Yes: hosted"
        return f"Partly: hosted for {sum(flags)} of {len(flags)} rows"

    def licence_short(sid: str) -> str:
        s = cfg[CFG_ALIAS.get(sid, sid)]
        return cell(clause(s.get("license"), 60)) + ("" if s.get("verified") else " (gated)")

    def ai_short(sid: str) -> str:
        return cell(clause(cfg[CFG_ALIAS.get(sid, sid)].get("ai_use"), 60))

    def as_of(r: dict) -> str:
        if r.get("as_of_override"):
            return r["as_of_override"]
        d = record_info(r["source_id"])["as_of"]
        if not d:
            return "not recorded in the record"
        return d[-1] if len(d) == 1 else f"{d[0]} to {d[-1]}"

    total_parcels = sum(r["parcels"] or 0 for rows in rows_by_state.values() for r in rows if r["kind"] == "load")
    total_rows = sum(1 for rows in rows_by_state.values() for r in rows if r["kind"] == "load")
    states_loaded = sorted(st for st, rows in rows_by_state.items() if any(r["kind"] == "load" for r in rows) and st != "DC")
    verified_sum = sum(r["parcels"] or 0 for rows in rows_by_state.values() for r in rows
                       if r["kind"] == "load" and cfg[CFG_ALIAS.get(r["source_id"], r["source_id"])].get("verified"))
    gated_sum = total_parcels - verified_sum
    gated_ids = sorted({r["source_id"] for rows in rows_by_state.values() for r in rows
                        if r["kind"] == "load" and not cfg[CFG_ALIAS.get(r["source_id"], r["source_id"])].get("verified")})
    headline_ok = f"{verified_sum:,}" in doc_norm("docs/registry/tier2/README.md")
    n_ver = sum(1 for s in configs if s.get("verified"))

    L = [
        "# Registry coverage",
        "",
        "What the FactLot registry's source reviews hold, state by state and county by county, and what you can query today.",
        "Generated by [`scripts/registry/gen_coverage_docs.py`](../../scripts/registry/gen_coverage_docs.py); do not edit by hand.",
        "Licence and AI-use detail per source: [rights.md](rights.md).",
        "",
        "## Read this first",
        "",
        "- **Queryable today.** The hosted API at `https://api.factlot.com` answers registry lookups, on every plan including the free tier,",
        "  for **Maryland** (all 24 jurisdictions), the **District of Columbia** and **Juab and Summit counties in Utah**: 128,854 parcels in 27",
        "  counties. Call `registry_coverage` first: it lists exactly what is hosted. The DC data is also the downloadable **DC sample**, a 23.4 MB",
        "  database file (CC BY 4.0) you can run yourself (`FACTLOT_REGISTRY_DB`). **No other region is hosted**: Texas, New York City and the rest",
        "  run only on a self-hosted FactLot with a registry file, and more hosted regions open as their terms allow. Every row says which it is.",
        "  The counts below are what the project's own pipeline built into scratch registries from the publishers' files; the hosted counts and",
        "  data dates for Maryland and Utah can differ slightly from the recorded loads.",
        "- **Counts are as recorded.** Each number is quoted from a review record or the source catalog (see `coverage-data.json`, which the",
        "  generator checks against the documents) or read from a per-county table in a statewide record. They are **commercial** parcels",
        "  (state categories B, F1, F2: apartments and multifamily, commercial improved, industrial improved) in scope of FactLot's data policy,",
        "  not all parcels. Counts are from the load named in the as-of column and will move when a source is reloaded. Some Tier 1 counts are",
        "  first-pass figures; the quality pass of 2026-11-03 corrected some of them, see",
        "  [quality/tier1-2026-11-03.md](quality/tier1-2026-11-03.md) for the audited fill rates.",
        "- **Owner names** are stored only when the owner of record is an organisation (the `is_organization` rule); natural-person names are",
        "  never stored. 'Organisation owners' is the number of parcels whose owner of record is an organisation. 'Owner names: no' means the",
        "  publisher's file has none, or withholds them.",
        "- **Entity links** are parcels whose organisation owner was matched to a registered entity in a state entity file. Where no entity",
        "  registry is loaded for the state, links cannot exist.",
        "- **Zoning, sales and building facts** read 'yes' only where the registry record documents the facts for that jurisdiction, or 'mapped'",
        "  where the adapter's code maps the field when the publisher's file carries it. 'Mapped' is not a fill rate: the file may leave the field",
        "  blank for many parcels. Fill rates for the Tier 1 sources are in the quality audit.",
        "- **As-of** is the date the load was run against (`--as-of` in the record's command), which is the publisher's data date, not the",
        "  date we built it. Where a record shows more than one run, the range is shown. `not recorded in the record` means the record",
        "  does not give an as-of date.",
        "- **Not loaded.** For every reviewed source with nothing loaded, the state section says why (the gate) and links the record.",
        "",
        "## Summary",
        "",
        f"{len(configs)} sources are reviewed ({n_ver} verified). The rows below record **{total_parcels:,}** commercial parcels in",
        f"{total_rows} county or county-group rows, in {len(states_loaded)} states and the District of Columbia. Rows from verified sources add up to",
        f"**{verified_sum:,}**" + (" (the figure the project's Tier 2 notes give for the combined load of verified sources)" if headline_ok else "") + f"; the other {gated_sum:,}",
        "come from " + ", ".join(f"`{g}`" for g in gated_ids) + " (loaded, but not verified: gated on terms). Statewide aggregate rows (Vermont, Minnesota, Arkansas, Montana,",
        "Connecticut, North Carolina) stand for several counties each; the record names the counties. Treat the per-row numbers as the record.",
        "",
    ]
    summary = []
    for st in sorted(set(rows_by_state) | {s["_state"] for s in configs}, key=lambda c: STATES.get(c, c)):
        rows = [r for r in rows_by_state.get(st, []) if r["kind"] == "load"]
        samples = [r for r in rows_by_state.get(st, []) if r["kind"] == "sample"]
        ps = [s for s in parcel_sources if s["_state"] == st]
        ents = [e for e in data["entity_registries"] if e["state"] == st]
        summary.append([
            f"[{STATES.get(st, st)}](#{STATES.get(st, st).lower().replace(' ', '-')})",
            str(len(ps)),
            str(sum(1 for s in ps if s.get("verified"))),
            str(len(rows)),
            num(sum(r["parcels"] or 0 for r in rows)) if rows else "none loaded",
            ("sample only" if samples and not rows else "no") if not rows else "yes",
            (f"{ents[0]['entities']:,} entities" if ents else "none loaded"),
            hosted_state(st, rows + samples),
        ])
    L += [table(["State", "Parcel sources reviewed", "Verified", "Rows loaded", "Commercial parcels loaded", "Loaded", "Entity registry", "Queryable today"], summary), ""]

    for st in sorted(set(rows_by_state) | {s["_state"] for s in configs}, key=lambda c: STATES.get(c, c)):
        L += [f"## {STATES.get(st, st)}", ""]
        rows = sorted(rows_by_state.get(st, []), key=lambda r: (r["kind"], r["area"]))
        if rows:
            body = []
            for r in rows:
                sid = r["source_id"]
                f = adapter_fields(adapter_module(sid))
                enrich = r.get("enrichment") or {}
                body.append([
                    cell(r["area"]) + (" (sample)" if r["kind"] == "sample" else ""),
                    f"`{sid}`",
                    cell(num(r["parcels"])),
                    cell(r["owner_names"]),
                    cell(num(r["org_owners"])),
                    cell(r["entity_links"]),
                    cell("yes: " + enrich["zoning"] if enrich.get("zoning") else zoning_facts(f)),
                    cell("yes: " + enrich["sales"] if enrich.get("sales") else sales_facts(f)),
                    cell("yes: " + enrich["buildings"] if enrich.get("buildings") else building_facts(f)),
                    as_of(r),
                    licence_short(sid),
                    ai_short(sid),
                    cell(queryable_text(sid, r["area"]) or "No: not hosted, not in a published sample"),
                ])
            L += [table(["County or area", "Source", "Commercial parcels", "Owner names", "Organisation owners", "Entity links",
                         "Zoning", "Sales", "Building facts", "As-of", "Licence", "AI use", "Queryable today"], body), ""]
        else:
            L += ["Nothing loaded for this state.", ""]
        ents = [e for e in data["entity_registries"] if e["state"] == st]
        if ents:
            L += ["Entity registry loaded: " + "; ".join(
                f"`{e['source_id']}` ({e['name']}, {e['entities']:,} entities; {cell(queryable.get(e['source_id'], 'not hosted'))})" for e in ents) + ".", ""]
        else:
            L += ["Entity registry loaded: none for this state.", ""]
        pend = [s for s in parcel_sources + entity_sources if s["_state"] == st and s["source_id"] not in loaded_sources
                and s["source_id"] not in loaded_entities]
        if pend:
            pb = []
            for s in pend:
                sid = s["source_id"]
                info = record_info(sid)
                rp = record_path(sid)
                link = f"[record]({os.path.relpath(os.path.join(ROOT, rp), DOCS)})" if rp else "no separate record"
                kind = HOLDS_OVERRIDES.get(sid) or ("entities" if s in entity_sources else "parcels")
                pb.append([f"`{sid}`", kind, cell(clause(s.get("publisher") or info["area"] or sid, 80)), cell(short_status(s)), cell(clause(s.get("license"), 70)),
                           s.get("reviewed", "not recorded"), link])
            L += ["Reviewed, nothing loaded:", "", table(["Source", "Holds", "Publisher", "Status", "Licence", "Reviewed", "Record"], pb), ""]
        enr = [s for s in configs if s["_state"] == st and s["source_id"] in ENRICHMENT]
        if enr:
            L += ["Enrichment sources (add facts to parcels already loaded): " + ", ".join(
                f"`{s['source_id']}` ({short_status(s)})" for s in enr) + ".", ""]

    L += [
        "## How this page is made, and what it does not show",
        "",
        "- Source list, status, licence and AI-use text: the configs in `registry/sources/`.",
        "- Counts: `docs/registry/coverage-data.json` (each count with the quote it was read from; the generator fails if the quote is not in",
        "  the document or the number is not in the quote) and the 'County (FIPS)' tables of the statewide records (New York, Maryland, Utah,",
        "  Wisconsin, Massachusetts), parsed as written.",
        "- 'Mapped' building, sales and zoning fields: the adapter source code (`python/src/factlot/registry/adapters/`).",
        "- It does not show field fill rates (see the quality audit), per-county counts for statewide sources whose record does not tabulate",
        "  them (Vermont, Minnesota, Arkansas, Montana, Connecticut, North Carolina's OneMap counties), or anything about counties no one has",
        "  reviewed. A county missing from this page has not been reviewed.",
        "",
    ]
    return "\n".join(L).rstrip("\n") + "\n"


def main(argv: list[str]) -> int:
    configs = load_configs()
    outputs = {os.path.join(DOCS, "rights.md"): gen_rights(configs), os.path.join(DOCS, "coverage.md"): gen_coverage(configs)}
    status = 0
    for path, text in outputs.items():
        rel = os.path.relpath(path, ROOT)
        if "--check" in argv:
            cur = None
            if os.path.exists(path):
                with open(path, encoding="utf-8") as fh:
                    cur = fh.read()
            if cur != text:
                print(f"STALE  {rel} (run scripts/registry/gen_coverage_docs.py)")
                status = 1
            else:
                print(f"ok     {rel}")
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"wrote  {rel} ({len(text.splitlines())} lines)")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
