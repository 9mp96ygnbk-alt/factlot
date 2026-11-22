"""audit_expense_portfolio: many landlord expense statements audited at once.

The same code as packages/tools/src/audit_portfolio.ts (spec/differential runs both on the same inputs).
Each location is one audit_expense_statement run (`audit._audit`, not a second implementation); this
module reads the list, runs the audit on each location and adds up what comes back: totals by finding
class, by check and by landlord, the locations ranked by dollars at stake, the dispute deadlines in date
order, repeated issues, and the locations whose input could not be audited (reported one by one: a bad
location never fails the call). No model, no clock (as_of is an input). The Python SDK cannot sign: the
hosted service's per-location attestation is added by the hosted API only.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

from . import audit as _audit_mod
from ._core import round_
from .docverify import DocInputError
from .factpackage import canonical_json
from .free_document import FREE_DOCUMENT_PLAN_URL, document_id

PORTFOLIO_MAX_AUDITS = 50
PORTFOLIO_PLAN_URL = "https://factlot.com/pricing/"
_LABEL_MAX = 120
_LANDLORD_MAX = 200
_ENTRY_KEYS = ["label", "landlord", "lease_facts", "statement_facts", "prior_statement_facts", "yoy_threshold", "received"]
_CLASSES = ["follows_from_terms", "depends_on_reading", "question_to_ask"]
_CLASS_LABEL = {
    "follows_from_terms": "Follows from the lease's terms",
    "depends_on_reading": "Depends on how the lease sentence is read",
    "question_to_ask": "A question to ask, not an overcharge",
}
_NO_LANDLORD = "Landlord not named"


def _usd(x: float) -> float:
    return round_(x, 2)


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def _non_empty_objects(v: Any, mx: int) -> bool:
    return isinstance(v, list) and 1 <= len(v) <= mx and all(isinstance(x, dict) for x in v)


def _num(v: Any) -> float:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def _prepare_entry(entry: Any, index: int, as_of: str, default_yoy: float, seen: dict[str, int]) -> dict[str, Any]:
    def at(k: str) -> str:
        return f"audits.{index}.{k}"

    if not isinstance(entry, dict):
        return {"ok": False, "label": "", "landlord": None,
                "issues": [{"path": f"audits.{index}", "message": "expected an object"}]}
    e = entry
    issues: list[dict[str, str]] = []
    for k in sorted(e.keys()):
        if k not in _ENTRY_KEYS:
            issues.append({"path": at(k), "message": f"unknown field; known fields here: {', '.join(_ENTRY_KEYS)}"})
    label = ""
    lab = e.get("label")
    if not isinstance(lab, str) or lab.strip() == "":
        issues.append({"path": at("label"), "message": "missing: every location needs a label (1 to 120 characters)"})
    elif len(lab.strip()) > _LABEL_MAX:
        issues.append({"path": at("label"), "message": f"at most {_LABEL_MAX} characters"})
    else:
        label = lab.strip()
        first = seen.get(label.lower())
        if first is not None:
            issues.append({"path": at("label"),
                           "message": f'duplicate label "{label}" (also audits.{first}): each location\'s label must be unique'})
        else:
            seen[label.lower()] = index
    landlord: str | None = None
    ll = e.get("landlord")
    if ll is not None:
        if not isinstance(ll, str) or ll.strip() == "":
            issues.append({"path": at("landlord"), "message": "expected a name (text), or leave the field out"})
        elif len(ll.strip()) > _LANDLORD_MAX:
            issues.append({"path": at("landlord"), "message": f"at most {_LANDLORD_MAX} characters"})
        elif _audit_mod._norm(ll) == "":
            issues.append({"path": at("landlord"), "message": "a name needs at least one letter or digit"})
        else:
            landlord = ll.strip()

    def lst(k: str, mx: int, required: bool) -> Any:
        v = e.get(k)
        if v is None:
            if required:
                issues.append({"path": at(k), "message": "missing: this field is required"})
            return None
        if not _non_empty_objects(v, mx):
            issues.append({"path": at(k), "message": f"expected a list of 1 to {mx} facts (objects)"})
            return None
        return v

    lease_facts = lst("lease_facts", 200, True)
    statement_facts = lst("statement_facts", 1000, True)
    prior = lst("prior_statement_facts", 1000, False)
    yoy = default_yoy
    y = e.get("yoy_threshold")
    if y is not None:
        if not _is_number(y) or y <= 0 or y > 10:
            issues.append({"path": at("yoy_threshold"), "message": "expected a number above 0 and at most 10"})
        else:
            yoy = y
    received = None
    rc = e.get("received")
    if rc is not None:
        if (not isinstance(rc, dict) or any(k not in ("date", "stated_by") for k in rc)
                or not isinstance(rc.get("date"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", rc["date"])
                or not isinstance(rc.get("stated_by"), str) or rc["stated_by"].strip() == ""
                or len(rc["stated_by"].strip()) > 200):
            issues.append({"path": at("received"),
                           "message": "expected {date: YYYY-MM-DD, stated_by: the full name of the person stating it (at most 200 characters)}"})
        else:
            received = {"date": rc["date"], "stated_by": rc["stated_by"].strip()}
    if issues or lease_facts is None or statement_facts is None:
        return {"ok": False, "label": label, "landlord": landlord, "issues": issues[:20]}
    audit_input: dict[str, Any] = {"lease_facts": lease_facts, "statement_facts": statement_facts}
    if prior is not None:
        audit_input["prior_statement_facts"] = prior
    audit_input["as_of"] = as_of
    audit_input["yoy_threshold"] = yoy
    if received is not None:
        audit_input["received"] = received
    return {"ok": True, "index": index, "label": label, "landlord": landlord, "audit_input": audit_input}


def _documents_of(audit_input: dict[str, Any]) -> dict[str, Any]:
    def ids(facts: list[dict[str, Any]] | None) -> list[str]:
        out: list[str] = []
        for f in facts or []:
            prov = f.get("provenance") if isinstance(f.get("provenance"), dict) else {}
            srcs = prov.get("sources") if isinstance(prov.get("sources"), list) else []
            src = srcs[0] if srcs else None
            did = src.get("document_id") if isinstance(src, dict) and isinstance(src.get("document_id"), str) else ""
            if did and did not in out:
                out.append(did)
        return out

    return {"lease_documents": ids(audit_input["lease_facts"]), "statement_documents": ids(audit_input["statement_facts"])}


def _pages(f: dict[str, Any], side: str) -> list[Any]:
    out: list[Any] = []
    for s in f.get("sources") or []:
        if s.get("side") == side and _is_number(s.get("page")) and s["page"] not in out:
            out.append(s["page"])
    return sorted(out)


def _location_entry(p: dict[str, Any], full: dict[str, Any], include_results: bool) -> dict[str, Any]:
    totals = full["totals"]
    findings = full["findings"]
    by_class = {"follows_from_terms": 0, "depends_on_reading": 0, "question_to_ask": 0}
    for f in findings:
        if _is_number(f.get("difference")):
            by_class[f["class"]] = _usd(by_class.get(f["class"], 0) + f["difference"])
    items = full["package_items"]
    cost = full["cost_shifting"]
    entry: dict[str, Any] = {
        "index": p["index"], "label": p["label"], "landlord": p["landlord"], "status": "audited",
        "statement_year": full.get("statement_year"),
        "summary": {
            "finding_count": totals["finding_count"], "follows_from_terms": totals["follows_from_terms"],
            "depends_on_reading": totals["depends_on_reading"], "question_to_ask": totals["question_to_ask"],
            "dollars_at_stake": {
                "firm_difference": totals["firm_difference"],
                "readings_difference": _usd(_num(totals["total_difference"]) - _num(totals["firm_difference"])),
                "total_difference": totals["total_difference"], "by_class": by_class, "unit": "USD",
            },
            "deadlines": [{"code": d["code"], "last_day": d["last_day"], "status": d["status"],
                           "days_remaining": d["days_remaining"], "notice_form": d["notice_form"],
                           "window_days": d["window_days"], "starts_from": d["starts_from"],
                           "counted_from": d["counted_from"]} for d in full["deadlines"]],
            "checks": [{"check": c["check"], "status": c["status"], "findings": c["findings"]} for c in full["checks"]],
            "checks_not_run": full["checks_not_run"],
            "cost_shifting": ({"threshold_amount": cost["threshold_amount"],
                               "crosses_on_firm_findings": cost["crosses_on_firm_findings"],
                               "crosses_if_readings_hold": cost["crosses_if_readings_hold"]} if cost else None),
        },
        "findings": [{"id": f["id"], "code": f["code"], "check": f["check"], "class": f["class"], "title": f["title"],
                      "landlord_label": f["landlord_label"], "lease_label": f["lease_label"],
                      "landlord_figure": f["landlord_figure"], "lease_figure": f["lease_figure"],
                      "difference": f["difference"], "lease_pages": _pages(f, "lease"),
                      "statement_pages": _pages(f, "statement"), "lease_fact_ids": f["lease_fact_ids"]}
                     for f in findings],
        "sources": {**_documents_of(p["audit_input"]), "facts_used": len(full["facts_used"])},
        "result_ref": {
            "tool": "audit_expense_statement",
            "input_digest": _sha256_hex(canonical_json(p["audit_input"])),
            "result_digest": document_id(full),
            "note": "The same audit_expense_statement call on this location's lease_facts, statement_facts, "
                    "prior_statement_facts (if any), as_of and yoy_threshold returns a result whose digest is result_digest.",
        },
        "package": {
            "kind": "expense_reconciliation", "package_items": items, "items_count": len(items),
            "questions_not_sent": full["questions_not_sent"],
            "note": "To send this location's findings to its own landlord: fact_package_create from this location's "
                    "lease and statement facts, then fact_package_send with package_items as items (and this "
                    "location's attestation, when the hosted service returned one). One package per location; "
                    "never combine locations in one package.",
        },
    }
    if include_results:
        entry["result"] = full
    return entry


def _portfolio(inp: dict[str, Any]) -> dict[str, Any]:
    audits = inp["audits"]
    as_of = inp["as_of"]
    default_yoy = inp.get("yoy_threshold", 0.1)
    include_results = inp.get("include_results", False)
    seen: dict[str, int] = {}
    prepared: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    for i, entry in enumerate(audits):
        p = _prepare_entry(entry, i, as_of, default_yoy, seen)
        if p["ok"]:
            prepared.append(p)
        else:
            invalid.append({"index": i, "label": p["label"] or None, "landlord": p["landlord"],
                            "status": "input_invalid", "issues": p["issues"]})
    locs: list[dict[str, Any]] = []
    for p in prepared:
        try:
            full = _audit_mod._audit(p["audit_input"])
        except DocInputError as err:
            invalid.append({"index": p["index"], "label": p["label"], "landlord": p["landlord"],
                            "status": "input_invalid",
                            "issues": [{"path": f"audits.{p['index']}.{x['path']}", "message": x["message"]}
                                       for x in err.issues]})
            continue
        locs.append({"index": p["index"], "label": p["label"], "landlord": p["landlord"],
                     "key": None if p["landlord"] is None else _audit_mod._norm(p["landlord"]),
                     "year": full["statement_year"] if _is_number(full.get("statement_year")) else None,
                     "full": full, "entry": _location_entry(p, full, include_results)})
    invalid.sort(key=lambda x: x["index"])

    firm = 0.0
    readings = 0.0
    class_count = {c: 0 for c in _CLASSES}
    class_dollars: dict[str, float] = {c: 0 for c in _CLASSES}
    finding_count = 0
    for l in locs:
        t = l["full"]["totals"]
        firm += _num(t["firm_difference"])
        readings += _num(t["total_difference"]) - _num(t["firm_difference"])
        finding_count += _num(t["finding_count"])
        for f in l["full"]["findings"]:
            class_count[f["class"]] += 1
            if _is_number(f.get("difference")):
                class_dollars[f["class"]] = _usd(class_dollars[f["class"]] + f["difference"])
    firm = _usd(firm)
    readings = _usd(readings)
    total = _usd(firm + readings)

    by_check = []
    for check, name in _audit_mod._CHECKS:
        findings = 0
        cc = {c: 0 for c in _CLASSES}
        dollars: float = 0
        with_findings = ran = partly = not_run = 0
        for l in locs:
            fs = [f for f in l["full"]["findings"] if f["check"] == check]
            if fs:
                with_findings += 1
            for f in fs:
                findings += 1
                cc[f["class"]] += 1
                if _is_number(f.get("difference")):
                    dollars = _usd(dollars + f["difference"])
            st = next((c["status"] for c in l["full"]["checks"] if c["check"] == check), None)
            if st == "ran":
                ran += 1
            elif st == "partly_run":
                partly += 1
            else:
                not_run += 1
        by_check.append({"check": check, "name": name, "findings": findings,
                         "follows_from_terms": cc["follows_from_terms"], "depends_on_reading": cc["depends_on_reading"],
                         "question_to_ask": cc["question_to_ask"], "dollars_at_stake": dollars,
                         "locations_with_findings": with_findings, "locations_ran": ran,
                         "locations_partly_run": partly, "locations_not_run": not_run})

    groups: dict[str, dict[str, Any]] = {}
    for l in locs:
        key = l["key"] if l["key"] is not None else ""
        g = groups.setdefault(key, {"name": l["landlord"], "locs": []})
        g["locs"].append(l)

    def dl_of(l: dict[str, Any]) -> list[dict[str, Any]]:
        return [{"label": l["label"], "landlord": l["landlord"], "statement_year": l["year"],
                 "last_day": d["last_day"], "days_remaining": _num(d["days_remaining"]), "status": d["status"],
                 "notice_form": d["notice_form"], "window_days": _num(d["window_days"]),
                 "starts_from": d["starts_from"], "counted_from": d["counted_from"]}
                for d in l["full"]["deadlines"]]

    def dl_key(d: dict[str, Any]) -> tuple[str, str]:
        return (d["last_day"], d["label"])

    def earliest_open(lst: list[dict[str, Any]]) -> dict[str, Any] | None:
        op = sorted((d for d in lst if d["status"] == "open"), key=dl_key)
        if not op:
            return None
        d = op[0]
        return {"label": d["label"], "last_day": d["last_day"], "days_remaining": d["days_remaining"]}

    by_landlord = []
    for g in groups.values():
        f = _usd(sum((_num(l["full"]["totals"]["firm_difference"]) for l in g["locs"]), 0))
        t = _usd(sum((_num(l["full"]["totals"]["total_difference"]) for l in g["locs"]), 0))
        by_landlord.append({
            "landlord": g["name"], "landlord_name": g["name"] if g["name"] is not None else _NO_LANDLORD,
            "locations": len(g["locs"]), "location_labels": [l["label"] for l in g["locs"]],
            "findings": sum(_num(l["full"]["totals"]["finding_count"]) for l in g["locs"]),
            "firm_difference": f, "readings_difference": _usd(t - f), "total_difference": t,
            "earliest_deadline": earliest_open([d for l in g["locs"] for d in dl_of(l)]),
        })
    by_landlord.sort(key=lambda x: (-x["total_difference"], x["landlord_name"]))

    ranking_rows = [{"label": l["label"], "landlord": l["landlord"], "statement_year": l["year"],
                     "finding_count": _num(l["full"]["totals"]["finding_count"]),
                     "firm_difference": _num(l["full"]["totals"]["firm_difference"]),
                     "total_difference": _num(l["full"]["totals"]["total_difference"])} for l in locs]
    ranking_rows.sort(key=lambda x: (-x["total_difference"], -x["firm_difference"], x["label"]))
    ranking = [{"rank": i + 1, **r} for i, r in enumerate(ranking_rows)]
    deadlines = sorted((d for l in locs for d in dl_of(l)), key=dl_key)
    without_deadline = [l["label"] for l in locs if len(l["full"]["deadlines"]) == 0]
    open_dl = len([d for d in deadlines if d["status"] == "open"])

    def failing(l: dict[str, Any], check: str) -> list[dict[str, Any]]:
        return [f for f in l["full"]["findings"] if f["check"] == check and f["class"] != "question_to_ask"]

    repeated: list[dict[str, Any]] = []
    for ci, (check, name) in enumerate(_audit_mod._CHECKS):
        failed = [l for l in locs if failing(l, check)]
        if len(failed) < 2:
            continue

        def row(scope: str, landlord: str | None, ls: list[dict[str, Any]]) -> dict[str, Any]:
            fs = [f for l in ls for f in failing(l, check)]
            years = sorted({l["year"] for l in ls if l["year"] is not None})
            dollars = _usd(sum((f["difference"] if _is_number(f.get("difference")) else 0 for f in fs), 0))
            names: list[str] = []
            for l in ls:
                if l["landlord"] is not None and l["landlord"] not in names:
                    names.append(l["landlord"])
            yrs = f", in statement years {', '.join(str(y) for y in years)}" if len(years) >= 2 else ""
            who = f" for {landlord}" if landlord is not None else ""
            return {
                "check": check, "check_name": name, "scope": scope, "landlord": landlord, "landlords": names,
                "locations": [l["label"] for l in ls], "location_count": len(ls), "statement_years": years,
                "across_years": len(years) >= 2, "finding_count": len(fs),
                "finding_codes": sorted({f["code"] for f in fs}), "dollars_at_stake": dollars,
                "summary": f"{name}: a finding at {len(ls)} locations{who}{yrs}, {_audit_mod._money(dollars)} in all",
                "_order": ci,
            }

        by_key: dict[str, list[dict[str, Any]]] = {}
        for l in failed:
            if l["key"] is not None:
                by_key.setdefault(l["key"], []).append(l)
        for ls in by_key.values():
            if len(ls) >= 2:
                repeated.append(row("landlord", ls[0]["landlord"], ls))
        one_covers_all = len(by_key) == 1 and len(next(iter(by_key.values()))) == len(failed)
        if not one_covers_all:
            repeated.append(row("portfolio", None, failed))
    repeated.sort(key=lambda r: (-r["dollars_at_stake"], r["_order"], r["landlord"] or "", r["scope"]))
    for r in repeated:
        del r["_order"]

    warnings: list[str] = []
    if invalid:
        names = ", ".join((x["label"] or f"audits.{x['index']}") for x in invalid)
        warnings.append(f"{len(invalid)} {'location was' if len(invalid) == 1 else 'locations were'} not audited because "
                        f"the input failed validation ({names}); the issues are under locations_invalid and the other "
                        "locations were audited.")
    passed: list[str] = []
    for d in deadlines:
        if d["status"] == "passed" and d["label"] not in passed:
            passed.append(d["label"])
    if passed:
        warnings.append(f"The last day to dispute or audit has passed as of {as_of} for: {', '.join(passed)}. Confirm with "
                        "the lease how the day is counted and whether a late dispute is still open.")
    if without_deadline:
        warnings.append("No deadline could be computed (the lease's audit right, or the day the statement was received, was not supplied) for: "
                        f"{', '.join(without_deadline)}.")
    exceeding = [l["label"] for l in locs if l["full"]["totals"].get("exceeds_tenant_charge") is True]
    if exceeding:
        warnings.append(f"The differences add to more than the tenant's whole charge at: {', '.join(exceeding)}. A difference cannot exceed what was billed, so these totals (and the portfolio totals that include them) are not reliable until a person has checked the level each amount was entered at; each location's own warnings say more (include_results).")
    level_notes = [l["label"] for l in locs if len(l["full"].get("warnings") or []) > 0]
    if level_notes:
        warnings.append(f"The audit of these locations carries its own warnings (a level that was inferred, or a date that differs): {', '.join(level_notes)}. Read them with include_results before relying on the figures.")

    return {
        "as_of": as_of,
        "portfolio": {
            "locations_submitted": len(audits), "locations_audited": len(locs), "locations_invalid": len(invalid),
            "finding_count": finding_count, "follows_from_terms": class_count["follows_from_terms"],
            "depends_on_reading": class_count["depends_on_reading"], "question_to_ask": class_count["question_to_ask"],
            "firm_difference": firm, "readings_difference": readings, "total_difference": total, "unit": "USD",
            "earliest_deadline": earliest_open(deadlines), "open_deadlines": open_dl,
            "passed_deadlines": len(deadlines) - open_dl, "locations_without_deadline": len(without_deadline),
        },
        "report_units": len(locs),
        "by_class": [{"class": c, "label": _CLASS_LABEL[c], "findings": class_count[c],
                      "dollars_at_stake": class_dollars[c]} for c in _CLASSES],
        "by_check": by_check,
        "by_landlord": by_landlord,
        "ranking": ranking,
        "deadlines": deadlines,
        "locations_without_deadline": without_deadline,
        "repeated_issues": repeated,
        "locations": [l["entry"] for l in locs],
        "locations_invalid": invalid,
        "warnings": warnings,
        "notes": [
            "Each location is one audit_expense_statement run: a finding is a difference between that statement and what the lease's quoted terms yield, with the sources named. It is not a legal conclusion: findings that depend on a reading of the lease, and questions, say so in their class.",
            "Dollars at stake are the sum of the findings that follow from the lease's terms and the findings that depend on a reading, shown apart. A question to ask carries no dollars. Findings can overlap within a location, so a total is the sum of findings, not a recomputed charge.",
            "A repeated issue is a check with an overcharge finding (one that follows from the terms or depends on a reading) at two or more locations; a landlord's own pattern is listed apart, with the statement years it spans.",
            "The portfolio report (report_create kind expense_audit_portfolio) counts one unit of the monthly report allowance for each location audited in full (report_units); locations with invalid input are not counted.",
        ],
    }


def portfolio_summary(full: dict[str, Any]) -> dict[str, Any]:
    p = full["portfolio"]
    return {
        "limited": True,
        "summary": {
            "locations_submitted": p["locations_submitted"], "locations_audited": p["locations_audited"],
            "locations_invalid": p["locations_invalid"], "finding_count": p["finding_count"],
            "follows_from_terms": p["follows_from_terms"], "depends_on_reading": p["depends_on_reading"],
            "question_to_ask": p["question_to_ask"], "firm_difference": p["firm_difference"],
            "readings_difference": p["readings_difference"], "total_difference": p["total_difference"],
            "unit": "USD", "open_deadlines": p["open_deadlines"], "passed_deadlines": p["passed_deadlines"],
            "locations_without_deadline": p["locations_without_deadline"],
        },
        "report_units": full["report_units"],
        "locations_invalid": full["locations_invalid"],
        "audit_available": "pro",
        "audit_withheld": [
            "the ranking of locations, the totals by landlord and by check, and the schedule of dispute deadlines",
            "the repeated issues across locations and years",
            "each location's summary and findings, and the items to send to each landlord with fact_package_send",
            "the portfolio report (report_create kind expense_audit_portfolio)",
        ],
        "free_document": {
            "free_document": False,
            "note": ("The one free full document an email-verified account gets covers a single audit "
                     "(audit_expense_statement), not a portfolio: this answer is the summary and nothing was taken "
                     f"from that free document. {FREE_DOCUMENT_PLAN_URL}"),
        },
        "audit_note": ("The counts and totals are free. The ranking, the deadline schedule, each location's findings with "
                       "their lease quotes, the report and sending each location's dispute as a package are part of the "
                       f"paid plans (Pro and Team): {PORTFOLIO_PLAN_URL}"),
    }


def audit_expense_portfolio(inp: dict[str, Any]) -> dict[str, Any]:
    full = _portfolio(inp)
    return portfolio_summary(full) if _audit_mod.audit_limited() else full
