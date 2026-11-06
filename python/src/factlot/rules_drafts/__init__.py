"""Draft rules packs — Python port of @factlot/calc rules-drafts (held to spec/vectors/rules/drafts).

Drafts are kept apart from the verified packs in ``factlot.rules.RULES`` (which are tools). No named maintainer has
checked them against the official text, so they run only through ``run_draft_rule(name, input,
acknowledge_draft=True)``; every result says ``status: "draft"`` and carries DRAFT_WARNING as its first warning.
"""

from __future__ import annotations

from typing import Any, Callable

from .._core import CalcInputError
from . import boston_berdo, nyc_ll97, tx_evidence_dates, wa_cbps
from ._draft import DRAFT_WARNING

_PACKS: dict[str, tuple[Callable[[Any], dict[str, Any]], dict[str, Any]]] = {
    "nyc_ll97_building_emissions": (nyc_ll97.nyc_ll97_building_emissions, nyc_ll97.META),
    "wa_cbps_eui_target": (wa_cbps.wa_cbps_eui_target, wa_cbps.META),
    "boston_berdo_emissions_standard": (boston_berdo.boston_berdo_emissions_standard, boston_berdo.META),
    "tx_protest_evidence_dates": (tx_evidence_dates.tx_protest_evidence_dates, tx_evidence_dates.META),
}

#: name -> (rule id, version). Names match the TypeScript ``draftRulePacks`` registry. Not tools.
DRAFT_RULES: dict[str, tuple[str, int]] = {name: (meta["id"], meta["version"]) for name, (_, meta) in _PACKS.items()}


def run_draft_rule(name: str, input: Any, *, acknowledge_draft: bool = False) -> dict[str, Any]:
    """Run a draft rules pack. ``acknowledge_draft=True`` states that the caller knows the rule has not been
    verified against the official text. Raises CalcInputError for an unknown pack, a missing acknowledgement, or
    invalid input."""
    if name not in _PACKS:
        raise CalcInputError(f'no draft rules pack named "{name}"', [{"path": "name", "message": "unknown draft rules pack"}])
    if acknowledge_draft is not True:
        raise CalcInputError(
            f'draft rules pack "{name}" has not been verified against the official text; pass acknowledge_draft=True '
            "to run it", [{"path": "acknowledge_draft", "message": "must be true"}])
    return _PACKS[name][0](input)


__all__ = ["DRAFT_RULES", "DRAFT_WARNING", "run_draft_rule"]
