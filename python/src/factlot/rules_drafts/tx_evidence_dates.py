"""DRAFT: Texas protest evidence dates before an appraisal review board hearing (Tax Code §41.43(a-1), (a-3)(3),
§41.461(a), §41.67(d)).

Mirror of packages/calc/src/rules-drafts/tx-evidence-dates.ts, held to spec/vectors/rules/drafts. The holiday logic is
the verified deadline rule's (factlot.rules). Not verified: see docs/rules/tx-protest-evidence-dates.md.
"""

from __future__ import annotations

from typing import Any

from .._core import Trace, iso_date, obj
from ..dates import add_days
from ..rules import non_business_reason
from ._draft import draft_result, strict

_TX41 = "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm"
_RETRIEVED = "2026-11-06"

META: dict[str, Any] = {
    "id": "rules.tx.protest_evidence_dates",
    "version": 1,
    "jurisdiction": "us-tx",
    "title": "Texas protest evidence dates before an appraisal review board hearing",
    "citations": [
        {"law": "Tex. Tax Code §41.43(a-3)(3)", "url": f"{_TX41}#41.43", "retrieved": _RETRIEVED,
         "covers": "owner_evidence_by_unadjusted: the owner files with the appraisal review board and delivers to the "
                   "chief appraiser, not later than the 14th day before the date of the first day of the hearing, "
                   "information sufficient for the clear-and-convincing standard of (a-3)"},
        {"law": "Tex. Tax Code §41.43(a-1)", "url": f"{_TX41}#41.43", "retrieved": _RETRIEVED,
         "covers": "owner_evidence_by_unadjusted: for property of $1 million or less, the certified appraisal is "
                   "delivered to the chief appraiser not later than the 14th day before the date of the first day of "
                   "the hearing (the 180-day appraisal date is not computed)"},
        {"law": "Tex. Tax Code §41.43(a-5)", "url": f"{_TX41}#41.43", "retrieved": _RETRIEVED,
         "covers": "the (a-3)(3) filing is a condition for the higher standard, not a duty of the owner"},
        {"law": "Tex. Tax Code §41.461(a)", "url": f"{_TX41}#41.461", "retrieved": _RETRIEVED,
         "covers": "district_evidence_due: at least 14 days before a hearing the chief appraiser informs the owner of "
                   "the right to request the data, schedules, formulas and other information the chief appraiser will "
                   "introduce"},
        {"law": "Tex. Tax Code §41.67(d)", "url": f"{_TX41}#41.67", "retrieved": _RETRIEVED,
         "covers": "district_evidence_due: information requested under §41.461 and not delivered at least 14 days "
                   "before the scheduled or postponed hearing may not be used as evidence, except to rebut"},
        {"law": "Tex. Tax Code §1.06", "url": "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.1.htm#1.06",
         "retrieved": _RETRIEVED,
         "covers": "owner_evidence_recommended_by: the weekend and holiday rule for a last day; whether it moves a "
                   "'not later than the 14th day before' date is not settled here, so the date is rolled back, not "
                   "forward"},
        {"law": "Tex. Gov't Code §662.003", "url": "https://statutes.capitol.texas.gov/Docs/GV/htm/GV.662.htm#662.003",
         "retrieved": _RETRIEVED,
         "covers": "owner_evidence_recommended_by: the Texas legal holidays skipped, on their actual dates, as in "
                   "rules.tx.property_tax_protest_deadline"},
    ],
    "verification": {
        "status": "draft",
        "notes": (
            "Drafted from the official text of Tax Code §§1.06, 41.43, 41.461, 41.66 and 41.67, read on 2026-11-06 from "
            "the files behind statutes.capitol.texas.gov. Not checked by a named maintainer. Open point for the "
            "verifier: whether §1.06 moves a 'not later than the 14th day before' date that falls on a weekend or "
            "holiday; the pack returns the unadjusted date and a date rolled back to the previous business day, which "
            "is timely either way."
        ),
    },
    "not_covered": [
        "the §41.43(a-1) appraisal date: the appraisal must be 'performed not later than the 180th day before the date "
        "of the first day of the hearing', which can be read as a latest date or as a window, so no date is computed",
        "§41.66(a): the copy of the appraisal review board's hearing procedures, delivered on request not later than "
        "the 10th day before the hearing",
        "county and appraisal review board practice: local procedures, evidence portals and exchange rules",
        "postponements and rescheduled hearings (including §41.66(h)): rerun with the new first day of the hearing",
    ],
}


def tx_protest_evidence_dates(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    strict(d, ("hearing_date",))
    hearing = iso_date(d, "hearing_date")

    t = Trace()
    t.step("First day of the hearing", hearing, "as given")
    hearing_reason = non_business_reason(hearing)
    if hearing_reason is not None:
        t.warn(f"The hearing date {hearing} is a {hearing_reason}; check it against the notice of hearing.")

    unadjusted = t.step(
        "Owner evidence by (unadjusted)", add_days(hearing, -14),
        f'{hearing} − 14 calendar days: "not later than the 14th day before the date of the first day of the hearing" '
        "(§41.43(a-1), (a-3)(3))")
    skipped: list[dict[str, str]] = []
    recommended = unadjusted
    while (reason := non_business_reason(recommended)) is not None:
        skipped.append({"date": recommended, "reason": reason})
        recommended = add_days(recommended, -1)
    t.step("Owner evidence recommended by", recommended,
           "rolled back past " + ", ".join(f"{s['date']} ({s['reason']})" for s in skipped)
           + " to the previous business day" if skipped else "the unadjusted date is a business day")
    if skipped:
        t.warn(f"{unadjusted} is a {skipped[0]['reason']}. Whether Tax Code §1.06 moves a \"not later than the 14th day "
               f"before\" date to the next business day is not settled here; {recommended}, the business day before, is "
               "the safe date.")
    t.warn("The owner's 14-day date matters only for the clear-and-convincing standard of §41.43(a-1) or (a-3), which "
           "have other conditions; filing that information is not a duty (§41.43(a-5)).")

    district = t.step(
        "District evidence due", add_days(hearing, -14),
        f'{hearing} − 14 days: requested information "not delivered to the protesting party at least 14 days before the '
        'scheduled or postponed hearing may not be used" (§41.67(d); §41.461(a))')
    t.warn("A postponed hearing moves the district's 14-day date: §41.67(d) counts from the scheduled or postponed "
           "hearing. Rerun with the new hearing date. Information offered to rebut the owner's evidence is not excluded.")

    return draft_result(t, META, {
        "hearing_date": hearing,
        "owner_evidence_by_unadjusted": unadjusted,
        "owner_evidence_recommended_by": recommended,
        "owner_evidence_skipped_non_business_days": skipped,
        "district_evidence_due": district,
        "not_covered": list(META["not_covered"]),
    })
