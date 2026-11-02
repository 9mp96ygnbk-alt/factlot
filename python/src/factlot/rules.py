"""Rules packs — Python port of @factlot/calc rules (held to spec/vectors/rules).

Each rule declares the law it implements and a verification status; results carry the
citations, and draft rules always warn.
"""

from __future__ import annotations

import copy
from datetime import date, timedelta
from typing import Any, Callable

from ._core import CalcInputError, Trace, iso_date, number, obj


def _ruled(t: Trace, meta: dict[str, Any], value: dict[str, Any]) -> dict[str, Any]:
    if meta["verification"]["status"] != "verified":
        laws = "; ".join(c["law"] for c in meta["citations"])
        t.warn(f"Rule {meta['id']}@{meta['version']} is a DRAFT: not yet verified against {laws}. "
               "Confirm with the official text or a professional before relying on it.")
    return t.result(meta["id"], meta["version"], {**value, "rule": copy.deepcopy(meta)})


# --- calendar ---------------------------------------------------------------------------------


def _nth_weekday(year: int, month: int, dow_js: int, n: int) -> date:
    """dow_js: 0 = Sunday … 6 = Saturday (JavaScript convention, to mirror the TS code)."""
    first = date(year, month, 1)
    first_js = (first.weekday() + 1) % 7
    return first + timedelta(days=(dow_js - first_js) % 7 + 7 * (n - 1))


def _last_weekday(year: int, month: int, dow_js: int) -> date:
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    last = nxt - timedelta(days=1)
    last_js = (last.weekday() + 1) % 7
    return last - timedelta(days=(last_js - dow_js) % 7)


def texas_holidays(year: int) -> dict[str, str]:
    """Texas legal holidays on their actual dates (Gov't Code §662.003); see the TS docs for scope."""
    thanksgiving = _nth_weekday(year, 11, 4, 4)
    days = [
        (date(year, 1, 1), "New Year's Day"),
        (date(year, 1, 19), "Confederate Heroes Day"),
        (_nth_weekday(year, 1, 1, 3), "Martin Luther King, Jr., Day"),
        (_nth_weekday(year, 2, 1, 3), "Presidents' Day"),
        (date(year, 3, 2), "Texas Independence Day"),
        (date(year, 4, 21), "San Jacinto Day"),
        (_last_weekday(year, 5, 1), "Memorial Day"),
        (date(year, 6, 19), "Emancipation Day (Juneteenth)"),
        (date(year, 7, 4), "Independence Day"),
        (date(year, 8, 27), "Lyndon Baines Johnson Day"),
        (_nth_weekday(year, 9, 1, 1), "Labor Day"),
        (date(year, 11, 11), "Veterans Day"),
        (thanksgiving, "Thanksgiving Day"),
        (thanksgiving + timedelta(days=1), "Day after Thanksgiving"),
        (date(year, 12, 24), "Christmas Eve"),
        (date(year, 12, 25), "Christmas Day"),
        (date(year, 12, 26), "Day after Christmas"),
    ]
    out: dict[str, str] = {}
    for d, name in days:
        out.setdefault(d.isoformat(), name)
    return out


def _non_business(iso: str) -> str | None:
    d = date.fromisoformat(iso)
    if d.weekday() == 5:
        return "Saturday"
    if d.weekday() == 6:
        return "Sunday"
    return texas_holidays(d.year).get(iso)


def _add(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


# --- Texas: property tax protest deadline ------------------------------------------------------

TX_PROTEST_DEADLINE: dict[str, Any] = {
    "id": "rules.tx.property_tax_protest_deadline",
    "version": 1,
    "jurisdiction": "us-tx",
    "title": "Texas property tax protest deadline",
    "citations": [
        {"law": "Tex. Tax Code §41.44(a)(1)", "url": "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm#41.44"},
        {"law": "Tex. Tax Code §1.06", "url": "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.1.htm#1.06"},
        {"law": "Tex. Gov't Code §662.003", "url": "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.662.htm#662.003"},
    ],
    "verification": {
        "status": "verified",
        "verified_by": "FactLot maintainers",
        "verified_at": "2026-11-02",
        "notes": (
            "Checked against the official text at statutes.capitol.texas.gov on 2026-11-02: §41.44(a)(1) (the later "
            "of May 15 and the 30th day after the notice was delivered), §1.06 as amended by H.B. 1392 eff. "
            "2026-01-01 (an act is timely on the next regular business day when the last day is a Saturday, Sunday, "
            "or legal state or national holiday), and §662.003(a)-(b) (the holiday list; §662.003(c) optional "
            "holidays are not legal holidays). Covers the general deadline only. Not covered: §41.44(a)(2)-(5), "
            "§25.25 corrections, late-protest relief under §41.44(b)-(c-3), and county-specific practice. "
            "'Delivered' follows §1.07(c): a mailed notice is presumed delivered when deposited in the mail."
        ),
    },
}


def tx_property_tax_protest_deadline(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    year = number(d, "tax_year", integer=True, ge=2000, le=2100)
    notice = iso_date(d, "notice_delivered_date") if d.get("notice_delivered_date") is not None else None
    t = Trace()
    may15 = date(year, 5, 15).isoformat()
    unadjusted, basis = may15, "may_15"
    t.step("May 15 of the tax year", may15, "§41.44(a)(1)")
    if notice:
        if int(notice[:4]) != year:
            raise CalcInputError(f"notice_delivered_date {notice} is not in tax year {year}")
        plus30 = _add(notice, 30)
        t.step("30th day after notice delivered", plus30, f"{notice} + 30 days")
        if plus30 > may15:
            unadjusted, basis = plus30, "30_days_after_notice"
    else:
        t.warn("No notice delivery date given: if the notice was delivered after April 15, the deadline is later than May 15.")
    t.step("Unadjusted deadline", unadjusted, "later of the two dates")
    deadline, skipped = unadjusted, []
    while (reason := _non_business(deadline)) is not None:
        skipped.append({"date": deadline, "reason": reason})
        deadline = _add(deadline, 1)
    t.step("Deadline", deadline,
           ("rolled past " + ", ".join(f"{s['date']} ({s['reason']})" for s in skipped) + " per §1.06") if skipped
           else "no rollover needed")
    safe = unadjusted
    while _non_business(safe):
        safe = _add(safe, -1)
    t.step("Recommended file-by date", safe, "latest business day on or before the unadjusted deadline")
    if skipped:
        t.warn(f"Filing by {safe} avoids relying on the weekend/holiday rollover.")
    return _ruled(t, TX_PROTEST_DEADLINE, {
        "deadline": deadline,
        "unadjusted_deadline": unadjusted,
        "governing_basis": basis,
        "recommended_file_by": safe,
        "skipped_non_business_days": skipped,
    })


#: name -> (function, rule id, version). Names match the TypeScript `rulePacks` registry.
RULES: dict[str, tuple[Callable[[Any], dict[str, Any]], str, int]] = {
    "tx_property_tax_protest_deadline": (tx_property_tax_protest_deadline, TX_PROTEST_DEADLINE["id"],
                                         TX_PROTEST_DEADLINE["version"]),
}

__all__ = ["RULES", "TX_PROTEST_DEADLINE", "texas_holidays", "tx_property_tax_protest_deadline"]
