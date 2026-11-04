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
        else:
            out.append(package_case(r))
    return out
