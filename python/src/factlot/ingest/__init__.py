"""FactLot Ingest (prototype): lease documents → verified, cited facts.

Extraction is pluggable (``ClaudeExtractor`` or your own). Every candidate must pass the
deterministic verifier — its quote must appear on the cited page and its value must have the
right shape — before it becomes a fact. Amendments supersede earlier terms, with history kept.
"""

from .documents import LeaseDocument, Page, load_document
from .extract import PREDICATES, Candidate, ClaudeExtractor, Extractor
from .pipeline import IngestResult, evaluate, ingest_lease
from .verify import Verdict, check_value, verify

__all__ = [
    "PREDICATES",
    "Candidate",
    "ClaudeExtractor",
    "Extractor",
    "IngestResult",
    "LeaseDocument",
    "Page",
    "Verdict",
    "check_value",
    "evaluate",
    "ingest_lease",
    "load_document",
    "verify",
]
