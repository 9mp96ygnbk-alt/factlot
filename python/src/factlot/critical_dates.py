"""Lease critical dates (``calc.critical_dates@1``): notice deadlines and option windows from a
lease's expiration date and options. Python port of packages/calc/src/critical_dates.ts, held to
spec/vectors/calc/critical_dates.json and the differential test."""

from __future__ import annotations

from datetime import date
from typing import Any

from ._core import Trace, array, enum, fail, iso_date, join, number, obj, string
from .dates import add_days, add_months, days_between
from .rules import _last_weekday, _nth_weekday

Result = dict[str, Any]

_DEADLINES = ("renewal_notice_deadline", "termination_notice_deadline", "expansion_option_deadline", "deadline")
#: First year the holiday list below matches 5 U.S.C. §6103(a) (Martin Luther King, Jr. Day).
US_FEDERAL_HOLIDAYS_FROM = 1986

_CONVENTIONS = [
    "Months are calendar months: N months before a date is the same day of the month N months earlier, or that "
    "month's last day when it is shorter (August 31 − 6 months = February 28 or 29). A month-end date is not moved to "
    "the target month's end; when that reading would give a later date, a warning says so.",
    'Notice "no later than N months (or days) before" a date is due on that date minus N months (or days): the '
    "deadline is the last day notice may be given.",
    "A renewal term starts the day after the expiration in effect and ends the day before the same day of the month "
    "term_months later; each later option counts back from the end of the term before it.",
    "Deadlines that fall on a weekend or holiday are flagged and not moved unless business_day_roll says so; windows "
    "that open and the lease's own dates (expiration, terms, effective dates) are never moved.",
    "Holidays: the US federal holidays of 5 U.S.C. §6103(a) with their observed days (Saturday: the Friday before; "
    "Sunday: the Monday after), not state, bank or local holidays; the lease's definition of business day controls.",
    "Not legal advice: confirm each deadline against the lease's notice clause (how notice is given and when it is "
    "deemed received).",
]


def _weekday(iso: str) -> int:
    """0 = Sunday … 6 = Saturday (JavaScript's getUTCDay)."""
    return (date.fromisoformat(iso).weekday() + 1) % 7


def us_federal_holidays(year: int) -> dict[str, str]:
    """US federal holidays (5 U.S.C. §6103(a)) of one year on their actual dates, plus the observed day
    of each that falls on a weekend (Saturday: the Friday before; Sunday: the Monday after). Juneteenth
    from 2021; Inauguration Day is not included (critical_dates.ts ``usFederalHolidays``)."""
    days = [
        (date(year, 1, 1).isoformat(), "New Year's Day"),
        (_nth_weekday(year, 1, 1, 3).isoformat(), "Birthday of Martin Luther King, Jr."),
        (_nth_weekday(year, 2, 1, 3).isoformat(), "Washington's Birthday"),
        (_last_weekday(year, 5, 1).isoformat(), "Memorial Day"),
        *([(date(year, 6, 19).isoformat(), "Juneteenth National Independence Day")] if year >= 2021 else []),
        (date(year, 7, 4).isoformat(), "Independence Day"),
        (_nth_weekday(year, 9, 1, 1).isoformat(), "Labor Day"),
        (_nth_weekday(year, 10, 1, 2).isoformat(), "Columbus Day"),
        (date(year, 11, 11).isoformat(), "Veterans Day"),
        (_nth_weekday(year, 11, 4, 4).isoformat(), "Thanksgiving Day"),
        (date(year, 12, 25).isoformat(), "Christmas Day"),
    ]
    out: dict[str, str] = {}
    for d, name in days:
        out[d] = name
        dow = _weekday(d)
        if dow == 6:
            out[add_days(d, -1)] = f"{name} (observed)"
        if dow == 0:
            out[add_days(d, 1)] = f"{name} (observed)"
    return out


def _month_end(iso: str) -> str:
    return add_days(add_months(iso[:8] + "01", 1), -1)


def _opt_date(d: dict[str, Any], key: str, path: str = "") -> str | None:
    return None if d.get(key) is None else iso_date(d, key, path)


def _notice(d: dict[str, Any], path: str, window: bool) -> dict[str, Any]:
    out = {"notice_months": number(d, "notice_months", path, optional=True, integer=True, ge=0, le=120),
           "notice_days": number(d, "notice_days", path, optional=True, integer=True, ge=0, le=3650),
           "notice_window": None}
    if window and d.get("notice_window") is not None:
        wp = join(path, "notice_window")
        w = obj(d["notice_window"], wp)
        earliest = number(w, "earliest_months_before", wp, integer=True, ge=1, le=120)
        latest = number(w, "latest_months_before", wp, integer=True, ge=0, le=120)
        if not earliest > latest:
            fail(join(wp, "earliest_months_before"), "earliest_months_before must be greater than latest_months_before")
        out["notice_window"] = {"earliest_months_before": earliest, "latest_months_before": latest}
    if sum(x is not None for x in out.values()) != 1:
        fail(path, "give exactly one of notice_months, notice_days or notice_window" if window
             else "give exactly one of notice_months or notice_days")
    return out


def _parse(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    v: dict[str, Any] = {
        "expiration_date": iso_date(d, "expiration_date"),
        "commencement_date": _opt_date(d, "commencement_date"),
        "as_of": _opt_date(d, "as_of"),
        "renewal_option": None,
    }
    if d.get("renewal_option") is not None:
        r = obj(d["renewal_option"], "renewal_option")
        v["renewal_option"] = {"count": number(r, "count", "renewal_option", integer=True, ge=1, le=10),
                               "term_months": number(r, "term_months", "renewal_option", integer=True, ge=1, le=600),
                               **_notice(r, "renewal_option", True)}
    v["termination_options"] = []
    for i, x in enumerate(array(d, "termination_options", default=[], max_len=20)):
        p = join("termination_options", i)
        x = obj(x, p)
        v["termination_options"].append({"effective_date": iso_date(x, "effective_date", p), **_notice(x, p, False),
                                         "label": string(x, "label", p, optional=True, min_len=1, max_len=200)})
    v["expansion_option_deadline"] = _opt_date(d, "expansion_option_deadline")
    v["other_deadlines"] = []
    for i, x in enumerate(array(d, "other_deadlines", default=[], max_len=50)):
        p = join("other_deadlines", i)
        x = obj(x, p)
        o = {"label": string(x, "label", p, min_len=1, max_len=200), "date": _opt_date(x, "date", p),
             "from_date": _opt_date(x, "from_date", p),
             "days_after": number(x, "days_after", p, optional=True, integer=True, ge=0, le=3650)}
        ok = (o["from_date"] is None and o["days_after"] is None) if o["date"] is not None else \
            (o["from_date"] is not None and o["days_after"] is not None)
        if not ok:
            fail(p, "give date, or from_date with days_after")
        v["other_deadlines"].append(o)
    v["business_day_roll"] = enum(d, "business_day_roll", ("none", "preceding", "following"), default="none")
    v["holidays"] = enum(d, "holidays", ("us_federal", "none"), default="us_federal")
    if v["commencement_date"] is not None and v["commencement_date"] >= v["expiration_date"]:
        fail("commencement_date", "must be before expiration_date")
    for i, o in enumerate(v["termination_options"]):
        if o["effective_date"] > v["expiration_date"]:
            fail(join(join("termination_options", i), "effective_date"), "must not be after expiration_date")
    return v


def critical_dates(raw: Any) -> Result:
    v = _parse(raw)
    t = Trace()
    roll = v["business_day_roll"]
    as_of = v["as_of"]
    events: list[dict[str, Any]] = []
    early = [False]

    def non_business(iso: str) -> str | None:
        dow = _weekday(iso)
        if dow == 6:
            return "Saturday"
        if dow == 0:
            return "Sunday"
        if v["holidays"] == "none":
            return None
        year = int(iso[:4])
        if year < US_FEDERAL_HOLIDAYS_FROM:
            early[0] = True
            return None
        # A New Year's Day on a Saturday is observed on December 31 of the year before.
        hit = us_federal_holidays(year).get(iso)
        if hit is None and iso.endswith("-12-31"):
            hit = us_federal_holidays(year + 1).get(iso)
        return hit

    def business_day(iso: str, step: int) -> str:
        d = add_days(iso, step)
        while non_business(d):
            d = add_days(d, step)
        return d

    def months_before(frm: str, months: int, what: str) -> str:
        d = add_months(frm, -months)
        if frm == _month_end(frm) and d != _month_end(d):
            t.warn(f"{what}: {frm} is the last day of its month and FactLot keeps the day of month, giving {d}. Read "
                   f"month-end to month-end it would be {_month_end(d)}, which is later; FactLot gives the earlier date.")
        return d

    def add(iso: str, kind: str, label: str, option: int | None = None) -> dict[str, Any]:
        e: dict[str, Any] = {"date": iso, "kind": kind, "label": label}
        if option is not None:
            e["option"] = option
        if kind in _DEADLINES:
            why = non_business(iso)
            if why and roll == "none":
                e["non_business_day"] = why
                t.warn(f"{label} falls on {iso}, not a business day ({why}). FactLot did not move it (business_day_roll none); the "
                       "lease's business-day clause decides whether it moves.")
            elif why:
                d = business_day(iso, -1 if roll == "preceding" else 1)
                e["date"] = d
                e["unadjusted_date"] = iso
                e["rolled_because"] = why
                t.step(f"{label}: rolled to a business day", d, f"{iso} is not a business day ({why}); business_day_roll {roll}")
                if roll == "following":
                    t.warn(f"{label} was moved later, from {iso} to {d}. Only a lease clause that extends a deadline "
                           "falling on a non-business day allows that; the preceding business day, "
                           f"{business_day(iso, -1)}, is safe either way.")
        if as_of is not None:
            e["days_from_as_of"] = days_between(as_of, e["date"])
        events.append(e)
        return e

    if v["commencement_date"] is not None:
        add(v["commencement_date"], "commencement", "Commencement date")
    add(t.step("Expiration date", v["expiration_date"], "as given"), "expiration", "Expiration date")

    renewal_terms: list[dict[str, Any]] = []
    ro = v["renewal_option"]
    if ro is not None:
        first_start = add_days(v["expiration_date"], 1)
        current = v["expiration_date"]
        for k in range(1, ro["count"] + 1):
            name = f"Renewal option {k}"
            opens = None
            if ro["notice_window"] is not None:
                w = ro["notice_window"]
                opens = t.step(f"{name}: notice window opens", months_before(current, w["earliest_months_before"], name),
                               f"{current} − {w['earliest_months_before']} months")
                deadline = t.step(f"{name}: last day to give notice",
                                  months_before(current, w["latest_months_before"], name),
                                  f"{current} − {w['latest_months_before']} months")
            elif ro["notice_months"] is not None:
                deadline = t.step(f"{name}: last day to give notice", months_before(current, ro["notice_months"], name),
                                  f"{current} − {ro['notice_months']} months (same day of month, clamped to the month's "
                                  "last day)")
            else:
                deadline = t.step(f"{name}: last day to give notice", add_days(current, -ro["notice_days"]),
                                  f"{current} − {ro['notice_days']} days")
            start = add_days(current, 1)
            end = t.step(f"{name}: renewal term ends", add_days(add_months(first_start, k * ro["term_months"]), -1),
                         f"{first_start} + {k} × {ro['term_months']} months − 1 day")
            if opens is not None:
                add(opens, "renewal_window_opens", f"{name}: notice window opens", k)
            de = add(deadline, "renewal_notice_deadline", f"{name}: last day to give notice", k)
            add(end, "renewal_term_ends", f"{name}: renewal term ends", k)
            term: dict[str, Any] = {"option": k}
            if opens is not None:
                term["window_opens"] = opens
            term.update({"notice_deadline": de["date"], "term_start": start, "term_end": end})
            renewal_terms.append(term)
            current = end
        if ro["count"] > 1:
            t.warn("Renewal options after the first assume every earlier option was exercised: each notice counts back "
                   "from the expiration of the term before it.")

    terminations: list[dict[str, Any]] = []
    for i, o in enumerate(v["termination_options"]):
        name = o["label"] if o["label"] is not None else f"Termination option {i + 1}"
        if o["notice_months"] is not None:
            deadline = t.step(f"{name}: last day to give notice",
                              months_before(o["effective_date"], o["notice_months"], name),
                              f"{o['effective_date']} − {o['notice_months']} months (same day of month, clamped to the "
                              "month's last day)")
        else:
            deadline = t.step(f"{name}: last day to give notice", add_days(o["effective_date"], -o["notice_days"]),
                              f"{o['effective_date']} − {o['notice_days']} days")
        de = add(deadline, "termination_notice_deadline", f"{name}: last day to give notice", i + 1)
        add(o["effective_date"], "termination_effective", f"{name}: effective date", i + 1)
        terminations.append({"option": i + 1, "effective_date": o["effective_date"], "notice_deadline": de["date"]})

    if v["expansion_option_deadline"] is not None:
        add(v["expansion_option_deadline"], "expansion_option_deadline", "Expansion option deadline")
    for o in v["other_deadlines"]:
        d = o["date"] if o["date"] is not None else t.step(
            o["label"], add_days(o["from_date"], o["days_after"]), f"{o['from_date']} + {o['days_after']} days")
        add(d, "deadline", o["label"])

    if early[0]:
        t.warn(f"The US federal holiday calendar here starts in {US_FEDERAL_HOLIDAYS_FROM}; earlier dates were checked "
               "for weekends only.")
    # Stable: events on one date keep the order they were added in.
    events.sort(key=lambda e: e["date"])
    nxt = None
    if as_of is not None:
        for e in events:
            if e["kind"] in _DEADLINES and e["date"] < as_of:
                t.warn(f"{e['label']} ({e['date']}) is before as_of {as_of}: it has passed.")
        nxt = next((e for e in events if e["kind"] in _DEADLINES and e["date"] >= as_of), None)
        if nxt is not None:
            t.step("Next deadline", nxt["date"], f"{nxt['label']}, {nxt['days_from_as_of']} days after {as_of}")

    return t.result("calc.critical_dates", 1, {
        "as_of": as_of, "business_day_roll": roll, "holidays": v["holidays"], "events": events,
        "next_deadline": nxt, "renewal_terms": renewal_terms, "termination_options": terminations,
        "conventions": list(_CONVENTIONS)})
