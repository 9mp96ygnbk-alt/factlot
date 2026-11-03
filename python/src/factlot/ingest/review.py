"""The human review queue: candidates the verifier could neither accept nor dismiss.

A candidate whose quote is on the page but whose value does not follow from it, or whose
extractor confidence is below the threshold, is queued here with the check it failed and the
reason. A reviewer accepts or rejects each item (``pipeline.decide``). The queue is a list of
plain records so it round-trips through the CLI's JSON output and survives between runs.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..ids import _base32
from .extract import Candidate
from .verify import _norm

STATUSES = ("pending", "accepted", "rejected")


def _norm_quote(quote: str) -> str:
    # The verifier's quote normalization, so a pair survives whitespace and typographic
    # differences between runs.
    return _norm(quote)


def review_key(predicate: str, quote: str) -> tuple[str, str]:
    """The (predicate, quote) pair a rejection applies to: once rejected, never queued again."""
    return predicate, _norm_quote(quote)


def review_id(candidate: Candidate) -> str:
    """Deterministic ID from the predicate, quote and value, so a re-run finds the same item."""
    key = "\x1f".join((candidate.predicate, _norm_quote(candidate.quote),
                       json.dumps(candidate.value, sort_keys=True, separators=(",", ":"))))
    return f"rv_{_base32(hashlib.sha256(key.encode()).digest(), 12)}"


@dataclass
class ReviewItem:
    id: str
    candidate: Candidate
    check: str  # the check the candidate failed: "consistency" or "confidence"
    reason: str
    document_id: str
    title: str
    page: int  # the page the quote was found on
    ocr: bool = False
    effective_date: str | None = None
    status: str = "pending"
    decided_by: str | None = None
    decided_at: str | None = None

    @property
    def quote(self) -> str:
        return self.candidate.quote

    @classmethod
    def queue(cls, candidate: Candidate, *, check: str, reason: str, document_id: str, title: str, page: int,
              ocr: bool = False, effective_date: str | None = None) -> ReviewItem:
        return cls(review_id(candidate), candidate, check, reason, document_id, title, page, ocr, effective_date)

    def decide(self, accepted: bool, decided_by: str, *, now: str | None = None) -> None:
        if self.status != "pending":
            raise ValueError(f"review item {self.id} was already {self.status}")
        self.status = "accepted" if accepted else "rejected"
        self.decided_by = decided_by
        self.decided_at = now or datetime.now(timezone.utc).isoformat(timespec="seconds")

    def to_dict(self) -> dict[str, Any]:
        c = self.candidate
        d: dict[str, Any] = {"id": self.id, "status": self.status, "check": self.check, "reason": self.reason,
                             "predicate": c.predicate, "value": c.value, "quote": c.quote, "page": self.page,
                             "document_id": self.document_id, "title": self.title}
        if c.section:
            d["section"] = c.section
        if c.confidence is not None:
            d["confidence"] = c.confidence
        if self.ocr:
            d["ocr"] = True
        if self.effective_date:
            d["effective_date"] = self.effective_date
        if self.status != "pending":
            d["decided_by"], d["decided_at"] = self.decided_by, self.decided_at
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ReviewItem:
        if d.get("status", "pending") not in STATUSES:
            raise ValueError(f"review item {d.get('id')} has unknown status {d.get('status')!r}")
        cand = Candidate(d["predicate"], d["value"], d["quote"], int(d["page"]), d.get("section"),
                         d.get("confidence"))
        return cls(d["id"], cand, d["check"], d["reason"], d["document_id"], d.get("title", ""), int(d["page"]),
                   bool(d.get("ocr", False)), d.get("effective_date"), d.get("status", "pending"),
                   d.get("decided_by"), d.get("decided_at"))

    def describe(self) -> str:
        """One block of text for the CLI listing. Text that came from a document or a queue file
        is printed with control characters escaped, so it cannot drive the terminal."""
        c = self.candidate
        lines = [f"{_safe(self.id)}  {_safe(c.predicate)}  [{self.status}]",
                 f"  value:   {json.dumps(c.value)}",
                 f"  failed:  {_safe(self.check)} ({_safe(self.reason)})",
                 f"  cited:   {_safe(self.title)}, page {self.page}" + (f", section {_safe(c.section)}" if c.section else "")
                 + (" (OCR)" if self.ocr else ""),
                 f"  quote:   {c.quote!r}"]
        if self.status != "pending":
            lines.append(f"  decided: {self.status} by {_safe(self.decided_by)} at {_safe(self.decided_at)}")
        return "\n".join(lines)


def _safe(text: Any) -> str:
    """Printable characters as they are; anything else (ESC, CR, BEL, ...) as an escape."""
    return "".join(ch if ch.isprintable() else repr(ch)[1:-1] for ch in str(text))
