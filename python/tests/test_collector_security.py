"""Collector safety (security audit 2026-11-03): no requests to non-public addresses, including via
redirects and DNS rebinding; file names from publishers cannot leave the snapshot directory; and
responses are size-bounded. Runs offline against a local server and IP literals."""

import json
import tempfile
import threading
import unittest
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from factlot.collector import CollectorConfig, PoliteFetcher, SourceSpec, discover, snapshot
from factlot.collector.core import (
    BlockedURLError,
    _check_peer,
    _json_links,
    _RedirectHandler,
    check_url,
    safe_filename,
)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/export"):
            body = b"synthetic file"
            name = {"/export?evil=1": "../../../escape.zip", "/export?abs=1": "/etc/cron.d/x",
                    "/export?dots=1": "..", "/export?win=1": "..\\\\..\\\\win.zip"}[self.path]
            self.send_response(200)
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/redirect-to-metadata":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()
            return
        return super().do_GET()


class AddressChecks(unittest.TestCase):
    def test_non_public_addresses_and_schemes_are_refused(self):
        for url in ("http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://localhost/",
                    "http://10.0.0.1/", "http://192.168.1.1/", "http://172.16.0.1/", "http://100.64.0.1/",
                    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/", "http://0.0.0.0/",
                    "file:///etc/passwd", "ftp://8.8.8.8/x", "http:///nohost"):
            with self.subTest(url=url), self.assertRaises(BlockedURLError):
                check_url(url)

    def test_public_literal_is_allowed(self):
        check_url("https://8.8.8.8/file.zip")

    def test_redirect_to_a_private_address_is_refused(self):
        handler = _RedirectHandler(allow_private=False)
        req = urllib.request.Request("http://8.8.8.8/download")
        with self.assertRaises(BlockedURLError):
            handler.redirect_request(req, None, 302, "Found", {}, "http://169.254.169.254/latest/meta-data/")
        with self.assertRaises(BlockedURLError):
            handler.redirect_request(req, None, 302, "Found", {}, "file:///etc/passwd")

    def test_connected_peer_is_checked_after_dns(self):
        class Sock:
            def getpeername(self):
                return ("127.0.0.1", 80)

        class Conn:
            sock = Sock()
            _tunnel_host = None
            closed = False

            def close(self):
                self.closed = True

        conn = Conn()
        with mock.patch("urllib.request.getproxies", return_value={}):
            with self.assertRaises(BlockedURLError):
                _check_peer(conn, allow_private=False)
            self.assertTrue(conn.closed)
            _check_peer(Conn(), allow_private=True)  # tests against a local server opt in

    def test_source_id_cannot_name_another_directory(self):
        for bad in ("../x", "a/b", "", ".hidden", "A"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                SourceSpec(bad, "P", [], [])


class FileNames(unittest.TestCase):
    def test_safe_filename(self):
        self.assertEqual(safe_filename("../../etc/passwd"), "passwd")
        self.assertEqual(safe_filename("..\\..\\win.zip"), "win.zip")
        self.assertEqual(safe_filename("%2e%2e%2fevil.csv"), "evil.csv")
        self.assertEqual(safe_filename("/abs/path.csv"), "path.csv")
        self.assertEqual(safe_filename(".bashrc"), "bashrc")
        self.assertEqual(safe_filename("a\x00b\nc.zip"), "abc.zip")
        self.assertIsNone(safe_filename(".."))
        self.assertIsNone(safe_filename("dir/"))
        long = safe_filename("x" * 500 + ".zip")
        self.assertTrue(long.endswith(".zip") and len(long.encode()) <= 200)

    def test_json_listing_walk_is_iterative(self):
        deep = {"url": "https://example.gov/a.zip", "name": "A"}
        for _ in range(5000):
            deep = [deep]
        self.assertEqual(_json_links(deep), [("https://example.gov/a.zip", "A")])
        listing = [{"downloadLink": "/x.zip", "text": "X", "more": [{"href": "//h/y.zip"}]}]
        self.assertEqual(_json_links(listing), [("/x.zip", "X"), ("//h/y.zip", "")])


class AgainstALocalServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = Path(tempfile.mkdtemp())
        (cls.site / "robots.txt").write_text("User-agent: *\nAllow: /\n")
        (cls.site / "big.html").write_text("<a href='x.zip'>x</a>" * 100)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(cls.site)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def cfg(self, **kw):
        return CollectorConfig(contact="t@example.invalid", min_interval=0, timeout=10, **kw)

    def spec(self):
        return SourceSpec("sec-cad", "Sec CAD", [f"{self.base}/big.html"], ["127.0.0.1"])

    def test_default_config_refuses_a_local_server(self):
        out = Path(tempfile.mkdtemp())
        [rec] = snapshot(PoliteFetcher(self.cfg()), self.spec(), [f"{self.base}/export?evil=1"], out)
        self.assertTrue(rec["status"].startswith("refused"), rec["status"])
        report = discover(PoliteFetcher(self.cfg()), self.spec())
        self.assertTrue(report["pages"][0]["status"].startswith("error"), report["pages"][0])

    def test_content_disposition_cannot_escape_the_snapshot_directory(self):
        out = Path(tempfile.mkdtemp())
        fetcher = PoliteFetcher(self.cfg(allow_private_addresses=True))
        urls = [f"{self.base}/export?{q}=1" for q in ("evil", "abs", "dots", "win")]
        recs = snapshot(fetcher, self.spec(), urls, out)
        names = []
        for rec in recs:
            self.assertEqual(rec["status"], "archived", rec)
            path = (out / rec["path"]).resolve()
            self.assertTrue(path.is_relative_to((out / "sec-cad").resolve()), path)
            names.append(path.name)
        self.assertEqual(names[0], "escape.zip")
        self.assertEqual(names[1], "x")
        self.assertEqual(names[2], "export")  # ".." is dropped; the URL path names the file
        self.assertEqual(names[3], "win.zip")
        self.assertFalse((out.parent / "escape.zip").exists())

    def test_files_over_max_file_bytes_are_refused_and_not_kept(self):
        out = Path(tempfile.mkdtemp())
        fetcher = PoliteFetcher(self.cfg(allow_private_addresses=True, max_file_bytes=5))
        [rec] = snapshot(fetcher, self.spec(), [f"{self.base}/export?evil=1"], out)
        self.assertTrue(rec["status"].startswith("refused: file exceeds"), rec["status"])
        self.assertEqual([p for p in (out / "sec-cad").iterdir() if p.name != "manifest.jsonl"], [])

    def test_landing_pages_over_max_page_bytes_are_not_parsed(self):
        fetcher = PoliteFetcher(self.cfg(allow_private_addresses=True, max_page_bytes=50))
        report = discover(fetcher, self.spec())
        self.assertIn("exceeds 50 bytes", report["pages"][0]["status"])
        self.assertEqual(report["links"], [])

    def test_redirect_from_an_allowed_host_to_metadata_is_refused(self):
        # The first hop is local (allowed for the test), the target is link-local: refused even so,
        # because the redirect check uses the same rule set minus the test opt-in for private ranges.
        fetcher = PoliteFetcher(self.cfg(allow_private_addresses=True))
        fetcher.opener = urllib.request.build_opener(_RedirectHandler(False))
        out = Path(tempfile.mkdtemp())
        [rec] = snapshot(fetcher, self.spec(), [f"{self.base}/redirect-to-metadata"], out)
        self.assertTrue(rec["status"].startswith("refused"), rec["status"])
        self.assertIn("169.254.169.254", rec["status"])


if __name__ == "__main__":
    unittest.main()


class IngestHardening(unittest.TestCase):
    def test_review_listing_escapes_control_characters(self):
        from factlot.ingest import Candidate, ReviewItem

        cand = Candidate("lease.rent", 1, "quote", 1)
        item = ReviewItem.queue(cand, check="consistency", reason="r\x1b[2J", document_id="d",
                                title="T\x1b]0;pwned\x07", page=1)
        text = item.describe()
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\x07", text)
        self.assertIn("\\x1b", text)

    def test_ocr_passes_an_absolute_image_path(self):
        from factlot.ingest import ocr

        with mock.patch("shutil.which", return_value="/usr/bin/tesseract"):
            backend = ocr.TesseractOcr()
        seen = []

        def fake_run(cmd, **kw):
            seen.append(cmd)
            return mock.Mock(returncode=0, stdout="text", stderr="")

        with mock.patch("subprocess.run", side_effect=fake_run):
            backend(Path("-l"))
        self.assertTrue(seen[0][1].startswith("/"), seen[0])
