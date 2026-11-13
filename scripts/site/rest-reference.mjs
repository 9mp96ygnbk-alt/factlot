// The REST reference on /connect/ (and in /connect.json): for the tools a person reaches first,
// the method and path, the required fields and one example body, generated at build time from the
// tool catalog (spec/schemas/tools.json) and report_create's request schema. The tools, and the
// example bodies that no test vector supplies, are listed in site/_data/rest-reference.json; every
// other example comes from the tool's test vectors (the first passing case, or the shortest when
// the first is long). Every example is checked
// against the tool's input schema, so the build fails before the page can show a body that the
// API refuses. site.test.ts checks that every path is in the OpenAPI document.
import fs from "node:fs";
import path from "node:path";

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Who needs a key, said once for the page and connect.json. */
export const KEY_NOTE =
  "A key is optional: without one the free tier applies per IP address; a free key (Authorization: Bearer <free key>) gives the same free limits on its own meter; a Pro or Team key gives its plan's limits and paid features.";

/** report_create is answered by the hosted Worker at POST /v1/reports. */
export const REPORT_ROUTE = { tool: "report_create", path: "/v1/reports" };

/**
 * The inputs of a tool's passing test-vector cases: spec/vectors/calc/<name>.json for calc_*,
 * spec/vectors/rules/<name>.json for rules_*, and spec/vectors/tools.json for every tool.
 */
export function vectorInputs(root, tool) {
  const read = (rel) => {
    const file = path.join(root, rel);
    return fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : undefined;
  };
  const out = [];
  const own = tool.startsWith("calc_")
    ? read(`spec/vectors/calc/${tool.slice(5)}.json`)
    : tool.startsWith("rules_")
      ? read(`spec/vectors/rules/${tool.slice(6)}.json`)
      : undefined;
  for (const c of own?.cases ?? [])
    if (!("expect_error" in c) && c.input !== undefined) out.push(c.input);
  for (const c of read("spec/vectors/tools.json")?.cases ?? [])
    if (c.tool === tool && !("expect_error" in c) && c.arguments !== undefined)
      out.push(c.arguments);
  return out;
}

/** Longest example body taken from a vector as it comes; a longer first case gives way to the shortest. */
export const MAX_EXAMPLE_CHARS = 300;

/** The first passing case when it is short enough, else the shortest one. */
function pickExample(inputs) {
  const len = (x) => JSON.stringify(x).length;
  if (inputs.length === 0) return undefined;
  if (len(inputs[0]) <= MAX_EXAMPLE_CHARS) return inputs[0];
  return [...inputs].sort((a, b) => len(a) - len(b))[0];
}

/**
 * The reference entries, in the data file's order: { tool, title, method, path, required,
 * fields?, example }. `catalog`: the tools of tools.json; `reportSchema`: report_create's JSON
 * Schema; `vectors(tool)`: candidate example inputs; `validate(tool, body)`: an error message, or
 * undefined when the body is a valid input. Throws on an unknown tool or an invalid example.
 */
export function restReference(
  data,
  { catalog, reportSchema, vectors, validate },
) {
  const byName = new Map(catalog.map((t) => [t.name, t]));
  return data.tools.map((entry) => {
    const t =
      entry.tool === REPORT_ROUTE.tool
        ? {
            name: REPORT_ROUTE.tool,
            title: "Create a client-ready report (XLSX, PDF, ICS)",
            path: REPORT_ROUTE.path,
            input_schema: reportSchema,
          }
        : byName.get(entry.tool);
    if (!t) throw new Error(`rest-reference: no tool ${entry.tool}`);
    const example = entry.example ?? pickExample(vectors(entry.tool));
    if (example === undefined)
      throw new Error(
        `rest-reference: ${entry.tool} has no example and no passing vector`,
      );
    const problem = validate(entry.tool, example);
    if (problem)
      throw new Error(
        `rest-reference: the example for ${entry.tool} is not a valid input: ${problem}`,
      );
    return {
      tool: t.name,
      title: t.title,
      method: "POST",
      path: t.path,
      required: t.input_schema?.required ?? [],
      ...(entry.fields ? { fields: entry.fields } : {}),
      example,
    };
  });
}

/** The REST section of /connect/. */
export function restReferenceHtml(entries, api = "https://api.factlot.com") {
  const items = entries
    .map((e) => {
      const fields = e.fields
        ? esc(e.fields)
        : e.required.length
          ? e.required.map((f) => `<code>${esc(f)}</code>`).join(", ")
          : "none";
      return `<li id="rest-${esc(e.tool)}"><strong>${esc(e.tool)}</strong>: <code>${esc(e.method)} ${esc(e.path)}</code>. Required: ${fields}.<br><code>${esc(JSON.stringify(e.example))}</code></li>`;
    })
    .join("\n");
  const first = entries[0];
  return `<h2 id="rest">REST reference</h2>
<p>Every tool is also a REST route on <code>${esc(api)}</code>: POST the tool's arguments as one JSON object (<code>content-type: application/json</code>). ${esc(KEY_NOTE)} The routes people reach first, with the fields a call needs and one example body each; <a href="${esc(api)}/openapi.json">/openapi.json</a> lists every route with its full schema.</p>
<ul class="plain">
${items}
</ul>
${
  first
    ? `<pre><code>curl -s ${esc(api)}${esc(first.path)} \\
  -H 'content-type: application/json' \\
  -d '${esc(JSON.stringify(first.example))}'</code></pre>`
    : ""
}`;
}

/** The same entries for /connect.json. */
export function restReferenceJson(entries, api = "https://api.factlot.com") {
  return {
    openapi: `${api}/openapi.json`,
    note: `POST the tool's arguments as one JSON object. ${KEY_NOTE}`,
    routes: entries.map((e) => ({
      tool: e.tool,
      method: e.method,
      path: e.path,
      url: `${api}${e.path}`,
      required: e.required,
      ...(e.fields ? { fields: e.fields } : {}),
      example: e.example,
    })),
  };
}
