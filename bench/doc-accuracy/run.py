#!/usr/bin/env python3
"""FactLot doc_verify_facts accuracy benchmark harness.

Subcommands (run from the repository root or this directory):

  fetch          download every manifest document from SEC EDGAR (serial, <= 2 requests/second,
                 declared User-Agent, backoff on 403/429/503) into the cache, and check sha256
  pages          split each cached document into pages (the same rule every other step uses)
  check-labels   confirm every label's quote is on its page (run before freezing labels)
  verify         run doc_verify_facts (python/src, offline) on candidates/*.json
  plant          write planted-error copies to planted/ (value rule from PLAN.md; seeded quote-digit variant)
  score          score the verifier outcomes and planted copies against labels/*.json, with Wilson intervals
  test           run the unit tests (synthetic data only)

Nothing here needs an API key. Only ``fetch`` touches the network, and only sec.gov.
Lease text stays in the cache (default /workspace/factlot-bench-cache, or $FACTLOT_BENCH_CACHE);
it is never written into the repository.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / "python" / "src"))

USER_AGENT = os.environ.get("FACTLOT_BENCH_USER_AGENT", "FactLot doc-accuracy benchmark contact@factlot.com")
MIN_INTERVAL_S = 0.5  # at most 2 requests per second, one at a time
CACHE = Path(os.environ.get("FACTLOT_BENCH_CACHE", "/workspace/factlot-bench-cache"))
AS_OF = "2026-11-03"
# The label commit named in labels/FROZEN.md (the freeze commit f76cad4 adds only FROZEN.md).
LABELS_FROZEN_AT = "a978b85766f5c7e911fc9fe2175dbea0289079a1"

# Predicates whose value is only type-checked by the verifier (nothing compared with the quote).
SUMMARY_PREDICATES = {"lease.rofr", "lease.rofo", "lease.exclusive_use", "lease.assignment_sublease"}
# Object fields that are compared when scoring. Free-text fields (renewal rent, termination fee,
# co-tenancy trigger/remedy, sales exclusions) are not scored: two correct readers word them differently.
SCORED_FIELDS = {
    "lease.free_rent": ["months", "applies_to"],
    "lease.cam_cap": ["method", "rate"],
    "lease.renewal_option": ["count", "term_months", "notice_months"],
    "lease.termination_option": ["effective_date", "notice_months"],
    "lease.percentage_rent": ["rate", "breakpoint"],
    "lease.co_tenancy": ["cure_period_months"],
    "lease.parking": ["spaces", "rate_monthly"],
    "lease.guaranty": ["guarantor", "cap"],
}
NAME_PREDICATES = {"lease.landlord", "lease.tenant"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# --- fair-access downloader ---------------------------------------------------------------------

_last_request = [0.0]


def sec_get(url: str, *, cache_dir: Path = CACHE / "raw", log: Path | None = None) -> bytes:
    """GET one sec.gov URL: serial, >= MIN_INTERVAL_S apart, declared User-Agent, cached by URL."""
    if not re.match(r"^https://(www\.)?sec\.gov/|^https://efts\.sec\.gov/", url):
        raise ValueError(f"refusing non-SEC URL {url}")
    key = cache_dir / hashlib.sha256(url.encode()).hexdigest()
    if key.exists():
        return key.read_bytes()
    log = log or (CACHE / "requests.tsv")
    delay = 10.0
    for _ in range(6):
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_request[0])
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            status = 200
        except urllib.error.HTTPError as e:
            status, data = e.code, None
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a") as f:
            f.write(f"{_dt.datetime.now().isoformat(timespec='seconds')}\t{status}\t{url}\n")
        if data is not None:
            key.parent.mkdir(parents=True, exist_ok=True)
            key.write_bytes(data)
            return data
        if status in (403, 429, 503):
            time.sleep(delay)
            delay *= 2
            continue
        raise RuntimeError(f"HTTP {status} for {url}")
    raise RuntimeError(f"gave up after repeated 403/429/503 for {url}")


# --- page splitting -----------------------------------------------------------------------------

_BLOCK = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "center", "pre",
          "blockquote", "ul", "ol", "dl", "dt", "dd", "title"}
_PAGE_BREAK = re.compile(r"(page-break-(before|after)|break-(before|after))\s*:\s*(always|page)", re.I)
PAGE_MARK = "\f"


class _HtmlText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.after: list[str | None] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "head"):
            self.skip += 1
            return
        style = " ".join(v or "" for k, v in attrs if k == "style")
        m = _PAGE_BREAK.search(style)
        if tag == "hr":
            self.out.append(PAGE_MARK)
            return
        if m and m.group(2) == "before" or m and m.group(4) == "before":
            self.out.append(PAGE_MARK)
        if tag in _BLOCK:
            self.out.append("\n")
        elif tag in ("td", "th"):
            self.out.append(" ")
        if tag not in ("br", "img", "meta", "link", "input"):
            self.after.append(PAGE_MARK if m and (m.group(2) == "after" or m.group(4) == "after") else None)

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "head"):
            self.skip = max(0, self.skip - 1)
            return
        if tag in _BLOCK:
            self.out.append("\n")
        if tag not in ("br", "img", "meta", "link", "input", "hr") and self.after:
            mark = self.after.pop()
            if mark:
                self.out.append(mark)

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.out.append(data)


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ").replace("\u200b", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _chunk(text: str, size: int = 4000) -> list[str]:
    paras = re.split(r"\n\s*\n", text)
    pages: list[str] = []
    cur = ""
    for p in paras:
        if cur and len(cur) + len(p) + 2 > size:
            pages.append(cur)
            cur = p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        pages.append(cur)
    return pages


def split_pages(raw: bytes, ext: str) -> list[str]:
    """Deterministic page split. HTML: page-break styles and <hr>. TXT: form feeds and <PAGE>.
    No markers (fewer than two pages found in a document over 8,000 characters): ~4,000-character
    pages at paragraph boundaries."""
    text = raw.decode("utf-8", errors="replace")
    if ext.lower() in (".htm", ".html"):
        p = _HtmlText()
        p.feed(text)
        p.close()
        text = "".join(p.out)
    else:
        text = html.unescape(re.sub(r"<PAGE>", PAGE_MARK, text, flags=re.I))
        text = re.sub(r"</?(DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT)>[^\n]*", "", text, flags=re.I)
    pages = [c for c in (_clean(x) for x in text.split(PAGE_MARK)) if c]
    if len(pages) < 2 and sum(len(x) for x in pages) > 8000:
        pages = _chunk("\n\n".join(pages))
    return pages


def text_sha256(pages: list[str]) -> str:
    return hashlib.sha256(PAGE_MARK.join(pages).encode("utf-8")).hexdigest()


# --- scoring ------------------------------------------------------------------------------------


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float] | None:
    """95% Wilson score interval for k successes out of n; None when n == 0."""
    if n == 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def _norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.translate(str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"'}))
    return re.sub(r"\s+", " ", s).strip().casefold()


def _num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _eq(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        # A boolean is not a number (PLAN section 9): True must not equal 1.
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _num(a) and _num(b):
        return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b)) or round(a, 2) == round(b, 2)
    if isinstance(a, str) and isinstance(b, str):
        return _norm_name(a) == _norm_name(b)
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a) == set(b) and all(_eq(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_eq(x, y) for x, y in zip(a, b))
    return a == b


def values_match(predicate: str, cand: Any, label: Any, strip_descriptors: bool = False) -> bool:
    """Is the candidate value the labelled value? Free-text fields are ignored; summaries match on presence.
    strip_descriptors is the post-hoc party-name sensitivity, off for the primary scores."""
    if predicate in SUMMARY_PREDICATES:
        return True
    if strip_descriptors and predicate in NAME_PREDICATES:
        return _eq(_strip_descriptor(cand), _strip_descriptor(label))
    fields = SCORED_FIELDS.get(predicate)
    if fields and isinstance(cand, dict) and isinstance(label, dict):
        if strip_descriptors and predicate == "lease.guaranty":
            cand = {**cand, "guarantor": _strip_descriptor(cand.get("guarantor"))}
            label = {**label, "guarantor": _strip_descriptor(label.get("guarantor"))}
        return all(_eq(cand.get(f), label.get(f)) for f in fields)
    return _eq(cand, label)


def classify(doc_candidates: list[dict[str, Any]], doc_labels: list[dict[str, Any]],
             strip_descriptors: bool = False) -> list[str]:
    """Per candidate: 'correct', 'wrong', 'unlabeled' (no label for its predicate) or 'summary'."""
    by_pred: dict[str, list[Any]] = {}
    for lab in doc_labels:
        by_pred.setdefault(lab["predicate"], []).append(lab["value"])
    out = []
    for c in doc_candidates:
        p = c["predicate"]
        if p in SUMMARY_PREDICATES:
            out.append("summary")
        elif p not in by_pred:
            out.append("unlabeled")
        elif any(values_match(p, c.get("value"), v, strip_descriptors) for v in by_pred[p]):
            out.append("correct")
        else:
            out.append("wrong")
    return out


def outcomes(result: dict[str, Any], n: int) -> list[str]:
    """Verifier outcome per candidate index: verified | needs_review | rejected."""
    out = ["missing"] * n
    for key in ("verified", "needs_review", "rejected"):
        for item in result.get(key, []):
            out[item["candidate"]] = key
    if "missing" in out:
        raise ValueError(f"verifier result does not cover every candidate: {result.get('message', result.get('summary'))}")
    return out


# --- planted errors -----------------------------------------------------------------------------


def _alter_number(x: float) -> float:
    if 0 < x <= 1 and not float(x).is_integer():
        y = round(x + 0.01, 6)
        return y if y <= 1 else round(x - 0.01, 6)
    if float(x).is_integer():
        x = int(x)
        return x + 1 if x < 100 else int(round(x * 1.1))
    return round(x + 1, 6)


def _alter_date(s: str) -> str:
    d = _dt.date.fromisoformat(s)
    return (d + _dt.timedelta(days=1)).isoformat()


def plant_error(predicate: str, value: Any) -> tuple[Any, str] | None:
    """Alter exactly one number or date in a value, deterministically (the first checkable part in
    key order). Returns (new_value, path) or None when the value has no number or date."""
    if isinstance(value, bool) or predicate in SUMMARY_PREDICATES:
        return None
    if isinstance(value, str):
        return (_alter_date(value), "value") if DATE_RE.match(value) else None
    if _num(value):
        return _alter_number(value), "value"
    if isinstance(value, list):
        for i, item in enumerate(value):
            r = plant_error(predicate, item)
            if r:
                new = list(value)
                new[i] = r[0]
                return new, f"value[{i}]" + r[1][5:]
        return None
    if isinstance(value, dict):
        keys = SCORED_FIELDS.get(predicate, sorted(value))
        if predicate == "lease.base_rent_schedule" or not SCORED_FIELDS.get(predicate):
            keys = list(value)
        for k in keys:
            if k in value:
                r = plant_error("", value[k])
                if r:
                    new = dict(value)
                    new[k] = r[0]
                    return new, f"value.{k}" + r[1][5:]
    return None


# --- commands -----------------------------------------------------------------------------------


def load_manifest() -> dict[str, Any]:
    return json.loads((HERE / "manifest.json").read_text())


def _ext(url: str) -> str:
    return os.path.splitext(url.split("?")[0])[1] or ".htm"


def cmd_fetch(args: argparse.Namespace) -> int:
    m = load_manifest()
    bad = 0
    for d in m["documents"]:
        data = sec_get(d["url"])
        sha = hashlib.sha256(data).hexdigest()
        if d.get("sha256") and d["sha256"] != sha:
            print(f"{d['id']}: sha256 mismatch (manifest {d['sha256'][:12]}, downloaded {sha[:12]})")
            bad += 1
        else:
            print(f"{d['id']}: ok {len(data)} bytes sha256 {sha[:12]}")
        out = CACHE / "docs" / f"{d['id']}{_ext(d['url'])}"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
    return 1 if bad else 0


def load_pages(doc: dict[str, Any]) -> list[str]:
    raw = (CACHE / "docs" / f"{doc['id']}{_ext(doc['url'])}").read_bytes()
    return split_pages(raw, _ext(doc["url"]))


def checked_pages(doc: dict[str, Any]) -> list[str]:
    """Pages for a scored call; stops when they differ from the manifest's text_sha256."""
    pages = load_pages(doc)
    if doc.get("text_sha256") and text_sha256(pages) != doc["text_sha256"]:
        raise SystemExit(f"{doc['id']}: page text differs from the manifest; re-run fetch/pages")
    return pages


def _git(*args: str) -> str:
    import subprocess

    try:
        return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001 - metadata only
        return ""


def run_meta(step: str) -> dict[str, Any]:
    """What ran: the command, the repository revision (and whether the tree was dirty), the factlot
    version and the last commit that touched python/src, as_of, and the label freeze."""
    import factlot

    return {
        "step": step,
        "command": "python3 bench/doc-accuracy/run.py " + " ".join(sys.argv[1:] or [step]),
        "repo_head": _git("rev-parse", "HEAD"),
        "worktree_dirty": bool(_git("status", "--porcelain", "--", "python/src", "bench/doc-accuracy/run.py",
                                    "bench/doc-accuracy/labels", "bench/doc-accuracy/candidates")),
        "factlot_version": getattr(factlot, "__version__", None),
        "factlot_src_commit": _git("log", "-1", "--format=%H", "--", "python/src"),
        "as_of": AS_OF,
        "labels_frozen_at": LABELS_FROZEN_AT,
        "python": sys.version.split()[0],
    }


def cmd_pages(args: argparse.Namespace) -> int:
    m = load_manifest()
    bad = 0
    for d in m["documents"]:
        pages = load_pages(d)
        sha = text_sha256(pages)
        ok = (d.get("text_sha256") in (None, "", sha)) and d.get("pages") in (None, 0, len(pages))
        bad += not ok
        out = CACHE / "pages" / f"{d['id']}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(pages, ensure_ascii=False, indent=0))
        print(f"{d['id']}: {len(pages)} pages, text_sha256 {sha[:12]}{'' if ok else '  MISMATCH with manifest'}")
    return 1 if bad else 0


def _verify(pages: list[str], cands: list[dict[str, Any]], sha: str | None = None) -> dict[str, Any]:
    import factlot

    doc: dict[str, Any] = {"pages": pages}
    if sha:
        doc["sha256"] = sha
    # The tool takes at most 500 candidates per call; the benchmark documents stay well under that.
    return factlot.run_tool("doc_verify_facts", {"document": doc, "candidates": cands, "as_of": AS_OF})


def cmd_check_labels(args: argparse.Namespace) -> int:
    m = load_manifest()
    problems = 0
    stats = {"verified": 0, "needs_review": 0, "rejected": 0}
    for d in m["documents"]:
        path = HERE / "labels" / f"{d['id']}.json"
        if not path.exists():
            print(f"{d['id']}: no labels")
            continue
        labels = json.loads(path.read_text())["labels"]
        if not labels:
            continue
        res = _verify(load_pages(d), [{k: lab[k] for k in ("predicate", "value", "quote", "page")} for lab in labels])
        for key in stats:
            for item in res.get(key, []):
                stats[key] += 1
                lab = labels[item["candidate"]]
                if key == "rejected" or item.get("notes"):
                    problems += 1
                    print(f"{d['id']} #{item['candidate']} {lab['predicate']}: {key} {item.get('reason', '')} {item.get('notes', '')}")
                elif key == "needs_review" and args.verbose:
                    print(f"{d['id']} #{item['candidate']} {lab['predicate']}: needs_review {item['reason']}")
    print(json.dumps(stats))
    return 1 if problems else 0


def cmd_verify(args: argparse.Namespace) -> int:
    m = load_manifest()
    outdir = HERE / "results"
    outdir.mkdir(exist_ok=True)
    allres: dict[str, Any] = {"_meta": run_meta("verify")}
    for d in m["documents"]:
        path = HERE / "candidates" / f"{d['id']}.json"
        if not path.exists():
            continue
        cands = json.loads(path.read_text())["candidates"]
        if not cands:
            # Kept in the results: the extractor proposed nothing, so every label here is a coverage miss.
            allres[d["id"]] = {"outcomes": [], "reasons": {}, "summary": None, "note": "no candidates"}
            continue
        pages = checked_pages(d)
        res = _verify(pages, cands, d.get("sha256"))
        if "error" in res:
            # PLAN section 9: a document over a tool limit is an error in the results, not dropped.
            allres[d["id"]] = {"error": res.get("message", res["error"])}
            print(f"{d['id']}: verifier error {allres[d['id']]['error']}")
            continue
        allres[d["id"]] = {"outcomes": outcomes(res, len(cands)),
                           "reasons": {str(i["candidate"]): f"{i['check']}: {i['reason']}"
                                       for k in ("needs_review", "rejected") for i in res[k]},
                           "summary": res["summary"]}
    (outdir / "verifier-outcomes.json").write_text(json.dumps(allres, indent=1) + "\n")
    print(f"wrote {outdir / 'verifier-outcomes.json'}")
    return 0


_DESCRIPTOR = re.compile(r",\s*an?\s+[^,]*\b(company|corporation|partnership|trust|association)\s*$")


def _strip_descriptor(name: Any) -> Any:
    """'Acme LLC, a Delaware limited liability company' -> 'acme llc' (post-hoc sensitivity only)."""
    return _DESCRIPTOR.sub("", _norm_name(name)).strip() if isinstance(name, str) else name


def metric(k: int, n: int) -> dict[str, Any]:
    ci = wilson(k, n)
    return {"k": k, "n": n, "rate": (k / n if n else None), "wilson95": ci}


def _rates(rows: list[dict[str, Any]], labels_scored: list[dict[str, Any]]) -> dict[str, Any]:
    main = [r for r in rows if r["kind"] in ("correct", "wrong")]
    ver = [r for r in main if r["outcome"] == "verified"]
    correct = [r for r in main if r["kind"] == "correct"]
    wrong = [r for r in main if r["kind"] == "wrong"]
    return {
        "precision_of_verified": metric(sum(r["kind"] == "correct" for r in ver), len(ver)),
        "catch_rate": metric(sum(r["outcome"] != "verified" for r in wrong), len(wrong)),
        "false_rejection_rate": metric(sum(r["outcome"] != "verified" for r in correct), len(correct)),
        "false_rejection_needs_review": metric(sum(r["outcome"] == "needs_review" for r in correct), len(correct)),
        "false_rejection_rejected": metric(sum(r["outcome"] == "rejected" for r in correct), len(correct)),
        "coverage": metric(sum(x["status"] == "verified_match" for x in labels_scored), len(labels_scored)),
        "counts": {
            "correct_verified": sum(r["kind"] == "correct" and r["outcome"] == "verified" for r in main),
            "correct_needs_review": sum(r["kind"] == "correct" and r["outcome"] == "needs_review" for r in main),
            "correct_rejected": sum(r["kind"] == "correct" and r["outcome"] == "rejected" for r in main),
            "wrong_verified": sum(r["kind"] == "wrong" and r["outcome"] == "verified" for r in main),
            "wrong_needs_review": sum(r["kind"] == "wrong" and r["outcome"] == "needs_review" for r in main),
            "wrong_rejected": sum(r["kind"] == "wrong" and r["outcome"] == "rejected" for r in main),
            "unlabeled": sum(r["kind"] == "unlabeled" for r in rows),
            "summary": sum(r["kind"] == "summary" for r in rows),
        },
    }


def _planted_rates(planted: list[dict[str, Any]]) -> dict[str, Any]:
    base = [p for p in planted if p["original_outcome"] == "verified"]
    return {"catch_rate": metric(sum(p["outcome"] != "verified" for p in base), len(base)),
            "catch_rate_all": metric(sum(p["outcome"] != "verified" for p in planted), len(planted)),
            "outcomes_when_original_verified": {o: sum(p["outcome"] == o for p in base)
                                                for o in ("verified", "needs_review", "rejected")}}


def score(docs: dict[str, dict[str, Any]], strip_descriptors: bool = False) -> dict[str, Any]:
    """docs: id -> {labels, candidates, outcomes, planted: [{outcome, original_outcome, variant?, type?...}]}.
    A document with no candidates has empty candidates and outcomes; its labels still count toward
    coverage. Pure; tested."""
    rows = []
    labels_scored: list[dict[str, Any]] = []
    for doc_id, d in docs.items():
        kinds = classify(d["candidates"], d["labels"], strip_descriptors)
        for c, k, o in zip(d["candidates"], kinds, d["outcomes"]):
            rows.append({"doc": doc_id, "predicate": c["predicate"], "kind": k, "outcome": o})
        seen: list[tuple[str, Any]] = []
        for lab in d["labels"]:
            p = lab["predicate"]
            if p in SUMMARY_PREDICATES:
                continue
            # Coverage counts distinct (predicate, value) labels: the same value labelled twice is one fact.
            if any(sp == p and values_match(p, v, lab["value"], strip_descriptors) for sp, v in seen):
                continue
            seen.append((p, lab["value"]))
            same = [(c, k, o) for c, k, o in zip(d["candidates"], kinds, d["outcomes"]) if c["predicate"] == p]
            match = [(c, k, o) for c, k, o in same if values_match(p, c.get("value"), lab["value"], strip_descriptors)]
            if any(o == "verified" for _, _, o in match):
                status = "verified_match"
            elif match:
                status = "proposed_correct_not_verified"
            elif same:
                status = "proposed_other_value_only"
            else:
                status = "not_proposed"
            labels_scored.append({"doc": doc_id, "predicate": p, "status": status,
                                  "doc_has_no_candidates": not d["candidates"]})
    out: dict[str, Any] = {"candidates": len(rows),
                           "by_kind": {k: sum(r["kind"] == k for r in rows) for k in ("correct", "wrong", "unlabeled", "summary")}}
    out.update(_rates(rows, labels_scored))
    # Backward-compatible split names.
    out["false_rejection_split"] = {o: out["counts"][f"correct_{o}"] for o in ("needs_review", "rejected")}
    out["wrong_split"] = {o: out["counts"][f"wrong_{o}"] for o in ("verified", "needs_review", "rejected")}
    out["coverage_detail"] = {s: sum(x["status"] == s for x in labels_scored) for s in
                              ("verified_match", "proposed_correct_not_verified", "proposed_other_value_only", "not_proposed")}
    out["coverage_detail"]["in_documents_with_no_candidates"] = sum(x["doc_has_no_candidates"] for x in labels_scored)
    out["coverage_without_empty_documents"] = metric(
        sum(x["status"] == "verified_match" for x in labels_scored if not x["doc_has_no_candidates"]),
        sum(not x["doc_has_no_candidates"] for x in labels_scored))
    planted = [p for d in docs.values() for p in d.get("planted", [])]
    pv = [p for p in planted if p.get("variant", "value") == "value"]
    pr = _planted_rates(pv)
    out["planted_catch_rate"] = pr["catch_rate"]
    out["planted_catch_rate_all"] = pr["catch_rate_all"]
    out["planted"] = {}
    for variant in sorted({p.get("variant", "value") for p in planted}):
        sub = [p for p in planted if p.get("variant", "value") == variant]
        entry = _planted_rates(sub)
        for dim in ("leaf_kind", "error_type", "planted_value_in_quote"):
            vals = sorted({str(p[dim]) for p in sub if dim in p})
            if vals:
                entry[f"by_{dim}"] = {v: _planted_rates([p for p in sub if str(p.get(dim)) == v]) for v in vals}
        preds = sorted({p["predicate"] for p in sub if "predicate" in p})
        if preds:
            entry["by_predicate"] = {v: _planted_rates([p for p in sub if p.get("predicate") == v]) for v in preds}
        out["planted"][variant] = entry
    unl = [r for r in rows if r["kind"] == "unlabeled"]
    out["unlabeled"] = {o: sum(r["outcome"] == o for r in unl) for o in ("verified", "needs_review", "rejected")}
    out["summary_predicates"] = {o: sum(r["outcome"] == o for r in rows if r["kind"] == "summary")
                                 for o in ("verified", "needs_review", "rejected")}
    ver = [r for r in rows if r["kind"] in ("correct", "wrong") and r["outcome"] == "verified"]
    # Sensitivity: count unlabeled verified candidates as wrong.
    out["precision_of_verified_unlabeled_as_wrong"] = metric(
        sum(r["kind"] == "correct" for r in ver), len(ver) + sum(r["outcome"] == "verified" for r in unl))
    per_pred: dict[str, Any] = {}
    preds = sorted({r["predicate"] for r in rows if r["kind"] in ("correct", "wrong", "unlabeled")}
                   | {x["predicate"] for x in labels_scored})
    for p in preds:
        pr_rows = [r for r in rows if r["predicate"] == p]
        e = _rates(pr_rows, [x for x in labels_scored if x["predicate"] == p])
        e["unlabeled"] = {o: sum(r["kind"] == "unlabeled" and r["outcome"] == o for r in pr_rows)
                          for o in ("verified", "needs_review", "rejected")}
        e["labels"] = sum(x["predicate"] == p for x in labels_scored)
        per_pred[p] = e
    out["per_predicate"] = per_pred
    out["rows"] = rows
    out["labels_scored"] = labels_scored
    return out


# --- planted-error copies -----------------------------------------------------------------------

PLANT_SEED = 20261103  # default seed for the quote-digit variant; recorded in planted/quote_digit.json


def _leaf_kind(x: Any) -> str:
    if isinstance(x, str):
        return "date"
    if 0 < x <= 1 and not float(x).is_integer():
        return "ratio"
    if float(x).is_integer():
        return "integer_lt_100" if x < 100 else "integer_ge_100"
    return "other_number"


def _get_path(value: Any, path: str) -> Any:
    v = value
    for part in re.findall(r"\[(\d+)\]|\.([^.\[]+)", path[len("value"):]):
        v = v[int(part[0])] if part[0] else v[part[1]]
    return v


def _quote_status(predicate: str, value: Any, path: str, quote: str) -> tuple[bool, bool | None]:
    """(is the altered leaf compared with the quote by the verifier, is that leaf's value in the quote)."""
    from factlot.docverify import value_parts
    from factlot.ingest.verify import _missing, _norm

    dotted = re.sub(r"\[(\d+)\]", r".\1", path)
    for part in value_parts(predicate, value):
        if part["path"] == dotted:
            if part.get("as"):
                return True, not _missing(part["as"], part["value"], _norm(quote))
            return False, None
    return False, None


def build_value_plants(cands_by_doc: dict[str, list[dict[str, Any]]], labels_by_doc: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """PLAN section 9 planted errors: one copy per correct candidate with a number or date; the first
    number or date changes by the fixed rule. No randomness."""
    recs = []
    for doc_id, cands in cands_by_doc.items():
        kinds = classify(cands, labels_by_doc[doc_id])
        for i, (c, k) in enumerate(zip(cands, kinds)):
            if k != "correct":
                continue
            r = plant_error(c["predicate"], c["value"])
            if not r:
                continue
            new, path = r
            orig_leaf, new_leaf = _get_path(c["value"], path), _get_path(new, path)
            compared, orig_in_q = _quote_status(c["predicate"], c["value"], path, c["quote"])
            _, new_in_q = _quote_status(c["predicate"], new, path, c["quote"])
            recs.append({"doc": doc_id, "candidate": i, "predicate": c["predicate"], "path": path,
                         "original_part": orig_leaf, "planted_part": new_leaf, "planted_value": new,
                         "leaf_kind": _leaf_kind(orig_leaf),
                         # number_in_quote: the verifier compares this part with the quote and the original
                         # value is written there. value_only: the part is not compared, or not in the quote.
                         "error_type": "number_in_quote" if compared and orig_in_q else "value_only",
                         "compared_with_quote": compared, "original_part_in_quote": orig_in_q,
                         "planted_value_in_quote": bool(new_in_q)})
    return recs


def build_quote_plants(cands_by_doc: dict[str, list[dict[str, Any]]], labels_by_doc: dict[str, list[dict[str, Any]]],
                       seed: int) -> list[dict[str, Any]]:
    """Exploratory variant (not in PLAN): the value stays as emitted and one digit of one number in
    the quote changes (seeded choice of number, digit position and new digit). Stored as offsets, so no
    lease text is written."""
    import random

    recs = []
    for doc_id, cands in cands_by_doc.items():
        kinds = classify(cands, labels_by_doc[doc_id])
        for i, (c, k) in enumerate(zip(cands, kinds)):
            if k != "correct":
                continue
            runs = [m for m in re.finditer(r"\d+", c["quote"])]
            if not runs:
                continue
            rng = random.Random(f"{seed}:{doc_id}:{i}")
            m = rng.choice(runs)
            off = m.start() + rng.randrange(len(m.group()))
            old = c["quote"][off]
            new = rng.choice([d for d in "0123456789" if d != old])
            recs.append({"doc": doc_id, "candidate": i, "predicate": c["predicate"], "offset": off,
                         "original_digit": old, "planted_digit": new})
    return recs


def apply_plant(c: dict[str, Any], rec: dict[str, Any]) -> dict[str, Any]:
    if "planted_value" in rec:
        return {**c, "value": rec["planted_value"]}
    q = c["quote"]
    if q[rec["offset"]] != rec["original_digit"]:
        raise ValueError(f"{rec['doc']} #{rec['candidate']}: quote digit at {rec['offset']} is not {rec['original_digit']}")
    return {**c, "quote": q[:rec["offset"]] + rec["planted_digit"] + q[rec["offset"] + 1:]}


def _load_set() -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    m = load_manifest()
    labels, cands = {}, {}
    for d in m["documents"]:
        labels[d["id"]] = json.loads((HERE / "labels" / f"{d['id']}.json").read_text())["labels"]
        cp = HERE / "candidates" / f"{d['id']}.json"
        cands[d["id"]] = json.loads(cp.read_text())["candidates"] if cp.exists() else []
    return m, labels, cands


def cmd_plant(args: argparse.Namespace) -> int:
    m, labels, cands = _load_set()
    outdir = HERE / "planted"
    outdir.mkdir(exist_ok=True)
    v = build_value_plants(cands, labels)
    q = build_quote_plants(cands, labels, args.seed)
    meta = run_meta("plant")
    (outdir / "value.json").write_text(json.dumps(
        {"_meta": {**meta, "rule": "PLAN.md section 9 (deterministic; no seed)"}, "copies": v}, indent=1) + "\n")
    (outdir / "quote_digit.json").write_text(json.dumps(
        {"_meta": {**meta, "seed": args.seed, "rule": "one digit of one number in the quote changes; value unchanged; "
                   "random.Random(f'{seed}:{doc}:{candidate}') picks the number, the digit and the new digit"},
         "copies": q}, indent=1) + "\n")
    print(f"wrote {len(v)} value copies and {len(q)} quote-digit copies (seed {args.seed}) to {outdir}")
    return 0


def label_stats(m: dict[str, Any], labels: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Facts about the frozen labels themselves, for the limitations section: totals, summary and
    duplicate labels, the verifier's own outcome on each label (as check-labels runs it), and the
    security-deposit labels whose quote is about a letter of credit."""
    out: dict[str, Any] = {"labels": 0, "summary_labels": 0, "per_document": {},
                           "self_check": {"verified": 0, "needs_review": 0, "rejected": 0},
                           "self_check_needs_review_by_predicate": {},
                           "security_deposit_letter_of_credit": []}
    for d in m["documents"]:
        labs = labels[d["id"]]
        out["labels"] += len(labs)
        out["per_document"][d["id"]] = len(labs)
        out["summary_labels"] += sum(lab["predicate"] in SUMMARY_PREDICATES for lab in labs)
        for lab in labs:
            if lab["predicate"] == "lease.security_deposit" and "letter of credit" in lab["quote"].lower():
                out["security_deposit_letter_of_credit"].append(d["id"])
        if not labs:
            continue
        res = _verify(checked_pages(d), [{k: lab[k] for k in ("predicate", "value", "quote", "page")} for lab in labs])
        for key in out["self_check"]:
            for item in res.get(key, []):
                out["self_check"][key] += 1
                if key == "needs_review":
                    p = labs[item["candidate"]]["predicate"]
                    out["self_check_needs_review_by_predicate"][p] = out["self_check_needs_review_by_predicate"].get(p, 0) + 1
    return out


def cmd_score(args: argparse.Namespace) -> int:
    m, labels, cands = _load_set()
    vo = json.loads((HERE / "results" / "verifier-outcomes.json").read_text())
    plants = {name: json.loads((HERE / "planted" / f"{name}.json").read_text())
              for name in ("value", "quote_digit") if (HERE / "planted" / f"{name}.json").exists()}
    # The planted files must be what the rule produces from the current candidates.
    if "value" in plants and plants["value"]["copies"] != json.loads(json.dumps(build_value_plants(cands, labels))):
        raise SystemExit("planted/value.json differs from what the rule gives; re-run plant")
    if "quote_digit" in plants:
        seed = plants["quote_digit"]["_meta"]["seed"]
        if plants["quote_digit"]["copies"] != build_quote_plants(cands, labels, seed):
            raise SystemExit("planted/quote_digit.json differs from what its seed gives; re-run plant")
    docs = {}
    planted_detail = []
    errors = {}
    for d in m["documents"]:
        doc_id = d["id"]
        entry = vo.get(doc_id)
        if entry is None:
            raise SystemExit(f"{doc_id}: missing from verifier-outcomes.json; re-run verify")
        cs = cands[doc_id]
        if "error" in entry:
            errors[doc_id] = entry["error"]
            outs = ["error"] * len(cs)
        else:
            outs = entry["outcomes"]
        planted = []
        for variant, data in plants.items():
            recs = [r for r in data["copies"] if r["doc"] == doc_id]
            if not recs or "error" in entry:
                continue
            copies = [apply_plant(cs[r["candidate"]], r) for r in recs]
            res = _verify(checked_pages(d), copies, d.get("sha256"))
            if "error" in res:
                raise SystemExit(f"{doc_id}: verifier error on planted copies: {res.get('message')}")
            pouts = outcomes(res, len(copies))
            reasons = {i["candidate"]: f"{i['check']}: {i['reason']}" for k in ("needs_review", "rejected") for i in res[k]}
            for j, (r, po) in enumerate(zip(recs, pouts)):
                item = {**{k: r[k] for k in r if k not in ("planted_value",)}, "variant": variant,
                        "original_outcome": outs[r["candidate"]], "outcome": po, "reason": reasons.get(j)}
                planted.append(item)
                planted_detail.append(item)
        docs[doc_id] = {"labels": labels[doc_id], "candidates": cs, "outcomes": outs, "planted": planted}
    s = score(docs)
    sens = score(docs, strip_descriptors=True)
    s["label_stats"] = label_stats(m, labels)
    s["data"] = {
        "documents": len(m["documents"]),
        "property_type": {t: sum(d["property_type"] == t for d in m["documents"]) for t in ("office", "industrial", "retail", "other")},
        "doc_kind": {t: sum(d["doc_kind"] == t for d in m["documents"]) for t in ("lease", "amendment")},
        "forms": sorted({d["form"] for d in m["documents"]}),
        "filing_dates": [min(d["filing_date"] for d in m["documents"]), max(d["filing_date"] for d in m["documents"])],
        "pages_total": sum(d["pages"] for d in m["documents"]),
        "pages_range": [min(d["pages"] for d in m["documents"]), max(d["pages"] for d in m["documents"])],
        "candidates_per_document": {k: len(v) for k, v in cands.items()},
        "skipped_hits": len(m["search"].get("skipped", [])),
    }
    meta = run_meta("score")
    meta["verify_meta"] = vo.get("_meta")
    meta["planted_meta"] = {k: v["_meta"] for k, v in plants.items()}
    meta["documents_with_verifier_error"] = errors
    meta["documents_with_no_candidates"] = [k for k, v in docs.items() if not v["candidates"]]
    rows, labs = s.pop("rows"), s.pop("labels_scored")
    sens.pop("rows"), sens.pop("labels_scored")
    for k in ("planted", "planted_catch_rate", "planted_catch_rate_all"):
        sens.pop(k)
    out = {"_meta": meta, "primary": s,
           "sensitivity_party_name_descriptor_stripped": {
               "note": "Post-hoc, not in PLAN.md: lease.landlord, lease.tenant and the guaranty guarantor match after "
                       "dropping a trailing ', a <jurisdiction> <entity type>' descriptor on both sides.",
               **sens}}
    rdir = HERE / "results"
    (rdir / "scores.json").write_text(json.dumps(out, indent=1) + "\n")
    (rdir / "candidate-rows.json").write_text(json.dumps({"_meta": meta, "rows": rows, "labels": labs}, indent=1) + "\n")
    (rdir / "planted-outcomes.json").write_text(json.dumps({"_meta": meta, "copies": planted_detail}, indent=1) + "\n")
    old = rdir / "planted.json"
    if old.exists():
        old.unlink()

    def line(name: str, v: dict[str, Any]) -> None:
        ci = v["wilson95"]
        rate = "n/a" if v["rate"] is None else f"{v['rate']:.3f}"
        print(f"{name:40s} {v['k']}/{v['n']} = {rate}  95% CI {('n/a' if ci is None else f'[{ci[0]:.3f}, {ci[1]:.3f}]')}")

    for k in ("precision_of_verified", "precision_of_verified_unlabeled_as_wrong", "catch_rate", "false_rejection_rate",
              "false_rejection_needs_review", "false_rejection_rejected", "coverage", "coverage_without_empty_documents"):
        line(k, s[k])
    for variant, e in s["planted"].items():
        line(f"planted[{variant}] catch (orig verified)", e["catch_rate"])
        line(f"planted[{variant}] catch (all copies)", e["catch_rate_all"])
    print("sensitivity (party-name descriptor stripped):")
    for k in ("precision_of_verified", "catch_rate", "false_rejection_rate", "coverage"):
        line("  " + k, sens[k])
    print(json.dumps({k: s[k] for k in ("by_kind", "counts", "coverage_detail", "unlabeled", "summary_predicates")}))
    return 0


def cmd_test(args: argparse.Namespace) -> int:
    import unittest

    suite = unittest.defaultTestLoader.discover(str(HERE), pattern="test_*.py")
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("fetch", "pages", "verify", "score", "test"):
        sub.add_parser(name)
    pl = sub.add_parser("plant")
    pl.add_argument("--seed", type=int, default=PLANT_SEED)
    cl = sub.add_parser("check-labels")
    cl.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    return {"fetch": cmd_fetch, "pages": cmd_pages, "check-labels": cmd_check_labels, "verify": cmd_verify,
            "plant": cmd_plant, "score": cmd_score, "test": cmd_test}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
