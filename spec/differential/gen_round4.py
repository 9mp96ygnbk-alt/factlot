"""Random inputs for calc_critical_dates and the round-4 document features (human confirmation,
rent schedules by lease year, doc_predicates) for the TypeScript/Python differential test. Each
case runs through run_tool in both SDKs, so the whole result is compared: steps, warnings, issue
paths. Every document is synthetic text built here.
"""

import random
from datetime import date, timedelta

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def _day(r, lo=1990, hi=2060):
    start = date(lo, 1, 1)
    return start + timedelta(days=r.randint(0, (date(hi, 12, 31) - start).days))


def _iso(r, lo=1990, hi=2060):
    # Month ends, February 29 and holidays turn up more often than at random.
    k = r.random()
    if k < 0.15:
        y = r.choice([2024, 2028, 2032, 2036])
        return f"{y}-02-29"
    if k < 0.35:
        d = _day(r, lo, hi)
        nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        return (nxt - timedelta(days=1)).isoformat()
    if k < 0.5:
        y = r.randint(lo, hi)
        return r.choice([f"{y}-01-01", f"{y}-07-04", f"{y}-12-25", f"{y}-06-19", f"{y}-11-11", f"{y}-12-31"])
    return _day(r, lo, hi).isoformat()


def critical_dates_case(r):
    """A valid input, and in some cases exactly one fault (Python reports the first fault only)."""
    exp = _iso(r, 2000, 2060)
    inp = {"expiration_date": exp}
    if r.random() < 0.5:
        inp["commencement_date"] = (date.fromisoformat(exp) - timedelta(days=r.randint(1, 5000))).isoformat()
    if r.random() < 0.6:
        inp["as_of"] = _iso(r, 2010, 2050)
    if r.random() < 0.8:
        ro = {"count": r.choice([1, 1, 2, 3, r.randint(1, 10)]), "term_months": r.choice([12, 36, 60, 120, r.randint(1, 600)])}
        k = r.random()
        if k < 0.45:
            ro["notice_months"] = r.choice([6, 9, 12, 18, r.randint(0, 120)])
        elif k < 0.65:
            ro["notice_days"] = r.choice([90, 180, 270, r.randint(0, 3650)])
        else:
            e = r.randint(1, 120)
            ro["notice_window"] = {"earliest_months_before": e, "latest_months_before": r.randint(0, e - 1)}
        inp["renewal_option"] = ro
    if r.random() < 0.5:
        opts = []
        for _ in range(r.randint(1, 3)):
            o = {"effective_date": (date.fromisoformat(exp) - timedelta(days=r.randint(0, 3000))).isoformat()}
            if r.random() < 0.6:
                o["notice_months"] = r.randint(0, 24)
            else:
                o["notice_days"] = r.randint(0, 720)
            if r.random() < 0.3:
                o["label"] = r.choice(["Year 5 termination right", "Contraction option", "Kick-out"])
            opts.append(o)
        inp["termination_options"] = opts
    if r.random() < 0.4:
        inp["expansion_option_deadline"] = _iso(r, 2000, 2060)
    if r.random() < 0.4:
        other = []
        for i in range(r.randint(1, 3)):
            if r.random() < 0.5:
                other.append({"label": f"Deadline {i}", "date": _iso(r, 2000, 2060)})
            else:
                other.append({"label": f"ROFO response {i}", "from_date": _iso(r, 2000, 2060), "days_after": r.randint(0, 60)})
        inp["other_deadlines"] = other
    if r.random() < 0.7:
        inp["business_day_roll"] = r.choice(["none", "preceding", "following"])
    if r.random() < 0.3:
        inp["holidays"] = r.choice(["us_federal", "none"])
    if r.random() < 0.15:
        fault = r.choice(["count", "both", "none", "window", "commencement", "termination", "other", "fraction", "big"])
        ro = {"count": 1, "term_months": 60, "notice_months": 12}
        if fault == "count":
            ro["count"] = r.choice([0, 11])
        elif fault == "both":
            ro["notice_days"] = 30
        elif fault == "none":
            del ro["notice_months"]
        elif fault == "window":
            del ro["notice_months"]
            ro["notice_window"] = {"earliest_months_before": 6, "latest_months_before": r.choice([6, 12])}
        elif fault == "fraction":
            ro["notice_months"] = 1.5
        elif fault == "big":
            ro["notice_months"] = 130
        inp["renewal_option"] = ro
        if fault == "commencement":
            inp["commencement_date"] = (date.fromisoformat(exp) + timedelta(days=r.randint(0, 9))).isoformat()
        if fault == "termination":
            inp["termination_options"] = [{"effective_date": (date.fromisoformat(exp) + timedelta(days=1)).isoformat(),
                                           "notice_months": 6}]
        if fault == "other":
            inp["other_deadlines"] = [{"label": "x", "date": exp, "from_date": exp, "days_after": 1}]
    return {"tool": "calc_critical_dates", "arguments": inp}


def r_choice_date(d):
    y, m, dd = map(int, d.split("-"))
    return f"{MONTHS[m - 1]} {dd}, {y}"


def lease_year_case(r):
    com = _iso(r, 1995, 2050)
    n = r.randint(1, 4)
    steps, a = [], 1
    for _ in range(n):
        b = a + r.randint(0, 4)
        steps.append({"lease_years": [a, b], "annual_rent_psf": round(r.uniform(10, 80), r.choice([0, 2]))})
        a = b + 1 + (1 if r.random() < 0.1 else 0)
    table = "; ".join(f"Lease Years {s['lease_years'][0]}–{s['lease_years'][1]}: ${s['annual_rent_psf']:,.2f} per square foot"
                      for s in steps)
    written_com = com if r.random() < 0.1 else r_choice_date(com)
    pages = [f"SYNTHETIC LEASE. 1.3 The Commencement Date is {written_com}.", f"4.1 Base Rent. {table}."]
    value = [dict(s) for s in steps]
    if r.random() < 0.2:
        value[r.randrange(n)]["annual_rent_psf"] += 1
    if r.random() < 0.2:
        value[0]["lease_years"] = [value[0]["lease_years"][0], value[0]["lease_years"][1] + r.choice([0, 1])]
    cand = {"predicate": "lease.base_rent_schedule", "value": value, "quote": table, "page": 2}
    k = r.random()
    if k < 0.75:
        claimed = com if r.random() < 0.8 else (date.fromisoformat(com) + timedelta(days=1)).isoformat()
        cand["commencement"] = {"value": claimed, "quote": f"The Commencement Date is {written_com}",
                                "page": r.choice([1, 1, 1, 2])}
    if r.random() < 0.15:
        for s in value:
            s["from"], s["to"] = "2020-01-01", "2020-12-31"
    if r.random() < 0.1:
        cand["confidence"] = round(r.uniform(0.5, 1), 2)
    return pages, cand


def confirmation_case(r):
    pages = ["SYNTHETIC RETAIL LEASE. 7.1 Tenant shall continuously operate in the Premises. If Tenant ceases operating "
             "for more than 180 consecutive days, Landlord may recapture the Premises. 7.2 Controllable expenses shall "
             "not increase by more than five percent (5%) per year, compounded."]
    cands = []
    for _ in range(r.randint(1, 4)):
        k = r.random()
        if k < 0.4:
            v = {"operating_covenant": r.random() < 0.8}
            if r.random() < 0.5:
                v["recapture_right"] = True
            if r.random() < 0.5:
                v["dark_period_days"] = r.choice([180, 90])
            c = {"predicate": "lease.go_dark", "value": v, "page": 1,
                 "quote": "Tenant shall continuously operate in the Premises. If Tenant ceases operating for more than 180 "
                          "consecutive days, Landlord may recapture the Premises"}
        elif k < 0.7:
            c = {"predicate": "lease.cam_cap", "value": {"method": r.choice(["compounding_from_base", "year_over_year"]),
                                                         "rate": r.choice([0.05, 0.04])},
                 "quote": "shall not increase by more than five percent (5%) per year, compounded", "page": 1}
        else:
            c = {"predicate": "lease.radius_restriction", "value": {"radius_miles": 180}, "page": 1,
                 "quote": "for more than 180 consecutive days"}
        if r.random() < 0.7:
            conf = {"by": r.choice(["A. Reviewer", "Lease administrator (synthetic)", "J. Doe, paralegal", "agent", "  "]),
                    "at": r.choice(["2026-11-05", "2026-11-05T09:30:00Z", "2026-11-05T09:30:00+02:00", "yesterday"])}
            if r.random() < 0.3:
                conf["note"] = "read the clause"
            c["confirmation"] = conf
        if r.random() < 0.1:
            c["confidence"] = 0.6
        cands.append(c)
    return {"tool": "doc_verify_facts", "arguments": {"document": {"pages": pages}, "as_of": "2026-11-06",
                                                      "candidates": cands}}


def predicates_case(r):
    from factlot.ingest.extract import PREDICATES

    names = list(PREDICATES)
    k = r.random()
    if k < 0.5:
        p = r.choice(names)
        if r.random() < 0.3:
            i = r.randrange(len(p))
            p = p[:i] + p[i + 1:]
        return {"tool": "doc_predicates", "arguments": {"predicate": p}}
    if k < 0.9:
        p = r.choice(names)
        return {"tool": "doc_predicates", "arguments": {"prefix": p[:r.randint(1, len(p))]}}
    return {"tool": "doc_predicates", "arguments": r.choice([{}, {"predicate": "lease.go_dark", "prefix": "lease."}])}


def round4_cases(seed, count):
    import os
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python", "src"))
    import factlot

    r = random.Random(f"round4-{seed}")
    out = []
    for _ in range(count):
        k = r.random()
        if k < 0.45:
            out.append(critical_dates_case(r))
        elif k < 0.75:
            pages, cand = lease_year_case(r)
            out.append({"tool": "doc_verify_facts", "arguments": {"document": {"pages": pages}, "as_of": "2026-11-06",
                                                                  "candidates": [cand]}})
            # The verified fact, as is and with a date moved, through fact_validate and an abstract.
            res = factlot.run_tool("doc_verify_facts", out[-1]["arguments"])
            for v in res.get("verified", []):
                fact = v["fact"]
                if r.random() < 0.4:
                    fact = {**fact, "value": [{**s, "to": "2099-12-31"} for s in fact["value"]]}
                out.append({"tool": "fact_validate", "arguments": {"fact": fact}})
                out.append({"tool": "doc_abstract_lease", "arguments": {
                    "as_of": "2026-11-06", "documents": [{"role": "original", "facts": [fact],
                                                          **({"pages": pages} if r.random() < 0.5 else {})}]}})
        elif k < 0.9:
            out.append(confirmation_case(r))
            res = factlot.run_tool("doc_verify_facts", out[-1]["arguments"])
            facts = [v["fact"] for v in res.get("verified", [])]
            if facts:
                out.append({"tool": "doc_compare", "arguments": {
                    "lease_facts": facts, "asserted": [{"predicate": f["predicate"], "value": f["value"]} for f in facts]}})
                out.append({"tool": "fact_package_create", "arguments": {"facts": facts}})
        else:
            out.append(predicates_case(r))
    return out
