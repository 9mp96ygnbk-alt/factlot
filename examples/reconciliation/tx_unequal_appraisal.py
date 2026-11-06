"""Texas unequal appraisal: calc_tx_unequal_appraisal as an adjustment grid with live Excel formulas.

Built from the synthetic scenarios below, or from your own calc_tx_unequal_appraisal arguments:

    python3 examples/reconciliation/build.py tx_unequal_appraisal --input evidence.json --out evidence.xlsx

Either way it is an evidence calculation, not an appraisal or an opinion of value (Occupations Code
§1103.003(1)), not legal or tax advice, and not a substitute for the advice of an attorney.
"""

from __future__ import annotations

from common import Recon, readme_sheet, run
from xlsx_lite import Workbook

FILENAME = "tx-unequal-appraisal-evidence.xlsx"

NOTICE = (
    "Evidence calculation only: arithmetic on the values and adjustments supplied. It is not an appraisal or an opinion "
    "of value (Occupations Code §1103.003(1)), it is not legal or tax advice, and it is not a substitute for the advice "
    "of an attorney. It does not say whether to protest or what value to claim. FactLot does not represent property owners."
)

CONVENTIONS = [
    "Normalization: with normalize_by set to an area, each comparable becomes value ÷ its area × the subject's same area, "
    "rounded to the cent. With none, the comparable's value is used whole.",
    "Percentage adjustments are decimals (0.05 = +5%). sum adds a comparable's percentages and applies 1 + total once; "
    "compound multiplies (1 + each). The factor is rounded to 6 decimals, then normalized × factor is rounded to the cent.",
    "USD amount adjustments, then $/SF adjustments × the subject's normalizing area, are added after the percentages; "
    "the adjusted value is rounded to the cent.",
    "The median is Excel's MEDIAN of the adjusted values: the middle value, or for an even count the mean of the two "
    "middle values, rounded to the cent. Subject minus median is in USD and as a share of the median (6 decimals).",
    "Every adjustment and its reason is the user's (or their consultant's or attorney's). The workbook does not choose "
    "comparables or adjustments.",
]

# SYNTHETIC properties: no real parcel, value or address. Keys follow calc_tx_unequal_appraisal.
SCENARIOS = [
    dict(
        sheet="Grid_1",
        title="Synthetic office building, 7 comparables, normalized by building area, percentages summed",
        args={
            "tax_year": 2027,
            "subject": {"id": "SUBJECT", "county_fips": "999", "value": 6_480_000, "value_basis": "appraised",
                        "improvement_area_sf": 48_000},
            "normalize_by": "improvement_area_sf",
            "adjustment_combine": "sum",
            "comparables": [
                {"id": "COMP-A", "county_fips": "999", "value": 5_120_000, "value_basis": "appraised", "improvement_area_sf": 42_500,
                 "adjustments": [{"label": "age", "kind": "percent", "value": 0.04, "reason": "comparable built 8 years earlier"},
                                 {"label": "size", "kind": "percent", "value": -0.02, "reason": "comparable 11% smaller"}]},
                {"id": "COMP-B", "county_fips": "999", "value": 7_350_000, "value_basis": "appraised", "improvement_area_sf": 55_200,
                 "adjustments": [{"label": "location", "kind": "percent", "value": -0.05, "reason": "comparable on a freeway frontage"}]},
                {"id": "COMP-C", "county_fips": "999", "value": 5_900_000, "value_basis": "appraised", "improvement_area_sf": 47_100,
                 "adjustments": []},
                {"id": "COMP-D", "county_fips": "999", "value": 4_310_000, "value_basis": "appraised", "improvement_area_sf": 36_800,
                 "adjustments": [{"label": "condition", "kind": "percent", "value": 0.06, "reason": "comparable roof replaced"},
                                 {"label": "parking", "kind": "amount", "value": -45_000, "reason": "comparable has a structured garage"}]},
                {"id": "COMP-E", "county_fips": "999", "value": 6_020_000, "value_basis": "appraised", "improvement_area_sf": 50_300,
                 "adjustments": [{"label": "age", "kind": "percent", "value": -0.03, "reason": "comparable built 5 years later"}]},
                {"id": "COMP-F", "county_fips": "999", "value": 5_450_000, "value_basis": "appraised", "improvement_area_sf": 44_900,
                 "adjustments": [{"label": "class", "kind": "percent", "value": 0.02, "reason": "district class code one step lower"}]},
                {"id": "COMP-G", "county_fips": "999", "value": 6_890_000, "value_basis": "appraised", "improvement_area_sf": 51_700,
                 "adjustments": []},
            ],
        },
    ),
    dict(
        sheet="Grid_2",
        title="Synthetic industrial site, 6 comparables, normalized by land area, percentages compounded, $/SF adjustments",
        args={
            "tax_year": 2027,
            "subject": {"id": "SUBJECT", "county_fips": "999", "value": 2_640_000, "value_basis": "market",
                        "land_area_sf": 217_800},
            "normalize_by": "land_area_sf",
            "adjustment_combine": "compound",
            "comparables": [
                {"id": "COMP-1", "county_fips": "999", "value": 2_210_000, "value_basis": "market", "land_area_sf": 196_020,
                 "adjustments": [{"label": "access", "kind": "percent", "value": 0.03, "reason": "comparable has rail access"},
                                 {"label": "shape", "kind": "percent", "value": -0.04, "reason": "comparable is a flag lot"}]},
                {"id": "COMP-2", "county_fips": "999", "value": 3_080_000, "value_basis": "market", "land_area_sf": 261_360,
                 "adjustments": [{"label": "utilities", "kind": "psf", "value": -0.35, "reason": "comparable has sewer at the line"}]},
                {"id": "COMP-3", "county_fips": "999", "value": 2_475_000, "value_basis": "market", "land_area_sf": 230_868,
                 "adjustments": []},
                {"id": "COMP-4", "county_fips": "999", "value": 1_960_000, "value_basis": "market", "land_area_sf": 174_240,
                 "adjustments": [{"label": "flood", "kind": "percent", "value": 0.05, "reason": "part of comparable in a floodplain"},
                                 {"label": "frontage", "kind": "amount", "value": -12_500, "reason": "comparable has two frontages"}]},
                {"id": "COMP-5", "county_fips": "999", "value": 2_905_000, "value_basis": "market", "land_area_sf": 239_580,
                 "adjustments": [{"label": "detention", "kind": "psf", "value": 0.2, "reason": "comparable needs on-site detention"}]},
                {"id": "COMP-6", "county_fips": "999", "value": 2_330_000, "value_basis": "market", "land_area_sf": 204_732,
                 "adjustments": [{"label": "zoning", "kind": "percent", "value": -0.02, "reason": "comparable allows outdoor storage"}]},
            ],
        },
    ),
]


def _range(a: str, b: str) -> str:
    """A range from two absolute references on the same sheet (Sheet!$A$1:$B$2)."""
    return f"{a}:{b.split('!')[-1]}"


def grid_sheet(wb: Workbook, rec: Recon, sheet: str, title: str, args: dict, res: dict, synthetic: bool) -> None:
    v = res["value"]
    by = args.get("normalize_by", "none")
    combine = args.get("adjustment_combine", "sum")
    comps = args["comparables"]
    kmax = max([sum(1 for a in c.get("adjustments", []) if a["kind"] == "percent") for c in comps] + [0])
    amax = max([sum(1 for a in c.get("adjustments", []) if a["kind"] == "amount") for c in comps] + [0])
    pmax = max([sum(1 for a in c.get("adjustments", []) if a["kind"] == "psf") for c in comps] + [0])

    sh = wb.sheet(sheet)
    sh.put(1, 1, title, "title")
    sh.put(2, 1, ("SYNTHETIC. " if synthetic else "") + "Blue on yellow = inputs; the rest are live formulas. " + NOTICE, "warn")
    sh.put(4, 1, "Subject value", "text")
    subj_value = sh.put(4, 2, args["subject"]["value"], "in_money")
    sh.put(4, 3, args["subject"]["value_basis"], "in_text")
    subj_area = None
    if by != "none":
        sh.put(5, 1, f"Subject {by.replace('_sf', '').replace('_', ' ')} (SF)", "text")
        subj_area = sh.put(5, 2, args["subject"][by], "in_int")
    sh.put(6, 1, f"Normalize by: {by}. Percentages: {combine}.", "note")

    headers = ["Comparable", "Value", "Basis"] + (["Area (SF)"] if by != "none" else []) + ["Normalized"]
    headers += [f"% adj {i + 1}" for i in range(kmax)] + ["Factor", "After %"]
    headers += [f"USD adj {i + 1}" for i in range(amax)] + [f"$/SF adj {i + 1}" for i in range(pmax)]
    headers += ["Adjusted", "Total adj %"]
    hr = 8
    for i, h in enumerate(headers, 1):
        sh.put(hr, i, h, "header")
        sh.width(i, 22 if i == 1 else 14)

    adjusted_refs: list[str] = []
    r = hr + 1
    for ci, c in enumerate(comps):
        col = 1
        sh.put(r, col, c.get("id") or f"comparable {ci + 1}", "in_text")
        col += 1
        val = sh.put(r, col, c["value"], "in_money")
        col += 1
        sh.put(r, col, c["value_basis"], "in_text")
        col += 1
        if by != "none":
            area = sh.put(r, col, c[by], "in_int")
            col += 1
            norm = sh.put(r, col, f"=ROUND({val}/{area}*{subj_area},2)", "money")
        else:
            norm = sh.put(r, col, f"=ROUND({val},2)", "money")
        col += 1
        pcts = [a for a in c.get("adjustments", []) if a["kind"] == "percent"]
        pref = []
        for i in range(kmax):
            pref.append(sh.put(r, col, pcts[i]["value"] if i < len(pcts) else 0, "in_num4"))
            col += 1
        if not pref:
            ftxt = "=ROUND(1,6)"
        elif combine == "sum":
            ftxt = f"=ROUND(1+SUM({_range(pref[0], pref[-1])}),6)"
        else:
            ftxt = "=ROUND(PRODUCT(" + ",".join(f"1+{p}" for p in pref) + "),6)"
        factor = sh.put(r, col, ftxt, "num6")
        col += 1
        after = sh.put(r, col, f"=ROUND({norm}*{factor},2)", "money")
        col += 1
        amts = [a for a in c.get("adjustments", []) if a["kind"] == "amount"]
        aref = []
        for i in range(amax):
            aref.append(sh.put(r, col, amts[i]["value"] if i < len(amts) else 0, "in_money"))
            col += 1
        psfs = [a for a in c.get("adjustments", []) if a["kind"] == "psf"]
        sref = []
        for i in range(pmax):
            sref.append(sh.put(r, col, psfs[i]["value"] if i < len(psfs) else 0, "in_num4"))
            col += 1
        expr = after
        if aref:
            expr += f"+SUM({_range(aref[0], aref[-1])})"
        if sref:
            expr += f"+SUM({_range(sref[0], sref[-1])})*{subj_area}"
        adj = sh.put(r, col, f"=ROUND({expr},2)", "money")
        col += 1
        sh.put(r, col, f"=ROUND({adj}/{norm}-1,6)", "num6")
        adjusted_refs.append(adj)

        out = v["comparables"][ci]
        name = c.get("id") or f"comparable {ci + 1}"
        rec.add(f"{name}: normalized value", "USD", f"={norm}", out["normalized_value"], "normalized_value")
        rec.add(f"{name}: percentage factor", "factor", f"={factor}", out["percent_factor"], "percent_factor", "num6", 6)
        rec.add(f"{name}: adjusted value", "USD", f"={adj}", out["adjusted_value"], "adjusted_value")
        r += 1

    r += 1
    first, last = adjusted_refs[0], adjusted_refs[-1]
    sh.put(r, 1, "Median adjusted value", "bold")
    median = sh.put(r, 2, f"=ROUND(MEDIAN({_range(first, last)}),2)", "money")
    sh.put(r, 3, "the comparison figure in Tax Code §41.43(b)(3) and §42.26(a)(3)", "note")
    sh.put(r + 1, 1, "Subject value minus median", "bold")
    diff = sh.put(r + 1, 2, f"=ROUND({subj_value}-{median},2)", "money")
    sh.put(r + 2, 1, "Subject value minus median, share of median", "bold")
    pct = sh.put(r + 2, 2, f"=ROUND({diff}/{median},6)", "num6")
    rec.add("Median adjusted value", "USD", f"={median}", v["median_adjusted_value"], "median_adjusted_value")
    rec.add("Subject value minus median", "USD", f"={diff}", v["subject_minus_median"], "subject_minus_median")
    rec.add("Subject minus median, share of median", "ratio", f"={pct}", v["subject_minus_median_pct"],
            "subject_minus_median_pct", "num6", 6)

    r += 4
    sh.put(r, 1, "Adjustments and reasons (the user's)", "bold")
    r += 1
    for h, cc in zip(("Comparable", "Kind", "Label", "Value", "Reason"), range(1, 6)):
        sh.put(r, cc, h, "header")
    r += 1
    for ci, c in enumerate(comps):
        for a in c.get("adjustments", []):
            sh.put(r, 1, c.get("id") or f"comparable {ci + 1}", "text")
            sh.put(r, 2, a["kind"], "text")
            sh.put(r, 3, a["label"], "text")
            sh.put(r, 4, a["value"], "num4" if a["kind"] != "amount" else "money")
            sh.put(r, 5, a["reason"], "text")
            r += 1
    r += 1
    sh.put(r, 1, "FactLot warnings", "bold")
    r += 1
    for w in res["warnings"]:
        sh.put(r, 1, w, "note")
        r += 1


def build(args: dict | None = None) -> tuple[Workbook, Recon]:
    synthetic = args is None
    scenarios = SCENARIOS if synthetic else [dict(sheet="Grid", title="Unequal-appraisal evidence calculation", args=args)]
    results = [run("calc_tx_unequal_appraisal", s["args"]) for s in scenarios]
    wb = Workbook("FactLot evidence calculation: Texas unequal appraisal" + (" (synthetic)" if synthetic else ""))
    readme_sheet(
        wb,
        "Texas unequal appraisal: adjustment grid and median (evidence calculation)",
        [NOTICE,
         "Each grid rebuilds calc_tx_unequal_appraisal with live Excel formulas: every comparable's normalized and adjusted "
         "value, the median of the adjusted values, and the subject's value minus the median. The Reconcile sheet puts the "
         "Excel figures beside the numbers FactLot returned."],
        [("calc_tx_unequal_appraisal", results[0])],
        CONVENTIONS,
        ["To file, use the appraisal district's own protest process, yourself or through a property tax consultant registered "
         "with the Texas Department of Licensing and Regulation, or an attorney."],
        banner=("SYNTHETIC EXAMPLE. Every property, value and adjustment is made up for illustration." if synthetic else
                "Built from the inputs supplied. " + NOTICE),
        argus=False,
    )
    rec = Recon(wb)
    if not synthetic:
        rec.sh.put(2, 1, "Inputs as supplied. Excel column = live formulas on the Grid sheet. FactLot column = the number FactLot returned (recorded).", "note")
    for s, res in zip(scenarios, results):
        rec.section(s["title"])
        grid_sheet(wb, rec, s["sheet"], s["title"], s["args"], res, synthetic)
    rec.finish()
    return wb, rec
