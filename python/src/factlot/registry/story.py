"""Data stories: a short page of computed facts from one registry file, every figure re-checked by code.

    python -m factlot.registry.story --db tx.db --county 48201 --years 2022 2023 2024 2025 \\
        --threshold 10 --threshold 25 --out site/_data/stories/<slug>.json
    python -m factlot.registry.story --verify site/_data/stories/<slug>.json --db tx.db

The generator reads one county's commercial-scope parcels from a registry file and writes one JSON
document: the figures (each with its rule and its cited sources), small tables, template sentences
built by code from the figures, and the file's build identity. No prose comes from a model. The
verifier recomputes every figure by a second route (per parcel, through ``Registry.value_history``,
with plain Python arithmetic and ``statistics``, where the generator scans the county's facts into an
in-memory SQLite table and aggregates with SQL), rebuilds the whole document from its own numbers,
and fails with the figure id on any difference. A passing run writes a stamp beside the story that
holds the story file's SHA-256; the site build refuses a story whose stamp is missing or does not
match.

What the generator enforces (each has a test):

* only parcels in the registry's commercial scope (``is_commercial`` on the current state category);
* no owner names unless ``--name-organisations``, and then only organisations that do not read as a
  person's or a family's (``is_organization`` and not ``personal_style_organization``);
* a withheld county (Tarrant, 48439) is refused;
* no table cell built from fewer than ``MIN_CELL`` parcels, except a county total (the cell is
  written as null and the page says so);
* a roll year that has no value of the chosen type, while it has the other type, is refused rather
  than compared with a year of the other type;
* a source whose rights record prohibits redistribution or AI use is refused;
* a roll year is labelled preliminary when its tax year is later than the year of its file's as-of date
  (the rule the site's county data uses), or when ``--preliminary`` names it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import statistics
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from pathlib import Path
from typing import Any

from .county_names import county_name
from .normalize import STATE_BY_FIPS, is_commercial, is_organization, personal_style_organization
from .store import Registry
from .tx_equity import HOSTED_WITHHELD_COUNTIES

GENERATOR_NAME = "factlot.registry.story"
GENERATOR_VERSION = "1"
STORY_FORMAT = 1
MIN_CELL = 10
TOP_N = 10
COMPTROLLER_SOURCE_ID = "tx-comptroller-franchise"
COMPTROLLER_NAME = "Texas Comptroller of Public Accounts"

GROUP_ORDER = ("F1", "F2", "B")
GROUP_LABELS = {
    "F1": "Commercial real property (state category F1)",
    "F2": "Industrial and manufacturing real property (state category F2)",
    "B": "Multifamily (state category B)",
}
ALL_LABEL = "All parcels in the commercial scope"
VALUE_TYPES = {"market": "market", "appraised": "appraised"}

P_YEAR, P_MARKET, P_APPRAISED = "parcel.tax_year", "parcel.market_value", "parcel.appraised_value"
P_CATEGORY, P_NBHD, P_CLASS, P_OWNER = (
    "parcel.state_property_category", "parcel.neighborhood_code", "parcel.building_class", "ownership.owner_of_record")
VALUE_PREDICATE = {"market": P_MARKET, "appraised": P_APPRAISED}


class StoryRefused(Exception):
    """The generator or verifier will not produce or accept this story, and says why."""


# --- parameters ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Params:
    county: str                          # five-digit FIPS, e.g. "48201"
    years: tuple[int, ...]               # roll (tax) years, ascending, at least two
    thresholds: tuple[str, ...] = ("10",)  # percent, as plain decimal strings
    value_type: str = "market"
    name_organisations: bool = False
    preliminary: tuple[int, ...] = ()

    @property
    def state(self) -> str:
        return self.county[:2]

    @property
    def prefix(self) -> str:
        return f"fl:parcel:us-{self.county}:"


def normalize_params(county: str, years: list[int], thresholds: list[str] | None, value_type: str,
                     name_organisations: bool, preliminary: list[int] | None) -> Params:
    if not re.fullmatch(r"\d{5}", county or ""):
        raise StoryRefused(f"county must be a five-digit FIPS code (state and county), got {county!r}")
    if county in HOSTED_WITHHELD_COUNTIES:
        raise StoryRefused(f"county {county} is withheld: {HOSTED_WITHHELD_COUNTIES[county]}")
    if len(set(years)) < 2 or any(not 1900 <= y <= 2100 for y in years):
        raise StoryRefused("give at least two distinct roll years")
    if value_type not in VALUE_TYPES:
        raise StoryRefused(f"value type must be one of {sorted(VALUE_TYPES)}")
    norm: list[str] = []
    for t in thresholds or ["10"]:
        try:
            d = Decimal(str(t))
        except InvalidOperation:
            raise StoryRefused(f"threshold {t!r} is not a number") from None
        if not d.is_finite() or d <= 0 or d > 1000 or -d.as_tuple().exponent > 2:
            raise StoryRefused(f"threshold {t!r} must be a percent above 0, at most 1000, with at most two decimals")
        norm.append(format(d.normalize(), "f"))
    return Params(county, tuple(sorted(set(years))), tuple(sorted(set(norm), key=Decimal)), value_type,
                  bool(name_organisations), tuple(sorted(set(preliminary or []))))


def pairs(years: tuple[int, ...]) -> list[tuple[int, int]]:
    """Consecutive roll years, plus the first-to-last span when there are more than two."""
    out = list(zip(years, years[1:]))
    if len(years) > 2:
        out.append((years[0], years[-1]))
    return out


def tid(t: str) -> str:
    return t.replace(".", "_")


def group_of(category: str | None) -> str | None:
    """B (all multifamily subclasses), F1 or F2 for a category in the commercial scope; None outside it."""
    if not category or not is_commercial(category):
        return None
    c = category.strip().upper()
    return "B" if c.startswith("B") else c[:2]


# --- exact arithmetic shared by both routes ---------------------------------------------------------


def to_cents(v: Any) -> int | None:
    """A stated value in whole cents; None for anything that is not a positive number."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")) or v <= 0:
        return None
    c = round(v * 100)
    if abs(v * 100 - c) > 1e-6:
        raise StoryRefused(f"value {v!r} has a fraction of a cent")
    return int(c)


def half_up(x: Fraction, places: int = 1) -> float:
    scale = 10 ** places
    n = (x * scale + Fraction(1, 2)).__floor__()
    return n / scale


def usd(cents: int) -> int | float:
    return cents // 100 if cents % 100 == 0 else cents / 100


def pct(part: int, whole: int) -> float | None:
    return half_up(Fraction(part * 100, whole)) if whole else None


def change_pct(a: int, b: int) -> Fraction:
    return Fraction(b - a, a) * 100


def threshold_fraction(t: str) -> Fraction:
    return Fraction(Decimal(t))


# --- source records ------------------------------------------------------------------------------------


def source_record(db: sqlite3.Connection, key: str, document_id: str, tax_year: int | None, params: Params) -> dict[str, Any]:
    row = db.execute(
        "SELECT s.document_id, s.as_of, s.retrieved_at, s.filename, src.source_id, src.publisher, src.title, src.url, "
        "src.license, src.ai_use, src.redistribution, src.attribution, src.terms_reviewed "
        "FROM snapshots s JOIN sources src USING (source_id) WHERE s.document_id = ?", (document_id,)).fetchone()
    if row is None:
        raise StoryRefused(f"document {document_id} has no snapshot and source record")
    (doc, as_of, retrieved, filename, source_id, publisher, title, url, lic, ai_use, redistribution, attribution,
     reviewed) = row
    if redistribution == "prohibited":
        raise StoryRefused(f"source {source_id} prohibits redistribution")
    if ai_use == "prohibited":
        raise StoryRefused(f"source {source_id} prohibits AI use")
    rec: dict[str, Any] = {
        "key": key, "source_id": source_id, "document_id": doc, "publisher": publisher, "title": title,
        "url": url, "filename": filename, "as_of": as_of, "retrieved_at": retrieved,
        "attribution": attribution or publisher, "license": lic, "redistribution": redistribution,
        "ai_use": ai_use, "terms_reviewed": reviewed,
    }
    if tax_year is not None:
        hint = re.search(r"prelim|_current", f"{title} {filename}", re.I) is not None
        rec["tax_year"] = tax_year
        rec["preliminary"] = bool(tax_year in params.preliminary or hint or tax_year > int(str(as_of)[:4]))
    return rec


# --- what both routes return ---------------------------------------------------------------------------


@dataclass
class Computed:
    figures: dict[str, Any] = field(default_factory=dict)
    tables: dict[str, list[list[Any]]] = field(default_factory=dict)
    year_docs: dict[int, str] = field(default_factory=dict)
    current_docs: list[str] = field(default_factory=list)
    registry_docs: list[str] = field(default_factory=list)


def _single(values: list[Any]) -> Any:
    """The one value, or None when a parcel's current facts disagree (or there is none)."""
    return values[0] if len(set(values)) == 1 else None


def _decode(value_json: str) -> Any:
    try:
        return json.loads(value_json)
    except ValueError:
        return None


def _county_range(p: Params) -> tuple[str, str]:
    return p.prefix, p.prefix[:-1] + ";"  # ';' is the character after ':'


def _check_years_present(p: Params, counts: dict[int, dict[str, int]]) -> None:
    """Refuse a year with no value of the chosen type; refuse to compare it with a year of the other type."""
    other = "appraised" if p.value_type == "market" else "market"
    for y in p.years:
        have = counts.get(y)
        if not have or not (have.get("market") or have.get("appraised")):
            raise StoryRefused(f"no roll file with values for tax year {y} in this county")
        if not have.get(p.value_type):
            if have.get(other):
                raise StoryRefused(
                    f"the {y} file has {other} values only; refusing to compare {p.value_type} values with {other} values")
            raise StoryRefused(f"no {p.value_type} values for tax year {y}")


# --- route one: the generator (scan into SQLite, aggregate with SQL) --------------------------------------


def compute_sql(db: sqlite3.Connection, p: Params) -> Computed:
    lo, hi = _county_range(p)
    vpred = VALUE_PREDICATE[p.value_type]
    doc_years: dict[str, set[int]] = {}
    year_of: dict[tuple[str, str], int] = {}
    vals: dict[tuple[str, str], int] = {}
    kinds: dict[str, set[str]] = {}
    for urn, pred, vj, doc in db.execute(
            "SELECT subject, predicate, value_json, document_id FROM facts WHERE subject >= ? AND subject < ? "
            "AND predicate IN (?, ?, ?)", (lo, hi, P_YEAR, P_MARKET, P_APPRAISED)):
        v = _decode(vj)
        if pred == P_YEAR:
            if isinstance(v, int) and not isinstance(v, bool):
                year_of[(urn, doc)] = v
                doc_years.setdefault(doc, set()).add(v)
        elif to_cents(v) is not None:
            kinds.setdefault(doc, set()).add("market" if pred == P_MARKET else "appraised")
            if pred == vpred:
                vals[(urn, doc)] = to_cents(v)  # type: ignore[assignment]
    year_docs: dict[int, list[str]] = {}
    for doc, ys in doc_years.items():
        if len(ys) > 1:
            if ys & set(p.years):
                raise StoryRefused(f"file {doc} states more than one tax year")
            continue
        year_docs.setdefault(next(iter(ys)), []).append(doc)
    counts: dict[int, dict[str, int]] = {}
    for y in p.years:
        docs = year_docs.get(y, [])
        if len(docs) > 1:
            raise StoryRefused(f"more than one file in the registry states tax year {y} for this county")
        counts[y] = {k: 1 for d in docs for k in kinds.get(d, set())}
    _check_years_present(p, counts)
    docs_by_year = {y: year_docs[y][0] for y in p.years}

    work = sqlite3.connect(":memory:")
    work.execute("CREATE TABLE pv (urn TEXT, year INTEGER, c INTEGER)")
    work.execute("CREATE TABLE pc (urn TEXT PRIMARY KEY, grp TEXT, nb TEXT, bc TEXT, owner TEXT, reg INTEGER)")
    year_by_doc = {d: y for y, d in docs_by_year.items()}
    work.executemany("INSERT INTO pv VALUES (?,?,?)",
                     ((u, year_by_doc[d], c) for (u, d), c in vals.items() if d in year_by_doc))

    cur: dict[str, dict[str, list[str]]] = {}
    current_docs: set[str] = set()
    for urn, pred, vj, doc in db.execute(
            "SELECT subject, predicate, value_json, document_id FROM current_facts WHERE subject >= ? AND subject < ? "
            "AND predicate IN (?, ?, ?, ?)", (lo, hi, P_CATEGORY, P_NBHD, P_CLASS, P_OWNER)):
        v = _decode(vj)
        if isinstance(v, str) and v.strip():
            cur.setdefault(urn, {}).setdefault(pred, []).append(v.strip())
            if pred == P_CATEGORY:
                current_docs.add(doc)
    if len(current_docs) > 1:
        raise StoryRefused("more than one current file states parcel categories for this county")
    n_parcels = db.execute("SELECT COUNT(*) FROM subjects WHERE kind = 'parcel' AND urn >= ? AND urn < ?", (lo, hi)).fetchone()[0]

    linked: set[str] = set()
    ent: dict[str, set[str]] = {}
    for parcel, ent_urn in db.execute(
            "SELECT r.to_urn, r.from_urn FROM relationships r WHERE r.to_urn >= ? AND r.to_urn < ? AND r.type = 'owns' "
            "AND r.as_of = (SELECT MAX(x.as_of) FROM relationships x WHERE x.to_urn = r.to_urn AND x.type = 'owns')",
            (lo, hi)):
        ent.setdefault(ent_urn, set()).add(parcel)
    work.execute("CREATE TABLE ent (urn TEXT PRIMARY KEY)")
    work.executemany("INSERT INTO ent VALUES (?)", ((e,) for e in ent))
    registered: set[str] = set()
    registry_docs: set[str] = set()
    for e in ent:
        hit = db.execute(
            "SELECT DISTINCT s.document_id FROM facts f JOIN snapshots s ON s.document_id = f.document_id "
            "WHERE f.subject = ? AND f.predicate = 'entity.legal_name' AND s.source_id = ?", (e, COMPTROLLER_SOURCE_ID)).fetchall()
        if hit:
            registered.add(e)
            registry_docs.update(r[0] for r in hit)
    for e in registered:
        linked |= ent[e]

    rows = []
    for urn, f in cur.items():
        g = group_of(_single(f.get(P_CATEGORY, [])))
        if g is None:
            continue
        owner = _single(f.get(P_OWNER, []))
        rows.append((urn, g, _single(f.get(P_NBHD, [])), _single(f.get(P_CLASS, [])), owner, 1 if urn in linked else 0))
    work.executemany("INSERT INTO pc VALUES (?,?,?,?,?,?)", rows)

    out = Computed(year_docs=docs_by_year, current_docs=sorted(current_docs), registry_docs=sorted(registry_docs))
    f = out.figures
    scope = work.execute("SELECT COUNT(*) FROM pc").fetchone()[0]
    f["scope.parcels"] = scope
    f["scope.excluded"] = n_parcels - scope
    totals: dict[tuple[str, int], tuple[int, int]] = {}
    for grp, y, n, s in work.execute(
            "SELECT pc.grp, pv.year, COUNT(*), SUM(pv.c) FROM pv JOIN pc ON pc.urn = pv.urn GROUP BY pc.grp, pv.year"):
        totals[(grp, y)] = (n, s)
    for y in p.years:
        n, s = work.execute("SELECT COUNT(*), COALESCE(SUM(pv.c), 0) FROM pv JOIN pc ON pc.urn = pv.urn WHERE pv.year = ?", (y,)).fetchone()
        f[f"y{y}.parcels"], f[f"y{y}.total"] = n, usd(s)

    rows_gy: list[list[Any]] = []
    for y in p.years:
        rows_gy.append([ALL_LABEL, y, f[f"y{y}.parcels"], f[f"y{y}.total"]])
        for g in GROUP_ORDER:
            n, s = totals.get((g, y), (0, 0))
            if n >= MIN_CELL:
                rows_gy.append([GROUP_LABELS[g], y, n, usd(s)])
    out.tables["t.group_year"] = rows_gy

    rows_gc: list[list[Any]] = []
    for a, b in pairs(p.years):
        pid = f"p{a}_{b}"
        base = ("FROM pv a JOIN pv b ON a.urn = b.urn AND a.year = ? AND b.year = ? JOIN pc ON pc.urn = a.urn "
                "WHERE a.c > 0 AND b.c > 0")
        both, rose, fell, same = work.execute(
            f"SELECT COUNT(*), COALESCE(SUM(b.c > a.c), 0), COALESCE(SUM(b.c < a.c), 0), COALESCE(SUM(b.c = a.c), 0) {base}", (a, b)).fetchone()
        if both == 0:
            raise StoryRefused(f"no parcel has a value in both {a} and {b}")
        f[f"{pid}.both"], f[f"{pid}.rose"], f[f"{pid}.fell"], f[f"{pid}.same"] = both, rose, fell, same
        f[f"{pid}.rose_pct"], f[f"{pid}.fell_pct"] = pct(rose, both), pct(fell, both)
        for t in p.thresholds:
            fr = threshold_fraction(t)
            num, den = fr.numerator, fr.denominator
            up, down = work.execute(
                f"SELECT COALESCE(SUM((b.c - a.c) * 100 * {den} > {num} * a.c), 0), "
                f"COALESCE(SUM((a.c - b.c) * 100 * {den} > {num} * a.c), 0) {base}", (a, b)).fetchone()
            f[f"{pid}.rose_gt_{tid(t)}"], f[f"{pid}.fell_gt_{tid(t)}"] = up, down
        changes: dict[str, list[Fraction]] = {}
        gstats: dict[str, list[int]] = {}
        for grp, ca, cb in work.execute(f"SELECT pc.grp, a.c, b.c {base}", (a, b)):
            changes.setdefault(grp, []).append(change_pct(ca, cb))
            s = gstats.setdefault(grp, [0, 0, 0, 0])
            s[0] += 1
            s[1] += cb > ca
            s[2] += cb < ca
            s[3] += cb == ca
        every = sorted(x for v in changes.values() for x in v)
        f[f"{pid}.q1"], f[f"{pid}.median"], f[f"{pid}.q3"] = (_percentile(every, Fraction(k, 4)) for k in (1, 2, 3))
        rows_gc.append([ALL_LABEL, f"{a} to {b}", both, rose, fell, same, f[f"{pid}.median"]])
        for g in GROUP_ORDER:
            if g in gstats and gstats[g][0] >= MIN_CELL:
                n, r_, fl, sm = gstats[g]
                rows_gc.append([GROUP_LABELS[g], f"{a} to {b}", n, *(x if x >= MIN_CELL else None for x in (r_, fl, sm)),
                                _percentile(sorted(changes[g]), Fraction(1, 2))])
    out.tables["t.group_change"] = rows_gc

    last = p.years[-1]
    for tkey, col in (("t.dim.neighborhood", "nb"), ("t.dim.building_class", "bc")):
        rows_d = [list(r) for r in work.execute(
            f"SELECT pc.{col}, COUNT(*), SUM(pv.c) FROM pv JOIN pc ON pc.urn = pv.urn WHERE pv.year = ? AND pc.{col} IS NOT NULL "
            f"GROUP BY pc.{col} HAVING COUNT(*) >= ? ORDER BY COUNT(*) DESC, pc.{col} ASC LIMIT ?", (last, MIN_CELL, TOP_N))]
        for r in rows_d:
            r[2] = usd(r[2])
        if rows_d:
            out.tables[tkey] = rows_d
    if p.name_organisations:
        rows_o = [list(r) for r in work.execute(
            "SELECT pc.owner, COUNT(*), SUM(pv.c) FROM pv JOIN pc ON pc.urn = pv.urn WHERE pv.year = ? AND pc.owner IS NOT NULL "
            "GROUP BY pc.owner ORDER BY pc.owner", (last,))]
        rows_o = [r for r in rows_o if r[1] >= MIN_CELL and is_organization(r[0]) and not personal_style_organization(r[0])]
        rows_o.sort(key=lambda r: (-r[1], r[0]))
        rows_o = rows_o[:TOP_N]
        for r in rows_o:
            r[2] = usd(r[2])
        out.tables["t.owners"] = rows_o

    org = work.execute("SELECT COUNT(*) FROM pc WHERE owner IS NOT NULL").fetchone()[0]
    reg = work.execute("SELECT COUNT(*) FROM pc WHERE reg = 1").fetchone()[0]
    f["owner.org_stated"], f["owner.org_stated_pct"] = org, pct(org, scope)
    f["owner.registered"], f["owner.registered_pct"] = reg, pct(reg, scope)
    work.close()
    return out


def _percentile(sorted_vals: list[Fraction], q: Fraction) -> float | None:
    """Linear interpolation between closest ranks (the 'inclusive' method), rounded half up to one decimal."""
    n = len(sorted_vals)
    if n == 0:
        return None
    pos = q * (n - 1)
    i = pos.__floor__()
    frac = pos - i
    j = min(i + 1, n - 1)
    return half_up(sorted_vals[i] + frac * (sorted_vals[j] - sorted_vals[i]))


# --- document assembly (shared: labels, rules, sources, sentences, tables) ------------------------------


def fmt_value(v: Any, unit: str) -> str:
    if v is None:
        return ""
    if unit == "usd":
        return f"${v:,}" if isinstance(v, int) else f"${v:,.2f}"
    if unit == "percent":
        return f"{v:.1f}"
    if unit == "year":
        return str(v)
    return f"{v:,}"


def figure_specs(p: Params, sources: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """The ordered figure list: id, label, unit, the rule in one sentence, source keys (values are filled in later)."""
    vt = VALUE_TYPES[p.value_type]
    cur = ["current"]
    specs: list[dict[str, Any]] = []

    def add(fid: str, label: str, unit: str, rule: str, keys: list[str]) -> None:
        specs.append({"id": fid, "label": label, "unit": unit, "rule": rule, "keys": keys})

    add("param.min_cell", "Smallest group a table cell may be built from", "count",
        "A fixed rule of the generator: a table cell built from fewer parcels is left empty, except a county total.", [])
    for y in p.years:
        add(f"param.year.{y}", f"Roll year {y}", "year", "A roll year named by the operator.", [])
    for t in p.thresholds:
        add(f"param.threshold.{tid(t)}", f"Change threshold of {t} percent", "percent", "A change threshold named by the operator.", [])
    scope_rule = ("in the commercial scope: the current file's state property category is multifamily (B), commercial (F1) or "
                  "industrial (F2) real property")
    add("scope.parcels", "Parcels in the commercial scope", "count", f"Count of the county's parcels {scope_rule}.", cur)
    add("scope.excluded", "Parcels held for the county outside that scope", "count",
        "Count of the county's parcel subjects in the registry that are not in the commercial scope or have no single state category.", cur)
    for y in p.years:
        k = [f"roll-{y}", "current"]
        add(f"y{y}.parcels", f"Parcels with a stated {vt} value, {y}", "count",
            f"Count of in-scope parcels (so, parcels in the current file) with a positive stated {vt} value in the tax year {y} file.", k)
        add(f"y{y}.total", f"Total stated {vt} value, {y}", "usd",
            f"Sum of those stated {vt} values, in dollars.", k)
    for a, b in pairs(p.years):
        pid, k = f"p{a}_{b}", [f"roll-{a}", f"roll-{b}", "current"]
        both = f"in-scope parcels with a positive stated {vt} value in both the {a} and the {b} file"
        add(f"{pid}.both", f"Parcels with a value in both {a} and {b}", "count", f"Count of {both}.", k)
        add(f"{pid}.rose", f"Parcels higher in {b} than in {a}", "count", f"Of {both}, those whose {b} value is above their {a} value.", k)
        add(f"{pid}.fell", f"Parcels lower in {b} than in {a}", "count", f"Of {both}, those whose {b} value is below their {a} value.", k)
        add(f"{pid}.same", f"Parcels unchanged from {a} to {b}", "count", f"Of {both}, those whose two values are equal.", k)
        add(f"{pid}.rose_pct", f"Share higher in {b} than in {a}", "percent", "Parcels higher divided by parcels with a value in both years, times 100, rounded half up to one decimal.", k)
        add(f"{pid}.fell_pct", f"Share lower in {b} than in {a}", "percent", "Parcels lower divided by parcels with a value in both years, times 100, rounded half up to one decimal.", k)
        for t in p.thresholds:
            add(f"{pid}.rose_gt_{tid(t)}", f"Parcels up by more than {t} percent, {a} to {b}", "count",
                f"Of {both}, those whose {b} value exceeds their {a} value by more than {t} percent of the {a} value.", k)
            add(f"{pid}.fell_gt_{tid(t)}", f"Parcels down by more than {t} percent, {a} to {b}", "count",
                f"Of {both}, those whose {b} value is below their {a} value by more than {t} percent of the {a} value.", k)
        dist = (f"per-parcel change, the {b} value minus the {a} value as a percent of the {a} value, over {both}; "
                "linear interpolation between closest ranks, rounded half up to one decimal")
        add(f"{pid}.q1", f"Lower quartile of change, {a} to {b}", "percent", f"First quartile of {dist}.", k)
        add(f"{pid}.median", f"Median change, {a} to {b}", "percent", f"Median of {dist}.", k)
        add(f"{pid}.q3", f"Upper quartile of change, {a} to {b}", "percent", f"Third quartile of {dist}.", k)
    own = "in the current file the owner of record is an organisation; owners who are natural persons are not stored in the registry"
    add("owner.org_stated", "Parcels with an organisation as owner of record", "count",
        f"Count of in-scope parcels for which, {own}.", cur)
    add("owner.org_stated_pct", "Share with an organisation as owner of record", "percent",
        "That count divided by the parcels in the commercial scope, times 100, rounded half up to one decimal.", cur)
    add("owner.registered", f"Parcels owned of record by an organisation on the {COMPTROLLER_NAME} active franchise taxpayer file", "count",
        "Count of in-scope parcels whose owner of record the registry linked, by exact match of normalized legal name, to an organisation "
        f"listed in the {COMPTROLLER_NAME} active franchise taxpayer file.", cur + ["entities"])
    add("owner.registered_pct", "Share owned of record by such an organisation", "percent",
        "That count divided by the parcels in the commercial scope, times 100, rounded half up to one decimal.", cur + ["entities"])
    return specs


TABLE_SPECS = {
    "t.group_year": ("Stated value by roll year and property group",
                     [("Group", "text"), ("Roll year", "year"), ("Parcels with a value", "count"), ("Total stated value", "usd")],
                     "Per group and roll year: in-scope parcels with a positive stated value of the chosen type, and their sum. "
                     "The county-total rows are exempt from the minimum cell size; a group with fewer than {n} parcels is left out."),
    "t.group_change": ("Change in stated value by property group",
                       [("Group", "text"), ("Period", "text"), ("Parcels with a value in both years", "count"), ("Higher", "count"),
                        ("Lower", "count"), ("Unchanged", "count"), ("Median change (percent)", "percent")],
                       "Per group and period, over in-scope parcels with a positive stated value in both years. The county-total rows "
                       "are exempt from the minimum cell size; a count below {n}, and a group with fewer than {n} parcels, is left out or empty."),
    "t.dim.neighborhood": ("Largest neighborhood codes",
                           [("Neighborhood code", "text"), ("Parcels with a value", "count"), ("Total stated value", "usd")],
                           "The {top} neighborhood codes (as written in the current file) with the most in-scope parcels that have a value in the "
                           "last roll year, with at least {n} parcels each."),
    "t.dim.building_class": ("Largest building classes",
                             [("Building class", "text"), ("Parcels with a value", "count"), ("Total stated value", "usd")],
                             "The {top} building classes (as written in the current file) with the most in-scope parcels that have a value in the "
                             "last roll year, with at least {n} parcels each."),
    "t.owners": ("Largest organisation owners of record",
                 [("Owner of record", "text"), ("Parcels with a value", "count"), ("Total stated value", "usd")],
                 "The {top} organisations with the most in-scope parcels that have a value in the last roll year, with at least {n} parcels "
                 "each; owners who read as a person's or a family's are left out."),
}


def _s(sid: str, text: str, fids: list[str]) -> dict[str, Any]:
    return {"id": sid, "text": text, "figures": fids}


def build_sentences(p: Params, fig: dict[str, Any], sources: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    vt = VALUE_TYPES[p.value_type]
    out: list[dict[str, Any]] = []
    out.append(_s("s.scope",
                  f"The current file lists {fmt_value(fig['scope.parcels'], 'count')} parcels in the commercial scope "
                  "(multifamily, commercial and industrial real property).", ["scope.parcels"]))
    for y in p.years:
        pre = " (preliminary roll)" if sources[f"roll-{y}"].get("preliminary") else ""
        out.append(_s(f"s.year.{y}",
                      f"In {y}{pre}, {fmt_value(fig[f'y{y}.parcels'], 'count')} of them have a stated {vt} value, totalling "
                      f"{fmt_value(fig[f'y{y}.total'], 'usd')}.", [f"param.year.{y}", f"y{y}.parcels", f"y{y}.total"]))
    for a, b in pairs(p.years):
        pid = f"p{a}_{b}"
        g = lambda k, unit="count": fmt_value(fig[f"{pid}.{k}"], unit)  # noqa: E731
        out.append(_s(f"s.{pid}.direction",
                      f"Of {g('both')} parcels with a value in both {a} and {b}, {g('rose')} ({g('rose_pct', 'percent')}%) were higher in {b} "
                      f"than in {a}, {g('fell')} ({g('fell_pct', 'percent')}%) were lower and {g('same')} were unchanged.",
                      [f"param.year.{a}", f"param.year.{b}", *(f"{pid}.{k}" for k in ("both", "rose", "rose_pct", "fell", "fell_pct", "same"))]))
        for t in p.thresholds:
            out.append(_s(f"s.{pid}.threshold.{tid(t)}",
                          f"Between {a} and {b}, {g(f'rose_gt_{tid(t)}')} parcels rose by more than {t} percent and "
                          f"{g(f'fell_gt_{tid(t)}')} fell by more than {t} percent.",
                          [f"param.year.{a}", f"param.year.{b}", f"param.threshold.{tid(t)}", f"{pid}.rose_gt_{tid(t)}", f"{pid}.fell_gt_{tid(t)}"]))
        out.append(_s(f"s.{pid}.distribution",
                      f"The median change in stated value between {a} and {b} was {g('median', 'percent')} percent; the lower quartile was "
                      f"{g('q1', 'percent')} percent and the upper quartile was {g('q3', 'percent')} percent.",
                      [f"param.year.{a}", f"param.year.{b}", f"{pid}.median", f"{pid}.q1", f"{pid}.q3"]))
    out.append(_s("s.owner",
                  f"In the current file, {fmt_value(fig['owner.org_stated'], 'count')} of {fmt_value(fig['scope.parcels'], 'count')} parcels "
                  f"({fmt_value(fig['owner.org_stated_pct'], 'percent')}%) have an organisation as owner of record, and "
                  f"{fmt_value(fig['owner.registered'], 'count')} ({fmt_value(fig['owner.registered_pct'], 'percent')}%) are owned of record by an "
                  f"organisation matched by exact normalized name to the {COMPTROLLER_NAME} active franchise taxpayer file.",
                  ["scope.parcels", "owner.org_stated", "owner.org_stated_pct", "owner.registered", "owner.registered_pct"]))
    return out


def county_title_parts(p: Params) -> tuple[str, str]:
    name = county_name(p.county)
    if not name:
        raise StoryRefused(f"county {p.county} is not a county FIPS code the registry knows by name")
    state = (STATE_BY_FIPS.get(p.state) or p.state).upper()
    return name, state


def slug_of(p: Params) -> str:
    name, state = county_title_parts(p)
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"{base}-{state.lower()}-commercial-roll-values-{p.years[0]}-{p.years[-1]}"


def assemble(db: sqlite3.Connection, p: Params, c: Computed) -> dict[str, Any]:
    sources: dict[str, dict[str, Any]] = {}
    for y in p.years:
        sources[f"roll-{y}"] = source_record(db, f"roll-{y}", c.year_docs[y], y, p)
    if len(c.current_docs) != 1:
        raise StoryRefused("the registry has no single current file for this county")
    sources["current"] = source_record(db, "current", c.current_docs[0], None, p)
    ent_keys: list[str] = []
    for i, d in enumerate(c.registry_docs, 1):
        sources[f"entities-{i}"] = source_record(db, f"entities-{i}", d, None, p)
        ent_keys.append(f"entities-{i}")
    name, state = county_title_parts(p)
    spec = figure_specs(p, sources)
    missing = [s["id"] for s in spec if s["id"] not in c.figures and not s["id"].startswith("param.")]
    if missing:
        raise StoryRefused(f"figures not computed: {missing}")
    fig = dict(c.figures)
    fig["param.min_cell"] = MIN_CELL
    for y in p.years:
        fig[f"param.year.{y}"] = y
    for t in p.thresholds:
        fig[f"param.threshold.{tid(t)}"] = float(Decimal(t)) if "." in t else int(t)
    figures = []
    for s in spec:
        keys: list[str] = []
        for k in s["keys"]:
            keys += ent_keys if k == "entities" else [k]
        figures.append({
            "id": s["id"], "label": s["label"], "value": fig[s["id"]], "unit": s["unit"], "rule": s["rule"],
            "sources": [{"key": k, "source_id": sources[k]["source_id"], "as_of": sources[k]["as_of"],
                         "attribution": sources[k]["attribution"]} for k in keys],
        })
    tables = []
    for tkey, rows in c.tables.items():
        title, cols, rule = TABLE_SPECS[tkey]
        keys = ["current"] + [f"roll-{y}" for y in p.years]
        tables.append({
            "id": tkey, "title": title, "columns": [{"label": lb, "unit": u} for lb, u in cols],
            "rule": rule.format(n=MIN_CELL, top=TOP_N), "rows": rows,
            "suppressed_cells": sum(1 for r in rows for cell in r if cell is None),
            "sources": [{"key": k, "source_id": sources[k]["source_id"], "as_of": sources[k]["as_of"],
                         "attribution": sources[k]["attribution"]} for k in keys],
        })
    roll_labels = [{"year": y, "preliminary": bool(sources[f"roll-{y}"].get("preliminary"))} for y in p.years]
    docs = sorted({s["document_id"] for s in sources.values()})
    meta = dict(db.execute("SELECT key, value FROM meta WHERE key IN ('schema_version', 'parcel_rule', 'name_key_version', 'address_key_version')").fetchall())
    first, last = p.years[0], p.years[-1]
    doc = {
        "story_format": STORY_FORMAT,
        "slug": slug_of(p),
        "title": f"Commercial roll values in {name}, {state}, {first} to {last}: what the appraisal district's files show",
        "description": (f"Computed figures from the appraisal district's roll files for {name}, {state}: stated values of commercial, "
                        f"industrial and multifamily parcels by roll year, {first} to {last}, and how many parcels' values rose or fell."),
        "county": {"fips": p.county, "name": name, "state": state},
        "period": {"first_year": first, "last_year": last, "years": roll_labels},
        "value_type": p.value_type,
        "options": {"thresholds_percent": list(p.thresholds), "min_cell": MIN_CELL, "name_organisations": p.name_organisations,
                    "preliminary_years": list(p.preliminary)},
        "sentences": build_sentences(p, fig, sources),
        "figures": figures,
        "tables": tables,
        "sources": list(sources.values()),
        "registry": {
            "schema_version": meta.get("schema_version"), "parcel_rule": meta.get("parcel_rule"),
            "name_key_version": meta.get("name_key_version"), "address_key_version": meta.get("address_key_version"),
            "documents": docs, "inputs_sha256": hashlib.sha256("\n".join(docs).encode()).hexdigest(),
        },
        "generator": {"name": GENERATOR_NAME, "version": GENERATOR_VERSION},
    }
    return doc


def dumps(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


# --- generate -----------------------------------------------------------------------------------------------


def open_db(path: str | Path) -> sqlite3.Connection:
    return Registry.open_readonly(path).db


def generate(db_path: str | Path, p: Params) -> dict[str, Any]:
    db = open_db(db_path)
    try:
        return assemble(db, p, compute_sql(db, p))
    finally:
        db.close()


# --- route two: the verifier (per parcel, plain Python) ----------------------------------------------------


def compute_python(reg: Registry, p: Params) -> Computed:
    db = reg.db
    vkey = "market_value" if p.value_type == "market" else "appraised_value"
    other = "appraised_value" if p.value_type == "market" else "market_value"
    urns = [r[0] for r in db.execute("SELECT urn FROM subjects WHERE kind = 'parcel' AND urn LIKE ? ORDER BY urn", (p.prefix + "%",))]
    per_year: dict[int, dict[str, int]] = {y: {} for y in p.years}
    docs: dict[int, set[str]] = {y: set() for y in p.years}
    seen_kinds: dict[int, set[str]] = {y: set() for y in p.years}
    info: dict[str, dict[str, Any]] = {}
    current_docs: set[str] = set()
    owns_linked: dict[str, set[str]] = {}
    for urn in urns:
        entries = reg.value_history(urn)
        for e in entries:
            y = e["tax_year"]
            if y not in per_year:
                continue
            for kind in ("market_value", "appraised_value"):
                if to_cents(e[kind]) is not None:
                    seen_kinds[y].add("market" if kind == "market_value" else "appraised")
            c = to_cents(e[vkey])
            if c is None:
                continue
            if urn in per_year[y]:
                raise StoryRefused(f"parcel {urn} has two values for tax year {y}")
            per_year[y][urn] = c
            docs[y].add(e["citations"][vkey]["document_id"])
        cur: dict[str, list[str]] = {}
        for pred, vj, doc in db.execute(
                "SELECT f.predicate, f.value_json, f.document_id FROM facts f JOIN snapshots s ON s.document_id = f.document_id "
                "WHERE f.subject = ? AND f.predicate IN (?, ?, ?, ?) AND f.as_of = "
                "(SELECT MAX(c.as_of) FROM coverage c WHERE c.subject = f.subject AND c.source_id = s.source_id)",
                (urn, P_CATEGORY, P_NBHD, P_CLASS, P_OWNER)):
            v = _decode(vj)
            if isinstance(v, str) and v.strip():
                cur.setdefault(pred, []).append(v.strip())
                if pred == P_CATEGORY:
                    current_docs.add(doc)
        info[urn] = {k: (vs[0] if len(set(vs)) == 1 else None) for k, vs in cur.items()}
        ents = {r[0] for r in db.execute(
            "SELECT from_urn FROM relationships WHERE to_urn = ? AND type = 'owns' AND as_of = "
            "(SELECT MAX(as_of) FROM relationships WHERE to_urn = ? AND type = 'owns')", (urn, urn))}
        if ents:
            owns_linked[urn] = ents
    counts = {y: {k: 1 for k in seen_kinds[y]} for y in p.years}
    for y in p.years:
        if len(docs[y]) > 1:
            raise StoryRefused(f"more than one file in the registry states tax year {y} for this county")
    _check_years_present(p, counts)

    entity_cache: dict[str, list[str]] = {}

    def comptroller_docs(entity: str) -> list[str]:
        if entity not in entity_cache:
            entity_cache[entity] = sorted({r[0] for r in db.execute(
                "SELECT f.document_id FROM facts f WHERE f.subject = ? AND f.predicate = 'entity.legal_name'", (entity,))
                if db.execute("SELECT 1 FROM snapshots WHERE document_id = ? AND source_id = ?", (r[0], COMPTROLLER_SOURCE_ID)).fetchone()})
        return entity_cache[entity]

    scope_urns = [u for u in urns if group_of(info[u].get(P_CATEGORY)) is not None]
    scope_set = set(scope_urns)
    grp = {u: group_of(info[u][P_CATEGORY]) for u in scope_urns}
    out = Computed(year_docs={y: next(iter(docs[y])) for y in p.years}, current_docs=sorted(current_docs))
    f = out.figures
    f["scope.parcels"], f["scope.excluded"] = len(scope_urns), len(urns) - len(scope_urns)
    in_scope = {y: {u: c for u, c in per_year[y].items() if u in scope_set} for y in p.years}
    for y in p.years:
        f[f"y{y}.parcels"], f[f"y{y}.total"] = len(in_scope[y]), usd(sum(in_scope[y].values()))

    rows_gy: list[list[Any]] = []
    for y in p.years:
        rows_gy.append([ALL_LABEL, y, f[f"y{y}.parcels"], f[f"y{y}.total"]])
        for g in GROUP_ORDER:
            cs = [c for u, c in in_scope[y].items() if grp[u] == g]
            if len(cs) >= MIN_CELL:
                rows_gy.append([GROUP_LABELS[g], y, len(cs), usd(sum(cs))])
    out.tables["t.group_year"] = rows_gy

    rows_gc: list[list[Any]] = []
    for a, b in pairs(p.years):
        pid = f"p{a}_{b}"
        common = [u for u in in_scope[a] if u in in_scope[b]]
        if not common:
            raise StoryRefused(f"no parcel has a value in both {a} and {b}")
        va, vb = in_scope[a], in_scope[b]
        n = len(common)
        rose = sum(1 for u in common if vb[u] > va[u])
        fell = sum(1 for u in common if vb[u] < va[u])
        f[f"{pid}.both"], f[f"{pid}.rose"], f[f"{pid}.fell"] = n, rose, fell
        f[f"{pid}.same"] = n - rose - fell
        f[f"{pid}.rose_pct"], f[f"{pid}.fell_pct"] = pct(rose, n), pct(fell, n)
        for t in p.thresholds:
            fr = threshold_fraction(t) / 100
            f[f"{pid}.rose_gt_{tid(t)}"] = sum(1 for u in common if Fraction(vb[u] - va[u], va[u]) > fr)
            f[f"{pid}.fell_gt_{tid(t)}"] = sum(1 for u in common if Fraction(va[u] - vb[u], va[u]) > fr)

        def quartiles(us: list[str]) -> tuple[float | None, float, float | None]:
            xs = [change_pct(va[u], vb[u]) for u in us]
            med = statistics.median(xs)
            if len(xs) < 2:
                return half_up(xs[0]), half_up(med), half_up(xs[0])
            q = statistics.quantiles(xs, n=4, method="inclusive")
            return half_up(q[0]), half_up(med), half_up(q[2])

        f[f"{pid}.q1"], f[f"{pid}.median"], f[f"{pid}.q3"] = quartiles(common)
        rows_gc.append([ALL_LABEL, f"{a} to {b}", n, rose, fell, f[f"{pid}.same"], f[f"{pid}.median"]])
        for g in GROUP_ORDER:
            gu = [u for u in common if grp[u] == g]
            if len(gu) >= MIN_CELL:
                r_ = sum(1 for u in gu if vb[u] > va[u])
                fl = sum(1 for u in gu if vb[u] < va[u])
                sm = len(gu) - r_ - fl
                rows_gc.append([GROUP_LABELS[g], f"{a} to {b}", len(gu), *(x if x >= MIN_CELL else None for x in (r_, fl, sm)), quartiles(gu)[1]])
    out.tables["t.group_change"] = rows_gc

    last = p.years[-1]
    for tkey, key in (("t.dim.neighborhood", P_NBHD), ("t.dim.building_class", P_CLASS)):
        agg: dict[str, list[int]] = {}
        for u, c in in_scope[last].items():
            v = info[u].get(key)
            if v is not None:
                agg.setdefault(v, []).append(c)
        ranked = sorted(((k, len(v), usd(sum(v))) for k, v in agg.items() if len(v) >= MIN_CELL), key=lambda r: (-r[1], r[0]))[:TOP_N]
        if ranked:
            out.tables[tkey] = [list(r) for r in ranked]
    if p.name_organisations:
        agg = {}
        for u, c in in_scope[last].items():
            o = info[u].get(P_OWNER)
            if o is not None:
                agg.setdefault(o, []).append(c)
        ranked = sorted(((k, len(v), usd(sum(v))) for k, v in agg.items()
                         if len(v) >= MIN_CELL and is_organization(k) and not personal_style_organization(k)), key=lambda r: (-r[1], r[0]))[:TOP_N]
        out.tables["t.owners"] = [list(r) for r in ranked]

    org = sum(1 for u in scope_urns if info[u].get(P_OWNER) is not None)
    reg_docs: set[str] = set()
    registered = 0
    for u in scope_urns:
        hits = [d for e in owns_linked.get(u, ()) for d in comptroller_docs(e)]
        if hits:
            registered += 1
            reg_docs.update(hits)
    f["owner.org_stated"], f["owner.org_stated_pct"] = org, pct(org, len(scope_urns))
    f["owner.registered"], f["owner.registered_pct"] = registered, pct(registered, len(scope_urns))
    out.registry_docs = sorted(reg_docs)
    return out


# --- verification ----------------------------------------------------------------------------------------------

_NUMBER = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def stray_numbers(doc: dict[str, Any]) -> list[str]:
    """Numbers in a sentence, the title or the description that are not a figure the sentence cites.

    Signs are ignored (a sentence says "3.5 percent lower"); the title and description may hold the roll years.
    """
    by_id = {f["id"]: f for f in doc.get("figures", [])}
    problems: list[str] = []

    def values(ids: list[str]) -> set[Decimal]:
        out: set[Decimal] = set()
        for i in ids:
            v = by_id.get(i, {}).get("value")
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out.add(abs(Decimal(str(v))))
        return out

    year_ids = [i for i in by_id if i.startswith("param.year.")]
    for s in doc.get("sentences", []):
        allowed = values(s.get("figures", []))
        for tok in _NUMBER.findall(s.get("text", "")):
            if Decimal(tok.replace(",", "")) not in allowed:
                problems.append(f"sentence {s.get('id')}: number {tok} is not one of its figures")
    for field_name in ("title", "description"):
        allowed = values(year_ids)
        for tok in _NUMBER.findall(str(doc.get(field_name, ""))):
            if Decimal(tok.replace(",", "")) not in allowed:
                problems.append(f"{field_name}: number {tok} is not a roll year")
    return problems


def params_from_doc(doc: dict[str, Any]) -> Params:
    try:
        opts = doc["options"]
        return normalize_params(doc["county"]["fips"], [y["year"] for y in doc["period"]["years"]], list(opts["thresholds_percent"]),
                                doc["value_type"], bool(opts["name_organisations"]), list(opts.get("preliminary_years", [])))
    except (KeyError, TypeError) as e:
        raise StoryRefused(f"the story file is missing {e}") from None


def _diff(path: str, want: Any, got: Any, out: list[str]) -> None:
    if isinstance(want, dict) and isinstance(got, dict):
        for k in sorted(set(want) | set(got)):
            if k not in got:
                out.append(f"{path}.{k}: missing from the file")
            elif k not in want:
                out.append(f"{path}.{k}: not in the recomputed story")
            else:
                _diff(f"{path}.{k}", want[k], got[k], out)
    elif isinstance(want, list) and isinstance(got, list):
        if len(want) != len(got):
            out.append(f"{path}: {len(got)} items in the file, {len(want)} recomputed")
        for i, (w, g) in enumerate(zip(want, got)):
            _diff(f"{path}[{i}]", w, g, out)
    elif want != got:
        out.append(f"{path}: file says {got!r}, recomputed {want!r}")


def verify_document(doc: dict[str, Any], db_path: str | Path) -> tuple[list[str], int, int]:
    """Failures (empty when the story holds), figures checked, tables checked."""
    failures: list[str] = []
    gen = doc.get("generator", {})
    if gen.get("name") != GENERATOR_NAME or gen.get("version") != GENERATOR_VERSION:
        return [f"generator: the file was made by {gen.get('name')} {gen.get('version')}, this verifier is {GENERATOR_NAME} {GENERATOR_VERSION}"], 0, 0
    p = params_from_doc(doc)
    reg = Registry.open_readonly(db_path)
    try:
        comp = compute_python(reg, p)
        expected = assemble(reg.db, p, comp)
    finally:
        reg.db.close()
    have = {f.get("id"): f for f in doc.get("figures", [])}
    for f in expected["figures"]:
        got = have.get(f["id"])
        if got is None:
            failures.append(f"figure {f['id']}: missing from the file")
        elif got.get("value") != f["value"]:
            failures.append(f"figure {f['id']}: file says {got.get('value')!r}, recomputed {f['value']!r}")
    for fid in have:
        if fid not in {f["id"] for f in expected["figures"]}:
            failures.append(f"figure {fid}: not a figure of this story")
    have_t = {t.get("id"): t for t in doc.get("tables", [])}
    for t in expected["tables"]:
        got = have_t.get(t["id"])
        if got is None:
            failures.append(f"table {t['id']}: missing from the file")
        elif got.get("rows") != t["rows"]:
            failures.append(f"table {t['id']}: the rows differ from the recomputed rows")
    for tid_ in have_t:
        if tid_ not in {t["id"] for t in expected["tables"]}:
            failures.append(f"table {tid_}: not a table of this story")
    failures += stray_numbers(doc)
    if not failures:
        _diff("story", expected, doc, failures)
    failures += table_rule_problems(doc)
    return failures, len(expected["figures"]), len(expected["tables"])


# Which columns of each table hold parcel counts (the first is the count the row is built from).
COUNT_COLUMNS = {"t.group_year": [2], "t.group_change": [2, 3, 4, 5], "t.dim.neighborhood": [1], "t.dim.building_class": [1], "t.owners": [1]}


def table_rule_problems(doc: dict[str, Any]) -> list[str]:
    """Rules checked on the file itself: no small cell outside a county total, no owner names unless asked for."""
    out: list[str] = []
    named = doc.get("options", {}).get("name_organisations")
    for t in doc.get("tables", []):
        if t.get("id") == "t.owners" and not named:
            out.append("table t.owners: owner names are in the file but name_organisations is off")
        for r in t.get("rows", []):
            if r and r[0] == ALL_LABEL:
                continue  # a county total
            for k, i in enumerate(COUNT_COLUMNS.get(t.get("id"), [])):
                cell = r[i] if i < len(r) else None
                if isinstance(cell, int) and cell < MIN_CELL:
                    out.append(f"table {t.get('id')}: a cell built from {cell} parcels outside a county total")
                if k == 0 and cell is None:
                    out.append(f"table {t.get('id')}: a row without its parcel count")
    return out


def stamp_path(story: Path) -> Path:
    return story.with_name(story.stem + ".stamp.json")


def write_stamp(story: Path, doc: dict[str, Any], figures: int, tables: int) -> Path:
    raw = story.read_bytes()
    stamp = {
        "story_file": story.name,
        "story_sha256": hashlib.sha256(raw).hexdigest(),
        "result": "pass",
        "verified_on": datetime.now(timezone.utc).date().isoformat(),
        "verifier": f"{GENERATOR_NAME} {GENERATOR_VERSION}",
        "figures_checked": figures,
        "tables_checked": tables,
        "inputs_sha256": doc["registry"]["inputs_sha256"],
    }
    path = stamp_path(story)
    path.write_text(json.dumps(stamp, indent=2) + "\n")
    return path


# --- command line --------------------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.story", description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", required=True, help="registry SQLite file (opened read-only)")
    ap.add_argument("--verify", metavar="STORY", help="recompute every figure of this story file and write its stamp")
    ap.add_argument("--no-stamp", action="store_true", help="with --verify: do not write the stamp")
    ap.add_argument("--county", help="five-digit county FIPS, e.g. 48201")
    ap.add_argument("--years", nargs="+", type=int, help="two or more roll (tax) years")
    ap.add_argument("--threshold", action="append", help="percent change threshold (repeatable; default 10)")
    ap.add_argument("--value-type", default="market", choices=sorted(VALUE_TYPES))
    ap.add_argument("--name-organisations", action="store_true", help="add a table of the largest organisation owners (off by default)")
    ap.add_argument("--preliminary", nargs="*", type=int, default=[], help="roll years to label preliminary")
    ap.add_argument("--out", help="where to write the story JSON")
    args = ap.parse_args(argv)
    if not Path(args.db).is_file():
        print(f"no such file: {args.db}", file=sys.stderr)
        return 2
    try:
        if args.verify:
            story = Path(args.verify)
            doc = json.loads(story.read_text())
            failures, nf, nt = verify_document(doc, args.db)
            if failures:
                for line in failures:
                    print(f"FAIL {line}")
                return 1
            print(f"verified: {nf} figures and {nt} tables recomputed, every sentence number is a figure")
            if not args.no_stamp:
                print(f"stamp: {write_stamp(story, doc, nf, nt)}")
            return 0
        if not (args.county and args.years and args.out):
            ap.error("generating needs --county, --years and --out")
        p = normalize_params(args.county, args.years, args.threshold, args.value_type, args.name_organisations, args.preliminary)
        doc = generate(args.db, p)
        Path(args.out).write_text(dumps(doc))
        print(f"wrote {args.out}: {len(doc['figures'])} figures, {len(doc['tables'])} tables; now run --verify")
        return 0
    except StoryRefused as e:
        print(f"refused: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
