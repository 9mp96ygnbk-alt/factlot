"""estoppel_prepare: the standard statements of a tenant estoppel certificate, from a lease's verified facts.

The same code as packages/tools/src/estoppel.ts (spec/differential runs both on the same inputs). A
statement from the lease carries the quote, page and document fingerprint it rests on; a statement only
the tenant can know is marked tenant to confirm and has no lease source; gaps and conflicts are listed
and the statement is withheld from the items to send. Deterministic: no model, no clock (as_of is an
input). Facts and arithmetic, not legal advice: the tenant's signature is what makes an estoppel.
"""
from __future__ import annotations

import re
from typing import Any

from ._core import round_
from .audit import (_Bad, _bool, _date, _enum, _int, _is_num, _num, _opt, _str, _strict, _union, audit_limited)
from .dates import add_days
from .docverify import DocInputError, json_equal, validate_fact_full

ESTOPPEL_PLAN_URL = "https://factlot.com/pricing/"

_TEXT = _str(1, 600)


def _text_or_obj(fields: dict[str, Any]):
    return _union(_TEXT, _strict(fields))


def _schedule(x: Any) -> Any:
    if not isinstance(x, list) or not 1 <= len(x) <= 200:
        raise _Bad("expected 1 to 200 steps")
    step = _strict({"from": _date, "to": _date, "annual_rent_psf": _num(lo=0)})
    return [step(s) for s in x]


_POS = _num(gt=0)
_SHAPES = {
    "lease.landlord": _TEXT,
    "lease.tenant": _TEXT,
    "lease.commencement_date": _date,
    "lease.expiration_date": _date,
    "lease.rentable_area_sf": _POS,
    "lease.base_rent_schedule": _schedule,
    "lease.security_deposit": _POS,
    "lease.free_rent": _strict({"months": _opt(_POS), "applies_to": _opt(_enum("base_rent", "gross_rent"))}),
    "lease.ti_allowance": _union(_POS, _strict({"amount": _POS, "per_sf": _opt(_POS)})),
    "lease.renewal_option": _strict({"count": _opt(_POS), "term_months": _opt(_POS), "notice_months": _opt(_POS),
                                     "rent": _opt(_TEXT)}),
    "lease.renewal_notice_deadline": _date,
    "lease.termination_option": _strict({"effective_date": _opt(_date), "notice_months": _opt(_POS), "fee": _opt(_TEXT)}),
    "lease.termination_notice_deadline": _date,
    "lease.expansion_option": _text_or_obj({"description": _TEXT}),
    "lease.expansion_option_deadline": _date,
    "lease.rofr": _text_or_obj({"applies_to": _enum("space", "purchase"), "description": _TEXT,
                                "response_days": _opt(_POS)}),
    "lease.rofo": _text_or_obj({"applies_to": _enum("space", "purchase"), "description": _TEXT,
                                "response_days": _opt(_POS)}),
    "lease.purchase_option": _text_or_obj({"description": _TEXT, "price": _opt(_TEXT)}),
}

_SHA_PREFIX = "fl:document:sha256-"
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"]

CONFIRM_LEASE = ("that the quoted sentence is the one that governs after every amendment, and that the defined terms "
                 "mean what the statement assumes")
CONFIRM_TENANT = ("nothing in the lease supports or contradicts this statement: only the tenant can confirm it, and the "
                  "tenant's signature is what makes it a statement of the tenant")


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


def _sf(x: float) -> str:
    s = _n(round_(x, 2))
    int_part, _, frac = s.partition(".")
    grouped = re.sub(r"\B(?=(\d{3})+(?!\d))", ",", int_part)
    return grouped + (f".{frac}" if frac else "")


def _long_date(iso: str) -> str:
    return f"{_MONTHS[int(iso[5:7]) - 1]} {int(iso[8:10])}, {iso[:4]}"


def _plural(n: float, one: str, many: str) -> str:
    return f"{_n(n)} {one if n == 1 else many}"


def _norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _sha8(document_id: str | None) -> str:
    if document_id is not None and document_id.startswith(_SHA_PREFIX):
        return document_id[len(_SHA_PREFIX):len(_SHA_PREFIX) + 12]
    return "unknown"


def _sha(document_id: str | None) -> str | None:
    if document_id is not None and document_id.startswith(_SHA_PREFIX):
        return document_id[len(_SHA_PREFIX):]
    return None


class _EFact:
    __slots__ = ("id", "predicate", "value", "quote", "page", "section", "document_id", "valid_from", "supersedes")

    def __init__(self, **kw: Any):
        for k, v in kw.items():
            setattr(self, k, v)


def _flag(code: str, severity: str, message: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "message": message}


def _read_facts(items: list[Any], issues: list[dict[str, str]], ignored: list[str]) -> list[_EFact]:
    out: list[_EFact] = []
    ids: set[str] = set()
    for i, f in enumerate(items):
        at = f"lease_facts.{i}"
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
                           "message": "no source: every fact the estoppel reads needs a quote and a page (no source, no statement)"})
            continue
        if not predicate.startswith("lease."):
            issues.append({"path": f"{at}.predicate",
                           "message": f"{predicate} is not a lease fact: lease_facts holds lease.* predicates"})
            continue
        if id_ in ids:
            issues.append({"path": f"{at}.id", "message": f"duplicate fact id {id_}"})
            continue
        ids.add(id_)
        shape = _SHAPES.get(predicate)
        if shape is None:
            ignored.append(predicate)
            continue
        try:
            parsed = shape(f.get("value"))
        except _Bad as e:
            issues.append({"path": f"{at}.value", "message": f"{predicate}: {e}"})
            continue
        sup = f.get("supersedes")
        out.append(_EFact(
            id=id_, predicate=predicate, value=parsed, quote=src["quote"], page=src["page"],
            section=src["section"] if isinstance(src.get("section"), str) else None,
            document_id=src["document_id"] if isinstance(src.get("document_id"), str) else None,
            valid_from=f["valid_from"] if isinstance(f.get("valid_from"), str) else None,
            supersedes=[x for x in sup if isinstance(x, str)] if isinstance(sup, list) else []))
    return out


def _parties_issues(inp: dict[str, Any]) -> list[dict[str, str]]:
    p = inp["parties"]
    if p["tenant"]["organisation"].strip().lower() == p["landlord"]["organisation"].strip().lower():
        return [{"path": "parties.tenant.organisation",
                 "message": "the tenant and the landlord must be different organisations"}]
    return []


def prepare_estoppel(inp: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    ignored_predicates: list[str] = []
    all_facts = _read_facts(inp["lease_facts"], issues, ignored_predicates)
    issues.extend(_parties_issues(inp))
    if issues:
        raise DocInputError(issues[:20])

    as_of: str = inp["as_of"]
    warnings: list[str] = []
    gaps: list[dict[str, Any]] = []

    pending = [f for f in all_facts if f.valid_from is not None and f.valid_from > as_of]
    pending_ids = {f.id for f in pending}
    live = [f for f in all_facts if f.id not in pending_ids]
    superseded_by: dict[str, str] = {}
    for f in live:
        for s in f.supersedes:
            superseded_by[s] = f.id

    def is_current(f: _EFact) -> bool:
        return f.id not in superseded_by

    if pending:
        dates = sorted({f.valid_from for f in pending})
        warnings.append(
            f"{len(pending)} fact{'' if len(pending) == 1 else 's'} take effect after the as-of date "
            f"({', '.join(_long_date(d) for d in dates)}) and are not used: an amendment that is not yet effective "
            "does not change what the tenant certifies today")

    # ---- documents
    doc_order: list[str] = []
    for f in live:
        if f.document_id is not None and f.document_id not in doc_order:
            doc_order.append(f.document_id)
    given = {d["document_id"]: d for d in (inp.get("documents") or [])}
    doc_flags: list[dict[str, str]] = []

    def is_orig_candidate(d: str) -> bool:
        g = given.get(d)
        if g:
            return g["role"] == "original"
        return all(f.valid_from is None for f in live if f.document_id == d)

    undated_original = [d for d in doc_order if is_orig_candidate(d)]
    docs: list[dict[str, Any]] = []
    for d in doc_order:
        g = given.get(d)
        fs = [f for f in live if f.document_id == d]
        dates = sorted(f.valid_from for f in fs if f.valid_from is not None)
        if g:
            role = g["role"]
        elif all(f.valid_from is None for f in fs):
            role = "original" if len(undated_original) == 1 else "unknown"
        else:
            role = "amendment"
        eff = g.get("effective_date") if g else None
        if eff is None:
            eff = (dates[0] if dates else None) if role == "amendment" else None
        docs.append({"document_id": d, "sha256": _sha(d), "role": role,
                     "title": g.get("title") if g else None, "effective_date": eff,
                     "fact_ids": [f.id for f in fs]})
    for d in inp.get("documents") or []:
        if not any(x["document_id"] == d["document_id"] for x in docs):
            warnings.append(f"documents lists {_sha8(d['document_id'])} but no fact cites it, so it is not in the lease list")
    n_orig = len([d for d in docs if d["role"] == "original"])
    if n_orig == 0:
        doc_flags.append(_flag("NO_ORIGINAL_LEASE_IDENTIFIED", "check",
                               "no cited document is identified as the original lease (every document's facts carry an "
                               "amendment effective date, or more than one document has none): give documents with each role"))
    if n_orig > 1:
        doc_flags.append(_flag("SEVERAL_ORIGINALS", "check",
                               "more than one document is marked as the original lease: give documents with each role"))
    for d in docs:
        if d["role"] == "amendment" and d["effective_date"] is None:
            doc_flags.append(_flag("AMENDMENT_WITHOUT_DATE", "check",
                                   f"an amendment ({_sha8(d['document_id'])}) has no effective date: amendments apply in "
                                   "date order, so give its effective_date"))
    amendments = sorted([d for d in docs if d["role"] == "amendment"],
                        key=lambda d: d["effective_date"] if d["effective_date"] is not None else "9999-99-99")

    def role_of(document_id: str | None) -> str | None:
        for d in docs:
            if d["document_id"] == document_id:
                return d["role"]
        return None

    def doc_label(d: dict[str, Any]) -> str:
        if d["role"] == "original":
            base = "the Lease"
        elif d["role"] == "amendment":
            idx = next(i for i, a in enumerate(amendments) if a is d)
            base = f"Amendment No. {idx + 1}" + (f", effective {_long_date(d['effective_date'])}" if d["effective_date"] else "")
        else:
            base = "an undated document"
        return f"{d['title'] + ' (' + base + ')' if d['title'] else base} (document {_sha8(d['document_id'])})"

    def source_of(f: _EFact, role: str = "lease") -> dict[str, Any]:
        return {"fact_id": f.id, "role": role, "predicate": f.predicate, "document_id": f.document_id,
                "document_role": role_of(f.document_id), "sha256": _sha(f.document_id), "page": f.page,
                "quote": f.quote, "section": f.section}

    def current_of(predicate: str) -> dict[str, Any]:
        fs = [f for f in live if f.predicate == predicate]
        cur = [f for f in fs if is_current(f)]
        history = [f for f in fs if not is_current(f)]
        if not cur:
            return {"fact": None, "conflicts": [], "history": history}
        first = cur[0]
        return {"fact": first, "conflicts": [c for c in cur if not json_equal(c.value, first.value)], "history": history}

    statements: list[dict[str, Any]] = []
    flags_all: list[dict[str, str]] = []
    by_code: dict[str, dict[str, Any]] = {}

    def add(code: str, title: str, basis: str, text: str, value: Any = None, unit: str | None = None,
            facts: list[_EFact] | None = None, history: list[_EFact] | None = None,
            conflicting: list[_EFact] | None = None, steps: list[str] | None = None,
            flags: list[dict[str, str]] | None = None, status: str | None = None,
            needs_tenant_value: bool = False, confirm: list[str] | None = None) -> dict[str, Any]:
        number = len(statements) + 1
        flags = flags or []
        facts = facts or []
        sources = ([source_of(f) for f in facts] + [source_of(f, "superseded") for f in (history or [])]
                   + [source_of(f, "conflicting") for f in (conflicting or [])])
        st_status = status or ("tenant_to_confirm" if basis == "tenant" else "ready")
        st = {"number": number, "key": f"S{number:02d}", "code": code, "title": title, "basis": basis,
              "status": st_status, "sendable": st_status in ("ready", "tenant_to_confirm"), "text": text,
              "value": value, "unit": unit, "needs_tenant_value": needs_tenant_value is True, "sources": sources,
              "fact_ids": [f.id for f in facts], "steps": steps or [], "flags": flags,
              "confirm": confirm if confirm is not None else ([CONFIRM_TENANT] if basis == "tenant" else [CONFIRM_LEASE])}
        statements.append(st)
        by_code[code] = st
        flags_all.extend(flags)
        return st

    def ref(code: str) -> str:
        return f"statement {by_code[code]['number']}" if code in by_code else ""

    def amended_flag(c: dict[str, Any]) -> list[dict[str, str]]:
        if c["fact"] is not None and c["history"]:
            return [_flag("AMENDED", "check", f"changed by amendment: the earlier document's sentence (page "
                                              f"{c['history'][0].page}) is shown as superseded")]
        return []

    def conflict_flag(c: dict[str, Any], what: str) -> dict[str, str]:
        parts = "; ".join(f"{_js_json(f.value)} in document {_sha8(f.document_id)} page {f.page}"
                          for f in [c["fact"], *c["conflicts"]])
        return _flag("LEASE_AMENDMENT_CONFLICT", "conflict",
                     f"{what}: the lease facts state different values ({parts}) and no amendment is marked as "
                     "superseding the other: resolve which governs")

    def gap_statement(code: str, title: str, predicate: str, what: str) -> None:
        message = f"no verified {predicate} fact was supplied: {what}. Nothing is stated, and nothing is guessed"
        add(code, title, "lease", f"Not prepared: {what}.", status="gap",
            flags=[_flag("MISSING_LEASE_FACT", "gap", message)], confirm=[])
        gaps.append({"code": "MISSING_LEASE_FACT", "predicate": predicate, "message": message})

    def gap_note(predicate: str, message: str) -> None:
        gaps.append({"code": "MISSING_LEASE_FACT", "predicate": predicate, "message": message})

    tenant_name = inp["parties"]["tenant"]["organisation"]
    landlord_name = inp["parties"]["landlord"]["organisation"]
    premises = inp["premises"]["label"]

    # 1 The lease documents
    landlord_fact = current_of("lease.landlord")
    tenant_fact = current_of("lease.tenant")
    flags: list[dict[str, str]] = list(doc_flags)
    facts: list[_EFact] = []
    if landlord_fact["fact"] is not None:
        facts.append(landlord_fact["fact"])
        if _norm_name(str(landlord_fact["fact"].value)) != _norm_name(landlord_name):
            flags.append(_flag("LANDLORD_NAME_DIFFERS", "check",
                               f"the lease names the landlord as \"{landlord_fact['fact'].value}\", the certificate as "
                               f"\"{landlord_name}\": confirm they are the same party (assignment, merger or a name change)"))
    if tenant_fact["fact"] is not None:
        facts.append(tenant_fact["fact"])
        if _norm_name(str(tenant_fact["fact"].value)) != _norm_name(tenant_name):
            flags.append(_flag("TENANT_NAME_DIFFERS", "check",
                               f"the lease names the tenant as \"{tenant_fact['fact'].value}\", the certificate as "
                               f"\"{tenant_name}\": confirm they are the same party (assignment, merger or a name change)"))
    if landlord_fact["fact"] is None:
        m = "no lease.landlord fact was supplied: the lease's landlord is not sourced"
        flags.append(_flag("MISSING_LEASE_FACT", "gap", m))
        gap_note("lease.landlord", m)
    if tenant_fact["fact"] is None:
        m = "no lease.tenant fact was supplied: the lease's tenant is not sourced"
        flags.append(_flag("MISSING_LEASE_FACT", "gap", m))
        gap_note("lease.tenant", m)
    for d in docs:
        rep = next((f for f in live if f.document_id == d["document_id"] and not any(x.id == f.id for x in facts)), None)
        if rep is not None and not any(x.document_id == d["document_id"] for x in facts):
            facts.append(rep)
    for x, what in ((landlord_fact, "the landlord"), (tenant_fact, "the tenant")):
        if x["conflicts"]:
            flags.append(conflict_flag(x, what))
    listed = [d for d in docs if d["role"] in ("original", "unknown")] + amendments
    lst = "; ".join(doc_label(d) for d in listed)
    sourced = len(facts) > 0
    conflict_block = any(f["severity"] == "conflict" for f in flags)
    add("LEASE_DOCUMENTS", "The lease and its amendments", "lease",
        f"The Lease between {landlord_name} as landlord and {tenant_name} as tenant for {premises} consists of: "
        f"{lst or 'no document is cited by the facts'}.",
        value=("The Lease, no amendments" if not amendments
               else f"The Lease and {_plural(len(amendments), 'amendment', 'amendments')}"),
        facts=facts, flags=flags,
        status="gap" if not sourced else ("conflict" if conflict_block else "ready"),
        steps=[f"{doc_label(d)}: {len(d['fact_ids'])} fact{'' if len(d['fact_ids']) == 1 else 's'} cite it" for d in listed],
        confirm=["that these are every document that makes up the lease, with no side letter, estoppel, consent or "
                 "work letter left out"])

    # 2 No other modification
    add("NO_OTHER_MODIFICATION", "No other agreements", "tenant",
        f"The Lease has not been amended, modified, supplemented or assigned except by the documents listed in "
        f"{ref('LEASE_DOCUMENTS') or 'the list above'}, and there is no other agreement, side letter or understanding "
        "between Landlord and Tenant about the Premises.", value="As stated")

    # 3 Commencement
    comm = current_of("lease.commencement_date")
    if comm["fact"] is None:
        gap_statement("COMMENCEMENT", "Commencement date", "lease.commencement_date",
                      "the commencement date is not in the facts supplied")
    else:
        d = comm["fact"].value
        add("COMMENCEMENT", "Commencement date", "lease",
            f"The term of the Lease {'commences' if d > as_of else 'commenced'} on {_long_date(d)}.", value=d,
            facts=[comm["fact"]], history=comm["history"], conflicting=comm["conflicts"],
            status="conflict" if comm["conflicts"] else "ready",
            flags=[*amended_flag(comm), *([conflict_flag(comm, "the commencement date")] if comm["conflicts"] else []),
                   *([_flag("TERM_NOT_STARTED", "check", f"the term starts after the as-of date ({_long_date(as_of)})")]
                     if d > as_of else [])])

    # 4 Expiration
    exp = current_of("lease.expiration_date")
    if exp["fact"] is None:
        gap_statement("EXPIRATION", "Expiration date", "lease.expiration_date",
                      "the expiration date is not in the facts supplied")
    else:
        d = exp["fact"].value
        fl = [*amended_flag(exp), *([conflict_flag(exp, "the expiration date")] if exp["conflicts"] else [])]
        if d < as_of:
            fl.append(_flag("TERM_EXPIRED", "check", f"the expiration date is before the as-of date ({_long_date(as_of)}): "
                                                     "confirm the tenant is holding over or the term was extended"))
        if comm["fact"] is not None and d < comm["fact"].value:
            fl.append(_flag("EXPIRATION_BEFORE_COMMENCEMENT", "conflict",
                            f"the expiration date ({_long_date(d)}) is before the commencement date "
                            f"({_long_date(comm['fact'].value)}): the lease facts do not agree"))
        add("EXPIRATION", "Expiration date", "lease",
            f"The term of the Lease {'expired' if d < as_of else 'expires'} on {_long_date(d)}, unless it is extended or "
            "ended earlier as the Lease permits.", value=d, facts=[exp["fact"]], history=exp["history"],
            conflicting=exp["conflicts"],
            status="conflict" if exp["conflicts"] or any(f["severity"] == "conflict" for f in fl) else "ready", flags=fl)

    # 5 Premises
    area = current_of("lease.rentable_area_sf")
    if area["fact"] is None:
        gap_statement("PREMISES", "Premises", "lease.rentable_area_sf", "the rentable area is not in the facts supplied")
    else:
        add("PREMISES", "Premises", "lease",
            f"The Premises are {premises}, containing {_sf(area['fact'].value)} rentable square feet.",
            value=area["fact"].value, unit="SF", facts=[area["fact"]], history=area["history"],
            conflicting=area["conflicts"], status="conflict" if area["conflicts"] else "ready",
            flags=[*amended_flag(area), *([conflict_flag(area, "the rentable area")] if area["conflicts"] else [])],
            confirm=[CONFIRM_LEASE, "that the address and suite in the certificate are the premises the quoted sentence describes"])
    area_sf = area["fact"].value if area["fact"] is not None and not area["conflicts"] else None

    # 6 and 7 Base rent now and next
    rent_monthly: float | None = None
    sched_facts = [f for f in live if f.predicate == "lease.base_rent_schedule"]
    accepted: list[dict[str, Any]] = []
    flags_rent: list[dict[str, str]] = []
    conflicted = False

    def steps_of(f: _EFact) -> list[dict[str, Any]]:
        return [{"from": s["from"], "to": s["to"], "psf": s["annual_rent_psf"], "fact": f, "current": is_current(f)}
                for s in f.value]

    def overlaps(a: dict[str, Any], b: dict[str, Any]) -> bool:
        return a["from"] <= b["to"] and b["from"] <= a["to"]

    for f in [x for x in sched_facts if is_current(x)]:
        for s in steps_of(f):
            clash = next((a for a in accepted if overlaps(a, s)), None)
            if clash is not None:
                if clash["psf"] != s["psf"]:
                    conflicted = True
                    flags_rent.append(_flag(
                        "LEASE_AMENDMENT_CONFLICT", "conflict",
                        f"the rent schedule facts overlap with different rents ({_money(clash['psf'])} and "
                        f"{_money(s['psf'])} per square foot around {_long_date(s['from'])}) and no amendment is marked "
                        "as superseding the other: resolve which governs"))
                continue
            accepted.append(s)
    carried: list[dict[str, Any]] = []
    replaced = [f for f in sched_facts if not is_current(f)]
    for f in replaced:
        for s in steps_of(f):
            if not any(overlaps(a, s) for a in accepted) and not any(overlaps(a, s) for a in carried):
                carried.append(s)
    steps = sorted([*accepted, *carried], key=lambda s: s["from"])
    if not steps:
        gap_statement("BASE_RENT", "Base rent now", "lease.base_rent_schedule",
                      "the base rent schedule is not in the facts supplied")
        gap_statement("NEXT_RENT_STEP", "Next change in base rent", "lease.base_rent_schedule",
                      "the next rent step cannot be found without the base rent schedule")
    else:
        for i in range(len(steps) - 1):
            a, b = steps[i], steps[i + 1]
            if add_days(a["to"], 1) != b["from"]:
                flags_rent.append(_flag("RENT_SCHEDULE_GAP", "check",
                                        f"the rent schedule does not run on from {_long_date(a['to'])} to "
                                        f"{_long_date(b['from'])}: the rent between them is not stated"))
        if comm["fact"] is not None and steps[0]["from"] > comm["fact"].value:
            flags_rent.append(_flag("RENT_SCHEDULE_STARTS_LATE", "check",
                                    f"the rent schedule starts {_long_date(steps[0]['from'])}, after the commencement date "
                                    f"({_long_date(comm['fact'].value)}): the rent before it is not stated (free rent?)"))
        if exp["fact"] is not None and steps[-1]["to"] < exp["fact"].value:
            flags_rent.append(_flag("RENT_SCHEDULE_ENDS_EARLY", "check",
                                    f"the rent schedule ends {_long_date(steps[-1]['to'])}, before the expiration date "
                                    f"({_long_date(exp['fact'].value)}): the rent after it is not stated"))
        now_step = next((s for s in steps if s["from"] <= as_of <= s["to"]), None)
        nxt = next((s for s in steps if s["from"] > as_of), None)

        def amounts(s: dict[str, Any]) -> tuple[float | None, float | None]:
            if area_sf is None:
                return None, None
            annual = _usd(s["psf"] * area_sf)
            return annual, _usd(annual / 12)

        area_facts = [area["fact"]] if area["fact"] is not None else []
        area_flag: list[dict[str, str]] = []
        if area_sf is None:
            m = ("no usable lease.rentable_area_sf fact: the annual and monthly amounts cannot be computed, only the "
                 "rate per square foot")
            area_flag = [_flag("MISSING_LEASE_FACT", "gap", m)]
            gap_note("lease.rentable_area_sf", m)

        def step_note(s: dict[str, Any]) -> list[str]:
            annual, monthly = amounts(s)
            out = [f"Step {_long_date(s['from'])} to {_long_date(s['to'])}: {_money(s['psf'])} per rentable square foot per year"]
            if area_sf is not None:
                out += [f"{_money(s['psf'])} x {_sf(area_sf)} SF = {_money(annual)} per year",
                        f"{_money(annual)} / 12 = {_money(monthly)} per month"]
            return out

        def hist_of(s: dict[str, Any]) -> list[_EFact]:
            return [f for f in replaced if any(overlaps(x, s) for x in steps_of(f))] if s["current"] else []

        if now_step is None or conflicted:
            if conflicted:
                flag = next(f for f in flags_rent if f["severity"] == "conflict")
            else:
                flag = _flag("RENT_SCHEDULE_DOES_NOT_COVER_AS_OF", "gap",
                             f"the rent schedule has no step covering the as-of date ({_long_date(as_of)}): the current "
                             "rent is not stated")
            add("BASE_RENT", "Base rent now", "lease",
                f"Not prepared: {'the rent schedule facts conflict' if conflicted else 'the rent schedule has no step covering the as-of date'}.",
                facts=[f for f in sched_facts if is_current(f)], status="conflict" if conflicted else "gap",
                flags=[flag, *[f for f in flags_rent if f is not flag]], confirm=[])
            if not conflicted:
                gaps.append({"code": flag["code"], "predicate": "lease.base_rent_schedule", "message": flag["message"]})
        else:
            annual, monthly = amounts(now_step)
            rent_monthly = monthly
            hist = hist_of(now_step)
            add("BASE_RENT", "Base rent now", "lease",
                (f"As of {_long_date(as_of)}, annual base rent is {_money(annual)} ({_money(now_step['psf'])} per rentable "
                 f"square foot), payable at {_money(monthly)} per month." if annual is not None else
                 f"As of {_long_date(as_of)}, annual base rent is {_money(now_step['psf'])} per rentable square foot."),
                value=annual if annual is not None else now_step["psf"],
                unit="USD per year" if annual is not None else "USD per SF per year",
                facts=[now_step["fact"], *[x for x in area_facts if x.id != now_step["fact"].id]], history=hist,
                steps=step_note(now_step),
                flags=[*flags_rent, *area_flag,
                       *([_flag("AMENDED", "check", "changed by amendment: the earlier document's schedule is shown as superseded")]
                         if hist else [])])
        if now_step is not None and not conflicted:
            if nxt is None:
                add("NEXT_RENT_STEP", "Next change in base rent", "lease",
                    f"The rent schedule provides no change in base rent after {_long_date(as_of)}.", value="None scheduled",
                    facts=[now_step["fact"]],
                    steps=[f"The last step in the schedule runs {_long_date(now_step['from'])} to {_long_date(steps[-1]['to'])}"],
                    flags=[_flag("CHECK_OTHER_ESCALATIONS", "check",
                                 "the schedule is the only rent term read: confirm the lease has no other escalation (a "
                                 "rate index, a fair-market reset) that the facts do not capture")])
            else:
                annual, monthly = amounts(nxt)
                add("NEXT_RENT_STEP", "Next change in base rent", "lease",
                    (f"Base rent next changes on {_long_date(nxt['from'])}, to {_money(annual)} per year "
                     f"({_money(nxt['psf'])} per rentable square foot), payable at {_money(monthly)} per month."
                     if annual is not None else
                     f"Base rent next changes on {_long_date(nxt['from'])}, to {_money(nxt['psf'])} per rentable square foot per year."),
                    value=annual if annual is not None else nxt["psf"],
                    unit="USD per year" if annual is not None else "USD per SF per year",
                    facts=[nxt["fact"], *[x for x in area_facts if x.id != nxt["fact"].id]], history=hist_of(nxt),
                    steps=step_note(nxt), flags=[*area_flag])
        elif steps:
            add("NEXT_RENT_STEP", "Next change in base rent", "lease",
                "Not prepared: the next rent step cannot be found while the current rent is not established.",
                status="conflict" if conflicted else "gap", flags=[], confirm=[])

    # 8 and 9 Security deposit
    dep = current_of("lease.security_deposit")
    if dep["fact"] is None:
        gap_statement("SECURITY_DEPOSIT", "Security deposit", "lease.security_deposit",
                      "the security deposit is not in the facts supplied")
    else:
        add("SECURITY_DEPOSIT", "Security deposit", "lease",
            f"The security deposit under the Lease is {_money(dep['fact'].value)}.", value=dep["fact"].value, unit="USD",
            facts=[dep["fact"]], history=dep["history"], conflicting=dep["conflicts"],
            status="conflict" if dep["conflicts"] else "ready",
            flags=[*amended_flag(dep), *([conflict_flag(dep, "the security deposit")] if dep["conflicts"] else [])])
    records = inp.get("landlord_records") or {}
    held = records.get("security_deposit_held")
    fl = []
    if held is not None and dep["fact"] is not None and _usd(held) != _usd(dep["fact"].value):
        fl.append(_flag("DEPOSIT_LEDGER_DIFFERS", "check",
                        f"the landlord's ledger shows {_money(held)} held; the lease states {_money(dep['fact'].value)}: "
                        "settle the difference before sending"))
    add("SECURITY_DEPOSIT_PAID", "Security deposit paid", "tenant",
        (f"Tenant has paid a security deposit of {_money(held)} to Landlord, and no part of it has been applied, drawn on or returned."
         if held is not None else
         "Tenant has paid the security deposit to Landlord in full, and no part of it has been applied, drawn on or returned."),
        value=held if held is not None else "As stated", unit="USD" if held is not None else None, flags=fl)

    # 10 and 11 Rent paid through, no prepaid rent
    through = records.get("rent_paid_through")
    add("RENT_PAID_THROUGH", "Rent paid through", "tenant",
        (f"Base rent and additional rent have been paid through {_long_date(through)}." if through is not None else
         "Base rent and additional rent have been paid through the date the tenant states below."),
        value=through if through is not None else "To be stated by the tenant", needs_tenant_value=through is None,
        flags=([] if through is not None else
               [_flag("TENANT_TO_STATE", "check", "no date was supplied from the landlord's records: the tenant states the date")]),
        confirm=["that the date comes from the landlord's own rent records (it is not a lease term) and that the tenant is "
                 "asked to confirm it" if through is not None else CONFIRM_TENANT])
    add("NO_PREPAID_RENT", "No rent paid in advance", "tenant", "No rent has been paid more than one month in advance.",
        value="As stated")

    # 12 to 14 Free rent, TI allowance, landlord obligations
    free = current_of("lease.free_rent")
    if free["fact"] is not None:
        v = free["fact"].value
        months = v.get("months")
        kind = ("abated gross rent" if v.get("applies_to") == "gross_rent" else
                "abated base rent" if v.get("applies_to") == "base_rent" else "abated rent")
        text = re.sub(r"\s+", " ", f"The Lease grants {_plural(months, 'month', 'months') + ' of' if months is not None else ''} {kind}.")
        add("FREE_RENT", "Free rent", "lease", text,
            value=f"{_n(months)} months" if months is not None else "Abatement", facts=[free["fact"]],
            history=free["history"], conflicting=free["conflicts"], status="conflict" if free["conflicts"] else "ready",
            flags=[*amended_flag(free), *([conflict_flag(free, "the free rent")] if free["conflicts"] else [])])
    else:
        gap_note("lease.free_rent", "no lease.free_rent fact was supplied: if the lease grants free rent, add it; if not, "
                                    "the tenant confirms below that none remains")
    ti = current_of("lease.ti_allowance")
    if ti["fact"] is not None:
        v = ti["fact"].value
        amount = v if not isinstance(v, dict) else v["amount"]
        per_sf = v.get("per_sf") if isinstance(v, dict) else None
        add("TI_ALLOWANCE", "Tenant improvement allowance", "lease",
            f"The Lease provides a tenant improvement allowance of {_money(amount)}"
            f"{' (' + _money(per_sf) + ' per rentable square foot)' if per_sf is not None else ''}.",
            value=amount, unit="USD", facts=[ti["fact"]], history=ti["history"], conflicting=ti["conflicts"],
            status="conflict" if ti["conflicts"] else "ready",
            flags=[*amended_flag(ti), *([conflict_flag(ti, "the allowance")] if ti["conflicts"] else [])])
    else:
        gap_note("lease.ti_allowance", "no lease.ti_allowance fact was supplied: if the lease grants an allowance, add it; "
                                        "if not, the tenant confirms below that Landlord owes none")
    ti_ref = f" (including the allowance in {ref('TI_ALLOWANCE')})" if "TI_ALLOWANCE" in by_code else ""
    fr_ref = f" (including the abatement in {ref('FREE_RENT')})" if "FREE_RENT" in by_code else ""
    add("LANDLORD_OBLIGATIONS", "Landlord obligations outstanding", "tenant",
        f"Landlord has completed every improvement and paid every allowance it owes Tenant{ti_ref}, and no free rent, "
        f"abatement or other concession remains to be given{fr_ref}.", value="None outstanding")

    # 15 to 19 Options
    option_codes: list[str] = []
    renewal = current_of("lease.renewal_option")
    renewal_dl = current_of("lease.renewal_notice_deadline")
    if renewal["fact"] is not None:
        v = renewal["fact"].value
        fl = [*amended_flag(renewal), *([conflict_flag(renewal, "the renewal option")] if renewal["conflicts"] else [])]
        fs = [renewal["fact"]]
        tail = ""
        if renewal_dl["fact"] is not None:
            dl = renewal_dl["fact"].value
            fs.append(renewal_dl["fact"])
            tail = f" Notice must be given by {_long_date(dl)}."
            if dl < as_of:
                fl.append(_flag("OPTION_NOTICE_DATE_PASSED", "check",
                                f"the renewal notice date ({_long_date(dl)}) is before the as-of date: confirm whether the "
                                "option was exercised or has lapsed"))
        count = v.get("count")
        has = ("an option" if count is None else "one option" if count == 1 else f"{_n(count)} options")
        term = f" for {_plural(v['term_months'], 'month', 'months')}" if v.get("term_months") is not None else ""
        notice = f" on {_plural(v['notice_months'], 'month' + chr(39) + 's', 'months' + chr(39))} notice" if v.get("notice_months") is not None else ""
        rent = f" at {v['rent']}" if v.get("rent") is not None else ""
        add("OPTION_RENEWAL", "Renewal option", "lease", f"Tenant has {has} to extend the term{term}{notice}{rent}.{tail}",
            value=f"{_n(v['term_months'])} months" if v.get("term_months") is not None else "Option to extend",
            facts=fs, history=renewal["history"], conflicting=renewal["conflicts"],
            status="conflict" if renewal["conflicts"] else "ready", flags=fl)
        option_codes.append("OPTION_RENEWAL")
    else:
        gap_note("lease.renewal_option", "no lease.renewal_option fact was supplied: the tenant confirms below that it has "
                                          "no other right to renew")

    def rights(applies: str) -> list[tuple[str, dict[str, Any]]]:
        out = []
        for p in ("lease.rofr", "lease.rofo"):
            c = current_of(p)
            f = c["fact"]
            if f is None:
                continue
            is_str = isinstance(f.value, str)
            if applies == "space" and (is_str or f.value["applies_to"] == "space"):
                out.append((p, c))
            if applies == "purchase" and not is_str and f.value["applies_to"] == "purchase":
                out.append((p, c))
        return out

    space_rights = rights("space")
    expansion = current_of("lease.expansion_option")
    expansion_dl = current_of("lease.expansion_option_deadline")
    if expansion["fact"] is not None or space_rights:
        parts: list[str] = []
        fs: list[_EFact] = []
        fl = []
        if expansion["fact"] is not None:
            v = expansion["fact"].value
            parts.append(f"Tenant has an option to expand: {v if isinstance(v, str) else v['description']}.")
            fs.append(expansion["fact"])
            fl.extend(amended_flag(expansion))
            if expansion_dl["fact"] is not None:
                dl = expansion_dl["fact"].value
                fs.append(expansion_dl["fact"])
                parts.append(f"It must be exercised by {_long_date(dl)}.")
                if dl < as_of:
                    fl.append(_flag("OPTION_NOTICE_DATE_PASSED", "check",
                                    f"the expansion date ({_long_date(dl)}) is before the as-of date: confirm whether the "
                                    "option was exercised or has lapsed"))
        for p, c in space_rights:
            v = c["fact"].value
            kind = "a right of first refusal" if p == "lease.rofr" else "a right of first offer"
            resp = (f", to be answered within {_plural(v['response_days'], 'day', 'days')}"
                    if isinstance(v, dict) and v.get("response_days") is not None else "")
            parts.append(f"Tenant has {kind} on additional space: {v if isinstance(v, str) else v['description']}{resp}.")
            fs.append(c["fact"])
            fl.extend(amended_flag(c))
        add("OPTION_EXPANSION", "Expansion and space rights", "lease", " ".join(parts), value="Rights stated", facts=fs, flags=fl)
        option_codes.append("OPTION_EXPANSION")
    else:
        gap_note("lease.expansion_option", "no expansion, first-refusal or first-offer fact on space was supplied: the tenant "
                                            "confirms below that it has no other right")

    term = current_of("lease.termination_option")
    term_dl = current_of("lease.termination_notice_deadline")
    if term["fact"] is not None:
        v = term["fact"].value
        fl = [*amended_flag(term), *([conflict_flag(term, "the termination option")] if term["conflicts"] else [])]
        fs = [term["fact"]]
        tail = ""
        if term_dl["fact"] is not None:
            dl = term_dl["fact"].value
            fs.append(term_dl["fact"])
            tail = f" Notice must be given by {_long_date(dl)}."
            if dl < as_of:
                fl.append(_flag("OPTION_NOTICE_DATE_PASSED", "check",
                                f"the termination notice date ({_long_date(dl)}) is before the as-of date: confirm whether "
                                "the right was exercised or has lapsed"))
        eff = f", effective {_long_date(v['effective_date'])}" if v.get("effective_date") is not None else ""
        nt = f", on {_plural(v['notice_months'], 'month' + chr(39) + 's', 'months' + chr(39))} notice" if v.get("notice_months") is not None else ""
        fee = f", on payment of {v['fee']}" if v.get("fee") is not None else ""
        add("OPTION_TERMINATION", "Termination option", "lease", f"Tenant may terminate the Lease early{eff}{nt}{fee}.{tail}",
            value=v.get("effective_date") if v.get("effective_date") is not None else "Right to terminate", facts=fs,
            history=term["history"], conflicting=term["conflicts"], status="conflict" if term["conflicts"] else "ready",
            flags=fl)
        option_codes.append("OPTION_TERMINATION")
    else:
        gap_note("lease.termination_option", "no lease.termination_option fact was supplied: the tenant confirms below that "
                                              "it has no other right to terminate early")

    purchase_rights = rights("purchase")
    purchase = current_of("lease.purchase_option")
    if purchase["fact"] is not None or purchase_rights:
        parts = []
        fs = []
        fl = []
        if purchase["fact"] is not None:
            v = purchase["fact"].value
            if isinstance(v, str):
                body = v
            else:
                body = v["description"] + (f", at {v['price']}" if v.get("price") is not None else "")
            parts.append(f"Tenant has an option to purchase: {body}.")
            fs.append(purchase["fact"])
            fl.extend(amended_flag(purchase))
        for p, c in purchase_rights:
            v = c["fact"].value
            kind = "a right of first refusal" if p == "lease.rofr" else "a right of first offer"
            resp = f", to be answered within {_plural(v['response_days'], 'day', 'days')}" if v.get("response_days") is not None else ""
            parts.append(f"Tenant has {kind} to purchase: {v['description']}{resp}.")
            fs.append(c["fact"])
            fl.extend(amended_flag(c))
        add("OPTION_PURCHASE", "Purchase option or first refusal", "lease", " ".join(parts), value="Rights stated", facts=fs, flags=fl)
        option_codes.append("OPTION_PURCHASE")
    else:
        gap_note("lease.purchase_option", "no purchase option or first-refusal fact on the property was supplied: the tenant "
                                           "confirms below that it has none")

    if option_codes:
        oc_text = ("Tenant has no option or right to renew or extend the term, expand the Premises, terminate the Lease "
                   "early, or purchase the Premises or the Property, other than those stated in "
                   f"{', '.join(ref(c) for c in option_codes)}.")
    else:
        oc_text = ("Tenant has no option or right to renew or extend the term, expand the Premises, terminate the Lease "
                   "early, or purchase the Premises or the Property.")
    add("OPTIONS_COMPLETE", "No other options or rights", "tenant", oc_text, value="As stated",
        flags=([] if option_codes else
               [_flag("NO_OPTION_FACTS", "check", "no option fact was supplied, so this statement says there are none: "
                                                  "confirm from the lease that it grants none before sending")]))

    # 20 to 22
    add("NO_LANDLORD_DEFAULT", "No landlord default or claims", "tenant",
        "To Tenant's knowledge, Landlord is not in default under the Lease, and Tenant has no offset, defense, "
        "counterclaim or claim against Landlord.", value="As stated")
    add("NO_TENANT_DEFAULT", "No tenant default", "tenant",
        "Tenant is not in default under the Lease, and no event has occurred that, with notice or the passage of time, "
        "would be a default by Tenant.", value="As stated")
    add("NO_ASSIGNMENT_OR_SUBLEASE", "No assignment or sublease", "tenant",
        "Tenant has not assigned the Lease or sublet or licensed any part of the Premises, and Tenant is in possession "
        "of the Premises.", value="As stated")

    # ---- output
    sendable = [s for s in statements if s["sendable"]]
    package_fact_ids: list[str] = []
    for s in sendable:
        for fid in s["fact_ids"]:
            if fid not in package_fact_ids:
                package_fact_ids.append(fid)
    items: list[dict[str, Any]] = []
    for s in sendable:
        it: dict[str, Any] = {"key": s["key"], "label": s["title"], "value": "As stated" if s["value"] is None else s["value"]}
        if s["unit"] is not None:
            it["unit"] = s["unit"][:30]
        it.update({"position": "state_ours", "fact_ids": s["fact_ids"],
                   "note": ("Only the tenant can confirm this; the lease does not say." if s["basis"] == "tenant"
                            else "From the lease: the quote and page are shown."),
                   "number": s["number"], "text": s["text"]})
        if s["basis"] == "tenant":
            it["tenant_to_confirm"] = True
        if s["needs_tenant_value"]:
            it["needs_tenant_value"] = True
        items.append(it)
    rent_now = by_code.get("BASE_RENT")
    annual = (rent_now["value"] if rent_now is not None and rent_now["status"] == "ready"
              and rent_now["unit"] == "USD per year" and _is_num(rent_now["value"]) else None)
    facts_used: list[str] = []
    for s in statements:
        for src in s["sources"]:
            if src["fact_id"] not in facts_used:
                facts_used.append(src["fact_id"])
    conflicts = [{"number": s["number"], "code": s["code"],
                  "flags": [f["message"] for f in s["flags"] if f["severity"] == "conflict"]}
                 for s in statements if s["status"] == "conflict"]
    out: dict[str, Any] = {
        "as_of": as_of,
        "premises": premises,
        "parties": {"tenant": tenant_name, "landlord": landlord_name,
                    **({"requested_by": inp["parties"]["requested_by"]} if inp["parties"].get("requested_by") else {})},
        "statements": statements,
        "documents": [{**d, "label": doc_label(d)} for d in docs],
        "key_figures": {
            "commencement_date": comm["fact"].value if comm["fact"] is not None and not comm["conflicts"] else None,
            "expiration_date": exp["fact"].value if exp["fact"] is not None and not exp["conflicts"] else None,
            "annual_base_rent": annual,
            "monthly_base_rent": rent_monthly if annual is not None else None,
            "security_deposit": dep["fact"].value if dep["fact"] is not None and not dep["conflicts"] else None,
            "rentable_area_sf": area_sf,
        },
        "totals": {
            "statement_count": len(statements),
            "from_lease": len([s for s in statements if s["basis"] == "lease" and s["sendable"]]),
            "tenant_to_confirm": len([s for s in statements if s["basis"] == "tenant"]),
            "gaps": len([s for s in statements if s["status"] == "gap"]),
            "conflicts": len(conflicts),
            "sendable": len(sendable),
        },
        "gaps": gaps,
        "conflicts": conflicts,
        "flags": flags_all,
        "package_facts": package_fact_ids,
        "package_items": items,
        "statements_withheld": [{"key": s["key"], "code": s["code"], "reason": s["status"]}
                                for s in statements if not s["sendable"]],
        "facts_used": facts_used,
        "facts_ignored": list(dict.fromkeys(ignored_predicates)),
        "warnings": warnings,
        "notes": [
            "These statements are facts and arithmetic, not legal advice. A statement marked from the lease shows the quote and page it rests on; a statement marked tenant to confirm has no lease source because only the tenant can know it.",
            "The tenant's signature, not FactLot, is what makes this certificate an estoppel. FactLot prepares the statements and records who confirmed or disputed each; nothing here binds the tenant until the tenant answers.",
            "A statement with a gap or a conflict is withheld from the items to send until a person resolves it.",
        ],
    }
    return out


def _js_json(v: Any) -> str:
    """JSON.stringify as JavaScript writes it (compact; numbers without a trailing .0)."""
    import json

    def fix(x: Any) -> Any:
        if isinstance(x, float) and x == int(x):
            return int(x)
        if isinstance(x, list):
            return [fix(i) for i in x]
        if isinstance(x, dict):
            return {k: fix(i) for k, i in x.items()}
        return x

    return json.dumps(fix(v), separators=(",", ":"), ensure_ascii=False)


def estoppel_summary(full: dict[str, Any]) -> dict[str, Any]:
    return {
        "limited": True,
        "summary": {
            "as_of": full["as_of"],
            "totals": full["totals"],
            "statements": [{"number": s["number"], "title": s["title"], "basis": s["basis"], "status": s["status"]}
                           for s in full["statements"]],
            "gaps": [{"code": g["code"], "predicate": g["predicate"]} for g in full["gaps"]],
            "conflicts": [{"number": c["number"], "code": c["code"]} for c in full["conflicts"]],
        },
        "estoppel_available": "pro",
        "estoppel_withheld": [
            "the text of each statement, with the lease quote, page and document fingerprint behind it",
            "the flags (amendment changes, name differences, dates that have passed)",
            "the items to send with fact_package_send",
            "the estoppel certificate (report_create kind estoppel_certificate)",
        ],
        "estoppel_note": ("The count of statements, which are from the lease and which the tenant must confirm, and the "
                          "gaps and conflicts are free. Each statement with its lease quote, the certificate and sending "
                          f"it to the tenant are part of the paid plans (Pro and Team): {ESTOPPEL_PLAN_URL}"),
    }


def estoppel_limited() -> bool:
    return audit_limited()


def estoppel_prepare(inp: dict[str, Any]) -> dict[str, Any]:
    full = prepare_estoppel(inp)
    from .free_document import gate_document

    return gate_document("estoppel_prepare", full, estoppel_summary, estoppel_limited())
