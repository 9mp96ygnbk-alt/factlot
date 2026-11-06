"""Random lease_comp_validate inputs for the TypeScript/Python differential test: mostly sound comps, with
some fields broken in ways the shape and cross-field rules catch. Every value is synthetic."""
import random


def comp_cases(seed, count):
    r = random.Random(f"comps-{seed}")
    out = []
    for _ in range(max(1, count // 10)):
        term = r.randint(6, 180)
        y = r.randint(2022, 2030)
        m, d = r.randint(1, 12), r.choice([1, 1, 1, 15, 28])
        start = f"{y}-{m:02d}-{d:02d}"
        value = {
            "comp_type": r.choice(["new", "renewal", "extension", "expansion", "sublease", "amendment", "holdover", "other"]),
            "property_type": r.choice(["office", "industrial", "retail", "medical_office", "flex", "other"]),
            "area_sf": round(r.uniform(500, 250000), r.choice([0, 2])),
            "commencement_date": start,
            "term_months": term,
            "starting_rent_psf_yr": round(r.uniform(4, 120), 2),
            "escalation": r.choice([{"type": "none"}, {"type": "percent", "rate": round(r.uniform(0, 0.06), 4)},
                                    {"type": "fixed_psf", "amount": round(r.uniform(0, 2), 2), "every_months": r.choice([12, 24])}]),
            "free_rent_months": r.randint(0, min(term, 12)),
            "ti_allowance_psf": round(r.uniform(0, 150), 2),
            "expense_basis": r.choice(["full_service", "modified_gross", "nnn", "base_year", "industrial_gross", "unknown"]),
            "confirming_party": r.choice(["landlord", "tenant", "landlord_broker", "tenant_broker", "both_parties", "public_record"]),
            "verification": r.choice(["unverified", "party_confirmed", "document_verified", "public_record"]),
        }
        if r.random() < 0.4:
            value["leasing_commissions_usd"] = round(r.uniform(0, 400000), 2)
        if r.random() < 0.3:
            value["expiration_date"] = f"{y + term // 12 + 1}-{m:02d}-28"
        if r.random() < 0.2:
            value["notes"] = r.choice(["Renewal at market", "Call 214-555-0188 for details", "see jo@example.com", "x" * 1001])
        if r.random() < 0.2:
            value["state"] = r.choice(["TX", "tx", "CA", "N"])
        for key in r.sample(sorted(value), r.randint(0, 2)) if r.random() < 0.35 else []:
            value[key] = r.choice([None, -1, "x", 0, 1e9, [1], {}])
        fact = {
            "subject": r.choice(["fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4", "fl:parcel:us-48201:1"]),
            "predicate": "lease.comp", "value": value, "as_of": f"{y}-{m:02d}-{d:02d}",
            "provenance": {"method": r.choice(["reported", "reported", "human_verified", "computed"]),
                           "sources": [{"document_id": "firm:deal-1"}] if r.random() < 0.9 else []},
        }
        if r.random() < 0.85:
            fact["rights"] = {"ai_use": r.choice(["permitted", "prohibited", "unknown"]),
                              "redistribution": r.choice(["permitted", "attribution_required", "prohibited", "unknown"])}
        args = {"fact": fact}
        if r.random() < 0.3:
            args["profile"] = r.choice(["share", "observed"])
        if r.random() < 0.3:
            args["discount_rate_annual"] = round(r.uniform(0, 0.15), 4)
        out.append({"tool": "lease_comp_validate", "arguments": args})
    return out


def comp_search_cases(seed, count):
    """Random lease_comp_search filters over the bundled GSA comps (the filters are synthetic; the data is real)."""
    r = random.Random(f"comp-search-{seed}")
    out = []
    states = ["TX", "CA", "ny", "DC", "VA", "MD", "FL", "WA", "AK", "PR", "GU", "ZZ"]
    counties = ["48201", "11001", "06037", "36061", "09140", "53033", "17031", "00000"]
    cities = ["Houston", "WASHINGTON", " new  york ", "Los Angeles", "Seattle", "Nowhere"]
    sorts = ["commencement_desc", "commencement_asc", "expiration_asc", "expiration_desc", "rent_psf_desc",
             "rent_psf_asc", "rentable_sf_desc", "rentable_sf_asc", "distance_asc"]
    for _ in range(max(1, count // 20)):
        args = {}
        if r.random() < 0.4:
            args["state"] = r.choice(states)
        if r.random() < 0.15:
            args["county_fips"] = r.choice(counties)
        if r.random() < 0.15:
            args["city"] = r.choice(cities)
        if r.random() < 0.1:
            args["zip"] = r.choice(["77002", "20002-4232", "10007", "99999"])
        if r.random() < 0.35:
            args["near"] = {"latitude": round(r.uniform(25, 49), r.choice([0, 4, 6])),
                            "longitude": round(r.uniform(-124, -67), r.choice([0, 4, 6])),
                            "radius_miles": r.choice([0.5, 1, 5, 25, 100, 500, round(r.uniform(0.1, 300), 2)])}
        if r.random() < 0.3:
            args["min_rentable_sf"] = r.choice([0, 1000, 10000, 50000])
        if r.random() < 0.3:
            args["max_rentable_sf"] = r.choice([500, 5000, 20000, 1e6])
        if r.random() < 0.3:
            y = r.randint(1995, 2026)
            args["commencement_from"] = f"{y}-{r.randint(1, 12):02d}-01"
        if r.random() < 0.3:
            y = r.randint(2000, 2027)
            args["commencement_to"] = f"{y}-{r.randint(1, 12):02d}-28"
        if r.random() < 0.3:
            args["min_rent_psf_yr"] = round(r.uniform(0, 50), r.choice([0, 2]))
        if r.random() < 0.3:
            args["max_rent_psf_yr"] = round(r.uniform(10, 120), r.choice([0, 2]))
        if r.random() < 0.2:
            args["property_type"] = r.choice(["office", "industrial", "other"])
        if r.random() < 0.15:
            args["expense_basis"] = r.choice(["full_service", "not_full_service"])
        if r.random() < 0.6:
            args["sort"] = r.choice(sorts)
        if r.random() < 0.5:
            args["limit"] = r.choice([1, 5, 25, 200, 0, 201, 2.5])
        if r.random() < 0.05:
            args[r.choice(["states", "radius", "zipcode"])] = "x"
        out.append({"tool": "lease_comp_search", "arguments": args})
    return out
