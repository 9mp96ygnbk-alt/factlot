"""Lease file → verified, cited FactLot facts, with amendment supersession and a review queue."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from ..facts import validate_fact
from ..ids import _base32
from .documents import LeaseDocument
from .extract import Candidate, Extractor
from .retention import DEFAULT_RETENTION_DAYS, redact_report, retention_header
from .review import ReviewItem, review_id, review_key
from .verify import CHECK_CONSISTENCY, Verdict, verify

# Extractor confidence below this goes to the review queue instead of straight to a fact. It is
# the registry's cap for a reviewed owner link, so an unreviewed low-confidence extraction never
# outranks a reviewed one. Candidates that report no confidence are not held back by it.
REVIEW_CONFIDENCE_THRESHOLD = 0.8
CHECK_CONFIDENCE = "confidence"


@dataclass
class IngestResult:
    facts: list[dict[str, Any]]  # every accepted fact, including superseded ones
    current: dict[str, dict[str, Any]]  # predicate → the fact in force after all amendments
    rejected: list[Verdict] = field(default_factory=list)
    corrected: list[Verdict] = field(default_factory=list)
    review: list[ReviewItem] = field(default_factory=list)  # pending and decided, in queue order
    # What a review decision needs to assemble a fact later, when the documents are gone.
    lease_urn: str = ""
    as_of: str = ""
    producer: dict[str, str] = field(default_factory=dict)
    rights: dict[str, Any] | None = None
    documents: list[dict[str, Any]] = field(default_factory=list)  # in applied order
    # Days after ``as_of`` on which a hosted copy of the source documents is deleted
    # (docs/customer-documents.md). Advisory for self-hosted runs: the files are the user's own.
    retention_days: int = DEFAULT_RETENTION_DAYS

    def summary(self) -> dict[str, int]:
        return {"accepted": len(self.facts), "current": len(self.current), "rejected": len(self.rejected),
                "page_corrected": len(self.corrected),
                "review_pending": sum(r.status == "pending" for r in self.review),
                "review_accepted": sum(r.status == "accepted" for r in self.review),
                "review_rejected": sum(r.status == "rejected" for r in self.review)}

    def review_item(self, item_id: str) -> ReviewItem | None:
        return next((r for r in self.review if r.id == item_id), None)

    def to_report(self, *, redact: bool = False) -> dict[str, Any]:
        """The JSON the CLI writes. ``from_report`` reads it back, so review decisions survive runs.

        The ``retention`` header says when a hosted copy of the source documents is deleted.
        With ``redact=True`` the report carries document text only as the quotes that are
        evidence for a fact or a review item (``retention.redact_report``); hosted ingest must
        persist nothing else. Review decisions survive either way: redaction never touches the
        review queue.
        """
        report = {"lease_urn": self.lease_urn, "as_of": self.as_of,
                  "retention": retention_header(self.as_of, self.retention_days) if self.as_of else None,
                  "producer": self.producer, "rights": self.rights,
                  "documents": self.documents, "summary": self.summary(), "current": self.current, "facts": self.facts,
                  "rejected": [_verdict_record(v) for v in self.rejected],
                  "corrected": [_verdict_record(v) for v in self.corrected],
                  "review": [r.to_dict() for r in self.review]}
        return redact_report(report) if redact else report

    @classmethod
    def from_report(cls, report: dict[str, Any]) -> IngestResult:
        retention = report.get("retention") or {}
        return cls(facts=list(report.get("facts", [])), current=dict(report.get("current", {})),
                   rejected=[_verdict_from(r) for r in report.get("rejected", [])],
                   corrected=[_verdict_from(r) for r in report.get("corrected", [])],
                   review=[ReviewItem.from_dict(r) for r in report.get("review", [])],
                   lease_urn=report.get("lease_urn", ""), as_of=report.get("as_of", ""),
                   producer=dict(report.get("producer", {})), rights=report.get("rights"),
                   documents=list(report.get("documents", [])),
                   retention_days=int(retention.get("documents_days", DEFAULT_RETENTION_DAYS)))


def _verdict_record(v: Verdict) -> dict[str, Any]:
    d: dict[str, Any] = {"predicate": v.candidate.predicate, "value": v.candidate.value, "quote": v.candidate.quote,
                         "page": v.candidate.page}
    if v.page_corrected:
        d["page_found"] = v.page
    if v.check:
        d["check"] = v.check
    if v.reason:
        d["reason"] = v.reason
    return d


def _verdict_from(d: dict[str, Any]) -> Verdict:
    # A redacted report has no quote on a rejected candidate (retention.redact_report).
    cand = Candidate(d["predicate"], d.get("value"), d.get("quote", ""), int(d.get("page") or 0))
    corrected = "page_found" in d
    return Verdict(cand, corrected and not d.get("check"), d.get("page_found") if corrected else None,
                   d.get("reason"), page_corrected=corrected, check=d.get("check"))


def _fact_id(subject: str, predicate: str, document_id: str, quote: str) -> str:
    digest = hashlib.sha256("\x1f".join((subject, predicate, document_id, quote)).encode()).digest()
    return f"flf_{_base32(digest, 24)}"


def _document_index(result: IngestResult, document_id: str) -> int:
    return next((i for i, d in enumerate(result.documents) if d["document_id"] == document_id), -1)


def assemble_fact(result: IngestResult, cand: Candidate, *, document_id: str, title: str, page: int,
                  ocr: bool, effective_date: str | None) -> dict[str, Any]:
    """Build a cited fact for a candidate whose quote verified on ``page`` of the document."""
    source: dict[str, Any] = {"document_id": document_id, "title": title, "page": page, "quote": cand.quote}
    if cand.section:
        source["section"] = cand.section
    if ocr:
        # The quote was matched against OCR output, not the document's text layer, so a reader
        # checking the citation should look at the page image.
        source["ocr"] = True
    fact: dict[str, Any] = {
        "id": _fact_id(result.lease_urn, cand.predicate, document_id, cand.quote),
        "subject": result.lease_urn,
        "predicate": cand.predicate,
        "value": cand.value,
        "as_of": result.as_of,
        "provenance": {"method": "extracted", "sources": [source], "producer": dict(result.producer)},
    }
    if effective_date:
        fact["valid_from"] = effective_date
    if cand.confidence is not None:
        fact["provenance"]["confidence"] = cand.confidence
    if result.rights:
        fact["rights"] = result.rights
    return fact


def place_fact(result: IngestResult, fact: dict[str, Any]) -> None:
    """Add a fact and apply supersession: the fact from the latest instrument is current, and a
    fact that displaces one from an earlier instrument links to it through ``supersedes``."""
    check = validate_fact(fact)
    if not check["valid"]:  # defensive: the pipeline must only emit valid facts
        raise AssertionError(f"pipeline produced an invalid fact: {check['issues']}")
    if any(f["id"] == fact["id"] for f in result.facts):
        return  # the same quote from the same document is already a fact (a re-run)
    document_id = fact["provenance"]["sources"][0]["document_id"]
    previous = result.current.get(fact["predicate"])
    if previous is not None:
        previous_doc = previous["provenance"]["sources"][0]["document_id"]
        if _document_index(result, previous_doc) > _document_index(result, document_id):
            # A later instrument already states this term (the fact was accepted from review
            # after the amendment was applied): it stays current and records what it overrides.
            if fact["id"] not in previous.get("supersedes", []):
                previous.setdefault("supersedes", []).append(fact["id"])
            result.facts.append(fact)
            return
        if previous_doc != document_id:
            fact["supersedes"] = [previous["id"]]
    result.facts.append(fact)
    result.current[fact["predicate"]] = fact


def document_order(documents: list[LeaseDocument]) -> list[LeaseDocument]:
    """The order instruments apply in: the original, then amendments by effective date (sequence
    breaks ties). If any amendment has no effective date, amendments apply in sequence order
    alone (the order they were given): an undated amendment cannot be placed among dated ones."""
    originals = sorted((d for d in documents if d.role == "original"), key=lambda d: d.sequence)
    amendments = [d for d in documents if d.role != "original"]
    if all(d.effective_date for d in amendments):
        amendments.sort(key=lambda d: (d.effective_date or "", d.sequence))
    else:
        amendments.sort(key=lambda d: d.sequence)
    return originals + amendments


def ingest_lease(lease_urn: str, documents: list[LeaseDocument], extractor: Extractor, *, as_of: str,
                 rights: dict[str, Any] | None = None, review: list[ReviewItem] | None = None,
                 confidence_threshold: float = REVIEW_CONFIDENCE_THRESHOLD,
                 retention_days: int = DEFAULT_RETENTION_DAYS) -> IngestResult:
    """Extract, verify, and order facts across a lease and its amendments.

    ``retention_days`` sets the report's ``retention.retain_until`` (``as_of`` plus the days): the
    date after which a hosted copy of the source documents is deleted (docs/customer-documents.md).

    Documents are applied in ``document_order``: the original first, then amendments by
    effective date and sequence (by sequence alone if any amendment is undated). A later document's fact for a predicate supersedes the earlier one; the history
    is kept and linked through ``supersedes``.

    A candidate whose quote verifies but whose value does not follow from it, or whose extractor
    confidence is below ``confidence_threshold``, is queued for human review instead of dropped
    (``result.review``; see ``review_queue`` and ``decide``). ``review`` carries the queue from an
    earlier run: an accepted item is a fact again, a rejected (predicate, quote) pair is never
    queued again, and pending items keep their place and ID, so re-running is idempotent.
    """
    order = document_order(documents)
    result = IngestResult(facts=[], current={}, review=[ReviewItem.from_dict(r.to_dict()) for r in review or []],
                          lease_urn=lease_urn, as_of=as_of,
                          producer={"name": extractor.name, "version": extractor.version}, rights=rights,
                          documents=[{"document_id": d.document_id, "title": d.title,
                                      "effective_date": d.effective_date} for d in order],
                          retention_days=retention_days)
    decided = {r.id: r for r in result.review if r.status != "pending"}
    rejected_pairs = {review_key(r.candidate.predicate, r.candidate.quote)
                      for r in result.review if r.status == "rejected"}
    for doc in order:
        for cand in extractor.extract(doc):
            v = verify(doc, cand)
            if v.accepted and cand.confidence is not None and cand.confidence < confidence_threshold:
                check: str | None = CHECK_CONFIDENCE
                reason: str | None = f"extractor confidence {cand.confidence} is below {confidence_threshold}"
            elif v.accepted:
                check, reason = None, None
            elif v.check == CHECK_CONSISTENCY:
                check, reason = CHECK_CONSISTENCY, v.reason
            else:
                result.rejected.append(v)
                continue
            if v.page_corrected:
                result.corrected.append(v)
            page = doc.page(v.page)
            ocr = page is not None and page.ocr
            earlier = decided.get(review_id(cand))
            if earlier is not None and earlier.status == "rejected":
                # A reviewer rejected this exact (predicate, quote, value): a re-run must not turn it
                # into a fact because the extractor's confidence or the threshold changed.
                continue
            if check is None or (earlier is not None and earlier.status == "accepted"):
                fact = assemble_fact(result, cand, document_id=doc.document_id, title=doc.title, page=v.page,
                                     ocr=ocr, effective_date=doc.effective_date)
                if check is None:
                    _drop_pending(result, review_id(cand))  # the same candidate now verifies on its own
                else:
                    _note_review(fact, earlier)
                place_fact(result, fact)
                continue
            if earlier is not None or review_key(cand.predicate, cand.quote) in rejected_pairs:
                continue  # rejected by a reviewer: never queued again
            item = ReviewItem.queue(cand, check=check, reason=reason, document_id=doc.document_id, title=doc.title,
                                    page=v.page, ocr=ocr, effective_date=doc.effective_date)
            if result.review_item(item.id) is None:
                result.review.append(item)
    _reapply_accepted(result)
    return result


def _drop_pending(result: IngestResult, item_id: str) -> None:
    result.review = [r for r in result.review if not (r.status == "pending" and r.id == item_id)]


def _note_review(fact: dict[str, Any], item: ReviewItem) -> None:
    """Record on the fact that a reviewer accepted it and which check it had failed.

    The fact schema has no free-text provenance note, so the note is the ``verified_by`` string
    and ``verified_at`` is the decision time. ``method`` stays ``extracted``: the value still came
    from the extractor and is cited to its quote."""
    fact["provenance"]["verified_by"] = (f"{item.decided_by} (accepted in ingest review {item.id} after failing "
                                         f"the {item.check} check: {item.reason})")
    if item.decided_at:
        fact["provenance"]["verified_at"] = item.decided_at


def _reapply_accepted(result: IngestResult) -> None:
    """An accepted item whose candidate did not reappear in this run still stands as a fact, as
    long as its document is part of the run."""
    for item in result.review:
        if item.status != "accepted" or _document_index(result, item.document_id) < 0:
            continue
        fact = assemble_fact(result, item.candidate, document_id=item.document_id, title=item.title, page=item.page,
                             ocr=item.ocr, effective_date=item.effective_date)
        _note_review(fact, item)
        place_fact(result, fact)


def review_queue(result: IngestResult, status: str = "pending") -> list[ReviewItem]:
    """Review items with the given status, in queue order (document order, then extraction order)."""
    return [r for r in result.review if r.status == status]


def decide(result: IngestResult, item_id: str, accepted: bool, decided_by: str, *,
           now: str | None = None) -> ReviewItem:
    """Record a reviewer's decision on a queued item. Decisions are final.

    Accepting turns the candidate into a fact (method ``extracted``, with a provenance note naming
    the reviewer and the check it failed) placed with the usual supersession. Rejecting only
    records the decision; the same (predicate, quote) is never queued again.
    """
    if not decided_by or not decided_by.strip():
        raise ValueError("decided_by must name the reviewer")
    item = result.review_item(item_id)
    if item is None:
        raise ValueError(f"no review item {item_id}")
    if item.status != "pending":
        raise ValueError(f"review item {item_id} was already {item.status}")
    if accepted:
        key = review_key(item.candidate.predicate, item.candidate.quote)
        other = next((r for r in result.review if r.status == "accepted" and r.id != item.id
                      and review_key(r.candidate.predicate, r.candidate.quote) == key), None)
        if other is not None:
            # Both would cite the same quote for the same term: only one value can follow from it.
            raise ValueError(f"review item {other.id} with the same predicate and quote was already accepted "
                             f"(value {json.dumps(other.candidate.value)}); reject this one instead")
    item.decide(accepted, decided_by.strip(), now=now)
    if accepted:
        fact = assemble_fact(result, item.candidate, document_id=item.document_id, title=item.title, page=item.page,
                             ocr=item.ocr, effective_date=item.effective_date)
        _note_review(fact, item)
        place_fact(result, fact)
    return item


def evaluate(result: IngestResult, gold: dict[str, Any]) -> dict[str, Any]:
    """Compare current facts to hand-labelled gold values: precision, recall, and per-predicate detail."""
    predicted = {p: f["value"] for p, f in result.current.items()}
    correct = sorted(p for p in predicted if p in gold and predicted[p] == gold[p])
    wrong = sorted(p for p in predicted if p in gold and predicted[p] != gold[p])
    extra = sorted(p for p in predicted if p not in gold)
    missed = sorted(p for p in gold if p not in predicted)
    precision = len(correct) / len(predicted) if predicted else 0.0
    recall = len(correct) / len(gold) if gold else 0.0
    return {"precision": round(precision, 4), "recall": round(recall, 4), "correct": correct, "wrong": wrong,
            "extra": extra, "missed": missed}
