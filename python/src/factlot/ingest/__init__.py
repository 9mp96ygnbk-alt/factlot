"""FactLot Ingest (prototype): lease documents → verified, cited facts.

Extraction is pluggable (``ClaudeExtractor`` or your own). Every candidate must pass the
deterministic verifier — its quote must appear on the cited page, its value must have the
right shape, and the numbers, dates, and names in the value must be written in the quote —
before it becomes a fact. Amendments supersede earlier terms, with history kept. Scanned pages
can be read through a pluggable OCR backend (``factlot.ingest.ocr``).
"""

from .documents import LeaseDocument, Page, load_document, unreadable_pages_message
from .extract import PREDICATES, Candidate, ClaudeExtractor, Extractor
from .ocr import OCR_BACKENDS, OcrBackend, TesseractOcr, ocr_backend, tesseract_ocr
from .pipeline import IngestResult, evaluate, ingest_lease
from .verify import Verdict, check_consistency, check_value, verify

__all__ = [
    "OCR_BACKENDS",
    "PREDICATES",
    "Candidate",
    "ClaudeExtractor",
    "Extractor",
    "IngestResult",
    "LeaseDocument",
    "OcrBackend",
    "Page",
    "TesseractOcr",
    "Verdict",
    "check_consistency",
    "check_value",
    "evaluate",
    "ingest_lease",
    "load_document",
    "ocr_backend",
    "tesseract_ocr",
    "unreadable_pages_message",
    "verify",
]
