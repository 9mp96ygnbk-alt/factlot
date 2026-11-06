"""Collector tests against a local HTTP server (no internet): robots.txt, rate limiting, host
allow-listing, discovery, conditional re-download, and manifest/snapshot integrity."""

import hashlib
import json
import tempfile
import threading
import time
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from factlot.collector import CollectorConfig, PoliteFetcher, SourceSpec, discover, snapshot
from factlot.collector.core import _host_ok

REQUESTS: list[tuple[str, str]] = []
TRUNCATE: list[int] = []


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def do_GET(self):
        REQUESTS.append((self.path, self.headers.get("User-Agent", "")))
        if self.path == "/export?type=3":  # a script that serves a file and names it in a header
            body = (Path(self.directory) / "files" / "roll_2026.zip").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment;filename="ROLL_NAMED.ZIP"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/export?truncated=1":  # a flaky link: the body stops short, then succeeds
            body = (Path(self.directory) / "files" / "roll_2026.zip").read_bytes()
            TRUNCATE.append(1)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body if len(TRUNCATE) > 1 else body[:5])
            return
        if self.path == "/export?resumable=1":  # a flaky link on a host that honours Range
            body = (Path(self.directory) / "files" / "roll_2026.zip").read_bytes()
            TRUNCATE.append(1)
            rng = self.headers.get("Range")
            if rng:
                start = int(rng.removeprefix("bytes=").rstrip("-"))
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}")
                self.send_header("Content-Length", str(len(body) - start))
                self.end_headers()
                self.wfile.write(body[start:])
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body[:5])
            return
        if self.path == "/export?dropped=1":  # the connection closes before any response, once
            TRUNCATE.append(1)
            if len(TRUNCATE) == 1:
                self.close_connection = True
                self.connection.close()
                return
            body = (Path(self.directory) / "files" / "roll_2026.zip").read_bytes()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/export?norange=1":  # truncates, hangs up on a Range request, then serves whole
            body = (Path(self.directory) / "files" / "roll_2026.zip").read_bytes()
            TRUNCATE.append(1)
            if self.headers.get("Range"):
                self.close_connection = True
                self.connection.close()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body if len(TRUNCATE) > 1 else body[:5])
            return
        if self.path == "/export?paging=1":  # ArcGIS Hub's later export stage, also HTTP 200
            body = b'{"status":"PagingData","recordCount":5135}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/export?pending=1":  # an export API still preparing the file
            body = b'{"status":"Pending","progress":0.4}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()


class Collector(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = Path(tempfile.mkdtemp())
        (cls.site / "files").mkdir()
        (cls.site / "private").mkdir()
        (cls.site / "robots.txt").write_text("User-agent: *\nDisallow: /private/\n")
        (cls.site / "files" / "roll_2026.zip").write_bytes(b"synthetic roll v1")
        (cls.site / "private" / "secret.zip").write_bytes(b"do not fetch")
        (cls.site / "downloads.html").write_text(
            '<a href="files/roll_2026.zip">Appraisal roll 2026</a> <a href="/private/secret.zip">private</a> '
            '<a href="https://elsewhere.example/other.zip">offsite</a> <a href="about.html">About</a>')
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(cls.site)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        # A JSON listing, as some publishers' download pages are filled from an API endpoint.
        (cls.site / "downloads.json").write_text(json.dumps([
            {"downloadLink": f"{cls.base}/files/roll_2026.zip", "downloadLinkText": "Roll from a JSON listing", "description": "x"},
            {"downloadLink": "https://elsewhere.example/other.zip", "downloadLinkText": "offsite"},
        ]))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        REQUESTS.clear()
        self.cfg = CollectorConfig(contact="test@example.invalid", min_interval=0.2, timeout=10, allow_private_addresses=True)
        self.spec = SourceSpec("test-cad", "Test CAD", [f"{self.base}/downloads.html"], ["127.0.0.1"])

    def test_discover_obeys_robots_and_hosts(self):
        report = discover(PoliteFetcher(self.cfg), self.spec)
        self.assertEqual(report["pages"][0]["status"], "ok")
        links = {link["url"]: link for link in report["links"]}
        self.assertEqual(set(links), {f"{self.base}/files/roll_2026.zip", f"{self.base}/private/secret.zip"})
        self.assertEqual(links[f"{self.base}/private/secret.zip"]["robots_allowed"], "false")
        self.assertEqual(links[f"{self.base}/files/roll_2026.zip"]["text"], "Appraisal roll 2026")
        self.assertTrue(all("FactLotRegistryBot/" in ua and "test@example.invalid" in ua for _, ua in REQUESTS))
        self.assertNotIn("/private/secret.zip", [p for p, _ in REQUESTS], "discovery never downloads")

    def test_snapshot_archives_once_and_refuses_disallowed(self):
        out = Path(tempfile.mkdtemp())
        f = PoliteFetcher(self.cfg)
        urls = [f"{self.base}/files/roll_2026.zip", f"{self.base}/private/secret.zip", "https://elsewhere.example/x.zip"]
        first = snapshot(f, self.spec, urls, out)
        self.assertEqual([r["status"].split(":")[0] for r in first], ["archived", "robots_disallowed", "skipped_host_not_allowed"])
        digest = hashlib.sha256(b"synthetic roll v1").hexdigest()
        self.assertEqual(first[0]["document_id"], f"fl:document:sha256-{digest}")
        self.assertEqual((out / first[0]["path"]).read_bytes(), b"synthetic roll v1")
        self.assertNotIn("/private/secret.zip", [p for p, _ in REQUESTS])

        again = snapshot(f, self.spec, urls[:1], out)
        self.assertEqual(again[0]["status"], "unchanged", "conditional GET: 304 or identical content")

        time.sleep(1.1)  # make the file's mtime newer than the previous Last-Modified
        (self.site / "files" / "roll_2026.zip").write_bytes(b"synthetic roll v2")
        third = snapshot(f, self.spec, urls[:1], out)
        self.assertEqual(third[0]["status"], "archived")
        self.assertNotEqual(third[0]["sha256"], digest)
        manifest = [json.loads(line) for line in (out / "test-cad" / "manifest.jsonl").read_text().splitlines()]
        self.assertEqual([m["status"].split(":")[0] for m in manifest],
                         ["archived", "robots_disallowed", "skipped_host_not_allowed", "unchanged", "archived"])
        (self.site / "files" / "roll_2026.zip").write_bytes(b"synthetic roll v1")

    def test_rate_limit_per_host(self):
        f = PoliteFetcher(CollectorConfig(contact="t@example.invalid", min_interval=0.3, timeout=10, allow_private_addresses=True))
        start = time.monotonic()
        for _ in range(3):
            with f.get(f"{self.base}/downloads.html") as r:
                r.read()
        # robots.txt + 3 pages = 4 requests to one host → at least 3 intervals
        self.assertGreaterEqual(time.monotonic() - start, 0.85)

    def test_unreachable_site_is_reported_not_raised(self):
        spec = SourceSpec("down", "Down", ["http://127.0.0.1:9/nothing.html"], ["127.0.0.1"])
        report = discover(PoliteFetcher(CollectorConfig(contact="t@example.invalid", min_interval=0, timeout=2, allow_private_addresses=True)), spec)
        self.assertTrue(report["pages"][0]["status"].startswith("unreachable"), report["pages"][0]["status"])


    def test_snapshot_names_the_file_from_content_disposition(self):
        out = Path(tempfile.mkdtemp())
        spec = SourceSpec("script-cad", "Script CAD", [f"{self.base}/"], ["127.0.0.1"], link_patterns=[r"type=3"])
        [rec] = snapshot(PoliteFetcher(self.cfg), spec, [f"{self.base}/export?type=3"], out)
        self.assertEqual(rec["status"], "archived")
        self.assertTrue(rec["path"].endswith("/ROLL_NAMED.ZIP"), rec["path"])
        self.assertEqual((out / rec["path"]).read_bytes(), b"synthetic roll v1")

    def test_snapshot_does_not_archive_an_export_placeholder(self):
        out = Path(tempfile.mkdtemp())
        spec = SourceSpec("api-cad", "API CAD", [f"{self.base}/"], ["127.0.0.1"], link_patterns=[r"pending"])
        [rec] = snapshot(PoliteFetcher(self.cfg), spec, [f"{self.base}/export?pending=1"], out)
        self.assertEqual(rec["status"], "not_ready")
        self.assertNotIn("document_id", rec)
        self.assertEqual([p for p in (out / "api-cad").iterdir() if p.is_dir()], [], "nothing archived")

    def test_snapshot_retries_a_truncated_download_and_never_archives_a_partial_file(self):
        out = Path(tempfile.mkdtemp())
        TRUNCATE.clear()
        spec = SourceSpec("flaky-cad", "Flaky CAD", [f"{self.base}/"], ["127.0.0.1"], link_patterns=[r"truncated"])
        [rec] = snapshot(PoliteFetcher(self.cfg), spec, [f"{self.base}/export?truncated=1"], out)
        self.assertEqual(rec["status"], "archived")
        self.assertEqual(rec["retries"], 1)
        self.assertEqual((out / rec["path"]).read_bytes(), b"synthetic roll v1")
        self.assertFalse((out / "flaky-cad" / ".download.part").exists())

        TRUNCATE.clear()
        cfg = CollectorConfig(contact="t@example.invalid", min_interval=0.1, timeout=10, retries=0, allow_private_addresses=True)
        [rec] = snapshot(PoliteFetcher(cfg), spec, [f"{self.base}/export?truncated=1"], Path(tempfile.mkdtemp()))
        self.assertTrue(rec["status"].startswith("error: incomplete read"), rec["status"])
        self.assertNotIn("document_id", rec)

    def test_snapshot_resumes_a_truncated_download_with_a_range_request(self):
        out = Path(tempfile.mkdtemp())
        TRUNCATE.clear()
        spec = SourceSpec("resume-cad", "Resume CAD", [f"{self.base}/"], ["127.0.0.1"], link_patterns=[r"resumable"])
        [rec] = snapshot(PoliteFetcher(self.cfg), spec, [f"{self.base}/export?resumable=1"], out)
        self.assertEqual(rec["status"], "archived")
        self.assertEqual(rec["retries"], 1)
        self.assertEqual((out / rec["path"]).read_bytes(), b"synthetic roll v1")
        self.assertEqual(rec["sha256"], hashlib.sha256(b"synthetic roll v1").hexdigest(), "hash spans both parts")
        self.assertEqual(rec["resumed_from"], 5)
        self.assertEqual(len(TRUNCATE), 2, "one request for the first 5 bytes, one Range request for the rest")

    def test_snapshot_retries_a_dropped_connection(self):
        out = Path(tempfile.mkdtemp())
        TRUNCATE.clear()
        spec = SourceSpec("drop-cad", "Drop CAD", [f"{self.base}/"], ["127.0.0.1"], link_patterns=[r"dropped"])
        [rec] = snapshot(PoliteFetcher(self.cfg), spec, [f"{self.base}/export?dropped=1"], out)
        self.assertEqual(rec["status"], "archived", rec)
        self.assertEqual(rec["retries"], 1)
        self.assertEqual((out / rec["path"]).read_bytes(), b"synthetic roll v1")

    def test_snapshot_falls_back_to_a_plain_request_when_the_host_hangs_up_on_range(self):
        out = Path(tempfile.mkdtemp())
        TRUNCATE.clear()
        spec = SourceSpec("norange-cad", "No-Range CAD", [f"{self.base}/"], ["127.0.0.1"], link_patterns=[r"norange"])
        [rec] = snapshot(PoliteFetcher(self.cfg), spec, [f"{self.base}/export?norange=1"], out)
        self.assertEqual(rec["status"], "archived", rec)
        self.assertEqual(rec["retries"], 2, "truncated, hung up on Range, then whole")
        self.assertNotIn("resumed_from", rec)
        self.assertEqual((out / rec["path"]).read_bytes(), b"synthetic roll v1")

    def test_snapshot_does_not_archive_a_hub_paging_status(self):
        out = Path(tempfile.mkdtemp())
        spec = SourceSpec("hub-cad", "Hub CAD", [f"{self.base}/"], ["127.0.0.1"], link_patterns=[r"paging"])
        [rec] = snapshot(PoliteFetcher(self.cfg), spec, [f"{self.base}/export?paging=1"], out)
        self.assertEqual(rec["status"], "not_ready")
        self.assertNotIn("document_id", rec)

    def test_strip_default_port(self):
        from factlot.collector.core import strip_default_port

        self.assertEqual(strip_default_port("https://s3.amazonaws.com:443/b/k?X=1"), "https://s3.amazonaws.com/b/k?X=1")
        self.assertEqual(strip_default_port("http://h:80/p"), "http://h/p")
        self.assertEqual(strip_default_port("https://h:8443/p"), "https://h:8443/p", "non-default ports stay")
        self.assertEqual(strip_default_port("https://h/p"), "https://h/p")

    def test_discover_reads_json_listings(self):
        spec = SourceSpec("json-cad", "JSON CAD", [f"{self.base}/downloads.json"], ["127.0.0.1"])
        report = discover(PoliteFetcher(self.cfg), spec)
        self.assertEqual(report["pages"][0]["status"], "ok")
        self.assertEqual([(l["url"], l["text"]) for l in report["links"]],
                         [(f"{self.base}/files/roll_2026.zip", "Roll from a JSON listing")])

    def test_crawl_delay_from_robots_lengthens_the_interval(self):
        import urllib.robotparser

        f = PoliteFetcher(CollectorConfig(contact="t@example.invalid", min_interval=0.2, timeout=10, allow_private_addresses=True))
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(["User-agent: *", "Crawl-delay: 1", "Disallow:"])
        f._apply_robots("slow.example", rp)
        self.assertEqual(f.interval("slow.example"), 1.0)
        self.assertEqual(f.interval("other.example"), 0.2)
        start = time.monotonic()
        f._wait("slow.example")
        f._wait("slow.example")
        self.assertGreaterEqual(time.monotonic() - start, 0.95)

    def test_clean_url_encodes_verbatim_spaces_and_backslashes(self):
        from factlot.collector.core import clean_url

        raw = r"https://cad.example/View.aspx?type=3&id=\\SRV\DATA PRODUCTS\ROLL.ZIP"
        self.assertEqual(clean_url(raw), "https://cad.example/View.aspx?type=3&id=%5C%5CSRV%5CDATA%20PRODUCTS%5CROLL.ZIP")
        self.assertEqual(clean_url(clean_url(raw)), clean_url(raw), "idempotent")


class SourceConfigs(unittest.TestCase):
    def test_every_source_config_is_valid_and_reviewed(self):
        from factlot.collector import load_sources

        cfg, sources = load_sources(Path(__file__).resolve().parents[2] / "registry" / "sources")
        self.assertIn("@", cfg.contact)
        self.assertGreaterEqual(cfg.min_interval, 1.0)
        ids = [s.source_id for s in sources]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("tx-harris-cad", ids)
        for s in sources:
            self.assertTrue(s.landing_pages and s.allowed_hosts)
            if s.verified:
                # Data policy §5: a verified source has confirmed files and a recorded terms review.
                self.assertTrue(s.files, f"{s.source_id}: verified without confirmed files")
                self.assertTrue(s.reviewed and s.license and s.ai_use and s.redistribution,
                                f"{s.source_id}: verified without a recorded review")
            else:
                # Confirmed file URLs may be recorded ahead of the gate; the snapshot command skips
                # unverified sources, and the notes must say what the gate is.
                self.assertTrue(s.notes.strip(), f"{s.source_id}: unverified without a note saying why")

    def test_harris_lists_the_certified_and_the_next_preliminary_roll(self):
        # Protest season: the weekly run must archive HCAD's spring preliminary roll (a new year folder)
        # while keeping the certified roll of the year before. The adapter reads these two files.
        from factlot.collector import load_sources

        _cfg, sources = load_sources(Path(__file__).resolve().parents[2] / "registry" / "sources")
        harris = next(s for s in sources if s.source_id == "tx-harris-cad")
        for year in (2026, 2027):
            for name in ("Real_acct_owner.zip", "Real_building_land.zip"):
                self.assertIn(f"https://download.hcad.org/data/CAMA/{year}/{name}", harris.files)
        self.assertTrue(all(_host_ok(u, harris) for u in harris.files))


if __name__ == "__main__":
    unittest.main()
