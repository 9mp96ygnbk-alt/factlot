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
    "lease.rofr": "string (summary of the right of first refusal)",
    "lease.rofo": "string (summary of the right of first offer)",
    "lease.exclusive_use": "string (the protected use)",
    "lease.assignment_sublease": "string (summary of consent requirements)",
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
