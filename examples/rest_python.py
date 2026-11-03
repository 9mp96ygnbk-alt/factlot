"""FactLot over REST with only the Python standard library.

    python3 examples/rest_python.py

Uses the free hosted endpoint unless FACTLOT_API_URL is set; sends FACTLOT_API_KEY if present.
"""

import json
import os
import urllib.request

API = os.environ.get("FACTLOT_API_URL", "https://api.factlot.com").rstrip("/")
KEY = os.environ.get("FACTLOT_API_KEY")


def call(path: str, body: dict) -> dict:
    # Name your client: some networks reject Python's default "Python-urllib" user agent.
    headers = {"content-type": "application/json", "user-agent": "factlot-example/1.0"}
    if KEY:
        headers["authorization"] = f"Bearer {KEY}"
    req = urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def main() -> None:
    loan = call(
        "/v1/calc/debt_sizing",
        {
            "noi": 1_000_000,
            "value": 15_000_000,
            "rate_annual": 0.065,
            "amortization_years": 30,
            "max_ltv": 0.65,
            "min_dscr": 1.25,
        },
    )
    v = loan["value"]
    f = loan["formula"]
    print(f"Max loan ${v['max_loan']:,.0f}, bound by {v['binding_constraint']} ({f['id']}@{f['version']})")
    for step in loan["steps"]:
        print(f"  {step['label']}: {step['value']}")
    for w in loan["warnings"]:
        print(f"  warning: {w}")

    irr = call("/v1/calc/irr", {"cash_flows": [-100, 10, 10, 110]})
    print(f"IRR of -100, 10, 10, 110: {irr['value']['irr_periodic']:.2%} per period")


if __name__ == "__main__":
    main()
