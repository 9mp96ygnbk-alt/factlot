"""A polite public-data collector: discover download links and archive files as snapshots.

Rules it enforces (docs/registry/data-policy.md §2):
- identifies itself with a User-Agent that includes a contact address;
- obeys robots.txt for every URL it fetches (a missing robots.txt means allowed);
- waits at least `min_interval` seconds between requests to the same host;
- uses conditional requests (If-None-Match / If-Modified-Since) so unchanged files are not re-downloaded;
- never logs in, never solves CAPTCHAs, never follows links off the configured hosts;
- never connects to a loopback, private, link-local (169.254.169.254) or other non-public address,
  including through a redirect, and checks the connected peer as well as the name (DNS rebinding);
- bounds what it reads: landing pages and robots.txt to ``max_page_bytes``, files to
  ``max_file_bytes``; archived file names come from the URL or Content-Disposition but can never
  leave the snapshot directory.

Every archived file becomes a content-addressed snapshot (sha256) with a manifest entry: source,
URL, retrieval time, size, HTTP validators, and robots status. Re-running is idempotent.
"""

from __future__ import annotations

import functools
import hashlib
import http.client
import inspect
import ipaddress
import json
import re
import socket
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

VERSION = "0.4"


@dataclass
class CollectorConfig:
    contact: str  # e.g. "registry@factlot.com"
    min_interval: float = 1.0
    timeout: float = 120.0
    retries: int = 2  # extra attempts after a timeout or a truncated body, each after a full interval
    user_agent_product: str = "FactLotRegistryBot"
    max_file_bytes: int = 2 * 1024**3  # a GitHub release asset must be under 2 GiB
    max_page_bytes: int = 32 * 1024**2  # landing pages, JSON listings, robots.txt
    allow_private_addresses: bool = False  # tests against a local server only; never in a config

    @property
    def user_agent(self) -> str:
        return f"{self.user_agent_product}/{VERSION} (+https://factlot.com/registry; {self.contact})"


@dataclass
class SourceSpec:
    source_id: str
    publisher: str
    landing_pages: list[str]
    allowed_hosts: list[str]
    link_patterns: list[str] = field(default_factory=lambda: [r"\.(zip|csv|txt|json|geojson|gdb\.zip|xlsx?)(\?|$)"])
    files: list[str] = field(default_factory=list)  # explicit file URLs, once confirmed
    verified: bool = False  # landing pages / files confirmed against the live site
    notes: str = ""
    # Data-policy §5 review record (mirrored in docs/registry/texas-sources.md).
    terms_url: str | None = None
    license: str | None = None
    ai_use: str | None = None
    redistribution: str | None = None
    reviewed: str | None = None  # YYYY-MM-DD of the terms review

    def __post_init__(self) -> None:
        # The id names a directory under the output folder: no separators, no "..".
        if not _SOURCE_ID.fullmatch(self.source_id or ""):
            raise ValueError(f"source_id {self.source_id!r} must match {_SOURCE_ID.pattern}")

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SourceSpec":
        return cls(**{k: d[k] for k in cls.__dataclass_fields__ if k in d})


_SOURCE_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,99}")


class BlockedURLError(urllib.error.URLError):
    """A URL the collector refuses to fetch: not http(s), or a host on a non-public address."""


def _public_ip(addr: str) -> bool:
    ip = ipaddress.ip_address(addr.split("%", 1)[0])
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def check_url(url: str, allow_private: bool = False) -> None:
    """Refuse anything but http(s) to a host whose every address is public (no loopback, RFC 1918,
    link-local such as the 169.254.169.254 metadata service, CGNAT, or reserved ranges)."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise BlockedURLError(f"refusing non-http(s) URL scheme {parts.scheme!r}")
    host = parts.hostname
    if not host:
        raise BlockedURLError("refusing a URL without a host")
    if allow_private:
        return
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80),
                                   proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError) as e:
        raise urllib.error.URLError(f"cannot resolve {host}: {e}") from None
    bad = sorted({str(i[4][0]) for i in infos if not _public_ip(str(i[4][0]))})
    if bad:
        raise BlockedURLError(f"refusing {host}: resolves to non-public address {', '.join(bad)}")


def _check_peer(conn: http.client.HTTPConnection, allow_private: bool) -> None:
    """After connecting, check the address actually connected to (a name can resolve differently
    the second time). Skipped behind a proxy, where the peer is the proxy."""
    if allow_private or getattr(conn, "_tunnel_host", None) or urllib.request.getproxies():
        return
    sock = conn.sock
    peer = sock.getpeername()[0] if sock is not None else None
    if peer is None or not _public_ip(str(peer)):
        conn.close()
        raise BlockedURLError(f"refusing connection to non-public address {peer}")


class _GuardedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args: Any, allow_private: bool = False, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._allow_private = allow_private

    def connect(self) -> None:
        super().connect()
        _check_peer(self, self._allow_private)


class _GuardedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args: Any, allow_private: bool = False, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._allow_private = allow_private

    def connect(self) -> None:
        super().connect()
        _check_peer(self, self._allow_private)


class _GuardedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, allow_private: bool) -> None:
        super().__init__()
        self._allow_private = allow_private

    def http_open(self, req):  # type: ignore[override]
        return self.do_open(functools.partial(_GuardedHTTPConnection, allow_private=self._allow_private), req)


class _GuardedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, allow_private: bool) -> None:
        super().__init__()
        self._allow_private = allow_private

    def https_open(self, req):  # type: ignore[override]
        kwargs: dict[str, Any] = {"context": self._context}
        if "check_hostname" in inspect.signature(http.client.HTTPSConnection.__init__).parameters:  # Python < 3.12
            kwargs["check_hostname"] = getattr(self, "_check_hostname", None)
        return self.do_open(functools.partial(_GuardedHTTPSConnection, allow_private=self._allow_private), req,
                            **kwargs)


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


def strip_default_port(url: str) -> str:
    """Drop an explicit default port (``https://host:443``): some portals redirect to presigned
    object-storage URLs written that way, and a ``Host: host:443`` header breaks their signature."""
    parts = urllib.parse.urlsplit(url)
    default = {"https": 443, "http": 80}.get(parts.scheme)
    if parts.port is not None and parts.port == default:
        host = parts.hostname or ""
        if ":" in host:  # IPv6 literal
            host = f"[{host}]"
        return urllib.parse.urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))
    return url


class _RedirectHandler(urllib.request.HTTPRedirectHandler):
    """Redirect targets get the same URL hygiene, and the same address check, as the URLs we send
    ourselves: a public host must not be able to bounce the collector to a private one."""

    max_redirections = 10

    def __init__(self, allow_private: bool = False) -> None:
        super().__init__()
        self._allow_private = allow_private

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        target = strip_default_port(clean_url(urllib.parse.urljoin(req.full_url, newurl)))
        check_url(target, self._allow_private)
        return super().redirect_request(req, fp, code, msg, headers, target)


# A small JSON body that an export API returns while it is still preparing the file: not data.
# ArcGIS Hub reports its export stages as "Pending", "ExportingData" and "PagingData", all with HTTP 200.
_NOT_READY = re.compile(r'"status"\s*:\s*"(pending|processing|in_progress|queued|exportingdata|pagingdata)"', re.I)


class PoliteFetcher:
    def __init__(self, config: CollectorConfig, opener: urllib.request.OpenerDirector | None = None) -> None:
        self.config = config
        allow = config.allow_private_addresses
        self.opener = opener or urllib.request.build_opener(
            _RedirectHandler(allow), _GuardedHTTPHandler(allow), _GuardedHTTPSHandler(allow))
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._unreachable: dict[str, str] = {}
        self._interval: dict[str, float] = {}  # per host: the larger of min_interval and robots.txt Crawl-delay
        self.log: list[dict[str, Any]] = []

    def interval(self, host: str) -> float:
        return self._interval.get(host, self.config.min_interval)

    def _apply_robots(self, host: str, rp: urllib.robotparser.RobotFileParser) -> None:
        """A publisher's Crawl-delay overrides our own interval when it is longer."""
        crawl_delay = rp.crawl_delay(self.config.user_agent)
        if crawl_delay is not None:
            self._interval[host] = max(self.config.min_interval, float(crawl_delay))

    def _wait(self, host: str) -> None:
        last = self._last.get(host)
        if last is not None:
            delay = self.interval(host) - (time.monotonic() - last)
            if delay > 0:
                time.sleep(delay)
        self._last[host] = time.monotonic()

    def _request(self, url: str, headers: dict[str, str] | None = None):
        url = strip_default_port(clean_url(url))
        check_url(url, self.config.allow_private_addresses)
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
                    rp.parse(read_capped(resp, self.config.max_page_bytes).decode("utf-8", "replace").splitlines())
                self._robots[root] = rp
                self._apply_robots(parts.netloc, rp)
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
        check_url(strip_default_port(clean_url(url)), self.config.allow_private_addresses)
        allowed = self.allowed(url)
        parts = urllib.parse.urlsplit(url)
        root = f"{parts.scheme}://{parts.netloc}"
        if root in self._unreachable:
            raise ConnectionError(f"site unreachable (robots.txt could not be fetched): {self._unreachable[root]}")
        if not allowed:
            raise PermissionError(f"robots.txt disallows {url}")
        return self._request(url, headers)


def read_capped(resp: Any, limit: int) -> bytes:
    """Read a whole response, refusing one longer than ``limit`` bytes."""
    data = resp.read(limit + 1)
    if len(data) > limit:
        raise urllib.error.URLError(f"response exceeds {limit} bytes")
    return data


def _host_ok(url: str, spec: SourceSpec) -> bool:
    host = urllib.parse.urlsplit(url).hostname or ""
    return any(host == h or host.endswith("." + h) for h in spec.allowed_hosts)


def clean_url(url: str) -> str:
    """Percent-encode characters a publisher put in a link verbatim (spaces, backslashes) so the
    URL is sendable; already-encoded sequences are left alone."""
    return urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=%~")


_JSON_TEXT_KEYS = ("downloadLinkText", "text", "name", "title", "label")


def _json_links(data: Any) -> list[tuple[str, str]]:
    """Links in a JSON document (an API listing rather than an HTML page): every string that looks
    like a URL, labelled with a sibling text field when its object has one. Iterative, in document
    order, so a deeply nested hostile listing cannot exhaust the stack."""
    out: list[tuple[str, str]] = []
    stack: list[Any] = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            label = next((str(node[k]) for k in _JSON_TEXT_KEYS if isinstance(node.get(k), str)), "")
            children = []
            for v in node.values():
                if isinstance(v, str) and re.match(r"^(https?:)?//|^/", v):
                    children.append(("link", v, label))
                else:
                    children.append(("node", v, ""))
            for kind, v, lab in reversed(children):
                stack.append((kind, v, lab))
        elif isinstance(node, list):
            stack.extend(("node", v, "") for v in reversed(node))
        elif isinstance(node, tuple):
            kind, v, lab = node
            if kind == "link":
                out.append((v, lab))
            else:
                stack.append(v)
    return out


def discover(fetcher: PoliteFetcher, spec: SourceSpec) -> dict[str, Any]:
    """Fetch the source's landing pages and list candidate download links (nothing is downloaded).

    A landing page is either HTML (anchors are read) or a JSON API response (URL strings are read):
    several publishers fill their download page from a JSON endpoint.
    """
    found: list[dict[str, str]] = []
    pages: list[dict[str, Any]] = []
    patterns = [re.compile(p, re.I) for p in spec.link_patterns]
    for page in spec.landing_pages:
        entry: dict[str, Any] = {"url": page}
        try:
            with fetcher.get(page) as resp:
                html = read_capped(resp, fetcher.config.max_page_bytes).decode("utf-8", "replace")
                content_type = resp.headers.get("Content-Type", "")
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
        links: list[tuple[str, str]]
        if "json" in content_type or html.lstrip()[:1] in ("[", "{"):
            try:
                links = _json_links(json.loads(html))
            except ValueError:
                links = []
        else:
            parser = _Links()
            parser.feed(html)
            links = parser.links
        for href, text in links:
            url = clean_url(urllib.parse.urljoin(page, href))
            if not _host_ok(url, spec) or not any(p.search(url) for p in patterns):
                continue
            found.append({"url": url, "text": text, "robots_allowed": str(fetcher.allowed(url)).lower()})
        pages.append(entry)
    unique = list({f["url"]: f for f in found}.values())
    return {"source_id": spec.source_id, "checked_at": _now(), "pages": pages, "links": unique}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_filename(name: str | None) -> str | None:
    """A file name that stays in its directory: the last path segment (either separator), with
    control characters and leading dots removed and at most 200 bytes, keeping the extension.
    None when nothing usable is left ("", ".", "..")."""
    if not name:
        return None
    base = re.split(r"[\\/]", urllib.parse.unquote(name))[-1]
    base = "".join(ch for ch in base if ch.isprintable()).strip().lstrip(".").strip()
    if not base:
        return None
    stem, dot, ext = base.rpartition(".")
    if not dot or len(ext.encode()) > 16:
        stem, ext = base, ""
    while len((stem + ("." + ext if ext else "")).encode()) > 200:
        stem = stem[:-1]
    return (stem + ("." + ext if ext else "")) or None


def _attachment_name(disposition: str | None) -> str | None:
    """File name from a Content-Disposition header: publishers that serve files through a script
    (Dallas CAD's ViewPDFs.aspx) name the file there, not in the URL. Sanitized: the header is
    the publisher's text, and ``../`` or an absolute path in it must not leave the snapshot."""
    if not disposition:
        return None
    m = re.search(r"filename\*?=(?:[\w-]+'[\w-]*')?\"?([^\";]+)", disposition, re.I)
    return safe_filename(m.group(1).strip()) if m else None


def query_limit(url: str) -> int | None:
    """The ``$limit`` or ``limit`` query parameter, if it is a positive integer.

    A paged API that is asked for at most N rows can answer HTTP 200 with exactly N rows
    while more rows match. Equality with this cap means the extract may be truncated.
    """
    params = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    raw = (params.get("$limit") or params.get("limit") or [None])[0]
    if raw is not None and str(raw).isdigit() and int(raw) > 0:
        return int(raw)
    return None


def limit_saturated(url: str, row_count: int) -> bool:
    """True when ``row_count`` reached the URL's row cap, so the extract must not be called complete."""
    cap = query_limit(url)
    return cap is not None and row_count >= cap


def _range_start(content_range: str | None) -> int | None:
    """First byte offset of a 206 response (``Content-Range: bytes 1048576-2097151/2097152``)."""
    m = re.match(r"bytes (\d+)-", content_range or "")
    return int(m.group(1)) if m else None


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
        if (cap := query_limit(url)) is not None:
            # A later row count that equals this cap is incomplete. The cap is not a parcel total.
            rec["row_cap"] = cap
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
        tmp = base / ".download.part"
        h, size = hashlib.sha256(), 0
        try:
            for attempt in range(fetcher.config.retries + 1):
                try:
                    attempt_headers = {**headers, "Range": f"bytes={size}-"} if size else headers
                    with fetcher.get(url, attempt_headers) as resp:
                        if size and resp.status == 206 and _range_start(resp.headers.get("Content-Range")) == size:
                            mode, start = "ab", size  # the host resumes: keep what was read
                            rec["resumed_from"] = size
                        else:
                            h, size, mode, start = hashlib.sha256(), 0, "wb", 0
                        cap = fetcher.config.max_file_bytes
                        declared = resp.headers.get("Content-Length")
                        if declared and declared.isdigit() and start + int(declared) > cap:
                            raise _TooLarge(cap)
                        with open(tmp, mode) as f:
                            for chunk in iter(lambda: resp.read(1 << 20), b""):
                                h.update(chunk)
                                f.write(chunk)
                                size += len(chunk)
                                if size > cap:
                                    raise _TooLarge(cap)
                        expected = resp.headers.get("Content-Length")
                        if expected and expected.isdigit() and size - start < int(expected):
                            # http.client returns a short body silently when the connection drops
                            # on a sized (non-chunked) response.
                            raise http.client.IncompleteRead(b"", int(expected) - (size - start))
                        digest = h.hexdigest()
                        rec.update({"etag": resp.headers.get("ETag"), "last_modified": resp.headers.get("Last-Modified")})
                        attachment = _attachment_name(resp.headers.get("Content-Disposition"))
                    break
                except (TimeoutError, ConnectionError, http.client.IncompleteRead) as e:
                    # A slow or flaky link drops large files part-way, or drops the connection
                    # before the host answers. The next attempt, after the host's full interval,
                    # asks for the rest with a Range header; a host that ignores it answers 200 and
                    # the file starts over, and a host that hangs up on a Range request (ArcGIS Hub)
                    # gets a plain request next. A partial file is never archived.
                    if attempt == fetcher.config.retries:
                        tmp.unlink(missing_ok=True)
                        raise
                    if "Range" in attempt_headers and isinstance(e, ConnectionError):
                        tmp.unlink(missing_ok=True)
                        h, size = hashlib.sha256(), 0
                    rec["retries"] = attempt + 1
            if size < 4096 and _NOT_READY.search(tmp.read_text("utf-8", "replace")):
                # An export API's "still preparing" placeholder (ArcGIS Hub answers 200 with
                # {"status": "Pending"}); archiving it would cite a non-document. Retry later.
                tmp.unlink()
                rec["status"] = "not_ready"
            elif previous and previous["sha256"] == digest:
                tmp.unlink()
                rec.update({"status": "unchanged", "sha256": digest})
            else:
                name = attachment or safe_filename(urllib.parse.urlsplit(url).path) or "download"
                dest = base / digest[:16] / name
                if not dest.resolve().is_relative_to(base.resolve()):  # belt and braces
                    raise _TooLarge(0, f"file name {name!r} leaves the snapshot directory")
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp.replace(dest)
                rec.update({"status": "archived", "sha256": digest, "document_id": f"fl:document:sha256-{digest}",
                            "bytes": size, "path": str(dest.relative_to(Path(out_dir)))})
        except _TooLarge as e:
            tmp.unlink(missing_ok=True)
            rec["status"] = f"refused: {e}"
        except BlockedURLError as e:
            tmp.unlink(missing_ok=True)
            rec["status"] = f"refused: {e.reason}"
        except urllib.error.HTTPError as e:
            rec["status"] = "unchanged" if e.code == 304 else f"http_{e.code}"
            if e.code == 304 and previous:
                rec["sha256"] = previous["sha256"]
        except PermissionError as e:
            rec["status"] = f"robots_disallowed: {e}"
        except ConnectionError as e:
            rec["status"] = f"unreachable: {e}"
        except http.client.IncompleteRead:
            rec["status"] = f"error: incomplete read ({size} bytes)"
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as e:
            rec["status"] = f"error: {e}"
        results.append(rec)
        _append(manifest_path, rec)
    return results


class _TooLarge(Exception):
    def __init__(self, cap: int, message: str | None = None) -> None:
        super().__init__(message or f"file exceeds max_file_bytes ({cap})")


def _append(manifest_path: Path, rec: dict[str, Any]) -> None:
    """Every decision (archived, unchanged, skipped, refused, failed) is recorded: the manifest is the audit trail."""
    with open(manifest_path, "a") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")


def load_sources(path: str | Path) -> tuple[CollectorConfig, list[SourceSpec]]:
    """Load one config file, or every ``*.json`` file under a directory, recursively (sorted; the
    first file's ``collector`` block applies to all, so every file must agree on it)."""
    p = Path(path)
    files = sorted(p.rglob("*.json")) if p.is_dir() else [p]
    if not files:
        raise FileNotFoundError(f"no source config files in {p}")
    cfg: CollectorConfig | None = None
    sources: list[SourceSpec] = []
    for f in files:
        data = json.loads(f.read_text())
        file_cfg = CollectorConfig(**data["collector"])
        if cfg is None:
            cfg = file_cfg
        elif file_cfg != cfg:
            raise ValueError(f"{f}: collector settings differ from {files[0]}")
        sources.extend(SourceSpec.from_dict(s) for s in data["sources"])
    assert cfg is not None
    return cfg, sources
