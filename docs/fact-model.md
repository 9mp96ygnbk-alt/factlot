# Fact model

The reference implementation is [`@factlot/schema`](../packages/schema). JSON Schema
versions are available from `jsonSchemas()` or from the MCP tool `schema_get`.

A **fact** is one atomic, citable claim about one identified subject:

```json
{
  "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4",
  "predicate": "lease.renewal_option",
  "value": {
    "count": 2,
    "term_months": 60,
    "notice_months": 12,
    "rent": "95% of FMV"
  },
  "as_of": "2026-11-02",
  "provenance": {
    "method": "extracted",
    "sources": [
      {
        "document_id": "fl:document:sha256-…",
        "title": "Second Amendment to Lease",
        "page": 4,
        "section": "§3(b)",
        "quote": "Tenant shall have two (2) options to extend…"
      }
    ],
    "producer": { "name": "factlot-ingest", "version": "0.3.1" },
    "confidence": 0.96
  },
  "rights": { "ai_use": "permitted", "redistribution": "prohibited" },
  "supersedes": ["fact_01jb…"]
}
```

## Rules

1. **No uncited facts.** Every fact must have at least one source, except facts
   whose `method` is `computed` or `inferred`. A computed fact cites its formula
   (`calc.net_effective_rent@1`) and its input fact IDs instead.
2. **Method tells agents when to escalate.** The trust levels, from highest to
   lowest, are `human_verified`, `public_record`, `computed`, `extracted`,
   `reported`, and `inferred`. An agent should send a human anything below its
   threshold.
3. **Rights travel with the data.** `ai_use` and `redistribution` let an agent
   decide mechanically whether it may read a fact, and whether it may put it in a
   client deliverable. In the survey, licensing was a blocker for 35% of agents.
4. **Time is explicit.** `as_of` is required. Facts that change over time, such as
   rent steps or zoning, carry `valid_from` and `valid_to`.
5. **Amendments supersede rather than overwrite.** A fact from an amendment lists
   the IDs of the facts it replaces in `supersedes`. The full history is kept.
6. **Predicates are open.** Predicates are dotted, lowercase snake_case names. Asset
   classes extend the vocabulary without schema changes, for example
   `datacenter.critical_it_mw` or `hotel.keys`. This is deliberate: the survey's
   data center, hotel, medical, and storage personas reject generic office schemas.
