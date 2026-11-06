"""Random inputs for the Texas protest-kit pieces in the TypeScript/Python differential test, on their own random
stream so the other cases stay as they were:

- calc.tx_unequal_appraisal, run directly (value and warning count compared) and through calc_tx_unequal_appraisal
  (the whole tool result compared: every step, warning text and error path).

Some inputs are deliberately invalid (missing areas, whole-number percents, duplicate ids, $/SF without a normalizing
area, adjustments that leave nothing) so both SDKs must also reject the same inputs.
"""
import random

_FIPS = ["201", "113", "439", "453", "085", "121", "491", "157"]


def _money(r, lo, hi):
    return r.choice([round(r.uniform(lo, hi), 0), round(r.uniform(lo, hi), 2), r.randint(int(lo), int(hi)) // 1000 * 1000])


def _adjustment(r, normalized):
    kind = r.choice(["percent", "percent", "amount", "psf"] if normalized else ["percent", "percent", "amount"])
    if kind == "percent":
        v = r.choice([round(r.uniform(-0.3, 0.3), r.choice([2, 3, 4])), 0.05, -0.1, 0.025, 0])
        if r.random() < 0.004:
            v = r.choice([5, -10, 1, -1])  # whole-number percent or 100%: rejected
    elif kind == "amount":
        v = round(r.uniform(-300000, 300000), r.choice([0, 2]))
    else:
        v = round(r.uniform(-15, 15), r.choice([1, 2, 3]))
    return {"label": r.choice(["age", "size", "condition", "location", "quality", "land ratio"]), "kind": kind,
            "value": v, "reason": r.choice(["comp older", "comp smaller", "per grid", "comp renovated 2024"])}


def unequal_appraisal(r):
    by = r.choice(["none", "improvement_area_sf", "land_area_sf"])
    basis = r.choice(["appraised", "market"])
    subject = {"value": _money(r, 2e5, 5e7), "value_basis": basis}
    for k in ("improvement_area_sf", "land_area_sf"):
        if k == by or r.random() < 0.4:
            subject[k] = r.choice([r.randint(500, 400000), round(r.uniform(500, 400000), 2)])
    if r.random() < 0.6:
        subject["id"] = "S"
    if r.random() < 0.5:
        subject["county_fips"] = r.choice(_FIPS[:3])
    if r.random() < 0.3:
        subject["circuit_breaker_23_231"] = r.random() < 0.7
    comps = []
    for i in range(r.choice([3, 3, 4, 5, 6, 7, 8, 9, 12, r.randint(3, 40)])):
        c = {"value": _money(r, 1e5, 6e7), "value_basis": basis if r.random() < 0.9 else r.choice(["appraised", "market"])}
        if r.random() < 0.85:
            c["id"] = f"C{i + 1}"
        for k in ("improvement_area_sf", "land_area_sf"):
            if k == by or r.random() < 0.3:
                c[k] = r.choice([r.randint(500, 400000), round(r.uniform(500, 400000), 2)])
        if r.random() < 0.5:
            c["county_fips"] = r.choice(_FIPS)
        if r.random() < 0.3:
            c["citation"] = {"document_id": f"fl:document:sha256-{i}", "locator": f"row {r.randint(1, 90000)}"}
            if r.random() < 0.5:
                c["citation"]["as_of"] = "2027-04-15"
        if r.random() < 0.8:
            c["adjustments"] = [_adjustment(r, by != "none") for _ in range(r.randint(0, 5))]
        comps.append(c)
    if r.random() < 0.05:
        comps[0] = {k: v for k, v in subject.items() if k not in ("circuit_breaker_23_231", "id")}  # same as the subject
    inp = {"tax_year": r.choice([2024, 2026, 2027, 2028, r.randint(1982, 2100)]), "subject": subject,
           "comparables": comps}
    if by != "none" or r.random() < 0.5:
        inp["normalize_by"] = by
    if r.random() < 0.6:
        inp["adjustment_combine"] = r.choice(["sum", "compound"])
    roll = r.random()
    if roll < 0.02:
        inp["comparables"] = comps[:2]
    elif roll < 0.04 and by != "none":
        inp["comparables"][-1].pop(by, None)
    elif roll < 0.05 and "id" in subject:
        inp["comparables"][-1]["id"] = "S"
    elif roll < 0.06 and len(comps) > 3:
        inp["comparables"][1]["id"] = inp["comparables"][0].get("id", "C1")
    elif roll < 0.07:
        inp["comparables"][0]["adjustments"] = [{"label": "x", "kind": "psf", "value": 2, "reason": "y"}]
    elif roll < 0.08:
        inp["comparables"][0]["adjustments"] = [{"label": "x", "kind": "amount", "value": -1e9, "reason": "y"}]
    elif roll < 0.09:
        inp["comparables"][0]["adjustmnts"] = []
    return inp



def tx_cases(seed, count):
    r = random.Random(f"tx-protest-{seed}")
    out = []
    for _ in range(max(1, count // 8)):
        inp = unequal_appraisal(r)
        out.append({"calc": "tx_unequal_appraisal", "input": inp})
        out.append({"tool": "calc_tx_unequal_appraisal", "arguments": inp})
    return out
