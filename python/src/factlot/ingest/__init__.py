"""FactLot Ingest (prototype): lease documents → verified, cited facts.

Extraction is pluggable (``ClaudeExtractor`` or your own). Every candidate must pass the
deterministic verifier — its quote must appear on the cited page, its value must have the
right shape, and the numbers, dates, and names in the value must be written in the quote —
before it becomes a fact. Amendments supersede earlier terms, with history kept. Scanned pages
can be read through a pluggable OCR backend (``factlot.ingest.ocr``). Candidates the verifier
can neither accept nor dismiss (quote present, value not written in it; or low extractor
confidence) wait in a review queue for a human decision (``review_queue``, ``decide``). The
report can be redacted to quotes only and carries a retention date (``factlot.ingest.retention``,
docs/customer-documents.md).
"""

from .documents import LeaseDocument, Page, load_document, unreadable_pages_message
from .extract import PREDICATES, Candidate, ClaudeExtractor, Extractor
from .ocr import OCR_BACKENDS, OcrBackend, TesseractOcr, ocr_backend, tesseract_ocr
from .pipeline import REVIEW_CONFIDENCE_THRESHOLD, IngestResult, decide, evaluate, ingest_lease, review_queue
from .retention import DEFAULT_RETENTION_DAYS, redact_report, retain_until, retention_header
from .review import ReviewItem
from .verify import Verdict, check_consistency, check_value, verify

__all__ = [
    "DEFAULT_RETENTION_DAYS",
    "OCR_BACKENDS",
    "PREDICATES",
    "REVIEW_CONFIDENCE_THRESHOLD",
    "Candidate",
    "ClaudeExtractor",
    "Extractor",
    "IngestResult",
    "LeaseDocument",
    "OcrBackend",
    "Page",
    "ReviewItem",
    "TesseractOcr",
    "Verdict",
    "check_consistency",
    "check_value",
    "decide",
    "evaluate",
    "ingest_lease",
    "load_document",
    "ocr_backend",
    "redact_report",
    "retain_until",
    "retention_header",
    "review_queue",
    "tesseract_ocr",
    "unreadable_pages_message",
    "verify",
]
