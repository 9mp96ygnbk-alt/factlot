"""Read a PDF into the ``document`` the document tools take, for self-hosted use.

    import factlot
    doc = factlot.read_pdf("lease.pdf", ocr="tesseract")      # a path or the file's bytes
    factlot.run_tool("doc_verify_facts", {"document": doc["document"], "candidates": [...], ...})

The text layer of each page is extracted with pypdf (BSD-3-Clause, an optional dependency:
``pip install 'factlot[pdf]'``). A page with no text layer goes through the pluggable OCR hook of
FactLot Ingest (``factlot.ingest.ocr``: any callable, or a backend name such as "tesseract") and
is listed in ``ocr_pages``, so facts cited to it carry ``ocr: true``. ``document_id`` is the
SHA-256 of the file's bytes, the same ID ``id_document`` gives the file. Nothing is sent anywhere.

The hosted API never reads files: it takes page text. The local MCP server's ``doc_read_pdf`` tool
runs this module (``python -m factlot.pdf``), so both read a PDF the same way.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from os import PathLike
from pathlib import Path
from typing import Any

from .docverify import DOC_LIMITS
from .ingest.documents import pdf_pages, pdf_reader
from .ingest.ocr import OcrBackend, ocr_backend


def read_pdf(source: str | PathLike[str] | bytes, *, ocr: OcrBackend | str | None = None,
             title: str | None = None) -> dict[str, Any]:
    """Read a PDF file (a path, or its bytes) into the document tools' ``document`` input.

    Returns ``{"document": {"pages", "sha256", "title"?, "ocr_pages"?}, "document_id", "pages",
    "ocr_pages", "pages_without_text"}``. ``document`` can be passed as is to doc_verify_facts,
    doc_abstract_lease, doc_verify_claim, doc_spread_statement and fact_package_verify.
    """
    data = bytes(source) if isinstance(source, (bytes, bytearray, memoryview)) else Path(source).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    backend = ocr_backend(ocr) if isinstance(ocr, str) else ocr
    pages = pdf_pages(pdf_reader()(io.BytesIO(data)), backend)
    limit = DOC_LIMITS["pages_per_document"]
    if len(pages) > limit:
        raise ValueError(f"the PDF has {len(pages)} pages; the document tools take at most {limit} per document")
    longest = DOC_LIMITS["characters_per_page"]
    for p in pages:
        if len(p.text) > longest:
            raise ValueError(f"page {p.number} has {len(p.text)} characters of text; the limit is {longest} per page")
    document: dict[str, Any] = {"pages": [p.text for p in pages], "sha256": sha}
    if title is not None:
        document["title"] = title
    ocr_pages = [p.number for p in pages if p.ocr]
    if ocr_pages:
        document["ocr_pages"] = ocr_pages
    return {"document": document, "document_id": f"fl:document:sha256-{sha}", "pages": len(pages),
            "ocr_pages": ocr_pages, "pages_without_text": [p.number for p in pages if not p.text.strip()]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m factlot.pdf", description=(
        "Print a PDF's page text as the JSON document input of the FactLot document tools."))
    parser.add_argument("source", help="the PDF file, or - to read its bytes from standard input")
    parser.add_argument("--ocr", help="OCR backend for pages without a text layer, e.g. tesseract")
    parser.add_argument("--title", help="document title for citations")
    args = parser.parse_args(argv)
    try:
        data = sys.stdin.buffer.read() if args.source == "-" else Path(args.source).read_bytes()
        out: dict[str, Any] = read_pdf(data, ocr=args.ocr, title=args.title)
        code = 0
    except Exception as e:  # reported as data; the caller (the local MCP server) shows it to the agent
        out, code = {"error": type(e).__name__, "message": str(e)}, 1
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
