"""Independent reference for the calc.tx_unequal_appraisal vectors (Texas unequal appraisal,
Tax Code §41.43(b)(3) and §42.26(a)(3)).

Written from the documented conventions (docs/agents.md, "Texas unequal appraisal"), not from the
FactLot code, and imports nothing from FactLot. Exact decimal arithmetic (Python ``decimal`` at 60
digits), rounding half away from zero on the exact value:

- normalized = value, or value ÷ comparable area × subject area, to the cent;
- percentage factor = 1 + Σp (sum) or Π(1 + p) (compound), to 6 decimals;
- after percentages = normalized × factor, to the cent;
- adjusted = after percentages + Σ amounts + Σ $/SF × subject area, to the cent;
- median of the adjusted values (even count: mean of the two middle values, to the cent);
- subject − median to the cent, and that ÷ median to 6 decimals.

The warning texts are the calculator's specification and are written out here from it.
``build.py`` beside this file writes the expected values into spec/vectors/calc.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal as D, getcontext

getcontext().prec = 60

NOTICE = ("Evidence calculation only: arithmetic on the values and adjustments supplied. It is not an appraisal or an opinion of value (Occupations Code §1103.003(1)), it is not legal or tax advice, and it is not a substitute for the advice of an attorney. It does not say whether to protest or what value to claim. FactLot does not represent property owners.")


def q(x: D, places: int) -> D:
    return x.quantize(D(1).scaleb(-places), rounding=ROUND_HALF_UP)


def dec(x) -> D:
    return D(str(x))


def named(labels):
    return ("comparable " if len(labels) == 1 else "comparables ") + ", ".join(labels)


def unequal(inp: dict) -> dict:
    by = inp.get("normalize_by", "none")
    combine = inp.get("adjustment_combine", "sum")
    s = inp["subject"]
    sa = dec(s[by]) if by != "none" else D(0)
    comps = []
    for i, c in enumerate(inp["comparables"]):
        label = c.get("id", f"#{i + 1}")
        v = dec(c["value"])
        norm = q(v, 2) if by == "none" else q(v / dec(c[by]) * sa, 2)
        adj = c.get("adjustments", [])
        ps = [dec(a["value"]) for a in adj if a["kind"] == "percent"]
        if combine == "sum":
            factor = q(1 + sum(ps, D(0)), 6)
        else:
            f = D(1)
            for p in ps:
                f *= 1 + p
            factor = q(f, 6)
        after = q(norm * factor, 2)
        amounts = sum((dec(a["value"]) for a in adj if a["kind"] == "amount"), D(0))
        psf = sum((dec(a["value"]) for a in adj if a["kind"] == "psf"), D(0))
        adjusted = q(after + amounts + psf * sa, 2)
        comps.append({
            "label": label, "c": c, "normalized": norm, "factor": factor, "after": after, "adjusted": adjusted,
            "amount_total": adjusted - after,
            "psf": q(adjusted / sa, 2) if by != "none" else None,
            "pct": q(adjusted / norm - 1, 6),
        })
    ordered = sorted(x["adjusted"] for x in comps)
    n = len(ordered)
    if n % 2:
        median, pair = ordered[n // 2], None
    else:
        lo, hi = ordered[n // 2 - 1], ordered[n // 2]
        median, pair = q((lo + hi) / 2, 2), [lo, hi]
    diff = q(dec(s["value"]) - median, 2)

    warnings = []
    basis = s["value_basis"]
    other = [x["label"] for x in comps if x["c"]["value_basis"] != basis]
    if other:
        warnings.append(f"Value basis differs from the subject's ({basis}) for {named(other)}: compare the same kind of "
                        "value for the subject and every comparable.")
    year = inp["tax_year"]
    if s.get("circuit_breaker_23_231", False):
        if year <= 2026:
            appr = (["the subject"] if basis == "appraised" else []) + \
                [f"comparable {x['label']}" for x in comps if x["c"]["value_basis"] == "appraised"]
            if appr:
                warnings.append(f"Tax year {year}: on appeal under §42.26, §42.26(d) (text in effect until 2027-01-01) requires market value for the subject and the comparables when the property is subject to the §23.231 limitation, and {', '.join(appr)} use appraised value; appraisal review board practice may differ.")
        else:
            warnings.append(f"Tax year {year}: the subject is marked as subject to the §23.231 limitation, but §23.231(k) says \"This section expires December 31, 2026\", and §42.26(d) and §41.41(a) as in effect from 2027-01-01 no longer refer to §23.231; check whether the limitation applies and which value is compared.")
    if "county_fips" in s:
        far = [x["label"] for x in comps if "county_fips" in x["c"] and x["c"]["county_fips"] != s["county_fips"]]
        if far:
            warnings.append(f"In a different county from the subject (FIPS {s['county_fips']}): {named(far)}. "
                            "Unequal-appraisal comparisons are made within the appraisal district.")
    if n < 5:
        warnings.append(f'Only {n} comparables: §41.43(b)(3) and §42.26(a)(3) call for "a reasonable number" and the '
                        "statute does not define it. FactLot's minimum of 3 is a product floor, not a rule of law.")
    big = [x["label"] for x in comps if abs(x["pct"]) > D("0.25")]
    if big:
        warnings.append(f"Total adjustments exceed 25% of the comparable's normalized value (adjusted ÷ normalized "
                        f"− 1) for {named(big)}. This is a FactLot flag, not a legal limit.")
    same = [x["label"] for x in comps
            if dec(x["c"]["value"]) == dec(s["value"]) and x["c"]["value_basis"] == basis
            and x["c"].get("improvement_area_sf") == s.get("improvement_area_sf")
            and x["c"].get("land_area_sf") == s.get("land_area_sf")]
    if same:
        warnings.append(f"Same value, value basis and areas as the subject: {named(same)}. Check that the subject is "
                        "not among its own comparables.")
    return {"comps": comps, "sorted": ordered, "median": median, "pair": pair, "diff": diff,
            "diff_pct": q(diff / median, 6), "warnings": warnings}
