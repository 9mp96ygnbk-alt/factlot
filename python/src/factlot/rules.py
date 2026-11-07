"""Rules packs — Python port of @factlot/calc rules (held to spec/vectors/rules).

Each rule declares the law it implements and a verification status; results carry the
citations, and draft rules always warn.
"""

from __future__ import annotations

import copy
import re
from datetime import date, datetime, timedelta, timezone
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


def non_business_reason(iso: str) -> str | None:
    """Why ``iso`` (YYYY-MM-DD) is not a Texas business day: "Saturday", "Sunday", or the holiday's name, else None
    (``nonBusinessReason`` in @factlot/calc)."""
    return _non_business(iso)


def _add(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


# --- Texas: property tax protest deadline ------------------------------------------------------

TX_PROTEST_DEADLINE: dict[str, Any] = {
    "id": "rules.tx.property_tax_protest_deadline",
    "version": 2,
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


def tx_protest_deadline_disclaimer(checked_on: str) -> str:
    """The disclaimer every protest-deadline result carries, dated by the rule's verification date."""
    return (
        f"Information about a statutory deadline computed from the statute text as checked on {checked_on}: "
        "not legal or tax advice and not a substitute for the advice of an attorney. Confirm the date on the "
        "notice you received and with the appraisal district."
    )


#: The ``notes`` entry every protest-deadline result carries.
TX_PROTEST_DEADLINE_NOT_COVERED = (
    "The rule does not cover late protests, the other protest deadlines of §41.44(a)(2)-(5), or motions to correct "
    "the appraisal roll; see Tax Code §41.44(b)-(c-3) and §25.25."
)
#: The ``notes`` entry added when ``next_season`` is given.
TX_PROTEST_NEXT_SEASON_NOTE = (
    "next_season is computed with no notice delivery date (May 15 basis): if that tax year's notice of appraised "
    "value is delivered after April 15, its deadline is later than May 15."
)


def texas_today(now: datetime | None = None) -> str:
    """Today's date in US Central time (``texasToday`` in TS): UTC-5 from the second Sunday of March at 08:00 UTC
    until the first Sunday of November at 07:00 UTC, UTC-6 otherwise; no time-zone database, so both SDKs agree."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    y = now.year
    start = datetime.combine(_nth_weekday(y, 3, 0, 2), datetime.min.time(), timezone.utc) + timedelta(hours=8)
    end = datetime.combine(_nth_weekday(y, 11, 0, 1), datetime.min.time(), timezone.utc) + timedelta(hours=7)
    offset = 5 if start <= now < end else 6
    return (now - timedelta(hours=offset)).date().isoformat()


def _rollover(unadjusted: str) -> tuple[str, list[dict[str, str]], str]:
    """The deadline after §1.06 rollover, the days skipped, and the conservative file-by date (``rollover`` in TS)."""
    deadline, skipped = unadjusted, []
    while (reason := _non_business(deadline)) is not None:
        skipped.append({"date": deadline, "reason": reason})
        deadline = _add(deadline, 1)
    safe = unadjusted
    while _non_business(safe):
        safe = _add(safe, -1)
    return deadline, skipped, safe


def tx_property_tax_protest_deadline(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    year = number(d, "tax_year", integer=True, ge=2000, le=2100)
    notice = iso_date(d, "notice_delivered_date") if d.get("notice_delivered_date") is not None else None
    as_of_in = iso_date(d, "as_of") if d.get("as_of") is not None else None
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
    t.step("Unadjusted deadline", unadjusted, "later of the two dates")
    deadline, skipped, safe = _rollover(unadjusted)
    t.step("Deadline", deadline,
           ("rolled past " + ", ".join(f"{s['date']} ({s['reason']})" for s in skipped) + " per §1.06") if skipped
           else "no rollover needed")
    t.step("Conservative file-by date", safe, "latest business day on or before the unadjusted deadline")
    as_of = as_of_in if as_of_in is not None else texas_today()
    t.step("As of", as_of, "current date in US Central time (as_of not given)" if as_of_in is None else "as_of given")
    year_start = date(year, 1, 1).isoformat()
    status = "passed" if as_of > deadline else "not_yet_open" if as_of < year_start else "open"
    t.step("Status", status,
           f"{as_of} is after the deadline {deadline}" if status == "passed" else
           f"{as_of} is before January 1 of tax year {year}" if status == "not_yet_open" else
           f"{as_of} is on or after {year_start} and on or before the deadline {deadline}")
    days_remaining = None if status == "passed" else (date.fromisoformat(deadline) - date.fromisoformat(as_of)).days
    if days_remaining is not None:
        t.step("Days remaining", days_remaining, f"{as_of} to {deadline}", "days")
    next_season = None
    if status == "passed":
        next_deadline, _skipped, next_safe = _rollover(date(year + 1, 5, 15).isoformat())
        next_season = {"tax_year": year + 1, "deadline": next_deadline, "conservative_file_by": next_safe,
                       "basis": "may_15"}
        t.step("Next season deadline", next_deadline, f"tax year {year + 1}, May 15 basis (no notice date)")
    if not notice and status != "passed":
        t.warn("No notice delivery date given: if the notice was delivered after April 15, the deadline is later than May 15.")
    if skipped:
        t.warn(f"{safe} is the last business day on or before the unadjusted date {unadjusted}; "
               f"the statutory deadline is {deadline} under §1.06.")
    return _ruled(t, TX_PROTEST_DEADLINE, {
        "deadline": deadline,
        "unadjusted_deadline": unadjusted,
        "governing_basis": basis,
        "conservative_file_by": safe,
        "skipped_non_business_days": skipped,
        "as_of": as_of,
        "status": status,
        "days_remaining": days_remaining,
        "next_season": next_season,
        "notes": [TX_PROTEST_DEADLINE_NOT_COVERED, *([TX_PROTEST_NEXT_SEASON_NOTE] if next_season else [])],
        "disclaimer": tx_protest_deadline_disclaimer(
            TX_PROTEST_DEADLINE["verification"].get("verified_at") or "an unrecorded date"),
    })


# --- Texas: protest deadlines for many notices at once ---------------------------------------

#: The batch's own formula identity; every item is answered under TX_PROTEST_DEADLINE (@2).
TX_PROTEST_DEADLINE_BATCH: dict[str, Any] = {
    **copy.deepcopy(TX_PROTEST_DEADLINE),
    "id": "rules.tx.property_tax_protest_deadline_batch",
    "version": 1,
    "title": "Texas property tax protest deadlines (batch)",
}
TX_PROTEST_DEADLINE_BATCH_MAX_ITEMS = 200
_TAX_YEAR_ISSUE = "expected an integer from 2000 to 2100"
_DATE_ISSUE = "expected a valid YYYY-MM-DD date"
_ASCII_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _valid_date(v: Any) -> bool:
    """A YYYY-MM-DD string naming a real calendar day (``validDate`` in TS)."""
    if not isinstance(v, str) or not _ASCII_DATE.fullmatch(v):
        return False
    try:
        date(int(v[:4]), int(v[5:7]), int(v[8:]))
    except ValueError:
        return False
    return True


def _batch_items(raw: Any) -> list[dict[str, Any]]:
    """The items of a batch call, checked as ``TxProtestDeadlineBatchInput`` checks them (same issue paths)."""
    if not isinstance(raw, dict):
        raise CalcInputError("invalid input: (root): expected object", [{"path": "", "message": "expected object"}])
    items = raw.get("items")

    def fail(issues: list[dict[str, str]]) -> None:
        raise CalcInputError("invalid input: " + "; ".join(f"{i['path']}: {i['message']}" for i in issues), issues)

    if not isinstance(items, list):
        fail([{"path": "items", "message": "expected array"}])
    if not 1 <= len(items) <= TX_PROTEST_DEADLINE_BATCH_MAX_ITEMS:
        fail([{"path": "items", "message": f"expected 1 to {TX_PROTEST_DEADLINE_BATCH_MAX_ITEMS} items"}])
    issues: list[dict[str, str]] = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            issues.append({"path": f"items.{i}", "message": "expected object"})
        else:
            if not isinstance(item.get("id"), str) or not 1 <= len(item["id"]) <= 200:
                issues.append({"path": f"items.{i}.id", "message": "expected a string of 1 to 200 characters"})
            if "tax_year" not in item:  # a present but invalid tax_year is the item's own error
                issues.append({"path": f"items.{i}.tax_year", "message": "required"})
    if not issues:
        seen: set[str] = set()
        for i, item in enumerate(items):
            if item["id"] in seen:
                issues.append({"path": f"items.{i}.id", "message": f'duplicate id "{item["id"]}"'})
            seen.add(item["id"])
    if issues:
        fail(issues)
    return items


def _batch_item(item: dict[str, Any], as_of: str) -> dict[str, Any]:
    """One item's deadline, or its input error (``batchItem`` in TS)."""
    issues = []
    year = item.get("tax_year")
    if (isinstance(year, bool) or not isinstance(year, (int, float))
            or (isinstance(year, float) and not year.is_integer()) or not 2000 <= year <= 2100):
        issues.append({"path": "tax_year", "message": _TAX_YEAR_ISSUE})
    notice = item.get("notice_delivered_date")
    if notice is not None and not _valid_date(notice):
        issues.append({"path": "notice_delivered_date", "message": _DATE_ISSUE})
    if issues:
        return {"id": item["id"], "error": {
            "error": "CalcInputError",
            "message": "invalid input: " + "; ".join(f"{i['path']}: {i['message']}" for i in issues),
            "issues": issues}}
    try:
        r = tx_property_tax_protest_deadline({"tax_year": int(year), "as_of": as_of,
                                              **({} if notice is None else {"notice_delivered_date": notice})})
    except CalcInputError as e:
        return {"id": item["id"], "error": {"error": "CalcInputError", "message": str(e), "issues": e.issues}}
    fields = {k: v for k, v in r["value"].items() if k not in ("rule", "disclaimer", "notes", "as_of")}
    return {"id": item["id"], **fields, "warnings": r["warnings"]}


def tx_property_tax_protest_deadline_batch(raw: Any) -> dict[str, Any]:
    """Protest deadlines for many notices in one call (``txProtestDeadlineBatch`` in TS): each item answered by
    ``tx_property_tax_protest_deadline`` exactly as a single call, an item with bad input carrying its error."""
    items = _batch_items(raw)
    as_of_in = iso_date(raw, "as_of") if raw.get("as_of") is not None else None
    as_of = as_of_in if as_of_in is not None else texas_today()
    t = Trace()
    results = [_batch_item(item, as_of) for item in items]
    answered = [r for r in results if "error" not in r]
    counts: dict[str, int] = {}
    for r in answered:
        counts[r["deadline"]] = counts.get(r["deadline"], 0) + 1
    by_deadline = [{"deadline": d, "count": counts[d]} for d in sorted(counts)]
    errors = len(results) - len(answered)
    t.step("Items", len(results), "notices given")
    t.step("Deadlines computed", len(answered),
           f"{TX_PROTEST_DEADLINE['id']}@{TX_PROTEST_DEADLINE['version']} for each item")
    t.step("Items with an input error", errors, "results[i].error")
    earliest = by_deadline[0]["deadline"] if by_deadline else None
    latest = by_deadline[-1]["deadline"] if by_deadline else None
    if earliest is not None:
        t.step("Earliest deadline", earliest, "earliest answered deadline")
        t.step("Latest deadline", latest, "latest answered deadline")
    t.step("As of", as_of, "current date in US Central time (as_of not given)" if as_of_in is None else "as_of given")
    by_status = {"open": 0, "passed": 0, "not_yet_open": 0}
    for r in answered:
        by_status[r["status"]] += 1
    if errors:
        t.warn(f"{errors} of {len(results)} items have an input error (results[i].error) and no deadline; "
               "the other items are answered.")
    warned = [r["id"] for r in answered if r["warnings"]]
    if warned:
        more = f" and {len(warned) - 10} more" if len(warned) > 10 else ""
        t.warn(f"Results for {', '.join(warned[:10])}{more} carry warnings (results[i].warnings); "
               "relay them with each deadline.")
    if TX_PROTEST_DEADLINE["verification"]["status"] != "verified":
        laws = "; ".join(c["law"] for c in TX_PROTEST_DEADLINE["citations"])
        t.warn(f"Rule {TX_PROTEST_DEADLINE['id']}@{TX_PROTEST_DEADLINE['version']} is a DRAFT: not yet verified "
               f"against {laws}. Confirm with the official text or a professional before relying on it.")
    return t.result(TX_PROTEST_DEADLINE_BATCH["id"], TX_PROTEST_DEADLINE_BATCH["version"], {
        "results": results,
        "summary": {"items": len(results), "answered": len(answered), "errors": errors, "by_deadline": by_deadline,
                    "earliest": earliest, "latest": latest, "by_status": by_status},
        "as_of": as_of,
        "notes": [TX_PROTEST_DEADLINE_NOT_COVERED,
                  *([TX_PROTEST_NEXT_SEASON_NOTE] if any(r["next_season"] is not None for r in answered) else [])],
        "disclaimer": tx_protest_deadline_disclaimer(
            TX_PROTEST_DEADLINE["verification"].get("verified_at") or "an unrecorded date"),
        "rule": copy.deepcopy(TX_PROTEST_DEADLINE),
    })


#: name -> (function, rule id, version). Names match the TypeScript `rulePacks` registry.
RULES: dict[str, tuple[Callable[[Any], dict[str, Any]], str, int]] = {
    "tx_property_tax_protest_deadline": (tx_property_tax_protest_deadline, TX_PROTEST_DEADLINE["id"],
                                         TX_PROTEST_DEADLINE["version"]),
    "tx_property_tax_protest_deadline_batch": (tx_property_tax_protest_deadline_batch,
                                               TX_PROTEST_DEADLINE_BATCH["id"], TX_PROTEST_DEADLINE_BATCH["version"]),
}

__all__ = [
    "RULES",
    "TX_PROTEST_DEADLINE",
    "TX_PROTEST_DEADLINE_BATCH",
    "TX_PROTEST_DEADLINE_NOT_COVERED",
    "TX_PROTEST_NEXT_SEASON_NOTE",
    "texas_holidays",
    "texas_today",
    "tx_property_tax_protest_deadline",
    "tx_property_tax_protest_deadline_batch",
    "tx_protest_deadline_disclaimer",
]
