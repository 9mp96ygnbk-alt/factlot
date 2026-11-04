/**
 * Tools only the local (stdio) MCP server registers: they read files on the user's machine, which
 * the hosted API never does. createServer({ localFiles: true }) adds them; bin.ts sets it.
 *
 * - doc_read_pdf: a PDF's page text (text layer, OCR for scanned pages) as the document input of
 *   the doc_* tools, read by the Python SDK (`python -m factlot.pdf`, pypdf) so both SDKs read a
 *   PDF the same way.
 * - fact_package_sign: sign a fact package with the user's own Ed25519 key, read from the file
 *   named by FACTLOT_SIGNING_KEY_FILE; the key never passes through the agent.
 */
import { spawn } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { signFactPackage } from "@factlot/tools";
import { z } from "zod";

export const PDF_MAX_BYTES = 100 * 1024 * 1024;
const PDF_TIMEOUT_MS = 10 * 60 * 1000;

const LOCAL = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function fail(error: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ error, message, issues: [] }) },
    ],
  };
}

const PYTHON_HELP =
  "doc_read_pdf reads PDFs with the FactLot Python SDK: install it with `pip install 'factlot[pdf]'` (and the tesseract command for OCR), or set FACTLOT_PYTHON to the Python that has it. Or extract the page text yourself and pass it as document.pages.";

/** Run `python -m factlot.pdf -` with the PDF on standard input; the JSON it prints. */
function runPdfReader(
  bytes: Uint8Array,
  ocr: string | undefined,
  title: string | undefined,
): Promise<Record<string, unknown>> {
  const python = process.env.FACTLOT_PYTHON || "python3";
  const args = ["-m", "factlot.pdf", "-"];
  // --name=value, so a title that starts with "-" is not read as an option.
  if (ocr) args.push(`--ocr=${ocr}`);
  if (title !== undefined) args.push(`--title=${title}`);
  return new Promise((done, reject) => {
    const child = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"] });
    // Our own timer, unref'd and cleared on exit: spawn's timeout option keeps a timer alive when
    // the interpreter cannot be started at all.
    const timer = setTimeout(() => child.kill("SIGKILL"), PDF_TIMEOUT_MS);
    timer.unref();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdin.on("error", () => {}); // a reader that exits early closes the pipe
    child.on("close", () => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString("utf8").trim();
      try {
        done(JSON.parse(text) as Record<string, unknown>);
      } catch {
        const stderr = Buffer.concat(err).toString("utf8");
        reject(
          new Error(
            /No module named/.test(stderr)
              ? PYTHON_HELP
              : `the PDF reader gave no result${stderr ? `: ${stderr.trim().split("\n").pop()}` : ""}`,
          ),
        );
      }
    });
    child.stdin.end(Buffer.from(bytes));
  });
}

export const ReadPdfInput = {
  path: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      "Path of the PDF on this machine (relative paths resolve from the server's working directory).",
    ),
  content_base64: z
    .string()
    .max(Math.ceil((PDF_MAX_BYTES * 4) / 3) + 4)
    .optional()
    .describe("Or the PDF's bytes as base64."),
  ocr: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/, "an OCR backend name, e.g. tesseract")
    .optional()
    .describe(
      'OCR backend for pages without a text layer, e.g. "tesseract" (needs the tesseract command). Without it, scanned pages come back empty and are listed in pages_without_text.',
    ),
  title: z
    .string()
    .max(500)
    .optional()
    .describe("Document title for citations."),
};

export async function readPdf(
  input: z.output<z.ZodObject<typeof ReadPdfInput>>,
): Promise<CallToolResult> {
  if ((input.path === undefined) === (input.content_base64 === undefined))
    return fail("InputError", "give either path or content_base64");
  let bytes: Uint8Array;
  if (input.path !== undefined) {
    const file = resolve(input.path);
    let info;
    try {
      info = await stat(file);
    } catch {
      return fail("InputError", `no file at ${file}`);
    }
    if (!info.isFile()) return fail("InputError", `${file} is not a file`);
    if (info.size > PDF_MAX_BYTES)
      return fail(
        "InputError",
        `the file is ${info.size} bytes; doc_read_pdf reads at most ${PDF_MAX_BYTES}`,
      );
    bytes = await readFile(file);
  } else {
    const b64 = input.content_base64!;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64))
      return fail("InputError", "content_base64 is not base64");
    bytes = Buffer.from(b64, "base64");
  }
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-")
    return fail(
      "InputError",
      "this is not a PDF (it does not start with %PDF-)",
    );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let result: Record<string, unknown>;
  try {
    result = await runPdfReader(bytes, input.ocr, input.title);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return fail(
      "PdfReaderUnavailable",
      code === "ENOENT" ? PYTHON_HELP : (e as Error).message,
    );
  }
  if (typeof result.error === "string")
    return fail(
      result.error === "RuntimeError" ? "PdfReaderUnavailable" : "InputError",
      String(result.message),
    );
  const document = result.document as Record<string, unknown> | undefined;
  if (
    !document ||
    !Array.isArray(document.pages) ||
    !document.pages.every((p) => typeof p === "string") ||
    document.sha256 !== sha256
  )
    return fail(
      "PdfReaderUnavailable",
      "the PDF reader returned an unexpected result",
    );
  return ok({
    ...result,
    next: "Read the pages, then pass document as is to doc_verify_facts, doc_abstract_lease, doc_verify_claim or doc_spread_statement with the values you extract; quotes are matched against exactly this text. Pages listed in ocr_pages came from OCR, and facts cited to them carry ocr: true.",
  });
}

const PEM =
  /-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/;

export const SignInput = {
  package: z
    .record(z.string(), z.unknown())
    .describe("The package from fact_package_create."),
  key_id: z
    .string()
    .max(200)
    .optional()
    .describe("A label for the key, stored with the signature."),
};

export async function signPackage(
  input: z.output<z.ZodObject<typeof SignInput>>,
): Promise<CallToolResult> {
  const file = process.env.FACTLOT_SIGNING_KEY_FILE;
  if (!file)
    return fail(
      "SigningKeyUnavailable",
      "set FACTLOT_SIGNING_KEY_FILE to the path of your Ed25519 private key (PKCS#8 PEM, e.g. from `openssl genpkey -algorithm ed25519`) in the MCP server's environment; the key stays on this machine",
    );
  let key: webcrypto.CryptoKey;
  try {
    const m = PEM.exec(await readFile(file, "utf8"));
    if (!m) throw new Error("not a PKCS#8 PEM private key");
    key = await webcrypto.subtle.importKey(
      "pkcs8",
      Buffer.from(m[1]!.replace(/\s+/g, ""), "base64"),
      { name: "Ed25519" },
      true,
      ["sign"],
    );
  } catch {
    // Never echo the key file's content.
    return fail(
      "SigningKeyUnavailable",
      "FACTLOT_SIGNING_KEY_FILE does not hold an Ed25519 private key in PKCS#8 PEM",
    );
  }
  try {
    const signed = await signFactPackage(input.package, key, input.key_id);
    return ok({
      package: signed,
      public_key: (signed.signature as { public_key: string }).public_key,
      next: "Share the package and, separately, your public key; fact_package_verify with that public_key checks it.",
    });
  } catch (e) {
    return fail("InputError", (e as Error).message);
  }
}

/** Register the local-only tools. */
export function registerLocalTools(server: McpServer): void {
  server.registerTool(
    "doc_read_pdf",
    {
      title: "Read a PDF's page text",
      description:
        "Local server only. Read a PDF on this machine (a path, or its bytes as base64) into the document input of the doc_* tools: the text layer of each page, OCR through a backend you name (e.g. tesseract) for pages without one, the file's sha256 so document_id is fl:document:sha256-<sha256> (the same ID id_document gives the file), and ocr_pages, the pages whose text came from OCR (facts cited to them carry ocr: true). Needs the FactLot Python SDK with pypdf (pip install 'factlot[pdf]'). Nothing leaves the machine.",
      inputSchema: ReadPdfInput,
      annotations: { ...LOCAL, title: "Read a PDF's page text" },
    },
    readPdf,
  );
  server.registerTool(
    "fact_package_sign",
    {
      title: "Sign a fact package",
      description:
        "Local server only. Sign a package from fact_package_create with your own Ed25519 private key, read from the file named by the FACTLOT_SIGNING_KEY_FILE environment variable (PKCS#8 PEM); the key never passes through the conversation and nothing leaves the machine. Returns the package with signature {algorithm, public_key, value} and the public key to share for fact_package_verify.",
      inputSchema: SignInput,
      // Read-only: it returns a signed copy and changes nothing on the machine.
      annotations: { ...LOCAL, title: "Sign a fact package" },
    },
    signPackage,
  );
}
