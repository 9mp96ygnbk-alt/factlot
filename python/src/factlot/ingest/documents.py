"""Lease documents as cited pages."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..registry.store import file_document_id
from .ocr import OcrBackend, is_image_file


@dataclass(frozen=True)
class Page:
    number: int  # 1-based
    text: str
    ocr: bool = False  # text came from an OCR backend, not the document's text layer


@dataclass
class LeaseDocument:
    """One instrument in a lease file: the original lease or an amendment."""

    document_id: str  # fl:document:sha256-… of the exact file
    title: str
    pages: list[Page]
    role: str = "original"  # original | amendment
    effective_date: str | None = None  # YYYY-MM-DD; orders amendments
    sequence: int = 0  # tie-breaker when dates are equal or missing
    # Free-form notes about the load. ``pages_without_text`` lists (comma-separated, 1-based) the
    # pages that have no readable text: no text layer and no OCR backend, or OCR returned nothing.
    metadata: dict[str, str] = field(default_factory=dict)

    def page(self, number: int) -> Page | None:
        return next((p for p in self.pages if p.number == number), None)


def pdf_reader() -> Any:
    """pypdf's ``PdfReader`` (pypdf is BSD-3-Clause; ``pip install 'factlot[pdf]'``)."""
    try:
        from pypdf import PdfReader  # optional dependency
    except ImportError as e:  # pragma: no cover - environment dependent
        raise RuntimeError("reading PDFs requires pypdf: `pip install 'factlot[pdf]'` (or provide extracted text)") from e
    return PdfReader


def pdf_pages(reader: Any, ocr: OcrBackend | None = None) -> list[Page]:
    """The text layer of each page of a pypdf reader; a page with no text goes through ``ocr``, if
    given, and is marked ``ocr=True``."""
    pages: list[Page] = []
    for i, pdf_page in enumerate(reader.pages):
        text = pdf_page.extract_text() or ""
        if text.strip() or ocr is None:
            pages.append(Page(i + 1, text))
        else:
            pages.append(Page(i + 1, ocr(pdf_page) or "", ocr=True))
    return pages


def load_document(path: str | Path, *, title: str | None = None, role: str = "original",
                  effective_date: str | None = None, sequence: int = 0,
                  ocr: OcrBackend | None = None) -> LeaseDocument:
    """Load a lease instrument. Text files split pages on form feeds; PDFs need pypdf (`factlot[pdf]`);
    image files (.png, .jpg, .tif, ...) are one page each and need an OCR backend.

    ``ocr`` is called for every PDF page whose text layer is empty or whitespace (with the pypdf
    page object) and for every image file (with its ``Path``); see ``factlot.ingest.ocr``. Pages
    that stay unreadable are listed in ``metadata["pages_without_text"]``.
    """
    path = Path(path)
    doc_id, _ = file_document_id(path)
    pages: list[Page] = []
    if path.suffix.lower() == ".pdf":
        pages = pdf_pages(pdf_reader()(str(path)), ocr)
    elif is_image_file(path):
        pages.append(Page(1, ocr(path) or "", ocr=True) if ocr is not None else Page(1, ""))
    else:
        pages = [Page(i + 1, t) for i, t in enumerate(path.read_text("utf-8").split("\f"))]
    doc = LeaseDocument(doc_id, title or path.stem, pages, role, effective_date, sequence)
    blank = [p.number for p in pages if not p.text.strip()]
    if blank:
        doc.metadata["pages_without_text"] = ",".join(str(n) for n in blank)
    return doc


def unreadable_pages_message(doc: LeaseDocument) -> str | None:
    """A one-line explanation for pages that could not be read, or None when every page has text."""
    blank = doc.metadata.get("pages_without_text")
    if not blank:
        return None
    pages = blank.split(",")
    ocr_tried = any(p.ocr for p in doc.pages if str(p.number) in pages)
    what = f"page {pages[0]}" if len(pages) == 1 else f"pages {blank}"
    if ocr_tried:
        return f"{doc.title}: {what} returned no text from OCR; facts on {'it' if len(pages) == 1 else 'them'} cannot be cited"
    return (f"{doc.title}: {what} {'has' if len(pages) == 1 else 'have'} no text layer and no OCR backend was given; "
            f"pass an OCR backend (for example --ocr tesseract) to read scanned pages")
