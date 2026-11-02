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

REQUESTS: list[tuple[str, str]] = []


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def do_GET(self):
        REQUESTS.append((self.path, self.headers.get("User-Agent", "")))
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

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        REQUESTS.clear()
        self.cfg = CollectorConfig(contact="test@example.invalid", min_interval=0.2, timeout=10)
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
        f = PoliteFetcher(CollectorConfig(contact="t@example.invalid", min_interval=0.3, timeout=10))
        start = time.monotonic()
        for _ in range(3):
            with f.get(f"{self.base}/downloads.html") as r:
                r.read()
        # robots.txt + 3 pages = 4 requests to one host → at least 3 intervals
        self.assertGreaterEqual(time.monotonic() - start, 0.85)

    def test_unreachable_site_is_reported_not_raised(self):
        spec = SourceSpec("down", "Down", ["http://127.0.0.1:9/nothing.html"], ["127.0.0.1"])
        report = discover(PoliteFetcher(CollectorConfig(contact="t@example.invalid", min_interval=0, timeout=2)), spec)
        self.assertTrue(report["pages"][0]["status"].startswith("unreachable"), report["pages"][0]["status"])


class TexasConfig(unittest.TestCase):
    def test_texas_sources_are_valid_and_unverified(self):
        from factlot.collector import load_sources

        cfg, sources = load_sources(Path(__file__).resolve().parents[2] / "registry" / "sources" / "texas.json")
        self.assertIn("@", cfg.contact)
        self.assertGreaterEqual(cfg.min_interval, 1.0)
        ids = [s.source_id for s in sources]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("tx-harris-cad", ids)
        for s in sources:
            self.assertTrue(s.landing_pages and s.allowed_hosts)
            self.assertFalse(s.verified, "nothing is verified until discovery runs against the live site")


if __name__ == "__main__":
    unittest.main()
