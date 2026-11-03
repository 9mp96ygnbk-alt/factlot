/** The two small HTML pages billing returns. Every interpolated value is escaped. */
import type { Plan } from "./plans.ts";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STYLE = `
:root{--bg:#fbfaf7;--fg:#1c1b19;--muted:#5d5a54;--card:#fff;--line:#e4e0d8;--accent:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--fg:#f1efe9;--muted:#a9a59c;--card:#1b1b19;--line:#2e2d2a;--accent:#8ab4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:720px;margin:0 auto;padding:48px 16px}h1{font-size:1.6rem;margin:0 0 12px}
p{color:var(--muted)}a{color:var(--accent)}
pre,code{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:var(--fg)}
.key{font-size:15px;border-color:var(--accent)}
`;

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · FactLot</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

export function messagePage(
  status: number,
  title: string,
  message: string,
): Response {
  return page(
    status,
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>Questions: <a href="mailto:contact@factlot.com">contact@factlot.com</a> or <a href="https://github.com/9mp96ygnbk-alt/factlot/discussions">GitHub Discussions</a>.</p><p><a href="https://factlot.com/">factlot.com</a></p>`,
  );
}

export function keyPage(key: string, plan: Plan, apiUrl: string): Response {
  const k = escapeHtml(key);
  const api = escapeHtml(apiUrl.replace(/\/$/, ""));
  return page(
    200,
    "Your FactLot API key",
    `<h1>Welcome to ${escapeHtml(plan.name)}</h1>
<p>This is your API key. It is shown <strong>once</strong>: copy it into a password manager or your agent's secret store now. FactLot keeps only a hash of it.</p>
<pre class="key">${k}</pre>
<p>Remote MCP (Claude, ChatGPT, Cursor and other MCP clients): server URL <code>${api}/mcp</code> with the header <code>Authorization: Bearer &lt;key&gt;</code>.</p>
<pre>claude mcp add --transport http factlot ${api}/mcp --header "Authorization: Bearer ${k}"</pre>
<p>REST and OpenAPI: <code>${api}/openapi.json</code>, same header.</p>
<pre>curl -s ${api}/v1/billing/portal -X POST -H "Authorization: Bearer ${k}"   # card, invoices, cancel
curl -s ${api}/v1/billing/rotate -X POST -H "Authorization: Bearer ${k}"   # replace a leaked key</pre>
<p>Your plan: ${plan.requestsPerMinute.toLocaleString("en-US")} requests per minute. Questions: <a href="mailto:contact@factlot.com">contact@factlot.com</a>.</p>`,
  );
}
