# Simulated survey: what CRE AI agents need (Nov 2026)

## Read this first

This is a **simulated** survey, not market research. AI subagents role-played 165
distinct AI agents doing commercial real estate work. The personas cover:

- **20 roles**, 8–9 personas each.
- **Firm size:** 51 institutional, 69 mid-market, 45 small.
- **Asset classes:** office, multifamily 5+, industrial, retail, data center,
  medical office, self-storage, hospitality, flex, land, mixed-use.

Each persona walked through its hardest real task, reported where it got stuck,
and scored 18 candidate offerings from 0 to 5. The score meant "likelihood I'd
adopt this as my default provider."

Use the results to rank hypotheses for real interviews. **Do not use them for
market sizing or pricing.** The budgets are invented, and every persona came from
the same model family, so the answers are correlated.

There is one place where the method is more than a guess. The respondents are
LLM agents describing where LLM agents fail: arithmetic, PDFs, citations and
entity joins. Those failure modes are real and can be tested. Test them before
relying on them.

## Files

- `responses.jsonl`: 165 responses, one JSON object per line.
- `aggregate.py`: the scoring script. Run it with `python3 aggregate.py .`
- `results.txt`: the full output of the scoring script.

## Headline results (n = 165)

| Rank | Offering                                    | Mean (0–5) | Share scoring ≥4 | Share scoring ≤1 |
| ---- | ------------------------------------------- | ---------- | ---------------- | ---------------- |
| 1    | I. Turn documents into structured data      | 3.52       | 48%              | 4%               |
| 2    | H. Deterministic CRE calculators            | 3.24       | 42%              | 8%               |
| 3    | A. Canonical IDs and entity resolution      | 3.12       | 37%              | 9%               |
| 4    | Q. Provenance and verification layer        | 2.96       | 30%              | 6%               |
| 5    | N. Property tax, insurance and climate risk | 2.79       | 28%              | 18%              |
| 6    | M. Verified building specs                  | 2.58       | 28%              | 26%              |
| 7    | B. Lease fact layer with citations          | 2.46       | 33%              | 35%              |
| 8    | D. Sales comps                              | 2.35       | 28%              | 35%              |
| 9    | F. Zoning and permits                       | 2.12       | 25%              | 45%              |
| …    | C, E, R, G, J, K, O, L                      | 1.3–2.1    |                  |                  |
| 18   | P. Agent-to-agent negotiation protocol      | 0.35       | 0%               | 93%              |

## Signals

- **The top four options are the most broadly needed.** In the 20 roles:
  - Document ingestion (I) ranked top 3 in 14.
  - Calculators (H) ranked top 3 in 8.
  - Canonical IDs (A) ranked top 3 in 7.

  The pairs most often scored high together were H+I (50 personas), B+I (43)
  and I+Q (36).

- **Free-text mentions were consistent.** Of the 165 personas:
  - 95% mentioned citations or provenance.
  - 52% mentioned PDFs.
  - 51% said the LLM gets the arithmetic wrong.
  - 35% said data licensing forbids using the data with an LLM.

  On licensing: incumbents' data is often already paid for, but the agent can't
  legally read it.

- **Some roles need narrow things intensely.**

  | Role                    | Top scores                 |
  | ----------------------- | -------------------------- |
  | Property tax appeal     | N 4.9, I 4.0, D 3.9        |
  | Development feasibility | F 4.6                      |
  | Lease administration    | I 4.8, B 4.6, Q 4.0, H 4.0 |
  | ESG compliance          | H 4.2, A 4.2               |
  | Appraisal               | D 4.2                      |

- **Some offerings are weak.**
  - Agent-to-agent negotiation (P) and action rails (O) scored near zero.
  - The only actions anyone wanted were writes back into an existing system of
    record (Yardi or MRI work orders, estoppels, appeal filings).
  - An open schema (R) on its own scored 1.98. A standard alone is not a product.
- **Institutional and small firms rank options differently.**
  - Institutional firms put IDs and provenance first (A 3.6, Q 3.5).
  - Small firms put calculators first (H 3.3).
  - Institutions need SOC 2, a private or VPC deployment, and a promise not to
    train on their data.
  - Small firms want per-call pricing under about $300 a month.
- **Recurring dealbreakers:**
  - Training on, or pooling, the customer's leases.
  - Math done by the LLM.
  - Answers without citations.
  - Generic office-only schemas, which drive away data center, hotel, medical
    and storage users.
  - Ambiguous licensing.
  - Per-seat enterprise pricing.
