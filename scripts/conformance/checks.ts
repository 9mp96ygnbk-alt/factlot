// What each major MCP client and OpenAPI importer is documented to require of a tool list or an
// OpenAPI document, as pure checks. scripts/conformance/live.ts runs them against the hosted
// service; checks.test.ts runs them against the local server and the generated documents, so a
// change that breaks a client fails `npm test` before it is deployed.
//
// Each rule names the client and the documentation it comes from. A rule here is a documented
// limit, not a guess; a client whose limit is not documented has no rule.

export interface Finding {
  client: string;
  rule: string;
  /** Where it fails: a tool or operation name and a JSON path. Empty when it passes. */
  failures: string[];
  doc: string;
  /** A documented limitation FactLot accepts for now: reported, never a failure. */
  warn?: boolean;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

type Json = Record<string, unknown>;

/** Every schema node under `schema`, with its path. */
function* nodes(schema: unknown, path = ""): Generator<[string, Json]> {
  if (Array.isArray(schema)) {
    for (const [i, x] of schema.entries()) yield* nodes(x, `${path}/${i}`);
    return;
  }
  if (!schema || typeof schema !== "object") return;
  const node = schema as Json;
  yield [path, node];
  for (const [k, v] of Object.entries(node)) {
    // Values, not schemas.
    if (k === "default" || k === "examples" || k === "enum" || k === "const")
      continue;
    if (k === "properties" || k === "$defs" || k === "definitions") {
      if (v && typeof v === "object")
        for (const [pk, pv] of Object.entries(v as Json))
          yield* nodes(pv, `${path}/${k}/${pk}`);
    } else if (v && typeof v === "object") yield* nodes(v, `${path}/${k}`);
  }
}

function schemaRule(tools: McpTool[], test: (node: Json) => boolean): string[] {
  const out: string[] = [];
  for (const t of tools)
    for (const [path, node] of nodes(t.inputSchema))
      if (test(node)) out.push(`${t.name}${path || "/"}`);
  return out;
}

const DOCS = {
  mcpTools:
    "https://modelcontextprotocol.io/specification/2025-11-25/server/tools",
  claudeReview:
    "https://claude.com/docs/connectors/building/review-criteria.md",
  bedrockConverse:
    "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolSpecification.html",
  geminiCli: "https://geminicli.com/docs/tools/mcp-server/",
  copilotStudio:
    "https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-troubleshooting",
  vscodeTools: "https://code.visualstudio.com/docs/agents/run/tools",
  openaiMcp: "https://developers.openai.com/api/docs/mcp",
  openaiApps: "https://developers.openai.com/apps-sdk/build/mcp-server",
  gptActions: "https://developers.openai.com/api/docs/actions/production",
  bedrockAgents:
    "https://docs.aws.amazon.com/bedrock/latest/userguide/agents-api-schema.html",
};

/** The documented rules for an MCP tools/list answer. */
export function checkToolList(tools: McpTool[]): Finding[] {
  const names = tools.map((t) => t.name);
  const by = (n: string) => tools.find((t) => t.name === n);
  const findings: Finding[] = [
    {
      client: "MCP spec",
      rule: "tool names are 1-128 of [A-Za-z0-9_.-] and unique",
      failures: [
        ...names.filter((n) => !/^[A-Za-z0-9_.-]{1,128}$/.test(n)),
        ...names.filter((n, i) => names.indexOf(n) !== i),
      ],
      doc: DOCS.mcpTools,
    },
    {
      client: "Amazon Bedrock Converse, Claude directory",
      rule: "tool names match [a-zA-Z0-9_-]{1,64}",
      failures: names.filter((n) => !/^[a-zA-Z0-9_-]{1,64}$/.test(n)),
      doc: DOCS.bedrockConverse,
    },
    {
      client: "Gemini CLI",
      rule: "tool names of at most 63 characters (longer names are truncated)",
      failures: names.filter((n) => n.length > 63),
      doc: DOCS.geminiCli,
    },
    {
      client: "VS Code",
      rule: "at most 128 tools in one chat request",
      failures: tools.length > 128 ? [`${tools.length} tools`] : [],
      doc: DOCS.vscodeTools,
    },
    {
      client: "Claude directory, ChatGPT",
      rule: "every tool has a title and readOnlyHint or destructiveHint",
      failures: tools
        .filter(
          (t) =>
            !(t.title || t.annotations?.title) ||
            (typeof t.annotations?.readOnlyHint !== "boolean" &&
              typeof t.annotations?.destructiveHint !== "boolean"),
        )
        .map((t) => t.name),
      doc: DOCS.claudeReview,
    },
    {
      client: "MCP spec",
      rule: "inputSchema is an object schema",
      failures: tools
        .filter((t) => t.inputSchema?.type !== "object")
        .map((t) => t.name),
      doc: DOCS.mcpTools,
    },
    {
      client: "Microsoft Copilot Studio",
      rule: "no numeric exclusiveMinimum (System.FormatException)",
      failures: schemaRule(
        tools,
        (n) =>
          typeof n.exclusiveMinimum === "number" ||
          typeof n.exclusiveMaximum === "number",
      ),
      doc: DOCS.copilotStudio,
    },
    {
      client: "Microsoft Copilot Studio",
      rule: "no reference types ($ref): such tools are dropped from the list",
      failures: schemaRule(tools, (n) => "$ref" in n),
      doc: DOCS.copilotStudio,
    },
    {
      client: "Microsoft Copilot Studio",
      rule: "a single type per schema, not a type array (the schema is truncated)",
      failures: schemaRule(tools, (n) => Array.isArray(n.type)),
      doc: DOCS.copilotStudio,
    },
    {
      client: "ChatGPT deep research and company knowledge",
      rule: "search(query) and fetch(id) exist, are read-only and declare an outputSchema",
      failures: ["search", "fetch"].flatMap((n) => {
        const t = by(n);
        const arg = n === "search" ? "query" : "id";
        if (!t) return [`${n}: missing`];
        const out: string[] = [];
        const props = t.inputSchema.properties as Json | undefined;
        if (!props?.[arg]) out.push(`${n}: no ${arg} argument`);
        if (t.annotations?.readOnlyHint !== true)
          out.push(`${n}: not readOnlyHint`);
        if (t.outputSchema?.type !== "object")
          out.push(`${n}: no outputSchema`);
        return out;
      }),
      doc: DOCS.openaiMcp,
    },
  ];
  return findings;
}

/** The ChatGPT search / fetch result contract for one call's result. */
export function checkSearchFetchResult(
  tool: "search" | "fetch",
  result: {
    content?: { type: string; text?: string }[];
    structuredContent?: Json;
    isError?: boolean;
  },
): Finding {
  const failures: string[] = [];
  const s = result.structuredContent;
  if (result.isError) failures.push(`${tool}: isError`);
  if (!s) failures.push(`${tool}: no structuredContent`);
  const text = result.content?.filter((c) => c.type === "text") ?? [];
  if (text.length !== 1) failures.push(`${tool}: ${text.length} text items`);
  else {
    try {
      if (
        s &&
        JSON.stringify(JSON.parse(text[0]!.text ?? "")) !== JSON.stringify(s)
      )
        failures.push(`${tool}: text differs from structuredContent`);
    } catch {
      failures.push(`${tool}: text is not JSON`);
    }
  }
  if (s && tool === "search") {
    const results = s.results as Json[] | undefined;
    if (!Array.isArray(results)) failures.push("search: no results array");
    for (const r of results ?? [])
      for (const k of ["id", "title", "url"])
        if (typeof r[k] !== "string" || r[k] === "")
          failures.push(`search: result without ${k}`);
  }
  if (s && tool === "fetch")
    for (const k of ["id", "title", "text", "url"])
      if (typeof s[k] !== "string" || s[k] === "")
        failures.push(`fetch: no ${k}`);
  return {
    client: "ChatGPT deep research and company knowledge",
    rule: `${tool} returns structuredContent and the same JSON as one text item, with a citable url`,
    failures,
    doc: DOCS.openaiMcp,
  };
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  requestBody?: unknown;
  parameters?: { description?: string }[];
}

function operations(doc: Json): [string, Operation][] {
  const out: [string, Operation][] = [];
  for (const [path, item] of Object.entries((doc.paths ?? {}) as Json))
    for (const [method, op] of Object.entries(item as Json))
      if (["get", "post", "put", "patch", "delete"].includes(method))
        out.push([`${method.toUpperCase()} ${path}`, op as Operation]);
  return out;
}

/** The Custom GPT Actions limits for the OpenAPI document a GPT imports. */
export function checkGptActions(doc: Json): Finding[] {
  const ops = operations(doc);
  const longParams: string[] = [];
  for (const [where, op] of ops) {
    for (const p of op.parameters ?? [])
      if ((p.description ?? "").length > 700) longParams.push(where);
    for (const [path, node] of nodes(op.requestBody))
      if (typeof node.description === "string" && node.description.length > 700)
        longParams.push(`${where}${path}`);
  }
  return [
    {
      client: "Custom GPT Actions",
      rule: "OpenAPI 3.0.x or 3.1.x",
      failures: /^3\.[01]\.\d+$/.test(String(doc.openapi))
        ? []
        : [String(doc.openapi)],
      doc: DOCS.gptActions,
    },
    {
      client: "Custom GPT Actions",
      rule: "at most 30 operations",
      failures: ops.length > 30 ? [`${ops.length} operations`] : [],
      doc: DOCS.gptActions,
    },
    {
      client: "Custom GPT Actions",
      rule: "each endpoint summary and description at most 300 characters",
      failures: ops
        .filter(
          ([, op]) =>
            (op.summary ?? "").length > 300 ||
            (op.description ?? "").length > 300,
        )
        .map(([w, op]) => `${w} (${(op.description ?? "").length})`),
      doc: DOCS.gptActions,
    },
    {
      client: "Custom GPT Actions",
      rule: "each parameter description at most 700 characters",
      failures: longParams,
      doc: DOCS.gptActions,
    },
    {
      client: "Custom GPT Actions",
      rule: "every operation has a unique operationId",
      failures: ops
        .filter(
          ([, op], i) =>
            !op.operationId ||
            ops.findIndex(([, o]) => o.operationId === op.operationId) !== i,
        )
        .map(([w]) => w),
      doc: DOCS.gptActions,
    },
  ];
}

/** The Bedrock Agents action-group rules for an OpenAPI 3.0 document. */
export function checkBedrockAgents(doc: Json): Finding[] {
  const ops = operations(doc);
  return [
    {
      client: "Amazon Bedrock Agents",
      rule: 'openapi is exactly "3.0.0"',
      failures: doc.openapi === "3.0.0" ? [] : [String(doc.openapi)],
      doc: DOCS.bedrockAgents,
    },
    {
      client: "Amazon Bedrock Agents",
      rule: "each operation has a description and an operationId of letters, digits, - and _",
      failures: ops
        .filter(
          ([, op]) =>
            !op.description || !/^[A-Za-z0-9_-]+$/.test(op.operationId ?? ""),
        )
        .map(([w]) => w),
      doc: DOCS.bedrockAgents,
    },
    {
      client: "Amazon Bedrock Agents",
      rule: "no enum (not supported; the allowed values belong in the description)",
      failures: ops.flatMap(([w, op]) =>
        [...nodes(op.requestBody)]
          .filter(([, n]) => Array.isArray(n.enum))
          .map(([path]) => `${w}${path}`),
      ),
      doc: DOCS.bedrockAgents,
      warn: true,
    },
  ];
}
