"""rent_roll_certify: check a commercial rent roll, line by line, against the leases and the tenant's estoppel answers.

The same code as packages/tools/src/rentroll.ts (spec/differential runs both on the same inputs). Each line
of the roll is graded: matches lease; matches lease and confirmed by tenant; differs (both figures, the
difference and the quotes); no lease supplied; not checkable (with the reason). Deterministic: no model, no
clock (as_of is an input); no source, no fact; nothing is approximated. Facts and arithmetic, not legal,
appraisal or lending advice: the certifying party's certification, not FactLot, is what a lender or buyer
relies on, and FactLot checked the roll against the documents supplied only.
"""
from __future__ import annotations

import functools
from typing import Any

from ._core import round_
from .audit import _Bad, _date, _enum, _int, _is_num, _num, _opt, _str, _strict, audit_limited
from .calc import walt
from .dates import add_months, days_between
from .docverify import DocInputError, json_equal, validate_fact_full
from .estoppel import _long_date, _money, _n, _norm_name, _sf, _sha

RENT_ROLL_PLAN_URL = "https://factlot.com/pricing/"
RENT_ROLL_MAX_LINES = 60
RENT_ROLL_PACKAGE_FACTS = 600

ESTOPPEL_CODES = ("COMMENCEMENT", "EXPIRATION", "PREMISES", "BASE_RENT", "NEXT_RENT_STEP", "SECURITY_DEPOSIT",
                  "FREE_RENT", "OPTION_RENEWAL")

_TEXT = _str(1, 600)
_N = _num()
_STRUCTURES = ("nnn", "modified_gross", "gross", "base_year", "other")

_ROLL_SHAPES: dict[str, Any] = {
    "rent_roll.tenant_name": _TEXT,
    "rent_roll.suite": _TEXT,
    "rent_roll.rentable_area_sf": _num(gt=0),
    "rent_roll.lease_start_date": _date,
    "rent_roll.lease_expiration_date": _date,
    "rent_roll.base_rent_monthly": _num(lo=0),
    "rent_roll.base_rent_annual": _num(lo=0),
    "rent_roll.base_rent_psf": _num(lo=0),
    "rent_roll.next_rent_step": _strict({"date": _date, "annual_rent_psf": _opt(_num(lo=0)),
                                         "annual_rent": _opt(_num(lo=0)), "monthly_rent": _opt(_num(lo=0))}),
    "rent_roll.security_deposit": _num(lo=0),
    "rent_roll.free_rent_outstanding": _strict({"months": _opt(_num(lo=0)), "amount": _opt(_num(lo=0))}),
    "rent_roll.renewal_option": _strict({"count": _opt(_num(lo=0)), "term_months": _opt(_num(gt=0))}),
    "rent_roll.recoveries": _strict({"structure": _enum(*_STRUCTURES), "base_year": _opt(_int(1900, 2200))}),
}


def _schedule(x: Any) -> Any:
    if not isinstance(x, list) or not 1 <= len(x) <= 200:
        raise _Bad("expected 1 to 200 steps")
    step = _strict({"from": _date, "to": _date, "annual_rent_psf": _num(lo=0)})
    return [step(s) for s in x]


_LEASE_SHAPES: dict[str, Any] = {
    "lease.tenant": _TEXT,
    "lease.suite": _TEXT,
    "lease.commencement_date": _date,
    "lease.expiration_date": _date,
    "lease.rent_commencement_date": _date,
    "lease.rentable_area_sf": _num(gt=0),
    "lease.base_rent_schedule": _schedule,
    "lease.security_deposit": _num(gt=0),
    "lease.free_rent": _strict({"months": _opt(_num(gt=0)), "applies_to": _opt(_enum("base_rent", "gross_rent"))}),
    "lease.renewal_option": _strict({"count": _opt(_num(gt=0)), "term_months": _opt(_num(gt=0)),
                                     "notice_months": _opt(_num(gt=0)), "rent": _opt(_TEXT)}),
    "lease.recovery_structure": _strict({"structure": _enum(*_STRUCTURES)}),
    "lease.operating_expense_base_year": _int(1900, 2200),
}

GRADES = ("matches_lease", "matches_lease_confirmed_by_tenant", "differs", "no_lease_supplied", "not_checkable")
GRADE_LABEL = {
    "matches_lease": "Matches lease",
    "matches_lease_confirmed_by_tenant": "Matches lease and confirmed by tenant",
    "differs": "Differs from lease",
    "no_lease_supplied": "No lease supplied",
    "not_checkable": "Not checkable",
}
_FIELD_LABEL = {
    "tenant_name": "Tenant name", "suite": "Suite", "area": "Rentable area", "start": "Lease start",
    "expiration": "Lease expiration", "rent_annual": "Base rent per year", "rent_monthly": "Base rent per month",
    "rent_psf": "Base rent per SF per year", "rent_internal": "The roll's own arithmetic",
    "next_step": "Next rent step", "deposit": "Security deposit", "free_rent": "Free rent outstanding",
    "renewal": "Renewal options", "recoveries": "Recoveries",
}
_FIELD_CODE = {
    "area": "PREMISES", "start": "COMMENCEMENT", "expiration": "EXPIRATION", "rent": "BASE_RENT",
    "next_step": "NEXT_RENT_STEP", "deposit": "SECURITY_DEPOSIT", "free_rent": "FREE_RENT",
    "renewal": "OPTION_RENEWAL",
}
_RENT_FIELDS = ["rent_annual", "rent_monthly", "rent_psf"]
_CONFIRM_FIELDS = ["area", "expiration", "rent"]


def _usd(x: float) -> float:
    return round_(x, 2)


def _pct4(x: float) -> float:
    return round_(x, 4)


class _RFact:
    __slots__ = ("id", "predicate", "value", "quote", "page", "section", "document_id", "valid_from", "supersedes")

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)


def _src(f: _RFact | None) -> dict[str, Any] | None:
    if f is None:
        return None
    return {"fact_id": f.id, "predicate": f.predicate, "document_id": f.document_id, "sha256": _sha(f.document_id),
            "page": f.page, "quote": f.quote, "section": f.section}


def _read_facts(items: list[Any], at: str, ns: str, shapes: dict[str, Any], seen: set[str],
                issues: list[dict[str, str]], ignored: list[str]) -> list[_RFact]:
    out: list[_RFact] = []
    for i, f in enumerate(items):
        here = f"{at}.{i}"
        v = validate_fact_full(f)
        if not v["valid"]:
            for x in v["issues"][:3]:
                issues.append({"path": f"{here}{'.' + x['path'] if x['path'] else ''}",
                               "message": f"not a valid fact (fact_validate): {x['message']}"})
            continue
        id_ = str(f["id"])
        predicate = str(f["predicate"])
        sources = (f.get("provenance") or {}).get("sources")
        src = sources[0] if isinstance(sources, list) and sources else None
        if (not isinstance(src, dict) or not isinstance(src.get("quote"), str) or src["quote"].strip() == ""
                or not _is_num(src.get("page"))):
            issues.append({"path": f"{here}.provenance.sources",
                           "message": "no source: every fact the certification reads needs a quote and a page (no source, no fact)"})
            continue
        if not predicate.startswith(ns):
            issues.append({"path": f"{here}.predicate",
                           "message": f"{predicate} is not a {ns[:-1]} fact: {at} holds {ns}* predicates"})
            continue
        if "id" not in f or id_ == "undefined":
            issues.append({"path": f"{here}.id", "message": "every fact needs an id"})
            continue
        if id_ in seen:
            issues.append({"path": f"{here}.id", "message": f"duplicate fact id {id_}"})
            continue
        seen.add(id_)
        shape = shapes.get(predicate)
        if shape is None:
            ignored.append(predicate)
            continue
        try:
            parsed = shape(f.get("value"))
        except _Bad as e:
            issues.append({"path": f"{here}.value", "message": f"{predicate}: {e}"})
            continue
        sup = f.get("supersedes")
        out.append(_RFact(
            id=id_, predicate=predicate, value=parsed, quote=src["quote"], page=src["page"],
            section=src["section"] if isinstance(src.get("section"), str) else None,
            document_id=src["document_id"] if isinstance(src.get("document_id"), str) else None,
            valid_from=f["valid_from"] if isinstance(f.get("valid_from"), str) else None,
            supersedes=[x for x in sup if isinstance(x, str)] if isinstance(sup, list) else []))
    return out


class _Line:
    def __init__(self, number: int, line_id: str, vacant: bool, facts: dict[str, _RFact], all_: list[_RFact]):
        self.number, self.line_id, self.vacant, self.facts, self.all = number, line_id, vacant, facts, all_


class _LeaseIn:
    def __init__(self, index: int, label: str | None, line_id: str | None, facts: list[_RFact], estoppel: Any):
        self.index, self.label, self.line_id, self.facts, self.estoppel = index, label, line_id, facts, estoppel


class _Out:
    def __init__(self, line: _Line, tenant: str, suite: str | None, roll_annual: float | None, roll_basis: str | None):
        self.line, self.tenant, self.suite = line, tenant, suite
        self.grade: str | None = None
        self.checks: list[dict[str, Any]] = []
        self.reasons: list[str] = []
        self.roll_annual, self.roll_basis = roll_annual, roll_basis
        self.lease_annual: float | None = None
        self.lease_exp: str | None = None
        self.lease_area: float | None = None
        self.has_lease = False
        self.confirmed: list[str] = []
        self.estoppel_package: str | None = None
        self.estoppel_statements: list[str] = []
        self.fact_ids: list[str] = []


class _Step:
    def __init__(self, from_: str, to: str, psf: float, fact: _RFact):
        self.from_, self.to, self.psf, self.fact = from_, to, psf, fact


def _cmp(a: Any, b: Any) -> int:
    return -1 if a < b else (1 if a > b else 0)


def certify_rent_roll(inp: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    ignored: list[str] = []
    seen: set[str] = set()
    warnings: list[str] = []
    as_of: str = inp["as_of"]
    tol = inp.get("tolerance") or {}
    tol_annual = tol["annual_usd"] if tol.get("annual_usd") is not None else 1
    tol_psf = tol["psf"] if tol.get("psf") is not None else 0.01
    tol_monthly = tol_annual / 12

    # ---- roll lines
    line_ids: set[str] = set()
    lines: list[_Line] = []
    for i, l in enumerate(inp["roll_lines"]):
        at = f"roll_lines.{i}"
        if l["line_id"] in line_ids:
            issues.append({"path": f"{at}.line_id", "message": f"duplicate line id {l['line_id']}"})
        line_ids.add(l["line_id"])
        facts = _read_facts(l["facts"], f"{at}.facts", "rent_roll.", _ROLL_SHAPES, seen, issues, ignored)
        by_pred: dict[str, _RFact] = {}
        for f in facts:
            if f.predicate in by_pred:
                issues.append({"path": f"{at}.facts",
                               "message": f"two facts for {f.predicate} on line {l['line_id']}: a roll line has one value for each field"})
            else:
                by_pred[f.predicate] = f
        lines.append(_Line(i + 1, l["line_id"], l.get("occupancy") == "vacant", by_pred, facts))

    # ---- leases
    leases_in: list[_LeaseIn] = []
    for i, l in enumerate(inp.get("leases") or []):
        at = f"leases.{i}"
        leases_in.append(_LeaseIn(i, l.get("label"), l.get("line_id"),
                                  _read_facts(l["facts"], f"{at}.facts", "lease.", _LEASE_SHAPES, seen, issues, ignored),
                                  l.get("estoppel")))
    rp = inp["parties"].get("relying_party")
    if rp and inp["parties"]["certifier"]["organisation"].strip().lower() == rp["organisation"].strip().lower():
        issues.append({"path": "parties.relying_party.organisation",
                       "message": "the relying party must be a different organisation from the certifier"})

    lease_of: dict[str, _LeaseIn] = {}
    unmatched: list[tuple[_LeaseIn, str]] = []

    def name_of_line(l: _Line) -> str | None:
        f = l.facts.get("rent_roll.tenant_name")
        return str(f.value) if f else None

    def lease_tenant(l: _LeaseIn) -> str | None:
        f = next((x for x in l.facts if x.predicate == "lease.tenant"), None)
        return str(f.value) if f else None

    line_by_id = {l.line_id: l for l in lines}
    for ls in leases_in:
        at = f"leases.{ls.index}"
        if ls.line_id is not None:
            ln = line_by_id.get(ls.line_id)
            if ln is None:
                unmatched.append((ls, f"names roll line {ls.line_id}, which is not on the roll"))
                continue
            if ln.vacant:
                unmatched.append((ls, f"names roll line {ls.line_id}, which the roll shows as vacant"))
                continue
            if ln.line_id in lease_of:
                issues.append({"path": f"{at}.line_id",
                               "message": f"two leases name roll line {ln.line_id}: give one lease entry with the facts of the lease and its amendments together"})
                continue
            lease_of[ln.line_id] = ls
    for ls in leases_in:
        if ls.line_id is not None:
            continue
        t = lease_tenant(ls)
        if t is None:
            unmatched.append((ls, "names no roll line and has no lease.tenant fact to match a tenant name"))
            continue
        cands = [l for l in lines if not l.vacant and l.line_id not in lease_of and name_of_line(l) is not None
                 and _norm_name(name_of_line(l)) == _norm_name(t)]  # type: ignore[arg-type]
        all_ = [l for l in lines if not l.vacant and name_of_line(l) is not None
                and _norm_name(name_of_line(l)) == _norm_name(t)]  # type: ignore[arg-type]
        if len(cands) == 1:
            lease_of[cands[0].line_id] = ls
        else:
            unmatched.append((ls, f"matches no tenant name on the roll ({t})" if len(all_) == 0 else
                              f"matches {len(all_)} roll lines by tenant name: name the line with line_id"))
    if issues:
        raise DocInputError(issues[:20])

    # ---- per-line checks
    flags: list[dict[str, Any]] = []

    def flag(code: str, severity: str, line_id: str | None, message: str) -> None:
        flags.append({"code": code, "severity": severity, "line_id": line_id, "message": message})

    outs: list[_Out] = []

    for ln in lines:
        def rf(p: str, ln: _Line = ln) -> _RFact | None:
            return ln.facts.get(f"rent_roll.{p}")

        def rv(p: str, ln: _Line = ln) -> Any:
            f = rf(p)
            return f.value if f else None

        tenant = rv("tenant_name") if rv("tenant_name") is not None else ln.line_id
        suite = rv("suite")
        roll_area = rv("rentable_area_sf")
        m_annual = rv("base_rent_annual")
        m_monthly = rv("base_rent_monthly")
        m_psf = rv("base_rent_psf")
        roll_annual: float | None = None
        roll_basis: str | None = None
        if m_annual is not None:
            roll_annual, roll_basis = _usd(m_annual), "stated per year"
        elif m_monthly is not None:
            roll_annual, roll_basis = _usd(m_monthly * 12), "stated per month, times 12"
        elif m_psf is not None and roll_area is not None:
            roll_annual, roll_basis = _usd(m_psf * roll_area), "stated per SF, times the area on the roll"
        o = _Out(ln, tenant, suite, roll_annual, roll_basis)
        outs.append(o)
        if ln.vacant:
            continue

        lease = lease_of.get(ln.line_id)
        o.has_lease = lease is not None

        lf = lease.facts if lease else []
        pending = [f for f in lf if f.valid_from is not None and f.valid_from > as_of]
        pending_ids = {f.id for f in pending}
        live = [f for f in lf if f.id not in pending_ids]
        superseded_by: set[str] = set()
        for f in live:
            for s in f.supersedes:
                superseded_by.add(s)

        def is_current(f: _RFact, superseded_by: set[str] = superseded_by) -> bool:
            return f.id not in superseded_by

        if pending:
            flag("LEASE_FACTS_PENDING", "info", ln.line_id,
                 f"{len(pending)} lease fact{'' if len(pending) == 1 else 's'} for {tenant} take effect after the as-of date and are not used")

        conflicted_preds: list[str] = []

        def lease1(p: str, live: list[_RFact] = live, is_current: Any = is_current,
                   conflicted_preds: list[str] = conflicted_preds) -> dict[str, Any]:
            c = [f for f in live if f.predicate == p and is_current(f)]
            if not c:
                return {"fact": None, "blocked": "no lease fact states it"}
            if any(not json_equal(x.value, c[0].value) for x in c):
                conflicted_preds.append(p)
                return {"fact": None,
                        "blocked": f"the lease facts disagree about {p.replace('lease.', '').replace('_', ' ')} and no amendment is marked as superseding the other"}
            return {"fact": c[0], "blocked": None}

        def push(o: _Out = o, **c: Any) -> dict[str, Any]:
            full: dict[str, Any] = {
                "label": _FIELD_LABEL[c["field"]], "roll_value": None, "against": None, "against_value": None,
                "unit": None, "difference": None, "difference_unit": None, "within_rounding": False,
                "roll_source": None, "lease_source": None, "reason": None, "estoppel": None,
            }
            full.update(c)
            o.checks.append(full)
            return full

        def not_stated(field: str, push: Any = push) -> None:
            push(field=field, status="not_stated", reason="the roll does not state it")

        def not_checked(field: str, roll_f: _RFact | None, roll_value: Any, unit: str | None, reason: str,
                        push: Any = push) -> None:
            push(field=field, status="not_checked", roll_value=roll_value, unit=unit, roll_source=_src(roll_f),
                 reason=reason)

        def compare_num(field: str, roll_f: _RFact | None, roll_value: float, lease_f: _RFact | None,
                        lease_value: float, unit: str, tol_: float, dp: int, push: Any = push) -> dict[str, Any]:
            diff = round_(roll_value - lease_value, dp)
            within = abs(roll_value - lease_value) <= tol_ + 1e-9
            return push(field=field, status="match" if within else "differs", roll_value=roll_value, against="lease",
                        against_value=lease_value, unit=unit, difference=diff, difference_unit=unit,
                        within_rounding=within and diff != 0, roll_source=_src(roll_f), lease_source=_src(lease_f))

        def compare_text(field: str, roll_f: _RFact | None, roll_value: str, lease_f: _RFact | None,
                         lease_value: str, push: Any = push) -> dict[str, Any]:
            return push(field=field, status="match" if _norm_name(roll_value) == _norm_name(lease_value) else "differs",
                        roll_value=roll_value, against="lease", against_value=lease_value, unit="text",
                        roll_source=_src(roll_f), lease_source=_src(lease_f))

        def compare_date(field: str, roll_f: _RFact | None, roll_value: str, lease_f: _RFact | None,
                         lease_value: str, push: Any = push) -> dict[str, Any]:
            return push(field=field, status="match" if roll_value == lease_value else "differs", roll_value=roll_value,
                        against="lease", against_value=lease_value, unit="date",
                        difference=0 if roll_value == lease_value else days_between(lease_value, roll_value),
                        difference_unit="days", roll_source=_src(roll_f), lease_source=_src(lease_f))

        def no_lease_fact(field: str, roll_f: _RFact | None, roll_value: Any, unit: str | None, p: str,
                          blocked: str | None) -> None:
            not_checked(field, roll_f, roll_value, unit,
                        blocked if blocked and blocked != "no lease fact states it"
                        else f"the lease facts supplied do not state {p}")

        # Roll's own arithmetic: monthly rent times 12 against annual rent.
        if m_annual is not None and m_monthly is not None:
            twelve = _usd(m_monthly * 12)
            diff = round_(m_annual - twelve, 2)
            if abs(m_annual - twelve) > tol_annual + 1e-9:
                push(field="rent_internal", status="differs", roll_value=m_annual, against="roll", against_value=twelve,
                     unit="USD per year", difference=diff, difference_unit="USD per year",
                     roll_source=_src(rf("base_rent_annual")), lease_source=_src(rf("base_rent_monthly")),
                     reason="the roll's monthly rent times 12 is not its annual rent")
                flag("ROLL_RENT_INTERNAL", "difference", ln.line_id,
                     f"{tenant}: the roll states {_money(m_monthly)} per month ({_money(twelve)} per year) and {_money(m_annual)} per year, a difference of {_money(abs(diff))}")

        # Tenant name and suite.
        for field, p, lp, what in (("tenant_name", "tenant_name", "lease.tenant", "the tenant"),
                                   ("suite", "suite", "lease.suite", "the suite")):
            f = rf(p)
            if f is None:
                not_stated(field)
            elif lease is None:
                not_checked(field, f, str(f.value), "text", "no lease was supplied")
            else:
                l = lease1(lp)
                if l["fact"]:
                    compare_text(field, f, str(f.value), l["fact"], str(l["fact"].value))
                else:
                    no_lease_fact(field, f, str(f.value), "text", what, l["blocked"])
        # Area.
        la = lease1("lease.rentable_area_sf") if lease else {"fact": None, "blocked": None}
        lease_area_v = la["fact"].value if la["fact"] else None
        o.lease_area = lease_area_v
        f = rf("rentable_area_sf")
        if f is None:
            not_stated("area")
        elif lease is None:
            not_checked("area", f, roll_area, "SF", "no lease was supplied")
        elif la["fact"]:
            compare_num("area", f, roll_area, la["fact"], lease_area_v, "SF", 0.005, 2)
        else:
            no_lease_fact("area", f, roll_area, "SF", "the rentable area", la["blocked"])
        # Start and expiration.
        for field, rp_, lp in (("start", "lease_start_date", "lease.commencement_date"),
                               ("expiration", "lease_expiration_date", "lease.expiration_date")):
            f = rf(rp_)
            if f is None:
                not_stated(field)
            elif lease is None:
                not_checked(field, f, str(f.value), "date", "no lease was supplied")
            else:
                l = lease1(lp)
                if l["fact"]:
                    compare_date(field, f, str(f.value), l["fact"], str(l["fact"].value))
                else:
                    no_lease_fact(field, f, str(f.value), "date", lp.replace("lease.", "the ").replace("_", " "),
                                  l["blocked"])
        le = lease1("lease.expiration_date") if lease else {"fact": None, "blocked": None}
        o.lease_exp = str(le["fact"].value) if le["fact"] else None

        # The lease's rent schedule at the as-of date.
        now_step: _Step | None = None
        next_step: _Step | None = None
        schedule_block: str | None = None
        steps: list[_Step] = []
        if lease:
            sched = [f for f in live if f.predicate == "lease.base_rent_schedule"]

            def steps_of(f: _RFact) -> list[_Step]:
                return [_Step(s["from"], s["to"], s["annual_rent_psf"], f) for s in f.value]

            def overlaps(a: _Step, b: _Step) -> bool:
                return a.from_ <= b.to and b.from_ <= a.to

            accepted: list[_Step] = []
            conflicted = False
            for f in [x for x in sched if is_current(x)]:
                for s in steps_of(f):
                    clash = next((a for a in accepted if overlaps(a, s)), None)
                    if clash:
                        if clash.psf != s.psf:
                            conflicted = True
                        continue
                    accepted.append(s)
            carried: list[_Step] = []
            for f in [x for x in sched if not is_current(x)]:
                for s in steps_of(f):
                    if not any(overlaps(a, s) for a in accepted) and not any(overlaps(a, s) for a in carried):
                        carried.append(s)
            steps = sorted(accepted + carried, key=functools.cmp_to_key(lambda a, b: _cmp(a.from_, b.from_)))
            if conflicted:
                schedule_block = ("the lease's rent schedule facts overlap with different rents and no amendment is "
                                  "marked as superseding the other")
                conflicted_preds.append("lease.base_rent_schedule")
            elif not steps:
                schedule_block = "the lease facts supplied do not state the base rent schedule"
            else:
                now_step = next((s for s in steps if s.from_ <= as_of and as_of <= s.to), None)
                next_step = next((s for s in steps if s.from_ > as_of), None)
                if now_step is None:
                    schedule_block = f"the lease's rent schedule has no step covering {_long_date(as_of)}"

        def step_at(d: str, steps: list[_Step] = steps) -> _Step | None:
            return next((s for s in steps if s.from_ <= d and d <= s.to), None)

        lease_annual = _usd(now_step.psf * lease_area_v) if now_step and lease_area_v is not None else None
        lease_monthly = _usd(lease_annual / 12) if lease_annual is not None else None
        o.lease_annual = lease_annual

        def rent_reason(needs_area: bool, lease: Any = lease, schedule_block: Any = schedule_block, la: Any = la) -> str:
            if not lease:
                return "no lease was supplied"
            if schedule_block:
                return schedule_block
            if needs_area:
                if la["blocked"] and la["blocked"] != "no lease fact states it":
                    return la["blocked"]
                return "the lease facts supplied do not state the rentable area, which the annual and monthly rent need"
            return ""

        rent_src = now_step.fact if now_step else None
        if m_annual is None and m_monthly is None and m_psf is None:
            not_stated("rent_annual")
        if m_annual is not None:
            f = rf("base_rent_annual")
            if lease_annual is not None:
                compare_num("rent_annual", f, m_annual, rent_src, lease_annual, "USD per year", tol_annual, 2)
            else:
                not_checked("rent_annual", f, m_annual, "USD per year", rent_reason(now_step is not None))
        if m_monthly is not None:
            f = rf("base_rent_monthly")
            if lease_monthly is not None:
                compare_num("rent_monthly", f, m_monthly, rent_src, lease_monthly, "USD per month", tol_monthly, 2)
            else:
                not_checked("rent_monthly", f, m_monthly, "USD per month", rent_reason(now_step is not None))
        if m_psf is not None:
            f = rf("base_rent_psf")
            if now_step:
                compare_num("rent_psf", f, m_psf, rent_src, now_step.psf, "USD per SF per year", tol_psf, 4)
            else:
                not_checked("rent_psf", f, m_psf, "USD per SF per year", rent_reason(False))
        if lease_annual is not None and o.roll_annual is not None and o.roll_annual - lease_annual > tol_annual + 1e-9:
            flag("ROLL_RENT_ABOVE_LEASE", "difference", ln.line_id,
                 f"{tenant}: the roll's base rent ({_money(o.roll_annual)} per year) is above what the lease yields ({_money(lease_annual)}), by {_money(o.roll_annual - lease_annual)}")

        # Next step.
        f = rf("next_rent_step")
        v = rv("next_rent_step")
        if f is None or v is None:
            not_stated("next_step")
        elif lease is None:
            not_checked("next_step", f, v["date"], "date", "no lease was supplied")
        elif schedule_block and next_step is None:
            not_checked("next_step", f, v["date"], "date", schedule_block)
        elif next_step is None:
            not_checked("next_step", f, v["date"], "date",
                        f"the lease facts supplied show no rent step after {_long_date(as_of)}")
        else:
            c = compare_date("next_step", f, v["date"], next_step.fact, next_step.from_)
            n_annual = _usd(next_step.psf * lease_area_v) if lease_area_v is not None else None
            parts = [
                ("per SF per year", v.get("annual_rent_psf"), next_step.psf, tol_psf),
                ("per year", v.get("annual_rent"), n_annual, tol_annual),
                ("per month", v.get("monthly_rent"), _usd(n_annual / 12) if n_annual is not None else None, tol_monthly),
            ]
            for what, roll_v, lease_v, tol_ in parts:
                if roll_v is None:
                    continue
                if lease_v is None:
                    continue
                if abs(roll_v - lease_v) > tol_ + 1e-9 and c["status"] == "match":
                    c["status"] = "differs"
                    c["reason"] = f"the step's rent {what} is {_money(roll_v)} on the roll and {_money(lease_v)} in the lease"
                elif abs(roll_v - lease_v) > tol_ + 1e-9:
                    c["reason"] = (f"{c['reason']}; " if c["reason"] else "") + \
                        f"the step's rent {what} is {_money(roll_v)} on the roll and {_money(lease_v)} in the lease"

        # Security deposit.
        f = rf("security_deposit")
        if f is None:
            not_stated("deposit")
        elif lease is None:
            not_checked("deposit", f, rv("security_deposit"), "USD", "no lease was supplied")
        else:
            l = lease1("lease.security_deposit")
            if l["fact"]:
                compare_num("deposit", f, rv("security_deposit"), l["fact"], l["fact"].value, "USD", 0.005, 2)
            else:
                no_lease_fact("deposit", f, rv("security_deposit"), "USD", "a security deposit", l["blocked"])

        # Free rent outstanding.
        f = rf("free_rent_outstanding")
        v = rv("free_rent_outstanding")
        if f is None or v is None:
            not_stated("free_rent")
        else:
            v_months, v_amount = v.get("months"), v.get("amount")
            shown = v_months if v_months is not None else v_amount
            if lease is None:
                not_checked("free_rent", f, shown, "months" if v_months is not None else "USD", "no lease was supplied")
            else:
                fr = lease1("lease.free_rent")
                rc = lease1("lease.rent_commencement_date")
                lm = fr["fact"].value.get("months") if fr["fact"] else None
                if v_months is not None and lm is not None:
                    push(field="free_rent", status="match" if v_months <= lm else "differs", roll_value=v_months,
                         against="lease", against_value=lm, unit="months", difference=round_(v_months - lm, 2),
                         difference_unit="months", roll_source=_src(f), lease_source=_src(fr["fact"]),
                         reason="outstanding free rent is within the months the lease grants" if v_months <= lm
                         else "the roll shows more free rent outstanding than the lease grants")
                elif v_months == 0 and rc["fact"] and str(rc["fact"].value) > as_of:
                    push(field="free_rent", status="differs", roll_value=0, against="lease",
                         against_value=str(rc["fact"].value), unit="months", roll_source=_src(f),
                         lease_source=_src(rc["fact"]),
                         reason=f"the roll shows no free rent outstanding, but the lease's rent commencement date ({_long_date(str(rc['fact'].value))}) is after the as-of date")
                else:
                    not_checked("free_rent", f, shown, "months" if v_months is not None else "USD",
                                "the roll states a dollar amount and the lease states months, not an amount"
                                if v_months is None else
                                "the lease facts supplied state no free rent period to compare with")

        # Renewal options.
        f = rf("renewal_option")
        v = rv("renewal_option")

        def ren_text(x: dict[str, Any]) -> str:
            cnt = x.get("count")
            if cnt == 0 and cnt is not None:
                return "none"
            return (f"{_n(cnt) if cnt is not None else 'an'} option{'' if cnt == 1 or cnt is None else 's'}"
                    + (f" of {_n(x['term_months'])} months" if x.get("term_months") is not None else ""))

        if f is None or v is None:
            not_stated("renewal")
        elif lease is None:
            not_checked("renewal", f, ren_text(v), "text", "no lease was supplied")
        else:
            l = lease1("lease.renewal_option")
            if not l["fact"]:
                if v.get("count") == 0 and l["blocked"] == "no lease fact states it":
                    not_checked("renewal", f, ren_text(v), "text",
                                "the lease facts supplied state no renewal option, which does not prove there is none")
                else:
                    no_lease_fact("renewal", f, ren_text(v), "text", "a renewal option", l["blocked"])
            else:
                lv = l["fact"].value
                bad: list[str] = []
                compared = 0
                if v.get("count") is not None and lv.get("count") is not None:
                    compared += 1
                    if v["count"] != lv["count"]:
                        bad.append("number of options")
                if v.get("term_months") is not None and lv.get("term_months") is not None:
                    compared += 1
                    if v["term_months"] != lv["term_months"]:
                        bad.append("length of each option")
                if v.get("count") == 0 and v.get("count") is not None and compared == 0:
                    bad.append("number of options")
                if compared == 0 and not bad:
                    not_checked("renewal", f, ren_text(v), "text",
                                "the roll and the lease state different parts of the option, so none can be compared")
                else:
                    push(field="renewal", status="differs" if bad else "match", roll_value=ren_text(v),
                         against="lease", against_value=ren_text(lv), unit="text", roll_source=_src(f),
                         lease_source=_src(l["fact"]),
                         reason=f"differs in the {' and the '.join(bad)}" if bad else None)

        # Recoveries.
        f = rf("recoveries")
        v = rv("recoveries")

        def rec_text(s: str, y: Any) -> str:
            return f"{s.replace('_', ' ')}{f', base year {y}' if y is not None else ''}"

        if f is None or v is None:
            not_stated("recoveries")
        elif lease is None:
            not_checked("recoveries", f, rec_text(v["structure"], v.get("base_year")), "text", "no lease was supplied")
        else:
            l = lease1("lease.recovery_structure")
            by = lease1("lease.operating_expense_base_year")
            lstruct = l["fact"].value["structure"] if l["fact"] else None
            lyear = by["fact"].value if by["fact"] else None
            bad = []
            compared = 0
            if lstruct is not None:
                compared += 1
                if lstruct != v["structure"]:
                    bad.append("structure")
            if v.get("base_year") is not None and lyear is not None:
                compared += 1
                if lyear != v["base_year"]:
                    bad.append("base year")
            if compared == 0:
                not_checked("recoveries", f, rec_text(v["structure"], v.get("base_year")), "text",
                            "the lease facts supplied do not state the recoveries structure")
            else:
                push(field="recoveries", status="differs" if bad else "match",
                     roll_value=rec_text(v["structure"], v.get("base_year")), against="lease",
                     against_value=rec_text(lstruct if lstruct is not None else v["structure"],
                                            lyear if lyear is not None else v.get("base_year")),
                     unit="text", roll_source=_src(f), lease_source=_src(l["fact"] or by["fact"]),
                     reason=f"differs in the {' and the '.join(bad)}" if bad else None)
        for p in dict.fromkeys(conflicted_preds):
            flag("LEASE_FACTS_CONFLICT", "check", ln.line_id,
                 f"{tenant}: the lease facts disagree about {p.replace('lease.', '').replace('_', ' ')}; that field is not checked until a person resolves which governs")

        # ---- the tenant's estoppel answers
        est = lease.estoppel if lease else None
        est_ok = False
        if est:
            o.estoppel_package = est["package_id"]
            by_code = {s["code"]: s for s in est["statements"]}
            sa_e, sa_n = step_at(est["as_of"]), step_at(as_of)
            same_step = est["as_of"] == as_of or (est["as_of"] < as_of and sa_e is not None and sa_n is not None
                                                  and sa_e.from_ == sa_n.from_ and sa_e.to == sa_n.to)
            est_ok = same_step
            if not same_step:
                flag("ESTOPPEL_DATE_DIFFERS", "check", ln.line_id,
                     f"{tenant}: the estoppel is as of {_long_date(est['as_of'])} and the roll as of {_long_date(as_of)}, and the lease's rent step differs between them (or the estoppel is later), so the tenant's confirmation is not counted for this line")
            primary_rent = next((r for r in _RENT_FIELDS
                                 if any(c["field"] == r and c["status"] != "not_stated" for c in o.checks)), None)
            for c in list(o.checks):
                code = _FIELD_CODE.get("rent" if c["field"] in _RENT_FIELDS else c["field"])
                s = by_code.get(code) if code else None
                if s is None or c["status"] == "not_stated":
                    continue
                c["estoppel"] = {"key": s["key"], "code": s["code"], "decision": s["decision"]}
                if s["decision"] == "disputed" and (c["field"] == primary_rent or c["field"] not in _RENT_FIELDS):
                    own = s.get("tenants_own_version")
                    push(field=c["field"], label=f"{c['label']}, tenant's answer", status="differs",
                         roll_value=c["roll_value"], against="estoppel",
                         against_value=own if own is not None else "disputed, no figure given", unit=c["unit"],
                         roll_source=c["roll_source"], reason="the tenant disputed the estoppel statement for this field",
                         estoppel={"key": s["key"], "code": s["code"], "decision": s["decision"]})
                    flag("ESTOPPEL_DISPUTED", "difference", ln.line_id,
                         f"{tenant}: the tenant disputed the estoppel statement on {c['label'].lower()}"
                         + (f" and gave its own version: {own}" if own else ""))
            o.estoppel_statements = [s["key"] for s in est["statements"] if s["decision"] == "agreed"]

        # ---- the grade
        differs = [c for c in o.checks if c["status"] == "differs"]
        core_missing: list[str] = []

        def core_state(fields: list[str], o: _Out = o) -> str:
            cs = [c for c in o.checks if c["field"] in fields and c["against"] != "estoppel" and c["against"] != "roll"]
            stated = [c for c in cs if c["status"] != "not_stated"]
            if not stated:
                return "not_stated"
            return "match" if all(c["status"] in ("match", "differs") for c in stated) else "not_checked"

        core_labels = [("the tenant name", ["tenant_name"]), ("the rentable area", ["area"]),
                       ("the lease expiration", ["expiration"]), ("the base rent", _RENT_FIELDS)]
        if differs:
            o.grade = "differs"
        elif lease is None:
            o.grade = "no_lease_supplied"
            o.reasons.append("no lease was supplied for this line")
        else:
            for label, fields in core_labels:
                s = core_state(fields)
                if s == "not_stated":
                    core_missing.append(f"the roll does not state {label.replace('the ', '', 1)}")
                elif s == "not_checked":
                    hit = next((c for c in o.checks if c["field"] in fields and c["status"] == "not_checked"), None)
                    why = hit["reason"] if hit is not None and hit["reason"] is not None else "no lease fact covers it"
                    core_missing.append(f"{label.replace('the ', '', 1)} was not checked: {why}")
            if core_missing:
                o.grade = "not_checkable"
                o.reasons.extend(core_missing)
            else:
                def agreed(code: str) -> bool:
                    return bool(est) and any(s["code"] == code and s["decision"] == "agreed" for s in est["statements"])

                confirmed = est is not None and est_ok and all(agreed(_FIELD_CODE[x]) for x in _CONFIRM_FIELDS)
                o.grade = "matches_lease_confirmed_by_tenant" if confirmed else "matches_lease"
                if confirmed:
                    o.confirmed = [_FIELD_LABEL["rent_annual" if x == "rent" else x] for x in _CONFIRM_FIELDS]
                elif est and est_ok:
                    o.reasons.append("the estoppel does not carry an agreed answer to each of the premises, expiration and base rent statements")
        if o.grade == "no_lease_supplied":
            flag("NO_LEASE_SUPPLIED", "check", ln.line_id,
                 f"{tenant}{f', suite {suite}' if suite else ''}: the roll shows a tenant but no lease was supplied, so nothing on this line was checked")

        prio = ["rent_roll.base_rent_annual", "rent_roll.base_rent_monthly", "rent_roll.base_rent_psf",
                "rent_roll.lease_expiration_date", "rent_roll.rentable_area_sf", "rent_roll.tenant_name",
                "rent_roll.suite", "rent_roll.lease_start_date", "rent_roll.next_rent_step",
                "rent_roll.security_deposit", "rent_roll.free_rent_outstanding", "rent_roll.renewal_option",
                "rent_roll.recoveries"]
        ids: list[str] = []

        def add(id_: str | None, ids: list[str] = ids) -> None:
            if id_ and id_ not in ids:
                ids.append(id_)

        for p in prio:
            add(ln.facts[p].id if p in ln.facts else None)
        for c in o.checks:
            add(c["lease_source"]["fact_id"] if c["lease_source"] else None)
        o.fact_ids = ids[:20]

    # ---- flags that need the whole roll
    for ls, reason in unmatched:
        flag("LEASE_WITHOUT_ROLL_LINE", "check", None,
             f"{ls.label or lease_tenant(ls) or f'lease {ls.index + 1}'}: a lease was supplied that {reason}")
    by_suite: dict[str, list[str]] = {}
    for o in outs:
        if o.suite is None:
            continue
        by_suite.setdefault(_norm_name(o.suite), []).append(o.line.line_id)
    for k, ids_ in sorted(by_suite.items(), key=lambda kv: kv[0]):
        if len(ids_) > 1:
            flag("DUPLICATE_SUITE", "check", None, f"suite {k} appears on {len(ids_)} roll lines ({', '.join(ids_)})")
    horizon = add_months(as_of, 12)

    def roll_exp(o: _Out) -> str | None:
        f = o.line.facts.get("rent_roll.lease_expiration_date")
        return str(f.value) if f else None

    for o in outs:
        if o.line.vacant:
            continue
        exp = o.lease_exp if o.lease_exp is not None else roll_exp(o)
        if exp is None:
            continue
        if exp < as_of:
            flag("LEASE_EXPIRED", "check", o.line.line_id,
                 f"{o.tenant}: the lease expired on {_long_date(exp)}, before the as-of date, and the roll still shows the space as occupied")
        elif exp <= horizon:
            flag("LEASE_EXPIRING_WITHIN_12_MONTHS", "check", o.line.line_id,
                 f"{o.tenant}: the lease expires on {_long_date(exp)}, within 12 months of the as-of date"
                 + (" (the date in the lease)" if o.lease_exp is not None else " (the date on the roll)"))

    # ---- totals
    occ = [o for o in outs if not o.line.vacant]
    vac = [o for o in outs if o.line.vacant]

    def area_of(o: _Out) -> float | None:
        f = o.line.facts.get("rent_roll.rentable_area_sf")
        return f.value if f else None

    def total(xs: list[Any]) -> float:
        acc = 0
        for x in xs:
            acc = acc + x
        return acc

    occ_sf = round_(total([area_of(o) if area_of(o) is not None else 0 for o in occ]), 2)
    no_area_occ = [o for o in occ if area_of(o) is None]
    if no_area_occ:
        n = len(no_area_occ)
        warnings.append(f"{n} occupied line{' states' if n == 1 else 's state'} no area on the roll "
                        f"({', '.join(o.line.line_id for o in no_area_occ)}); the occupied area, occupancy and "
                        f"area-weighted figures leave {'it' if n == 1 else 'them'} out")
    vac_sf: float | None = None
    vac_basis: str | None = None
    vac_stated = round_(total([area_of(o) if area_of(o) is not None else 0 for o in vac]), 2)
    vac_no_area = [o for o in vac if area_of(o) is None]
    if inp.get("building_area_sf") is not None:
        vac_sf = round_(inp["building_area_sf"] - occ_sf, 2)
        vac_basis = "building area less occupied area"
        if vac_sf < 0:
            warnings.append(f"the occupied area on the roll ({_sf(occ_sf)} SF) is more than the building area ({_sf(inp['building_area_sf'])} SF)")
            vac_sf = 0
        if vac and not vac_no_area and abs(vac_stated - vac_sf) > 0.005:
            flag("VACANT_AREA_DIFFERS", "check", None,
                 f"the vacant lines on the roll add up to {_sf(vac_stated)} SF, but the building area less the occupied area is {_sf(vac_sf)} SF")
    elif vac:
        vac_sf = vac_stated
        vac_basis = "vacant lines on the roll"
        if vac_no_area:
            n = len(vac_no_area)
            warnings.append(f"{n} vacant line{' states' if n == 1 else 's state'} no area; the vacant area leaves {'it' if n == 1 else 'them'} out")
    total_sf = round_(occ_sf + vac_sf, 2) if vac_sf is not None else None
    occupancy = _pct4(occ_sf / total_sf) if total_sf is not None and total_sf > 0 else None
    if occupancy is None:
        warnings.append("occupancy is not given: the roll has no vacant lines and no building_area_sf was supplied, so the total area is not known")

    stated_all = [o for o in occ if o.roll_annual is not None]
    stated_total = _usd(total([o.roll_annual for o in stated_all]))
    with_lease = [o for o in occ if o.lease_annual is not None and o.roll_annual is not None]
    stated_on_checked = _usd(total([o.roll_annual for o in with_lease]))
    per_leases = _usd(total([o.lease_annual for o in with_lease]))
    no_rent = [o for o in occ if o.roll_annual is None]
    if no_rent:
        n = len(no_rent)
        warnings.append(f"{n} occupied line{' states' if n == 1 else 's state'} no base rent "
                        f"({', '.join(o.line.line_id for o in no_rent)}); the rent totals leave {'it' if n == 1 else 'them'} out")
    difference_rent = _usd(stated_on_checked - per_leases)

    def walt_of(pick: Any, by: str) -> dict[str, Any] | None:
        ls = []
        for o in occ:
            id_, exp, w = pick(o)
            if exp is not None and w is not None and w > 0:
                ls.append({"id": id_, "expiration_date": exp, ("area_sf" if by == "area" else "annual_rent"): w})
        return walt({"as_of": as_of, "weight_by": by, "leases": ls}) if ls else None

    w_roll_area = walt_of(lambda o: (o.line.line_id, roll_exp(o), area_of(o)), "area")
    w_roll_rent = walt_of(lambda o: (o.line.line_id, roll_exp(o), o.roll_annual), "rent")
    w_lease_area = walt_of(lambda o: (o.line.line_id, o.lease_exp, o.lease_area), "area")
    no_exp = [o for o in occ if roll_exp(o) is None]
    if no_exp:
        n = len(no_exp)
        warnings.append(f"{n} occupied line{' states' if n == 1 else 's state'} no expiration date "
                        f"({', '.join(o.line.line_id for o in no_exp)}); the weighted average lease term and the rollover leave {'it' if n == 1 else 'them'} out")

    def walt_out(w: dict[str, Any] | None) -> dict[str, Any] | None:
        if not w:
            return None
        return {"years": w["value"]["walt_years"], "weight_total": w["value"]["total_weight"],
                "expired_count": w["value"]["expired_count"], "steps": w["steps"], "warnings": w["warnings"]}

    # Rollover by calendar year of the expiration on the roll.
    roll_rows: dict[str, dict[str, Any]] = {}
    for o in occ:
        e = roll_exp(o)
        if e is None:
            continue
        key = "expired" if e < as_of else e[:4]
        r = roll_rows.setdefault(key, {"n": 0, "sf": 0, "rent": 0})
        r["n"] += 1
        r["sf"] = round_(r["sf"] + (area_of(o) if area_of(o) is not None else 0), 2)
        r["rent"] = _usd(r["rent"] + (o.roll_annual if o.roll_annual is not None else 0))
    roll_keys = sorted(roll_rows, key=lambda k: (k != "expired", k))
    rollover = []
    for k in roll_keys:
        r = roll_rows[k]
        rollover.append({
            "period": "Expired before the as-of date" if k == "expired" else k,
            "year": None if k == "expired" else int(k),
            "leases": r["n"], "area_sf": r["sf"],
            "share_of_occupied_area": _pct4(r["sf"] / occ_sf) if occ_sf > 0 else None,
            "annual_base_rent": r["rent"],
            "share_of_stated_rent": _pct4(r["rent"] / stated_total) if stated_total > 0 else None,
        })

    # Concentration by tenant name.
    groups: dict[str, dict[str, Any]] = {}
    for o in occ:
        k = _norm_name(o.tenant) or o.line.line_id
        g = groups.setdefault(k, {"name": o.tenant, "rent": 0, "sf": 0, "lines": 0})
        g["rent"] = _usd(g["rent"] + (o.roll_annual if o.roll_annual is not None else 0))
        g["sf"] = round_(g["sf"] + (area_of(o) if area_of(o) is not None else 0), 2)
        g["lines"] += 1

    def rank_cmp(a: dict[str, Any], b: dict[str, Any]) -> float:
        if b["rent"] != a["rent"]:
            return b["rent"] - a["rent"]
        return _cmp(a["name"], b["name"])

    ranked = sorted(groups.values(), key=functools.cmp_to_key(rank_cmp))
    top = [{"rank": i + 1, "tenant": g["name"], "lines": g["lines"], "annual_base_rent": g["rent"],
            "share_of_stated_rent": _pct4(g["rent"] / stated_total) if stated_total > 0 else None,
            "area_sf": g["sf"], "share_of_occupied_area": _pct4(g["sf"] / occ_sf) if occ_sf > 0 else None}
           for i, g in enumerate(ranked[:5])]

    def top_share(n: int) -> float | None:
        return _pct4(_usd(total([g["rent"] for g in ranked[:n]])) / stated_total) if stated_total > 0 else None

    grade_counts = {g: sum(1 for o in occ if o.grade == g) for g in GRADES}
    relyable = [o for o in occ if o.grade in ("matches_lease", "matches_lease_confirmed_by_tenant")]

    # ---- items for fact_package_send
    package_ids: list[str] = []
    items: list[dict[str, Any]] = []
    for o in occ:
        for id_ in o.fact_ids:
            if id_ not in package_ids:
                package_ids.append(id_)
        diffs = []
        for c in [c for c in o.checks if c["status"] == "differs"][:12]:
            d: dict[str, Any] = {
                "field": c["field"], "label": c["label"], "roll": c["roll_value"], "against": c["against_value"],
                "against_label": "Lease" if c["against"] == "lease" else ("Tenant" if c["against"] == "estoppel" else "Roll"),
            }
            if c["difference"] is not None and c["difference_unit"] != "days":
                d["difference"] = c["difference"]
            diffs.append(d)
        note = GRADE_LABEL[o.grade] + (f": {o.reasons[0]}" if o.reasons else "")
        item: dict[str, Any] = {
            "key": o.line.line_id,
            "label": f"{f'Suite {o.suite}, ' if o.suite else ''}{o.tenant}"[:160],
            "value": o.roll_annual if o.roll_annual is not None else "Not stated",
            **({"unit": "USD per year"} if o.roll_annual is not None else {}),
            "position": "state_ours",
            **({"their_value": o.lease_annual} if o.lease_annual is not None else {}),
            "fact_ids": o.fact_ids,
            "note": note[:600],
            "number": o.line.number,
            "grade": o.grade,
            "grade_label": GRADE_LABEL[o.grade],
            **({"differences": diffs} if diffs else {}),
            **({"estoppel_package_id": o.estoppel_package, "estoppel_statements": o.estoppel_statements}
               if o.grade == "matches_lease_confirmed_by_tenant" else {}),
        }
        items.append(item)
    if len(package_ids) > RENT_ROLL_PACKAGE_FACTS:
        warnings.append(f"the items rest on {len(package_ids)} facts and the Record takes at most {RENT_ROLL_PACKAGE_FACTS} in one rent roll: send the roll in parts (by building or floor)")

    # ---- output lines
    out_lines = []
    for o in outs:
        sf_f = o.line.facts.get("rent_roll.lease_start_date")
        out_lines.append({
            "number": o.line.number, "line_id": o.line.line_id,
            "occupancy": "vacant" if o.line.vacant else "occupied",
            "tenant": None if o.line.vacant else o.tenant, "suite": o.suite, "grade": o.grade,
            "grade_label": GRADE_LABEL[o.grade] if o.grade else "Vacant, not graded",
            "reliance_possible": o.grade in ("matches_lease", "matches_lease_confirmed_by_tenant"),
            "roll": {"area_sf": area_of(o), "lease_start_date": sf_f.value if sf_f else None,
                     "lease_expiration_date": roll_exp(o), "annual_base_rent": o.roll_annual,
                     "annual_base_rent_basis": o.roll_basis},
            "lease": {"supplied": o.has_lease, "area_sf": o.lease_area, "expiration_date": o.lease_exp,
                      "annual_base_rent": o.lease_annual},
            "rent_difference": _usd(o.roll_annual - o.lease_annual) if o.roll_annual is not None and o.lease_annual is not None else None,
            "checks": o.checks, "reasons": o.reasons, "confirmed_fields": o.confirmed,
            "estoppel_package_id": o.estoppel_package, "fact_ids": o.fact_ids,
            "roll_facts": [_src(f) for f in o.line.all],
        })

    difference_flags = sum(1 for f in flags if f["severity"] == "difference")
    walt_years = w_roll_area["value"]["walt_years"] if w_roll_area else None
    result: dict[str, Any] = {
        "as_of": as_of,
        "property": inp["property"]["label"],
        "parties": inp["parties"],
        **({"roll_document": {"title": inp["roll_document"]["title"]}}
           if (inp.get("roll_document") or {}).get("title") else {}),
        "lines": out_lines,
        "key_figures": {"occupancy": occupancy, "annual_base_rent_per_leases": per_leases,
                        "difference_from_roll": difference_rent, "walt_years": walt_years},
        "area": {"occupied_sf": occ_sf, "vacant_sf": vac_sf, "total_sf": total_sf, "occupancy": occupancy,
                 "vacant_basis": vac_basis},
        "base_rent": {"stated_total": stated_total, "stated_on_lines_with_lease_rent": stated_on_checked,
                      "per_leases": per_leases, "difference": difference_rent,
                      "stated_without_lease_rent": _usd(stated_total - stated_on_checked),
                      "lines_with_lease_rent": len(with_lease),
                      "lines_without_lease_rent": len(stated_all) - len(with_lease)},
        "walt": {"formula": {"id": "calc.walt", "version": 1}, "weighted_by_area_on_roll": walt_out(w_roll_area),
                 "weighted_by_rent_on_roll": walt_out(w_roll_rent),
                 "weighted_by_area_per_leases": walt_out(w_lease_area)},
        "rollover": rollover,
        "concentration": {"top_tenants": top, "top_1_share": top_share(1), "top_3_share": top_share(3),
                          "top_5_share": top_share(5), "tenants": len(ranked)},
        "totals": {"lines": len(outs), "occupied_lines": len(occ), "vacant_lines": len(vac), "grades": grade_counts,
                   "reliance_possible": len(relyable), "flags": len(flags), "differences": difference_flags,
                   "leases_supplied": len(leases_in), "leases_without_roll_line": len(unmatched)},
        "flags": flags,
        "tolerance": {"annual_usd": tol_annual, "monthly_usd": round_(tol_monthly, 6), "psf": tol_psf},
        "package_facts": package_ids,
        "package_items": items,
        "package_calculation": {
            "tool": "rent_roll_certify", "as_of": as_of, "occupancy": occupancy, "occupied_sf": occ_sf,
            "vacant_sf": vac_sf, "annual_base_rent_as_stated": stated_total,
            "annual_base_rent_per_leases": per_leases, "difference": difference_rent, "walt_years": walt_years,
            "walt_formula": "calc.walt@1", "grades": grade_counts, "rollover": rollover, "top_tenants": top,
            "flags": [{"code": f["code"], "line_id": f["line_id"], "message": f["message"]} for f in flags],
        },
        "facts_ignored": list(dict.fromkeys(ignored)),
        "warnings": warnings,
        "notes": [
            "These are facts and arithmetic, not legal, appraisal or lending advice. FactLot checked the rent roll against the lease documents (and the estoppel answers) supplied, and against nothing else.",
            "A line is graded 'matches' only when its tenant, area, expiration and current base rent were each compared with the lease and agree. A field no lease fact covers is 'not checked', never assumed to match.",
            "The certifying party's certification, not FactLot, is what a lender or buyer relies on. Reliance is recorded per line, only for lines graded as matching.",
        ],
    }
    return result


def rent_roll_summary(full: dict[str, Any]) -> dict[str, Any]:
    return {
        "limited": True,
        "summary": {
            "as_of": full["as_of"], "key_figures": full["key_figures"], "area": full["area"],
            "base_rent": full["base_rent"], "totals": full["totals"],
            "flags": [{"code": f["code"], "line_id": f["line_id"]} for f in full["flags"]],
        },
        "rent_roll_available": "pro",
        "rent_roll_withheld": [
            "the grade of each line with the roll and lease figures, quotes, pages and document fingerprints behind it",
            "the differences, with both figures and the quotes",
            "the rollover schedule and the top-tenant concentration",
            "the items to send with fact_package_send (kind rent_roll)",
            "the rent roll certificate (report_create kind rent_roll_certificate)",
        ],
        "rent_roll_note": ("The totals, key figures, the count of lines under each grade and the flags are free. Each line's "
                           "grade with its sources, the report and sending the certified roll are part of the paid plans "
                           f"(Pro and Team): {RENT_ROLL_PLAN_URL}"),
    }


def rent_roll_limited() -> bool:
    return audit_limited()


def rent_roll_certify(inp: dict[str, Any]) -> dict[str, Any]:
    full = certify_rent_roll(inp)
    return rent_roll_summary(full) if rent_roll_limited() else full
