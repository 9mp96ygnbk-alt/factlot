#!/usr/bin/env python3
"""Find and download lease exhibits (Exhibit 10 leases) from SEC EDGAR, politely.

    FACTLOT_SEC_USER_AGENT="Your Name your@address" python3 scripts/registry/sec_lease_exhibits_fetch.py OUT_DIR

The SEC requires a declared User-Agent with a contact address (https://www.sec.gov/os/accessing-edgar-data).
It is read from the environment variable FACTLOT_SEC_USER_AGENT and sent only to efts.sec.gov and www.sec.gov;
it is never written to a file here. One stream, at most one request per 1.5 seconds (the SEC allows 10 per
second). Discovery uses the EDGAR full-text search JSON (efts.sec.gov), five queries; each hit names an exhibit,
which is downloaded from www.sec.gov/Archives. Writes OUT_DIR/docs/<accession>_<file>, OUT_DIR/meta.json (filer,
accession, form, filing date, URL, SHA-256, size). The downloaded leases are not committed anywhere.
Then: sec_lease_exhibits.html_pages(raw) → pages; an agent writes specs; `sec_lease_exhibits build` verifies them.
"""
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

PAUSE = 1.5
QUERIES = {
    "office": '"office lease" "rentable square feet" "base rent" "tenant improvement allowance" "expiration date"',
    "industrial": '"industrial lease" OR "warehouse" "lease" "rentable square feet" "base rent" "triple net" "expiration date"',
    "retail": '"retail lease" OR "shopping center" "lease agreement" "base rent" "gross leasable" "tenant"',
    "medical": '"medical office" "lease" "rentable square feet" "base rent" "tenant improvement allowance"',
    "flex": '"laboratory" "lease" "rentable square feet" "base rent" "triple net" "tenant improvement allowance"',
}


def get(url: str, ua: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Encoding": "identity"})
    data = urllib.request.urlopen(req, timeout=60).read()
    time.sleep(PAUSE)
    return data


def main(out_dir: str, start: str = "2023-01-01", end: str = "2026-11-01") -> None:
    ua = os.environ.get("FACTLOT_SEC_USER_AGENT")
    if not ua or "@" not in ua:
        sys.exit("set FACTLOT_SEC_USER_AGENT to a name and contact address")
    out = Path(out_dir)
    (out / "docs").mkdir(parents=True, exist_ok=True)
    found: dict[str, dict] = {}
    for name, q in QUERIES.items():
        params = {"q": q, "dateRange": "custom", "startdt": start, "enddt": end, "forms": "8-K,10-Q,10-K"}
        d = json.loads(get("https://efts.sec.gov/LATEST/search-index?" + urllib.parse.urlencode(params), ua))
        for hit in d.get("hits", {}).get("hits", []):
            s = hit["_source"]
            if (s.get("file_type") or "").startswith("EX-10"):
                found.setdefault(hit["_id"], {"query": name, **{k: s.get(k) for k in (
                    "ciks", "adsh", "file_type", "form", "file_date", "display_names", "file_description", "period_ending")}})
    meta = {}
    for id_, c in found.items():
        adsh, filename = id_.split(":", 1)
        url = f"https://www.sec.gov/Archives/edgar/data/{int(c['ciks'][0])}/{adsh.replace('-', '')}/{filename}"
        path = out / "docs" / f"{adsh}_{filename}"
        if not path.exists():
            path.write_bytes(get(url, ua))
        data = path.read_bytes()
        meta[id_] = {**c, "url": url, "path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"{len(meta)} exhibits")


if __name__ == "__main__":
    main(*sys.argv[1:])
