"""DRAFT: New York City Local Law 97 building emissions limit, emissions and penalty.

Mirror of packages/calc/src/rules-drafts/nyc-ll97.ts, held to spec/vectors/rules/drafts. Not verified:
see docs/rules/nyc-ll97.md.
"""

from __future__ import annotations

from typing import Any

from .._core import Trace, array, enum, fail, js_number_str as _n, number, obj, round_
from ._draft import draft_result, strict

#: [ESPM property type, 2024–2029 factor, 2030–2034 factor] in tCO2e per square foot, 1 RCNY §103-14(c)(3)(i) and (iii).
EMISSIONS_FACTORS: tuple[tuple[str, float, float], ...] = (
    ("Adult Education", 0.00758, 0.003565528),
    ("Ambulatory Surgical Center", 0.01181, 0.008980612),
    ("Automobile Dealership", 0.00675, 0.002824097),
    ("Bank Branch", 0.00987, 0.004036172),
    ("Bowling Alley", 0.00574, 0.003103815),
    ("College/University", 0.00987, 0.002099748),
    ("Convenience Store without Gas Station", 0.00675, 0.003540032),
    ("Courthouse", 0.00426, 0.001480533),
    ("Data Center", 0.02381, 0.014791131),
    ("Distribution Center", 0.00574, 0.000991600),
    ("Enclosed Mall", 0.01074, 0.003983803),
    ("Financial Office", 0.00846, 0.003697004),
    ("Fitness Center/Health Club/Gym", 0.00987, 0.003946728),
    ("Food Sales", 0.01181, 0.005208880),
    ("Food Service", 0.01181, 0.007749414),
    ("Hospital (General Medical & Surgical)", 0.02381, 0.007335204),
    ("Hotel", 0.00987, 0.003850668),
    ("K-12 School", 0.00675, 0.002230588),
    ("Laboratory", 0.02381, 0.026029868),
    ("Library", 0.00675, 0.002218412),
    ("Lifestyle Center", 0.00846, 0.004705850),
    ("Mailing Center/Post Office", 0.00426, 0.001980440),
    ("Manufacturing/Industrial Plant", 0.00758, 0.001417030),
    ("Medical Office", 0.01074, 0.002912778),
    ("Movie Theater", 0.01181, 0.005395268),
    ("Multifamily Housing", 0.00675, 0.003346640),
    ("Museum", 0.01181, 0.005395800),
    ("Non-Refrigerated Warehouse", 0.00426, 0.000883187),
    ("Office", 0.00758, 0.002690852),
    ("Other - Education", 0.00846, 0.002934006),
    ("Other - Entertainment/Public Assembly", 0.00987, 0.002956738),
    ("Other - Lodging/Residential", 0.00758, 0.001901982),
    ("Other - Mall", 0.01074, 0.001928226),
    ("Other - Public Services", 0.00758, 0.003808033),
    ("Other - Recreation", 0.00987, 0.004479570),
    ("Other - Restaurant/Bar", 0.02381, 0.008505075),
    ("Other - Services", 0.01074, 0.001823381),
    ("Other - Specialty Hospital", 0.02381, 0.006321819),
    ("Other - Technology/Science", 0.02381, 0.010446456),
    ("Outpatient Rehabilitation/Physical Therapy", 0.01181, 0.006018323),
    ("Parking", 0.00426, 0.000214421),
    ("Performing Arts", 0.00846, 0.002472539),
    ("Personal Services (Health/Beauty, Dry Cleaning, etc.)", 0.00574, 0.004843037),
    ("Pre-school/Daycare", 0.00675, 0.002362874),
    ("Refrigerated Warehouse", 0.00987, 0.002852131),
    ("Repair Services (Vehicle, Shoe, Locksmith, etc.)", 0.00426, 0.002210699),
    ("Residence Hall/Dormitory", 0.00758, 0.002464089),
    ("Residential Care Facility", 0.01138, 0.004893124),
    ("Restaurant", 0.01181, 0.004038374),
    ("Retail Store", 0.00758, 0.002104490),
    ("Self-Storage Facility", 0.00426, 0.000611830),
    ("Senior Care Community", 0.01138, 0.004410123),
    ("Social/Meeting Hall", 0.00987, 0.003833108),
    ("Strip Mall", 0.01181, 0.001361842),
    ("Supermarket/Grocery Store", 0.02381, 0.006755190),
    ("Transportation Terminal/Station", 0.00426, 0.000571669),
    ("Urgent Care/Clinic/Other Outpatient", 0.01181, 0.005772375),
    ("Vocational School", 0.00574, 0.004613122),
    ("Wholesale Club/Supercenter", 0.01138, 0.004264962),
    ("Worship Facility", 0.00574, 0.001230602),
)
#: [fuel id, label in the rule, tCO2e per kBtu], 1 RCNY §103-14(d)(3)(i)(a), calendar years 2024–2034.
OTHER_FUELS: tuple[tuple[str, str, float], ...] = (
    ("butane", "Butane", 0.00006502),
    ("butylene", "Butylene", 0.00006897),
    ("diesel", "Diesel", 0.00007421),
    ("distillate_fuel_oil_no_1", "Distillate Fuel Oil No. 1", 0.00007350),
    ("ethane", "Ethane", 0.00005985),
    ("ethylene", "Ethylene", 0.00006621),
    ("gasoline", "Gasoline", 0.00007047),
    ("isobutane", "Isobutane", 0.00006519),
    ("isobutylene", "Isobutylene", 0.00006911),
    ("kerosene", "Kerosene", 0.00007769),
    ("naphtha_below_401f", "Naphtha (< 401 deg F)", 0.00006827),
    ("other_oil_above_401f", "Other Oil (> 401 deg F)", 0.00007647),
    ("pentanes_plus", "Pentanes Plus", 0.00007027),
    ("propane", "Propane", 0.00006425),
    ("propylene", "Propylene", 0.00006802),
    ("special_naphtha", "Special Naphtha", 0.00007259),
    ("coke_oven_gas", "Coke Oven Gas", 0.00004689),
    ("fuel_gas", "Fuel Gas", 0.00005925),
    ("biofuel", "Biofuel", 0.00007389),
)

_LL97 = "https://www.nyc.gov/assets/buildings/local_laws/ll97of2019.pdf"
_LL147 = "https://www.nyc.gov/assets/buildings/local_laws/ll147of2019.pdf"
_RCNY = "https://www.nyc.gov/assets/buildings/rules/1_RCNY_103-14.pdf"
_RETRIEVED = "2026-11-03"

META: dict[str, Any] = {
    "id": "rules.nyc.ll97_building_emissions",
    "version": 1,
    "jurisdiction": "us-ny-nyc",
    "title": "NYC Local Law 97 building emissions limit, emissions and penalty",
    "citations": [
        {"law": "NYC Admin. Code §28-320.1 (definition of covered building)", "url": _LL97, "retrieved": _RETRIEVED,
         "covers": "the 25,000 gross square foot size test"},
        {"law": "NYC Admin. Code §28-320.3.1.1 (as amended by L.L. 147 of 2019)", "url": _LL147,
         "retrieved": _RETRIEVED,
         "covers": "2024–2029 coefficients: utility electricity, natural gas, #2 and #4 fuel oil, district steam"},
        {"law": "NYC Admin. Code §28-320.6", "url": _LL97, "retrieved": _RETRIEVED,
         "covers": "penalty of $268 per tCO2e over the limit"},
        {"law": "1 RCNY §103-14(c)(3)(i), (iii)", "url": _RCNY, "retrieved": _RETRIEVED,
         "covers": "emissions factors by ESPM property type for 2024–2029 and 2030–2034"},
        {"law": "1 RCNY §103-14(d)(2), (d)(4)(i)", "url": _RCNY, "retrieved": _RETRIEVED,
         "covers": "limit = Σ factor × floor area (Equation 103-14.1); emissions = Σ energy × coefficient "
                   "(Equation 103-14.13)"},
        {"law": "1 RCNY §103-14(d)(3)(i)–(ii)", "url": _RCNY, "retrieved": _RETRIEVED,
         "covers": "coefficients for other fuels (2024–2034) and for utility electricity, natural gas, district steam "
                   "and #2/#4 oil (2030–2034)"},
        {"law": "1 RCNY §103-14(h)", "url": _RCNY, "retrieved": _RETRIEVED,
         "covers": "penalty = (actual emissions − limit) × $268"},
    ],
    "verification": {
        "status": "draft",
        "notes": (
            "Drafted from Local Laws 97 and 147 of 2019 (nyc.gov) and the DOB compilation of 1 RCNY §103-14 "
            "(effective through the amendment of 2025-01-19), retrieved 2026-11-03. The codified Admin. Code text was "
            "not read: confirm no later local law changed §28-320.3 or §28-320.6. Not checked by a named maintainer."
        ),
    },
    "not_covered": [
        "the occupancy-group election for 2024 and 2025 in 1 RCNY §103-14(c)(3)(ii)",
        "time-of-use electricity coefficients, campus-style systems, distributed energy resources, fuel cells and "
        "beneficial electrification (§103-14(d)(3)(iii)–(vii), (d)(4)(iii))",
        "deductions for renewable energy credits, clean distributed energy, offsets and EV charging "
        "(§103-14(d)(4)(ii), (e))",
        "covered-building exceptions, multi-building tax lots and condominiums (§28-320.1), and Article 321 buildings",
        "adjustments under §28-320.7 to §28-320.9, penalty mitigation under §103-14(i), and the late-report penalty in "
        "§103-14(g)",
        "calendar years after 2034",
    ],
}

_PROPERTY_TYPES = tuple(r[0] for r in EMISSIONS_FACTORS)
_FUELS = {r[0]: r for r in OTHER_FUELS}
_ENERGY_KEYS = ("utility_electricity_kwh", "natural_gas_kbtu", "fuel_oil_2_kbtu", "fuel_oil_4_kbtu",
                "district_steam_kbtu", "other_fuels")
_PENALTY_PER_TCO2E = 268
_COEFFICIENTS = {
    "2024-2029": {"utility_electricity_kwh": 0.000288962, "natural_gas_kbtu": 0.00005311,
                  "fuel_oil_2_kbtu": 0.00007421, "fuel_oil_4_kbtu": 0.00007529, "district_steam_kbtu": 0.00004493},
    "2030-2034": {"utility_electricity_kwh": 0.000145, "natural_gas_kbtu": 0.00005311,
                  "fuel_oil_2_kbtu": 0.00007421, "fuel_oil_4_kbtu": 0.00007529, "district_steam_kbtu": 0.0000432},
}


def _quantity(d: dict[str, Any], key: str, path: str) -> Any:
    return number(d, key, path, optional=True, ge=0, le=1e13)


def nyc_ll97_building_emissions(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    strict(d, ("calendar_year", "spaces", "energy"))
    year = number(d, "calendar_year", integer=True, ge=2024, le=2034)
    spaces_in = []
    for i, s in enumerate(array(d, "spaces", min_len=1, max_len=100)):
        p = f"spaces.{i}"
        s = obj(s, p)
        strict(s, ("property_type", "floor_area_sf"), p)
        spaces_in.append((enum(s, "property_type", _PROPERTY_TYPES, p),
                          number(s, "floor_area_sf", p, gt=0, le=1e8)))
    if "energy" not in d:
        fail("energy", "required")
    e = obj(d["energy"], "energy")
    strict(e, _ENERGY_KEYS, "energy")
    energy = {k: _quantity(e, k, "energy") for k in _ENERGY_KEYS[:-1]}
    others = []
    if "other_fuels" in e:
        for i, f in enumerate(array(e, "other_fuels", "energy", max_len=40)):
            p = f"energy.other_fuels.{i}"
            f = obj(f, p)
            strict(f, ("fuel", "kbtu"), p)
            others.append((enum(f, "fuel", tuple(_FUELS), p), number(f, "kbtu", p, ge=0, le=1e13)))

    t = Trace()
    period = "2024-2029" if year <= 2029 else "2030-2034"
    t.step("Compliance period", period, "§28-320.3.1 / §28-320.3.2")

    limit = 0.0
    gfa = 0.0
    by_space = []
    for name, area in spaces_in:
        row = next(r for r in EMISSIONS_FACTORS if r[0] == name)
        factor = row[1] if period == "2024-2029" else row[2]
        part = factor * area
        limit += part
        gfa += area
        by_space.append({"property_type": name, "floor_area_sf": area, "emissions_factor_tco2e_per_sf": factor,
                         "limit_tco2e": round_(part, 4)})
    limit_r = round_(limit, 4)
    t.step("Annual building emissions limit", limit_r,
           " + ".join(f"{_n(s['emissions_factor_tco2e_per_sf'])} × {_n(s['floor_area_sf'])} sf" for s in by_space), "tCO2e")

    coef = _COEFFICIENTS[period]
    sources: list[dict[str, Any]] = []
    emissions = 0.0

    def add(source: str, quantity: Any, unit: str, g: float) -> None:
        nonlocal emissions
        if quantity is None:
            return
        x = quantity * g
        emissions += x
        sources.append({"source": source, "quantity": quantity, "unit": unit, "coefficient_tco2e_per_unit": g,
                        "emissions_tco2e": round_(x, 4)})

    add("utility_electricity", energy["utility_electricity_kwh"], "kWh", coef["utility_electricity_kwh"])
    add("natural_gas", energy["natural_gas_kbtu"], "kBtu", coef["natural_gas_kbtu"])
    add("fuel_oil_2", energy["fuel_oil_2_kbtu"], "kBtu", coef["fuel_oil_2_kbtu"])
    add("fuel_oil_4", energy["fuel_oil_4_kbtu"], "kBtu", coef["fuel_oil_4_kbtu"])
    add("district_steam", energy["district_steam_kbtu"], "kBtu", coef["district_steam_kbtu"])
    for fuel, kbtu in others:
        add(fuel, kbtu, "kBtu", _FUELS[fuel][2])
    emissions_r = round_(emissions, 4)
    t.step("Annual building emissions", emissions_r,
           " + ".join(f"{_n(s['quantity'])} {s['unit']} × {_n(s['coefficient_tco2e_per_unit'])}" for s in sources)
           if sources else "no energy reported", "tCO2e")
    if not sources:
        t.warn("No energy use was given, so emissions are zero; all energy consumed on the premises must be included "
               "(§103-14(d)(4)(ii)).")

    excess = max(0.0, round_(emissions_r - limit_r, 4))
    t.step("Excess over the limit", excess, f"max(0, {_n(emissions_r)} − {_n(limit_r)})", "tCO2e")
    penalty = round_(excess * _PENALTY_PER_TCO2E, 2)
    t.step("Penalty", penalty, f"{_n(excess)} tCO2e × $268", "USD")
    if penalty > 0:
        t.warn('§28-320.6 caps the penalty at this amount ("not more than"); 1 RCNY §103-14(h) sets it at this amount, '
               "subject to mitigation under §103-14(i) and the factors in §28-320.6.1. Deductions and adjustments are "
               "not modelled.")
    if gfa <= 25000:
        t.warn("Floor area is 25,000 sf or less: a single building this size is not a covered building, but two or "
               "more buildings on one tax lot, or condominium buildings under one board, over 50,000 sf together are "
               "(§28-320.1).")
    if year <= 2025:
        t.warn("For 2024 and 2025 an owner may instead use the occupancy-group limits in §28-320.3.1 where they are "
               "higher (1 RCNY §103-14(c)(3)(ii)); this pack uses the property-type factors only.")
    t.warn("Rounding: components and totals are rounded to 0.0001 tCO2e and the penalty to the cent; the law does not "
           "specify rounding.")

    return draft_result(t, META, {
        "calendar_year": year,
        "compliance_period": period,
        "gross_floor_area_sf": gfa,
        "exceeds_25000_gsf": gfa > 25000,
        "limit_by_space": by_space,
        "emissions_limit_tco2e": limit_r,
        "emissions_by_source": sources,
        "building_emissions_tco2e": emissions_r,
        "excess_emissions_tco2e": excess,
        "within_limit": emissions_r <= limit_r,
        "penalty_usd": penalty,
    })
