"""Optional OCR for scanned pages (pages with no text layer).

An OCR backend is any callable ``ocr(page) -> str``. ``load_document`` calls it with one of:

- a pypdf page object (``PdfReader(...).pages[i]``) for a PDF page whose extracted text is
  empty or whitespace, or
- a ``pathlib.Path`` to an image file (.png, .jpg, .jpeg, .tif, .tiff, .bmp) given directly as a
  document; each image is one page.

The text it returns becomes the page's text and the page is flagged ``ocr=True``, which the
pipeline carries into the fact's source reference so a reader knows the quote came from
recognition, not from the document's own text layer.

The core needs only the standard library. One backend ships here, ``tesseract_ocr``, which shells
out to the ``tesseract`` command-line tool if (and only if) it is installed. It is never imported
or required unless asked for by name.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable, Protocol

OcrBackend = Callable[[Any], str]

_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp")


class _PdfPageLike(Protocol):
    @property
    def images(self) -> Any: ...


class TesseractOcr:
    """OCR through the ``tesseract`` CLI (https://github.com/tesseract-ocr/tesseract).

    For an image path, runs ``tesseract <image> stdout``. For a pypdf page, runs it on each image
    embedded in the page (a scanned page is normally a single full-page image) and joins the
    results. Rasterising vector pages is out of scope: a page with text drawn as outlines but no
    embedded image yields no text.
    """

    name = "tesseract"

    def __init__(self, lang: str | None = None, extra_args: tuple[str, ...] = (), timeout: float = 120.0) -> None:
        binary = shutil.which("tesseract")
        if binary is None:
            raise RuntimeError("OCR backend 'tesseract' needs the tesseract command on PATH "
                               "(for example `brew install tesseract` or `apt install tesseract-ocr`); "
                               "it is not a Python dependency")
        self.binary, self.lang, self.extra_args, self.timeout = binary, lang, tuple(extra_args), timeout

    def _run(self, image: Path) -> str:
        cmd = [self.binary, str(image), "stdout"]
        if self.lang:
            cmd += ["-l", self.lang]
        cmd += list(self.extra_args)
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout, check=False)
        if done.returncode != 0:
            raise RuntimeError(f"tesseract failed on {image.name}: {done.stderr.strip()[:500]}")
        return done.stdout

    def __call__(self, page: Any) -> str:
        if isinstance(page, (str, Path)):
            return self._run(Path(page))
        try:
            images = list(page.images)
        except Exception as e:  # pragma: no cover - depends on the PDF library
            raise RuntimeError(f"cannot read images from the PDF page for OCR: {e}") from e
        texts = []
        with tempfile.TemporaryDirectory(prefix="factlot-ocr-") as tmp:
            for i, image in enumerate(images):
                suffix = Path(getattr(image, "name", "") or "").suffix or ".png"
                path = Path(tmp) / f"image-{i}{suffix}"
                path.write_bytes(image.data)
                texts.append(self._run(path))
        return "\n".join(t for t in texts if t.strip())


def tesseract_ocr(lang: str | None = None, extra_args: tuple[str, ...] = ()) -> TesseractOcr:
    """Build the tesseract backend, or raise ``RuntimeError`` with install instructions."""
    return TesseractOcr(lang=lang, extra_args=extra_args)


OCR_BACKENDS: dict[str, Callable[[], OcrBackend]] = {"tesseract": tesseract_ocr}


def ocr_backend(name: str) -> OcrBackend:
    """Resolve a backend by name (as given to ``--ocr``). Unknown names raise ``ValueError``."""
    try:
        factory = OCR_BACKENDS[name]
    except KeyError:
        raise ValueError(f"unknown OCR backend {name!r}; available: {', '.join(sorted(OCR_BACKENDS))}") from None
    return factory()


def is_image_file(path: Path) -> bool:
    return path.suffix.lower() in _IMAGE_SUFFIXES
