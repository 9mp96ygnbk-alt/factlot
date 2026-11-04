"""The SEC download script (scripts/registry/sec_edgar.py): fair-access behaviour and file-listing parsers, offline.

The index lines, company names, CIKs and accession numbers below are INVENTED; no request is made to the SEC.
"""

import importlib.util
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "registry" / "sec_edgar.py"
spec = importlib.util.spec_from_file_location("sec_edgar", SCRIPT)
sec_edgar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sec_edgar)

UA = "Example Collector contact@example.invalid"


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200):
        self._body, self.status, self.headers = body, status, {}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeNet:
    """An opener that records requests and answers from a dict; a value that is an int is an HTTP error code."""

    def __init__(self, answers):
        self.answers, self.seen = answers, []

    def __call__(self, req, timeout=None):
        self.seen.append((req.full_url, req.get_header("User-agent"), req.get_header("Host")))
        a = self.answers[req.full_url]
        if isinstance(a, list):
            a = a.pop(0)
        if isinstance(a, int):
            raise urllib.error.HTTPError(req.full_url, a, "x", {}, None)
        return FakeResponse(a)


class FakeClock:
    def __init__(self):
        self.t, self.slept = 0.0, []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


class TestClient(unittest.TestCase):
    def client(self, net, **kw):
        clock = FakeClock()
        c = sec_edgar.Client(Path(tempfile.mkdtemp()), user_agent=UA, opener=net, clock=clock.now, sleep=clock.sleep, **kw)
        return c, clock

    def test_a_declared_user_agent_with_a_contact_is_required(self):
        with self.assertRaises(SystemExit):
            sec_edgar.Client(Path(tempfile.mkdtemp()), user_agent="")
        with self.assertRaises(SystemExit):
            sec_edgar.Client(Path(tempfile.mkdtemp()), user_agent="NoContactBot")

    def test_it_will_not_go_faster_than_the_policy_allows(self):
        with self.assertRaises(SystemExit):
            sec_edgar.Client(Path(tempfile.mkdtemp()), user_agent=UA, interval=0.05)

    def test_only_sec_hosts_over_https(self):
        c, _ = self.client(FakeNet({}))
        for url in ("https://example.com/x", "http://www.sec.gov/x", "https://evil.sec.gov.example.com/x"):
            with self.assertRaises(ValueError):
                c.get(url)

    def test_requests_are_spaced_carry_the_user_agent_and_are_cached_on_disk(self):
        net = FakeNet({"https://www.sec.gov/a": b"A", "https://data.sec.gov/b": b"B"})
        c, clock = self.client(net)
        d = c.out / "files"
        self.assertEqual(c.get("https://www.sec.gov/a", d / "a"), b"A")
        self.assertEqual(c.get("https://data.sec.gov/b", d / "b"), b"B")
        self.assertEqual(c.get("https://www.sec.gov/a", d / "a"), b"A")  # from disk: no third request
        self.assertEqual(c.requests, 2)
        self.assertEqual([s for _u, s, _h in net.seen], [UA, UA])
        self.assertEqual([h for _u, _s, h in net.seen], ["www.sec.gov", "data.sec.gov"])
        self.assertAlmostEqual(sum(clock.slept), sec_edgar.MIN_INTERVAL)  # one wait between the two requests
        self.assertEqual(len((c.out / "requests.log").read_text().splitlines()), 2)

    def test_rate_limit_responses_are_backed_off_and_retried(self):
        net = FakeNet({"https://www.sec.gov/a": [429, b"A"]})
        c, clock = self.client(net)
        self.assertEqual(c.get("https://www.sec.gov/a"), b"A")
        self.assertEqual(c.requests, 2)
        self.assertGreaterEqual(max(clock.slept), 10)

    def test_other_errors_are_raised(self):
        c, _ = self.client(FakeNet({"https://www.sec.gov/a": 404}))
        with self.assertRaises(urllib.error.HTTPError):
            c.get("https://www.sec.gov/a")


FORM_IDX = """Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------
10-K         EXAMPLE RETAIL INC                                            900001      2026-03-14  edgar/data/900001/0000900001-26-000004.txt
ABS-EE       Example 2026-C1 Mortgage Trust                                1900001     2026-10-13  edgar/data/1900001/0001900001-26-000001.txt
ABS-EE       Example 2026-C1 Mortgage Trust                                1900001     2026-11-03  edgar/data/1900001/0001900001-26-000009.txt
ABS-EE       Example Auto Receivables Trust 2026-1                         1900002     2026-11-03  edgar/data/1900002/0001900002-26-000001.txt
ABS-EE       Example Commercial Mortgage Securities LLC                    1900003     2026-10-01  edgar/data/1900003/0001900003-26-000001.txt
ABS-EE       BANK5 2026-5YR99                                              1900004     2026-10-20  edgar/data/1900004/0001900004-26-000002.txt
"""


class TestParsers(unittest.TestCase):
    def test_abs_ee_rows_and_cmbs_candidates(self):
        rows = sec_edgar.abs_ee_rows(FORM_IDX)
        self.assertEqual(len(rows), 5)
        got = sec_edgar.cmbs_candidates(rows)
        # the latest filing of each trust; the auto trust and the depositor are left out
        self.assertEqual([(c["cik"], c["accession"], c["filed"]) for c in got],
                         [("1900001", "0001900001-26-000009", "2026-11-03"), ("1900004", "0001900004-26-000002", "2026-10-20")])

    def test_exhibit_files_prefers_the_102_name_and_falls_back_to_the_largest_xml(self):
        item = lambda n, s: {"name": n, "size": s}  # noqa: E731
        idx = {"directory": {"item": [item("a.htm", "10"), item("exh_103.xml", "5"), item("exh_102.xml", "500")]}}
        self.assertEqual(sec_edgar.exhibit_files(idx), ["exh_102.xml"])
        idx = {"directory": {"item": [item("small.xml", "5"), item("assetdata.xml", "900")]}}
        self.assertEqual(sec_edgar.exhibit_files(idx), ["assetdata.xml"])
        self.assertEqual(sec_edgar.exhibit_files({"directory": {"item": [item("a.htm", "1")]}}), [])

    def test_ex21_link_reads_the_document_type_column(self):
        page = ('<table><tr><td>1</td><td>10-K</td><td><a href="/Archives/edgar/data/1/2/main.htm">main.htm</a></td><td>10-K</td></tr>'
                '<tr><td>3</td><td>Subsidiaries</td><td><a href="/ix?doc=/Archives/edgar/data/1/2/ex21.htm">ex21.htm</a></td>'
                '<td>EX-21.1</td></tr><tr><td>4</td><td>Other</td><td><a href="/Archives/edgar/data/1/2/ex210.htm">x</a></td>'
                '<td>EX-10.21</td></tr></table>')
        self.assertEqual(sec_edgar.ex21_link(page), ("/Archives/edgar/data/1/2/ex21.htm", "EX-21.1"))
        self.assertIsNone(sec_edgar.ex21_link("<table><tr><td>EX-10.21</td></tr></table>"))

    def test_fetch_exhibit21_end_to_end_on_a_fake_net(self):
        tickers = json.dumps({"0": {"cik_str": 900001, "ticker": "EXR", "title": "Example Retail Inc"}}).encode()
        sub = json.dumps({"name": "EXAMPLE RETAIL INC", "sic": "5331", "stateOfIncorporation": "DE",
                          "filings": {"recent": {"form": ["8-K", "10-K"], "accessionNumber": ["0000900001-26-000001", "0000900001-26-000004"],
                                                 "filingDate": ["2026-04-01", "2026-03-14"], "reportDate": ["", "2026-01-31"]}}}).encode()
        page = (b'<table><tr><td>2</td><td>Subs</td><td><a href="/Archives/edgar/data/900001/000090000126000004/ex21.htm">x</a></td>'
                b'<td>EX-21</td></tr></table>')
        net = FakeNet({
            "https://www.sec.gov/files/company_tickers.json": tickers,
            "https://data.sec.gov/submissions/CIK0000900001.json": sub,
            "https://www.sec.gov/Archives/edgar/data/900001/000090000126000004/0000900001-26-000004-index.htm": page,
            "https://www.sec.gov/Archives/edgar/data/900001/000090000126000004/ex21.htm": b"<table></table>",
        })
        clock = FakeClock()
        c = sec_edgar.Client(Path(tempfile.mkdtemp()), user_agent=UA, opener=net, clock=clock.now, sleep=clock.sleep)
        status = sec_edgar.fetch_exhibit21(c, ["EXR", "NOPE"])
        self.assertTrue(status["EXR"]["ok"])
        self.assertEqual((status["EXR"]["accession"], status["EXR"]["report_date"], status["EXR"]["type"]),
                         ("0000900001-26-000004", "2026-01-31", "EX-21"))
        self.assertEqual(status["NOPE"], {"ok": False, "why": "ticker not in company_tickers.json"})
        self.assertEqual(len(net.seen), 4)
        self.assertTrue((c.out / "status.json").exists())


if __name__ == "__main__":
    unittest.main()
