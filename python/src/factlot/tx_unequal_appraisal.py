"""Texas unequal appraisal (Tax Code §41.43(b)(3), §42.26(a)(3)) — Python port of
packages/calc/src/tx_unequal_appraisal.ts.

Same inputs, outputs, step text, warnings, and floating-point operation order as TypeScript; held
to ``spec/vectors/calc/tx_unequal_appraisal.json`` and the differential test. Evidence calculation
only: the caller supplies the comparables and every adjustment with its reason.
"""

from __future__ import annotations

import re
from typing import Any

from ._core import (
    CalcInputError,
    Trace,
    array,
    boolean,
    enum,
    fail,
    fmt_money,
    fmt_num,
    iso_date,
    join,
    js_number_str,
    number,
    obj,
    round_,
    string,
)
from .rules_drafts._draft import strict

Result = dict[str, Any]

#: The ``disclaimer`` on every result.
EVIDENCE_NOTICE = (
    "Evidence calculation only: arithmetic on the values and adjustments supplied. It is not an appraisal or an opinion of value (Occupations Code §1103.003(1)), it is not legal or tax advice, and it is not a substitute for the advice of an attorney. It does not say whether to protest or what value to claim. FactLot does not represent property owners."
)

#: Fewest comparables accepted: a FactLot product floor, not a rule of law.
MIN_COMPARABLES = 3
_MAX_COMPARABLES = 200
_FEW_COMPARABLES = 5
_LARGE_ADJUSTMENT = 0.25
_AREA_SPREAD = 0.25  # areas further than this share from the subject's draw a warning when values are compared whole
_FLAG_RATIO = 2  # value per SF or land-to-improvement ratio beyond this multiple (or below its inverse) is flagged
_APPROPRIATELY_ADJUSTED = ("the median appraised value of a reasonable number of comparable properties appropriately "
                           "adjusted")
_AREA_WORD = {"improvement_area_sf": "improvement", "land_area_sf": "land"}
_STATUTES = "https://statutes.capitol.texas.gov/Docs/TX/htm"

LAW: tuple[dict[str, str], ...] = (
    {"section": "Tex. Tax Code §41.43(b)(3)", "url": f"{_STATUTES}/TX.41.htm#41.43",
     "covers": "the unequal-appraisal comparison at an appraisal review board hearing: the median appraised value of a reasonable number of comparable properties appropriately adjusted"},
    {"section": "Tex. Tax Code §42.26(a)(3) and (b)", "url": f"{_STATUTES}/TX.42.htm#42.26",
     "covers": "the same comparison in a district-court appeal and how the court sets the value"},
    {"section": "Tex. Tax Code §42.26(d)", "url": f"{_STATUTES}/TX.42.htm#42.26",
     "covers": "which value, market or appraised, is used for the subject and the comparables for purposes of §42.26 when the property is subject to an appraised-value limitation; the text in effect from 2027-01-01 refers only to a residence homestead under §23.23"},
    {"section": "Tex. Tax Code §41.66(l)", "url": f"{_STATUTES}/TX.41.htm#41.66",
     "covers": "a property owner, attorney or agent offering evidence or argument in a value or unequal-appraisal protest, and Occupations Code ch. 1103 (\"A property owner, attorney, or agent offering evidence\")"},
    {"section": "Tex. Occ. Code §1103.003(1)", "url": "https://statutes.capitol.texas.gov/Docs/OC/htm/OC.1103.htm#1103.003",
     "covers": "defines an appraisal as an opinion of value"},
)

_BASES = ("appraised", "market")
_NORMALIZE = ("none", "improvement_area_sf", "land_area_sf")
_KINDS = ("percent", "amount", "psf")
_FIPS = re.compile(r"[0-9]{3}")


def _fips(d: dict[str, Any], path: str) -> str | None:
    if "county_fips" not in d:
        return None
    v = d["county_fips"]
    if not isinstance(v, str) or not _FIPS.fullmatch(v):
        fail(join(path, "county_fips"), "expected a 3-digit county FIPS code")
    return v


def _property(d: dict[str, Any], path: str) -> dict[str, Any]:
    return {
        "id": string(d, "id", path, optional=True, min_len=1, max_len=200),
        "label": string(d, "label", path, optional=True, min_len=1, max_len=80),
        "address": string(d, "address", path, optional=True, min_len=1, max_len=120),
        "county_fips": _fips(d, path),
        "value": number(d, "value", path, gt=0),
        "value_basis": enum(d, "value_basis", _BASES, path),
        "improvement_area_sf": number(d, "improvement_area_sf", path, optional=True, gt=0),
        "land_area_sf": number(d, "land_area_sf", path, optional=True, gt=0),
    }


def _citation(raw: Any, path: str) -> dict[str, Any]:
    d = obj(raw, path)
    strict(d, ("fact_id", "document_id", "locator", "as_of"), path)
    out: dict[str, Any] = {}
    for k, hi in (("fact_id", 200), ("document_id", 200), ("locator", 500)):
        if k in d:
            out[k] = string(d, k, path, min_len=1, max_len=hi)
    if "as_of" in d:
        out["as_of"] = iso_date(d, "as_of", path)
    return out


def _comparable(raw: Any, path: str) -> dict[str, Any]:
    d = obj(raw, path)
    strict(d, ("id", "label", "address", "county_fips", "value", "value_basis", "improvement_area_sf", "land_area_sf",
               "citation", "adjustments"), path)
    c = _property(d, path)
    c["citation"] = _citation(d["citation"], join(path, "citation")) if "citation" in d else None
    adjustments = []
    for j, a in enumerate(array(d, "adjustments", path, default=[], max_len=20)):
        p = join(join(path, "adjustments"), j)
        a = obj(a, p)
        strict(a, ("label", "kind", "value", "reason"), p)
        adjustments.append({
            "label": string(a, "label", p, min_len=1, max_len=100),
            "kind": enum(a, "kind", _KINDS, p),
            "value": number(a, "value", p),
            "reason": string(a, "reason", p, min_len=1, max_len=300),
        })
    c["adjustments"] = adjustments
    return c


def _parse(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    strict(d, ("tax_year", "subject", "normalize_by", "adjustment_combine", "comparables"))
    tax_year = number(d, "tax_year", integer=True, ge=1982, le=2100)
    if "subject" not in d:
        fail("subject", "required")
    s = obj(d["subject"], "subject")
    strict(s, ("id", "label", "address", "county_fips", "value", "value_basis", "improvement_area_sf", "land_area_sf",
               "circuit_breaker_23_231"), "subject")
    subject = _property(s, "subject")
    subject["circuit_breaker_23_231"] = boolean(s, "circuit_breaker_23_231", "subject", default=False)
    by = enum(d, "normalize_by", _NORMALIZE, default="none")
    combine = enum(d, "adjustment_combine", ("sum", "compound"), default="sum")
    comps_raw = array(d, "comparables", max_len=_MAX_COMPARABLES)
    if len(comps_raw) < MIN_COMPARABLES:
        fail("comparables", "at least 3 comparables are required (a FactLot product floor, not a rule of law: the "
                            "statute says only 'a reasonable number')")
    comps = [_comparable(c, join("comparables", i)) for i, c in enumerate(comps_raw)]
    return {"tax_year": tax_year, "subject": subject, "normalize_by": by, "adjustment_combine": combine,
            "comparables": comps}


def _label(c: dict[str, Any], i: int) -> str:
    return c["id"] if c["id"] is not None else f"#{i + 1}"


def _named(labels: list[str]) -> str:
    """"comparable C-1" or "comparables C-1, #3"."""
    return f"{'comparable' if len(labels) == 1 else 'comparables'} {', '.join(labels)}"


def _check(inp: dict[str, Any]) -> None:
    issues: list[dict[str, str]] = []
    by = inp["normalize_by"]
    subject = inp["subject"]
    if by != "none" and subject[by] is None:
        issues.append({"path": f"subject.{by}", "message": f"required when normalize_by is {by}"})
    seen: dict[str, int] = {}
    for i, c in enumerate(inp["comparables"]):
        if by != "none" and c[by] is None:
            issues.append({"path": f"comparables.{i}.{by}", "message": f"required when normalize_by is {by}"})
        if c["id"] is not None:
            if subject["id"] is not None and c["id"] == subject["id"]:
                issues.append({"path": f"comparables.{i}.id",
                               "message": f"is the subject's id ({c['id']}): the subject cannot be its own comparable"})
            if c["id"] in seen:
                issues.append({"path": f"comparables.{i}.id",
                               "message": f"duplicates comparables.{seen[c['id']]}.id ({c['id']})"})
            else:
                seen[c["id"]] = i
        for j, a in enumerate(c["adjustments"]):
            at = f"comparables.{i}.adjustments.{j}"
            if a["kind"] == "percent" and not (-1 < a["value"] < 1):
                v = a["value"]
                issues.append({"path": f"{at}.value",
                               "message": f"a percent adjustment must be a decimal between -1 and 1 but is "
                                          f"{js_number_str(v)} (percentages are decimals: pass {js_number_str(v / 100)} for "
                                          f"{js_number_str(v)}%)"})
            if a["kind"] == "psf" and by == "none":
                issues.append({"path": f"{at}.kind",
                               "message": "psf adjustments need a normalizing area: set normalize_by to "
                                          "improvement_area_sf or land_area_sf, or use an amount adjustment"})
    if issues:
        raise CalcInputError("invalid input: " + "; ".join(f"{i['path']}: {i['message']}" for i in issues), issues)


def _flags(subject: dict[str, Any], c: dict[str, Any], by: str) -> list[dict[str, str]]:
    """A comparable's data-quality flags (``comparableFlags`` in TS): facts about the inputs, FactLot thresholds."""
    flags: list[dict[str, str]] = []
    key = "improvement_area_sf" if by == "none" else by
    word = _AREA_WORD[key]
    s_area, c_area = subject[key], c[key]
    if s_area is not None and c_area is not None:
        s_psf = subject["value"] / s_area
        c_psf = c["value"] / c_area
        if c_psf > _FLAG_RATIO * s_psf:
            flags.append({"code": "value_psf_above_2x",
                          "message": f"Value per SF of {word} area ({fmt_money(c_psf)}) is more than twice the "
                                     f"subject's ({fmt_money(s_psf)})."})
        elif c_psf < s_psf / _FLAG_RATIO:
            flags.append({"code": "value_psf_below_half",
                          "message": f"Value per SF of {word} area ({fmt_money(c_psf)}) is less than half the "
                                     f"subject's ({fmt_money(s_psf)})."})
    elif by == "none" and s_area is not None and c_area is None:
        flags.append({"code": "missing_area",
                      "message": f"No {key} given while the subject has one: value per SF is not compared, and "
                                 f"normalize_by {key} would need it."})
    if (subject["land_area_sf"] is not None and subject["improvement_area_sf"] is not None
            and c["land_area_sf"] is not None and c["improvement_area_sf"] is not None):
        s_ratio = subject["land_area_sf"] / subject["improvement_area_sf"]
        c_ratio = c["land_area_sf"] / c["improvement_area_sf"]
        if c_ratio > _FLAG_RATIO * s_ratio:
            flags.append({"code": "land_ratio_above_2x",
                          "message": f"Land-to-improvement area ratio ({fmt_num(c_ratio, 2)}) is more than twice the "
                                     f"subject's ({fmt_num(s_ratio, 2)})."})
        elif c_ratio < s_ratio / _FLAG_RATIO:
            flags.append({"code": "land_ratio_below_half",
                          "message": f"Land-to-improvement area ratio ({fmt_num(c_ratio, 2)}) is less than half the "
                                     f"subject's ({fmt_num(s_ratio, 2)})."})
    return flags


def tx_unequal_appraisal(raw: Any) -> Result:
    inp = _parse(raw)
    _check(inp)
    t = Trace()
    subject = inp["subject"]
    by = inp["normalize_by"]
    subject_area = 0 if by == "none" else subject[by]
    area_name = "improvement" if by == "improvement_area_sf" else "land"

    t.step("Normalization", "none: whole values compared" if by == "none" else
           f"{by}: each comparable's value per SF of {area_name} area × the subject's {fmt_num(subject_area)} SF")
    t.step("Percentage adjustments",
           "sum: a comparable's percentages are added and applied once" if inp["adjustment_combine"] == "sum" else
           "compound: a comparable's factor is the product of (1 + each percentage)")

    comps: list[dict[str, Any]] = []
    for i, c in enumerate(inp["comparables"]):
        name = f"Comparable {_label(c, i)}"
        if by == "none":
            normalized = t.step(f"{name}: normalized value", round_(c["value"], 2),
                                "value as given (no normalization)", "USD")
        else:
            area = c[by]
            normalized = t.step(f"{name}: normalized value", round_(c["value"] / area * subject_area, 2),
                                f"{fmt_money(c['value'])} ÷ {fmt_num(area)} SF × {fmt_num(subject_area)} SF", "USD")

        pcts = [a for a in c["adjustments"] if a["kind"] == "percent"]
        if inp["adjustment_combine"] == "sum":
            s = 0.0
            for a in pcts:
                s += a["value"]
            raw_factor = 1 + s
            factor_text = ("no percentage adjustments" if not pcts else
                           "1 + (" + " + ".join(f"{a['label']} {fmt_num(a['value'])}" for a in pcts) + ")")
        else:
            f = 1.0
            for a in pcts:
                f *= 1 + a["value"]
            raw_factor = f
            factor_text = ("no percentage adjustments" if not pcts else
                           " × ".join(f"(1 + {a['label']} {fmt_num(a['value'])})" for a in pcts))
        factor = t.step(f"{name}: percentage factor", round_(raw_factor, 6), factor_text)
        if factor <= 0:
            raise CalcInputError(
                f"{name}: the percentage adjustments total -100% or less (factor {fmt_num(factor)})",
                [{"path": f"comparables.{i}.adjustments",
                  "message": "percentage adjustments leave a factor of 0 or less"}])
        after_percent = t.step(f"{name}: after percentages", round_(normalized * factor, 2),
                               f"{fmt_money(normalized)} × {fmt_num(factor)}", "USD")

        amounts = 0.0
        psf = 0.0
        for a in c["adjustments"]:
            if a["kind"] == "amount":
                amounts += a["value"]
            elif a["kind"] == "psf":
                psf += a["value"]
        adjusted = t.step(
            f"{name}: adjusted value", round_(after_percent + amounts + psf * subject_area, 2),
            f"{fmt_money(after_percent)} + {fmt_money(amounts)} amount adjustments" if by == "none" else
            f"{fmt_money(after_percent)} + {fmt_money(amounts)} amount adjustments + {fmt_num(psf)} $/SF × "
            f"{fmt_num(subject_area)} SF",
            "USD")
        if adjusted <= 0:
            raise CalcInputError(
                f"{name}: the adjusted value is {fmt_money(adjusted)}; adjustments must leave a positive value",
                [{"path": f"comparables.{i}.adjustments",
                  "message": "adjustments leave an adjusted value of 0 or less"}])
        comps.append({
            "index": i,
            "id": c["id"],
            "label": c["label"],
            "address": c["address"],
            "county_fips": c["county_fips"],
            "value": c["value"],
            "value_basis": c["value_basis"],
            "normalized_value": normalized,
            "percent_factor": factor,
            "after_percent_value": after_percent,
            "amount_adjustments_total": round_(adjusted - after_percent, 2),
            "adjusted_value": adjusted,
            "adjusted_value_psf": None if by == "none" else round_(adjusted / subject_area, 2),
            "total_adjustment_pct": round_(adjusted / normalized - 1, 6),
            "adjustments": [dict(a) for a in c["adjustments"]],
            "citation": dict(c["citation"]) if c["citation"] is not None else None,
            "flags": _flags(subject, c, by),
        })

    ordered = sorted(c["adjusted_value"] for c in comps)  # stable: ties stay in input order
    n = len(ordered)
    t.step("Adjusted values, ascending", ", ".join(fmt_money(v) for v in ordered), f"{n} comparables")
    pair = None
    if n % 2 == 1:
        median = t.step("Median adjusted value", ordered[(n - 1) // 2],
                        f"value {(n + 1) // 2} of {n} in ascending order: the comparison figure in §41.43(b)(3) and "
                        "§42.26(a)(3)", "USD")
    else:
        lo, hi = ordered[n // 2 - 1], ordered[n // 2]
        pair = [lo, hi]
        median = t.step("Median adjusted value", round_((lo + hi) / 2, 2),
                        f"mean of values {n // 2} and {n // 2 + 1} of {n} in ascending order, ({fmt_money(lo)} + "
                        f"{fmt_money(hi)}) ÷ 2: the comparison figure in §41.43(b)(3) and §42.26(a)(3)", "USD")
    diff = t.step("Subject value minus median", round_(subject["value"] - median, 2),
                  f"{fmt_money(subject['value'])} − {fmt_money(median)}", "USD")
    diff_pct = t.step("Subject value minus median, share of median", round_(diff / median, 6),
                      f"{fmt_money(diff)} ÷ {fmt_money(median)}")

    def labels(pred) -> list[str]:
        return [_label(c, i) for i, c in enumerate(inp["comparables"]) if pred(c)]

    other_basis = labels(lambda c: c["value_basis"] != subject["value_basis"])
    if other_basis:
        t.warn(f"Value basis differs from the subject's ({subject['value_basis']}) for {_named(other_basis)}: compare "
               "the same kind of value for the subject and every comparable.")
    if subject["circuit_breaker_23_231"]:
        if inp["tax_year"] <= 2026:
            appraised = (["the subject"] if subject["value_basis"] == "appraised" else []) + \
                [f"comparable {lb}" for lb in labels(lambda c: c["value_basis"] == "appraised")]
            if appraised:
                t.warn(f"Tax year {inp['tax_year']}: on appeal under §42.26, §42.26(d) (text in effect until 2027-01-01) requires market value for the subject and the comparables when the property is subject to the §23.231 limitation, and {', '.join(appraised)} use appraised value; appraisal review board practice may differ.")
        else:
            t.warn(f"Tax year {inp['tax_year']}: the subject is marked as subject to the §23.231 limitation, but §23.231(k) says \"This section expires December 31, 2026\", and §42.26(d) and §41.41(a) as in effect from 2027-01-01 no longer refer to §23.231; check whether the limitation applies and which value is compared.")
    if subject["county_fips"] is not None:
        other_county = labels(lambda c: c["county_fips"] is not None and c["county_fips"] != subject["county_fips"])
        if other_county:
            t.warn(f"In a different county from the subject (FIPS {subject['county_fips']}): {_named(other_county)}. "
                   "Unequal-appraisal comparisons are made within the appraisal district.")
    if n < _FEW_COMPARABLES:
        t.warn(f'Only {n} comparables: §41.43(b)(3) and §42.26(a)(3) call for "a reasonable number" and the statute does '
               "not define it. FactLot's minimum of 3 is a product floor, not a rule of law.")
    large = [_label(inp["comparables"][c["index"]], c["index"]) for c in comps
             if abs(c["total_adjustment_pct"]) > _LARGE_ADJUSTMENT]
    if large:
        t.warn(f"Total adjustments exceed 25% of the comparable's normalized value (adjusted ÷ normalized − 1) for "
               f"{_named(large)}. This is a FactLot flag, not a legal limit.")
    same = labels(lambda c: c["value"] == subject["value"] and c["value_basis"] == subject["value_basis"]
                  and c["improvement_area_sf"] == subject["improvement_area_sf"]
                  and c["land_area_sf"] == subject["land_area_sf"])
    if same:
        t.warn(f"Same value, value basis and areas as the subject: {_named(same)}. Check that the subject is not among "
               "its own comparables.")
    if all(not c["adjustments"] for c in inp["comparables"]):
        what = "unadjusted values" if by == "none" else f"values normalized by {by} and otherwise unadjusted"
        t.warn(f"No adjustments were supplied: the median is of {what}. §41.43(b)(3) and §42.26(a)(3) refer to "
               f'"{_APPROPRIATELY_ADJUSTED}".')
    if by == "none":
        key = ("improvement_area_sf" if subject["improvement_area_sf"] is not None else
               "land_area_sf" if subject["land_area_sf"] is not None else None)
        if key is not None:
            s_area = subject[key]
            spread = labels(lambda c: c[key] is not None and abs(c[key] / s_area - 1) > _AREA_SPREAD)
            if spread:
                t.warn(f'Values are compared whole (normalize_by "none"), and the {_AREA_WORD[key]} area of '
                       f"{_named(spread)} differs from the subject's ({fmt_num(s_area)} SF) by more than 25%: a median "
                       "of whole values and a median of values per SF can differ materially. "
                       f'normalize_by "{key}" compares values per SF of that area. The 25% is a FactLot flag, not a '
                       "legal limit.")

    return t.result("calc.tx_unequal_appraisal", 1, {
        "disclaimer": EVIDENCE_NOTICE,
        "tax_year": inp["tax_year"],
        "normalize_by": by,
        "adjustment_combine": inp["adjustment_combine"],
        "comparables_count": n,
        "comparables": comps,
        "sorted_adjusted_values": ordered,
        "median_adjusted_value": median,
        "median_pair": pair,
        "subject_id": subject["id"],
        "subject_label": subject["label"],
        "subject_address": subject["address"],
        "subject_value": subject["value"],
        "subject_value_basis": subject["value_basis"],
        "subject_minus_median": diff,
        # (subject value - median) / median, 6 decimals, a fraction like every FactLot rate: 0.1554 is 15.54%.
        "subject_minus_median_pct": diff_pct,
        "law": [dict(x) for x in LAW],
    })
