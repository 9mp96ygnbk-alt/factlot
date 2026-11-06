"""FactLot: the open fact layer for commercial real estate AI agents.

- ``factlot.calc``   deterministic, traceable CRE calculators
- ``factlot.ids``    FactLot ID: canonical IDs for parcels, entities, spaces, documents
- ``factlot.facts``  validate FactLot facts (provenance + rights)
- ``factlot.tools``  every tool as native definitions for Claude, OpenAI, Gemini, Bedrock, and more
- ``factlot.pdf``    read a PDF (text layer, OCR for scanned pages) into the document tools' input
- ``factlot.factpackage``  sign and verify fact packages (Ed25519 with ``factlot[signing]``)
"""

__version__ = "0.3.0"

from ._core import CalcInputError  # noqa: E402
from .calc import (  # noqa: E402
    CALCULATORS,
    amortization_schedule,
    cam_reconciliation,
    cam_reconciliation_batch,
    capex_recovery,
    compare_proposals,
    dcf_pro_forma,
    debt_sizing,
    direct_cap,
    equity_waterfall,
    exchange_1031,
    hotel_metrics,
    irr,
    lease_remeasurement_asc842,
    lease_vs_own,
    multifamily_rent_roll,
    net_effective_rent,
    npv,
    percentage_rent,
    prepayment_and_defeasance,
    renew_vs_relocate,
    rent_schedule,
    tx_unequal_appraisal,
    walt,
)
from .facts import validate_fact  # noqa: E402
from .factpackage import sign_fact_package  # noqa: E402
from .pdf import read_pdf  # noqa: E402
from .rules import RULES, texas_holidays, tx_property_tax_protest_deadline  # noqa: E402
from .rules_drafts import DRAFT_RULES, DRAFT_WARNING, run_draft_rule  # noqa: E402
from .ids import (  # noqa: E402
    FactLotId,
    FactLotIdError,
    building_id,
    document_id,
    entity_id,
    mint,
    normalize_apn,
    normalize_apn_v1,
    normalize_street,
    normalize_suite,
    parcel_id,
    parse,
    short_id,
    space_id,
)
from .tools import (  # noqa: E402
    anthropic_tools,
    bedrock_tool_config,
    gemini_tools,
    openai_responses_tools,
    openai_tools,
    openapi,
    run_tool,
    tool_definitions,
)

__all__ = [
    "CALCULATORS",
    "CalcInputError",
    "DRAFT_RULES",
    "DRAFT_WARNING",
    "RULES",
    "FactLotId",
    "FactLotIdError",
    "amortization_schedule",
    "anthropic_tools",
    "bedrock_tool_config",
    "building_id",
    "cam_reconciliation",
    "cam_reconciliation_batch",
    "capex_recovery",
    "compare_proposals",
    "dcf_pro_forma",
    "debt_sizing",
    "direct_cap",
    "document_id",
    "entity_id",
    "equity_waterfall",
    "exchange_1031",
    "gemini_tools",
    "hotel_metrics",
    "irr",
    "lease_remeasurement_asc842",
    "lease_vs_own",
    "mint",
    "multifamily_rent_roll",
    "net_effective_rent",
    "normalize_apn",
    "normalize_apn_v1",
    "normalize_street",
    "normalize_suite",
    "npv",
    "openai_responses_tools",
    "openai_tools",
    "openapi",
    "parcel_id",
    "parse",
    "percentage_rent",
    "prepayment_and_defeasance",
    "read_pdf",
    "renew_vs_relocate",
    "rent_schedule",
    "run_draft_rule",
    "run_tool",
    "short_id",
    "sign_fact_package",
    "space_id",
    "texas_holidays",
    "tool_definitions",
    "tx_unequal_appraisal",
    "tx_property_tax_protest_deadline",
    "validate_fact",
    "walt",
]
