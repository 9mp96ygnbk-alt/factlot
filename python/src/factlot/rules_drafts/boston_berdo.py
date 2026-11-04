"""DRAFT: Boston BERDO 2.0 emissions standard by building use (City of Boston Code, Ch. VII §7-2.2(i)).

Mirror of packages/calc/src/rules-drafts/boston-berdo.ts, held to spec/vectors/rules/drafts. Not verified:
see docs/rules/boston-berdo.md.
"""

from __future__ import annotations

from typing import Any

from .._core import Trace, enum, js_number_str as _n, number, obj, reduce_noise, round_
from ._draft import draft_result, strict

#: Table 1: CO2e Emissions Standards by Building Use, kgCO2e/sf/yr, for 2025–2029, 2030–2034, 2035–2039, 2040–2044,
#: 2045–2049 and 2050 onward.
STANDARDS: tuple[tuple[str, str, float, float, float, float, float, float], ...] = (
    ("assembly", "Assembly", 7.8, 4.6, 3.3, 2.1, 1.1, 0.0),
    ("college_university", "College/University", 10.2, 5.3, 3.8, 2.5, 1.2, 0.0),
    ("education", "Education", 3.9, 2.4, 1.8, 1.2, 0.6, 0.0),
    ("food_sales_and_service", "Food Sales & Service", 17.4, 10.9, 8.0, 5.4, 2.7, 0.0),
    ("healthcare", "Healthcare", 15.4, 10.0, 7.4, 4.9, 2.4, 0.0),
    ("lodging", "Lodging", 5.8, 3.7, 2.7, 1.8, 0.9, 0.0),
    ("manufacturing_industrial", "Manufacturing/Industrial", 23.9, 15.3, 10.9, 6.7, 3.2, 0.0),
    ("multifamily_housing", "Multifamily housing", 4.1, 2.4, 1.8, 1.1, 0.6, 0.0),
    ("office", "Office", 5.3, 3.2, 2.4, 1.6, 0.8, 0.0),
    ("retail", "Retail", 7.1, 3.4, 2.4, 1.5, 0.7, 0.0),
    ("services", "Services", 7.5, 4.5, 3.3, 2.2, 1.1, 0.0),
    ("storage", "Storage", 5.4, 2.8, 1.8, 1.0, 0.4, 0.0),
    ("technology_science", "Technology/Science", 19.2, 11.1, 7.8, 5.1, 2.5, 0.0),
)

_PERIODS = ("2025-2029", "2030-2034", "2035-2039", "2040-2044", "2045-2049", "2050-")
_ORDINANCE = ("https://www.boston.gov/sites/default/files/file/2023/12/"
              "BERDO%202.0%20Final%20Amended%20Docket%200775_1.pdf")
_REGULATIONS = "https://www.boston.gov/sites/default/files/file/2025/09/2025%20Final%20Regulations.pdf"
_RETRIEVED = "2026-11-03"
_ACP_PER_TCO2E = 234

META: dict[str, Any] = {
    "id": "rules.boston.berdo_emissions_standard",
    "version": 1,
    "jurisdiction": "us-ma-boston",
    "title": "Boston BERDO 2.0 emissions standard by building use",
    "citations": [
        {"law": "City of Boston Code, Ordinances, Ch. VII §7-2.2(i) and Table 1", "url": _ORDINANCE,
         "retrieved": _RETRIEVED,
         "covers": "emissions standards (kgCO2e/sf/yr) by building use and period; compliance measured annually as "
                   "CO2e per square foot"},
        {"law": "City of Boston Code, Ordinances, Ch. VII §7-2.2(m)(d)", "url": _ORDINANCE, "retrieved": _RETRIEVED,
         "covers": "Alternative Compliance Payment of $234 per metric ton of CO2e"},
        {"law": "BERDO Regulations §IX.a(i) (Air Pollution Control Commission, approved 2025-09-17)",
         "url": _REGULATIONS, "retrieved": _RETRIEVED,
         "covers": "gross floor area for compliance: third-party verified, else Boston Assessing Department records"},
    ],
    "verification": {
        "status": "draft",
        "notes": (
            "Drafted from the docket text of the BERDO 2.0 ordinance (Docket #0775, filed 2021-09-22) and the 2025 "
            "regulations, both published on boston.gov and retrieved 2026-11-03. The codified §7-2.2 was not read: "
            "confirm the docket text is the ordinance as passed and that Table 1 has not been updated by the "
            "Commission. Not checked by a named maintainer."
        ),
    },
    "not_covered": [
        "computing emissions from energy use (emissions factors come from annual Environment Department guidance, "
        "Regulations §VIII)",
        "blended standards for buildings with more than one primary use (§7-2.2(i)(i); method in Policies and "
        "Procedures)",
        "which buildings are covered and from which year, including the 20,000–35,000 sf deferral to 2030 emissions",
        "Individual Compliance Schedules, Hardship Compliance Plans, Building Portfolios, exempt energy, RECs and PPAs",
        "fines (Regulations §XVIII)",
    ],
}


def boston_berdo_emissions_standard(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    strict(d, ("building_use", "gross_floor_area_sf", "calendar_year", "emissions_tco2e"))
    use = enum(d, "building_use", tuple(r[0] for r in STANDARDS))
    gfa = number(d, "gross_floor_area_sf", gt=0, le=1e8)
    year = number(d, "calendar_year", integer=True, ge=2025, le=2100)
    e = number(d, "emissions_tco2e", optional=True, ge=0, le=1e9)

    t = Trace()
    row = next(r for r in STANDARDS if r[0] == use)
    i = min((year - 2025) // 5, 5)
    period = _PERIODS[i]
    std = row[2 + i]
    t.step("Emissions standard", std, f"Table 1, {row[1]}, {period}", "kgCO2e/sf/yr")
    limit = round_(gfa * std / 1000, 4)
    t.step("Emissions limit", limit, f"{_n(gfa)} sf × {_n(std)} kgCO2e/sf ÷ 1,000", "tCO2e")

    intensity = meets = excess = acp = None
    if e is not None:
        exact = e * 1000 / gfa
        intensity = round_(exact, 4)
        meets = reduce_noise(exact) <= std
        t.step("Emissions intensity", intensity, f"{_n(e)} tCO2e × 1,000 ÷ {_n(gfa)} sf", "kgCO2e/sf")
        excess = max(0.0, round_(round_(e, 4) - limit, 4))
        t.step("Excess over the standard", excess, f"max(0, {_n(e)} − {_n(limit)})", "tCO2e")
        acp = round_(excess * _ACP_PER_TCO2E, 2)
        t.step("Alternative Compliance Payments to cover the excess", acp, f"{_n(excess)} tCO2e × $234", "USD")
        if excess > 0:
            t.warn("Alternative Compliance Payments are a compliance option, not a fine; the $234 rate is reviewed every "
                   "five years (§7-2.2(m)(d)). Fines for missing the standard are set in Regulations §XVIII and are not "
                   "modelled.")
    t.warn("Buildings of 20,000 sf (or 15 units) up to 35,000 sf (or 35 units) are not subject to the standards until "
           "2030 emissions (§7-2.2(i)); coverage is not checked here.")
    t.warn("Rounding: the limit, intensity and excess are rounded to 0.0001 and the payment to the cent; the ordinance "
           "does not specify rounding.")

    return draft_result(t, META, {
        "building_use": row[0],
        "building_use_label": row[1],
        "calendar_year": year,
        "period": period,
        "emissions_standard_kgco2e_per_sf": std,
        "emissions_limit_tco2e": limit,
        "emissions_tco2e": e,
        "emissions_intensity_kgco2e_per_sf": intensity,
        "meets_standard": meets,
        "excess_emissions_tco2e": excess,
        "alternative_compliance_payment_usd": acp,
    })
