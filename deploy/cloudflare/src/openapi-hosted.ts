/**
 * Operations the Worker answers itself, added to the inner handler's OpenAPI documents
 * (/openapi.json and /openapi-3.0.json?operations=all) so they list every REST route that
 * answers: report_create (POST /v1/reports, every caller) and its download, and, while the
 * server has a model, the model-backed tools (doc_extract_lease, report_narrative).
 */
import { toOpenApi30Schema } from "@factlot/tools";

import { EXTRACT_LEASE_TOOL } from "./ingest.ts";
import { MODEL_PATHS } from "./model-tools.ts";
import { REPORT_NARRATIVE_TOOL } from "./narrative.ts";
import { DOWNLOAD_PATH, REPORT_TOOL } from "./reports.ts";

type Json = Record<string, unknown>;

interface HostedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
}

function operation(
  tool: HostedTool,
  convert: (s: unknown) => Json,
  errors: Record<string, string>,
  paid: boolean,
): Json {
  const error = (description: string) => ({
    description,
    content: {
      "application/json": {
        schema: convert({
          type: "object",
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            message: { type: "string" },
            next: { type: "string" },
          },
          required: ["error", "message"],
        }),
      },
    },
  });
  return {
    post: {
      operationId: tool.name,
      summary: tool.title,
      description: tool.description,
      "x-openai-isConsequential": false,
      ...(paid ? { security: [{ bearerAuth: [] }] } : {}),
      requestBody: {
        required: true,
        content: { "application/json": { schema: convert(tool.inputSchema) } },
      },
      responses: {
        "200": {
          description: "Result object.",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "400": error(
          "Invalid input; read `issues`, fix the arguments, and retry.",
        ),
        ...Object.fromEntries(
          Object.entries(errors).map(([code, d]) => [code, error(d)]),
        ),
      },
    },
  };
}

/** The document with the Worker's own operations added. Returns a fresh response. */
export async function withHostedOperations(
  res: Response,
  version: "3.1" | "3.0",
  model: boolean,
): Promise<Response> {
  let doc: { paths?: Json };
  try {
    doc = (await res.clone().json()) as typeof doc;
  } catch {
    return res;
  }
  const convert = (s: unknown) =>
    version === "3.0" ? toOpenApi30Schema(s) : (s as Json);
  doc.paths ??= {};
  doc.paths["/v1/reports"] = operation(
    REPORT_TOOL,
    convert,
    { "429": "The month's reports are used up (reports_per_month)." },
    false,
  );
  doc.paths[`${DOWNLOAD_PATH}{token}`] = {
    get: {
      operationId: "report_download",
      summary: "Download a report",
      description:
        "The file a report_create call stored, by the token in its download_url; it works for 24 hours.",
      parameters: [
        {
          name: "token",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "The report file (XLSX, PDF or ICS)." },
        "404": { description: "Unknown or expired token." },
      },
    },
  };
  if (model)
    for (const [path, name] of MODEL_PATHS)
      doc.paths[path] = operation(
        name === EXTRACT_LEASE_TOOL.name
          ? EXTRACT_LEASE_TOOL
          : REPORT_NARRATIVE_TOOL,
        convert,
        {
          "403": "PlanRequired: a Pro or Team key is needed.",
          "429": "The plan's monthly allowance for this tool is used up.",
          "503": "ModelUnavailable: no model is configured on this server.",
        },
        true,
      );
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(doc), { status: res.status, headers });
}
