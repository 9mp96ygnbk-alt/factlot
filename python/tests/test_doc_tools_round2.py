"""PDF input, fact package signing, and the word matcher: the parts the shared vectors
(spec/vectors/documents.json) do not reach. Every document here is synthetic."""

import hashlib
import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import factlot
from factlot.factpackage import leaf_hash, merkle_root, sign_fact_package
from factlot.pdf import main as pdf_main
from factlot.pdf import read_pdf
from factlot.words import KeywordIndex, stem, words

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_fixture import synthetic_pdf  # noqa: E402

SPEC = json.loads((Path(__file__).resolve().parents[2] / "spec" / "vectors" / "documents.json").read_text("utf-8"))
CASES = {c["name"]: c for c in SPEC["cases"]}
# RFC 8032 section 7.1, test 1: a published test key, never a real one.
SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")

try:
    import pypdf  # noqa: F401  (optional: factlot[pdf])
    HAVE_PYPDF = True
except ImportError:
    HAVE_PYPDF = False
try:
    import cryptography  # noqa: F401  (optional: factlot[signing])
    HAVE_SIGNING = True
except ImportError:
    HAVE_SIGNING = False


def case(prefix):
    return next(c for name, c in CASES.items() if name.startswith(prefix))


class FakePage:
    def __init__(self, index, text):
        self.index, self._text, self.images = index, text, []

    def extract_text(self):
        return self._text


class FakeReader:
    """Stands in for pypdf's PdfReader on a byte stream: the pages are given by the test."""
    pages_for: list = []

    def __init__(self, stream):
        assert isinstance(stream, io.BytesIO)
        self.pages = [FakePage(i, t) for i, t in enumerate(FakeReader.pages_for)]


def fake_pypdf(pages):
    FakeReader.pages_for = pages
    return mock.patch.dict(sys.modules, {"pypdf": SimpleNamespace(PdfReader=FakeReader)})


PDF = b"%PDF-1.4 synthetic bytes; the fake reader ignores them\n"


class ReadPdf(unittest.TestCase):
    def test_text_layer_ocr_hook_and_document_id(self):
        seen = []

        def ocr(page):
            seen.append(page.index)
            return "SYNTHETIC OCR TEXT: Tenant's Pro- portionate Share is 4.25%"

        with fake_pypdf(["SYNTHETIC. The Term shall expire on June 30, 2031.", "  ", ""]):
            out = read_pdf(PDF, ocr=ocr, title="Synthetic lease")
        sha = hashlib.sha256(PDF).hexdigest()
        self.assertEqual(seen, [1, 2])
        self.assertEqual(out["document_id"], f"fl:document:sha256-{sha}")
        self.assertEqual(out["document"]["sha256"], sha)
        self.assertEqual(out["document"]["ocr_pages"], [2, 3])
        self.assertEqual(out["pages_without_text"], [])
        verified = factlot.run_tool("doc_verify_facts", {"document": out["document"], "as_of": "2026-11-04", "candidates": [
            {"predicate": "lease.pro_rata_share", "value": 0.0425, "quote": "Pro- portionate Share is 4.25%", "page": 2},
            {"predicate": "lease.expiration_date", "value": "2031-06-30", "quote": "shall expire on June 30, 2031",
             "page": 1}]})
        self.assertEqual(verified["summary"]["verified"], 2)
        self.assertEqual(verified["document"]["document_id"], out["document_id"])
        self.assertIs(verified["verified"][0]["fact"]["provenance"]["sources"][0]["ocr"], True)
        self.assertNotIn("ocr", verified["verified"][1]["fact"]["provenance"]["sources"][0])

    def test_without_ocr_scanned_pages_are_listed(self):
        with fake_pypdf(["text", ""]):
            out = read_pdf(PDF)
        self.assertEqual((out["ocr_pages"], out["pages_without_text"]), ([], [2]))
        self.assertNotIn("ocr_pages", out["document"])

    def test_a_path_reads_the_same_bytes(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp, fake_pypdf(["text"]):
            path = Path(tmp) / "synthetic.pdf"
            path.write_bytes(PDF)
            self.assertEqual(read_pdf(path), read_pdf(PDF))

    def test_limits(self):
        with fake_pypdf(["x" * 100_001]):
            with self.assertRaisesRegex(ValueError, "page 1 has 100001 characters"):
                read_pdf(PDF)

    def test_unknown_ocr_backend(self):
        with fake_pypdf(["text"]), self.assertRaisesRegex(ValueError, "unknown OCR backend"):
            read_pdf(PDF, ocr="no-such-backend")

    def test_cli_reads_standard_input_and_reports_errors_as_json(self):
        stdin = SimpleNamespace(buffer=io.BytesIO(PDF))
        with fake_pypdf(["SYNTHETIC page"]), mock.patch.object(sys, "stdin", stdin), \
                mock.patch.object(sys, "stdout", io.StringIO()) as out:
            code = pdf_main(["-", "--title=-dash title"])
        self.assertEqual(code, 0)
        result = json.loads(out.getvalue())
        self.assertEqual(result["document"]["title"], "-dash title")
        self.assertEqual(result["document"]["pages"], ["SYNTHETIC page"])
        with mock.patch.dict(sys.modules, {"pypdf": None}), mock.patch.object(sys, "stdin", stdin), \
                mock.patch.object(sys, "stdout", io.StringIO()) as out:
            code = pdf_main(["-"])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.getvalue())["error"], "RuntimeError")
        self.assertIn("factlot[pdf]", json.loads(out.getvalue())["message"])

    @unittest.skipUnless(HAVE_PYPDF, "pypdf is optional: pip install 'factlot[pdf]'")
    def test_a_real_pdf(self):
        data = synthetic_pdf(["SYNTHETIC TEST LEASE - NOT A REAL LEASE\nThe Term shall expire on June 30, 2031.", None])
        out = read_pdf(data, ocr=lambda page: "SYNTHETIC OCR TEXT: a security deposit of $50,000")
        self.assertIn("The Term shall expire on June 30, 2031.", out["document"]["pages"][0])
        self.assertEqual(out["ocr_pages"], [2])
        self.assertEqual(out["document"]["sha256"], hashlib.sha256(data).hexdigest())


class Packages(unittest.TestCase):
    def test_merkle_root_follows_rfc_6962(self):
        h = lambda *parts: hashlib.sha256(b"".join(parts)).digest()  # noqa: E731
        leaves = [leaf_hash({"n": n}) for n in range(1, 6)]
        L = [bytes.fromhex(x) for x in leaves]
        node = lambda a, b: h(b"\x01", a, b)  # noqa: E731
        self.assertEqual(leaves[0], h(b"\x00", b'{"n":1}').hex())
        self.assertEqual(merkle_root(leaves[:1]), leaves[0])
        self.assertEqual(merkle_root(leaves[:3]), node(node(L[0], L[1]), L[2]).hex())
        self.assertEqual(merkle_root(leaves), node(node(node(L[0], L[1]), node(L[2], L[3])), L[4]).hex())

    @unittest.skipUnless(HAVE_SIGNING, "cryptography is optional: pip install 'factlot[signing]'")
    def test_signing_gives_the_vector_signature_from_a_seed_or_pem(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        made = factlot.run_tool("fact_package_create", case("fact package: canonical facts")["arguments"])
        want = case("verify a signed package")["arguments"]["package"]["signature"]
        self.assertEqual(sign_fact_package(made["package"], SEED, key_id="rfc8032-test-vector-1")["signature"], want)
        pem = Ed25519PrivateKey.from_private_bytes(SEED).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        signed = sign_fact_package(made["package"], pem.decode(), key_id="rfc8032-test-vector-1")
        self.assertEqual(signed["signature"], want)
        changed = {**made["package"], "title": "changed"}
        with self.assertRaisesRegex(ValueError, "integrity.digest does not match"):
            sign_fact_package(changed, SEED)

    def test_without_cryptography_the_signature_is_reported_unavailable(self):
        args = case("verify: without a trusted key")["arguments"]
        blocked = {"cryptography.exceptions": None, "cryptography.hazmat.primitives.asymmetric.ed25519": None}
        with mock.patch.dict(sys.modules, blocked):
            out = factlot.run_tool("fact_package_verify", args)
            keyed = factlot.run_tool("fact_package_verify", {**args, "public_key": args["package"]["signature"]["public_key"]})
        self.assertEqual(out["signature"]["status"], "unavailable")
        self.assertIn("factlot[signing]", out["signature"]["reason"])
        self.assertTrue(out["valid"], "hashes and facts still check out")
        self.assertFalse(keyed["valid"], "a key was given, so the signature had to verify")


class Words(unittest.TestCase):
    def test_words_and_longest_match(self):
        self.assertEqual(words("Café & Bakeries"), ["cafe", "and", "bakery"])
        self.assertEqual([stem(w) for w in ("taxes", "glasses", "sandwiches", "drinks", "gas", "bus", "analysis")],
                         ["tax", "glass", "sandwich", "drink", "gas", "bus", "analysis"])
        index = KeywordIndex([("bar", ["bar"]), ("juice", ["juice bar"])])
        self.assertEqual([m["key"] for m in index.find(words("a juice bar and a bar"))], ["juice", "bar"])


if __name__ == "__main__":
    unittest.main()
