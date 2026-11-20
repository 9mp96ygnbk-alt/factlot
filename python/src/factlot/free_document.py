"""The first full document free: the hosted rule for audit_expense_statement, estoppel_prepare and
rent_roll_certify (the same code as packages/tools/src/free_document.ts).

A caller the host says gets the summary (full_audit False) may be entitled to one whole document: the host
passes `free_document`, an object with `use(tool, document_id) -> dict` (keys granted, again, used_at,
used_tool, busy, covers_until). Locally, and when the host sets nothing, the answer is whole or the summary
exactly as before."""

from __future__ import annotations

import contextvars
import hashlib
from typing import Any, Callable

from .factpackage import canonical_json

FREE_DOCUMENT_PLAN_URL = "https://factlot.com/pricing/"
FREE_DOCUMENT_TOOLS = ("audit_expense_statement", "estoppel_prepare", "rent_roll_certify")
FREE_DOCUMENT_COVER_HOURS = 24

_free_document: contextvars.ContextVar[Any] = contextvars.ContextVar("factlot_free_document", default=None)


def set_free_document(host: Any):
    return _free_document.set(host)


def document_id(full: dict[str, Any]) -> str:
    """SHA-256 of the canonical JSON of the tool's whole answer (also what report_create computes)."""
    return hashlib.sha256(canonical_json(full).encode("utf-8")).hexdigest()


def _note(use: dict[str, Any]) -> dict[str, Any]:
    until = use.get("covers_until")
    if use.get("again"):
        used = use.get("used_at")
        return {
            "free_document": True,
            "counted_again": False,
            "covers_until": until,
            "note": (
                "This is the whole answer to the document this account used its one free full document on"
                f"{f' ({used})' if used else ''}; asking for it again is not counted again, and its report "
                f"(report_create) is covered until {until or '24 hours after it was first used'}. A different "
                f"document needs a Pro or Team plan: {FREE_DOCUMENT_PLAN_URL}"
            ),
        }
    return {
        "free_document": True,
        "counted_again": False,
        "covers_until": until,
        "note": (
            "This was this account's one free full document (across the expense audit, the estoppel "
            "certificate and the rent roll certificate). The whole answer is returned, and its report "
            f"(report_create, the same arguments) is covered until {until or '24 hours from now'}. Later "
            "documents return the summary only; the whole answer needs a Pro or Team plan (included, with "
            f"the monthly allowance, at no charge per document): {FREE_DOCUMENT_PLAN_URL}"
        ),
    }


def _used_note(use: dict[str, Any]) -> dict[str, Any]:
    used = use.get("used_at")
    if use.get("busy"):
        text = (
            "This account's one free full document is being used by another request right now; ask again "
            "in a minute to see whether it is still available. Pro and Team plans include every document: "
            f"{FREE_DOCUMENT_PLAN_URL}"
        )
    else:
        tool = use.get("used_tool")
        text = (
            f"This account's one free full document was already used{f' ({used})' if used else ''}"
            f"{f' on {tool}' if tool else ''}. The summary is returned; the whole answer needs a Pro or Team "
            f"plan: {FREE_DOCUMENT_PLAN_URL}"
        )
    return {"free_document": False, "free_document_used_at": used, "note": text}


def gate_document(tool: str, full: dict[str, Any], summary: Callable[[dict[str, Any]], dict[str, Any]],
                  limited: bool) -> dict[str, Any]:
    if not limited:
        return full
    host = _free_document.get()
    if host is None:
        return summary(full)
    use = host.use(tool, document_id(full))
    if use.get("granted"):
        return {**full, "free_document": _note(use)}
    return {**summary(full), "free_document": _used_note(use)}
