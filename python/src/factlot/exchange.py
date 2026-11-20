"""fact_package_send and fact_package_status: the Python mirror of packages/tools/src/exchange.ts.

Send a fact package to a counterparty for confirmation through the Record, and read the answers.
Both call the Record's public exchange endpoint. A package is sent for real only when this service
holds the Record's application token (FACTLOT_EXCHANGE_TOKEN or configure_exchange(token=...)) AND
the host has said which FactLot account is calling (run_with_exchange_caller); anything else is a
test that never counts in the Record's measure. Nothing is sent without a named approver and an
explicit confirmation. The only network use is urllib; `transport` replaces it for tests.
"""
from __future__ import annotations

import contextlib
import contextvars
import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Callable, Iterator

from .docverify import DocInputError
from .factpackage import verify_fact_package

EXCHANGE_URL = "https://czmyqwkauymguoznzpzr.supabase.co/functions/v1/exchange"
EXCHANGE_SITE_URL = "https://cre-record.vercel.app"

# (url, headers, body) -> (http status, parsed JSON). Raises OSError when nothing answers.
Transport = Callable[[str, dict[str, str], bytes], "tuple[int, Any]"]

_config: dict[str, Any] = {}
_caller: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("factlot_exchange_caller", default=None)


class ExchangeUnavailable(RuntimeError):
    """The exchange could not be reached or failed on its side."""


def configure_exchange(url: str | None = None, site_url: str | None = None, token: str | None = None,
                       transport: Transport | None = None) -> None:
    """Set the exchange endpoint, site, application token or transport. No arguments: the defaults."""
    _config.clear()
    for k, v in (("url", url), ("site_url", site_url), ("token", token), ("transport", transport)):
        if v is not None:
            _config[k] = v


@contextlib.contextmanager
def run_with_exchange_caller(account_id: str | None, full_audit: bool | None = None,
                             test_reason: str | None = None) -> Iterator[None]:
    """Say which FactLot account is calling (never its key) for the fact_package_send calls inside, why
    this caller sends test packages only when the host knows (test_reason, e.g. a guest key), and
    (full_audit False) that this caller gets audit_expense_statement's summary only, as the hosted API does."""
    from . import audit

    caller: dict[str, Any] = {"account_id": account_id} if account_id else {}
    if test_reason:
        caller["test_reason"] = test_reason
    t = _caller.set(caller)
    a = audit.set_full_audit(full_audit)
    try:
        yield
    finally:
        audit._full_audit.reset(a)
        _caller.reset(t)


def current_exchange_caller() -> dict[str, Any] | None:
    return _caller.get()


def _endpoint() -> str:
    return _config.get("url") or os.environ.get("FACTLOT_EXCHANGE_URL") or EXCHANGE_URL


def _site() -> str:
    return (_config.get("site_url") or os.environ.get("FACTLOT_EXCHANGE_SITE_URL") or EXCHANGE_SITE_URL).rstrip("/")


def _token() -> str | None:
    return _config.get("token") or os.environ.get("FACTLOT_EXCHANGE_TOKEN") or None


def _urllib_transport(url: str, headers: dict[str, str], body: bytes) -> tuple[int, Any]:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 - the Record's own https endpoint
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def _call(body: dict[str, Any], forward_token: bool) -> dict[str, Any]:
    headers = {"content-type": "application/json"}
    token = _token()
    if forward_token and token:
        headers["authorization"] = f"Bearer {token}"
    transport: Transport = _config.get("transport") or _urllib_transport
    try:
        status, out = transport(_endpoint(), headers, json.dumps(body).encode("utf-8"))
    except json.JSONDecodeError:
        raise ExchangeUnavailable("the Record's exchange gave an unreadable answer; check fact_package_status before sending again") from None
    except OSError:
        raise ExchangeUnavailable("the Record's exchange did not answer, so nothing was sent; retry in a moment") from None
    if isinstance(out, dict) and out.get("ok") is True:
        return out["result"]
    message = str((out or {}).get("error") or f"the exchange answered {status}") if isinstance(out, dict) else \
        f"the exchange answered {status}"
    if status >= 500:
        raise ExchangeUnavailable(f"the Record's exchange failed ({message}); check fact_package_status before sending again")
    raise DocInputError([{"path": "", "message": message}])


def _link(id_: str, token: str) -> str:
    return f"{_site()}/#/r/{id_}/{token}"


def send_fact_package(args: dict[str, Any]) -> dict[str, Any]:
    inp = args
    issues: list[dict[str, str]] = []
    if inp.get("approval_confirmed") is not True:
        issues.append({"path": "approval_confirmed", "message":
                       "refused: nothing is sent without approval_confirmed true, confirming that the person named in approved_by "
                       "reviewed every item, both figures, the quote and page behind each, the calculation and the recipient, "
                       "and approved sending"})
    if not str(inp["approved_by"]).strip():
        issues.append({"path": "approved_by", "message": "the full name of the person who approved sending is required"})
    if inp["from"]["organisation"].strip().lower() == inp["to"]["organisation"].strip().lower():
        issues.append({"path": "to.organisation", "message": "the counterparty must be a different organisation from the sender"})
    seen: set[str] = set()
    for i, it in enumerate(inp["items"]):
        if it["key"] in seen:
            issues.append({"path": f"items.{i}.key", "message": f"duplicate item key {it['key']}"})
        seen.add(it["key"])
        if it["position"] == "state_ours" and "their_value" not in it:
            issues.append({"path": f"items.{i}.their_value", "message": "give the counterparty's figure for an item the sender states"})
    pkg = inp["package"]
    ids = {f.get("id") for f in pkg.get("facts", []) if isinstance(f, dict) and isinstance(f.get("id"), str)} \
        if isinstance(pkg.get("facts"), list) else set()
    for i, it in enumerate(inp["items"]):
        for j, fid in enumerate(it["fact_ids"]):
            if fid not in ids:
                issues.append({"path": f"items.{i}.fact_ids.{j}", "message": f"{fid} is not a fact in the package"})
    if issues:
        raise DocInputError(issues[:20])

    check = verify_fact_package({"package": pkg})
    if check.get("valid") is not True:
        problems = [{"path": "package", "message": m} for m in (check.get("integrity", {}).get("problems") or [])]
        problems += [{"path": f"package.facts.{x['fact']}",
                      "message": "the fact does not pass fact_validate (run fact_package_verify for details)"}
                     for x in check.get("facts", {}).get("invalid", [])]
        raise DocInputError(problems[:20] or [{"path": "package", "message": "the package does not pass fact_package_verify"}])

    subject = inp["subject"]
    ref = subject.get("record_id") or subject.get("urn")
    caller = current_exchange_caller() or {}
    account_id = caller.get("account_id")
    forward = bool(_token() and account_id)
    body: dict[str, Any] = {
        "action": "send", "package": pkg, "kind": inp["kind"], "title": inp["title"],
        "subject": {"label": subject["label"], **({"ref": ref} if ref else {})},
        "from": inp["from"], "to": inp["to"], "items": inp["items"],
        **({"calculation": inp["calculation"]} if inp.get("calculation") else {}),
        "approved_by": inp["approved_by"], "approval_confirmed": True,
        **({"sender_account": account_id} if forward else {}),
    }
    sent = _call(body, forward)
    id_ = str(sent["id"])
    reliances = sent.get("reliances_recorded") or []
    sandbox = sent.get("sandbox") is True
    if not _token():
        reason = ("this FactLot is not connected to the Record as an accredited service (a local or self-hosted install, "
                  "or a service without the Record's application token)")
    elif not account_id:
        reason = caller.get("test_reason") or (
            "no FactLot account key came with the call (only a caller with a FactLot account key, free or paid, can send for real)")
    else:
        reason = str(sent.get("test_mode_reason") or "the Record took it as a test")
    n = len(reliances)
    to_org = inp["to"]["organisation"]
    if sandbox:
        message = (f"TEST MODE: this package was sent in test mode. It does not count in the Record's measure and records no real "
                   f"reliance, because {reason}. The counterparty can still open the link and answer.")
    else:
        message = (f"SENT FOR REAL: the Record recorded {n} reliance{'' if n == 1 else 's'} now (the sender relies on "
                   f"{'the figure' if n == 1 else 'the figures'} it accepted from {to_org}), and each item {to_org} agrees to will be "
                   f"recorded as relied on by them. Each is tied to the sender's FactLot account.")
    return {
        "package_id": id_, "digest": sent.get("digest"), "package_root": sent.get("package_root"), "status": sent.get("status"),
        "recorded_as": "sandbox" if sandbox else "real", "test_mode": sandbox, "message": message,
        "link_for_counterparty": _link(id_, str(sent["counterparty_token"])),
        "status_link_for_sender": _link(id_, str(sent["owner_token"])),
        "recorded": {
            "reliances_recorded": n,
            "items_accepted": [r.get("item") for r in reliances],
            "items_awaiting_answer": [x["key"] for x in inp["items"] if x["position"] == "state_ours"],
            "counts_in_the_measure": not sandbox,
        },
        "note": f"Send link_for_counterparty to {to_org}; it needs no account. Keep status_link_for_sender private: "
                f"it reads the answers (fact_package_status).",
    }


def _id_and_token(inp: dict[str, Any]) -> tuple[str, str]:
    if inp.get("status_link"):
        m = re.search(r"#/r/([0-9a-f-]{36})/([0-9a-zA-Z]+)/?$", inp["status_link"].strip())
        if not m:
            raise DocInputError([{"path": "status_link", "message": "not a status link from fact_package_send"}])
        return m.group(1), m.group(2)
    if inp.get("package_id") and inp.get("token"):
        return inp["package_id"], inp["token"]
    raise DocInputError([{"path": "", "message": "give status_link, or package_id with token"}])


def fact_package_status(args: dict[str, Any]) -> dict[str, Any]:
    id_, token = _id_and_token(args)
    s = _call({"action": "status", "id": id_, "token": token}, False)
    items = []
    for it in s["items"]:
        r = it.get("response")
        if r:
            answer: dict[str, Any] | None = {"decision": "agreed" if r.get("decision") == "confirm" else "disputed",
                                             "note": r.get("note"), "by": r.get("responded_by_name"), "at": r.get("responded_at")}
        elif it.get("position") == "accept_theirs":
            answer = {"decision": "accepted_by_sender"}
        else:
            answer = None
        items.append({"key": it.get("key"), "label": it.get("label"), "position": it.get("position"), "value": it.get("value"),
                      "their_value": it.get("their_value"), "answer": answer})
    return {
        "package_id": s.get("id"), "title": s.get("title"), "status": s.get("status"), "sandbox": s.get("sandbox"),
        "test_mode": s.get("sandbox"), "to": (s.get("to") or {}).get("organisation"), "package_root": s.get("package_root"),
        "integrity": s.get("integrity"), "items": items,
        "awaiting_answer": sum(1 for x in items if x["position"] == "state_ours" and x["answer"] is None),
        "agreed": sum(1 for x in items if (x["answer"] or {}).get("decision") == "agreed"),
        "disputed": sum(1 for x in items if (x["answer"] or {}).get("decision") == "disputed"),
        "reliances": s.get("reliances"), "responded_at": s.get("responded_at"),
    }
