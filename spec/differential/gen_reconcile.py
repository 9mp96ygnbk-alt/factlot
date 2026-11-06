"""Random inputs for the tie-out calculators (reconcile_dcf, reconcile_cam), on their own random stream.

The other system's side is FactLot's own output (from the Python SDK) changed in random ways: a line
scaled, compounded, shifted a year, offset, zeroed, negated, rounded or perturbed, labels renamed to the
default names or left unmapped, deductions shown positive; and for CAM, rows from FactLot's statements
with shares, fees, caps or charges changed. Both SDKs must agree on every result, likely cause and text.
Some inputs are deliberately invalid.
"""
import copy
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "src"))
from factlot import CalcInputError, cam_reconciliation_batch, dcf_pro_forma  # noqa: E402
from factlot.reconcile import DCF_LINES, DEFAULT_LINE_LABELS  # noqa: E402
from gen_operations import cam_batch  # noqa: E402
from gen_valuation import dcf  # noqa: E402

DEFAULT_NAMES = {}
for label, line in DEFAULT_LINE_LABELS:
    DEFAULT_NAMES.setdefault(line, []).append(label)


def _perturb(r, vals):
    kind = r.choice(["same", "same", "scale", "grow", "shift_later", "shift_earlier", "offset", "zero", "negate",
                     "cents", "noise", "one_year", "exit_year"])
    n = len(vals)
    if kind == "scale":
        k = r.choice([0.5, 0.9, 1.05, 1.1, round(r.uniform(0.5, 1.5), 3)])
        return [round(v * k, 2) for v in vals]
    if kind == "grow":
        g = r.choice([1.01, 1.03, 0.98])
        return [round(v * g ** i, 2) for i, v in enumerate(vals)]
    if kind == "shift_later":
        return [0.0, *vals[:-1]]
    if kind == "shift_earlier":
        return [*vals[1:], 0.0]
    if kind == "offset":
        return [round(v + r.choice([-5000, 1234.56, 10]), 2) for v in vals]
    if kind == "zero":
        return [0] * n
    if kind == "negate":
        return [-v for v in vals]
    if kind == "cents":
        return [round(v + r.choice([0.01, -0.03, 0.05]), 2) for v in vals]
    if kind == "noise":
        return [round(v * r.uniform(0.97, 1.03), 2) for v in vals]
    if kind == "one_year":
        i = r.randrange(n)
        return [round(v + (r.uniform(-5e4, 5e4) if j == i else 0), 2) for j, v in enumerate(vals)]
    if kind == "exit_year":
        return [*vals[:-1], round(vals[-1] * 1.07, 2)]
    return list(vals)


def reconcile_dcf_case(r):
    d = dcf(r)
    try:
        res = dcf_pro_forma(d)["value"]
    except CalcInputError:
        return {"dcf": d, "other": {"lines": [{"label": "NOI", "values": [1]}]}}
    rows = res["cash_flows"]
    positive = r.random() < 0.3
    lines = []
    for k in DCF_LINES:
        if r.random() < 0.15:
            continue
        vals = [row[k] for row in rows]
        if r.random() < 0.3:
            vals = _perturb(r, vals)
        if positive and k not in ("potential_base_rent", "expense_recoveries", "gross_revenue", "effective_gross_revenue",
                                  "net_operating_income", "cash_flow_before_debt"):
            vals = [-v for v in vals]
        if r.random() < 0.1:
            vals = vals[: r.randint(1, len(vals))]
        elif r.random() < 0.05:
            vals = [*vals, 1.0]
        label = r.choice([k, k.replace("_", " ").title(), *DEFAULT_NAMES.get(k, [])])
        lines.append({"label": label, "values": vals})
    if r.random() < 0.3:
        lines.append({"label": r.choice(["Parking Income", "Other Income", "Real Estate Taxes"]),
                      "values": [round(r.uniform(0, 1e5), 2) for _ in rows]})
    if r.random() < 0.2:
        lines.append({"label": "Absorption & Turnover Vacancy", "values": [round(r.uniform(0, 5e4), 2) for _ in rows]})
    if not lines:
        lines = [{"label": "NOI", "values": [row["net_operating_income"] for row in rows]}]
    r.shuffle(lines)
    other = {"lines": lines}
    if r.random() < 0.6:
        alt = d
        if r.random() < 0.5:
            alt = {**d, r.choice(["timing", "exit_noi_basis", "selling_cost_rate"]): None}
            key = next(k for k, v in alt.items() if v is None)
            alt[key] = {"timing": "mid_year" if d.get("timing") != "mid_year" else "end_of_year",
                        "exit_noi_basis": "trailing" if d.get("exit_noi_basis") != "trailing" else "forward",
                        "selling_cost_rate": 0}[key]
        try:
            a = dcf_pro_forma(alt)["value"]
            other["value"] = a["value"] if r.random() < 0.8 else round(a["value"] * 1.01, 2)
            if r.random() < 0.5:
                other["gross_sale_price"] = a["exit"]["gross_sale_price"]
            if r.random() < 0.5:
                other["net_sale_proceeds"] = a["exit"]["net_sale_proceeds"]
            if r.random() < 0.5 and a["unlevered_irr"] is not None:
                other["unlevered_irr"] = round(a["unlevered_irr"] + r.choice([0, 0, 0.002]), 6)
        except CalcInputError:
            pass
    if r.random() < 0.3:
        other["system"] = "synthetic"
    inp = {"dcf": d, "other": other}
    if r.random() < 0.3:
        inp["sign_convention"] = r.choice(["auto", "as_reported", "deductions_positive"])
    if r.random() < 0.3:
        inp["tolerance"] = {"absolute": r.choice([0, 0.01, 1, 100]), "relative": r.choice([0, 0.0001, 0.01])}
    if r.random() < 0.3:
        targets = [*DCF_LINES, "turnover_vacancy", "ignore"]
        inp["mapping"] = [{"label": l["label"], "line": r.choice(targets)} for l in r.sample(lines, min(len(lines), 2))]
        if r.random() < 0.2:
            inp["mapping"].append({"label": "no such line", "line": "free_rent"})
    bad = r.random()
    if bad < 0.02:
        lines.append({"label": lines[0]["label"].upper() + "!", "values": [1]})
    elif bad < 0.03:
        lines[0]["values"] = []
    return inp


def reconcile_cam_case(r):
    cam = cam_batch(r)
    if r.random() < 0.4:
        for e in cam["expenses"]:
            if r.random() < 0.5:
                e.pop("controllable", None)
        if r.random() < 0.5:
            old, new = cam["expenses"][0]["category"], r.choice(["Real estate taxes", "Insurance", "Utilities"])
            cam["expenses"][0]["category"] = new
            for t in cam["tenants"]:
                for key in ("excluded_categories", "admin_fee_excluded_categories"):
                    if key in t:
                        t[key] = [new if c == old else c for c in t[key]]
    try:
        res = cam_reconciliation_batch(cam)["value"]
    except CalcInputError:
        return {"cam": cam, "other": {"tenants": [{"tenant": "X", "billed_amount": 1}]}}
    rows = []
    k = r.choice([1, 1, 0.96, 1.04])
    for i, t in enumerate(res["tenants"]):
        if r.random() < 0.1:
            continue
        v = t["statement"]["value"]
        share = cam["tenants"][i]["pro_rata_share"]
        row = {"tenant": t["name"] if r.random() < 0.9 else t["name"].upper(), "billed_amount": v["tenant_charge"]}
        for key, fk in (("grossed_up_expenses", "grossed_up_expenses"), ("cap_limit", "cap_limit"),
                        ("cap_reduction", "cap_reduction"), ("admin_fee", "admin_fee"),
                        ("structure_deduction", "structure_deduction"), ("estimates_paid", "estimates_paid"),
                        ("balance_due", "balance_due")):
            if v[fk] is not None and r.random() < 0.5:
                row[key] = v[fk]
        if r.random() < 0.5:
            row["pro_rata_share"] = min(1, round(share * k, 6))
        for key, val in (("gross_up_applied", v["grossed_up_expenses"] > v["recoverable_expenses"]),
                         ("cap_applied", v["cap_reduction"] > 0), ("admin_fee_applied", v["admin_fee"] > 0)):
            if r.random() < 0.3:
                row[key] = val if r.random() < 0.9 else not val
        if r.random() < 0.3:
            for key in ("billed_amount", "admin_fee", "cap_limit", "estimates_paid"):
                if key in row and r.random() < 0.5:
                    row[key] = max(0, round(row[key] * r.uniform(0.9, 1.1), 2))
        rows.append(row)
    if r.random() < 0.1:
        rows.append({"tenant": "Nobody", "billed_amount": 10})
    if not rows:
        rows = [{"tenant": "Nobody", "billed_amount": 10}]
    other = {"tenants": rows}
    if r.random() < 0.3:
        other["pool"] = "CAM"
    inp = {"cam": cam, "other": other}
    if r.random() < 0.3:
        inp["tolerance"] = {"absolute": r.choice([0, 0.01, 1]), "share": r.choice([0, 0.000001, 0.001])}
    if r.random() < 0.02:
        rows.append(copy.deepcopy(rows[0]))
    return inp


def reconcile_cases(seed, count):
    r = random.Random(f"reconcile-{seed}")
    out = []
    for _ in range(max(1, count // 8)):
        k = r.choice(["reconcile_dcf", "reconcile_cam"])
        inp = reconcile_dcf_case(r) if k == "reconcile_dcf" else reconcile_cam_case(r)
        if r.random() < 0.1:
            args = copy.deepcopy(inp)
            if r.random() < 0.4:
                args["tolerence"] = 1
            elif r.random() < 0.4 and k == "reconcile_dcf":
                args["dcf"]["discount_rate"] = 8
            out.append({"tool": f"calc_{k}", "arguments": args})
        else:
            out.append({"calc": k, "input": inp})
    return out
