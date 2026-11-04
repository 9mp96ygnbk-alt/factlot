// The local-only tools: doc_read_pdf (through a stand-in for the Python reader, so the test needs
// no Python packages) and fact_package_sign (with the RFC 8032 test key, never a real one).
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runTool } from "@factlot/tools";

import { createServer } from "./index.ts";

async function connect(localFiles: boolean): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await createServer({ localFiles }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
};

const dir = mkdtempSync(join(tmpdir(), "factlot-local-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in for `python -m factlot.pdf -`: answers with the bytes' hash, as the SDK does. */
function fakeReader(body: string): string {
  const path = join(dir, `reader-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    path,
    `#!/usr/bin/env node
import { createHash } from "node:crypto";
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const sha256 = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
const argv = process.argv.slice(2);
${body}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const PDF = Buffer.from("%PDF-1.4\nsynthetic bytes for the stand-in reader\n");

test("the local tools are only registered for the local server", async () => {
  const local = (await (await connect(true)).listTools()).tools.map(
    (t) => t.name,
  );
  const remote = (await (await connect(false)).listTools()).tools.map(
    (t) => t.name,
  );
  for (const name of ["doc_read_pdf", "fact_package_sign"]) {
    assert.ok(local.includes(name), name);
    assert.ok(!remote.includes(name), name);
  }
});

test("doc_read_pdf: pages, sha256 and OCR pages from the reader, ready for doc_verify_facts", async () => {
  process.env.FACTLOT_PYTHON = fakeReader(`
process.stdout.write(JSON.stringify({ document: { pages: ["SYNTHETIC. The Term shall expire on June 30, 2031.", "scanned text"], sha256, title: argv.find((a) => a.startsWith("--title="))?.slice(8), ocr_pages: [2] }, document_id: "fl:document:sha256-" + sha256, pages: 2, ocr_pages: [2], pages_without_text: [], argv }));`);
  const file = join(dir, "lease.pdf");
  writeFileSync(file, PDF);
  const client = await connect(true);
  const r = (await client.callTool({
    name: "doc_read_pdf",
    arguments: { path: file, ocr: "tesseract", title: "-starts with a dash" },
  })) as ToolResult;
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  const out = r.structuredContent as {
    document: { pages: string[]; sha256: string; title: string };
    argv: string[];
  };
  assert.deepEqual(out.argv, [
    "-m",
    "factlot.pdf",
    "-",
    "--ocr=tesseract",
    "--title=-starts with a dash",
  ]);
  assert.equal(out.document.title, "-starts with a dash");
  const verified = runTool("doc_verify_facts", {
    document: out.document,
    as_of: "2026-11-04",
    candidates: [
      {
        predicate: "lease.expiration_date",
        value: "2031-06-30",
        quote: "shall expire on June 30, 2031",
        page: 1,
      },
    ],
  });
  assert.ok(verified.ok);
  const doc = (verified.result as { document: { document_id: string } })
    .document;
  assert.equal(doc.document_id, `fl:document:sha256-${out.document.sha256}`);

  // The same bytes given as base64 give the same document.
  const again = (await client.callTool({
    name: "doc_read_pdf",
    arguments: { content_base64: PDF.toString("base64") },
  })) as ToolResult;
  assert.equal(
    (again.structuredContent as { document: { sha256: string } }).document
      .sha256,
    out.document.sha256,
  );
});

test("doc_read_pdf: errors come back as data", async () => {
  const client = await connect(true);
  const call = async (args: Record<string, unknown>) =>
    (await client.callTool({
      name: "doc_read_pdf",
      arguments: args,
    })) as ToolResult;
  const message = (r: ToolResult): string =>
    (JSON.parse(r.content[0]!.text) as { message: string }).message;

  let r = await call({});
  assert.equal(r.isError, true);
  assert.match(message(r), /either path or content_base64/);
  r = await call({
    content_base64: Buffer.from("not a pdf").toString("base64"),
  });
  assert.match(message(r), /not a PDF/);
  r = await call({ path: join(dir, "missing.pdf") });
  assert.match(message(r), /no file at/);

  process.env.FACTLOT_PYTHON = join(dir, "no-such-python");
  r = await call({ content_base64: PDF.toString("base64") });
  assert.match(message(r), /pip install 'factlot\[pdf\]'/);

  process.env.FACTLOT_PYTHON = fakeReader(
    `process.stdout.write(JSON.stringify({ error: "RuntimeError", message: "reading PDFs requires pypdf" })); process.exitCode = 1;`,
  );
  r = await call({ content_base64: PDF.toString("base64") });
  assert.equal(
    (JSON.parse(r.content[0]!.text) as { error: string }).error,
    "PdfReaderUnavailable",
  );

  // A reader that read other bytes than it was given is not trusted.
  process.env.FACTLOT_PYTHON = fakeReader(
    `process.stdout.write(JSON.stringify({ document: { pages: ["x"], sha256: "0".repeat(64) } }));`,
  );
  r = await call({ content_base64: PDF.toString("base64") });
  assert.match(message(r), /unexpected result/);
});

test("fact_package_sign: signs with the key file, which never appears in the output", async () => {
  // RFC 8032 section 7.1, test 1, as PKCS#8 PEM.
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
      "hex",
    ),
  ]);
  const keyFile = join(dir, "signing-key.pem");
  writeFileSync(
    keyFile,
    `-----BEGIN PRIVATE KEY-----\n${der.toString("base64")}\n-----END PRIVATE KEY-----\n`,
  );
  const made = runTool("fact_package_create", {
    facts: [
      {
        subject: "fl:lease:01jbx3k8q2v7m9c4t6w8y0a2b4",
        predicate: "lease.security_deposit",
        value: 50000,
        as_of: "2026-11-04",
        provenance: {
          method: "extracted",
          sources: [
            {
              document_id: "fl:document:sha256-" + "d".repeat(64),
              page: 2,
              quote: "a security deposit of $50,000",
            },
          ],
        },
      },
    ],
  });
  assert.ok(made.ok);
  const pkg = (made.result as { package: Record<string, unknown> }).package;
  const client = await connect(true);

  delete process.env.FACTLOT_SIGNING_KEY_FILE;
  let r = (await client.callTool({
    name: "fact_package_sign",
    arguments: { package: pkg },
  })) as ToolResult;
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /FACTLOT_SIGNING_KEY_FILE/);

  process.env.FACTLOT_SIGNING_KEY_FILE = keyFile;
  r = (await client.callTool({
    name: "fact_package_sign",
    arguments: { package: pkg, key_id: "test" },
  })) as ToolResult;
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  const out = r.structuredContent as {
    package: { signature: { public_key: string; key_id: string } };
    public_key: string;
  };
  assert.equal(out.public_key, "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo");
  assert.ok(!r.content[0]!.text.includes(der.toString("base64").slice(-20)));

  const verify = (await client.callTool({
    name: "fact_package_verify",
    arguments: { package: out.package, public_key: out.public_key },
  })) as ToolResult;
  assert.equal(
    (verify.structuredContent as { signature: { status: string } }).signature
      .status,
    "verified",
  );
});
