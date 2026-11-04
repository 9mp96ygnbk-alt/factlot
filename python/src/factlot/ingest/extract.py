"""Extractors turn a lease document into candidate facts, each with a verbatim quote and page.

Extractors may be wrong. Nothing an extractor returns is trusted until the verifier
(`verify.py`) finds its quote on the cited page, checks the value's type, and checks that the
numbers, dates, and names in the value are written in the quote.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from .documents import LeaseDocument

# Predicates the prototype extracts, with the value shape each expects.
PREDICATES: dict[str, str] = {
    "lease.landlord": "string (the landlord's name exactly as written in the document)",
    "lease.tenant": "string (the tenant's name exactly as written in the document)",
    "lease.commencement_date": "date (YYYY-MM-DD)",
    "lease.expiration_date": "date (YYYY-MM-DD)",
    "lease.rentable_area_sf": "number (square feet)",
    "lease.base_rent_schedule": 'array of {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "annual_rent_psf": number}',
    "lease.free_rent": 'object {"months": number, "applies_to": "base_rent" | "gross_rent"}',
    "lease.security_deposit": "number (USD)",
    "lease.pro_rata_share": "number between 0 and 1",
    "lease.cam_cap": 'object {"method": "compounding_from_base" | "simple_from_base" | "year_over_year", "rate": number}',
    "lease.renewal_option": 'object {"count": number, "term_months": number, "notice_months": number, "rent": string}',
    "lease.termination_option": 'object {"effective_date": "YYYY-MM-DD", "notice_months": number, "fee": string}',
    "lease.rofr": ('string (summary of the right of first refusal), or object {"applies_to": "space" | '
                   '"purchase", "description": string (what it covers, as written), "response_days": number '
                   "(optional; days to respond)}"),
    "lease.rofo": ('string (summary of the right of first offer), or object {"applies_to": "space" | '
                   '"purchase", "description": string (what it covers, as written), "response_days": number '
                   "(optional; days to respond)}"),
    "lease.exclusive_use": ('string (the protected use), or object {"protected_use": string (as written), "carve_outs": '
                            'array of strings (optional; exceptions as written), "applies_to": string (optional; where '
                            'it applies, e.g. "the Shopping Center")}'),
    "lease.assignment_sublease": ('string (summary of consent requirements), or object {"consent_standard": "prohibited" | '
                                  '"sole_discretion" | "not_unreasonably_withheld" | '
                                  '"not_unreasonably_withheld_conditioned_or_delayed" | "no_consent_required", '
                                  '"permitted_transfers": string (optional; transfers allowed without consent), '
                                  '"recapture_right": boolean (optional), "profit_share": number between 0 and 1 (optional; '
                                  "Landlord's share of transfer profit)}"),
    "lease.percentage_rent": ('object {"rate": number between 0 and 1, "breakpoint": {"type": "natural" | "fixed", '
                              '"amount": number (annual sales in USD; required when type is fixed)}, '
                              '"sales_exclusions": string (optional summary of sales excluded from gross sales)}'),
    "lease.co_tenancy": ('object {"trigger": string (the co-tenancy condition), "remedy": string (what Tenant may do '
                         'when it fails), "cure_period_months": number (optional), "required_occupancy": number '
                         'between 0 and 1 (optional; share of the center that must be open), "named_tenants": array '
                         'of strings (optional; required co-tenants as written), "remedy_type": "alternate_rent" | '
                         '"termination" | "alternate_rent_then_termination" | "other" (optional)}'),
    "lease.renewal_notice_deadline": "date (YYYY-MM-DD; the last day to exercise a renewal option)",
    "lease.termination_notice_deadline": "date (YYYY-MM-DD; the last day to give notice of early termination)",
    "lease.rent_commencement_date": "date (YYYY-MM-DD; the day rent starts, when it differs from commencement)",
    "lease.expansion_option_deadline": "date (YYYY-MM-DD; the last day to exercise an expansion option)",
    "lease.operating_expense_base_year": "integer (the operating-expense base year, e.g. 2026)",
    "lease.parking": 'object {"spaces": number, "rate_monthly": number (optional, USD per space per month)}',
    "lease.guaranty": ('object {"guarantor": string (the guarantor\'s name exactly as written: the name only, never '
                       'an address), "cap": number (optional, USD)}'),
    "lease.prohibited_uses": "array of strings (each use the lease prohibits, as written)",
    "lease.go_dark": ('object {"operating_covenant": boolean (true when Tenant must keep operating), '
                      '"recapture_right": boolean (optional; Landlord may recapture or terminate if Tenant stops '
                      'operating), "dark_period_days": number (optional; days dark before that right arises)}'),
    "lease.radius_restriction": ('object {"radius_miles": number, "duration": string (optional, e.g. "during the Term"), '
                                 '"remedy": string (optional)}'),
    "lease.relocation_right": ('object {"notice_days": number (optional), "landlord_pays_costs": boolean (optional), '
                               '"tenant_may_terminate": boolean (optional), "replacement_premises": string (optional, e.g. '
                               '"substantially similar size")}, at least one field'),
    "lease.kick_out": ('object {"party": "landlord" | "tenant", "sales_threshold": number (optional; annual gross '
                       'sales in USD), "test_period": string (optional, e.g. "the third Lease Year"), '
                       '"notice_days": number (optional), "effective_date": "YYYY-MM-DD" (optional), "fee": string '
                       "(optional)}"),
}


@dataclass
class Candidate:
    predicate: str
    value: Any
    quote: str  # verbatim supporting text
    page: int
    section: str | None = None
    confidence: float | None = None


class Extractor(Protocol):
    name: str
    version: str

    def extract(self, doc: LeaseDocument) -> list[Candidate]: ...


_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "predicate": {"type": "string", "enum": sorted(PREDICATES)},
                    "value_json": {"type": "string"},
                    "quote": {"type": "string"},
                    "page": {"type": "integer"},
                    "section": {"type": "string"},
                },
                "required": ["predicate", "value_json", "quote", "page", "section"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["facts"],
    "additionalProperties": False,
}

_INSTRUCTIONS = """You extract facts from one commercial lease instrument (an original lease or an amendment).
Return only facts this document itself states. For an amendment, return only the terms it adds or changes.
For each fact give:
- predicate: one of the listed predicates
- value_json: the value as JSON, in the shape listed for that predicate
- quote: an exact, verbatim excerpt from the page (copy characters exactly; no paraphrase, no ellipses)
- page: the page number shown in the [Page N] marker where the quote appears
- section: the section or clause number as written (e.g. "3.1"), or "" if none
Do not compute or infer values the text does not state. If a predicate is absent, omit it.

Predicates and value shapes:
"""


class ClaudeExtractor:
    """Extraction with Claude via structured outputs. Requires `pip install anthropic` and credentials.

    The model is always chosen by the caller.
    """

    name = "factlot.ingest.claude"
    version = "1"

    def __init__(self, model: str, client: Any = None, effort: str | None = None, max_tokens: int = 16000) -> None:
        if client is None:
            import anthropic  # optional dependency

            client = anthropic.Anthropic()
        self.client, self.model, self.effort, self.max_tokens = client, model, effort, max_tokens

    def extract(self, doc: LeaseDocument) -> list[Candidate]:
        listing = "\n".join(f"- {p}: {shape}" for p, shape in PREDICATES.items())
        body = "\n\n".join(f"[Page {p.number}]\n{p.text}" for p in doc.pages)
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": _INSTRUCTIONS + listing,
            "messages": [{"role": "user", "content": f"Document: {doc.title} ({doc.role})\n\n{body}"}],
            "output_config": {"format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA}},
        }
        if self.effort:
            params["output_config"]["effort"] = self.effort
        response = self.client.messages.create(**params)
        if response.stop_reason == "refusal":
            raise RuntimeError(f"extraction refused for {doc.title}")
        if response.stop_reason == "max_tokens":
            raise RuntimeError(f"extraction truncated for {doc.title}; raise max_tokens or split the document")
        text = next(b.text for b in response.content if b.type == "text")
        out = []
        for f in json.loads(text)["facts"]:
            try:
                value = json.loads(f["value_json"])
            except json.JSONDecodeError:
                value = f["value_json"]
            out.append(Candidate(f["predicate"], value, f["quote"], int(f["page"]), f["section"] or None))
        return out
