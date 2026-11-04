#!/usr/bin/env python3
"""FactLot doc_verify_facts accuracy benchmark harness.

Subcommands (run from the repository root or this directory):

  fetch          download every manifest document from SEC EDGAR (serial, <= 2 requests/second,
                 declared User-Agent, backoff on 403/429/503) into the cache, and check sha256
  pages          split each cached document into pages (the same rule every other step uses)
  check-labels   confirm every label's quote is on its page (run before freezing labels)
  verify         run doc_verify_facts (python/src, offline) on candidates/*.json
  score          score the verifier outcomes against labels/*.json, with Wilson intervals
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
    if _num(a) and _num(b):
        return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b)) or round(a, 2) == round(b, 2)
    if isinstance(a, str) and isinstance(b, str):
        return _norm_name(a) == _norm_name(b)
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a) == set(b) and all(_eq(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_eq(x, y) for x, y in zip(a, b))
    return a == b


def values_match(predicate: str, cand: Any, label: Any) -> bool:
    """Is the candidate value the labelled value? Free-text fields are ignored; summaries match on presence."""
    if predicate in SUMMARY_PREDICATES:
        return True
    fields = SCORED_FIELDS.get(predicate)
    if fields and isinstance(cand, dict) and isinstance(label, dict):
        return all(_eq(cand.get(f), label.get(f)) for f in fields)
    return _eq(cand, label)


def classify(doc_candidates: list[dict[str, Any]], doc_labels: list[dict[str, Any]]) -> list[str]:
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
        elif any(values_match(p, c.get("value"), v) for v in by_pred[p]):
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
    allres = {}
    for d in m["documents"]:
        path = HERE / "candidates" / f"{d['id']}.json"
        if not path.exists():
            continue
        cands = json.loads(path.read_text())["candidates"]
        if not cands:
            continue
        pages = load_pages(d)
        if d.get("text_sha256") and text_sha256(pages) != d["text_sha256"]:
            raise SystemExit(f"{d['id']}: page text differs from the manifest; re-run fetch/pages")
        res = _verify(pages, cands, d.get("sha256"))
        if "error" in res:
            raise SystemExit(f"{d['id']}: {res['message']}")
        allres[d["id"]] = {"outcomes": outcomes(res, len(cands)),
                           "reasons": {str(i["candidate"]): f"{i['check']}: {i['reason']}"
                                       for k in ("needs_review", "rejected") for i in res[k]},
                           "summary": res["summary"]}
    (outdir / "verifier-outcomes.json").write_text(json.dumps(allres, indent=1) + "\n")
    print(f"wrote {outdir / 'verifier-outcomes.json'}")
    return 0


def score(docs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """docs: id -> {labels, candidates, outcomes, planted: [{outcome, original_outcome}]}. Pure; tested."""
    rows = []
    for doc_id, d in docs.items():
        kinds = classify(d["candidates"], d["labels"])
        for c, k, o in zip(d["candidates"], kinds, d["outcomes"]):
            rows.append({"doc": doc_id, "predicate": c["predicate"], "kind": k, "outcome": o})
    main = [r for r in rows if r["kind"] in ("correct", "wrong")]
    ver = [r for r in main if r["outcome"] == "verified"]
    correct = [r for r in main if r["kind"] == "correct"]
    wrong = [r for r in main if r["kind"] == "wrong"]

    def metric(k: int, n: int) -> dict[str, Any]:
        ci = wilson(k, n)
        return {"k": k, "n": n, "rate": (k / n if n else None), "wilson95": ci}

    labels_scored = []
    for doc_id, d in docs.items():
        kinds = classify(d["candidates"], d["labels"])
        seen: list[tuple[str, Any]] = []
        for lab in d["labels"]:
            if lab["predicate"] in SUMMARY_PREDICATES:
                continue
            # Coverage counts distinct (predicate, value) labels: the same value labelled twice is one fact.
            if any(p == lab["predicate"] and values_match(p, v, lab["value"]) for p, v in seen):
                continue
            seen.append((lab["predicate"], lab["value"]))
            hit = any(c["predicate"] == lab["predicate"] and k == "correct" and o == "verified"
                      and values_match(lab["predicate"], c["value"], lab["value"])
                      for c, k, o in zip(d["candidates"], kinds, d["outcomes"]))
            labels_scored.append(hit)
    planted = [p for d in docs.values() for p in d.get("planted", [])]
    planted_base = [p for p in planted if p["original_outcome"] == "verified"]
    unl = [r for r in rows if r["kind"] == "unlabeled"]
    out = {
        "candidates": len(rows),
        "by_kind": {k: sum(r["kind"] == k for r in rows) for k in ("correct", "wrong", "unlabeled", "summary")},
        "precision_of_verified": metric(sum(r["kind"] == "correct" for r in ver), len(ver)),
        "catch_rate": metric(sum(r["outcome"] != "verified" for r in wrong), len(wrong)),
        "false_rejection_rate": metric(sum(r["outcome"] != "verified" for r in correct), len(correct)),
        "false_rejection_split": {o: sum(r["outcome"] == o for r in correct) for o in ("needs_review", "rejected")},
        "wrong_split": {o: sum(r["outcome"] == o for r in wrong) for o in ("verified", "needs_review", "rejected")},
        "coverage": metric(sum(labels_scored), len(labels_scored)),
        "planted_catch_rate": metric(sum(p["outcome"] != "verified" for p in planted_base), len(planted_base)),
        "planted_catch_rate_all": metric(sum(p["outcome"] != "verified" for p in planted), len(planted)),
        "unlabeled": {o: sum(r["outcome"] == o for r in unl) for o in ("verified", "needs_review", "rejected")},
        "summary_predicates": {o: sum(r["outcome"] == o for r in rows if r["kind"] == "summary")
                               for o in ("verified", "needs_review", "rejected")},
        # Sensitivity: count unlabeled candidates as wrong.
        "precision_of_verified_unlabeled_as_wrong": metric(
            sum(r["kind"] == "correct" for r in ver), len(ver) + sum(r["outcome"] == "verified" for r in unl)),
    }
    per_pred: dict[str, dict[str, int]] = {}
    for r in main:
        s = per_pred.setdefault(r["predicate"], {"correct_verified": 0, "correct_not_verified": 0,
                                                 "wrong_verified": 0, "wrong_not_verified": 0})
        s[f"{r['kind']}_{'verified' if r['outcome'] == 'verified' else 'not_verified'}"] += 1
    out["per_predicate"] = dict(sorted(per_pred.items()))
    return out


def cmd_score(args: argparse.Namespace) -> int:
    m = load_manifest()
    vo = json.loads((HERE / "results" / "verifier-outcomes.json").read_text())
    docs = {}
    planted_detail = []
    for d in m["documents"]:
        if d["id"] not in vo:
            continue
        labels = json.loads((HERE / "labels" / f"{d['id']}.json").read_text())["labels"]
        cands = json.loads((HERE / "candidates" / f"{d['id']}.json").read_text())["candidates"]
        outs = vo[d["id"]]["outcomes"]
        kinds = classify(cands, labels)
        planted_cands, origin = [], []
        for i, (c, k) in enumerate(zip(cands, kinds)):
            if k != "correct":
                continue
            r = plant_error(c["predicate"], c["value"])
            if r:
                planted_cands.append({**c, "value": r[0]})
                origin.append((i, r[1]))
        planted = []
        if planted_cands:
            res = _verify(load_pages(d), planted_cands, d.get("sha256"))
            pouts = outcomes(res, len(planted_cands))
            for (i, path), po, pc in zip(origin, pouts, planted_cands):
                planted.append({"outcome": po, "original_outcome": outs[i]})
                planted_detail.append({"doc": d["id"], "candidate": i, "predicate": pc["predicate"], "path": path,
                                       "original": cands[i]["value"], "planted": pc["value"],
                                       "original_outcome": outs[i], "outcome": po})
        docs[d["id"]] = {"labels": labels, "candidates": cands, "outcomes": outs, "planted": planted}
    s = score(docs)
    (HERE / "results" / "scores.json").write_text(json.dumps(s, indent=1) + "\n")
    (HERE / "results" / "planted.json").write_text(json.dumps(planted_detail, indent=1) + "\n")
    for k in ("precision_of_verified", "catch_rate", "false_rejection_rate", "coverage", "planted_catch_rate"):
        v = s[k]
        ci = v["wilson95"]
        rate = "n/a" if v["rate"] is None else f"{v['rate']:.3f}"
        print(f"{k:24s} {v['k']}/{v['n']} = {rate}  95% CI {('n/a' if ci is None else f'[{ci[0]:.3f}, {ci[1]:.3f}]')}")
    print(json.dumps({k: s[k] for k in ("by_kind", "false_rejection_split", "wrong_split", "unlabeled", "summary_predicates")}))
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
    cl = sub.add_parser("check-labels")
    cl.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    return {"fetch": cmd_fetch, "pages": cmd_pages, "check-labels": cmd_check_labels, "verify": cmd_verify,
            "score": cmd_score, "test": cmd_test}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
