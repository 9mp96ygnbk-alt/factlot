"""Tie-out calculators — Python port of @factlot/calc reconcile_dcf.ts and reconcile_cam.ts.

``reconcile_dcf`` compares FactLot's DCF with another system's annual cash-flow lines and
``reconcile_cam`` compares FactLot's CAM reconciliation with another system's per-tenant results.
Both name likely causes for differences from FactLot's own documented conventions, as hypotheses
to check. Same inputs, outputs, text and floating-point operation order as TypeScript; held to the
shared vectors in ``spec/vectors/calc`` and the differential test.

To turn a CSV or XLSX export into ``other.lines``, see ``factlot.reconcile_files``.
"""

from __future__ import annotations

import math
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
    fmt_pct,
    join,
    js_number_str,
    number,
    obj,
    pow_int,
    round_,
    string,
)

Result = dict[str, Any]

DCF_LINES = (
    "potential_base_rent",
    "free_rent",
    "expense_recoveries",
    "gross_revenue",
    "general_vacancy",
    "credit_loss",
    "effective_gross_revenue",
    "operating_expenses",
    "management_fee",
    "net_operating_income",
    "tenant_improvements",
    "leasing_commissions",
    "capital_reserves",
    "cash_flow_before_debt",
)
_TARGETS = (*DCF_LINES, "turnover_vacancy", "ignore")

#: Default label mappings: common CRE line names only, each overridable with ``mapping``. FactLot's own
#: line names always map to themselves. Generic terms, not any system's report layout.
DEFAULT_LINE_LABELS = (
    ("Potential Base Rent", "potential_base_rent"),
    ("Absorption & Turnover Vacancy", "turnover_vacancy"),
    ("Free Rent", "free_rent"),
    ("Base Rent Abatements", "free_rent"),
    ("Free Rent / Base Rent Abatements", "free_rent"),
    ("Expense Reimbursements", "expense_recoveries"),
    ("Expense Recoveries", "expense_recoveries"),
    ("Expense Reimbursements / Recoveries", "expense_recoveries"),
    ("General Vacancy", "general_vacancy"),
    ("Credit Loss", "credit_loss"),
    ("Effective Gross Revenue", "effective_gross_revenue"),
    ("Operating Expenses", "operating_expenses"),
    ("Total Operating Expenses", "operating_expenses"),
    ("Net Operating Income", "net_operating_income"),
    ("NOI", "net_operating_income"),
    ("Tenant Improvements", "tenant_improvements"),
    ("Leasing Commissions", "leasing_commissions"),
    ("Capital Reserves", "capital_reserves"),
    ("Cash Flow Before Debt Service", "cash_flow_before_debt"),
)

_UPPER = re.compile(r"[A-Z]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_label(label: str) -> str:
    """A label as compared: "&" read as "and", ASCII letters lowercased, other runs one space (``normalizeLabel``)."""
    s = _UPPER.sub(lambda m: m.group(0).lower(), label.replace("&", " and "))
    return _NON_ALNUM.sub(" ", s).strip(" ")


_DEFAULTS: dict[str, str] = {}
for _k in DCF_LINES:
    _DEFAULTS[normalize_label(_k)] = _k
for _label, _k in DEFAULT_LINE_LABELS:
    _DEFAULTS[normalize_label(_label)] = _k

_DEDUCTIONS = {"free_rent", "turnover_vacancy", "general_vacancy", "credit_loss", "operating_expenses", "management_fee",
               "tenant_improvements", "leasing_commissions", "capital_reserves"}

_PARTS = {
    "gross_revenue": ("potential_base_rent", "free_rent", "expense_recoveries"),
    "effective_gross_revenue": ("gross_revenue", "general_vacancy", "credit_loss"),
    "net_operating_income": ("effective_gross_revenue", "operating_expenses", "management_fee"),
    "cash_flow_before_debt": ("net_operating_income", "tenant_improvements", "leasing_commissions", "capital_reserves"),
}

_TITLE = {k: k.replace("_", " ") for k in DCF_LINES}

_MAX_HOLD_YEARS = 30


def _year_of(m: int) -> int:
    return (m - 1) // 12 + 1


def _close(a: float, b: float, tol: float) -> bool:
    return abs(round_(a - b, 2)) <= tol


def _list_of(xs: list[Any], max_: int = 10) -> str:
    xs = [str(x) for x in xs]
    return f"{', '.join(xs[:max_])} and {len(xs) - max_} more" if len(xs) > max_ else ", ".join(xs)


def _years_text(ys: list[int]) -> str:
    return f"{'year' if len(ys) == 1 else 'years'} {', '.join(str(y) for y in ys)}"


def _finite(v: Any, path: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        fail(path, "expected finite number")
    return v


def _label(d: dict[str, Any], key: str, path: str, optional: bool = False) -> Any:
    return string(d, key, path, optional=optional, min_len=1, max_len=200)


def _tolerance(d: dict[str, Any], extra: tuple[str, float] | None) -> dict[str, float]:
    tol = obj(d["tolerance"], "tolerance") if d.get("tolerance") is not None else {}
    out = {
        "absolute": number(tol, "absolute", "tolerance", default=1, ge=0),
        "relative": number(tol, "relative", "tolerance", default=0, ge=0, lt=1),
    }
    if extra is not None:
        out[extra[0]] = number(tol, extra[0], "tolerance", default=extra[1], ge=0, lt=1)
    return out


def _opt(d: dict[str, Any], key: str, default: Any) -> Any:
    return default if d.get(key) is None else d[key]


def _prefixed(err: CalcInputError, prefix: str) -> CalcInputError:
    issues = [{"path": f"{prefix}.{x['path']}" if x["path"] else prefix, "message": x["message"]} for x in err.issues]
    message = ("invalid input: " + "; ".join(f"{x['path']}: {x['message']}" for x in issues) if issues
               else f"{prefix}: {err}")
    return CalcInputError(message, issues)


# --- DCF ------------------------------------------------------------------------------------------


def _parse_dcf_input(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    if d.get("dcf") is None:
        fail("dcf", "required")
    obj(d["dcf"], "dcf")
    if d.get("other") is None:
        fail("other", "required")
    o = obj(d["other"], "other")
    system = _label(o, "system", "other", optional=True) or "other system"
    lines = []
    for i, x in enumerate(array(o, "lines", "other", min_len=1, max_len=200)):
        p = join("other.lines", i)
        x = obj(x, p)
        label = _label(x, "label", p)
        values = [_finite(v, join(join(p, "values"), j))
                  for j, v in enumerate(array(x, "values", p, min_len=1, max_len=_MAX_HOLD_YEARS + 1))]
        lines.append({"label": label, "values": values})
    other = {
        "system": system,
        "lines": lines,
        "value": number(o, "value", "other", optional=True),
        "unlevered_irr": number(o, "unlevered_irr", "other", optional=True, gt=-1, le=1),
        "gross_sale_price": number(o, "gross_sale_price", "other", optional=True),
        "net_sale_proceeds": number(o, "net_sale_proceeds", "other", optional=True),
    }
    mapping = []
    for i, m in enumerate(array(d, "mapping", default=[], max_len=200)):
        p = join("mapping", i)
        m = obj(m, p)
        mapping.append({"label": _label(m, "label", p), "line": enum(m, "line", _TARGETS, p)})
    mode = enum(d, "sign_convention", ("auto", "as_reported", "deductions_positive"), default="auto")
    tolerance = _tolerance(d, ("irr", 0.0001))
    seen: dict[str, int] = {}
    for i, x in enumerate(lines):
        n = normalize_label(x["label"])
        if n == "":
            continue
        if n in seen:
            fail(f"other.lines.{i}.label", f"\"{x['label']}\" reads the same as line {seen[n]}'s label (labels are compared "
                 "ignoring case and punctuation)")
        seen[n] = i
    mapped: set[str] = set()
    for i, m in enumerate(mapping):
        n = normalize_label(m["label"])
        if n == "":
            fail(f"mapping.{i}.label", "needs a letter or digit")
        if n in mapped:
            fail(f"mapping.{i}.label", f"\"{m['label']}\" is mapped twice")
        mapped.add(n)
    return {"dcf": d["dcf"], "other": other, "mapping": mapping, "sign_convention": mode, "tolerance": tolerance}


def _run_dcf(raw: dict[str, Any]) -> Result:
    from .valuation import dcf_pro_forma  # late import: valuation imports calc, which imports this module

    try:
        return dcf_pro_forma(raw)
    except CalcInputError as err:
        raise _prefixed(err, "dcf") from None


def reconcile_dcf(raw: Any) -> Result:
    inp = _parse_dcf_input(raw)
    t = Trace()
    dcf_run = _run_dcf(inp["dcf"])
    dcf = dcf_run["value"]
    H = dcf["hold_years"]
    N = H + 1
    rows = dcf["cash_flows"]

    def col(k: str) -> list[float]:
        return [r[k] for r in rows]

    tol_abs = inp["tolerance"]["absolute"]
    tol_rel = inp["tolerance"]["relative"]

    def tol_of(other: float) -> float:
        return max(tol_abs, tol_rel * abs(other))

    mode = inp["sign_convention"]
    system = inp["other"]["system"]
    raw_dcf = inp["dcf"]
    leases = raw_dcf["leases"]

    t.step("Other system", system)
    t.step("FactLot DCF value", dcf["value"],
           f"calc.dcf_pro_forma@{dcf_run['formula']['version']} on the dcf input: {N} years (the hold of {H} and the "
           "forward year)", "USD")

    user_map: dict[str, str] = {normalize_label(m["label"]): m["line"] for m in inp["mapping"]}
    used: set[str] = set()
    entries = []
    for x in inp["other"]["lines"]:
        n = normalize_label(x["label"])
        line, source = None, "unmapped"
        if n != "" and n in user_map:
            line, source = user_map[n], "mapping"
            used.add(n)
        elif n != "" and n in _DEFAULTS:
            line, source = _DEFAULTS[n], "default"
        factor = 1
        if line is not None and line in _DEDUCTIONS:
            if mode == "deductions_positive":
                factor = -1
            elif mode == "auto" and all(v >= 0 for v in x["values"]) and any(v > 0 for v in x["values"]):
                factor = -1
        entries.append({"label": x["label"], "values": x["values"], "line": line, "source": source, "factor": factor})
    unmapped = [e["label"] for e in entries if e["line"] is None]
    ignored = [e["label"] for e in entries if e["line"] == "ignore"]
    by_user = sum(1 for e in entries if e["source"] == "mapping")
    by_default = sum(1 for e in entries if e["source"] == "default")
    t.step("Label mapping", f"{len(entries) - len(unmapped) - len(ignored)} of {len(entries)} lines mapped ({by_user} by your "
           f"mapping, {by_default} by default labels), {len(ignored)} ignored, {len(unmapped)} unmapped")
    flipped = [e["label"] for e in entries if e["factor"] == -1]
    t.step("Sign convention", mode, f"negated as positive deductions: {_list_of(flipped)}" if flipped else "no line negated")
    t.step("Difference", "FactLot − other, rounded to the cent",
           f"agrees when |difference| ≤ max({fmt_money(tol_abs)}, {fmt_num(tol_rel)} × |other|)")

    compared: dict[str, dict[str, Any]] = {}
    not_compared: list[str] = []
    for k in DCF_LINES:
        direct = [e for e in entries if e["line"] == k]
        turnover = [e for e in entries if e["line"] == "turnover_vacancy"] if k == "potential_base_rent" else []
        if not direct:
            not_compared.append(k)
            if turnover:
                t.warn(f"{_list_of([e['label'] for e in turnover])} mapped to turnover_vacancy, but no line is mapped to "
                       "potential_base_rent, so it is not compared: map the other system's potential base rent too.")
            continue
        parts = [e for e in entries if e["line"] == k or (turnover and e["line"] == "turnover_vacancy")]
        n = min(N, *[len(e["values"]) for e in parts])
        if turnover:
            t.warn(f"potential_base_rent is compared with {_list_of([e['label'] for e in parts])} together: FactLot's potential "
                   "base rent already leaves out the months a suite is vacant at rollover.")
        elif len(parts) > 1:
            t.warn(f"{k} is compared with the sum of {_list_of([e['label'] for e in parts])}; make sure none of them is a "
                   "subtotal of the others.")
        fl_all = col(k)
        c: dict[str, Any] = {"line": k, "fl": [], "ot": [], "d": [], "tol": [], "bad": [],
                             "out": {"line": k, "other_labels": [e["label"] for e in parts], "years": [],
                                     "all_within_tolerance": True, "max_abs_difference": 0, "likely_causes": []}}
        for y in range(1, n + 1):
            s = 0
            for e in parts:
                s += e["factor"] * e["values"][y - 1]
            other = round_(s, 2)
            fl = fl_all[y - 1]
            diff = round_(fl - other, 2)
            tol = tol_of(other)
            ok = abs(diff) <= tol
            c["fl"].append(fl)
            c["ot"].append(other)
            c["d"].append(diff)
            c["tol"].append(tol)
            if not ok:
                c["bad"].append(y)
            c["out"]["years"].append({"year": y, "in_hold": y <= H, "factlot": fl, "other": other, "difference": diff,
                                      "within_tolerance": ok})
            if abs(diff) > c["out"]["max_abs_difference"]:
                c["out"]["max_abs_difference"] = abs(diff)
        c["out"]["all_within_tolerance"] = not c["bad"]
        compared[k] = c
    for e in entries:
        if e["line"] is not None and e["line"] != "ignore" and len(e["values"]) > N:
            t.warn(f"\"{e['label']}\" has {len(e['values'])} years; FactLot projects {N} (the hold and the year after it), so the "
                   f"years after {N} are not compared.")
    for m in inp["mapping"]:
        if normalize_label(m["label"]) not in used:
            t.warn(f"mapping label \"{m['label']}\" matches no line in other.lines.")
    if unmapped:
        quoted = ['"' + x + '"' for x in unmapped]
        t.warn(f"Not compared, no mapping: {_list_of(quoted, 20)}. Add them to mapping (or map them to \"ignore\").")

    horizon = N * 12
    rollover: set[int] = set()
    fractional: list[tuple[int, str]] = []
    for e in dcf["lease_events"]:
        if e["kind"] == "in_place":
            continue
        s = e["start_month"]
        whole = math.floor(e["downtime_months"])
        last = s + max(math.ceil(e["free_rent_months"]), 1) - 1
        for m in range(s - whole, last + 1):
            if 1 <= m <= horizon:
                rollover.add(_year_of(m))
        frac_d = e["downtime_months"] != whole
        frac_f = e["free_rent_months"] != math.floor(e["free_rent_months"])
        if (frac_d or frac_f) and s <= horizon:
            parts_ = []
            if frac_d:
                parts_.append(f"downtime {fmt_num(e['downtime_months'])} months")
            if frac_f:
                parts_.append(f"free rent {fmt_num(e['free_rent_months'])} months")
            fractional.append((_year_of(s), f"{e['lease']} {', '.join(parts_)} (lease starting month {s}, year {_year_of(s)})"))

    lease_count = len(leases)
    vac_rate = _opt(raw_dcf, "general_vacancy_rate", 0)
    rate_of = {
        "general_vacancy": (vac_rate, "general_vacancy_rate"),
        "credit_loss": (_opt(raw_dcf, "credit_loss_rate", 0), "credit_loss_rate"),
        "management_fee": (_opt(raw_dcf, "management_fee_rate", 0), "management_fee_rate"),
    }
    exit_basis = _opt(raw_dcf, "exit_noi_basis", "forward")
    timing = _opt(raw_dcf, "timing", "end_of_year")
    selling_rate = _opt(raw_dcf, "selling_cost_rate", 0)
    pbr, fr, rec = col("potential_base_rent"), col("free_rent"), col("expense_recoveries")
    gross, egr = col("gross_revenue"), col("effective_gross_revenue")
    after_free = [a + b for a, b in zip(pbr, fr)]
    vac_bases = [("potential base rent", pbr), ("potential base rent after free rent", after_free),
                 ("potential base rent plus recoveries, before free rent", [a + b for a, b in zip(pbr, rec)])]
    bases = {"general_vacancy": vac_bases, "credit_loss": vac_bases,
             "management_fee": [("gross revenue", gross), ("potential base rent after free rent", after_free),
                                ("potential base rent", pbr)]}
    gross_text = "gross revenue (base rent after free rent, plus recoveries)"
    factlot_base = {"general_vacancy": (gross_text, "gross revenue", gross),
                    "credit_loss": (gross_text, "gross revenue", gross),
                    "management_fee": ("effective gross revenue", "effective gross revenue", egr)}
    rent_lines = {"potential_base_rent", "free_rent", "tenant_improvements", "leasing_commissions"}

    def causes_for(c: dict[str, Any]) -> list[dict[str, Any]]:
        k, fl, ot, d, tol, S = c["line"], c["fl"], c["ot"], c["d"], c["tol"], c["bad"]
        n = len(fl)
        out: list[dict[str, Any]] = []

        def add(cause: str, hypothesis: str) -> None:
            out.append({"cause": cause, "years": list(S), "hypothesis": hypothesis})

        def every(f: Any) -> bool:
            return all(f(y) for y in range(1, n + 1))

        def at(xs: list[float], y: int) -> float:
            return xs[y - 1]

        if every(lambda y: _close(at(ot, y), -at(fl, y), at(tol, y))) and any(abs(v) > tol[i] for i, v in enumerate(fl)):
            add("opposite_sign", "The other amounts equal FactLot's with the opposite sign in every compared year: the other "
                "export may show this line as a positive deduction, or income as negative. Check the sign and set "
                "sign_convention (or the export) to match.")
            return out

        parts = _PARTS.get(k)
        if parts:
            present = [p for p in parts if p in compared]
            differing = [p for p in present if any(y in S for y in compared[p]["bad"])]

            def explained(y: int) -> bool:
                s = 0
                for p in present:
                    if y <= len(compared[p]["d"]):
                        s += compared[p]["d"][y - 1]
                return _close(at(d, y), s, at(tol, y))

            if differing and all(explained(y) for y in S):
                add("carried_from_other_lines", f"Explained by {', '.join(differing)}: their differences add up to this line's "
                    f"in {_years_text(S)}. Resolve {'that line' if len(differing) == 1 else 'those lines'} first.")
        rate = rate_of.get(k)
        fb = factlot_base.get(k)
        if rate and fb:
            base_line = "effective_gross_revenue" if k == "management_fee" else "gross_revenue"
            bc = compared.get(base_line)
            if (rate[0] > 0 and bc is not None and any(y in S for y in bc["bad"])
                    and all(y <= len(bc["ot"]) and _close(at(ot, y), round_(-rate[0] * at(bc["ot"], y), 2), at(tol, y))
                            for y in S)):
                add("carried_from_other_lines", f"The other {_TITLE[k]} equals {fmt_num(rate[0])} × the other export's "
                    f"{_TITLE[base_line]} in {_years_text(S)}, the same rate on a base that differs: resolve {base_line} first.")
        if out:
            return out

        if k == "operating_expenses":
            mg = col("management_fee")
            if any(v != 0 for v in mg) and every(lambda y: _close(at(ot, y), at(fl, y) + at(mg, y), at(tol, y))):
                add("management_fee_in_opex", f"The other operating expenses equal FactLot's operating expenses plus its "
                    f"management fee ({fmt_money(at(mg, 1))} in year 1) in every compared year: the other model may count the "
                    "management fee as an operating expense, where FactLot reports it on its own line (management_fee_rate × "
                    "effective gross revenue). Map the other system's management fee line, if it has one, or compare net "
                    "operating income.")
                return out

        if rate and fb:
            r, field = rate
            if r > 0:
                for label, base in bases[k]:
                    if every(lambda y: _close(at(ot, y), round_(-r * at(base, y), 2), at(tol, y))):
                        add("rate_base", f"The other {_TITLE[k]} equals −{fmt_num(r)} × FactLot's {label} in every compared "
                            f"year; FactLot charges {field} on {fb[0]}. The other model may apply the rate to {label}: check "
                            f"its {_TITLE[k]} base.")
                        return out
            elif S:
                y = S[0]
                b = at(fb[2], y)
                share = f", {fmt_pct(-at(ot, y) / b, 3)} of FactLot's {fb[1]}" if b != 0 else ""
                add("rate_not_entered", f"FactLot's {field} is 0, but the other model charges {_TITLE[k]} "
                    f"({fmt_money(at(ot, y))} in year {y}{share}). Check whether the rate was entered in the FactLot input "
                    f"(dcf.{field}).")
                return out

        if n == N and n >= 2 and len(S) == 1 and S[0] == N:
            note = ", so it does not change the FactLot value" if exit_basis == "trailing" else ""
            add("exit_year_only", f"Only year {N} differs: the year after the hold, which FactLot projects only for the exit "
                f"NOI (exit_noi_basis \"{exit_basis}\"{note}). Check how the other model projects that year (rollovers in "
                "it, growth) and which year's NOI it capitalizes.")
            return out

        if n >= 3:
            later = (all(_close(at(ot, y), at(fl, y - 1), at(tol, y)) for y in range(2, n + 1))
                     and any(abs(at(fl, y - 1)) > at(tol, y) for y in range(2, n + 1)))
            earlier = (all(_close(at(ot, y), at(fl, y + 1), at(tol, y)) for y in range(1, n))
                       and any(abs(at(fl, y + 1)) > at(tol, y) for y in range(1, n)))
            if later or earlier:
                when = ("in the month the rollover lease starts" if k in ("tenant_improvements", "leasing_commissions")
                        else "as monthly amounts summed into analysis years of 12 months from analysis month 1")
                add("one_year_shift", f"The other amounts equal FactLot's one year {'later' if later else 'earlier'} (other "
                    f"year y = FactLot year y {'−' if later else '+'} 1): a timing difference. Check when the other model books "
                    f"this line (FactLot: {when}) and whether its year 1 starts with the same month as FactLot's analysis "
                    "month 1, or labels its year columns by a different start or end date.")
                return out

        if S and all(y in rollover for y in S) and (len(S) < n or k in ("tenant_improvements", "leasing_commissions")):
            if k == "tenant_improvements":
                add("leasing_cost_basis", f"Tenant improvements differ in rollover {_years_text(S)}. FactLot pays TI when the "
                    "rollover lease starts: (p × ti_psf_renewal + (1 − p) × ti_psf_new) × area, grown at "
                    "market_rent_growth_rate to the start year. Check the other model's TI per SF, renewal blend, growth and "
                    "timing.")
                return out
            if k == "leasing_commissions":
                add("leasing_cost_basis", f"Leasing commissions differ in rollover {_years_text(S)}. FactLot pays them when "
                    "the rollover lease starts, as (p × lc_rate_renewal + (1 − p) × lc_rate_new) × the base rent over the "
                    "whole new term after free rent. Check the other model's commission base (term, free rent, "
                    "escalations), rates and timing.")
                return out
            if k not in ("operating_expenses", "capital_reserves"):
                frac = [text for y, text in fractional if y in S]
                tail = (f" Fractional terms in those years: {'; '.join(frac)}." if frac else
                        " No rollover in those years has fractional downtime or free rent, so check the downtime, free rent, "
                        "renewal rent and renewal probability the other model applies.")
                add("rollover_convention", f"Differences fall only in {_years_text(S)}, years with a lease rollover (downtime, "
                    "a new lease's first month, or its free rent). FactLot keeps blended downtime and free rent fractional, "
                    "as part months (calc.dcf_pro_forma@2: 0.45 months of downtime means the first month collects 55%); a "
                    "model that rounds them to whole months (as calc.dcf_pro_forma@1 did), or applies downtime, free rent or "
                    "the renewal blend differently, differs only in these years." + tail)
                return out

        nonzero = every(lambda y: abs(at(fl, y)) > at(tol, y))
        if nonzero and every(lambda y: at(ot, y) == 0):
            add("zero_in_other", "The other export shows 0 in every compared year where FactLot has an amount: the other "
                "model may not include this line, or the label maps to an empty row. Check the mapping and whether the item "
                "is modelled elsewhere.")
            return out
        worst = max(abs(at(d, y)) for y in S)
        if worst <= 0.12 * lease_count:
            add("rounding", f"Differences are at most {fmt_money(worst)} a year, within cent rounding of monthly amounts for "
                f"{lease_count} {'lease' if lease_count == 1 else 'leases'}: FactLot rounds each annual line to the cent, not "
                "each month. Raise tolerance.absolute if that is the only difference.")
            return out
        if n >= 3 and nonzero and at(ot, 1) != 0:
            k1 = at(ot, 1) / at(fl, 1)
            g = at(ot, 2) / at(fl, 2) / k1
            if abs(g - 1) > 1e-5 and every(lambda y: _close(at(ot, y), at(fl, y) * k1 * pow_int(g, y - 1),
                                                            max(at(tol, y), 1e-6 * abs(at(ot, y))))):
                which = (f"market rent growth (FactLot: {fmt_pct(_opt(raw_dcf, 'market_rent_growth_rate', 0), 3)})"
                         if k in rent_lines else
                         f"expense growth (FactLot: {fmt_pct(_opt(raw_dcf, 'expense_growth_rate', 0), 3)})")
                add("growth_rate", f"The gap compounds: other ≈ FactLot × {fmt_num(k1)} × {fmt_num(g)}^(y − 1), consistent "
                    f"with growth about {fmt_pct(abs(g - 1), 3)} a year {'higher' if g > 1 else 'lower'} for this line in "
                    f"the other model. Check {which} and the year growth starts.")
                return out
        if n >= 2 and nonzero and len(S) == n and at(ot, 1) != 0:
            k1 = at(ot, 1) / at(fl, 1)
            if abs(k1 - 1) > 1e-5 and every(lambda y: _close(at(ot, y), at(fl, y) * k1,
                                                             max(at(tol, y), 1e-6 * abs(at(ot, y))))):
                add("constant_ratio", f"The other amounts are {fmt_num(k1)} × FactLot's in every compared year: consistent "
                    f"with a different rate, base or area (FactLot's building area is {js_number_str(dcf['building_area_sf'])} "
                    "SF). Check the inputs behind this line.")
                return out
        if n >= 2 and len(S) == n and every(lambda y: _close(at(d, y), at(d, 1), at(tol, y))):
            add("constant_offset", f"The difference (FactLot − other) is {fmt_money(at(d, 1))} in every compared year: "
                "consistent with a fixed annual amount on one side only (a non-recoverable expense, a reserve, or another "
                "line folded into this one).")
            return out
        return out

    lines: list[dict[str, Any]] = []
    cells = outside = 0
    for k in DCF_LINES:
        c = compared.get(k)
        if c is None:
            continue
        if c["bad"]:
            c["out"]["likely_causes"] = causes_for(c)
        cells += len(c["fl"])
        outside += len(c["bad"])
        lines.append(c["out"])
    differing_lines = [x["line"] for x in lines if not x["all_within_tolerance"]]

    totals: list[dict[str, Any]] = []
    o = inp["other"]
    alts: list[tuple[str, Result]] = []

    def alt_runs() -> list[tuple[str, Result]]:
        if alts:
            return alts
        alts.append(("timing", _run_dcf({**raw_dcf, "timing": "end_of_year" if timing == "mid_year" else "mid_year"})["value"]))
        alts.append(("exit_noi_basis", _run_dcf({**raw_dcf, "exit_noi_basis": "trailing" if exit_basis == "forward"
                                                 else "forward"})["value"]))
        if selling_rate > 0:
            alts.append(("selling_cost_rate", _run_dcf({**raw_dcf, "selling_cost_rate": 0})["value"]))
        return alts

    def alt_for(what: str) -> Result | None:
        return next((r for w, r in alt_runs() if w == what), None)

    def basis_text(b: str) -> str:
        return f"year {H}'s NOI (the last hold year)" if b == "trailing" else f"year {N}'s NOI (the year after the hold)"

    other_basis = "trailing" if exit_basis == "forward" else "forward"

    def money(item: str, fl: float, ot: float) -> dict[str, Any]:
        other = round_(ot, 2)
        diff = round_(fl - other, 2)
        return {"item": item, "factlot": fl, "other": other, "difference": diff, "within_tolerance": abs(diff) <= tol_of(other),
                "likely_causes": []}

    def cause(c: str, hypothesis: str) -> dict[str, Any]:
        return {"cause": c, "years": [], "hypothesis": hypothesis}

    lines_note = (f"Annual lines differ ({_list_of(differing_lines)}); the sale and value follow them: resolve those first."
                  if differing_lines else "")
    ex = dcf["exit"]
    exit_cap = raw_dcf["exit_cap_rate"]

    if o["gross_sale_price"] is not None:
        r = money("gross_sale_price", ex["gross_sale_price"], o["gross_sale_price"])
        if not r["within_tolerance"]:
            alt = alt_for("exit_noi_basis")
            assert alt is not None
            if abs(round_(alt["exit"]["gross_sale_price"] - r["other"], 2)) <= tol_of(r["other"]):
                r["likely_causes"].append(cause("exit_noi_basis", f"The other gross sale price equals FactLot's with "
                                                f"exit_noi_basis \"{other_basis}\" ({fmt_money(alt['exit']['gross_sale_price'])}): "
                                                f"the other model may capitalize {basis_text(other_basis)}; FactLot input: "
                                                f"\"{exit_basis}\", {basis_text(exit_basis)}."))
            elif r["other"] != 0:
                r["likely_causes"].append(cause("exit_cap_or_noi", f"The other gross sale price implies a cap rate of "
                                                f"{fmt_pct(ex['noi'] / r['other'], 3)} on FactLot's exit NOI of "
                                                f"{fmt_money(ex['noi'])}; FactLot's exit_cap_rate is {fmt_pct(exit_cap, 3)}. "
                                                "Check the exit cap rate and which year's NOI the other model capitalizes."
                                                + (f" {lines_note}" if lines_note else "")))
        totals.append(r)
    if o["net_sale_proceeds"] is not None:
        r = money("net_sale_proceeds", ex["net_sale_proceeds"], o["net_sale_proceeds"])
        if not r["within_tolerance"]:
            gsp = o["gross_sale_price"]
            alt = alt_for("selling_cost_rate")
            if gsp is not None and gsp != 0:
                implied = 1 - o["net_sale_proceeds"] / gsp
                if abs(implied - selling_rate) > 1e-6:
                    r["likely_causes"].append(cause("selling_costs", f"The other net sale proceeds imply selling costs of "
                                                    f"{fmt_pct(implied, 3)} of its gross sale price; FactLot's selling_cost_rate "
                                                    f"is {fmt_pct(selling_rate, 3)}. Check the selling-cost rate and what it "
                                                    "applies to."))
                else:
                    r["likely_causes"].append(cause("carried_from_other_lines", "The selling-cost rate agrees; the net "
                                                    "proceeds follow the gross sale price, which differs."))
            elif alt is not None and abs(round_(alt["exit"]["net_sale_proceeds"] - r["other"], 2)) <= tol_of(r["other"]):
                r["likely_causes"].append(cause("selling_costs", f"The other net sale proceeds equal FactLot's gross sale "
                                                f"price with no selling costs ({fmt_money(alt['exit']['net_sale_proceeds'])}); "
                                                f"FactLot's selling_cost_rate is {fmt_pct(selling_rate, 3)}. Check whether "
                                                "the other model deducts selling costs."))
        totals.append(r)
    value_differs = False
    if o["value"] is not None:
        r = money("value", dcf["value"], o["value"])
        if not r["within_tolerance"]:
            value_differs = True
            found = False
            for what, run in alt_runs():
                if abs(round_(run["value"] - r["other"], 2)) > tol_of(r["other"]):
                    continue
                found = True
                if what == "timing":
                    alt_t = run["timing"]
                    how = "at mid-year, (1 + r)^(y − 0.5)" if alt_t == "mid_year" else "at the end of each year, (1 + r)^y"
                    r["likely_causes"].append(cause("discount_timing", f"The other value equals FactLot's value rerun with "
                                                    f"timing \"{alt_t}\" ({fmt_money(run['value'])}): the other model may "
                                                    f"discount operating cash flows {how}; FactLot input: \"{timing}\". FactLot "
                                                    f"always discounts the sale at the end of year {H}."))
                elif what == "exit_noi_basis":
                    r["likely_causes"].append(cause("exit_noi_basis", f"The other value equals FactLot's value rerun with "
                                                    f"exit_noi_basis \"{other_basis}\" ({fmt_money(run['value'])}): the other "
                                                    f"model may capitalize {basis_text(other_basis)}; FactLot input: "
                                                    f"\"{exit_basis}\"."))
                else:
                    r["likely_causes"].append(cause("selling_costs", f"The other value equals FactLot's value rerun with no "
                                                    f"selling costs ({fmt_money(run['value'])}); FactLot's selling_cost_rate is "
                                                    f"{fmt_pct(selling_rate, 3)}. Check whether the other model deducts selling "
                                                    "costs from the sale."))
            if not found:
                r["likely_causes"].append(
                    cause("carried_from_other_lines", lines_note) if differing_lines else
                    cause("valuation_convention", f"Every compared annual line agrees, so the value difference comes from the "
                          f"sale or the discounting: check the exit cap rate and NOI basis (FactLot: {fmt_pct(exit_cap, 3)} on "
                          f"{basis_text(exit_basis)}, {fmt_money(ex['noi'])}), selling costs, the discount rate "
                          f"({fmt_pct(raw_dcf['discount_rate'], 3)}) and its timing (\"{timing}\"; the sale at the end of year "
                          f"{H}), and whether the other model discounts monthly."))
        totals.append(r)
    if o["unlevered_irr"] is not None:
        if dcf["unlevered_irr"] is None:
            t.warn("other.unlevered_irr is not compared: FactLot computes the unlevered IRR only when dcf.purchase_price is "
                   "given.")
        else:
            diff = round_(dcf["unlevered_irr"] - o["unlevered_irr"], 6)
            r = {"item": "unlevered_irr", "factlot": dcf["unlevered_irr"], "other": o["unlevered_irr"], "difference": diff,
                 "within_tolerance": abs(diff) <= inp["tolerance"]["irr"], "likely_causes": []}
            if not r["within_tolerance"]:
                mid = ", even with timing mid_year" if timing == "mid_year" else ""
                r["likely_causes"].append(
                    cause("carried_from_other_lines", "The cash flows or the value differ too; the IRR follows them: resolve "
                          "those first.") if value_differs or differing_lines else
                    cause("irr_convention", f"The compared cash flows and value agree, but the IRR differs: FactLot's "
                          f"unlevered IRR is annual and end of year (Excel IRR) on [−price, CF_1, …, CF_{H} + net sale]{mid}. "
                          "A monthly or mid-year IRR, or a price that includes closing costs, differs. Check the other model's "
                          "IRR settings."))
            totals.append(r)

    totals_ok = all(x["within_tolerance"] for x in totals)
    all_ok = cells > 0 and outside == 0 and totals_ok
    t.step("Cells compared", cells, f"{len(lines)} lines × up to {N} years")
    t.step("Cells outside tolerance", outside)
    t.step("Likely causes", "patterns tested on each differing line, in this order, the first match reported: opposite sign; "
           "differences carried from the lines a subtotal foots from, or from the base of a rate; management fee inside "
           "operating expenses; a rate on a different base, or not entered; only the year after the hold; a one-year shift; "
           "only rollover years (downtime, free rent, TI and commissions); zero in the other export; cent rounding; a "
           "compounding factor (growth); a constant factor; a constant amount. Sale, value and IRR: FactLot rerun with the other "
           "discount timing, the other exit NOI basis, or no selling costs.")
    if cells == 0:
        t.warn("No annual line was compared: map at least one label in other.lines to a FactLot line.")
    t.warn("Likely causes are hypotheses drawn from FactLot's own documented conventions, not findings about the other "
           "system: confirm each in that system's settings before relying on it. A tie-out shows where two models agree on "
           "these inputs; it does not show that either is right, and FactLot does not claim parity with ARGUS, Yardi or any "
           "other system.")
    return t.result("calc.reconcile_dcf", 1, {
        "system": system,
        "hold_years": H,
        "all_within_tolerance": all_ok,
        "cells_compared": cells,
        "cells_outside_tolerance": outside,
        "lines": lines,
        "totals": totals,
        "mapping": [{"label": e["label"], "line": e["line"], "source": e["source"], "sign_flipped": e["factor"] == -1}
                    for e in entries],
        "unmapped_labels": unmapped,
        "ignored_labels": ignored,
        "factlot_lines_not_compared": not_compared,
        "factlot_dcf": {
            "formula": f"{dcf_run['formula']['id']}@{dcf_run['formula']['version']}",
            "value": dcf["value"],
            "unlevered_irr": dcf["unlevered_irr"],
            "exit": dcf["exit"],
            "warnings": dcf_run["warnings"],
        },
    })


# --- CAM ------------------------------------------------------------------------------------------

#: The other system's money fields, compared in this order, and FactLot's field for each.
_CAM_MONEY = (
    ("grossed_up_expenses", "grossed_up_expenses"),
    ("cap_limit", "cap_limit"),
    ("cap_reduction", "cap_reduction"),
    ("admin_fee", "admin_fee"),
    ("structure_deduction", "structure_deduction"),
    ("billed_amount", "tenant_charge"),
    ("estimates_paid", "estimates_paid"),
    ("balance_due", "balance_due"),
)
_CAM_FLAGS = ("gross_up_applied", "cap_applied", "admin_fee_applied")
#: Expense names usually uncontrollable under a CAM cap.
_UNCONTROLLABLE = re.compile(r"tax|insurance|utilit", re.IGNORECASE)

_CAM_WHY = {
    "controllable_default": "these lines were left to the default controllable: true, so FactLot caps them; the other system "
                            "may not (taxes, insurance and utilities usually are not capped). Set controllable on every "
                            "line as the lease says.",
    "cap_base_year": "the other system may count the cap from a different base year. Check the cap's base year and "
                     "years_elapsed.",
    "cap_method": "the other system may compound the cap differently. Map the lease's cap language to one method explicitly.",
    "gross_up_target": "check the gross-up occupancy in the lease and in the other system.",
    "gross_up_missing": "the other system may not gross up variable expenses for this pool or this tenant.",
    "admin_fee_cap_order": "the other system may charge the fee on the capped or the uncapped amount differently. Confirm "
                           "the lease's order of operations.",
    "admin_fee_base": "the other system may leave them out of the fee base (set admin_fee_applies false on those lines, or "
                      "use admin_fee_excluded_categories for this tenant).",
}


def _parse_cam_input(raw: Any) -> dict[str, Any]:
    d = obj(raw)
    if d.get("cam") is None:
        fail("cam", "required")
    obj(d["cam"], "cam")
    if d.get("other") is None:
        fail("other", "required")
    o = obj(d["other"], "other")
    system = _label(o, "system", "other", optional=True) or "other system"
    pool = _label(o, "pool", "other", optional=True)
    rows = []
    seen: dict[str, int] = {}
    for i, x in enumerate(array(o, "tenants", "other", min_len=1, max_len=500)):
        p = join("other.tenants", i)
        x = obj(x, p)
        row: dict[str, Any] = {
            "tenant": _label(x, "tenant", p),
            "pool": _label(x, "pool", p, optional=True),
            "pro_rata_share": number(x, "pro_rata_share", p, optional=True, gt=0, le=1),
        }
        for k in _CAM_FLAGS:
            row[k] = boolean(x, k, p, default=None) if x.get(k) is not None else None  # type: ignore[arg-type]
        for k, _ in _CAM_MONEY:
            if k == "balance_due":
                row[k] = number(x, k, p, optional=True)
            elif k == "billed_amount":
                row[k] = number(x, k, p, ge=0)
            else:
                row[k] = number(x, k, p, optional=True, ge=0)
        if row["tenant"] in seen:
            fail(join(p, "tenant"), f"\"{row['tenant']}\" repeats row {seen[row['tenant']]} (reconcile one pool per call)")
        seen[row["tenant"]] = i
        rows.append(row)
    tolerance = _tolerance(d, ("share", 0.000001))
    return {"cam": d["cam"], "system": system, "pool": pool, "rows": rows, "tolerance": tolerance}


def reconcile_cam(raw: Any) -> Result:
    from .calc import _batch_tenant_input, _cam_batch_parse, cam_reconciliation, cam_reconciliation_batch

    inp = _parse_cam_input(raw)
    t = Trace()
    try:
        batch = cam_reconciliation_batch(inp["cam"])
    except CalcInputError as err:
        raise _prefixed(err, "cam") from None
    base, parsed = _cam_batch_parse(inp["cam"])
    tol_abs = inp["tolerance"]["absolute"]
    tol_rel = inp["tolerance"]["relative"]

    def tol_of(other: float) -> float:
        return max(tol_abs, tol_rel * abs(other))

    system, pool = inp["system"], inp["pool"]
    defaulted = {i for i, e in enumerate(inp["cam"]["expenses"]) if e.get("controllable") is None}
    bv = batch["value"]

    t.step("Other system", system)
    if pool is not None:
        t.step("Pool", pool)
    t.step("FactLot total tenant charges", bv["building"]["total_tenant_charges"],
           f"calc.cam_reconciliation_batch@{batch['formula']['version']} on the cam input, {len(bv['tenants'])} tenants", "USD")

    names = [x["name"] for x in parsed]
    by_norm: dict[str, list[int]] = {}
    for i, nm in enumerate(names):
        by_norm.setdefault(normalize_label(nm), []).append(i)
    taken: set[int] = set()
    pairs: list[tuple[int, dict[str, Any]]] = []
    unmatched: list[str] = []
    for row in inp["rows"]:
        i = names.index(row["tenant"]) if row["tenant"] in names else -1
        if i < 0:
            hits = by_norm.get(normalize_label(row["tenant"]), [])
            i = hits[0] if len(hits) == 1 else -1
        if i < 0 or i in taken:
            unmatched.append(row["tenant"])
            continue
        taken.add(i)
        pairs.append((i, row))
    missing = [nm for i, nm in enumerate(names) if i not in taken]
    t.step("Tenants matched", len(pairs), f"{len(inp['rows'])} rows from the other system, {len(names)} FactLot tenants")
    t.step("Difference", "FactLot − other, rounded to the cent (shares to 6 decimals)",
           f"agrees when |difference| ≤ max({fmt_money(tol_abs)}, {fmt_num(tol_rel)} × |other|); shares within "
           f"{fmt_num(inp['tolerance']['share'])}; true/false lines when equal")

    def run(x: dict[str, Any]) -> dict[str, Any] | None:
        try:
            return cam_reconciliation(x)["value"]
        except CalcInputError:
            return None

    tenants: list[dict[str, Any]] = []
    cells = outside = 0
    share_ratios: list[float] = []
    billed_fl = billed_ot = 0
    for i, row in pairs:
        v = bv["tenants"][i]["statement"]["value"]
        one = _batch_tenant_input(base, parsed[i])
        share = one["pro_rata_share"]
        lines: list[dict[str, Any]] = []
        share_differs = False
        if row["pro_rata_share"] is not None:
            diff = round_(share - row["pro_rata_share"], 6)
            ok = abs(diff) <= inp["tolerance"]["share"]
            share_differs = not ok
            if not ok:
                share_ratios.append(share / row["pro_rata_share"])
            lines.append({"line": "pro_rata_share", "factlot": share, "other": row["pro_rata_share"], "difference": diff,
                          "within_tolerance": ok})
        fl_flags = {"gross_up_applied": v["grossed_up_expenses"] > v["recoverable_expenses"],
                    "cap_applied": v["cap_reduction"] > 0, "admin_fee_applied": v["admin_fee"] > 0}
        for k in _CAM_FLAGS:
            if row[k] is not None:
                lines.append({"line": k, "factlot": fl_flags[k], "other": row[k], "difference": None,
                              "within_tolerance": fl_flags[k] == row[k]})
        for key, fk in _CAM_MONEY:
            ot = row[key]
            if ot is None:
                continue
            fl = v[fk]
            name = "billed_amount" if fk == "tenant_charge" else fk
            if fl is None:
                lines.append({"line": name, "factlot": None, "other": ot, "difference": None, "within_tolerance": False})
            else:
                diff = round_(fl - ot, 2)
                lines.append({"line": name, "factlot": fl, "other": ot, "difference": diff,
                              "within_tolerance": abs(diff) <= tol_of(ot)})
        billed_fl += v["tenant_charge"]
        billed_ot += row["billed_amount"]
        bad = [x for x in lines if not x["within_tolerance"]]
        cells += len(lines)
        outside += len(bad)

        causes: list[dict[str, Any]] = []

        def add(cause: str, hypothesis: str) -> None:
            causes.append({"cause": cause, "years": [], "hypothesis": hypothesis})

        def matches(alt: dict[str, Any] | None, row: dict[str, Any] = row) -> bool:
            if alt is None:
                return False
            for key, fk in _CAM_MONEY:
                if key in ("estimates_paid", "balance_due"):
                    continue
                ot = row[key]
                if ot is None:
                    continue
                fl = alt[fk]
                if fl is None or abs(round_(fl - ot, 2)) > tol_of(ot):
                    return False
            return True

        amounts_differ = any(x["line"] not in ("estimates_paid", "balance_due", "pro_rata_share") for x in bad)
        if share_differs and row["pro_rata_share"] is not None:
            os_ = row["pro_rata_share"]
            alt = run({**one, "pro_rata_share": os_})
            tail = (f" With the other share FactLot's charge is {fmt_money(alt['tenant_charge'])}, which matches."
                    if alt is not None and matches(alt) else "")
            add("pro_rata_denominator", f"The other system's share is {fmt_num(os_)}, FactLot's is {fmt_num(share)} (ratio "
                f"{fmt_num(share / os_)}): the pro-rata denominator or the tenant's area differs (for example leasable versus "
                "leased area, or a pool that leaves some tenants out). FactLot uses the pro_rata_share you passed." + tail)
        elif amounts_differ:
            alts: list[tuple[str, dict[str, Any], str]] = []
            cap = one.get("cap")
            fee = one.get("admin_fee")
            if cap is not None:
                # Lines left to the default controllable: true; first those named like taxes, insurance or utilities,
                # then all of them.
                left = [j for j, e in enumerate(one["expenses"]) if j in defaulted and e["recoverable"] and e["controllable"]]
                named = [j for j in left if _UNCONTROLLABLE.search(one["expenses"][j]["category"])]
                for flip in ([named, left] if named and len(named) < len(left) else [left]):
                    if flip:
                        alts.append(("controllable_default",
                                     {**one, "expenses": [{**e, "controllable": False} if j in flip else e
                                                          for j, e in enumerate(one["expenses"])]},
                                     f"with {', '.join(one['expenses'][j]['category'] for j in flip)} uncontrollable"))
                method = cap["method"]
                n = cap.get("years_elapsed")
                if method != "year_over_year" and n is not None:
                    for n2 in (n + 1, n - 1):
                        if n2 >= 0:
                            alts.append(("cap_base_year", {**one, "cap": {**cap, "years_elapsed": n2}},
                                         f"with cap.years_elapsed {n2} instead of {n}"))
                    m2 = "simple_from_base" if method == "compounding_from_base" else "compounding_from_base"
                    alts.append(("cap_method", {**one, "cap": {**cap, "method": m2}},
                                 f"with cap.method \"{m2}\" instead of \"{method}\""))
            gu = one.get("gross_up")
            if gu is not None:
                for t2 in (0.95, 1):
                    if t2 != gu["target_occupancy"]:
                        alts.append(("gross_up_target", {**one, "gross_up": {**gu, "target_occupancy": t2}},
                                     f"with gross_up.target_occupancy {fmt_num(t2)} instead of "
                                     f"{fmt_num(gu['target_occupancy'])}"))
                alts.append(("gross_up_missing", {k: x for k, x in one.items() if k != "gross_up"}, "without gross-up"))
            if fee is not None and cap is not None:
                before = _opt(fee, "applied", "after_cap") == "before_cap"
                capped0 = _opt(fee, "capped", False)
                for applied, capped in ((not before, capped0), (before, not capped0), (not before, not capped0)):
                    a2 = "before_cap" if applied else "after_cap"
                    alts.append(("admin_fee_cap_order", {**one, "admin_fee": {**fee, "applied": a2, "capped": capped}},
                                 f"with the admin fee computed {'before' if applied else 'after'} the cap and "
                                 f"{'counted within' if capped else 'added outside'} it (FactLot input: "
                                 f"{'before' if before else 'after'} the cap, {'within' if capped0 else 'outside'} it)"))
            if fee is not None:
                off = [e for e in one["expenses"] if e["recoverable"] and not e["controllable"] and e["admin_fee_applies"]]
                if off:
                    alts.append(("admin_fee_base",
                                 {**one, "expenses": [{**e, "admin_fee_applies": False}
                                                      if e["recoverable"] and not e["controllable"] and e["admin_fee_applies"]
                                                      else e for e in one["expenses"]]},
                                 f"with no admin fee on the uncontrollable lines {', '.join(e['category'] for e in off)}"))
            for id_, x, text in alts:
                alt = run(x)
                if not matches(alt):
                    continue
                assert alt is not None
                add(id_, f"The other results match FactLot rerun {text} (charge {fmt_money(alt['tenant_charge'])}): "
                    f"{_CAM_WHY[id_]}")
        if row["estimates_paid"] is not None and abs(round_(v["estimates_paid"] - row["estimates_paid"], 2)) > \
                tol_of(row["estimates_paid"]):
            add("estimates_paid", f"The other system credits {fmt_money(row['estimates_paid'])} of estimates paid, FactLot "
                f"was given {fmt_money(v['estimates_paid'])}: the balance due differs by that amount even where the charge "
                "agrees.")
        tenants.append({
            "tenant": names[i],
            "other_tenant": row["tenant"],
            "pool": row["pool"] if row["pool"] is not None else pool,
            "lines": lines,
            "all_within_tolerance": not bad,
            "likely_causes": causes if bad else [],
        })

    building: list[dict[str, Any]] = []
    if len(share_ratios) >= 2:
        k = share_ratios[0]
        if all(abs(r / k - 1) <= 1e-4 for r in share_ratios):
            building.append({"cause": "pro_rata_denominator", "years": [],
                             "hypothesis": f"Every differing share is {fmt_num(k)} × the other system's: one denominator "
                                           f"differs for the whole pool (the other system divides by an area {fmt_num(k)} × "
                                           "FactLot's). Check which area each system divides by: leasable, leased or "
                                           "occupied, and whether some tenants are left out of the pool."})

    within = sum(1 for x in tenants if x["all_within_tolerance"])
    t.step("Cells compared", cells)
    t.step("Cells outside tolerance", outside)
    t.step("Likely causes", "for each tenant that differs: a different pro rata share; otherwise FactLot rerun with lines "
           "left to the default controllable: true set uncontrollable, the cap's years_elapsed ± 1, the other cap method, the "
           "other gross-up target or none, the admin fee before or after and within or outside the cap, and no fee on "
           "uncontrollable lines; every rerun whose amounts all agree is reported. Estimates paid are compared on their own.")
    if missing:
        more = f" and {len(missing) - 20} more" if len(missing) > 20 else ""
        t.warn(f"FactLot tenants with no row from the other system: {', '.join(missing[:20])}{more}.")
    if unmatched:
        more = f" and {len(unmatched) - 20} more" if len(unmatched) > 20 else ""
        t.warn(f"Rows from the other system that match no FactLot tenant (or match one already taken): "
               f"{', '.join(unmatched[:20])}{more}.")
    t.warn("Likely causes are hypotheses drawn from FactLot's own documented CAM conventions, not findings about the other "
           "system: confirm each in that system's setup and the lease before relying on it. FactLot does not claim parity "
           "with Yardi or any other system.")
    fl_total, ot_total = round_(billed_fl, 2), round_(billed_ot, 2)
    return t.result("calc.reconcile_cam", 1, {
        "system": system,
        "pool": pool,
        "year": base["year"],
        "all_within_tolerance": bool(pairs) and outside == 0 and not missing and not unmatched,
        "tenants_compared": len(pairs),
        "tenants_within_tolerance": within,
        "cells_compared": cells,
        "cells_outside_tolerance": outside,
        "tenants": tenants,
        "factlot_tenants_not_in_other": missing,
        "other_tenants_not_matched": unmatched,
        "total_billed": {"factlot": fl_total, "other": ot_total, "difference": round_(fl_total - ot_total, 2)},
        "building_causes": building,
        "factlot_cam": {
            "formula": f"{batch['formula']['id']}@{batch['formula']['version']}",
            "total_tenant_charges": bv["building"]["total_tenant_charges"],
            "warnings": batch["warnings"],
        },
    })
