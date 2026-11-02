"""Lease documents as cited pages."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..registry.store import file_document_id


@dataclass(frozen=True)
class Page:
    number: int  # 1-based
    text: str


@dataclass
class LeaseDocument:
    """One instrument in a lease file: the original lease or an amendment."""

    document_id: str  # fl:document:sha256-… of the exact file
    title: str
    pages: list[Page]
    role: str = "original"  # original | amendment
    effective_date: str | None = None  # YYYY-MM-DD; orders amendments
    sequence: int = 0  # tie-breaker when dates are equal or missing
    metadata: dict[str, str] = field(default_factory=dict)

    def page(self, number: int) -> Page | None:
        return next((p for p in self.pages if p.number == number), None)


def load_document(path: str | Path, *, title: str | None = None, role: str = "original",
                  effective_date: str | None = None, sequence: int = 0) -> LeaseDocument:
    """Load a lease instrument. Text files split pages on form feeds; PDFs need `pip install pypdf`."""
    path = Path(path)
    doc_id, _ = file_document_id(path)
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader  # optional dependency
        except ImportError as e:  # pragma: no cover - environment dependent
            raise RuntimeError("reading PDFs requires `pip install pypdf` (or provide extracted text)") from e
        texts = [p.extract_text() or "" for p in PdfReader(str(path)).pages]
    else:
        texts = path.read_text("utf-8").split("\f")
    pages = [Page(i + 1, t) for i, t in enumerate(texts)]
    return LeaseDocument(doc_id, title or path.stem, pages, role, effective_date, sequence)
