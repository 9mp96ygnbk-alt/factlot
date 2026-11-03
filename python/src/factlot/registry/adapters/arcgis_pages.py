"""Shared helpers for adapters that read archived ArcGIS REST ``query`` pages (``f=json``).

The collector archives each page of a filtered feature-service query as a file named ``query``;
this module finds those files and reads their ``attributes``. It also holds the small text and
number cleaners the adapters share. It carries no source-specific knowledge.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from pathlib import Path

SQFT_PER_ACRE = 43560


def squeeze(s: object) -> str:
    """Collapse whitespace; ``None`` becomes the empty string."""
    return re.sub(r"\s+", " ", str(s) if s is not None else "").strip()


def positive(v: object) -> float | None:
    """Values, areas and years: 0, negative and blank all mean 'the publisher has no figure'."""
    try:
        x = float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return x if x and x > 0 else None


def zip_text(z: str) -> str:
    digits = re.sub(r"\D", "", z)
    return f"{digits[:5]}-{digits[5:]}" if len(digits) == 9 else z


def pages(path: str | Path | Iterable[str | Path]) -> list[Path]:
    """The archived JSON page files: a file, a list of files, or a collector directory (searched
    recursively for files named ``query`` and for ``*.json`` other than ``discovered.json``)."""
    paths = [Path(path)] if isinstance(path, (str, Path)) else [Path(p) for p in path]
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out += sorted(f for f in p.rglob("*")
                          if f.is_file() and (f.name == "query" or (f.suffix == ".json" and f.name != "discovered.json")))
        else:
            out.append(p)
    return out


def features(page: str | Path) -> Iterator[dict]:
    """The ``attributes`` of every feature in one page (a bare feature dict is returned as is)."""
    with open(page, encoding="utf-8") as f:
        doc = json.load(f)
    for feat in doc.get("features", []):
        yield feat.get("attributes", feat)
