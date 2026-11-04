"""Document verification, offline: your agent extracts, FactLot verifies.

The lease, amendment and estoppel below are SYNTHETIC test text written for this example. They
are not real documents and describe no real parties or property.

    pip install "git+https://github.com/9mp96ygnbk-alt/factlot.git#subdirectory=python"
    python3 examples/document_verification.py

In a real run the page text comes from your PDF's text layer (or OCR) and the candidates come
from your model, which reads the pages and returns {predicate, value, quote, page} for each term.
FactLot runs no model: it checks each candidate deterministically and returns cited facts.
"""

import json

import factlot

LEASE = [  # one string per page, as extracted
    "OFFICE LEASE (SYNTHETIC EXAMPLE - NOT A REAL LEASE)\n"
    "This Lease is made by Sample Landlord LLC (“Landlord”) and Example Tenant, Inc. (“Tenant”).\n"
    "1.1 Premises. Suite 400, containing approximately 12,500 rentable square feet.\n"
    "1.2 Term. The Term commences on March 1, 2026 and shall expire on June 30, 2031.",
    "2.1 Security Deposit. Tenant shall deposit the sum of $95,000.00 with Landlord.\n"
    "2.2 Share. Tenant’s Pro-\nportionate Share is 4.25%.",
]
AMENDMENT = [
    "FIRST AMENDMENT TO OFFICE LEASE (SYNTHETIC EXAMPLE - NOT A REAL AMENDMENT)\n"
    "Effective January 15, 2028, the expiration date of the Lease is extended to the thirtieth day of June, 2033."
]

# What a model might return after reading the lease. The last one is a deliberate misread.
lease_candidates = [
    {"predicate": "lease.tenant", "value": "Example Tenant, Inc.", "quote": "and Example Tenant, Inc. (\"Tenant\")", "page": 1},
    {"predicate": "lease.rentable_area_sf", "value": 12500, "quote": "approximately 12,500 rentable square feet", "page": 1},
    {"predicate": "lease.expiration_date", "value": "2031-06-30", "quote": "shall expire on June 30, 2031", "page": 1},
    {"predicate": "lease.pro_rata_share", "value": 0.0425, "quote": "Tenant's Pro- portionate Share is 4.25%", "page": 2},
    {"predicate": "lease.security_deposit", "value": 59000, "quote": "deposit the sum of $95,000.00 with Landlord", "page": 2},
]
amendment_candidates = [
    {"predicate": "lease.expiration_date", "value": "2033-06-30",
     "quote": "the expiration date of the Lease is extended to the thirtieth day of June, 2033", "page": 1},
]

# 1. One document: which values does the text support?
checked = factlot.run_tool("doc_verify_facts", {
    "document": {"pages": LEASE, "title": "Office Lease (synthetic)"},
    "candidates": lease_candidates,
    "as_of": "2026-11-03",
})
print("verified:", [v["fact"]["predicate"] for v in checked["verified"]])
for item in checked["needs_review"]:
    print("needs review:", item["predicate"], "-", item["reason"])

# 2. The lease and its amendment: the current-state abstract, amendment precedence applied, as of a
# day after the amendment takes effect. As of an earlier day the amendment's values would be listed
# under "pending" instead, with a warning, and the lease's values would stay current.
abstract = factlot.run_tool("doc_abstract_lease", {
    "as_of": "2028-02-01",
    "documents": [
        {"role": "original", "title": "Office Lease (synthetic)", "pages": LEASE, "candidates": lease_candidates},
        {"role": "amendment", "title": "First Amendment (synthetic)", "effective_date": "2028-01-15",
         "pages": AMENDMENT, "candidates": amendment_candidates},
    ],
})
for field in abstract["fields"]:
    src = field["source"]
    was = f" (was {', '.join(str(h['value']) for h in field['history'])})" if field["history"] else ""
    print(f"{field['predicate']}: {json.dumps(field['value'])}{was}  [document {src['document']}, page {src['page']}: "
          f"\"{src['quote']}\"]")

# 3. An estoppel certificate's statements (synthetic), mapped to predicates by your agent.
estoppel = [
    {"predicate": "lease.expiration_date", "value": "2033-06-30", "label": "Estoppel para. 2"},
    {"predicate": "lease.rentable_area_sf", "value": 12000, "label": "Estoppel para. 3"},
    {"predicate": "lease.security_deposit", "value": 95000, "label": "Estoppel para. 5"},
]
# Para. 5 comes back not_in_lease: the deposit candidate is waiting for review, so no verified lease
# fact states a deposit yet.
diff = factlot.run_tool("doc_compare", {"lease_facts": abstract["facts"], "asserted": estoppel})
for r in diff["results"]:
    print(f"{r['label']}: {r['status']}" + (f" (lease says {json.dumps(r['lease_value'])})" if r["status"] == "mismatch" else ""))

# 4. One claim against the page it cites.
claim = factlot.run_tool("doc_verify_claim", {
    "document": {"pages": LEASE},
    "claim": {"text": "The deposit is $59,000"},
    "quote": "deposit the sum of $95,000.00 with Landlord",
    "page": 2,
})
print("claim:", claim["status"], "-", claim["reason"])
