"""Lease file → verified, cited FactLot facts, with amendment supersession."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from ..facts import validate_fact
from ..ids import _base32
from .documents import LeaseDocument
from .extract import Extractor
from .verify import Verdict, verify


@dataclass
class IngestResult:
    facts: list[dict[str, Any]]  # every accepted fact, including superseded ones
    current: dict[str, dict[str, Any]]  # predicate → the fact in force after all amendments
    rejected: list[Verdict] = field(default_factory=list)
    corrected: list[Verdict] = field(default_factory=list)

    def summary(self) -> dict[str, int]:
        return {"accepted": len(self.facts), "current": len(self.current), "rejected": len(self.rejected),
                "page_corrected": len(self.corrected)}


def _fact_id(subject: str, predicate: str, document_id: str, quote: str) -> str:
    digest = hashlib.sha256("\x1f".join((subject, predicate, document_id, quote)).encode()).digest()
    return f"flf_{_base32(digest, 24)}"


def ingest_lease(lease_urn: str, documents: list[LeaseDocument], extractor: Extractor, *, as_of: str,
                 rights: dict[str, Any] | None = None) -> IngestResult:
    """Extract, verify, and order facts across a lease and its amendments.

    Documents are applied in order (original first, then amendments by effective date and
    sequence). A later document's fact for a predicate supersedes the earlier one; the history
    is kept and linked through ``supersedes``.
    """
    order = sorted(documents, key=lambda d: (d.role != "original", d.effective_date or "", d.sequence))
    result = IngestResult(facts=[], current={})
    for doc in order:
        for cand in extractor.extract(doc):
            v = verify(doc, cand)
            if not v.accepted:
                result.rejected.append(v)
                continue
            if v.page_corrected:
                result.corrected.append(v)
            source: dict[str, Any] = {"document_id": doc.document_id, "title": doc.title, "page": v.page,
                                      "quote": cand.quote}
            if cand.section:
                source["section"] = cand.section
            page = doc.page(v.page) if v.page is not None else None
            if page is not None and page.ocr:
                # The quote was matched against OCR output, not the document's text layer, so a
                # reader checking the citation should look at the page image.
                source["ocr"] = True
            fact: dict[str, Any] = {
                "id": _fact_id(lease_urn, cand.predicate, doc.document_id, cand.quote),
                "subject": lease_urn,
                "predicate": cand.predicate,
                "value": cand.value,
                "as_of": as_of,
                "provenance": {"method": "extracted", "sources": [source],
                               "producer": {"name": extractor.name, "version": extractor.version}},
            }
            if doc.effective_date:
                fact["valid_from"] = doc.effective_date
            if cand.confidence is not None:
                fact["provenance"]["confidence"] = cand.confidence
            if rights:
                fact["rights"] = rights
            previous = result.current.get(cand.predicate)
            if previous and previous["provenance"]["sources"][0]["document_id"] != doc.document_id:
                fact["supersedes"] = [previous["id"]]
            check = validate_fact(fact)
            if not check["valid"]:  # defensive: the pipeline must only emit valid facts
                raise AssertionError(f"pipeline produced an invalid fact: {check['issues']}")
            result.facts.append(fact)
            result.current[cand.predicate] = fact
    return result


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
