"""A polite public-data collector: discover download links and archive files as snapshots.

Rules it enforces (docs/registry/data-policy.md §2):
- identifies itself with a User-Agent that includes a contact address;
- obeys robots.txt for every URL it fetches (a missing robots.txt means allowed);
- waits at least `min_interval` seconds between requests to the same host;
- uses conditional requests (If-None-Match / If-Modified-Since) so unchanged files are not re-downloaded;
- never logs in, never solves CAPTCHAs, never follows links off the configured hosts.

Every archived file becomes a content-addressed snapshot (sha256) with a manifest entry: source,
URL, retrieval time, size, HTTP validators, and robots status. Re-running is idempotent.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

VERSION = "0.1"


@dataclass
class CollectorConfig:
    contact: str  # e.g. "registry@factlot.com"
    min_interval: float = 1.0
    timeout: float = 120.0
    user_agent_product: str = "FactLotRegistryBot"

    @property
    def user_agent(self) -> str:
        return f"{self.user_agent_product}/{VERSION} (+https://factlot.com/registry; {self.contact})"


@dataclass
class SourceSpec:
    source_id: str
    publisher: str
    landing_pages: list[str]
    allowed_hosts: list[str]
    link_patterns: list[str] = field(default_factory=lambda: [r"\.(zip|csv|txt|json|geojson|gdb\.zip)(\?|$)"])
    files: list[str] = field(default_factory=list)  # explicit file URLs, once confirmed
    verified: bool = False  # landing pages / files confirmed against the live site
    notes: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SourceSpec":
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})


class _Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href:
            self.links.append((self._href, " ".join("".join(self._text).split())))
            self._href = None


class PoliteFetcher:
    def __init__(self, config: CollectorConfig, opener: urllib.request.OpenerDirector | None = None) -> None:
        self.config = config
        self.opener = opener or urllib.request.build_opener()
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._unreachable: dict[str, str] = {}
        self.log: list[dict[str, Any]] = []

    def _wait(self, host: str) -> None:
        last = self._last.get(host)
        if last is not None:
            delay = self.config.min_interval - (time.monotonic() - last)
            if delay > 0:
                time.sleep(delay)
        self._last[host] = time.monotonic()

    def _request(self, url: str, headers: dict[str, str] | None = None):
        req = urllib.request.Request(url, headers={"User-Agent": self.config.user_agent, **(headers or {})})
        self._wait(urllib.parse.urlsplit(url).netloc)
        return self.opener.open(req, timeout=self.config.timeout)

    def allowed(self, url: str) -> bool:
        parts = urllib.parse.urlsplit(url)
        root = f"{parts.scheme}://{parts.netloc}"
        if root not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                with self._request(f"{root}/robots.txt") as resp:
                    rp.parse(resp.read().decode("utf-8", "replace").splitlines())
                self._robots[root] = rp
            except urllib.error.HTTPError as e:
                # 4xx: no robots rules → allowed. 5xx: be conservative and treat the site as unavailable.
                self._robots[root] = None if 400 <= e.code < 500 else rp
                if e.code >= 500:
                    rp.disallow_all = True
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                # Network failure: we could not read robots.txt, so we must not fetch — but say why.
                self._unreachable[root] = str(getattr(e, "reason", e))
                rp.disallow_all = True
                self._robots[root] = rp
        rp = self._robots[root]
        return True if rp is None else rp.can_fetch(self.config.user_agent, url)

    def get(self, url: str, headers: dict[str, str] | None = None):
        allowed = self.allowed(url)
        parts = urllib.parse.urlsplit(url)
        root = f"{parts.scheme}://{parts.netloc}"
        if root in self._unreachable:
            raise ConnectionError(f"site unreachable (robots.txt could not be fetched): {self._unreachable[root]}")
        if not allowed:
            raise PermissionError(f"robots.txt disallows {url}")
        return self._request(url, headers)


def _host_ok(url: str, spec: SourceSpec) -> bool:
    host = urllib.parse.urlsplit(url).hostname or ""
    return any(host == h or host.endswith("." + h) for h in spec.allowed_hosts)


def discover(fetcher: PoliteFetcher, spec: SourceSpec) -> dict[str, Any]:
    """Fetch the source's landing pages and list candidate download links (nothing is downloaded)."""
    found: list[dict[str, str]] = []
    pages: list[dict[str, Any]] = []
    patterns = [re.compile(p, re.I) for p in spec.link_patterns]
    for page in spec.landing_pages:
        entry: dict[str, Any] = {"url": page}
        try:
            with fetcher.get(page) as resp:
                html = resp.read().decode("utf-8", "replace")
            entry["status"] = "ok"
        except PermissionError as e:
            entry["status"] = f"robots_disallowed: {e}"
            pages.append(entry)
            continue
        except ConnectionError as e:
            entry["status"] = f"unreachable: {e}"
            pages.append(entry)
            continue
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            entry["status"] = f"error: {e}"
            pages.append(entry)
            continue
        parser = _Links()
        parser.feed(html)
        for href, text in parser.links:
            url = urllib.parse.urljoin(page, href)
            if not _host_ok(url, spec) or not any(p.search(url) for p in patterns):
                continue
            found.append({"url": url, "text": text, "robots_allowed": str(fetcher.allowed(url)).lower()})
        pages.append(entry)
    unique = list({f["url"]: f for f in found}.values())
    return {"source_id": spec.source_id, "checked_at": _now(), "pages": pages, "links": unique}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_manifest(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def snapshot(fetcher: PoliteFetcher, spec: SourceSpec, urls: list[str], out_dir: str | Path) -> list[dict[str, Any]]:
    """Download each URL (if changed) into out_dir/<source_id>/<sha256-prefix>/<name>; append to manifest.jsonl."""
    base = Path(out_dir) / spec.source_id
    base.mkdir(parents=True, exist_ok=True)
    manifest_path = base / "manifest.jsonl"
    manifest = _load_manifest(manifest_path)
    results = []
    for url in urls:
        rec: dict[str, Any] = {"source_id": spec.source_id, "url": url, "checked_at": _now(), "collector": VERSION}
        if not _host_ok(url, spec):
            rec["status"] = "skipped_host_not_allowed"
            results.append(rec)
            _append(manifest_path, rec)
            continue
        previous = next((m for m in reversed(manifest) if m["url"] == url and m.get("status") == "archived"), None)
        headers = {}
        if previous and previous.get("etag"):
            headers["If-None-Match"] = previous["etag"]
        if previous and previous.get("last_modified"):
            headers["If-Modified-Since"] = previous["last_modified"]
        try:
            with fetcher.get(url, headers) as resp:
                tmp = base / ".download.part"
                h, size = hashlib.sha256(), 0
                with open(tmp, "wb") as f:
                    for chunk in iter(lambda: resp.read(1 << 20), b""):
                        h.update(chunk)
                        f.write(chunk)
                        size += len(chunk)
                digest = h.hexdigest()
                rec.update({"etag": resp.headers.get("ETag"), "last_modified": resp.headers.get("Last-Modified")})
            if previous and previous["sha256"] == digest:
                tmp.unlink()
                rec.update({"status": "unchanged", "sha256": digest})
            else:
                name = Path(urllib.parse.urlsplit(url).path).name or "download"
                dest = base / digest[:16] / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp.replace(dest)
                rec.update({"status": "archived", "sha256": digest, "document_id": f"fl:document:sha256-{digest}",
                            "bytes": size, "path": str(dest.relative_to(Path(out_dir)))})
        except urllib.error.HTTPError as e:
            rec["status"] = "unchanged" if e.code == 304 else f"http_{e.code}"
            if e.code == 304 and previous:
                rec["sha256"] = previous["sha256"]
        except PermissionError as e:
            rec["status"] = f"robots_disallowed: {e}"
        except ConnectionError as e:
            rec["status"] = f"unreachable: {e}"
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            rec["status"] = f"error: {e}"
        results.append(rec)
        _append(manifest_path, rec)
    return results


def _append(manifest_path: Path, rec: dict[str, Any]) -> None:
    """Every decision (archived, unchanged, skipped, refused, failed) is recorded: the manifest is the audit trail."""
    with open(manifest_path, "a") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")


def load_sources(path: str | Path) -> tuple[CollectorConfig, list[SourceSpec]]:
    data = json.loads(Path(path).read_text())
    cfg = CollectorConfig(**data["collector"])
    return cfg, [SourceSpec.from_dict(s) for s in data["sources"]]
