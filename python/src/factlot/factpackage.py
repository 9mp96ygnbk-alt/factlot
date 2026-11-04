"""Fact packages: a canonical JSON bundle of FactLot facts with the hashes of their source documents,
an RFC 6962 Merkle tree over the canonical facts, and an optional Ed25519 signature made by the
holder's own key. FactLot never holds a private key: ``fact_package_create`` builds an unsigned
package, the signer signs locally (``sign_fact_package``), and ``fact_package_verify`` checks the
hashes, the signature and, given the documents' pages, every quote.

packages/tools/src/packages.ts is the same code; spec/vectors/documents.json pins both. Ed25519
needs the ``cryptography`` package (``pip install 'factlot[signing]'``); without it everything but
the signature is still checked and the signature is reported as ``unavailable``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
from typing import Any

from ._core import js_number_str
from .docverify import DOC_LIMITS, DocInputError, _cap_characters, _characters, _load_document, locate_quote, \
    unconfirmed, validate_fact_full

PACKAGE_FORMAT = "factlot.fact_package"
PACKAGE_VERSION = 1
SIGNING_PREFIX = "factlot.fact_package.v1:"
_SHA_ID = re.compile(r"fl:document:sha256-([a-f0-9]{64})")
_B64URL = re.compile(r"[A-Za-z0-9_-]*={0,2}")
_SURROGATE = re.compile(r"[\ud800-\udfff]")
_NEXT = ("To sign, sign the UTF-8 bytes of signing_message with your own Ed25519 key on your own machine "
         "(factlot.sign_fact_package in Python, signFactPackage in @factlot/tools, or fact_package_sign in the local "
         "MCP server) and add signature {algorithm: Ed25519, public_key, value}. FactLot never sees or stores a "
         "private key.")


def _utf16(s: str) -> bytes:
    return s.encode("utf-16-be", "surrogatepass")


def _js_string(s: str) -> str:
    # json.dumps escapes as JSON.stringify does (\b \f \n \r \t, \u00xx for other controls, lower
    # case); JSON.stringify also escapes a lone surrogate, which json.dumps leaves raw.
    return _SURROGATE.sub(lambda m: f"\\u{ord(m.group()):04x}", json.dumps(s, ensure_ascii=False))


def canonical_json(v: Any) -> str:
    """RFC 8785 (JCS) canonical JSON: keys sorted by UTF-16 code units, ECMAScript numbers and strings."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, str):
        return _js_string(v)
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not math.isfinite(v):
            raise DocInputError([{"path": "", "message": "canonical JSON has no NaN or Infinity"}])
        return js_number_str(v)
    if isinstance(v, list):
        return "[" + ",".join(canonical_json(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{_js_string(k)}:{canonical_json(v[k])}" for k in sorted(v, key=_utf16)) + "}"
    raise TypeError(f"canonical JSON cannot hold {type(v).__name__}")


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def leaf_hash(fact: Any) -> str:
    """RFC 6962 leaf hash of one fact: SHA-256(0x00 || canonical JSON)."""
    return _sha256(b"\x00" + canonical_json(fact).encode("utf-8", "surrogatepass")).hex()


def merkle_root(leaves: list[str]) -> str:
    """RFC 6962 Merkle tree hash over leaf hashes (hex)."""
    def tree(lo: int, hi: int) -> bytes:
        if hi - lo == 1:
            return bytes.fromhex(leaves[lo])
        k = 1
        while k * 2 < hi - lo:
            k *= 2
        return _sha256(b"\x01" + tree(lo, lo + k) + tree(lo + k, hi))
    return tree(0, len(leaves)).hex() if leaves else _sha256(b"").hex()


def _digest(manifest: dict[str, Any]) -> str:
    return _sha256(canonical_json(manifest).encode("utf-8", "surrogatepass")).hex()


def _manifest(pkg: dict[str, Any], documents: list[Any], fact_count: int, root: str) -> dict[str, Any]:
    m: dict[str, Any] = {"format": PACKAGE_FORMAT, "version": PACKAGE_VERSION}
    for k in ("title", "created_at", "created_by"):
        if k in pkg:
            m[k] = pkg[k]
    m.update({"documents": documents, "fact_count": fact_count, "merkle_root": root})
    return m


# --- fact_package_create ---------------------------------------------------------------------------


def create_fact_package(args: dict[str, Any]) -> dict[str, Any]:
    issues = []
    for i, f in enumerate(args["facts"]):
        for x in validate_fact_full(f)["issues"]:
            issues.append({"path": f"facts.{i}" + (f".{x['path']}" if x["path"] else ""), "message": x["message"]})
    if issues:
        raise DocInputError(issues[:20])

    # Every document a fact cites, with its sha256 when the source or the ID gives it.
    docs: dict[str, dict[str, Any]] = {}
    conflict: list[dict[str, str]] = []

    def note(d: dict[str, Any], path: str) -> None:
        did = d["document_id"]
        have = docs.setdefault(did, {"document_id": did})
        m = _SHA_ID.fullmatch(did)
        sha = d.get("sha256", m.group(1) if m else None)
        if sha is not None:
            if "sha256" in have and have["sha256"] != sha:
                conflict.append({"path": path, "message": f"{did} is given two different sha256 values"})
            else:
                have["sha256"] = sha
        if "title" in d and "title" not in have:
            have["title"] = d["title"]

    for i, f in enumerate(args["facts"]):
        for j, s in enumerate(f["provenance"]["sources"]):
            note(s, f"facts.{i}.provenance.sources.{j}")
    for i, d in enumerate(args.get("documents", [])):
        note(d, f"documents.{i}")
    if conflict:
        raise DocInputError(conflict[:20])
    documents = []
    for d in sorted(docs.values(), key=lambda d: _utf16(d["document_id"])):
        out = {"document_id": d["document_id"]}
        for k in ("sha256", "title"):
            if k in d:
                out[k] = d[k]
        documents.append(out)

    leaves = [leaf_hash(f) for f in args["facts"]]
    root = merkle_root(leaves)
    digest = _digest(_manifest(args, documents, len(leaves), root))
    package: dict[str, Any] = {"format": PACKAGE_FORMAT, "version": PACKAGE_VERSION}
    for k in ("title", "created_at", "created_by"):
        if k in args:
            package[k] = args[k]
    package.update({"documents": documents, "facts": args["facts"], "integrity": {
        "hash": "sha256", "canonicalization": "RFC 8785 (JCS)", "tree": "RFC 6962 Merkle tree hash",
        "leaf_hashes": leaves, "merkle_root": root, "digest": digest}})
    return {"package": package, "digest": digest, "signing_message": f"{SIGNING_PREFIX}{digest}", "next": _NEXT}


# --- verification ----------------------------------------------------------------------------------


def from_base64url(s: str) -> bytes | None:
    """Strict base64url (padding optional), or None."""
    if not _B64URL.fullmatch(s):
        return None
    body = s.rstrip("=")
    if len(body) % 4 == 1:
        return None
    return base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))


def to_base64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _ed25519_verify(public_key: bytes, signature: bytes, message: bytes) -> bool | None:
    """True or False, or None when the ``cryptography`` package is not installed."""
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        return None
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
        return True
    except (InvalidSignature, ValueError):
        return False


def _recompute(pkg: dict[str, Any]) -> dict[str, Any]:
    """The package's hashes recomputed from its content, and how they differ from what it states."""
    facts = pkg["facts"]
    problems: list[str] = []
    leaves = [leaf_hash(f) for f in facts]
    root = merkle_root(leaves)
    documents = pkg["documents"] if isinstance(pkg.get("documents"), list) else []
    if not isinstance(pkg.get("documents"), list):
        problems.append("documents is missing")
    digest = _digest(_manifest(pkg, documents, len(facts), root))
    integrity = pkg.get("integrity") if isinstance(pkg.get("integrity"), dict) else None
    if integrity is None:
        problems.append("integrity is missing")
    else:
        stated = integrity.get("leaf_hashes")
        if not isinstance(stated, list):
            problems.append("integrity.leaf_hashes is missing")
        else:
            if len(stated) != len(leaves):
                problems.append(f"integrity.leaf_hashes has {len(stated)} hashes for {len(leaves)} facts")
            changed = [i for i, h in enumerate(leaves) if i >= len(stated) or stated[i] != h]
            if changed:
                problems.append(f"facts {', '.join(map(str, changed[:20]))}{', ...' if len(changed) > 20 else ''} "
                                "do not match their leaf hashes")
        if integrity.get("merkle_root") != root:
            problems.append("integrity.merkle_root does not match the facts")
        if integrity.get("digest") != digest:
            problems.append("integrity.digest does not match the package (title, dates, documents or facts changed)")
    listed = {d.get("document_id") for d in documents if isinstance(d, dict) and isinstance(d.get("document_id"), str)}
    unlisted: list[str] = []
    for f in facts:
        prov = f.get("provenance") if isinstance(f.get("provenance"), dict) else {}
        for s in prov.get("sources") if isinstance(prov.get("sources"), list) else []:
            if isinstance(s, dict) and isinstance(s.get("document_id"), str) and s["document_id"] not in listed \
                    and s["document_id"] not in unlisted:
                unlisted.append(s["document_id"])
    if unlisted:
        problems.append(f"documents does not list {', '.join(unlisted[:5])}{', ...' if len(unlisted) > 5 else ''}")
    return {"problems": problems, "leaves": leaves, "root": root, "digest": digest}


def _check_signature(pkg: dict[str, Any], digest: str, trusted: bytes | None, trusted_text: str | None) -> dict[str, Any]:
    sig = pkg.get("signature", None) if "signature" in pkg else None
    if "signature" not in pkg:
        return {"status": "absent", "reason": "the package is not signed, but a public key was given" if trusted
                else "the package is not signed"}
    if not isinstance(sig, dict) or sig.get("algorithm") != "Ed25519":
        return {"status": "invalid", "reason": "signature must be {algorithm: Ed25519, public_key, value}"}
    embedded = from_base64url(sig["public_key"]) if isinstance(sig.get("public_key"), str) else None
    value = from_base64url(sig["value"]) if isinstance(sig.get("value"), str) else None
    base: dict[str, Any] = {}
    if isinstance(sig.get("public_key"), str):
        base["public_key"] = sig["public_key"]
    if isinstance(sig.get("key_id"), str):
        base["key_id"] = sig["key_id"]
    if embedded is None or len(embedded) != 32:
        return {**base, "status": "invalid", "reason": "signature.public_key is not 32 bytes of base64url"}
    if value is None or len(value) != 64:
        return {**base, "status": "invalid", "reason": "signature.value is not 64 bytes of base64url"}
    if trusted is not None and trusted != embedded:
        return {**base, "status": "key_mismatch",
                "reason": f"the package was signed with {sig['public_key']}, not the public key given ({trusted_text})"}
    ok = _ed25519_verify(embedded, value, f"{SIGNING_PREFIX}{digest}".encode())
    if ok is None:
        return {**base, "status": "unavailable",
                "reason": "Ed25519 needs the cryptography package: pip install 'factlot[signing]'"}
    if not ok:
        return {**base, "status": "invalid", "reason": "the signature does not verify for this package's digest"}
    if trusted is not None:
        return {**base, "status": "verified", "reason": "signed by the public key given"}
    return {**base, "status": "matches_embedded_key",
            "reason": "the signature matches the public key inside the package, but anyone can sign: pass the "
                      "signer's public key you trust as public_key"}


def verify_fact_package(args: dict[str, Any]) -> dict[str, Any]:
    pkg = args["package"]
    issues: list[dict[str, str]] = []
    if pkg.get("format") != PACKAGE_FORMAT or pkg.get("version") != PACKAGE_VERSION or \
            isinstance(pkg.get("version"), bool):
        issues.append({"path": "package", "message": f"expected format {PACKAGE_FORMAT}, version {PACKAGE_VERSION}"})
    facts = pkg.get("facts")
    if not isinstance(facts, list) or not facts or len(facts) > DOC_LIMITS["facts_per_call"] or \
            not all(isinstance(f, dict) for f in facts):
        issues.append({"path": "package.facts", "message": f"expected 1 to {DOC_LIMITS['facts_per_call']} fact objects"})
    for k in ("title", "created_at", "created_by"):
        if k in pkg and not isinstance(pkg[k], str):
            issues.append({"path": f"package.{k}", "message": "expected string"})
    trusted = None
    if "public_key" in args:
        trusted = from_base64url(args["public_key"])
        if trusted is None or len(trusted) != 32:
            trusted = None
            issues.append({"path": "public_key", "message": "expected an Ed25519 public key: 32 bytes as base64url"})
    if issues:
        raise DocInputError(issues)
    _cap_characters(sum(_characters(d["pages"]) for d in args.get("documents", [])))

    r = _recompute(pkg)
    fact_issues = []
    for i, f in enumerate(facts):
        v = validate_fact_full(f)
        if not v["valid"]:
            fact_issues.append({"fact": i, "issues": v["issues"][:20]})
    signature = _check_signature(pkg, r["digest"], trusted, args.get("public_key"))

    # Quotes on their pages, for the documents given.
    docs = {}
    for i, d in enumerate(args.get("documents", [])):
        doc = _load_document(d, f"documents.{i}")
        docs[doc["id"]] = doc
    checked = on_page = 0
    quote_problems: list[dict[str, Any]] = []
    not_supplied: list[str] = []
    for i, f in enumerate(facts):
        prov = f.get("provenance") if isinstance(f.get("provenance"), dict) else {}
        sources = prov.get("sources") if isinstance(prov.get("sources"), list) else []
        for j, s in enumerate(sources):
            if not isinstance(s, dict) or not isinstance(s.get("document_id"), str):
                continue
            page = s.get("page")
            if not isinstance(s.get("quote"), str) or not isinstance(page, (int, float)) or isinstance(page, bool):
                continue
            doc = docs.get(s["document_id"])
            if doc is None:
                if s["document_id"] not in not_supplied:
                    not_supplied.append(s["document_id"])
                continue
            checked += 1
            loc = locate_quote(doc["text"], s["quote"], page)
            where = {"fact": i, "source": j, "document_id": s["document_id"], "page": page}
            if loc["ok"] and not loc["corrected"]:
                on_page += 1
            elif loc["ok"]:
                quote_problems.append({**where, "status": "other_page",
                                       "reason": f"quote found on page {loc['page']}, not {js_number_str(page)}"})
            else:
                quote_problems.append({**where, "status": "not_found", "reason": loc["reason"]})

    # Value parts no quote confirms. They do not affect ``valid``: a package may carry facts a
    # person confirmed, and FactLot reports what it could not check rather than judging them.
    invalid = {x["fact"] for x in fact_issues}
    values_not_checked = []
    for i, f in enumerate(facts):
        if i in invalid:
            continue
        gaps = unconfirmed(f)
        if gaps:
            item: dict[str, Any] = {"fact": i}
            if isinstance(f.get("id"), str):
                item["fact_id"] = f["id"]
            item.update({"predicate": f.get("predicate"), "not_checked": gaps})
            values_not_checked.append(item)

    integrity_ok = not r["problems"]
    if "public_key" in args:
        signature_ok = signature["status"] == "verified"
    else:
        signature_ok = signature["status"] not in ("invalid", "key_mismatch")
    integrity: dict[str, Any] = {"status": "ok" if integrity_ok else "mismatch", "merkle_root": r["root"],
                                 "digest": r["digest"]}
    if r["problems"]:
        integrity["problems"] = r["problems"]
    return {
        "valid": integrity_ok and signature_ok and not fact_issues and not quote_problems,
        "integrity": integrity,
        "signature": signature,
        "facts": {"count": len(facts), "invalid": fact_issues},
        "quotes": {"checked": checked, "on_page": on_page, "problems": quote_problems,
                   "documents_not_supplied": not_supplied},
        "values_not_checked": values_not_checked,
        "checks_run": [
            "integrity: each fact's hash, the Merkle root and the digest, recomputed from the content",
            "signature: none to check (the package is not signed)" if signature["status"] == "absent" else
            "signature: Ed25519, against the public_key given" if "public_key" in args else
            "signature: Ed25519, against the key inside the package only; pass public_key to check who signed",
            "facts: fact_validate on each fact (schema and citations; for Ingest predicates, the value's shape and "
            "that its numbers, dates, names and as-written text appear in each source quote)",
            *(["quotes: each quote citing a supplied document is on its cited page"] if docs else []),
        ],
        "checks_not_run": [
            *(["values: the parts in values_not_checked are not confirmed by their quotes (booleans, enums, free "
               "text not written in the quote, or a generic predicate's value the quote does not state)"]
              if values_not_checked else []),
            *(["quotes: quotes citing the documents in quotes.documents_not_supplied were not looked for, because "
               "their pages were not given"] if not_supplied else []),
            "files: whether the pages given came from the files their sha256 names",
            "meaning: a quote that states the right number for a different term passes",
        ],
    }


# --- signing (local only: the private key stays with its holder) -----------------------------------


def sign_fact_package(package: dict[str, Any], private_key: Any, key_id: str | None = None) -> dict[str, Any]:
    """Sign a package from ``fact_package_create`` with your Ed25519 private key and return it with
    ``signature``. ``private_key`` is a ``cryptography`` Ed25519PrivateKey, PEM (PKCS#8) text or
    bytes, or the raw 32-byte seed. Raises ``ValueError`` if the package's hashes do not match its
    content. Needs ``pip install 'factlot[signing]'``."""
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    except ImportError as e:  # pragma: no cover - environment dependent
        raise RuntimeError("signing needs the cryptography package: pip install 'factlot[signing]'") from e
    if isinstance(private_key, str):
        private_key = private_key.encode()
    if isinstance(private_key, bytes):
        if len(private_key) == 32:
            private_key = Ed25519PrivateKey.from_private_bytes(private_key)
        else:
            private_key = serialization.load_pem_private_key(private_key, password=None)
    if not isinstance(private_key, Ed25519PrivateKey):
        raise ValueError("expected an Ed25519 private key")
    from .docverify import js_json

    package = js_json(package)
    if not isinstance(package.get("facts"), list) or not package["facts"]:
        raise ValueError("cannot sign: the package has no facts")
    r = _recompute(package)
    if r["problems"]:
        raise ValueError("cannot sign: " + "; ".join(r["problems"]))
    value = private_key.sign(f"{SIGNING_PREFIX}{r['digest']}".encode())
    public = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    signature: dict[str, Any] = {"algorithm": "Ed25519", "public_key": to_base64url(public)}
    if key_id is not None:
        signature["key_id"] = key_id
    signature["value"] = to_base64url(value)
    return {**{k: v for k, v in package.items() if k != "signature"}, "signature": signature}
