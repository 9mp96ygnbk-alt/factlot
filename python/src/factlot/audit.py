"""audit_expense_statement: a tenant's audit of a landlord's operating-expense (CAM) statement.

The same code as packages/tools/src/audit.ts (spec/differential runs both on the same inputs). Facts
in, findings out: every finding rests on a verified lease fact with its quote and page; a check whose
lease term is missing is listed as not run; nothing is approximated; no model, no clock (as_of is an
input). See the TypeScript file for the rules in full.
"""
from __future__ import annotations

import contextvars
import re
from typing import Any, Callable

from ._core import pow_int, round_
from .dates import add_days, days_between
from .docverify import DocInputError, validate_fact_full

AUDIT_PLAN_URL = "https://factlot.com/pricing/"

TOL = 0.005
BASE_TOL = 0.02


# --- fact value shapes (the mirror of the zod shapes in audit.ts) --------------------------------------


class _Bad(Exception):
    pass


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and x not in (float("inf"), float("-inf"))


def _num(lo: float | None = None, hi: float | None = None, gt: float | None = None) -> Callable[[Any], Any]:
    def f(x: Any) -> Any:
        if not _is_num(x):
            raise _Bad("expected a number")
        if lo is not None and x < lo:
            raise _Bad(f"must be at least {lo}")
        if hi is not None and x > hi:
            raise _Bad(f"must be at most {hi}")
        if gt is not None and x <= gt:
            raise _Bad(f"must be greater than {gt}")
        return x
    return f


def _int(lo: int, hi: int) -> Callable[[Any], Any]:
    def f(x: Any) -> Any:
        if not _is_num(x) or x != int(x):
            raise _Bad("expected an integer")
        if x < lo or x > hi:
            raise _Bad(f"must be between {lo} and {hi}")
        return int(x)
    return f


def _str(lo: int, hi: int) -> Callable[[Any], Any]:
    def f(x: Any) -> Any:
        if not isinstance(x, str) or len(x) < lo or len(x) > hi:
            raise _Bad(f"expected text of {lo} to {hi} characters")
        return x
    return f


def _bool(x: Any) -> Any:
    if not isinstance(x, bool):
        raise _Bad("expected true or false")
    return x


def _enum(*values: str) -> Callable[[Any], Any]:
    def f(x: Any) -> Any:
        if x not in values:
            raise _Bad(f"one of {', '.join(values)}")
        return x
    return f


def _date(x: Any) -> Any:
    if not isinstance(x, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", x):
        raise _Bad("expected YYYY-MM-DD")
    return x


def _words(x: Any) -> Any:
    if not isinstance(x, list) or len(x) > 50 or any(not isinstance(w, str) or not 1 <= len(w) <= 100 for w in x):
        raise _Bad("expected up to 50 words")
    return x


def _nullable(f: Callable[[Any], Any]) -> Callable[[Any], Any]:
    return lambda x: None if x is None else f(x)


_MONEY = _num(lo=0)
_RATIO = _num(gt=0, hi=1)
_YEAR = _int(1900, 2200)


class _Opt:
    def __init__(self, f: Callable[[Any], Any], default: Any = None, has_default: bool = False):
        self.f, self.default, self.has_default = f, default, has_default


def _opt(f: Callable[[Any], Any]) -> _Opt:
    return _Opt(f)


def _dflt(f: Callable[[Any], Any], default: Any) -> _Opt:
    return _Opt(f, default, True)


def _strict(fields: dict[str, Any]) -> Callable[[Any], Any]:
    def f(x: Any) -> Any:
        if not isinstance(x, dict):
            raise _Bad("expected an object")
        for k in x:
            if k not in fields:
                raise _Bad(f"{k}: unrecognized key")
        out: dict[str, Any] = {}
        for k, spec in fields.items():
            if k not in x:
                if isinstance(spec, _Opt):
                    if spec.has_default:
                        out[k] = spec.default
                    continue
                raise _Bad(f"{k}: required")
            try:
                out[k] = (spec.f if isinstance(spec, _Opt) else spec)(x[k])
            except _Bad as e:
                raise _Bad(f"{k}: {e}") from None
        return out
    return f


def _union(*fs: Callable[[Any], Any]) -> Callable[[Any], Any]:
    def f(x: Any) -> Any:
        for g in fs:
            try:
                return g(x)
            except _Bad:
                continue
        raise _Bad("does not match any accepted shape")
    return f


_CAP_METHODS = _enum("compounding_from_base", "simple_from_base", "year_over_year")

_LEASE_SHAPES: dict[str, Callable[[Any], Any]] = {
    "lease.pro_rata_share": _RATIO,
    "lease.pro_rata_basis": _strict({"tenant_sf": _num(gt=0), "building_sf": _num(gt=0)}),
    "lease.cam_cap": _strict({"method": _CAP_METHODS, "rate": _num(lo=0)}),
    "lease.cam_cap_rate": _strict({"rate": _num(lo=0)}),
    "lease.operating_expense_base_year": _int(1900, 2200),
    "lease.expense_stop": _strict({"amount": _MONEY}),
    "lease.cam_admin_fee": _strict({"rate": _num(lo=0, hi=1), "base": _enum("actual", "grossed_up"),
                                    "excluded_from_base": _dflt(_words, [])}),
    "lease.cam_gross_up": _strict({"target_occupancy": _RATIO, "applies_to": _enum("variable_expenses", "all_expenses"),
                                   "base_year_grossed_up": _opt(_bool)}),
    "lease.cam_exclusion": _union(_str(1, 200), _strict({"category": _str(1, 200), "keywords": _opt(_words)})),
    "lease.capex_treatment": _strict({"keywords": _dflt(_words, []), "recoverable": _enum("excluded", "amortized"),
                                      "amortization_years": _opt(_int(1, 100)), "interest_rate": _opt(_num(lo=0, hi=1)),
                                      "method": _opt(_enum("level_payment", "straight_line"))}),
    "lease.audit_right": _strict({"window_days": _int(1, 3650), "starts_from": _enum("statement_receipt", "statement_date"),
                                  "notice_form": _str(1, 500), "auditor": _opt(_str(1, 500)),
                                  "cost_shift_threshold": _opt(_strict({"type": _enum("percent_of_billed", "amount"),
                                                                        "value": _num(gt=0)}))}),
}
_LEASE_MULTI = {"lease.cam_exclusion"}

_STATEMENT_SHAPES: dict[str, Callable[[Any], Any]] = {
    "statement.period": _strict({"year": _YEAR, "statement_date": _date, "received_date": _date}),
    "statement.line": _strict({
        "label": _str(1, 300), "amount": _MONEY, "controllable": _opt(_bool), "variable": _opt(_bool),
        "capital": _opt(_bool), "grossed_up_amount": _opt(_MONEY),
        "amortization": _opt(_strict({"cost": _num(gt=0), "years": _int(1, 100), "rate": _num(lo=0, hi=1)}))}),
    "statement.total": _strict({"amount": _MONEY}),
    "statement.share_applied": _strict({"share": _RATIO, "building_sf": _opt(_num(gt=0))}),
    "statement.gross_up": _strict({"actual_occupancy": _RATIO, "target_occupancy": _RATIO}),
    "statement.admin_fee": _strict({"rate": _num(lo=0, hi=1), "base_amount": _MONEY, "amount": _MONEY}),
    "statement.cap_reference": _strict({"year": _YEAR, "amount": _MONEY}),
    "statement.cap_applied": _strict({"limit": _nullable(_MONEY)}),
    "statement.base_year_applied": _strict({"base_year": _opt(_YEAR), "stop_amount": _opt(_MONEY), "deduction": _MONEY,
                                            "grossed_up": _opt(_bool)}),
    "statement.base_year_total": _strict({"year": _YEAR, "amount": _MONEY}),
    "statement.separately_billed": _strict({"label": _str(1, 300), "amount": _MONEY}),
    "statement.tenant_charge": _strict({"amount": _MONEY}),
    "statement.estimates_credited": _strict({"amount": _MONEY}),
    "statement.estimates_paid": _strict({"amount": _MONEY}),
    "statement.balance_claimed": _strict({"amount": _num()}),
}
_STATEMENT_MULTI = {"statement.line", "statement.separately_billed"}
_PRIOR_USED = {"statement.line", "statement.period"}


# --- caller context (the hosted plan rule) -------------------------------------------------------------

_full_audit: contextvars.ContextVar[bool | None] = contextvars.ContextVar("factlot_full_audit", default=None)


def set_full_audit(value: bool | None):
    """Say, as the hosted API does, whether this caller gets the whole answer (False: the summary only)."""
    return _full_audit.set(value)


def audit_limited() -> bool:
    return _full_audit.get() is False


# --- facts -----------------------------------------------------------------------------------------------


class _Fact:
    __slots__ = ("id", "predicate", "value", "raw", "quote", "page", "document_id")

    def __init__(self, id_: str, predicate: str, value: Any, raw: Any, quote: str, page: Any, document_id: Any):
        self.id, self.predicate, self.value, self.raw = id_, predicate, value, raw
        self.quote, self.page, self.document_id = quote, page, document_id


def _read_facts(items: list[Any], path: str, side: str, shapes: dict[str, Callable[[Any], Any]], multi: set[str],
                only: set[str] | None, issues: list[dict[str, str]], ids: set[str], ignored: list[str]
                ) -> dict[str, list[_Fact]]:
    out: dict[str, list[_Fact]] = {}
    for i, f in enumerate(items):
        at = f"{path}.{i}"
        v = validate_fact_full(f)
        if not v["valid"]:
            for x in v["issues"][:3]:
                issues.append({"path": f"{at}{'.' + x['path'] if x['path'] else ''}",
                               "message": f"not a valid fact (fact_validate): {x['message']}"})
            continue
        id_ = str(f["id"])
        predicate = str(f["predicate"])
        sources = (f.get("provenance") or {}).get("sources")
        src = sources[0] if isinstance(sources, list) and sources else None
        if (not isinstance(src, dict) or not isinstance(src.get("quote"), str) or src["quote"].strip() == ""
                or not _is_num(src.get("page"))):
            issues.append({"path": f"{at}.provenance.sources",
                           "message": "no source: every fact the audit reads needs a quote and a page (no source, no finding)"})
            continue
        if not predicate.startswith(f"{side}."):
            issues.append({"path": f"{at}.predicate",
                           "message": f"{predicate} is not a {side} fact: {side}_facts holds {side}.* predicates"})
            continue
        if id_ in ids:
            issues.append({"path": f"{at}.id", "message": f"duplicate fact id {id_}"})
            continue
        ids.add(id_)
        shape = shapes.get(predicate)
        if shape is None or (only is not None and predicate not in only):
            ignored.append(predicate)
            continue
        try:
            parsed = shape(f.get("value"))
        except _Bad as e:
            issues.append({"path": f"{at}.value", "message": f"{predicate}: {e}"})
            continue
        value = parsed if isinstance(parsed, dict) else {"value": parsed}
        fact = _Fact(id_, predicate, value, parsed, src["quote"], src["page"],
                     src["document_id"] if isinstance(src.get("document_id"), str) else None)
        prev = out.get(predicate)
        if prev is not None and predicate not in multi:
            issues.append({"path": f"{at}.predicate",
                           "message": f"{predicate} appears twice ({prev[0].id} and {id_}): give the one that applies"})
            continue
        out[predicate] = [*(prev or []), fact]
    return out


# --- helpers ---------------------------------------------------------------------------------------------


def _usd(x: float) -> float:
    return round_(x, 2)


def _money(x: float) -> str:
    r = f"{round_(abs(x), 2):.2f}"
    int_part, frac = r.split(".")
    grouped = re.sub(r"\B(?=(\d{3})+(?!\d))", ",", int_part)
    return f"{'-' if x < 0 and r != '0.00' else ''}${grouped}.{frac}"


def _n(x: float) -> str:
    r = round_(x, 6)
    return str(int(r)) if r == int(r) else repr(r)


def _pct(x: float) -> str:
    return f"{_n(round_(x * 100, 4))}%"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _has_words(label: str, phrase: str) -> bool:
    p = _norm(phrase)
    return p != "" and f" {p} " in f" {_norm(label)} "


_CHECKS = [
    ("management_fee", "Management or admin fee"),
    ("cap", "Cap on controllable expenses"),
    ("capital_items", "Capital items"),
    ("gross_up", "Gross-up"),
    ("pro_rata_share", "Pro-rata share"),
    ("excluded_categories", "Excluded categories billed"),
    ("duplicates", "Duplicate lines"),
    ("base_year_or_stop", "Base year or expense stop"),
    ("arithmetic", "Arithmetic"),
    ("year_over_year", "Year over year"),
    ("deadlines", "Deadline to dispute or audit"),
    ("cost_shifting", "Audit cost-shifting"),
]

_CONFIRM_COMMON = "that the quoted lease sentence is the one that governs (check amendments and the defined terms)"


def _level_factor(r: float, n: int) -> float:
    if r == 0:
        return 1 / n
    return r / (1 - 1 / pow_int(1 + r, n))


class _Line:
    __slots__ = ("fact", "label", "amount", "controllable", "variable", "capital", "grossed", "amortization")

    def __init__(self, fact: _Fact):
        x = fact.value
        self.fact = fact
        self.label = x["label"]
        self.amount = x["amount"]
        self.controllable = x.get("controllable")
        self.variable = x.get("variable")
        self.capital = x.get("capital")
        self.grossed = x.get("grossed_up_amount")
        self.amortization = x.get("amortization")


def _uniq(facts: list[_Fact]) -> list[_Fact]:
    return list({f.id: f for f in facts}.values())


def _audit(inp: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    ids: set[str] = set()
    ignored_lease: list[str] = []
    ignored_statement: list[str] = []
    L = _read_facts(inp["lease_facts"], "lease_facts", "lease", _LEASE_SHAPES, _LEASE_MULTI, None, issues, ids, ignored_lease)
    S_ = _read_facts(inp["statement_facts"], "statement_facts", "statement", _STATEMENT_SHAPES, _STATEMENT_MULTI, None,
                     issues, ids, ignored_statement)
    prior = inp.get("prior_statement_facts")
    P = _read_facts(prior, "prior_statement_facts", "statement", _STATEMENT_SHAPES, _STATEMENT_MULTI, _PRIOR_USED,
                    issues, set(), []) if prior else {}
    if issues:
        raise DocInputError(issues[:20])
    as_of = inp["as_of"]
    yoy = inp.get("yoy_threshold", 0.1)

    def lease(p: str) -> _Fact | None:
        a = L.get(p)
        return a[0] if a else None

    def st(p: str) -> _Fact | None:
        a = S_.get(p)
        return a[0] if a else None

    def val(f: _Fact | None) -> dict[str, Any] | None:
        return f.value if f else None

    findings: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    not_run: list[dict[str, str]] = []
    ran: dict[str, int] = {}

    def source_of(f: _Fact, side: str) -> dict[str, Any]:
        return {"side": side, "fact_id": f.id, "predicate": f.predicate, "quote": f.quote, "page": f.page,
                "document_id": f.document_id}

    def add(check: str, code: str, *, title: str, cls: str, landlord: Any, lease_: Any, difference: Any,
            lease_facts: list[_Fact], statement_facts: list[_Fact], lines: list[_Fact] | None = None,
            steps: list[str], confirm: list[str]) -> None:
        if not lease_facts:
            raise RuntimeError(f"{code}: a finding needs a lease fact behind it")
        n = counts.get(code, 0) + 1
        counts[code] = n
        ran[check] = ran.get(check, 0) + 1
        lf, sf = _uniq(lease_facts), _uniq(statement_facts)
        findings.append({
            "id": f"{code}.{n}", "code": code, "check": check, "title": title, "class": cls,
            "landlord_figure": landlord, "lease_figure": lease_, "difference": difference, "unit": "USD",
            "lease_fact_ids": [x.id for x in lf], "statement_fact_ids": [x.id for x in sf],
            "line_fact_ids": [x.id for x in _uniq(lines or [])],
            "sources": [*(source_of(x, "lease") for x in lf), *(source_of(x, "statement") for x in sf)],
            "steps": steps, "confirm": [*confirm, _CONFIRM_COMMON],
        })

    def skip(check: str, reason: str, status: str = "not_run") -> None:
        not_run.append({"check": check, "status": status, "reason": reason})

    def missing(parts: list[tuple[Any, str]]) -> list[str]:
        return [n for x, n in parts if x is None]

    share_fact = lease("lease.pro_rata_share")
    lease_share = share_fact.raw if share_fact else None
    applied_fact = st("statement.share_applied")
    applied = val(applied_fact)
    S = applied["share"] if applied else lease_share
    period_fact = st("statement.period")
    period = val(period_fact)
    lines = [_Line(f) for f in S_.get("statement.line", [])]

    def sum_actual(ls: list[_Line]) -> float:
        a: float = 0
        for l in ls:
            a = a + l.amount
        return a

    def sum_gross(ls: list[_Line]) -> float:
        a: float = 0
        for l in ls:
            a = a + (l.grossed if l.grossed is not None else l.amount)
        return a

    exclusions = []
    for f in L.get("lease.cam_exclusion", []):
        raw = f.raw
        words = [raw] if isinstance(raw, str) else [raw["category"], *(raw.get("keywords") or [])]
        exclusions.append((f, words))

    def excluded_by(label: str):
        for e in exclusions:
            if any(_has_words(label, w) for w in e[1]):
                return e
        return None

    capex_fact = lease("lease.capex_treatment")
    capex = val(capex_fact)

    def is_capital(l: _Line) -> bool:
        return l.capital is True or any(_has_words(l.label, w) for w in (capex["keywords"] if capex else []))

    fee_fact = lease("lease.cam_admin_fee")
    fee = val(fee_fact)

    def fee_excluded(l: _Line) -> bool:
        return (any(_has_words(l.label, w) for w in (fee["excluded_from_base"] if fee else []))
                or excluded_by(l.label) is not None
                or (capex is not None and capex["recoverable"] == "excluded" and is_capital(l)))

    anchor: list[_Fact] = [share_fact] if share_fact else []
    flagged_excluded = {l.fact.id for l in lines if excluded_by(l.label)}

    def need_share(check: str) -> bool:
        if share_fact is None or S is None:
            skip(check, "needs lease.pro_rata_share (every finding rests on the tenant's share, and the lease term is missing)")
            return False
        if not lines and check not in ("deadlines", "cost_shifting"):
            skip(check, "needs statement.line facts (no billed line was given)")
            return False
        return True

    # 5. pro-rata share
    if need_share("pro_rata_share"):
        if not applied:
            skip("pro_rata_share", "needs statement.share_applied (the share the statement applied)")
        elif abs(applied["share"] - lease_share) > 1e-9 and applied["share"] > lease_share:
            pool = sum_actual(lines)
            lb_fact = lease("lease.pro_rata_basis")
            lb = val(lb_fact)
            denom = ""
            if lb and applied.get("building_sf") is not None and abs(lb["building_sf"] - applied["building_sf"]) > 1e-9:
                denom = (f" The statement's denominator is {_n(applied['building_sf'])} SF; "
                         f"the lease's is {_n(lb['building_sf'])} SF.")
            add("pro_rata_share", "SHARE_DIFFERS",
                title=f"Share applied is {_pct(applied['share'])}; the lease states {_pct(lease_share)}",
                cls="follows_from_terms", landlord=_usd(applied["share"] * pool), lease_=_usd(lease_share * pool),
                difference=_usd(applied["share"] * pool - lease_share * pool),
                lease_facts=[share_fact, *([lb_fact] if lb else [])], statement_facts=[applied_fact],
                steps=[f"Pool of billed lines: {_money(pool)} ({len(lines)} lines)",
                       f"Landlord: {_pct(applied['share'])} x {_money(pool)} = {_money(applied['share'] * pool)}",
                       f"Lease: {_pct(lease_share)} x {_money(pool)} = {_money(lease_share * pool)}",
                       f"Difference to the tenant: {_money(applied['share'] * pool - lease_share * pool)}.{denom}"],
                confirm=["that the lease share has not changed by amendment or remeasurement"])
        else:
            ran["pro_rata_share"] = ran.get("pro_rata_share", 0)

    # 1. management or admin fee
    fee_statement = st("statement.admin_fee")
    fee_s = val(fee_statement)
    if need_share("management_fee"):
        m = missing([(fee_fact, "lease.cam_admin_fee"), (fee_statement, "statement.admin_fee")])
        if m:
            skip("management_fee", f"needs {' and '.join(m)}")
        else:
            ran["management_fee"] = ran.get("management_fee", 0)
            rl, rs, b, share = fee["rate"], fee_s["rate"], fee_s["base_amount"], S
            if rs > rl + 1e-9:
                add("management_fee", "FEE_RATE_ABOVE_CAP",
                    title=f"Fee rate billed is {_pct(rs)}; the lease allows {_pct(rl)}", cls="follows_from_terms",
                    landlord=_usd(b * rs), lease_=_usd(b * rl), difference=_usd(b * rs - b * rl),
                    lease_facts=[fee_fact, *anchor], statement_facts=[fee_statement],
                    steps=[f"Fee base on the statement: {_money(b)}",
                           f"Landlord: {_pct(rs)} x {_money(b)} = {_money(b * rs)}",
                           f"Lease: {_pct(rl)} x {_money(b)} = {_money(b * rl)}"],
                    confirm=["that the lease's rate is the maximum, and not a rate for one category of cost"])
            clean = [l for l in lines if not fee_excluded(l)]
            excluded = [l for l in lines if fee_excluded(l)]
            A = share * sum_actual(lines)
            B = share * sum_gross(lines)
            C = share * sum_actual(clean)
            D = share * sum_gross(clean)
            ideal = C if fee["base"] == "actual" else D

            def near(x: float) -> bool:
                return abs(b - x) <= BASE_TOL

            def base(code: str, title: str, excess: float, cls: str, step: str, confirm_extra: str, ls: list[_Fact]) -> None:
                add("management_fee", code, title=title, cls=cls, landlord=_usd(rl * excess), lease_=0,
                    difference=_usd(rl * excess), lease_facts=[fee_fact, *anchor], statement_facts=[fee_statement, *ls],
                    lines=ls,
                    steps=[f"Fee base on the statement: {_money(b)}; the base the lease yields: {_money(ideal)}", step,
                           f"Fee on the excess at the lease rate: {_pct(rl)} x {_money(excess)} = {_money(rl * excess)}"],
                    confirm=[confirm_extra])

            if b > ideal + BASE_TOL:
                ex_lines = [l.fact for l in excluded]
                which = "which lines the landlord included in its fee base (the statement gives only the total)"
                labels = "; ".join(l.label for l in excluded)
                if fee["base"] == "actual" and near(A):
                    base("FEE_ON_EXCLUDED_LINES", "Fee charged on lines the lease excludes from the fee base", A - C,
                         "depends_on_reading",
                         f"The statement's fee base equals the share of every line ({_money(A)}), so it includes: {labels}",
                         which, ex_lines)
                elif fee["base"] == "actual" and near(B):
                    base("FEE_ON_GROSSED_UP_BASE", "Fee charged on a grossed-up base; the lease says actual expenses",
                         B - A, "depends_on_reading",
                         f"The statement's fee base equals the share of every line grossed up ({_money(B)}), not of actual amounts ({_money(A)})",
                         which, [])
                    if A - C > BASE_TOL:
                        base("FEE_ON_EXCLUDED_LINES", "Fee charged on lines the lease excludes from the fee base", A - C,
                             "depends_on_reading", f"The base also includes: {labels}", which, ex_lines)
                elif fee["base"] == "actual" and near(D):
                    base("FEE_ON_GROSSED_UP_BASE", "Fee charged on a grossed-up base; the lease says actual expenses",
                         D - C, "depends_on_reading",
                         f"The statement's fee base equals the share of the non-excluded lines grossed up ({_money(D)}), not of actual amounts ({_money(C)})",
                         which, [])
                elif fee["base"] == "grossed_up" and near(B):
                    base("FEE_ON_EXCLUDED_LINES", "Fee charged on lines the lease excludes from the fee base", B - D,
                         "depends_on_reading",
                         f"The statement's fee base equals the share of every line grossed up ({_money(B)}), so it includes: {labels}",
                         which, ex_lines)
                else:
                    base("FEE_BASE_UNRECONCILED",
                         "Fee base is higher than any base the lease allows, and matches none of the statement's lines",
                         b - ideal, "depends_on_reading",
                         f"The statement's fee base ({_money(b)}) matches none of: all lines ({_money(A)}), all lines grossed up ({_money(B)}), lines the lease allows ({_money(C)}), those grossed up ({_money(D)})",
                         "how the landlord built its fee base (ask for the workpaper)", [])

    # 2. cap
    cap_fact = lease("lease.cam_cap")
    cap_rate_fact = lease("lease.cam_cap_rate")
    if need_share("cap"):
        ref_fact = st("statement.cap_reference")
        applied_cap_fact = st("statement.cap_applied")
        m = missing([(cap_fact or cap_rate_fact, "lease.cam_cap (or lease.cam_cap_rate)"),
                     (ref_fact, "statement.cap_reference"), (applied_cap_fact, "statement.cap_applied"),
                     (period, "statement.period")])
        no_flag = [l for l in lines if l.controllable is None]
        if m:
            skip("cap", f"needs {', '.join(m)}")
        elif no_flag:
            skip("cap", "every line needs a controllable flag (statement.line controllable true or false); "
                        f"missing on: {'; '.join(l.label for l in no_flag)}")
        else:
            ref = ref_fact.value
            n = period["year"] - ref["year"]
            if n < 0:
                skip("cap", f"statement.cap_reference year {ref['year']} is after the statement year {period['year']}")
            else:
                ran["cap"] = ran.get("cap", 0)
                rate = (cap_fact or cap_rate_fact).value["rate"]
                methods = [cap_fact.value["method"]] if cap_fact else \
                    ["compounding_from_base", "simple_from_base", "year_over_year"]

                def limit(mth: str) -> float:
                    if mth == "compounding_from_base":
                        return ref["amount"] * pow_int(1 + rate, n)
                    if mth == "simple_from_base":
                        return ref["amount"] * (1 + rate * n)
                    return ref["amount"] * (1 + rate)

                ctl_lines = [l for l in lines if l.controllable is True]
                Cc = sum_actual(ctl_lines)
                share = S
                billed = share * Cc
                lim = applied_cap_fact.value["limit"]
                landlord = billed if lim is None else min(billed, lim)
                per = [{"mth": mth, "lim": limit(mth), "yield": min(billed, limit(mth))} for mth in methods]
                high = max(p["yield"] for p in per)
                low = min(p["yield"] for p in per)
                steps = [f"Tenant's share of controllable lines: {_pct(share)} x {_money(Cc)} = {_money(billed)}",
                         f"Cap limit the landlord applied: {'none' if lim is None else _money(lim)}; the landlord's controllable charge: {_money(landlord)}",
                         *(f"Cap limit under {p['mth']} (reference {_money(ref['amount'])} in {ref['year']}, {_pct(rate)}, {n} year{'' if n == 1 else 's'}): {_money(p['lim'])}; charge {_money(p['yield'])}" for p in per)]
                lease_facts = [cap_fact or cap_rate_fact, *anchor]
                st_facts = [ref_fact, applied_cap_fact]
                ctl = [l.fact for l in ctl_lines]
                if cap_fact:
                    if landlord - high > TOL:
                        add("cap", "CAP_EXCEEDED",
                            title=f"Controllable charge {_money(landlord)} exceeds the cap ({_money(high)}) under the lease's {per[0]['mth'].replace('_', ' ')} method",
                            cls="follows_from_terms", landlord=_usd(landlord), lease_=_usd(high),
                            difference=_usd(landlord - high), lease_facts=lease_facts, statement_facts=st_facts,
                            lines=ctl, steps=steps,
                            confirm=["that the reference amount is the base-year figure the lease means, and that no line the landlord calls controllable is uncontrollable under the lease's definition"])
                elif landlord - low > TOL:
                    least = max(0, landlord - high)
                    add("cap", "CAP_METHOD_AMBIGUOUS",
                        title=f"The lease states a {_pct(rate)} cap without saying how it builds; the controllable charge is {_money(landlord)} and the cap is between {_money(low)} and {_money(high)} depending on the reading",
                        cls="depends_on_reading", landlord=_usd(landlord), lease_=_usd(high), difference=_usd(least),
                        lease_facts=lease_facts, statement_facts=st_facts, lines=ctl,
                        steps=[*steps, f"Difference to the tenant under the reading most favourable to the landlord: {_money(least)}; under the least favourable: {_money(landlord - low)}"],
                        confirm=["which of the three methods the lease means (the clause says only 'cumulative' or 'non-cumulative', not how the cap builds)"])

    # 3. capital items
    if need_share("capital_items"):
        if capex_fact is None:
            skip("capital_items", "needs lease.capex_treatment (how the lease treats capital items)")
        elif capex["recoverable"] == "amortized" and capex.get("amortization_years") is None:
            skip("capital_items", "lease.capex_treatment says amortized but gives no amortization_years")
        elif (capex["recoverable"] == "amortized" and capex.get("method") == "straight_line"
              and (capex.get("interest_rate") or 0) > 0):
            skip("capital_items", "a declining-balance schedule depends on the year of the improvement; only level-payment amortization is computed (leave it to a person)")
        else:
            ran["capital_items"] = ran.get("capital_items", 0)
            share = S
            n_years = capex.get("amortization_years")
            rate = capex.get("interest_rate") or 0
            for l in lines:
                if not is_capital(l) or l.fact.id in flagged_excluded:
                    continue
                if capex["recoverable"] == "excluded":
                    add("capital_items", "CAPEX_BILLED_AS_OPERATING",
                        title=f"Capital item billed as an operating expense: {l.label}", cls="follows_from_terms",
                        landlord=_usd(share * l.amount), lease_=0, difference=_usd(share * l.amount),
                        lease_facts=[capex_fact, *anchor], statement_facts=[l.fact], lines=[l.fact],
                        steps=[f"{l.label}: {_money(l.amount)} building-level; tenant's share {_pct(share)} = {_money(share * l.amount)}; the lease excludes capital items"],
                        confirm=["that this line is a capital item as the lease defines it (a repair is not a replacement)"])
                elif l.amortization:
                    f = _level_factor(rate, n_years)
                    lease_annual = l.amortization["cost"] * f
                    if share * (l.amount - lease_annual) > TOL:
                        add("capital_items", "CAPEX_AMORTIZATION",
                            title=f"Capital item {l.label} amortized over {l.amortization['years']} years at {_pct(l.amortization['rate'])}; the lease says {n_years} years at {_pct(rate)}",
                            cls="follows_from_terms", landlord=_usd(share * l.amount), lease_=_usd(share * lease_annual),
                            difference=_usd(share * (l.amount - lease_annual)), lease_facts=[capex_fact, *anchor],
                            statement_facts=[l.fact], lines=[l.fact],
                            steps=[f"Cost {_money(l.amortization['cost'])}; the statement bills {_money(l.amount)} for the year",
                                   f"Level annual payment under the lease: {_money(l.amortization['cost'])} x {_n(round_(f, 8))} = {_money(lease_annual)}",
                                   f"Tenant's share {_pct(share)}: landlord {_money(share * l.amount)}; lease {_money(share * lease_annual)}"],
                            confirm=["whether the lease's amortization is a level payment, as computed here"])
                else:
                    lease_annual = l.amount * _level_factor(rate, n_years)
                    if share * (l.amount - lease_annual) > TOL:
                        add("capital_items", "CAPEX_BILLED_AS_OPERATING",
                            title=f"Capital item billed in full; the lease allows amortization over {n_years} years: {l.label}",
                            cls="follows_from_terms", landlord=_usd(share * l.amount), lease_=_usd(share * lease_annual),
                            difference=_usd(share * (l.amount - lease_annual)), lease_facts=[capex_fact, *anchor],
                            statement_facts=[l.fact], lines=[l.fact],
                            steps=[f"{l.label}: {_money(l.amount)} billed in one year",
                                   f"First-year recovery under the lease: {_money(l.amount)} x {_n(round_(_level_factor(rate, n_years), 8))} = {_money(lease_annual)}",
                                   f"Tenant's share {_pct(share)}: landlord {_money(share * l.amount)}; lease {_money(share * lease_annual)}"],
                            confirm=["that this line is a capital item as the lease defines it, and the year the amortization starts"])

    # 4. gross-up
    gross_lease_fact = lease("lease.cam_gross_up")
    gross_lease = val(gross_lease_fact)
    gross_st_fact = st("statement.gross_up")
    gross_st = val(gross_st_fact)
    if need_share("gross_up"):
        if gross_lease_fact is None:
            skip("gross_up", "needs lease.cam_gross_up (the gross-up clause)")
        else:
            ran["gross_up"] = ran.get("gross_up", 0)
            share = S
            variable_only = gross_lease["applies_to"] == "variable_expenses"
            unflagged = [l for l in lines if l.variable is None]
            if variable_only:
                for l in lines:
                    if l.variable is False and l.grossed is not None and l.grossed - l.amount > TOL:
                        add("gross_up", "GROSSUP_ON_FIXED_EXPENSE", title=f"Gross-up applied to a fixed expense: {l.label}",
                            cls="follows_from_terms", landlord=_usd(share * l.grossed), lease_=_usd(share * l.amount),
                            difference=_usd(share * (l.grossed - l.amount)), lease_facts=[gross_lease_fact, *anchor],
                            statement_facts=[l.fact], lines=[l.fact],
                            steps=[f"{l.label}: actual {_money(l.amount)}, grossed up to {_money(l.grossed)}; the lease grosses up variable expenses only"],
                            confirm=["that this expense is fixed (it does not vary with occupancy) as the lease defines it"])
            if gross_st:
                eligible = [l for l in lines if (l.variable is True if variable_only else True)]
                lease_t = gross_lease["target_occupancy"]
                st_t = gross_st["target_occupancy"]
                occ = gross_st["actual_occupancy"]

                def calc(a: float, t: float) -> float:
                    return a * (t / occ) if occ < t else a

                excess: float = 0
                for l in eligible:
                    landlord_amt = l.grossed if l.grossed is not None else calc(l.amount, st_t)
                    lease_amt = calc(l.amount, lease_t)
                    if landlord_amt - lease_amt > TOL:
                        excess += landlord_amt - lease_amt
                if share * excess > TOL:
                    lsum: float = 0
                    ssum: float = 0
                    for l in eligible:
                        lsum += l.grossed if l.grossed is not None else calc(l.amount, st_t)
                        ssum += calc(l.amount, lease_t)
                    add("gross_up", "GROSSUP_WRONG_OCCUPANCY",
                        title=f"Grossed up to {_pct(st_t)} occupancy (actual {_pct(occ)}); the lease grosses up to {_pct(lease_t)}",
                        cls="follows_from_terms", landlord=_usd(share * lsum), lease_=_usd(share * ssum),
                        difference=_usd(share * excess), lease_facts=[gross_lease_fact, *anchor],
                        statement_facts=[gross_st_fact, *(l.fact for l in eligible)], lines=[l.fact for l in eligible],
                        steps=[f"Gross-up eligible lines ({'variable expenses' if variable_only else 'all expenses'}): {'; '.join(l.label for l in eligible)}",
                               f"Landlord's occupancy used: actual {_pct(occ)}, target {_pct(st_t)}; the lease's target is {_pct(lease_t)}",
                               f"Excess grossed-up amount (building level): {_money(excess)}; tenant's share {_pct(share)} = {_money(share * excess)}"],
                        confirm=["the actual occupancy (the statement's figure is used as stated)"])
                by_fact = st("statement.base_year_applied")
                by = val(by_fact)
                if gross_lease.get("base_year_grossed_up") is True and by is not None and by.get("grossed_up") is False:
                    add("gross_up", "GROSSUP_BASE_YEAR_INCONSISTENT",
                        title="The current year is grossed up but the base year deduction is not",
                        cls="question_to_ask", landlord=None, lease_=None, difference=None,
                        lease_facts=[gross_lease_fact, *anchor], statement_facts=[gross_st_fact, by_fact],
                        steps=["The lease grosses up the base year as well; the statement's base-year deduction is not grossed up. A figure needs the base year's occupancy, which the statement does not give."],
                        confirm=["the base year's actual occupancy and whether its expenses were grossed up"])
            if unflagged and variable_only:
                skip("gross_up", f"lines without a variable flag were not tested: {'; '.join(l.label for l in unflagged)}", "partly_run")
            if not gross_st:
                skip("gross_up", "needs statement.gross_up (the occupancy the statement used) for the occupancy and base-year tests; the fixed-expense test ran", "partly_run")

    # 6. excluded categories
    if need_share("excluded_categories"):
        if not exclusions:
            skip("excluded_categories", "needs lease.cam_exclusion (the lease's excluded categories)")
        else:
            ran["excluded_categories"] = ran.get("excluded_categories", 0)
            for l in lines:
                e = excluded_by(l.label)
                if not e:
                    continue
                share = S
                if share * l.amount > TOL:
                    add("excluded_categories", "EXCLUDED_CATEGORY_BILLED",
                        title=f"Billed a category the lease excludes: {l.label}", cls="follows_from_terms",
                        landlord=_usd(share * l.amount), lease_=0, difference=_usd(share * l.amount),
                        lease_facts=[e[0], *anchor], statement_facts=[l.fact], lines=[l.fact],
                        steps=[f"{l.label}: {_money(l.amount)} building-level; tenant's share {_pct(share)} = {_money(share * l.amount)}; matched to the lease's exclusion ({', '.join(e[1])})"],
                        confirm=["that this line is in the excluded category as the lease defines it (the match is by the words in the lease's exclusion)"])

    # 7. duplicates
    if need_share("duplicates"):
        ran["duplicates"] = ran.get("duplicates", 0)
        share = S
        seen: dict[str, _Line] = {}
        for l in lines:
            key = f"{_norm(l.label)}|{_n(round_(l.amount, 2))}"
            first = seen.get(key)
            if first is not None and l.amount > 0:
                add("duplicates", "DUPLICATE_LINE", title=f"The same line appears twice: {l.label} {_money(l.amount)}",
                    cls="depends_on_reading", landlord=_usd(share * l.amount * 2), lease_=_usd(share * l.amount),
                    difference=_usd(share * l.amount), lease_facts=anchor, statement_facts=[first.fact, l.fact],
                    lines=[first.fact, l.fact],
                    steps=[f"Two lines with the same label and amount ({_money(l.amount)}); the second at the tenant's share {_pct(share)} = {_money(share * l.amount)}"],
                    confirm=["that the two lines are one cost billed twice, and not two real costs of the same size"])
            else:
                seen[key] = l
        for sb in S_.get("statement.separately_billed", []):
            x = sb.value
            hit = next((l for l in lines if _norm(l.label) == _norm(x["label"])), None)
            pool_share = share * hit.amount if hit else 0
            if hit and min(pool_share, x["amount"]) > TOL:
                add("duplicates", "DUPLICATE_OF_SEPARATE_BILL",
                    title=f"A line in the statement is also billed separately: {x['label']}", cls="depends_on_reading",
                    landlord=_usd(pool_share + x["amount"]), lease_=_usd(max(pool_share, x["amount"])),
                    difference=_usd(min(pool_share, x["amount"])), lease_facts=anchor, statement_facts=[hit.fact, sb],
                    lines=[hit.fact],
                    steps=[f"Pool line {hit.label}: {_money(hit.amount)}; tenant's share {_pct(share)} = {_money(pool_share)}",
                           f"Billed separately: {_money(x['amount'])}",
                           f"The smaller of the two is the amount billed twice: {_money(min(pool_share, x['amount']))}"],
                    confirm=["that the separate bill is for the same cost as the pool line"])

    # 8. base year or stop
    if need_share("base_year_or_stop"):
        by_fact = st("statement.base_year_applied")
        by = val(by_fact)
        lease_base = lease("lease.operating_expense_base_year")
        stop_fact = lease("lease.expense_stop")
        m = missing([(by, "statement.base_year_applied")])
        if m:
            skip("base_year_or_stop", f"needs {', '.join(m)}")
        elif not lease_base and not stop_fact:
            skip("base_year_or_stop", "needs lease.operating_expense_base_year or lease.expense_stop")
        else:
            ran["base_year_or_stop"] = ran.get("base_year_or_stop", 0)
            share = S
            base_year = lease_base.raw if lease_base else None
            total_fact = next((f for f in S_.get("statement.base_year_total", []) if f.value["year"] == base_year), None)
            total = total_fact.value["amount"] if total_fact else None
            if by.get("stop_amount") is not None and stop_fact:
                stop = stop_fact.value["amount"]
                lease_ded = share * stop
                if lease_ded - by["deduction"] > TOL:
                    add("base_year_or_stop", "STOP_DIFFERS",
                        title=f"Expense stop applied is {_money(by['stop_amount'])}; the lease states {_money(stop)}",
                        cls="follows_from_terms", landlord=_usd(by["deduction"]), lease_=_usd(lease_ded),
                        difference=_usd(lease_ded - by["deduction"]), lease_facts=[stop_fact, *anchor],
                        statement_facts=[by_fact],
                        steps=[f"Deduction on the statement: {_money(by['deduction'])}",
                               f"Lease: {_pct(share)} x {_money(stop)} = {_money(lease_ded)}"],
                        confirm=["that the stop is a building-level annual figure, and whether it escalates"])
            elif base_year is not None and by.get("base_year") is not None:
                if by["base_year"] != base_year:
                    if total is not None:
                        lease_ded = share * total
                        if lease_ded - by["deduction"] > TOL:
                            add("base_year_or_stop", "BASE_YEAR_DIFFERS",
                                title=f"Base year applied is {by['base_year']}; the lease states {base_year}",
                                cls="follows_from_terms", landlord=_usd(by["deduction"]), lease_=_usd(lease_ded),
                                difference=_usd(lease_ded - by["deduction"]), lease_facts=[lease_base, *anchor],
                                statement_facts=[by_fact, total_fact],
                                steps=[f"Deduction on the statement: {_money(by['deduction'])}",
                                       f"Lease: {_pct(share)} x base-year total {_money(total)} ({base_year}) = {_money(lease_ded)}"],
                                confirm=["the base-year total (the statement's figure is used as stated)"])
                    else:
                        add("base_year_or_stop", "BASE_YEAR_DIFFERS",
                            title=f"Base year applied is {by['base_year']}; the lease states {base_year}",
                            cls="depends_on_reading", landlord=None, lease_=None, difference=None,
                            lease_facts=[lease_base, *anchor], statement_facts=[by_fact],
                            steps=["The base-year total for the lease's base year is not among the facts, so no dollar difference is computed."],
                            confirm=["the building's total expenses in the lease's base year"])
                elif total is not None:
                    lease_ded = share * total
                    if lease_ded - by["deduction"] > TOL:
                        add("base_year_or_stop", "BASE_YEAR_DEDUCTION",
                            title=f"Base-year deduction is {_money(by['deduction'])}; the lease's base year ({base_year}) yields {_money(lease_ded)}",
                            cls="follows_from_terms", landlord=_usd(by["deduction"]), lease_=_usd(lease_ded),
                            difference=_usd(lease_ded - by["deduction"]), lease_facts=[lease_base, *anchor],
                            statement_facts=[by_fact, total_fact],
                            steps=[f"Lease: {_pct(share)} x {_money(total)} = {_money(lease_ded)}; statement: {_money(by['deduction'])}"],
                            confirm=["whether the base year's total was adjusted (grossed up, or restated for the lease's definitions)"])

    # 9. arithmetic
    if need_share("arithmetic"):
        ran["arithmetic"] = ran.get("arithmetic", 0)
        share = S
        total_fact = st("statement.total")
        if total_fact:
            t = total_fact.value["amount"]
            total_sum = sum_actual(lines)
            if abs(t - total_sum) > TOL:
                add("arithmetic", "ARITH_LINES_VS_TOTAL",
                    title=f"The lines add to {_money(total_sum)}; the statement's total is {_money(t)}",
                    cls="follows_from_terms", landlord=_usd(t), lease_=_usd(total_sum),
                    difference=_usd(share * (t - total_sum) if t > total_sum else 0), lease_facts=anchor,
                    statement_facts=[total_fact, *(l.fact for l in lines)],
                    steps=[f"Sum of the {len(lines)} lines: {_money(total_sum)}; stated total: {_money(t)}; gap {_money(t - total_sum)}",
                           f"If the charge is computed from the total, the tenant's share of the gap is {_pct(share)} x {_money(t - total_sum)} = {_money(share * (t - total_sum))}"
                           if t > total_sum else "The total is lower than the lines: no overcharge from this gap"],
                    confirm=["which figure the charge was computed from (the lines or the total)"])
        credited = st("statement.estimates_credited")
        paid = st("statement.estimates_paid")
        if credited and paid:
            c = credited.value["amount"]
            p = paid.value["amount"]
            if p - c > TOL:
                add("arithmetic", "ARITH_ESTIMATES",
                    title=f"The statement credits {_money(c)} of estimates; the tenant paid {_money(p)}",
                    cls="follows_from_terms", landlord=_usd(c), lease_=_usd(p), difference=_usd(p - c),
                    lease_facts=anchor, statement_facts=[credited, paid],
                    steps=[f"Estimates paid by the tenant: {_money(p)}; credited on the statement: {_money(c)}; difference {_money(p - c)}"],
                    confirm=["the tenant's payment records (the paid figure is the one given as a fact)"])
        charge = st("statement.tenant_charge")
        balance = st("statement.balance_claimed")
        if charge and credited and balance:
            ch = charge.value["amount"]
            c = credited.value["amount"]
            b = balance.value["amount"]
            if b - (ch - c) > TOL:
                add("arithmetic", "ARITH_BALANCE",
                    title=f"The balance claimed is {_money(b)}; the charge less estimates credited is {_money(ch - c)}",
                    cls="follows_from_terms", landlord=_usd(b), lease_=_usd(ch - c), difference=_usd(b - (ch - c)),
                    lease_facts=anchor, statement_facts=[charge, credited, balance],
                    steps=[f"Charge {_money(ch)} less estimates credited {_money(c)} = {_money(ch - c)}; balance claimed {_money(b)}"],
                    confirm=["whether other charges are included in the balance"])
        if fee_s and fee_fact:
            exp = fee_s["rate"] * fee_s["base_amount"]
            if fee_s["amount"] - exp > 0.01 + TOL:
                add("arithmetic", "ARITH_FEE", title=f"The fee billed is {_money(fee_s['amount'])}; its rate on its base is {_money(exp)}",
                    cls="follows_from_terms", landlord=_usd(fee_s["amount"]), lease_=_usd(exp),
                    difference=_usd(fee_s["amount"] - exp), lease_facts=[fee_fact, *anchor],
                    statement_facts=[fee_statement],
                    steps=[f"{_pct(fee_s['rate'])} x {_money(fee_s['base_amount'])} = {_money(exp)}; billed {_money(fee_s['amount'])}"],
                    confirm=["whether other fees are included in the amount billed"])

    # 10. year over year
    if need_share("year_over_year"):
        prior_lines = P.get("statement.line", [])
        if not prior_lines:
            skip("year_over_year", "needs prior_statement_facts with statement.line facts")
        else:
            ran["year_over_year"] = ran.get("year_over_year", 0)
            by_label: dict[str, dict[str, Any]] = {}
            for f in prior_lines:
                k = _norm(f.value["label"])
                e = by_label.get(k) or {"amount": 0, "facts": []}
                e["amount"] = e["amount"] + f.value["amount"]
                e["facts"].append(f)
                by_label[k] = e
            cur: dict[str, float] = {}
            for l in lines:
                cur[_norm(l.label)] = cur.get(_norm(l.label), 0) + l.amount
            done: set[str] = set()
            for l in lines:
                k = _norm(l.label)
                p = by_label.get(k)
                if p is None or p["amount"] <= 0 or k in done:
                    continue
                done.add(k)
                now = cur[k]
                rise = now / p["amount"] - 1
                if rise > yoy:
                    add("year_over_year", "YOY_RISE",
                        title=f"Question to ask: {l.label} rose {_pct(rise)} ({_money(p['amount'])} to {_money(now)})",
                        cls="question_to_ask", landlord=_usd(now), lease_=_usd(p["amount"]), difference=None,
                        lease_facts=anchor, statement_facts=[l.fact, *p["facts"]], lines=[l.fact],
                        steps=[f"{l.label}: prior year {_money(p['amount'])}, this year {_money(now)}, up {_pct(rise)} (the threshold is {_pct(yoy)})",
                               f"Tenant's share of the rise: {_pct(S)} x {_money(now - p['amount'])} = {_money(S * (now - p['amount']))}. This is a question, not an overcharge."],
                        confirm=["the reason for the rise (a rise is not an error)"])

    # 11. deadlines
    right_fact = lease("lease.audit_right")
    right = val(right_fact)
    deadlines: list[dict[str, Any]] = []
    m = missing([(right_fact, "lease.audit_right"), (period, "statement.period")])
    if m:
        skip("deadlines", f"needs {' and '.join(m)}")
    else:
        ran["deadlines"] = 1
        frm = period["received_date"] if right["starts_from"] == "statement_receipt" else period["statement_date"]
        last = add_days(frm, right["window_days"])
        left = days_between(as_of, last)
        deadlines.append({
            "code": "AUDIT_WINDOW", "title": "Last day to exercise the audit right or dispute the statement",
            "last_day": last, "starts_from": right["starts_from"], "counted_from": frm, "window_days": right["window_days"],
            "as_of": as_of, "status": "open" if left >= 0 else "passed", "days_remaining": left,
            "notice_form": right["notice_form"],
            **({"auditor_requirement": right["auditor"]} if right.get("auditor") is not None else {}),
            "lease_fact_ids": [right_fact.id], "statement_fact_ids": [period_fact.id],
            "sources": [source_of(right_fact, "lease"), source_of(period_fact, "statement")],
            "steps": [f"{'Received' if right['starts_from'] == 'statement_receipt' else 'Dated'} {frm}; {right['window_days']} days later is {last}; as of {as_of}: {f'{left} days left' if left >= 0 else f'{-left} days past'}"],
            "confirm": ["how the lease counts days (calendar days, business days, a day of receipt) and what counts as notice", _CONFIRM_COMMON],
        })

    # totals, then 12. cost-shifting
    firm_sum: float = 0
    reading_sum: float = 0
    for f in findings:
        if f["class"] == "follows_from_terms" and f["difference"] is not None:
            firm_sum += f["difference"]
    for f in findings:
        if f["class"] == "depends_on_reading" and f["difference"] is not None:
            reading_sum += f["difference"]
    cost_shifting = None
    thr = right.get("cost_shift_threshold") if right else None
    charge_fact = st("statement.tenant_charge")
    charge = charge_fact.value["amount"] if charge_fact else None
    if right_fact is None:
        skip("cost_shifting", "needs lease.audit_right")
    elif not thr:
        skip("cost_shifting", "lease.audit_right states no cost-shifting threshold")
    elif thr["type"] == "percent_of_billed" and charge is None:
        skip("cost_shifting", "the threshold is a percent of the amount billed: needs statement.tenant_charge")
    else:
        ran["cost_shifting"] = 1
        amount = thr["value"] if thr["type"] == "amount" else charge * thr["value"]
        cost_shifting = {
            "code": "COST_SHIFT", "threshold_type": thr["type"], "threshold_value": thr["value"],
            "threshold_amount": _usd(amount), "firm_difference": _usd(firm_sum),
            "difference_with_readings": _usd(firm_sum + reading_sum),
            "crosses_on_firm_findings": firm_sum > amount, "crosses_if_readings_hold": firm_sum + reading_sum > amount,
            "lease_fact_ids": [right_fact.id],
            "sources": [source_of(right_fact, "lease"), *([source_of(charge_fact, "statement")] if charge is not None else [])],
            "steps": [f"Threshold: {_money(thr['value'])}" if thr["type"] == "amount"
                      else f"Threshold: {_pct(thr['value'])} of the {_money(charge)} billed = {_money(amount)}",
                      f"Differences that follow from the lease's terms: {_money(firm_sum)}; with the findings that depend on a reading: {_money(firm_sum + reading_sum)}",
                      f"The lease's threshold is {'crossed' if firm_sum > amount else 'crossed only if the readings hold' if firm_sum + reading_sum > amount else 'not crossed'}"],
            "confirm": ["how the lease measures the overcharge (the whole statement, or each line) and whether the threshold is 'more than' or 'at least'"],
        }

    # items for fact_package_send
    flagged_lines = {i for f in findings for i in f["line_fact_ids"]}
    items: list[dict[str, Any]] = []
    not_sent: list[str] = []
    for f in findings:
        if f["class"] == "question_to_ask" or f["landlord_figure"] is None or f["lease_figure"] is None:
            not_sent.append(f["id"])
            continue
        items.append({"key": f["id"], "label": f["title"][:160], "value": f["lease_figure"], "unit": "USD",
                      "position": "state_ours", "their_value": f["landlord_figure"],
                      "fact_ids": [*f["lease_fact_ids"], *f["statement_fact_ids"]]})
    for i, l in enumerate(lines):
        if l.fact.id in flagged_lines:
            continue
        items.append({"key": f"LINE.{i + 1}", "label": l.label[:160], "value": l.amount, "unit": "USD",
                      "position": "accept_theirs", "their_value": l.amount, "fact_ids": [l.fact.id]})

    checks = []
    for check, name in _CHECKS:
        nr = [x for x in not_run if x["check"] == check]
        status = "not_run" if any(x["status"] == "not_run" for x in nr) else "partly_run" if nr else "ran"
        checks.append({"check": check, "name": name, "status": status,
                       "findings": sum(1 for f in findings if f["check"] == check),
                       **({"reason": "; ".join(x["reason"] for x in nr)} if nr else {})})
    facts_used: dict[str, None] = {}
    for f in findings:
        for i in [*f["lease_fact_ids"], *f["statement_fact_ids"]]:
            facts_used[i] = None
    for d in deadlines:
        for i in [*d["lease_fact_ids"], *d["statement_fact_ids"]]:
            facts_used[i] = None
    for l in lines:
        facts_used[l.fact.id] = None
    firm_count = sum(1 for f in findings if f["class"] == "follows_from_terms")
    reading_count = sum(1 for f in findings if f["class"] == "depends_on_reading")
    question_count = sum(1 for f in findings if f["class"] == "question_to_ask")
    return {
        "as_of": as_of,
        "statement_year": period["year"] if period else None,
        "findings": findings,
        "totals": {"finding_count": len(findings), "follows_from_terms": firm_count, "depends_on_reading": reading_count,
                   "question_to_ask": question_count, "firm_difference": _usd(firm_sum),
                   "difference_with_readings": _usd(firm_sum + reading_sum),
                   "total_difference": _usd(firm_sum + reading_sum), "unit": "USD"},
        "deadlines": deadlines,
        "cost_shifting": cost_shifting,
        "checks": checks,
        "checks_not_run": not_run,
        "package_items": items,
        "questions_not_sent": not_sent,
        "facts_used": list(facts_used),
        "facts_ignored": {"lease": list(dict.fromkeys(ignored_lease)), "statement": list(dict.fromkeys(ignored_statement))},
        "notes": [
            "A finding is a difference between the statement and what the lease's quoted terms yield, with the sources named. It is not a legal conclusion: findings that depend on a reading of the lease, and questions, say so in their class.",
            "Each finding isolates one error while holding the others as the statement has them; findings can overlap where one line breaks more than one term, so the total is the sum of the findings, not a recomputed charge.",
        ],
    }


def audit_summary(full: dict[str, Any]) -> dict[str, Any]:
    t = full["totals"]
    return {
        "limited": True,
        "summary": {
            "finding_count": t["finding_count"], "total_difference": t["total_difference"],
            "firm_difference": t["firm_difference"], "unit": "USD",
            "deadlines": [{"code": d["code"], "last_day": d["last_day"], "status": d["status"],
                           "days_remaining": d["days_remaining"], "notice_form": d["notice_form"]}
                          for d in full["deadlines"]],
            "checks_not_run": full["checks_not_run"],
        },
        "audit_available": "pro",
        "audit_withheld": [
            "each finding (code, title, the landlord's figure, the lease's figure, the difference, the quotes and pages, the calculation steps)",
            "the audit cost-shifting test",
            "the items to send with fact_package_send",
            "the audit report (report_create kind expense_audit)",
        ],
        "audit_note": ("The count, total difference, deadlines and checks that could not run are free. Each finding with its "
                       "lease quote and calculation, the report and sending the dispute as a package are part of the paid "
                       f"plans (Pro and Team): {AUDIT_PLAN_URL}"),
    }


def audit_expense_statement(inp: dict[str, Any]) -> dict[str, Any]:
    full = _audit(inp)
    return audit_summary(full) if audit_limited() else full
