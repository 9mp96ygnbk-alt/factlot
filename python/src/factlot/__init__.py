"""FactLot: the open fact layer for commercial real estate AI agents.

- ``factlot.calc``   deterministic, traceable CRE calculators
- ``factlot.ids``    FactLot ID: canonical IDs for parcels, entities, spaces, documents
- ``factlot.facts``  validate FactLot facts (provenance + rights)
- ``factlot.tools``  calculators as drop-in tool definitions for agent APIs
"""

__version__ = "0.1.0"

from ._core import CalcInputError  # noqa: E402
from .calc import (  # noqa: E402
    CALCULATORS,
    cam_reconciliation,
    compare_proposals,
    debt_sizing,
    irr,
    net_effective_rent,
    npv,
    percentage_rent,
    rent_schedule,
    walt,
)
from .facts import validate_fact  # noqa: E402
from .ids import (  # noqa: E402
    FactLotId,
    FactLotIdError,
    document_id,
    entity_id,
    mint,
    normalize_suite,
    parcel_id,
    parse,
    short_id,
    space_id,
)
from .tools import anthropic_tools, openai_tools, run_tool, tool_definitions  # noqa: E402

__all__ = [
    "CALCULATORS",
    "CalcInputError",
    "FactLotId",
    "FactLotIdError",
    "anthropic_tools",
    "cam_reconciliation",
    "compare_proposals",
    "debt_sizing",
    "document_id",
    "entity_id",
    "irr",
    "mint",
    "net_effective_rent",
    "normalize_suite",
    "npv",
    "openai_tools",
    "parcel_id",
    "parse",
    "percentage_rent",
    "rent_schedule",
    "run_tool",
    "short_id",
    "space_id",
    "tool_definitions",
    "validate_fact",
    "walt",
]
