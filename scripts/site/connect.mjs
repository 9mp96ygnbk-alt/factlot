// The /connect/ page and /connect.json are both generated from site/_data/connect.json, so the
import { Buffer } from "node:buffer";
// page and the machine-readable file cannot drift. Install links are built here, not stored.
const REPO = "https://github.com/9mp96ygnbk-alt/factlot";

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Replace {VERSION} in every string of the data. */
function withVersion(value, version) {
  if (typeof value === "string") return value.replaceAll("{VERSION}", version);
  if (Array.isArray(value)) return value.map((v) => withVersion(v, version));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, withVersion(v, version)]),
    );
  return value;
}

/** cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 of the JSON entry> */
export function cursorLink(name, config) {
  const b64 = Buffer.from(JSON.stringify(config), "utf8").toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(b64)}`;
}

/** vscode:mcp/install?<URL-encoded JSON {"name": ..., ...entry}> (vscode-insiders: for Insiders). */
export function vscodeLink(scheme, name, config) {
  return `${scheme}:mcp/install?${encodeURIComponent(JSON.stringify({ name, ...config }))}`;
}

function installUrl(l) {
  if (l.kind === "cursor") return cursorLink(l.name, l.config);
  if (l.kind === "vscode" || l.kind === "vscode-insiders")
    return vscodeLink(l.kind, l.name, l.config);
  throw new Error(`unknown install link kind ${l.kind}`);
}

/** The data with the version filled in and each install link's url and decoded entry added. */
export function connectData(raw, version) {
  const d = withVersion(raw, version);
  for (const s of d.surfaces)
    for (const p of s.paths) {
      if (p.snippet)
        p.snippet = {
          format: p.snippet.format,
          text: p.snippet.lines.join("\n"),
        };
      for (const l of p.install_links ?? []) l.url = installUrl(l);
    }
  return d;
}

/** connect.json: the same data, with the generated install links. */
export function connectJson(raw, version) {
  return JSON.stringify(connectData(raw, version), null, 2) + "\n";
}

function authLines(a) {
  const rows = [
    ["Free", a.free],
    ["With a key", a.key],
    ["Sign-in", a.oauth],
  ].filter(([, v]) => v);
  return `<ul class="plain">\n${rows.map(([k, v]) => `<li><strong>${k}:</strong> ${esc(v)}</li>`).join("\n")}\n</ul>`;
}

function pathHtml(p) {
  const parts = [`<h3>${esc(p.name)}</h3>`];
  parts.push(
    `<p>${esc(p.you_get)}${p.url ? ` URL: <code>${esc(p.url)}</code>.` : ""}</p>`,
  );
  parts.push(
    `<ol>\n${p.steps.map((s) => `<li>${esc(s)}</li>`).join("\n")}\n</ol>`,
  );
  if (p.install_links?.length)
    parts.push(
      `<p>${p.install_links.map((l) => `<a class="button" href="${esc(l.url)}" rel="nofollow">${esc(l.label)}</a>`).join(" ")}</p>`,
    );
  if (p.snippet) parts.push(`<pre><code>${esc(p.snippet.text)}</code></pre>`);
  parts.push(authLines(p.auth));
  parts.push(
    `<p class="small">${esc(p.verification.docs)} ${esc(p.verification.exercised)} <a href="${REPO}/blob/main/${esc(p.guide)}">Detailed guide</a>.</p>`,
  );
  return `<div class="tabpanel" id="${esc(p.id)}">\n${parts.join("\n")}\n</div>`;
}

/**
 * One surface: a box whose paths are tabs. The tabs are radio inputs, so choosing one does not
 * move the page; with none chosen, the path named in the address (/connect/#claude-code) shows,
 * else the first. The stylesheet does this with :has(); without it every path shows, stacked.
 */
function surfaceHtml(s) {
  const tabs = s.paths
    .map(
      (p) =>
        `<input type="radio" name="tab-${esc(s.id)}" id="tab-${esc(p.id)}" /><label for="tab-${esc(p.id)}">${esc(p.name)}</label>`,
    )
    .join("\n");
  return `<section class="surface" id="${esc(s.id)}" aria-labelledby="${esc(s.id)}-title">
<h2 id="${esc(s.id)}-title">${esc(s.name)}</h2>
<fieldset class="tablist">
<legend class="visually-hidden">${esc(s.name)}: ways to connect</legend>
${tabs}
</fieldset>
${s.paths.map(pathHtml).join("\n")}
</section>`;
}

/**
 * The drawing beside the page's title: every surface the page lists, each joined to the one
 * endpoint. Names and the URL come from the same data as the page. The lines are drawn by the
 * stylesheet on the list itself, so a long name wraps and every name shows in full.
 */
export function connectFigure(raw, version) {
  const d = connectData(raw, version);
  return `<div class="hub">
<ul aria-label="Surfaces">
${d.surfaces.map((s) => `<li>${esc(s.name)}</li>`).join("\n")}
</ul>
<p><span class="visually-hidden">each connects to </span><code>${esc(d.mcp_url)}</code></p>
</div>`;
}

/** The body of /connect/. */
export function connectBody(raw, version) {
  const d = connectData(raw, version);
  const nav = d.surfaces
    .map((s) => `<li><a href="#${esc(s.id)}">${esc(s.name)}</a></li>`)
    .join("\n");
  const groups = d.surfaces.map(surfaceHtml).join("\n");
  return `<p class="lede">
  One hosted server, <code>${esc(d.mcp_url)}</code> (Streamable HTTP, stateless), serves every
  tool to any MCP client. Each section gives the shortest path for one surface. The same
  information is machine-readable at <a href="/connect.json">/connect.json</a>.
</p>
<p>
  The local server (the standalone package and the Claude Desktop extension) is release
  v${esc(version)}. Its next release brings what the hosted server already runs: the tools <code>registry_lookup_batch</code> and <code>registry_recorded_facts</code>, new inputs on existing tools (<code>registry_search_address</code> <code>address</code>, <code>city</code>, <code>state</code>, <code>postal_code</code> and <code>county_fips</code>; <code>registry_coverage</code> <code>fields</code>; <code>same_building_class</code>, <code>same_local_use_code</code> and <code>local_use_codes</code> on the equity-candidate tools; <code>address</code> and <code>label</code> on the subject and comparables of <code>calc_tx_unequal_appraisal</code>; <code>as_of</code> on the Texas deadline rules), and MCP resources and prompts. <code>report_create</code>, the account tools and the model-backed tools are hosted only.
</p>
<h2 id="keys">Keys and sign-in</h2>
<ul class="plain">
<li><strong>Free:</strong> ${esc(d.auth.free)}</li>
<li><strong>With a key:</strong> ${esc(d.auth.key)} See <a href="/pricing/">pricing</a>.</li>
<li><strong>Sign-in:</strong> ${esc(d.auth.oauth)} The sign-in URL is <code>${esc(d.signin_url)}</code>.</li>
</ul>
<p class="small">${esc(d.verification_note)}</p>
<h2 id="surfaces">Surfaces</h2>
<ul class="tiles">
${nav}
</ul>
${groups}
<h2 id="check">Check the connection</h2>
<p>See <a href="/mcp-server/#check">check the connection</a> on the MCP server page, or
<a href="/try/">try a lookup</a> in the browser.</p>
`;
}
