"""Word matching for the vocabularies (packages/tools/src/words.ts is the same code): a text
becomes words, and keyword phrases are found in those words. ASCII only after normalization, so
both languages read the same words."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

_WORD = re.compile(r"[a-z0-9]+")


def stem(word: str) -> str:
    """Simple plural folding: "bakeries" -> "bakery", "taxes" -> "tax", "drinks" -> "drink"."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("sses", "shes", "ches", "xes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def words(text: str) -> list[str]:
    """The words of a text: Unicode NFKD with combining marks removed, lower case, each run of ASCII
    letters and digits one word, plurals folded. "Café & Bakeries" -> ["cafe", "bakery"]."""
    t = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.category(c).startswith("M"))
    return [stem(w) for w in _WORD.findall(t.lower())]


class KeywordIndex:
    """Keyword phrases by key (a category), found as whole words in a text's words."""

    def __init__(self, entries: Iterable[tuple[str, Iterable[str]]]) -> None:
        self._by_first: dict[str, list[tuple[str, str, list[str]]]] = {}
        for key, keywords in entries:
            for keyword in keywords:
                w = words(keyword)
                if w:
                    self._by_first.setdefault(w[0], []).append((key, keyword, w))

    def find(self, text: list[str]) -> list[dict[str, Any]]:
        """Every keyword found in the words, except one lying inside a longer match: in "juice bar",
        "bar" is dropped for "juice bar". Ordered by position, then by length (longest first)."""
        found = []
        for i, w in enumerate(text):
            for key, keyword, kw in self._by_first.get(w, ()):
                if i + len(kw) <= len(text) and text[i:i + len(kw)] == kw:
                    found.append({"key": key, "keyword": keyword, "start": i, "end": i + len(kw)})
        kept = [a for a in found
                if not any(b["start"] <= a["start"] and a["end"] <= b["end"]
                           and b["end"] - b["start"] > a["end"] - a["start"] for b in found)]
        return sorted(kept, key=lambda m: (m["start"], -(m["end"] - m["start"])))
