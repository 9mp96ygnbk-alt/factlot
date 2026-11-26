"""Random synthetic documents, candidates, claims and facts for the TypeScript/Python differential
test of the document tools and fact_validate. Every document is synthetic text built here.

Values are written in the forms the verifier reads (and some it does not), quotes are copied with
the kinds of drift an agent introduces (case, whitespace, line breaks, typographic quotes, a
rejoined hyphenated word, a wrong page), and the text carries Unicode that tends to split the
two languages apart (NFKC compatibility characters, combining marks, astral characters, final
sigma, soft hyphens, Python-only whitespace).
"""

import random

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
       "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
       "twentieth"]
WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
         "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
NAMES = ["Sample Landlord LLC", "Example Tenant, Inc.", "Placeholder Holdings LP", "Test Realty Trust",
         "Café Synthétique SARL", "ΟΔΟΣ Properties AE", "Fixture Partners “West” LLC"]
NOISE = [" ", "ﬁ", "１２", "é", "\U0001f3e2", "­", "\x1c", "\x85", "—", "’",
         "½", " ", "﻿", "İ", "Σ"]


def number_word(n):
    if n < 20:
        return WORDS[n]
    return TENS[n // 10] + ("-" + WORDS[n % 10] if n % 10 else "")


def ordinal_word(d):
    if d <= 20:
        return ORD[d - 1]
    if d == 30:
        return "thirtieth"
    return f"{TENS[d // 10]}-{ORD[d % 10 - 1]}" if d % 10 else None


def write_date(r, y, m, d):
    forms = [f"{MONTHS[m-1]} {d}, {y}", f"{MONTHS[m-1][:3]}. {d}, {y}", f"{m}/{d}/{y}", f"{d} {MONTHS[m-1]} {y}",
             f"{y}-{m:02d}-{d:02d}", f"{d}.{m}.{y}", f"the {d}th day of {MONTHS[m-1]}, {y}", f"{MONTHS[m-1]} {d}, '{y % 100:02d}"]
    ow = ordinal_word(d)
    if ow:
        forms.append(f"the {ow} day of {MONTHS[m-1]}, {y}")
    return r.choice(forms)


def write_number(r, n, money=False):
    whole = int(n) == n
    forms = [f"{n:,.2f}", f"{n:.2f}", f"{n:,}" if whole else f"{n}", f"{int(n)}" if whole else f"{n}"]
    if whole and 0 <= n < 100:
        forms.append(f"{number_word(int(n))} ({int(n)})")
    s = r.choice(forms)
    return ("$" + s) if money and r.random() < 0.7 else s


def rand_date(r):
    y, m = r.randint(2024, 2040), r.randint(1, 12)
    d = r.choice([1, 15, 28, r.randint(1, 28), 30 if m != 2 else 28, 29 if m == 2 and y % 4 == 0 else 28])
    return y, m, d


def iso(y, m, d):
    return f"{y:04d}-{m:02d}-{d:02d}"


def clauses(r):
    """(predicate, value, text, quote) for one random clause; quote is the part that states the value."""
    kind = r.randrange(11)
    if kind == 0:
        y, m, d = rand_date(r)
        q = f"shall expire on {write_date(r, y, m, d)}"
        return "lease.expiration_date", iso(y, m, d), f"The Term {q}, unless sooner terminated.", q
    if kind == 1:
        y, m, d = rand_date(r)
        q = f"shall commence on {write_date(r, y, m, d)}"
        return "lease.commencement_date", iso(y, m, d), f"The Term {q}.", q
    if kind == 2:
        n = r.choice([r.randint(500, 250000), round(r.uniform(500, 90000), 2)])
        q = f"approximately {write_number(r, n)} rentable square feet"
        return "lease.rentable_area_sf", n, f"The Premises contain {q}.", q
    if kind == 3:
        n = r.choice([r.randint(1, 3000) * 1000, round(r.uniform(1000, 2e6), 2)])
        q = f"a security deposit of {write_number(r, n, money=True)}"
        return "lease.security_deposit", n, f"Tenant shall pay {q} on signing.", q
    if kind == 4:
        pct = r.choice([round(r.uniform(0.1, 60), 2), r.randint(1, 50)])
        share = round(pct / 100, 6)
        written = r.choice([f"{pct}%", f"{pct} percent", f"{pct}"]) if r.random() < 0.85 else f"{share}"
        q = f"Proportionate Share is {written}"
        return "lease.pro_rata_share", share, f"Tenant's Pro-\nportionate Share and {q}.", q
    if kind == 5:
        rate = r.randint(1, 9)
        q = f"not increase by more than {number_word(rate)} percent ({rate}%) per year"
        return "lease.cam_cap", {"method": r.choice(["compounding_from_base", "simple_from_base", "year_over_year"]),
                                 "rate": rate / 100}, f"Controllable expenses shall {q}.", q
    if kind == 6:
        name = r.choice(NAMES)
        q = f"and {name} (“Tenant”)"
        return "lease.tenant", name, f"This Lease is made by Sample Landlord LLC {q}.", q
    if kind == 7:
        c, t, n = r.randint(1, 4), r.choice([12, 24, 36, 60, 120]), r.randint(3, 18)
        q = (f"{number_word(c)} ({c}) option{'s' if c > 1 else ''} to extend for {write_number(r, t)} months on "
             f"{number_word(n)} ({n}) months' notice")
        return "lease.renewal_option", {"count": c, "term_months": t, "notice_months": n, "rent": "fair market rent"}, \
            f"Tenant has {q} at fair market rent.", q
    if kind == 8:
        steps, y = [], r.randint(2025, 2032)
        rent = round(r.uniform(10, 90), 2)
        text = []
        for _ in range(r.randint(1, 3)):
            a, b = iso(y, 3, 1), iso(y + 1, 2, 28 if (y + 1) % 4 else 29)
            steps.append({"from": a, "to": b, "annual_rent_psf": rent})
            text.append(f"from {write_date(r, y, 3, 1)} through {write_date(r, y + 1, 2, 28 if (y + 1) % 4 else 29)} at "
                        f"{write_number(r, rent, money=True)} per square foot")
            y, rent = y + 1, round(rent * 1.03, 2)
        q = "Base Rent is " + "; ".join(text)
        return "lease.base_rent_schedule", steps, q + ".", q
    if kind == 9:
        days = r.randint(1, 120)
        q = f"effective {write_number(r, days)} days after mailing"
        return r.choice(["lease.notice_effective_days", "lease.notice_days"]), days, f"Notices are {q}.", q
    y, m, d = rand_date(r)
    pct = r.randint(1, 6)
    q = f"rent rises {pct}% each year from {write_date(r, y, m, d)}"
    return "lease.escalation", {"rate": pct / 100, "starts": iso(y, m, d), "note": "synthetic"}, f"Base {q}.", q


def noisy(r, text):
    out = []
    for word in text.split(" "):
        out.append(word)
        if r.random() < 0.05:
            out.append(r.choice(NOISE))
    sep = [r.choice([" ", " ", " ", "\n", "  ", " ", "\t"]) for _ in out]
    return "".join(w + s for w, s in zip(out, sep)).rstrip()


def drift(r, quote):
    """A quote as an agent might copy it."""
    k = r.random()
    if k < 0.45:
        return quote
    if k < 0.55:
        return quote.upper()
    if k < 0.65:
        return "  " + quote.replace(" ", "\n", 1) + " "
    if k < 0.72:
        return quote.replace("'", "’").replace("“", '"').replace("”", '"')
    if k < 0.78:
        return quote[: max(3, len(quote) // 2)]
    if k < 0.82:
        return quote[:8]
    if k < 0.88:
        return quote + " and more"
    if k < 0.94:
        return quote.replace("Pro-\nportionate", "Proportionate")
    return quote.replace(" ", "  ")


def perturb(r, value):
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return r.choice([value * 10, value + 1, round(value / 100, 6), -value, 0, str(value)])
    if isinstance(value, str):
        if len(value) == 10 and value[4] == "-":
            return r.choice([value[:3] + str((int(value[3]) + 2) % 10) + value[4:], value[:8] + "31", "June 30, 2031"])
        return value + " Ltd"
    if isinstance(value, list):
        return [perturb(r, value[0])] + value[1:] if value else value
    k = r.choice(list(value))
    return {**value, k: perturb(r, value[k])}


def document(r):
    """A synthetic lease of 1-4 pages: (pages, statements)."""
    statements, pages = [], []
    for _ in range(r.randint(1, 4)):
        lines = ["SYNTHETIC TEST DOCUMENT - NOT A REAL LEASE"]
        for _ in range(r.randint(1, 5)):
            pred, value, text, quote = clauses(r)
            lines.append(noisy(r, text) if r.random() < 0.5 else text)
            statements.append((pred, value, quote, len(pages) + 1))
        pages.append("\n".join(lines))
    if r.random() < 0.15:
        pages.append(pages[0])  # a page repeated: quotes that appear on several pages
    return pages, statements


def candidates(r, statements, pages):
    out = []
    for pred, value, quote, page in statements:
        c = {"predicate": pred, "value": value, "quote": drift(r, quote), "page": page}
        k = r.random()
        if k < 0.25:
            c["value"] = perturb(r, value)
        elif k < 0.32:
            c["page"] = r.randint(1, len(pages) + 1)
        elif k < 0.36:
            c["predicate"] = r.choice(["lease.expiry_date", "lease.rentable_sf", "Lease.Bad", "debt.rate"])
        if r.random() < 0.2:
            c["confidence"] = round(r.random(), 2)
        if r.random() < 0.2:
            c["section"] = f"{r.randint(1, 20)}.{r.randint(1, 9)}"
        out.append(c)
    r.shuffle(out)
    return out


def fact_case(r, statements, doc_id):
    """A FactLot fact, valid or broken in one of the ways reviewers broke them."""
    pred, value, quote, page = r.choice(statements)
    src = {"document_id": doc_id, "page": page, "quote": quote}
    prov = {"method": "extracted", "sources": [src]}
    fact = {"subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "predicate": pred, "value": value, "as_of": "2026-11-03",
            "provenance": prov}
    for _ in range(r.choice([0, 0, 1, 1, 2, 3])):
        k = r.randrange(16)
        if k == 0:
            fact["value"] = perturb(r, value)
        elif k == 1:
            fact[r.choice(["units", "extra", "1", "Value"])] = 1
        elif k == 2:
            src[r.choice(["pg", "doc", "text"])] = "x"
        elif k == 3:
            fact["valid_from"], fact["valid_to"] = r.choice([("2031-01-01", "2030-12-31"), ("2030-01-01", "2031-01-01"),
                                                             ("2030-02-30", "2020-01-01"), ("0000-01-01", "0000-01-02")])
        elif k == 4:
            prov["method"] = r.choice(["inferred", "computed", "reported", "public_record", "guessed"])
            if r.random() < 0.6:
                prov["sources"] = []
            if r.random() < 0.4:
                prov["formula"] = "calc.ner@1"
        elif k == 5:
            src["span"] = r.choice([{"start": 5, "end": 2}, {"start": 0, "end": 10}, {"start": -1, "end": 3},
                                    {"start": 1.5, "end": 3}, {"start": 2**53, "end": 0}, {"start": 1}])
        elif k == 6:
            fact[r.choice(["subject", "predicate", "as_of", "value"])] = r.choice([5, None, "bad", "fl:x:y\n", [], {}])
        elif k == 7:
            fact.pop(r.choice(["subject", "predicate", "as_of", "value", "provenance"]), None)
        elif k == 8:
            src["page"] = r.choice([0, -1, 1.5, "2", 2**53, True])
        elif k == 9:
            prov["confidence"] = r.choice([-0.1, 1.5, "high", 0.5, None])
        elif k == 10:
            fact["rights"] = r.choice([{"ai_use": "permitted", "redistribution": "prohibited"}, {"ai_use": "maybe"},
                                       {"ai_use": "unknown", "redistribution": "unknown", "foo": 1}, "none"])
        elif k == 11:
            src["uri"] = r.choice(["https://example.com/lease.pdf", "not a url", "http://", "urn:isbn:1", "mailto:x",
                                   "http://a b", "https://example.com:99999"])
        elif k == 12:
            src["sha256"] = r.choice(["a" * 64, "A" * 64, "abc"])
            src["retrieved_at"] = r.choice(["2026-11-03T10:00:00Z", "2026-11-03", "2026-11-03T10:00:00+05:30"])
        elif k == 13:
            prov["producer"] = r.choice([{"name": "x", "version": "1"}, {"name": "x"}, {"name": 1, "version": "1", "z": 0}])
        elif k == 14:
            fact["supersedes"] = r.choice([["flf_a"], [1], "flf_a"])
        else:
            src["quote"] = r.choice(["", "no number here at all", quote.upper(), quote[: len(quote) // 2]])
    return {"tool": "fact_validate", "arguments": {"fact": fact}}


def claim_case(r, pages, statements):
    pred, value, quote, page = r.choice(statements)
    k = r.random()
    if k < 0.55:
        claim = {"predicate": pred, "value": value if r.random() < 0.5 else perturb(r, value)}
    elif k < 0.9:
        claim = {"text": r.choice([f"The {pred.split('.')[1].replace('_', ' ')} is {value}",
                                   f"It says {r.randint(1, 99)} days from {MONTHS[r.randint(0, 11)]} {r.randint(1, 28)}, {r.randint(2025, 2040)}",
                                   "No numbers in this claim at all", quote, quote.upper().replace("FIVE", "6")])}
        if len(claim["text"]) % 3 == 0:  # a bare sentence string is read as {text}
            claim = claim["text"]
    else:
        claim = r.choice([{"predicate": pred}, {"predicate": pred, "value": value, "text": "both"}, {}])
    return {"tool": "doc_verify_claim", "arguments": {"document": {"pages": pages}, "claim": claim,
                                                       "quote": drift(r, quote), "page": page}}


def abstract_case(r):
    docs = []
    n = r.randint(1, 4)
    for i in range(n):
        pages, statements = document(r)
        d = {"pages": pages, "candidates": candidates(r, statements, pages)[: r.randint(1, 8)]}
        if i > 0 and r.random() < 0.8:
            y, m, dd = rand_date(r)
            d["effective_date"] = iso(y, m, dd)
        if r.random() < 0.3:
            d["role"] = r.choice(["original", "amendment"])
        if r.random() < 0.3:
            d["title"] = f"Synthetic instrument {i}"
        docs.append(d)
    r.shuffle(docs)
    args = {"as_of": "2026-11-03", "documents": docs}
    if r.random() < 0.5:
        args["subject"] = "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4"
    return {"tool": "doc_abstract_lease", "arguments": args}


def compare_case(r, statements, doc_id):
    facts, asserted = [], []
    for i, (pred, value, quote, page) in enumerate(statements):
        if pred.startswith("Lease"):
            continue
        facts.append({"id": f"flf_{i}", "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "predicate": pred,
                      "value": value, "as_of": "2026-11-03",
                      "provenance": {"method": "extracted", "sources": [{"document_id": doc_id, "page": page, "quote": quote}]}})
        if i and r.random() < 0.3:
            facts[-1]["supersedes"] = [f"flf_{r.randrange(i)}"]
        asserted.append({"predicate": pred, "value": value if r.random() < 0.5 else perturb(r, value)})
        if isinstance(value, dict) and r.random() < 0.5:
            key = r.choice(list(value))
            asserted[-1] = {"predicate": pred, "value": {key: value[key]}, "label": "partial"}
    asserted.append({"predicate": "lease.not_in_this_lease", "value": 1})
    return {"tool": "doc_compare", "arguments": {"lease_facts": facts, "asserted": asserted}}


def doc_cases(seed, count):
    r = random.Random(f"docs-{seed}")
    out = []
    for _ in range(count):
        pages, statements = document(r)
        doc = {"pages": pages}
        if r.random() < 0.2:
            doc["sha256"] = "%064x" % r.getrandbits(256)
        if r.random() < 0.3:
            doc["title"] = "Synthetic lease"
        doc_id = "fl:document:sha256-" + ("%064x" % r.getrandbits(256))
        k = r.random()
        if k < 0.4:
            out.append({"tool": "doc_verify_facts", "arguments": {"document": doc, "as_of": "2026-11-03",
                                                                  "candidates": candidates(r, statements, pages)}})
        elif k < 0.6:
            out.append(fact_case(r, statements, doc_id))
        elif k < 0.8:
            out.append(claim_case(r, pages, statements))
        elif k < 0.9:
            out.append(abstract_case(r))
        else:
            out.append(compare_case(r, statements, doc_id))
    return out


# --- round 2: clause predicates, statement spreading, use conflicts, fact packages ----------------
# Their own random stream, so the cases above stay as they were.

CLAUSE_TEXT = [
    ("lease.exclusive_use", {"protected_use": "the sale of coffee and espresso", "carve_outs": ["a restaurant may sell coffee with meals", "incidental sales in up to 10% of floor area"]},
     "the exclusive right to the sale of coffee and espresso, except a restaurant may sell coffee with meals and incidental sales in up to 10% of floor area"),
    ("lease.prohibited_uses", ["a bar or tavern", "a bowling alley with 12 lanes", "a massage parlor"],
     "no part shall be used for a bar or tavern, a bowling alley with 12 lanes, or a massage parlor"),
    ("lease.co_tenancy", {"trigger": "less than 70% open", "remedy": "half rent", "cure_period_months": 12, "required_occupancy": 0.7,
                          "named_tenants": ["Anchor Grocer, Inc."], "remedy_type": "alternate_rent"},
     "if less than 70% of the GLA is open or Anchor Grocer, Inc. goes dark, Tenant pays half rent for up to twelve (12) months"),
    ("lease.go_dark", {"operating_covenant": True, "recapture_right": True, "dark_period_days": 180},
     "Tenant shall operate; if dark for more than 180 days Landlord may recapture"),
    ("lease.radius_restriction", {"radius_miles": 3, "duration": "during the Term"}, "within three (3) miles during the Term"),
    ("lease.relocation_right", {"notice_days": 90, "landlord_pays_costs": True}, "relocate Tenant on 90 days' notice at Landlord's cost"),
    ("lease.kick_out", {"party": "tenant", "sales_threshold": 600000, "notice_days": 120, "effective_date": "2029-02-28"},
     "if Gross Sales are below $600,000.00 Tenant may terminate on 120 days' notice effective February 28, 2029"),
    ("lease.assignment_sublease", {"consent_standard": "not_unreasonably_withheld_conditioned_or_delayed", "profit_share": 0.5},
     "consent shall not be unreasonably withheld, conditioned or delayed; Landlord receives 50% of profit"),
    ("lease.assignment_sublease", {"consent_standard": "sole_discretion"}, "consent in Landlord's sole and absolute discretion"),
    ("lease.rofr", {"applies_to": "space", "description": "the adjacent Suite 105", "response_days": 10},
     "a right of first refusal on the adjacent Suite 105 within ten (10) business days"),
    ("lease.rofo", "a right of first offer on the 5th floor", "a right of first offer on any space on the 5th floor"),
]


def clause_perturb(r, value):
    if isinstance(value, dict):
        k = r.choice(list(value))
        v = value[k]
        if k == "consent_standard":
            return {**value, k: r.choice(["prohibited", "sole_discretion", "not_unreasonably_withheld", "bogus"])}
        if k == "carve_outs":
            return {**value, k: [v[0], v[1].replace("10%", f"{r.randint(1, 30)}%")]}
        if isinstance(v, str):
            return {**value, k: r.choice([v + " 7", "", v.upper()])}
        if isinstance(v, bool):
            return {**value, k: r.choice([not v, "yes", None])}
        if isinstance(v, list):
            return {**value, k: r.choice([[], ["Other Tenant LLC"], v + [5]])}
        return {**value, k: perturb(r, v)}
    if isinstance(value, list):
        return r.choice([[], value + [""], [value[0] + " 99"], value])
    return perturb(r, value)


def clause_case(r):
    pages, cands = [], []
    for _ in range(r.randint(1, 3)):
        lines = ["SYNTHETIC TEST DOCUMENT - NOT A REAL LEASE"]
        for pred, value, quote in r.sample(CLAUSE_TEXT, r.randint(1, 4)):
            lines.append(noisy(r, quote) if r.random() < 0.3 else quote)
            c = {"predicate": pred, "value": value if r.random() < 0.6 else clause_perturb(r, value),
                 "quote": drift(r, quote), "page": len(pages) + 1}
            cands.append(c)
        pages.append("\n".join(lines))
    r.shuffle(cands)
    doc = {"pages": pages}
    if r.random() < 0.3:
        doc["ocr_pages"] = sorted(r.sample(range(1, len(pages) + 1), r.randint(1, len(pages))))
    return {"tool": "doc_verify_facts", "arguments": {"document": doc, "as_of": "2026-11-04", "candidates": cands}}


STATEMENT_LABELS = {
    "multifamily": ["Gross Potential Rent", "Loss to Lease", "Vacancy Loss", "Concessions", "Bad Debt", "RUBS Income",
                    "Parking", "Late Fees", "Other Income", "Real Estate Taxes", "Insurance", "Electric", "Water & Sewer",
                    "R&M", "Make Ready", "Landscaping", "Payroll", "Management Fee", "G&A", "Marketing",
                    "Replacement Reserves", "Debt Service", "Café Revenue", "Pool Service", "Parking Lot Repairs"],
    "commercial": ["Base Rent", "Percentage Rent", "CAM Recoveries", "Tax Reimbursement", "Parking Income", "Vacancy",
                   "Free Rent", "Credit Loss", "Real Estate Taxes", "Insurance", "Utilities", "Janitorial", "Security",
                   "Common Area Maintenance", "Ground Rent", "Management Fees", "Tenant Improvements",
                   "Leasing Commissions", "Depreciation", "Misc. Adjustments"],
    "hotel": ["Rooms", "Food and Beverage", "Other Operated Departments", "Miscellaneous Income", "A&G",
              "Information and Telecommunications Systems", "Sales and Marketing", "Property Operation and Maintenance",
              "Utilities", "Management Fees", "Property and Other Taxes", "Insurance", "Rent", "Replacement Reserve",
              "Non-Operating Income"],
}
TOTAL_LABELS = {
    "multifamily": ["Effective Gross Income", "Total Operating Expenses", "Net Operating Income", "Net Cash Flow"],
    "commercial": ["Total Revenue", "Total Expenses", "NOI", "Total Capital"],
    "hotel": ["Total Operating Revenue", "Total Departmental Expenses", "Gross Operating Profit", "EBITDA",
              "EBITDA less Replacement Reserve"],
}
CATEGORY_GUESSES = ["real_estate_taxes", "utilities", "repairs_maintenance", "vacancy_loss", "rooms_revenue",
                    "rooms_expense", "net_operating_income", "ebitda", "base_rent", "bogus_category", "occupancy_rate"]


def write_amount(r, n, negative):
    s = r.choice([f"{n:,.0f}" if n == int(n) else f"{n:,.2f}", f"{n:.2f}", f"${n:,.2f}", f"{int(n)}" if n == int(n) else f"{n}"])
    if negative:
        s = r.choice([f"({s})", f"-{s}", f"( {s} )", f"$-{s.lstrip('$')}"])
    return s


def statement_case(r):
    kind = r.choice(["multifamily", "commercial", "hotel"])
    periods = r.choice([[None], ["2024", "2025"], ["T-12"]])
    rows, lines = [], []
    for label in r.sample(STATEMENT_LABELS[kind], r.randint(3, 10)) + r.sample(TOTAL_LABELS[kind], r.randint(0, 3)):
        for period in periods:
            n = r.choice([r.randint(1, 900) * 1000, round(r.uniform(100, 99999), 2), r.randint(1, 99)])
            negative = r.random() < 0.2
            written = write_amount(r, n, negative)
            text = f"{label}{' ' + period if period else ''} {written}"
            rows.append(text)
            line = {"label": label, "amount": -n if negative and r.random() < 0.5 else n, "quote": text, "page": 1}
            if period:
                line["period"] = period
            k = r.random()
            if k < 0.15:
                line["category"] = r.choice(CATEGORY_GUESSES)
            elif k < 0.2:
                line["amount"] = n + 1
            elif k < 0.25:
                line["quote"] = text.replace(label, label.upper()) if r.random() < 0.5 else text[:6]
            lines.append(line)
    if lines and r.random() < 0.4:
        i = r.randrange(len(lines))
        others = [j for j in range(len(lines)) if j != i]
        lines[i]["sums"] = r.sample(others, min(len(others), r.randint(1, 3)))
        if r.random() < 0.1:
            lines[i]["sums"].append(len(lines) + 5)
    page = "SYNTHETIC TEST DOCUMENT - NOT A REAL PROPERTY\n" + "\n".join(rows)
    args = {"document": {"pages": [noisy(r, page) if r.random() < 0.2 else page]}, "property_type": kind, "lines": lines}
    if r.random() < 0.3:
        args["tolerance"] = r.choice([0, 1, 1000, 0.5])
    if r.random() < 0.2:
        args["period"] = "Default period"
    return {"tool": "doc_spread_statement", "arguments": args}


USE_WORDS = ["coffee", "espresso bar", "juice bar", "pizza", "Café", "bakeries", "wine bar", "sushi", "nail salon",
             "fitness studio", "pharmacy", "kites", "dry cleaning", "pet grooming", "full-service restaurant",
             "bowling alley", "massage", "pawn shop", "bar or tavern", "grocery store", "the sale of", "incidental",
             "medical clinic", "tattoo", "cell phone accessories", "theater"]


def use_text(r, n):
    return " ".join(r.choice(USE_WORDS) for _ in range(n))


def use_conflict_case(r):
    facts = []
    for i in range(r.randint(1, 6)):
        sub = f"fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b{i % 10}"
        if r.random() < 0.5:
            protected = use_text(r, r.randint(1, 3))
            value = protected if r.random() < 0.3 else {"protected_use": protected, **(
                {"carve_outs": [use_text(r, r.randint(1, 3)) for _ in range(r.randint(1, 3))]} if r.random() < 0.6 else {})}
            pred, quote = "lease.exclusive_use", f"exclusive right: {protected}"
        else:
            value = [use_text(r, r.randint(1, 2)) for _ in range(r.randint(1, 4))]
            pred, quote = "lease.prohibited_uses", "prohibited: " + ", ".join(value)
        fact = {"id": f"flf_u{i}", "subject": sub, "predicate": pred, "value": value, "as_of": "2026-11-04",
                "provenance": {"method": "extracted", "sources": [{"document_id": "fl:document:sha256-" + "e" * 64,
                                                                   "page": r.randint(1, 9), "quote": quote}]}}
        if i and r.random() < 0.2:
            fact["supersedes"] = [f"flf_u{r.randrange(i)}"]
        facts.append(fact)
    use = {"text": use_text(r, r.randint(1, 4))}
    if r.random() < 0.3:
        use["naics"] = r.choice(["72", "7225", "722515", "445", "812112", "99", "713950"])
    if r.random() < 0.2:
        use["category"] = r.choice(["coffee", "pizza", "bar_nightclub", "cofee"])
    return {"tool": "doc_check_use_conflict", "arguments": {"facts": facts, "proposed_use": use}}


def package_case(r):
    pages, statements = document(r)
    doc_sha = "%064x" % r.getrandbits(256)
    doc_id = "fl:document:sha256-" + doc_sha
    facts = []
    for i, (pred, value, quote, page) in enumerate(statements):
        if pred.startswith("Lease"):
            continue
        facts.append({"id": f"flf_p{i}", "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "predicate": pred, "value": value,
                      "as_of": "2026-11-04", "provenance": {"method": "extracted", "sources": [
                          {"document_id": doc_id, "page": page, "quote": quote, **({"title": "Synthetic"} if r.random() < 0.5 else {})}]}})
    from factlot.docverify import validate_fact_full  # the generator runs next to the Python SDK

    if r.random() < 0.85:  # mostly facts that pass fact_validate, so most packages get made
        facts = [f for f in facts if validate_fact_full(f)["valid"]]
    if not facts:
        return package_case(r)
    args = {"facts": facts}
    for k, v in (("title", "Synthetic ünïcode package \U0001f3e2"), ("created_at", "2026-11-04T09:00:00+01:00"), ("created_by", "Example LP")):
        if r.random() < 0.4:
            args[k] = v
    if r.random() < 0.5:
        return {"tool": "fact_package_create", "arguments": args}
    from factlot.tools import run_tool  # the generator runs next to the Python SDK (run_py.py adds it to the path)

    made = run_tool("fact_package_create", args)
    if "package" not in made:
        return {"tool": "fact_package_create", "arguments": args}
    pkg = made["package"]
    k = r.random()
    if k < 0.2:
        pkg["facts"][0]["value"] = perturb(r, pkg["facts"][0]["value"])
    elif k < 0.3:
        pkg["integrity"]["leaf_hashes"] = pkg["integrity"]["leaf_hashes"][:-1]
    elif k < 0.4:
        pkg["documents"] = []
    elif k < 0.75 and HAVE_SIGNING:
        from factlot.factpackage import sign_fact_package

        signed = sign_fact_package(made["package"], r.getrandbits(256).to_bytes(32, "big"), key_id="test")
        if r.random() < 0.3:
            signed["facts"][-1]["as_of"] = "2026-11-05"
        verify = {"package": signed}
        if r.random() < 0.7:
            verify["public_key"] = signed["signature"]["public_key"] if r.random() < 0.8 else "A" * 43
        return {"tool": "fact_package_verify", "arguments": verify}
    elif k < 0.5:
        pkg["signature"] = r.choice([{"algorithm": "Ed25519", "public_key": "A" * 43, "value": "B" * 85},
                                     {"algorithm": "RSA"}, None, {"algorithm": "Ed25519", "public_key": "x", "value": "y"}])
    verify = {"package": pkg}
    if r.random() < 0.4:
        verify["public_key"] = r.choice(["A" * 43, "not a key", "C" * 43])
    if r.random() < 0.6:
        verify["documents"] = [{"pages": pages if r.random() < 0.8 else list(reversed(pages)), "sha256": doc_sha}]
    return {"tool": "fact_package_verify", "arguments": verify}


try:  # signatures are generated only where both runners can check them (Python needs cryptography)
    import cryptography  # noqa: F401

    HAVE_SIGNING = True
except ImportError:
    HAVE_SIGNING = False


def send_refusal_case(r):
    """A fact_package_send call that is refused before anything is sent (so no network in either runner)."""
    from factlot.tools import run_tool

    pkg = None
    for _ in range(20):
        c = package_case(r)
        if c["tool"] != "fact_package_create":
            continue
        made = run_tool("fact_package_create", c["arguments"])
        if "package" in made and made["package"]["facts"]:
            pkg = made["package"]
            break
    if pkg is None:
        return package_case(r)
    ids = [f["id"] for f in pkg["facts"]]
    items = []
    for i in range(r.randint(1, 4)):
        pos = r.choice(["accept_theirs", "state_ours"])
        it = {"key": f"item{i}", "label": f"Item {i}", "value": r.choice(["8.00%", 0, 12500]), "position": pos,
              "fact_ids": [r.choice(ids)]}
        if pos == "accept_theirs" or r.random() < 0.7:
            it["their_value"] = r.choice(["8.00%", 20000])
        items.append(it)
    inp = {"package": pkg, "kind": "expense_reconciliation", "title": "Synthetic",
           "subject": {"label": "Suite 1 (synthetic)"},
           "from": {"organisation": "Tenant Co", "person": "Pat Tenant", "email": "pat@example.invalid"},
           "to": {"organisation": "Landlord Co", "person": "Lee Landlord", "email": "lee@example.invalid"},
           "items": items, "approved_by": "Pat Tenant", "approval_confirmed": True}
    defect = r.choice(["approval", "approver", "same_org", "dup_key", "their_value", "unknown_fact", "tamper"])
    if defect == "approval":
        inp["approval_confirmed"] = r.choice([False, False, None])
        if inp["approval_confirmed"] is None:
            del inp["approval_confirmed"]
    elif defect == "approver":
        inp["approved_by"] = r.choice(["", "   "])
    elif defect == "same_org":
        inp["to"]["organisation"] = r.choice([" tenant co ", "TENANT CO", "Tenant Co"])
    elif defect == "dup_key":
        inp["items"].append(dict(inp["items"][0]))
    elif defect == "their_value":
        inp["items"][0]["position"] = "state_ours"
        inp["items"][0].pop("their_value", None)
    elif defect == "unknown_fact":
        inp["items"][-1]["fact_ids"] = ["flf_not_in_package"]
    else:
        inp["package"]["facts"][0]["value"] = perturb(r, inp["package"]["facts"][0]["value"])
    return {"tool": "fact_package_send", "arguments": inp}


# --- audit_expense_statement: invented building, random mutations -----------------------------------

_AUDIT_DOC = "fl:document:sha256-" + "a" * 64


def _audit_fact(n, predicate, value, page=1):
    if predicate == "lease.pro_rata_share":
        quote = f"Tenant's Proportionate Share is {value * 100:.2f}%"
    elif predicate == "lease.cam_cap":
        quote = ("Controllable Operating Expenses shall not increase by more than five percent (5%) per year, "
                 "on a cumulative and compounding basis")
    elif predicate == "lease.operating_expense_base_year":
        quote = f"the Base Year shall be calendar year {value}"
    else:
        quote = f"Synthetic clause stating {predicate} number {n}"
    return {"id": f"flf_a{n}", "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "predicate": predicate, "value": value,
            "as_of": "2026-03-01", "provenance": {"method": "extracted", "sources": [
                {"document_id": _AUDIT_DOC, "page": page, "quote": quote}]}}


def _audit_base(r):
    share = r.choice([0.08, 0.0425, 0.125])
    lines = [
        {"label": "Real estate taxes", "amount": r.choice([400000, 312500.5]), "controllable": False, "variable": False},
        {"label": "Insurance", "amount": r.choice([100000, 87650]), "controllable": False, "variable": False},
        {"label": "Janitorial", "amount": r.choice([150000, 96400.25]), "controllable": True, "variable": True},
        {"label": "Repairs and maintenance", "amount": 120000, "controllable": True, "variable": False},
        {"label": "Landscaping", "amount": 80000, "controllable": True, "variable": False},
    ]
    total = sum(l["amount"] for l in lines)
    return {
        "lease": {
            "lease.pro_rata_share": share,
            "lease.cam_cap": {"method": "compounding_from_base", "rate": 0.05},
            "lease.cam_admin_fee": {"rate": r.choice([0.1, 0.15]), "base": r.choice(["actual", "grossed_up"]),
                                    "excluded_from_base": ["real estate taxes", "insurance"]},
            "lease.cam_exclusion": [{"category": "advertising"}, "ground rent"],
            "lease.capex_treatment": {"keywords": ["roof", "replacement"], "recoverable": "excluded"},
            "lease.cam_gross_up": {"target_occupancy": 0.95, "applies_to": "variable_expenses"},
            "lease.audit_right": {"window_days": r.choice([60, 90, 120]), "starts_from": "statement_receipt",
                                  "notice_form": "written notice by certified mail",
                                  "cost_shift_threshold": {"type": "percent_of_billed", "value": 0.03}},
        },
        "lines": lines,
        "st": {
            "statement.period": {"year": 2025, "statement_date": "2026-03-01", "received_date": "2026-03-10"},
            "statement.share_applied": {"share": share},
            "statement.total": {"amount": total},
            "statement.admin_fee": {"rate": 0.1, "base_amount": round(share * 100000, 2), "amount": round(share * 10000, 2)},
            "statement.cap_reference": {"year": 2022, "amount": 24000},
            "statement.cap_applied": {"limit": r.choice([None, 27783])},
            "statement.tenant_charge": {"amount": 70583},
            "statement.estimates_credited": {"amount": 66000},
            "statement.estimates_paid": {"amount": 66000},
            "statement.balance_claimed": {"amount": 4583},
        },
    }


def _audit_mutate(r, c):
    k = r.randrange(19)
    if k == 0:
        c["st"]["statement.admin_fee"] = {"rate": r.choice([0.12, 0.2]), "base_amount": 28000, "amount": 3360}
    elif k == 1:
        a = round(c["st"]["statement.share_applied"]["share"] * sum(l["amount"] for l in c["lines"]), 2)
        c["st"]["statement.admin_fee"] = {"rate": 0.1, "base_amount": a, "amount": round(a / 10, 2)}
    elif k == 2:
        c["st"]["statement.share_applied"] = {"share": r.choice([0.085, 0.09]), "building_sf": r.choice([94000, 100000])}
        c["lease"]["lease.pro_rata_basis"] = {"tenant_sf": 8000, "building_sf": 100000}
    elif k == 3:
        c["lines"].append({"label": r.choice(["Advertising and promotion", "Ground rent", "Roof replacement"]),
                           "amount": r.choice([25000, 4100.5]), "controllable": r.choice([True, False]), "variable": False})
    elif k == 4:
        c["lines"].append(dict(c["lines"][r.randrange(len(c["lines"]))]))
    elif k == 5:
        c["lines"][r.randrange(len(c["lines"]))]["grossed_up_amount"] = r.choice([126000, 158333.33, 99999.99])
        c["st"]["statement.gross_up"] = {"actual_occupancy": r.choice([0.8, 0.9]), "target_occupancy": r.choice([0.95, 1])}
    elif k == 6:
        c["lease"]["lease.operating_expense_base_year"] = 2023
        c["st"]["statement.base_year_applied"] = {"base_year": r.choice([2023, 2024]), "deduction": r.choice([50000, 56000])}
        if r.random() < 0.6:
            c["st"]["statement.base_year_total"] = {"year": 2023, "amount": 700000}
    elif k == 7:
        c["lease"]["lease.expense_stop"] = {"amount": 700000}
        c["st"]["statement.base_year_applied"] = {"stop_amount": r.choice([600000, 700000]), "deduction": 48000}
    elif k == 8:
        c["st"]["statement.total"] = {"amount": c["st"]["statement.total"]["amount"] + r.choice([-500, 10000])}
        c["st"]["statement.estimates_credited"] = {"amount": r.choice([64000, 66000])}
    elif k == 9:
        for p in r.sample(sorted(c["lease"]), r.randint(1, 3)):
            if p != "lease.pro_rata_share" or r.random() < 0.2:
                del c["lease"][p]
    elif k == 10:
        c["lease"].pop("lease.cam_cap", None)
        c["lease"]["lease.cam_cap_rate"] = {"rate": 0.05}
    elif k == 11:
        c["lines"][r.randrange(len(c["lines"]))].pop("controllable", None)
    elif k == 12:
        c["separately"] = [{"label": r.choice(["Landscaping", "Janitorial"]), "amount": r.choice([6400, 3000])}]
    elif k == 13:
        c["priorPeriod"] = {"year": 2024, "statement_date": "2025-03-01", "received_date": "2025-03-10"}
        c["prior"] = [{"label": l["label"], "amount": round(l["amount"] / r.choice([1.02, 1.3, 2]), 2)} for l in c["lines"][:4]]
    elif k == 14:
        c["lease"]["lease.capex_treatment"] = {"keywords": ["roof"], "recoverable": "amortized", "amortization_years": 10,
                                               "interest_rate": r.choice([0, 0.06])}
        c["lines"].append({"label": "Roof work", "amount": 9000, "controllable": False, "variable": False,
                           **({"amortization": {"cost": 50000, "years": 5, "rate": 0.06}} if r.random() < 0.5 else {})})
    elif k == 16:
        # the statement as printed: a building-level fee and a total that includes it, level stated or not
        base = sum(l["amount"] for l in c["lines"] if l["label"] not in ("Real estate taxes", "Insurance"))
        if r.random() < 0.4:
            base = sum(l["amount"] for l in c["lines"])
        rate = r.choice([0.1, 0.12])
        fee = round(base * rate, 2) + r.choice([0, 0, 1000])
        c["st"]["statement.admin_fee"] = {"rate": rate, "base_amount": base, "amount": fee,
                                          **({"level": "building"} if r.random() < 0.5 else {})}
        c["st"]["statement.total"] = {"amount": sum(l["amount"] for l in c["lines"]) + fee + r.choice([0, 0, 2500]),
                                      **({"includes_fee": r.choice([True, False])} if r.random() < 0.4 else {})}
    elif k == 17:
        # a level stated against the figures: the guard must say so in both languages
        c["st"]["statement.admin_fee"] = {"rate": 0.1, "base_amount": r.choice([850000, 350000, 31000]),
                                          "amount": r.choice([85000, 35000, 3100]), "level": r.choice(["tenant", "building"])}
    elif k == 18:
        c["st"]["statement.total"] = {"amount": c["st"]["statement.total"]["amount"], "includes_fee": r.choice([True, False])}
        if r.random() < 0.3:
            c["st"].pop("statement.admin_fee", None)
    else:
        c["lease"]["lease.audit_right"] = {"window_days": 45, "starts_from": r.choice(["statement_date", "statement_receipt"]),
                                           "notice_form": "written notice",
                                           "cost_shift_threshold": {"type": "amount", "value": r.choice([200, 5000])}}


def audit_case(r, in_portfolio=False):
    c = _audit_base(r)
    for _ in range(r.randint(0, 3)):
        _audit_mutate(r, c)
    n = 0
    lease_facts = []
    for p, v in c["lease"].items():
        for x in (v if p == "lease.cam_exclusion" else [v]):
            n += 1
            lease_facts.append(_audit_fact(n, p, x))
    statement_facts = []
    for p, v in c["st"].items():
        n += 1
        statement_facts.append(_audit_fact(n, p, v, 2))
    for l in c["lines"]:
        n += 1
        statement_facts.append(_audit_fact(n, "statement.line", l, 2))
    for sb in c.get("separately", []):
        n += 1
        statement_facts.append(_audit_fact(n, "statement.separately_billed", sb, 3))
    args = {"lease_facts": lease_facts, "statement_facts": statement_facts,
            "as_of": r.choice(["2026-04-01", "2026-08-01", "2027-01-15"])}
    if c.get("prior"):
        args["prior_statement_facts"] = [_audit_fact(n + 1, "statement.period", c["priorPeriod"], 2)] + \
            [_audit_fact(n + 2 + i, "statement.line", l, 2) for i, l in enumerate(c["prior"])]
        args["yoy_threshold"] = r.choice([0.05, 0.1, 0.5])
    k = r.random()
    if k < 0.08:
        args["lease_facts"][r.randrange(len(args["lease_facts"]))]["provenance"]["sources"][0]["quote"] = ""
    elif k < 0.12:
        # a value of the wrong shape: the two languages word that error differently (paths agree), so a
        # portfolio, which carries each location's messages in its answer, leaves it out
        if not in_portfolio:
            args["statement_facts"][r.randrange(len(args["statement_facts"]))]["value"] = {"amount": "x"}
    elif k < 0.15:
        args["statement_facts"].append(dict(args["statement_facts"][-1]))
    return {"tool": "audit_expense_statement", "arguments": args}


# --- audit_expense_portfolio: several audit cases as locations, some landlords shared, some entries broken ---

_PORTFOLIO_LANDLORDS = ["Alder Court Holdings LLC", "alder court holdings, llc", "Northgate Property Partners",
                        "Stonebridge Realty Trust", None, None]


def portfolio_case(r):
    n = r.randint(2, 6)
    audits = []
    for i in range(n):
        a = audit_case(r, True)["arguments"]
        a.pop("as_of", None)
        e = {"label": f"Store {i + 1}", **a}
        ll = r.choice(_PORTFOLIO_LANDLORDS)
        if ll:
            e["landlord"] = ll
        audits.append(e)
    k = r.random()
    if k < 0.12:
        audits[r.randrange(n)]["label"] = audits[0]["label"]
    elif k < 0.2:
        audits[r.randrange(n)].pop("label")
    elif k < 0.28:
        audits[r.randrange(n)]["lease_fact"] = 1
    elif k < 0.36:
        audits[r.randrange(n)]["lease_facts"] = "none"
    elif k < 0.44:
        audits[r.randrange(n)]["yoy_threshold"] = r.choice([0, 11, "x"])
    elif k < 0.5:
        audits[r.randrange(n)]["landlord"] = r.choice(["", "--", 5])
    elif k < 0.56:
        audits[r.randrange(n)].pop("statement_facts")
    args = {"audits": audits, "as_of": r.choice(["2026-04-01", "2026-08-01", "2027-01-15"])}
    if r.random() < 0.3:
        args["yoy_threshold"] = r.choice([0.05, 0.5])
    if r.random() < 0.3:
        args["include_results"] = True
    return {"tool": "audit_expense_portfolio", "arguments": args}


# --- estoppel_prepare: an invented lease, random omissions, amendments and conflicts -------------------

_E_DOCS = ["fl:document:sha256-" + "c" * 64, "fl:document:sha256-" + "d" * 64]


def _e_fact(n, predicate, value, quote, doc=0, page=1, valid_from=None, supersedes=None):
    f = {"id": f"flf_e{n}", "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "predicate": predicate, "value": value,
         "as_of": "2026-03-01", "provenance": {"method": "extracted", "sources": [
             {"document_id": _E_DOCS[doc], "page": page, "quote": quote}]}}
    if valid_from:
        f["valid_from"] = valid_from
    if supersedes:
        f["supersedes"] = supersedes
    return f


def estoppel_case(r):
    n = [0]

    def nf(*a, **k):
        n[0] += 1
        return _e_fact(n[0], *a, **k)

    year = r.choice([2021, 2022, 2023])
    term = r.choice([5, 7, 10])
    area = r.choice([2400, 5150, 8400, 12000])
    base = r.choice([24, 28.5, 32.75])
    step = r.choice([0.02, 0.03])
    comm = f"{year}-07-01"
    exp = f"{year + term}-06-30"
    sched = []
    quote_parts = []
    for i in range(term):
        a = f"{year + i}-07-01"
        b = f"{year + i + 1}-06-30"
        psf = round(base * (1 + step) ** i, 2)
        sched.append({"from": a, "to": b, "annual_rent_psf": psf})
        quote_parts.append(f"{a} to {b}: ${psf:.2f} per RSF")
    facts = []
    if r.random() < 0.95:
        facts.append(nf("lease.landlord", "Alder Court Holdings LLC", "entered into by Alder Court Holdings LLC"))
    if r.random() < 0.95:
        facts.append(nf("lease.tenant", "Birchwood Analytics Inc", "and Birchwood Analytics Inc"))
    if r.random() < 0.92:
        facts.append(nf("lease.commencement_date", comm, f"The Commencement Date is {comm}."))
    exp_old = None
    if r.random() < 0.92:
        exp_old = nf("lease.expiration_date", exp, f"The Term shall expire on {exp}.", page=2)
        facts.append(exp_old)
    if r.random() < 0.9:
        facts.append(nf("lease.rentable_area_sf", area, f"containing approximately {area} rentable square feet"))
    rent_old = None
    if r.random() < 0.9:
        rent_old = nf("lease.base_rent_schedule", sched, "; ".join(quote_parts), page=3)
        facts.append(rent_old)
    if r.random() < 0.85:
        facts.append(nf("lease.security_deposit", r.choice([10000, 30000, 45500.5]), "a security deposit as stated", page=4))
    if r.random() < 0.4:
        facts.append(nf("lease.free_rent", {"months": 2, "applies_to": "base_rent"},
                        "Base Rent shall be abated for the first two (2) months of the Term", page=3))
    if r.random() < 0.4:
        facts.append(nf("lease.ti_allowance", r.choice([50000, 168000]), "Landlord shall provide a tenant improvement allowance", page=5))
    if r.random() < 0.5:
        facts.append(nf("lease.renewal_option", {"count": 1, "term_months": 60, "notice_months": 12, "rent": "Fair Market Rent"},
                        "Tenant shall have one (1) option to extend the Term for sixty (60) months", page=6))
    if r.random() < 0.2:
        facts.append(nf("lease.termination_option", {"earliest": f"{year + 3}-07-01", "notice_months": 9, "fee": "unamortized costs"},
                        "Tenant may terminate the Lease early on nine (9) months' notice", page=7))
    if r.random() < 0.15:
        facts.append(nf("lease.purchase_option", {"kind": "rofr"}, "Tenant has a right of first refusal to purchase the Property", page=8))
    k = r.random()
    amend_exp = f"{year + term + 5}-06-30"
    if exp_old is not None and k < 0.35:
        facts.append(nf("lease.expiration_date", amend_exp, f"The Term shall expire on {amend_exp}.", doc=1,
                        valid_from=f"{year + 2}-01-01", supersedes=[exp_old["id"]]))
    elif exp_old is not None and k < 0.45:
        facts.append(nf("lease.expiration_date", amend_exp, f"The Term shall expire on {amend_exp}.", doc=1))
    elif k < 0.55:
        facts.append(nf("lease.expiration_date", "2040-06-30", "The Term shall expire on a later date.", doc=1,
                        valid_from="2030-01-01"))
    if rent_old is not None and r.random() < 0.2:
        facts.append(nf("lease.base_rent_schedule", [{"from": f"{year + term}-07-01", "to": f"{year + term + 4}-06-30",
                                                      "annual_rent_psf": 40}], "next period: $40.00 per RSF", doc=1,
                        valid_from=f"{year + 2}-01-01", supersedes=[rent_old["id"]]))
    r.shuffle(facts)
    args = {
        "lease_facts": facts,
        "parties": {"tenant": {"organisation": "Birchwood Analytics Inc"}, "landlord": {"organisation": "Alder Court Holdings LLC"}},
        "premises": {"label": "Alder Court, Suite 210"},
        "as_of": r.choice([f"{year + 1}-11-20", f"{year + 3}-03-15", f"{year + term}-01-10", "2026-11-20"]),
    }
    if r.random() < 0.4:
        args["parties"]["requested_by"] = {"organisation": "Northfield Credit Partners LLC", "role": r.choice(["lender", "buyer"])}
    if r.random() < 0.3:
        args["landlord_records"] = {"rent_paid_through": r.choice([f"{year + 1}-10-31", "2026-11-30"])}
    if r.random() < 0.3:
        args["documents"] = [{"document_id": _E_DOCS[0], "role": "original"}, {"document_id": _E_DOCS[1], "role": "amendment"}]
    if r.random() < 0.05:
        args["as_of"] = "20 Nov 2026"
    return {"tool": "estoppel_prepare", "arguments": args}


# --- rent_roll_certify: an invented roll, leases that match, differ, are missing or conflict ------------

_R_ROLL = "fl:document:sha256-" + "e" * 64
_R_LEASE = ["fl:document:sha256-" + c * 64 for c in "123456789"]
_R_NAMES = ["Birchwood Analytics Inc", "Cobalt Dental Group PLLC", "Fenwick & Marsh Architects LLP",
            "Juniper Row Bakery Inc", "Halcyon Yoga Studio LLC", "Quillfeather Staffing Inc", "Tidewater Surveying Inc"]


def rent_roll_case(r):
    n = [0]

    def nf(predicate, value, quote, doc, page=1, valid_from=None, supersedes=None):
        n[0] += 1
        f = {"id": f"flf_r{n[0]}", "subject": "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "predicate": predicate,
             "value": value, "as_of": "2026-11-20",
             "provenance": {"method": "extracted", "sources": [{"document_id": doc, "page": page, "quote": quote}]}}
        if valid_from:
            f["valid_from"] = valid_from
        if supersedes:
            f["supersedes"] = supersedes
        return f

    as_of = r.choice(["2026-11-20", "2026-11-20", "2027-02-01", "2026-06-30"])
    names = r.sample(_R_NAMES, r.randint(2, 5))
    roll_lines, leases, expected_vac = [], [], 0
    for i, name in enumerate(names):
        area = r.choice([2400, 2750, 5150, 8400])
        psf = r.choice([24, 28.5, 33, 36.75])
        annual = round(area * psf, 2)
        monthly = round(annual / 12, 2)
        start = r.choice(["2021-01-01", "2023-07-01", "2025-09-01"])
        exp = r.choice(["2026-12-31", "2027-06-30", "2029-03-31", "2033-06-30"])
        row = f"{name}  {i + 100}  {area:,}  {start}  {exp}  {monthly:,.2f}  {annual:,.2f}  {psf:.2f}"
        rl = lambda p, v: nf(f"rent_roll.{p}", v, row, _R_ROLL, 1 + i // 3)
        facts = []
        if r.random() < 0.97:
            facts.append(rl("tenant_name", name))
        if r.random() < 0.9:
            facts.append(rl("suite", str(i + 100)))
        if r.random() < 0.93:
            facts.append(rl("rentable_area_sf", area))
        if r.random() < 0.8:
            facts.append(rl("lease_start_date", start))
        if r.random() < 0.93:
            facts.append(rl("lease_expiration_date", exp))
        k = r.random()
        if k < 0.35:
            facts += [rl("base_rent_monthly", monthly), rl("base_rent_annual", annual), rl("base_rent_psf", psf)]
        elif k < 0.55:
            facts.append(rl("base_rent_annual", annual))
        elif k < 0.7:
            facts.append(rl("base_rent_monthly", monthly))
        elif k < 0.85:
            facts.append(rl("base_rent_psf", psf))
        if r.random() < 0.15:
            facts.append(rl("base_rent_annual", annual + 100))  # a second value for one field: refused
        if r.random() < 0.5:
            facts.append(rl("security_deposit", round(monthly * 2, 2)))
        if r.random() < 0.4:
            facts.append(rl("next_rent_step", {"date": "2027-07-01", "annual_rent_psf": psf + 1}))
        if r.random() < 0.3:
            facts.append(rl("free_rent_outstanding", {"months": r.choice([0, 1, 2])}))
        if r.random() < 0.3:
            facts.append(rl("renewal_option", {"count": r.choice([0, 1, 2]), "term_months": 60}))
        if r.random() < 0.3:
            facts.append(rl("recoveries", {"structure": r.choice(["nnn", "base_year", "gross"]), "base_year": 2024}))
        r.shuffle(facts)
        line = {"line_id": f"L{i + 1}", "facts": facts}
        roll_lines.append(line)
        if r.random() < 0.15:
            continue  # no lease supplied
        doc = _R_LEASE[i]
        lf = lambda p, v, q, pg=1, **kw: nf(f"lease.{p}", v, q, doc, pg, **kw)
        lease_name = name if r.random() < 0.9 else name + " Holdings"
        l_exp = exp if r.random() < 0.8 else "2029-12-31"
        l_area = area if r.random() < 0.85 else area + 150
        l_psf = psf if r.random() < 0.8 else round(psf + 0.5, 2)
        lfacts = []
        if r.random() < 0.9:
            lfacts.append(lf("tenant", lease_name, f"and {lease_name} (Tenant)"))
        if r.random() < 0.9:
            lfacts.append(lf("rentable_area_sf", l_area, f"approximately {l_area:,} rentable square feet"))
        if r.random() < 0.9:
            lfacts.append(lf("expiration_date", l_exp, f"The Term shall expire on {l_exp}.", 2))
        if r.random() < 0.8:
            lfacts.append(lf("commencement_date", start, f"The Commencement Date is {start}."))
        sched = [{"from": "2025-07-01", "to": "2026-06-30", "annual_rent_psf": round(l_psf - 1, 2)},
                 {"from": "2026-07-01", "to": "2027-06-30", "annual_rent_psf": l_psf},
                 {"from": "2027-07-01", "to": "2028-06-30", "annual_rent_psf": l_psf + 1}]
        old = None
        if r.random() < 0.9:
            old = lf("base_rent_schedule", sched, "; ".join(
                f"{x['from']} to {x['to']}: ${x['annual_rent_psf']:.2f} per RSF" for x in sched), 3)
            lfacts.append(old)
        if old is not None and r.random() < 0.15:
            lfacts.append(lf("base_rent_schedule", [{"from": "2026-07-01", "to": "2027-06-30", "annual_rent_psf": l_psf + 2}],
                             f"2026-07-01 to 2027-06-30: ${l_psf + 2:.2f} per RSF",
                             3, supersedes=[old["id"]] if r.random() < 0.5 else None))
        if r.random() < 0.4:
            dep = r.choice([round(monthly * 2, 2), 5000])
            lfacts.append(lf("security_deposit", dep, f"a security deposit of ${dep:,.2f}", 4))
        if r.random() < 0.3:
            lfacts.append(lf("free_rent", {"months": 2}, "Base Rent is abated for 2 months", 3))
        if r.random() < 0.3:
            rcd = r.choice(["2025-01-01", "2027-03-01"])
            lfacts.append(lf("rent_commencement_date", rcd, f"Rent commences on {rcd}", 3))
        if r.random() < 0.3:
            lfacts.append(lf("renewal_option", {"count": 1, "term_months": 60}, "one option to extend for 60 months", 6))
        if r.random() < 0.3:
            lfacts.append(lf("recovery_structure", {"structure": r.choice(["nnn", "base_year"])}, "Tenant pays its share", 5))
        if r.random() < 0.2:
            by = r.choice([2023, 2024])
            lfacts.append(lf("operating_expense_base_year", by, f"The Base Year is calendar year {by}", 5))
        if r.random() < 0.15:
            lfacts.append(lf("expiration_date", "2031-12-31", "The Term shall expire on 2031-12-31.", 2,
                             valid_from=r.choice(["2025-01-01", "2030-01-01"])))
        if not lfacts:
            continue
        entry = {"facts": lfacts}
        if r.random() < 0.8:
            entry["line_id"] = f"L{i + 1}"
        if r.random() < 0.1:
            entry["label"] = f"Lease {i + 1}"
        if r.random() < 0.5:
            codes = ["COMMENCEMENT", "EXPIRATION", "PREMISES", "BASE_RENT"]
            entry["estoppel"] = {
                "package_id": "00000000-0000-4000-8000-000000000001",
                "as_of": r.choice([as_of, as_of, "2026-08-01", "2027-03-01"]),
                "statements": [{"key": f"S{j + 1:02d}", "code": c, "decision": r.choice(["agreed"] * 5 + ["disputed"]),
                                **({"tenants_own_version": "a different figure"} if r.random() < 0.3 else {})}
                               for j, c in enumerate(codes) if r.random() < 0.9] or [
                    {"key": "S01", "code": "BASE_RENT", "decision": "agreed"}],
            }
        leases.append(entry)
    if r.random() < 0.3:
        roll_lines.append({"line_id": "V1", "occupancy": "vacant", "facts": [
            nf("rent_roll.rentable_area_sf", 3200, "Vacant  500  3,200", _R_ROLL, 2),
            *([nf("rent_roll.suite", "500", "Vacant  500  3,200", _R_ROLL, 2)] if r.random() < 0.7 else [])]})
        expected_vac = 1
    if r.random() < 0.2:
        leases.append({"label": "Orphan lease", "facts": [
            nf("lease.tenant", "Orphan Tenant Inc", "and Orphan Tenant Inc (Tenant)", _R_LEASE[8])]})
    args = {
        "property": {"label": "Alder Court, 100 Example Street"},
        "as_of": as_of,
        "parties": {"certifier": {"organisation": "Alder Court Holdings LLC", "role": "borrower"}},
        "roll_lines": roll_lines,
    }
    if leases:
        args["leases"] = leases
    if r.random() < 0.4:
        args["parties"]["relying_party"] = {"organisation": r.choice(["Northfield Credit Partners LLC", "Alder Court Holdings LLC"]),
                                            "role": "lender"}
    if r.random() < 0.4:
        args["building_area_sf"] = r.choice([20000, 30000, 12000])
    if r.random() < 0.2:
        args["tolerance"] = {"annual_usd": r.choice([0, 1, 50]), "psf": r.choice([0, 0.01, 0.5])}
    if r.random() < 0.3:
        args["roll_document"] = {"title": "Rent roll, as of the date"}
    if r.random() < 0.05:
        args["as_of"] = "20 Nov 2026"
    return {"tool": "rent_roll_certify", "arguments": args}


def round2_cases(seed, count):
    import os
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python", "src"))
    r = random.Random(f"docs2-{seed}")
    out = []
    for _ in range(count):
        k = r.random()
        if k < 0.3:
            out.append(clause_case(r))
        elif k < 0.6:
            out.append(statement_case(r))
        elif k < 0.8:
            out.append(use_conflict_case(r))
        elif k < 0.88:
            out.append(package_case(r))
        elif k < 0.92:
            out.append(send_refusal_case(r))
        elif k < 0.96:
            out.append(estoppel_case(r))
        else:
            out.append(audit_case(r))
    rr = random.Random(f"rentroll-{seed}")
    out.extend(rent_roll_case(rr) for _ in range(max(1, count // 6)))
    pr = random.Random(f"portfolio-{seed}")
    out.extend(portfolio_case(pr) for _ in range(max(1, count // 25)))
    return out
