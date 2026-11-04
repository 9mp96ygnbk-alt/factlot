#!/usr/bin/env python3
"""Download the SEC EDGAR files the registry's SEC adapters read, within the SEC's fair access policy.

Standard library only. Every request goes to www.sec.gov, data.sec.gov or efts.sec.gov and carries the declared
User-Agent from the environment variable FACTLOT_SEC_USER_AGENT (the contact the owner approved for SEC requests;
it is read from the environment and written nowhere). One stream, at most 4 requests per second (the SEC allows 10),
HTTP 403/429/503 are backed off and retried, files already on disk are not fetched again, and every request is
logged to ``requests.log`` in the output directory.

    FACTLOT_SEC_USER_AGENT="Name contact@example.com" scripts/registry/sec_edgar.py trusts OUTDIR 2026/QTR3 2026/QTR4
    FACTLOT_SEC_USER_AGENT="..." scripts/registry/sec_edgar.py exhibit21 OUTDIR PLD SPG WMT ...

``trusts`` reads the EDGAR full-index ``form.idx`` of the given quarters (one request each), takes the latest ABS-EE
filing of every issuing entity whose name looks like a CMBS trust, and fetches that filing's index and Exhibit 102 XML;
a file whose root element is not the CMBS asset data namespace is recorded as not CMBS. ``exhibit21`` resolves each
ticker through ``company_tickers.json``, reads the registrant's ``data.sec.gov`` submissions JSON, and fetches the
Exhibit 21 of its latest Form 10-K. Both write ``status.json`` (what each entity or registrant gave) beside the files,
which the registry adapters (``sec_cmbs``, ``sec_exhibit21``) are then run on.
"""

from __future__ import annotations

import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

HOSTS = frozenset({"www.sec.gov", "data.sec.gov", "efts.sec.gov"})
MIN_INTERVAL = 0.25  # seconds between requests: 4 per second, under the SEC's 10
CMBS_NAMESPACE_PART = "/cmbs/"
CMBS_NAME = re.compile(
    r"commercial mortgage|CMBS|\bBANK5?\b|BBCMS|Benchmark|COMM \d|CSAIL|\bCD \d|CGCMT|GS Mortgage Securities Trust|MSBAM|"
    r"Morgan Stanley Capital I|Morgan Stanley Bank|UBS Commercial|WFCM|Wells Fargo Commercial|BMO \d|DBJPM|JPMBB|JPMCC|"
    r"JPMDB|\bBX \d|CSMC|\bCF \d|CFCRE|DBGS|FIVE \d|MSWF|3650R|Citigroup Commercial|Mortgage Trust|Mortgage Securities", re.I)
DEPOSITOR = re.compile(r"(Securities LLC|Securities Inc|Securities Corp|Capital I Inc\.|Commercial Mortgage Inc\.|"
                       r"Asset Receiving)", re.I)


class Client:
    """A throttled, logging, caching SEC client. ``clock`` and ``sleep`` can be replaced in tests."""

    def __init__(self, out_dir: Path, *, user_agent: str | None = None, interval: float = MIN_INTERVAL,
                 opener: Callable = urllib.request.urlopen, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        ua = user_agent if user_agent is not None else os.environ.get("FACTLOT_SEC_USER_AGENT", "")
        if "@" not in ua:
            raise SystemExit("set FACTLOT_SEC_USER_AGENT to a declared User-Agent with a contact address, "
                             "as the SEC's fair access policy asks")
        if interval < 0.2:
            raise SystemExit("refusing an interval under 0.2 s: the SEC asks for at most 10 requests a second, and this is one stream")
        self.ua, self.interval, self.out = ua, interval, Path(out_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self._open, self._clock, self._sleep, self._last = opener, clock, sleep, None
        self.requests = 0

    def _log(self, line: str) -> None:
        with open(self.out / "requests.log", "a") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {line}\n")

    def get(self, url: str, dest: Path | None = None, retries: int = 3) -> bytes:
        host = urlparse(url).hostname
        if urlparse(url).scheme != "https" or host not in HOSTS:
            raise ValueError(f"not an SEC host: {url}")
        if dest is not None and dest.exists() and dest.stat().st_size > 0:
            return dest.read_bytes()
        for attempt in range(retries):
            if self._last is not None:
                wait = self.interval - (self._clock() - self._last)
                if wait > 0:
                    self._sleep(wait)
            self._last = self._clock()
            req = urllib.request.Request(url, headers={"User-Agent": self.ua, "Accept-Encoding": "gzip", "Host": host or ""})
            self.requests += 1
            try:
                with self._open(req, timeout=120) as r:
                    data = r.read()
                    if r.headers.get("Content-Encoding") == "gzip":
                        data = gzip.decompress(data)
                    code = r.status
            except urllib.error.HTTPError as e:
                self._log(f"{e.code} {url}")
                e.close()
                if e.code in (403, 429, 503) and attempt + 1 < retries:
                    self._sleep(10 * (attempt + 1))
                    continue
                raise
            self._log(f"{code} {len(data)} {url}")
            if dest is not None:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            return data
        raise RuntimeError(f"gave up on {url}")


def abs_ee_rows(form_idx: str) -> list[tuple[str, str, str, str]]:
    """``(company name, CIK, filing date, path)`` of every ABS-EE row of an EDGAR ``form.idx`` file."""
    rows = []
    for line in form_idx.splitlines():
        if not line.startswith("ABS-EE "):
            continue
        m = re.match(r"ABS-EE\s+(.*?)\s{2,}(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\S+)", line)
        if m:
            rows.append(m.groups())
    return rows


def cmbs_candidates(rows: list[tuple[str, str, str, str]]) -> list[dict]:
    """The latest ABS-EE of each issuing entity whose name looks like a CMBS trust (depositors are left out)."""
    latest: dict[str, tuple[str, str, str, str]] = {}
    for name, cik, filed, path in rows:
        if cik not in latest or (filed, path) > (latest[cik][2], latest[cik][3]):
            latest[cik] = (name, cik, filed, path)
    out = []
    for name, cik, filed, path in latest.values():
        if CMBS_NAME.search(name) and not DEPOSITOR.search(name):
            acc = re.search(r"/(\d{10}-\d{2}-\d{6})\.txt", path)
            if acc:
                out.append({"name": name, "cik": cik, "filed": filed, "accession": acc.group(1)})
    return sorted(out, key=lambda c: int(c["cik"]))


def exhibit_files(index_json: dict) -> list[str]:
    """XML file names in a filing's ``index.json``, Exhibit 102 candidates (names with 102) first, else the largest."""
    xml = [i for i in index_json["directory"]["item"] if i["name"].lower().endswith(".xml")]
    named = [i["name"] for i in xml if "102" in i["name"]]
    return named or [i["name"] for i in sorted(xml, key=lambda i: -int(i.get("size") or 0))[:1]]


def ex21_link(index_html: str) -> tuple[str, str] | None:
    """``(href, type)`` of the first EX-21* document in a filing index page."""
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", index_html, re.S):
        types = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        href = re.search(r'href="((?:/ix\?doc=)?/Archives/edgar/data/[^"]+)"', row)
        for t in types:
            if re.fullmatch(r"EX-21(?:\.\d+)?", t) and href:
                return href.group(1).replace("/ix?doc=", ""), t
    return None


def fetch_trusts(client: Client, quarters: list[str]) -> dict:
    rows: list = []
    for q in quarters:
        rows += abs_ee_rows(client.get(f"https://www.sec.gov/Archives/edgar/full-index/{q}/form.idx",
                                       client.out / f"form-{q.replace('/', '-')}.idx").decode("latin1"))
    status: dict = {}
    for c in cmbs_candidates(rows):
        nd = c["accession"].replace("-", "")
        base = f"https://www.sec.gov/Archives/edgar/data/{c['cik']}/{nd}"
        d = client.out / "trusts" / f"{c['cik']}_{c['accession']}"
        try:
            idx = json.loads(client.get(base + "/index.json", d / "index.json"))
            names = exhibit_files(idx)
            if not names:
                status[c["cik"]] = {**c, "ok": False, "why": "no xml exhibit"}
                continue
            data = client.get(f"{base}/{names[0]}", d / names[0])
            ns = re.search(rb'xmlns="([^"]+)"', data[:600])
            status[c["cik"]] = {**c, "ok": bool(ns and CMBS_NAMESPACE_PART.encode() in ns.group(1)), "file": names[0],
                                "bytes": len(data), "namespace": ns.group(1).decode() if ns else None}
        except (urllib.error.HTTPError, ValueError, KeyError) as e:
            status[c["cik"]] = {**c, "ok": False, "why": repr(e)}
    (client.out / "status.json").write_text(json.dumps(status, indent=1))
    return status


def fetch_exhibit21(client: Client, tickers: list[str]) -> dict:
    listing = json.loads(client.get("https://www.sec.gov/files/company_tickers.json", client.out / "company_tickers.json"))
    by_ticker = {v["ticker"]: v for v in listing.values()}
    status: dict = {}
    for t in tickers:
        if t not in by_ticker:
            status[t] = {"ok": False, "why": "ticker not in company_tickers.json"}
            continue
        cik = by_ticker[t]["cik_str"]
        rec: dict = {"ticker": t, "cik": cik, "ok": False}
        try:
            sub = json.loads(client.get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", client.out / f"{t}_submissions.json"))
            rec.update(name=sub["name"], sic=sub.get("sic"), state_of_incorporation=sub.get("stateOfIncorporation"))
            r = sub["filings"]["recent"]
            i = next((k for k, f in enumerate(r["form"]) if f == "10-K"), None)
            if i is None:
                rec["why"] = "no 10-K in recent filings"
            else:
                acc = r["accessionNumber"][i]
                rec.update(accession=acc, filed=r["filingDate"][i], report_date=r["reportDate"][i])
                page = client.get(f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{acc}-index.htm",
                                  client.out / f"{t}_{acc}-index.htm").decode("utf8", "replace")
                link = ex21_link(page)
                if link is None:
                    rec["why"] = "no EX-21 in the filing index"
                else:
                    href, typ = link
                    fn = Path(href).name
                    data = client.get("https://www.sec.gov" + href, client.out / f"{t}_{acc}_{fn}")
                    rec.update(ok=True, file=f"{t}_{acc}_{fn}", type=typ, bytes=len(data), url="https://www.sec.gov" + href)
        except (urllib.error.HTTPError, ValueError, KeyError) as e:
            rec["why"] = repr(e)
        status[t] = rec
    (client.out / "status.json").write_text(json.dumps(status, indent=1))
    return status


def main(argv: list[str]) -> int:
    if len(argv) < 4 or argv[1] not in ("trusts", "exhibit21"):
        print(__doc__)
        return 2
    client = Client(Path(argv[2]))
    status = fetch_trusts(client, argv[3:]) if argv[1] == "trusts" else fetch_exhibit21(client, argv[3:])
    print(json.dumps({"requests": client.requests, "ok": sum(1 for v in status.values() if v.get("ok")), "total": len(status)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
