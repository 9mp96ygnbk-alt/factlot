"""Hotel: calc_hotel_metrics for a full year and for a month with rooms out of order."""

from __future__ import annotations

from common import Recon, readme_sheet, run
from xlsx_lite import Workbook

FILENAME = "hotel-metrics.xlsx"

CONVENTIONS = [
    "Rooms available = rooms x nights - room-nights out of order (rooms x nights, not rooms). Occupancy = rooms sold / rooms available. "
    "FactLot follows USALI 11th edition in keeping short-term out-of-order rooms in rooms available; enter only room-nights formally removed from sale.",
    "ADR = rooms revenue / rooms sold. RevPAR = rooms revenue / rooms available. TRevPAR = total operating revenue / rooms available. "
    "GOPPAR = GOP / rooms available.",
    "Profit ladder (USALI-style): total revenue - departmental expenses = departmental profit; - undistributed expenses = GOP; - management fee "
    "(revenue x rate + fixed) = income before non-operating; - non-operating expenses = EBITDA; - FF&E reserve (revenue x rate) = NOI.",
    "Rounding: occupancy, margins to 4 decimals; every dollar amount and per-room figure to cents. Each rung is computed from the rounded rung above it, as FactLot does.",
]

# SYNTHETIC hotels. Each scenario: keys follow calc_hotel_metrics.
SCENARIOS = [
    dict(sheet="Hotel_1", title="Synthetic 148-key select-service hotel, full year (365 nights)",
         nights=365, rooms=148, rooms_out_of_order=1480, rooms_sold=39420, room_revenue=5_076_300.00, fb_revenue=412_800.00,
         other_revenue=186_450.00, departmental_expenses=1_890_000.00, undistributed_expenses=1_245_000.00,
         management_fee_rate=0.03, management_fee_fixed=25_000.00, non_operating_expenses=612_000.00, ffe_reserve_rate=0.04),
    dict(sheet="Hotel_2", title="Synthetic 220-key full-service hotel, one 30-night month, 20 rooms closed for renovation",
         nights=30, rooms=220, rooms_out_of_order=600, rooms_sold=4410, room_revenue=823_700.50, fb_revenue=301_250.75,
         other_revenue=64_900.00, departmental_expenses=655_400.00, undistributed_expenses=288_000.00,
         management_fee_rate=0.025, management_fee_fixed=0.0, non_operating_expenses=74_000.00, ffe_reserve_rate=0.035),
]
INPUTS = [
    ("nights", "Nights in the period", "in_int"), ("rooms", "Rooms (keys)", "in_int"),
    ("rooms_out_of_order", "Room-nights out of order", "in_int"), ("rooms_sold", "Rooms sold (room-nights)", "in_int"),
    ("room_revenue", "Rooms revenue", "in_money"), ("fb_revenue", "F&B revenue", "in_money"), ("other_revenue", "Other revenue", "in_money"),
    ("departmental_expenses", "Departmental expenses", "in_money"), ("undistributed_expenses", "Undistributed expenses", "in_money"),
    ("management_fee_rate", "Management fee rate (of revenue)", "in_pct"), ("management_fee_fixed", "Management fee fixed amount", "in_money"),
    ("non_operating_expenses", "Non-operating expenses (taxes, insurance, ground rent)", "in_money"),
    ("ffe_reserve_rate", "FF&E reserve rate (of revenue)", "in_pct"),
]
OUT = [  # key, label, unit, style
    ("rooms_available", "Rooms available", "room-nights", "int"), ("occupancy", "Occupancy", "ratio", "num4"), ("adr", "ADR", "USD", "money"),
    ("revpar", "RevPAR", "USD", "money"), ("total_revenue", "Total operating revenue", "USD", "money"), ("trevpar", "TRevPAR", "USD", "money"),
    ("departmental_profit", "Departmental profit", "USD", "money"), ("gop", "GOP", "USD", "money"), ("gop_margin", "GOP margin", "ratio", "num4"),
    ("goppar", "GOPPAR", "USD", "money"), ("management_fee", "Management fee", "USD", "money"),
    ("income_before_non_operating", "Income before non-operating", "USD", "money"), ("ebitda", "EBITDA", "USD", "money"),
    ("ffe_reserve", "FF&E reserve", "USD", "money"), ("noi", "NOI (EBITDA less reserve)", "USD", "money"), ("noi_margin", "NOI margin", "ratio", "num4"),
]


def build() -> tuple[Workbook, Recon]:
    results = [run("calc_hotel_metrics", {k: v for k, v in s.items() if k not in ("sheet", "title")}) for s in SCENARIOS]
    wb = Workbook("FactLot reconciliation: hotel metrics (synthetic)")
    readme_sheet(
        wb,
        "Hotel: occupancy, ADR, RevPAR and the USALI-style profit ladder",
        ["Two synthetic hotel periods (a full year and a 30-night month with 20 rooms closed) go through calc_hotel_metrics. "
         "Each Excel sheet rebuilds the 16 reported figures from the blue inputs."],
        [("calc_hotel_metrics", results[0])],
        CONVENTIONS,
        ["This is an arithmetic reconciliation of FactLot's formulas. It does not check a hotel's own statements against USALI classification."],
    )
    rec = Recon(wb)
    for s, res in zip(SCENARIOS, results):
        sh = wb.sheet(s["sheet"])
        sh.width(1, 52)
        sh.width(2, 22)
        sh.put(1, 1, s["title"], "title")
        sh.put(2, 1, "SYNTHETIC. Blue on yellow = inputs; the rest are live formulas.", "warn")
        R: dict[str, str] = {}
        r = 4
        for k, lab, st in INPUTS:
            sh.put(r, 1, lab, "text")
            R[k] = sh.put(r, 2, s[k], st)
            r += 1
        r += 1
        sh.put(r, 1, "Calculated", "bold")
        r += 1
        f = {
            "rooms_available": f"={R['rooms']}*{R['nights']}-{R['rooms_out_of_order']}",
            "occupancy": "=ROUND({rooms_sold}/{rooms_available},4)",
            "adr": "=ROUND({room_revenue}/{rooms_sold},2)",
            "revpar": "=ROUND({room_revenue}/{rooms_available},2)",
            "total_revenue": "=ROUND({room_revenue}+{fb_revenue}+{other_revenue},2)",
            "trevpar": "=ROUND({total_revenue}/{rooms_available},2)",
            "departmental_profit": "=ROUND({total_revenue}-{departmental_expenses},2)",
            "gop": "=ROUND({departmental_profit}-{undistributed_expenses},2)",
            "gop_margin": "=ROUND({gop}/{total_revenue},4)",
            "goppar": "=ROUND({gop}/{rooms_available},2)",
            "management_fee": "=ROUND({total_revenue}*{management_fee_rate}+{management_fee_fixed},2)",
            "income_before_non_operating": "=ROUND({gop}-{management_fee},2)",
            "ebitda": "=ROUND({income_before_non_operating}-{non_operating_expenses},2)",
            "ffe_reserve": "=ROUND({total_revenue}*{ffe_reserve_rate},2)",
            "noi": "=ROUND({ebitda}-{ffe_reserve},2)",
            "noi_margin": "=ROUND({noi}/{total_revenue},4)",
        }
        for k, lab, unit, st in OUT:
            sh.put(r, 1, lab, "text")
            R[k] = sh.put(r, 2, f[k].format(**R), st)
            r += 1
        rec.section(s["title"])
        for k, lab, unit, st in OUT:
            rec.add(lab, unit, f"={R[k]}", res["value"][k], k, st)
    rec.finish()
    return wb, rec
