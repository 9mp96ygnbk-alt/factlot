"""Draft rules packs: shared metadata handling and result shape (mirror of rules-drafts/draft.ts)."""

from __future__ import annotations

import copy
from typing import Any

from .._core import Trace, fail

#: First warning on every draft result.
DRAFT_WARNING = "DRAFT — not verified against the official text; do not rely on it."


def draft_result(t: Trace, meta: dict[str, Any], value: dict[str, Any]) -> dict[str, Any]:
    laws = "; ".join(c["law"] for c in meta["citations"])
    t.warnings.insert(0, f"{DRAFT_WARNING} Rule {meta['id']}@{meta['version']} has not been checked by a named "
                         f"maintainer against {laws}.")
    return t.result(meta["id"], meta["version"], {**value, "status": "draft", "rule": copy.deepcopy(meta)})


def strict(d: dict[str, Any], allowed: tuple[str, ...], path: str = "") -> None:
    """Reject unknown keys and nulls, as the TypeScript strict schemas do."""
    for k, v in d.items():
        p = f"{path}.{k}" if path else k
        if k not in allowed:
            fail(path, f'unrecognized key "{k}"')
        if v is None:
            fail(p, "expected a value, got null")
