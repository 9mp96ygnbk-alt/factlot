"""Random inputs for the draft rules packs in the TypeScript/Python differential test, on their own random
stream so the other cases stay as they were. Mostly valid inputs with awkward areas and energy amounts, plus
some invalid ones (both SDKs must reject the same inputs)."""

import json
import random
from pathlib import Path

TABLES = Path(__file__).resolve().parents[1] / "vectors" / "rules" / "drafts"


def _tables(name):
    return json.loads((TABLES / f"{name}.tables.json").read_text("utf-8"))


def _amount(r, hi):
    return r.choice([0, r.randint(1, int(hi)), round(r.uniform(0, hi), r.choice([0, 1, 2, 3, 6]))])


def draft_cases(seed, count):
    r = random.Random(f"drafts-{seed}")
    nyc = _tables("nyc_ll97")
    types = [t["property_type"] for t in nyc["emissions_factors_tco2e_per_sf"]]
    fuels = [f["fuel"] for f in nyc["other_fuels_tco2e_per_kbtu"]]
    wa = [a["no"] for a in _tables("wa_cbps")["activities"]]
    uses = [u["building_use"] for u in _tables("boston_berdo")["standards_kgco2e_per_sf"]]
    out = []
    for _ in range(max(1, count // 3)):
        energy = {}
        for k in ("utility_electricity_kwh", "natural_gas_kbtu", "fuel_oil_2_kbtu", "fuel_oil_4_kbtu",
                  "district_steam_kbtu"):
            if r.random() < 0.6:
                energy[k] = _amount(r, 2e7)
        if r.random() < 0.3:
            energy["other_fuels"] = [{"fuel": r.choice(fuels), "kbtu": _amount(r, 1e6)} for _ in range(r.randint(0, 4))]
        inp = {"calendar_year": r.randint(2024, 2034),
               "spaces": [{"property_type": r.choice(types), "floor_area_sf": _amount(r, 5e5) or 1}
                          for _ in range(r.randint(1, 6))],
               "energy": energy}
        if r.random() < 0.05:
            inp["calendar_year"] = r.choice([2023, 2035, 2030.5])
        if r.random() < 0.03:
            inp["spaces"][0]["floor_area_sf"] = r.choice([0, -5])
        out.append({"draft": "nyc_ll97_building_emissions", "input": inp})

        spaces = []
        for _ in range(r.randint(1, 5)):
            s = {"activity": r.choice(wa), "floor_area_sf": _amount(r, 3e5) or 1,
                 "weekly_operating_hours": r.choice([0, 40, 50, 51, 100, 167, 168, r.randint(0, 168)])}
            if r.random() < 0.4:
                s["more_recently_built"] = r.random() < 0.5
            spaces.append(s)
        inp = {"climate_zone": r.choice(["4C", "5B", "5C", "6B"]), "spaces": spaces}
        if r.random() < 0.7:
            inp["weather_normalized_eui"] = round(r.uniform(0, 300), r.choice([0, 1, 2]))
        if r.random() < 0.6:
            nonres = r.choice([0, 20000, 50000, 50001, r.randint(0, 400000)])
            mf = r.choice([0, 20000, 50000, r.randint(0, 200000)])
            inp["coverage"] = {"nonresidential_hotel_motel_dormitory_sf": nonres, "multifamily_residential_sf": mf,
                               "gross_floor_area_sf": r.choice([nonres + mf or 1, 90000, 90001, 220000, 220001])}
        out.append({"draft": "wa_cbps_eui_target", "input": inp})

        inp = {"building_use": r.choice(uses), "gross_floor_area_sf": _amount(r, 1e6) or 1,
               "calendar_year": r.choice([2025, 2029, 2030, 2049, 2050, r.randint(2024, 2100)])}
        if r.random() < 0.7:
            inp["emissions_tco2e"] = _amount(r, 1e4)
        out.append({"draft": "boston_berdo_emissions_standard", "input": inp})
    return out
