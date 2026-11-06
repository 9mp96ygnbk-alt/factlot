"""Independent reference for the draft rules-pack vectors in this directory.

This script does not import factlot. It reads the reference tables (*.tables.json, transcribed from the official
text by a separate extraction from the one the SDK tables came from), computes each worked example in exact decimal
arithmetic, and writes the expected values into the vector files. Rounding follows the packs' documented convention:
half away from zero at the stated number of places.

    python3 spec/vectors/rules/drafts/reference.py           # check that the vector files are up to date
    python3 spec/vectors/rules/drafts/reference.py --write   # regenerate them
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOTE = ("Expected values computed by spec/vectors/rules/drafts/reference.py in exact decimal arithmetic from the "
        "reference tables in this directory, not by either SDK.")


def q(x: Decimal, places: int) -> float:
    v = x.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    return float(v)


def tables(name: str) -> dict:
    return json.loads((HERE / f"{name}.tables.json").read_text("utf-8"))


# --- NYC Local Law 97 ----------------------------------------------------------------------------------------------

def nyc(inp: dict) -> dict:
    t = tables("nyc_ll97")
    period = "2024-2029" if inp["calendar_year"] <= 2029 else "2030-2034"
    factors = {r["property_type"]: Decimal(r[period]) for r in t["emissions_factors_tco2e_per_sf"]}
    limit = sum((factors[s["property_type"]] * Decimal(str(s["floor_area_sf"])) for s in inp["spaces"]), Decimal(0))
    gfa = sum((Decimal(str(s["floor_area_sf"])) for s in inp["spaces"]), Decimal(0))
    coef = {k: Decimal(v) for k, v in t["coefficients"][period].items()}
    fuels = {r["fuel"]: Decimal(r["2024-2034"]) for r in t["other_fuels_tco2e_per_kbtu"]}
    e = inp["energy"]
    parts = [Decimal(str(e[k])) * coef[k] for k in coef if k in e]
    parts += [Decimal(str(f["kbtu"])) * fuels[f["fuel"]] for f in e.get("other_fuels", [])]
    emissions = sum(parts, Decimal(0))
    limit_r, emissions_r = q(limit, 4), q(emissions, 4)
    excess = max(Decimal(0), Decimal(str(emissions_r)) - Decimal(str(limit_r)))
    return {
        "value.compliance_period": period,
        "value.gross_floor_area_sf": float(gfa),
        "value.exceeds_25000_gsf": gfa > 25000,
        "value.emissions_limit_tco2e": limit_r,
        "value.building_emissions_tco2e": emissions_r,
        "value.excess_emissions_tco2e": q(excess, 4),
        "value.within_limit": emissions_r <= limit_r,
        "value.penalty_usd": q(Decimal(str(q(excess, 4))) * Decimal(t["penalty_usd_per_tco2e"]), 2),
    }


NYC_CASES = [
    ("office, 2024: electricity and gas over the limit",
     {"calendar_year": 2024, "spaces": [{"property_type": "Office", "floor_area_sf": 100000}],
      "energy": {"utility_electricity_kwh": 2000000, "natural_gas_kbtu": 5000000}}),
    ("same office, 2030: lower factor and electricity coefficient",
     {"calendar_year": 2030, "spaces": [{"property_type": "Office", "floor_area_sf": 100000}],
      "energy": {"utility_electricity_kwh": 2000000, "natural_gas_kbtu": 5000000}}),
    ("mixed multifamily, retail and parking, 2027, with #2 oil",
     {"calendar_year": 2027, "spaces": [{"property_type": "Multifamily Housing", "floor_area_sf": 80000},
                                        {"property_type": "Retail Store", "floor_area_sf": 15000},
                                        {"property_type": "Parking", "floor_area_sf": 20000}],
      "energy": {"utility_electricity_kwh": 900000, "natural_gas_kbtu": 3000000, "fuel_oil_2_kbtu": 500000,
                 "district_steam_kbtu": 0}}),
    ("hotel with restaurant, 2032, other fuels",
     {"calendar_year": 2032, "spaces": [{"property_type": "Hotel", "floor_area_sf": 60000},
                                        {"property_type": "Restaurant", "floor_area_sf": 5000}],
      "energy": {"utility_electricity_kwh": 1500000, "natural_gas_kbtu": 4000000,
                 "other_fuels": [{"fuel": "propane", "kbtu": 200000}, {"fuel": "diesel", "kbtu": 10000},
                                 {"fuel": "biofuel", "kbtu": 50000}]}}),
    ("school within the limit, 2025",
     {"calendar_year": 2025, "spaces": [{"property_type": "K-12 School", "floor_area_sf": 30000}],
      "energy": {"utility_electricity_kwh": 300000, "natural_gas_kbtu": 1000000}}),
    ("office with #4 oil and district steam, 2034",
     {"calendar_year": 2034, "spaces": [{"property_type": "Financial Office", "floor_area_sf": 250000.5}],
      "energy": {"utility_electricity_kwh": 4100000.25, "fuel_oil_4_kbtu": 1200000, "district_steam_kbtu": 9000000}}),
    ("small building, no energy reported",
     {"calendar_year": 2026, "spaces": [{"property_type": "Self-Storage Facility", "floor_area_sf": 20000}],
      "energy": {}}),
    ("data center, 2029, last year of the first period",
     {"calendar_year": 2029, "spaces": [{"property_type": "Data Center", "floor_area_sf": 40000},
                                        {"property_type": "Office", "floor_area_sf": 10000}],
      "energy": {"utility_electricity_kwh": 9000000}}),
]
NYC_ERRORS = [
    ("year after 2034", {"calendar_year": 2035, "spaces": [{"property_type": "Office", "floor_area_sf": 1}], "energy": {}}),
    ("year before 2024", {"calendar_year": 2023, "spaces": [{"property_type": "Office", "floor_area_sf": 1}], "energy": {}}),
    ("'Other' is not an allowed property type",
     {"calendar_year": 2024, "spaces": [{"property_type": "Other", "floor_area_sf": 1}], "energy": {}}),
    ("no spaces", {"calendar_year": 2024, "spaces": [], "energy": {}}),
    ("zero floor area", {"calendar_year": 2024, "spaces": [{"property_type": "Office", "floor_area_sf": 0}], "energy": {}}),
    ("negative energy",
     {"calendar_year": 2024, "spaces": [{"property_type": "Office", "floor_area_sf": 1}],
      "energy": {"natural_gas_kbtu": -1}}),
    ("misspelled energy field",
     {"calendar_year": 2024, "spaces": [{"property_type": "Office", "floor_area_sf": 1}],
      "energy": {"electricity_kwh": 100}}),
    ("unknown fuel",
     {"calendar_year": 2024, "spaces": [{"property_type": "Office", "floor_area_sf": 1}],
      "energy": {"other_fuels": [{"fuel": "coal", "kbtu": 1}]}}),
    ("null energy value",
     {"calendar_year": 2024, "spaces": [{"property_type": "Office", "floor_area_sf": 1}],
      "energy": {"natural_gas_kbtu": None}}),
    ("energy missing", {"calendar_year": 2024, "spaces": [{"property_type": "Office", "floor_area_sf": 1}]}),
]


# --- Washington Clean Buildings Performance Standard -----------------------------------------------------------------

def wa(inp: dict) -> dict:
    t = tables("wa_cbps")
    acts = {a["no"]: a for a in t["activities"]}
    zone = "4C" if inp["climate_zone"] in ("4C", "5C") else "5B"
    total = sum((Decimal(str(s["floor_area_sf"])) for s in inp["spaces"]), Decimal(0))
    base = target = Decimal(0)
    for s in inp["spaces"]:
        a = acts[s["activity"]]
        h = s["weekly_operating_hours"]
        col = "50_or_less" if h <= 50 else "51_to_167" if h <= 167 else "168"
        w = Decimal(str(s["floor_area_sf"])) / total * Decimal(a["shift_factor"][col]) * Decimal(a["eui_target_1"][zone])
        base += w
        target += w * Decimal(t["recent_construction_factor"]) if s.get("more_recently_built") else w
    out = {
        "value.climate_zone_used": zone,
        "value.eui_target_before_recent_reduction": q(base, 2),
        "value.eui_target": q(target, 2),
        "value.meets_target": None if "weather_normalized_eui" not in inp
        else Decimal(str(inp["weather_normalized_eui"])) <= target,
    }
    c = inp.get("coverage")
    if c is None:
        out["value.tier"] = None
        out["value.initial_compliance_date"] = None
    else:
        nonres, mf, g = (c["nonresidential_hotel_motel_dormitory_sf"], c["multifamily_residential_sf"],
                         c["gross_floor_area_sf"])
        if nonres > 50000:
            tier = "tier1"
        elif 20000 < nonres + mf <= 50000 or (nonres == 0 and mf >= 50000):
            tier = "tier2"
        elif nonres + mf <= 20000:
            tier = "not_covered"
        else:
            tier = "undetermined"
        date = None
        if tier == "tier1":  # Z3.2: "more than 220,000"; "more than 90,000 ... less than 220,001"; "more than 50,000 ..."
            date = "2026-06-01" if g > 220000 else "2027-06-01" if g > 90000 else "2028-06-01" if g > 50000 else None
        elif tier == "tier2":
            date = "2027-07-01"
        out["value.tier"] = tier
        out["value.initial_compliance_date"] = date
    return out


def _space(act: int, area: float, hours: int, recent: bool = False) -> dict:
    s = {"activity": act, "floor_area_sf": area, "weekly_operating_hours": hours}
    if recent:
        s["more_recently_built"] = True
    return s


WA_CASES = [
    ("single office at 50 hours, WNEUI equal to the target",
     {"climate_zone": "4C", "spaces": [_space(69, 100000, 50)], "weather_normalized_eui": 50.4}),
    ("office with a recent retail addition, 5C mapped to 4C, Tier 1 cohort 2027",
     {"climate_zone": "5C", "spaces": [_space(69, 80000, 60), _space(94, 20000, 40, True)], "weather_normalized_eui": 60,
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 100000, "multifamily_residential_sf": 0,
                   "gross_floor_area_sf": 100000}}),
    ("hospital around the clock, 6B mapped to 5B",
     {"climate_zone": "6B", "spaces": [_space(51, 300000, 168)], "weather_normalized_eui": 214.9,
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 300000, "multifamily_residential_sf": 0,
                   "gross_floor_area_sf": 300000}}),
    ("recently built office misses the reduced target but not the unreduced one",
     {"climate_zone": "4C", "spaces": [_space(73, 60000, 55, True)], "weather_normalized_eui": 60}),
    ("weekly hours at 51 and 167 use the middle column",
     {"climate_zone": "5B", "spaces": [_space(94, 30000, 51), _space(47, 30000, 167), _space(110, 40000, 0)]}),
    ("three-way mix with uneven areas",
     {"climate_zone": "4C", "spaces": [_space(61, 123456.7, 168), _space(44, 7000.3, 80), _space(112, 25000, 45)],
      "weather_normalized_eui": 40.0}),
    ("Tier 1 at exactly 220,000 gsf falls in the 2027 cohort",
     {"climate_zone": "4C", "spaces": [_space(69, 220000, 50)],
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 220000, "multifamily_residential_sf": 0,
                   "gross_floor_area_sf": 220000}}),
    ("Tier 1 just over 220,000 gsf falls in the 2026 cohort",
     {"climate_zone": "4C", "spaces": [_space(69, 220001, 50)],
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 220001, "multifamily_residential_sf": 0,
                   "gross_floor_area_sf": 220001}}),
    ("Tier 1 at exactly 90,000 gsf falls in the 2028 cohort",
     {"climate_zone": "4C", "spaces": [_space(69, 90000, 50)],
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 90000, "multifamily_residential_sf": 0,
                   "gross_floor_area_sf": 90000}}),
    ("Tier 2 by size",
     {"climate_zone": "4C", "spaces": [_space(94, 30000, 60)],
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 30000, "multifamily_residential_sf": 0,
                   "gross_floor_area_sf": 30000}}),
    ("large multifamily building is Tier 2",
     {"climate_zone": "4C", "spaces": [_space(61, 80000, 168)],
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 0, "multifamily_residential_sf": 80000,
                   "gross_floor_area_sf": 80000}}),
    ("20,000 sf is not covered",
     {"climate_zone": "4C", "spaces": [_space(94, 20000, 60)],
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 20000, "multifamily_residential_sf": 0,
                   "gross_floor_area_sf": 20000}}),
    ("mixed 40,000 nonresidential and 30,000 multifamily is not settled by the definitions",
     {"climate_zone": "4C", "spaces": [_space(94, 40000, 60), _space(61, 30000, 168)],
      "coverage": {"nonresidential_hotel_motel_dormitory_sf": 40000, "multifamily_residential_sf": 30000,
                   "gross_floor_area_sf": 70000}}),
]
WA_ERRORS = [
    ("medical office row 52 has no target", {"climate_zone": "4C", "spaces": [_space(52, 1000, 40)]}),
    ("data center has no target", {"climate_zone": "4C", "spaces": [_space(100, 1000, 168)]}),
    ("activity 0", {"climate_zone": "4C", "spaces": [_space(0, 1000, 40)]}),
    ("activity 114", {"climate_zone": "4C", "spaces": [_space(114, 1000, 40)]}),
    ("169 weekly hours", {"climate_zone": "4C", "spaces": [_space(69, 1000, 169)]}),
    ("fractional weekly hours", {"climate_zone": "4C", "spaces": [_space(69, 1000, 50.5)]}),
    ("climate zone not used in Washington", {"climate_zone": "4A", "spaces": [_space(69, 1000, 40)]}),
    ("misspelled field", {"climate_zone": "4C", "spaces": [_space(69, 1000, 40)], "wneui": 50}),
    ("no spaces", {"climate_zone": "4C", "spaces": []}),
]


# --- Boston BERDO 2.0 ------------------------------------------------------------------------------------------------

PERIODS = ["2025-2029", "2030-2034", "2035-2039", "2040-2044", "2045-2049", "2050-"]


def bos(inp: dict) -> dict:
    t = tables("boston_berdo")
    row = next(r for r in t["standards_kgco2e_per_sf"] if r["building_use"] == inp["building_use"])
    period = PERIODS[min((inp["calendar_year"] - 2025) // 5, 5)]
    std = Decimal(row[period])
    gfa = Decimal(str(inp["gross_floor_area_sf"]))
    limit = q(gfa * std / 1000, 4)
    out = {"value.period": period, "value.emissions_standard_kgco2e_per_sf": float(std),
           "value.emissions_limit_tco2e": limit}
    if "emissions_tco2e" in inp:
        e = Decimal(str(inp["emissions_tco2e"]))
        excess = max(Decimal(0), Decimal(str(q(e, 4))) - Decimal(str(limit)))
        out.update({
            "value.emissions_intensity_kgco2e_per_sf": q(e * 1000 / gfa, 4),
            "value.meets_standard": e * 1000 / gfa <= std,
            "value.excess_emissions_tco2e": q(excess, 4),
            "value.alternative_compliance_payment_usd":
                q(Decimal(str(q(excess, 4))) * Decimal(t["alternative_compliance_payment_usd_per_tco2e"]), 2),
        })
    else:
        out.update({"value.emissions_intensity_kgco2e_per_sf": None, "value.meets_standard": None,
                    "value.excess_emissions_tco2e": None, "value.alternative_compliance_payment_usd": None})
    return out


BOS_CASES = [
    ("office, 2031, over the standard", {"building_use": "office", "gross_floor_area_sf": 120000, "calendar_year": 2031,
                                          "emissions_tco2e": 500}),
    ("office, 2025, exactly at the standard", {"building_use": "office", "gross_floor_area_sf": 100000,
                                                "calendar_year": 2025, "emissions_tco2e": 530}),
    ("multifamily in 2050: the standard is zero", {"building_use": "multifamily_housing", "gross_floor_area_sf": 40000,
                                                    "calendar_year": 2050, "emissions_tco2e": 10}),
    ("last year of the first period", {"building_use": "technology_science", "gross_floor_area_sf": 75000.5,
                                       "calendar_year": 2029, "emissions_tco2e": 1400.12345}),
    ("first year of the second period", {"building_use": "healthcare", "gross_floor_area_sf": 500000,
                                         "calendar_year": 2030, "emissions_tco2e": 4000}),
    ("2049 uses 2045-2049", {"building_use": "food_sales_and_service", "gross_floor_area_sf": 36000,
                             "calendar_year": 2049, "emissions_tco2e": 50}),
    ("2100 uses the 2050 standard", {"building_use": "storage", "gross_floor_area_sf": 36000, "calendar_year": 2100}),
    ("no emissions given: limit only", {"building_use": "college_university", "gross_floor_area_sf": 250000,
                                         "calendar_year": 2036}),
]
BOS_ERRORS = [
    ("2024 is before the standards", {"building_use": "office", "gross_floor_area_sf": 50000, "calendar_year": 2024}),
    ("unknown building use", {"building_use": "warehouse", "gross_floor_area_sf": 50000, "calendar_year": 2025}),
    ("zero floor area", {"building_use": "office", "gross_floor_area_sf": 0, "calendar_year": 2025}),
    ("negative emissions", {"building_use": "office", "gross_floor_area_sf": 50000, "calendar_year": 2025,
                            "emissions_tco2e": -1}),
    ("unknown field", {"building_use": "office", "gross_floor_area_sf": 50000, "calendar_year": 2025, "units": 40}),
]


# --- Texas protest evidence dates ------------------------------------------------------------------------------------
# Written from Tax Code §41.43(a-1), (a-3)(3), §41.67(d) and Gov't Code §662.003, not from either SDK: the hearing date
# minus 14 calendar days; the recommended owner date steps back one day at a time past Saturdays, Sundays and Texas
# legal holidays on their actual dates (observed dates and the optional §662.003(c) days are not holidays). When two
# holidays share a date, Confederate Heroes Day is named before Martin Luther King, Jr., Day, as in
# spec/vectors/rules/texas_holidays.json.

def _nth_monday(year: int, month: int, n: int) -> date:
    mondays = [d for d in (date(year, month, k) for k in range(1, 32) if _valid(year, month, k)) if d.weekday() == 0]
    return mondays[n - 1] if n > 0 else mondays[-1]


def _valid(year: int, month: int, day: int) -> bool:
    try:
        date(year, month, day)
        return True
    except ValueError:
        return False


def _tx_holidays(year: int) -> dict:
    thanksgiving = [d for d in (date(year, 11, k) for k in range(1, 31)) if d.weekday() == 3][3]
    pairs = [
        (date(year, 1, 1), "New Year's Day"),
        (date(year, 1, 19), "Confederate Heroes Day"),
        (_nth_monday(year, 1, 3), "Martin Luther King, Jr., Day"),
        (_nth_monday(year, 2, 3), "Presidents' Day"),
        (date(year, 3, 2), "Texas Independence Day"),
        (date(year, 4, 21), "San Jacinto Day"),
        (_nth_monday(year, 5, 0), "Memorial Day"),
        (date(year, 6, 19), "Emancipation Day (Juneteenth)"),
        (date(year, 7, 4), "Independence Day"),
        (date(year, 8, 27), "Lyndon Baines Johnson Day"),
        (_nth_monday(year, 9, 1), "Labor Day"),
        (date(year, 11, 11), "Veterans Day"),
        (thanksgiving, "Thanksgiving Day"),
        (thanksgiving + timedelta(days=1), "Day after Thanksgiving"),
        (date(year, 12, 24), "Christmas Eve"),
        (date(year, 12, 25), "Christmas Day"),
        (date(year, 12, 26), "Day after Christmas"),
    ]
    out: dict = {}
    for d, name in pairs:
        out.setdefault(d, name)
    return out


def _why_closed(d: date):
    if d.weekday() == 5:
        return "Saturday"
    if d.weekday() == 6:
        return "Sunday"
    return _tx_holidays(d.year).get(d)


def txed(inp: dict) -> dict:
    h = date.fromisoformat(inp["hearing_date"])
    unadjusted = h - timedelta(days=14)
    rec, skipped = unadjusted, []
    while _why_closed(rec):
        skipped.append({"date": rec.isoformat(), "reason": _why_closed(rec)})
        rec -= timedelta(days=1)
    return {
        "value.hearing_date": h.isoformat(),
        "value.owner_evidence_by_unadjusted": unadjusted.isoformat(),
        "value.owner_evidence_recommended_by": rec.isoformat(),
        "value.owner_evidence_skipped_non_business_days": skipped,
        "value.district_evidence_due": unadjusted.isoformat(),
        "value.rule.citations.0.url": "https://statutes.capitol.texas.gov/Docs/TX/htm/TX.41.htm#41.43",
        "value.rule.citations.0.retrieved": "2026-11-06",
    }


TXED_CASES = [
    ("plain weekday: hearing Tue 2027-06-08, both dates Tue 2027-05-25", {"hearing_date": "2027-06-08"}),
    ("hearing 14 days after Memorial Day: 2027-05-31 rolls back past Mon, Sun, Sat to Fri 2027-05-28",
     {"hearing_date": "2027-06-14"}),
    ("Saturday hearing: the 14th day before is also a Saturday, rolled back to Fri 2027-05-28",
     {"hearing_date": "2027-06-12"}),
    ("Sunday hearing: 2027-07-04 is a Sunday (named Sunday, not Independence Day), back to Fri 2027-07-02",
     {"hearing_date": "2027-07-18"}),
    ("Monday 2027-07-05, the observed Independence Day, is not a holiday on actual dates: no roll",
     {"hearing_date": "2027-07-19"}),
    ("Thanksgiving: 2026-11-27 and 2026-11-26 skipped, back to Wed 2026-11-25", {"hearing_date": "2026-12-11"}),
    ("Confederate Heroes Day and MLK Day back to back, then a weekend: back to Fri 2027-01-15",
     {"hearing_date": "2027-02-02"}),
    ("year boundary: 2027-01-01 New Year's Day rolls back to Thu 2026-12-31", {"hearing_date": "2027-01-15"}),
    ("Christmas cluster across a Saturday: 2026-12-26, -25, -24 skipped, back to Wed 2026-12-23",
     {"hearing_date": "2027-01-09"}),
    ("leap day: hearing 2028-03-14, 14 days before is Tue 2028-02-29", {"hearing_date": "2028-03-14"}),
]
TXED_ERRORS = [
    ("invalid date", {"hearing_date": "2027-02-30"}),
    ("not ISO format", {"hearing_date": "06/01/2027"}),
    ("missing hearing date", {}),
    ("unknown field", {"hearing_date": "2027-06-08", "postponed": True}),
]


PACKS = [
    ("nyc_ll97_building_emissions", "rules.nyc.ll97_building_emissions", nyc, NYC_CASES, NYC_ERRORS),
    ("wa_cbps_eui_target", "rules.wa.cbps_eui_target", wa, WA_CASES, WA_ERRORS),
    ("boston_berdo_emissions_standard", "rules.boston.berdo_emissions_standard", bos, BOS_CASES, BOS_ERRORS),
    ("tx_protest_evidence_dates", "rules.tx.protest_evidence_dates", txed, TXED_CASES, TXED_ERRORS),
]


def build(name: str, rule_id: str, fn, cases, errors) -> dict:
    out = []
    for label, inp in cases:
        expect = {"value.status": "draft", "value.rule.verification.status": "draft", "formula.id": rule_id,
                  **fn(inp)}
        out.append({"name": label, "input": inp, "expect": expect})
    out += [{"name": label, "input": inp, "expect_error": True} for label, inp in errors]
    return {"rule": name, "calculator": rule_id, "version": 1, "status": "draft", "note": NOTE, "cases": out}


def main() -> int:
    stale = []
    for name, rule_id, fn, cases, errors in PACKS:
        path = HERE / f"{name}.json"
        text = json.dumps(build(name, rule_id, fn, cases, errors), indent=2, ensure_ascii=False) + "\n"
        if "--write" in sys.argv:
            path.write_text(text, "utf-8")
        elif not path.exists() or path.read_text("utf-8") != text:
            stale.append(path.name)
    if stale:
        print("out of date (run with --write):", ", ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
