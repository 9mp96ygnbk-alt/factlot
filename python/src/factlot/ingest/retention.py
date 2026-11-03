"""Controls behind the customer-documents policy (docs/customer-documents.md).

Two things the policy promises are enforced here rather than by convention:

- **Retention.** Every ingest report carries a ``retention`` header with the date after which a
  hosted copy of the source documents is deleted (``retain_until``), computed from the policy
  default. A self-hosted user's own files are never touched; the date is advisory there.
- **Redaction.** A redacted report carries document text only as the quotes that are evidence
  for a fact or a review item. Nothing else from the pages is persisted.
"""

from __future__ import annotations

import copy
from datetime import date, timedelta
from typing import Any

POLICY = "docs/customer-documents.md"
POLICY_VERSION = "1"

# Hosted ingest keeps the uploaded source documents for this many days after the ingest run,
# then deletes them. Long enough to work the review queue (a reviewer needs the page to judge a
# quote), short enough that the service is never a document archive. The customer can shorten
# it to 0 (delete as soon as the report is written) or lengthen it; see the policy.
DEFAULT_RETENTION_DAYS = 30

# Keys that may never appear under a document entry of a persisted report: page text is the
# document itself, not evidence. A ``pages`` list may stay (page numbers, OCR flags) but loses
# these keys from every entry.
_PAGE_TEXT_KEYS = frozenset({"text", "page_text", "body"})


def retain_until(as_of: str, days: int = DEFAULT_RETENTION_DAYS) -> str:
    """The first day on which the source documents of a run dated ``as_of`` may be deleted."""
    if days < 0:
        raise ValueError("retention days must be 0 or more")
    return (date.fromisoformat(as_of) + timedelta(days=days)).isoformat()


def retention_header(as_of: str, days: int = DEFAULT_RETENTION_DAYS) -> dict[str, Any]:
    """The ``retention`` entry of an ingest report."""
    return {"policy": POLICY, "policy_version": POLICY_VERSION, "documents_days": days,
            "retain_until": retain_until(as_of, days)}


def redact_report(report: dict[str, Any]) -> dict[str, Any]:
    """A copy of an ingest report that carries no document text beyond the quotes that are
    evidence: a fact's quote, a review item's quote, a page correction's quote.

    - A rejected candidate keeps its predicate, value, page, check and reason but loses its
      quote: it is not evidence for anything, and the verifier found it on the page (several
      pages) or did not find it (model output that may echo the page).
    - Any page-text field (``text``, ``page_text``, ``body``) under a document entry, or under
      an entry of its ``pages`` list, is dropped, whatever put it there.
    - The report is marked ``"redacted": true`` so a reader knows what to expect.
    """
    out = copy.deepcopy(report)
    for entry in out.get("rejected", []):
        entry.pop("quote", None)
    for doc in out.get("documents", []):
        _strip_page_text(doc)
        pages = doc.get("pages")
        if isinstance(pages, list):
            for page in pages:
                if isinstance(page, dict):
                    _strip_page_text(page)
    out["redacted"] = True
    return out


def _strip_page_text(entry: dict[str, Any]) -> None:
    for key in list(entry):
        if key in _PAGE_TEXT_KEYS:
            del entry[key]
