"""doc_spread_statement: the caller's agent proposes the line items of an operating statement
(T-12, budget, rent roll summary); FactLot checks each amount and label against its quote, maps the
label to the published chart of accounts (schemas/vocabularies/chart-of-accounts.json), and checks
that the statement's own subtotals and totals foot. packages/tools/src/statements.ts is the same
code; spec/vectors/documents.json pins both. No model runs here."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from importlib import resources
from typing import Any

from ._core import round_
from .docverify import MIN_QUOTE_CHARS, DocInputError, _cap_characters, _characters, _describe, _load_document, \
    locate_quote
from .ingest.verify import _NUMBER_TOKEN, _decimal, _missing, _norm, show_value
from .words import KeywordIndex, words

STATEMENT_LINES = 1_000
_NEGATIVE_BEFORE = re.compile(r"(\( *\$? *|-\$?|\$-)\Z")


@lru_cache(maxsize=None)
def chart_of_accounts() -> dict[str, Any]:
    """The chart of accounts (generated from packages/tools/src/vocabularies.ts)."""
    path = resources.files("factlot").joinpath("schemas/vocabularies/chart-of-accounts.json")
    return json.loads(path.read_text("utf-8"))


@lru_cache(maxsize=None)
def _prepare(kind: str) -> dict[str, Any]:
    chart = chart_of_accounts()["charts"][kind]
    entries = [(c["id"], c["keywords"]) for c in chart["categories"]] + \
              [(t["id"], t["keywords"]) for t in chart["totals"]]
    return {"chart": chart, "categories": {c["id"]: c for c in chart["categories"]},
            "totals": {t["id"]: t for t in chart["totals"]}, "index": KeywordIndex(entries)}


def _dictionary(p: dict[str, Any], label: str) -> list[str]:
    """The categories (or totals) the label's longest keyword matches, in order of appearance."""
    found = p["index"].find(words(label))
    longest = max([0] + [m["end"] - m["start"] for m in found])
    out: list[str] = []
    for m in found:
        if m["end"] - m["start"] == longest and m["key"] not in out:
            out.append(m["key"])
    return out


def _written_negative(q: str, amount: float) -> bool:
    """True when every place the quote writes the amount, it writes it as negative: (1,200), -1,200."""
    wanted = _decimal(abs(amount))
    seen = False
    for m in _NUMBER_TOKEN.finditer(q):
        if _decimal(m.group(1).replace(",", "").rstrip(".")) != wanted:
            continue
        seen = True
        if not _NEGATIVE_BEFORE.search(q[:m.start()]):
            return False
    return seen


def _cite(doc: dict[str, Any], page: int, q: str, line: dict[str, Any]) -> dict[str, Any]:
    # A short quote is located where it stands as whole words (locate_quote).
    span = doc["text"].span(page, q, len(q) < MIN_QUOTE_CHARS)
    out: dict[str, Any] = {"document_id": doc["id"]}
    if "title" in doc:
        out["title"] = doc["title"]
    out["page"] = page
    out["quote"] = line["quote"]
    if page in doc["ocr"]:
        out["ocr"] = True
    if span:
        out["span"] = span
    return out


def spread_statement(args: dict[str, Any]) -> dict[str, Any]:
    from .tools import _suggest  # the unknown-field suggester, shared with run_tool

    _cap_characters(_characters(args["document"]["pages"]))
    doc = _load_document(args["document"])
    p = _prepare(args["property_type"])
    exceptions: list[dict[str, Any]] = []

    def flag(kind: str, message: str, at: dict[str, Any], extra: dict[str, Any] | None = None) -> None:
        exceptions.append({**at, "kind": kind, "message": message, **(extra or {})})

    lines = args["lines"]
    tolerance_given = args.get("tolerance")

    def period_of(line: dict[str, Any]) -> str:
        if "period" in line:
            return line["period"]
        return args.get("period", "")

    issues = []
    for i, line in enumerate(lines):
        for k, j in enumerate(line.get("sums", [])):
            if j >= len(lines) or j == i:
                issues.append({"path": f"lines.{i}.sums.{k}",
                               "message": "a subtotal cannot add up itself" if j == i else f"there is no line {j}"})
    if issues:
        raise DocInputError(issues[:20])

    # 1. Each line: the quote, the amount and the label, then its category.
    def check(i: int, line: dict[str, Any]) -> dict[str, Any]:
        base = {"index": i, "line": line, "period": period_of(line)}
        at = {"line": i}
        loc = locate_quote(doc["text"], line["quote"], line["page"], short_whole_words=True)
        if not loc["ok"]:
            flag("quote", loc["reason"], at)
            return {**base, "kind": "excluded", "reason": loc["reason"]}
        q = loc["q"]
        category = total = None
        if "sums" not in line:
            candidates = _dictionary(p, line["label"])
            given = line.get("category")
            if given is not None:
                category, total = p["categories"].get(given), p["totals"].get(given)
                if category is None and total is None:
                    near = _suggest(given, list(p["categories"]) + list(p["totals"]))
                    flag("unknown_category", f'"{given}" is not in the {args["property_type"]} chart'
                                             + (f' (did you mean "{near}"?)' if near else "")
                                             + "; the label was mapped instead", at)
                elif candidates and given not in candidates:
                    flag("category_review", f"the label maps to {' or '.join(candidates)} in the chart, not {given}; "
                                            f"{given} was used, review it", at, {"dictionary": candidates})
            if category is None and total is None:
                if len(candidates) != 1:
                    reason = ("the label matches no category in the chart; give a category" if not candidates else
                              f"the label could be {' or '.join(candidates)}; give a category")
                    flag("unmapped", reason, at, {"dictionary": candidates} if candidates else None)
                    return {**base, "kind": "excluded", "reason": reason}
                category, total = p["categories"].get(candidates[0]), p["totals"].get(candidates[0])
        amount = line["amount"]
        kind_of_amount = "ratio" if category is not None and category.get("ratio") else "number"
        if _missing(kind_of_amount, abs(amount), q):
            reason = f"amount {show_value(abs(amount))} not found in quote"
            flag("amount", reason, at)
            return {**base, "kind": "excluded", "reason": reason}
        if _norm(line["label"]) not in q:
            reason = f"label {show_value(line['label'])} not found in quote"
            flag("label", reason, at)
            return {**base, "kind": "excluded", "reason": reason}
        citation = _cite(doc, loc["page"], q, line)
        if loc["corrected"]:
            citation["note"] = f"quote found on page {loc['page']}, not {line['page']}"
        negative = amount < 0 or _written_negative(q, amount)
        stated = -abs(amount) if negative else abs(amount)
        if "sums" in line:
            return {**base, "kind": "subtotal", "signed": stated, "citation": citation}
        if total is not None:
            return {**base, "kind": "total", "total": total, "signed": stated, "citation": citation}
        if category["section"] == "memo":
            return {**base, "kind": "memo", "category": category, "signed": amount, "citation": citation}
        signed = stated
        if category.get("contra"):
            signed = -abs(amount)
        elif amount > 0 and negative:
            flag("sign", f"the quote writes {show_value(amount)} as negative; it is spread as {show_value(signed)}", at)
        elif amount < 0 and not _written_negative(q, amount):
            flag("sign", "the amount is negative but the quote does not write it as negative (parentheses or a minus "
                         "sign); check the sign", at)
        first = (words(line["label"]) or [None])[0]
        if first in ("total", "subtotal"):
            flag("possible_subtotal", f'"{line["label"]}" reads as a subtotal but is spread as a {category["id"]} line; '
                                      "if its parts are listed too, give it sums so it is not counted twice", at)
        return {**base, "kind": "line", "category": category, "signed": signed, "citation": citation}

    checked = [check(i, line) for i, line in enumerate(lines)]

    # 2. Per period: sections, totals, the statement's own totals and subtotals.
    period_keys: list[str] = []
    for c in checked:
        if c["period"] not in period_keys:
            period_keys.append(c["period"])
    all_foot = True
    periods = []
    for key in period_keys:
        label = None if key == "" else key

        def at_of(i: int, label: str | None = label) -> dict[str, Any]:
            return {"line": i, "period": label} if label is not None else {"line": i}
        in_period = [c for c in checked if c["period"] == key]
        # Lines left out of this period's spread: a total that does not foot names them.
        left = [c for c in in_period if c["kind"] == "excluded"]
        left_out = (f"; {'line' if len(left) == 1 else 'lines'} left out of the spread in this period: "
                    + ", ".join(f"{c['index']} ({c['line']['label']}, {show_value(c['line']['amount'])})"
                                for c in left[:5])
                    + (f" and {len(left) - 5} more" if len(left) > 5 else "")) if left else ""
        section_amount: dict[str, float] = {}
        section_lines: dict[str, int] = {}
        sections = []
        for s in p["chart"]["sections"]:
            if s["id"] == "memo":
                continue
            ls = [c for c in in_period if c["kind"] == "line" and c["category"]["section"] == s["id"]]
            total_sum = 0.0
            for c in ls:
                total_sum += c["signed"]
            amount = round_(total_sum)
            section_amount[s["id"]] = amount
            section_lines[s["id"]] = len(ls)
            sections.append({"id": s["id"], "label": s["label"], "amount": amount, "lines": [c["index"] for c in ls]})
        total_amount: dict[str, float] = {}
        total_lines: dict[str, int] = {}
        totals = []
        for t in p["chart"]["totals"]:
            acc, n = 0.0, 0
            for ref in t["sum"]:
                neg = ref.startswith("-")
                rid = ref[1:] if neg else ref
                v = section_amount[rid] if rid in section_amount else total_amount.get(rid, 0)
                acc += -v if neg else v
                n += section_lines[rid] if rid in section_lines else total_lines.get(rid, 0)
            amount = round_(acc)
            total_amount[t["id"]] = amount
            total_lines[t["id"]] = n
            stated = []
            for c in in_period:
                if c["kind"] != "total" or c["total"]["id"] != t["id"]:
                    continue
                tolerance = tolerance_given if tolerance_given is not None else 0.5 * n
                difference = round_(c["signed"] - amount)
                foots = abs(difference) <= tolerance
                if not foots:
                    all_foot = False
                    flag("does_not_foot", f"{c['line']['label']} is {show_value(c['signed'])} on the statement; the "
                                          f"lines spread here give {show_value(amount)} (difference "
                                          f"{show_value(difference)}, tolerance {show_value(tolerance)}){left_out}",
                         at_of(c["index"]))
                stated.append({"line": c["index"], "amount": c["signed"], "difference": difference,
                               "tolerance": tolerance, "foots": foots})
            entry: dict[str, Any] = {"id": t["id"], "label": t["label"], "amount": amount}
            if stated:
                entry["stated"] = stated
            totals.append(entry)
        subtotals = []
        for c in in_period:
            if c["kind"] != "subtotal":
                continue
            parts = c["line"]["sums"]
            acc, n, usable = 0.0, 0, True
            for j in parts:
                part = checked[j]
                if part["period"] != key or part["kind"] not in ("line", "excluded"):
                    usable = False
                    where = "in another period" if part["period"] != key else f"a {part['kind']}"
                    flag("sums", f"line {j} is {where}; a subtotal adds up lines of its own period",
                         at_of(c["index"]))
                    continue
                if part["kind"] == "excluded":
                    flag("subtotal_part_excluded", f"line {j} is not in the spread ({part['reason']}); the subtotal is "
                                                   "checked without it", at_of(c["index"]))
                    continue
                acc += part["signed"]
                n += 1
            computed = round_(acc)
            tolerance = tolerance_given if tolerance_given is not None else 0.5 * n
            difference = round_(abs(c["signed"]) - abs(computed))
            foots = usable and abs(difference) <= tolerance
            if usable and not foots:
                all_foot = False
                flag("does_not_foot", f"{c['line']['label']} is {show_value(c['signed'])} on the statement; lines "
                                      f"{', '.join(map(str, parts))} add up to {show_value(computed)} (difference "
                                      f"{show_value(difference)} in size, tolerance {show_value(tolerance)})",
                     at_of(c["index"]))
            if not usable:
                all_foot = False
            subtotals.append({"line": c["index"], "label": c["line"]["label"], "amount": c["signed"], "sums": parts,
                              "computed": computed, "difference": difference, "tolerance": tolerance, "foots": foots})
        memo = [{"line": c["index"], "category": c["category"]["id"], "label": c["category"]["label"],
                 "value": c["signed"]} for c in in_period if c["kind"] == "memo"]
        entry = {"period": label} if label is not None else {}
        entry.update({"sections": sections, "totals": totals})
        if subtotals:
            entry["subtotals"] = subtotals
        if memo:
            entry["memo"] = memo
        periods.append(entry)

    out = []
    for c in checked:
        status = {"line": "included"}.get(c["kind"], c["kind"])
        item: dict[str, Any] = {"line": c["index"], "label": c["line"]["label"], "status": status}
        if c["period"] != "":
            item["period"] = c["period"]
        if c.get("category") is not None:
            item["category"] = c["category"]["id"]
            item["section"] = c["category"]["section"]
        if c.get("total") is not None:
            item["category"] = c["total"]["id"]
        item["amount"] = c["line"]["amount"]
        if c["kind"] == "line":
            item["spread_amount"] = c["signed"]
        if "citation" in c:
            item["citation"] = c["citation"]
        if "reason" in c:
            item["reason"] = c["reason"]
        out.append(item)

    def count(k: str) -> int:
        return sum(1 for x in out if x["status"] == k)

    result: dict[str, Any] = {"property_type": args["property_type"]}
    if args.get("statement_type"):
        result["statement_type"] = args["statement_type"]
    result.update({
        "chart": f"factlot.chart_of_accounts@{chart_of_accounts()['version']}",
        "document": _describe(doc),
        "periods": periods,
        "lines": out,
        "exceptions": exceptions,
        "summary": {"lines": len(lines), "included": count("included"), "totals": count("total"),
                    "subtotals": count("subtotal"), "memo": count("memo"), "excluded": count("excluded"),
                    "exceptions": len(exceptions), "foots": all_foot},
    })
    return result
